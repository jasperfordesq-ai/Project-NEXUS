<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Staff-proposed guardian arrangements, and the member's own answers to them:
 * agree, refuse, withdraw.
 *
 * 🔴 Phase 5 of the guardian redesign: the storage moved. "Guardian" used to
 * mean two unrelated things — a staff note in `safeguarding_assignments` and a
 * member-granted link in `account_relationships` — with no connection between
 * them (docs/SAFEGUARDING-AND-CONSENT.md opens with the warning). Staff
 * arrangements are now rows IN `account_relationships`, marked by
 * `proposed_by_user_id`, at tier 0: SupportTiers::resolve() of their empty
 * grant is `none` on every capability, so an arrangement grants NOTHING — the
 * same guarantee the old table gave by having no capability columns at all.
 * `safeguarding_assignments` remains as a READ-ONLY archive; its append-only
 * event trail is never rewritten.
 *
 * The public contract of this class is unchanged on purpose — both frontends,
 * the member endpoints and the dashboard prompt consume these exact shapes.
 *
 * Row-state mapping (status enum stays active|pending|revoked):
 *   pending, no timestamps  → 'pending'    awaiting the member's answer
 *   active                  → 'consented'
 *   pending + declined_at   → 'declined'   member said no; may re-consent
 *   pending + withdrawn_at  → 'withdrawn'  member took a given agreement back
 *   revoked                 → staff-ended; gone from every member list
 *
 * Declined/withdrawn deliberately do NOT use status 'revoked': revocation is
 * the staff exit, and conflating a member's "no" with a staff removal would
 * make the member's answer look like an administrative act.
 *
 * Deliberate design choices carried over unchanged:
 *  - Only the member the arrangement is about can answer. A guardian cannot
 *    respond on the subject's behalf.
 *  - The reason is never mandatory — requiring somebody to justify refusing a
 *    safeguarding arrangement is pressure to consent.
 *  - The row states the current position; `account_relationship_events`
 *    (append-only, DB-trigger enforced) states the story.
 *  - Staff are told when a member refuses or withdraws, each recipient in
 *    their own language.
 *
 * 🔴 `SafeguardingService::recordConsent()` remains superseded — it writes the
 * ARCHIVE table and updates every unconsented row when called without an id.
 */
class GuardianArrangementService
{
    /** The responses a ward may record. */
    public const ACTION_CONSENTED = 'consented';
    public const ACTION_DECLINED  = 'declined';
    public const ACTION_WITHDRAWN = 'withdrawn';

    public const WARD_ACTIONS = [
        self::ACTION_CONSENTED,
        self::ACTION_DECLINED,
        self::ACTION_WITHDRAWN,
    ];

    /**
     * Tier 0: the canonical permissions payload for a staff arrangement.
     * Both representations present and in agreement (see SupportTiers), all
     * capabilities at none — the arrangement grants nothing.
     */
    private const TIER_ZERO_PERMISSIONS = [
        'can_view_activity'   => false,
        'can_manage_listings' => false,
        'can_transact'        => false,
        'can_view_messages'   => false,
        'tiers' => ['activity' => 'none', 'listings' => 'none', 'credits' => 'none'],
    ];

    /**
     * Which responses are legal from each current position.
     *
     * Withdrawal requires a prior agreement — you cannot withdraw something you
     * never gave, and allowing it would write a misleading history row.
     */
    private const ALLOWED_FROM = [
        'pending'   => [self::ACTION_CONSENTED, self::ACTION_DECLINED],
        'consented' => [self::ACTION_WITHDRAWN, self::ACTION_DECLINED],
        'declined'  => [self::ACTION_CONSENTED],
        'withdrawn' => [self::ACTION_CONSENTED],
    ];

    /** Member-response action → account_relationship_events vocabulary. */
    private const EVENT_ACTION = [
        self::ACTION_CONSENTED => 'approved',
        self::ACTION_DECLINED  => 'declined',
        self::ACTION_WITHDRAWN => 'withdrawn',
    ];

    /** Current position of an arrangement (relationship) row. */
    public static function stateOf(object $row): string
    {
        if (($row->withdrawn_at ?? null) !== null) return 'withdrawn';
        if (($row->declined_at ?? null) !== null) return 'declined';
        if (($row->status ?? null) === 'active') return 'consented';
        return 'pending';
    }

    /**
     * Staff propose an arrangement: guardian ↔ supported member, tier 0.
     *
     * If the pair already has a relationship: a REVOKED one is re-proposed in
     * place (same row, fresh pending position — the events trail carries the
     * history); a live one — member-created or staff-proposed — is refused,
     * because the unique key allows one row per pair and silently merging a
     * staff record into a member-granted link would blur who created what.
     *
     * @return array{ok:bool, id:?int, code:?string}
     */
    public function propose(
        int $staffUserId,
        int $tenantId,
        int $guardianUserId,
        int $wardUserId,
        ?string $notes = null,
    ): array {
        $notes = $this->normaliseReason($notes);

        return DB::transaction(function () use ($staffUserId, $tenantId, $guardianUserId, $wardUserId, $notes): array {
            $existing = DB::table('account_relationships')
                ->where('tenant_id', $tenantId)
                ->where('parent_user_id', $guardianUserId)
                ->where('child_user_id', $wardUserId)
                ->lockForUpdate()
                ->first();

            if ($existing && $existing->status !== 'revoked') {
                return ['ok' => false, 'id' => null, 'code' => 'ALREADY_LINKED'];
            }

            $now = now();
            $values = [
                'relationship_type'   => 'guardian',
                'permissions'         => json_encode(self::TIER_ZERO_PERMISSIONS),
                'status'              => 'pending',
                'proposed_by_user_id' => $staffUserId,
                'staff_notes'         => $notes,
                'approved_at'         => null,
                'declined_at'         => null,
                'withdrawn_at'        => null,
                'response_reason'     => null,
                'updated_at'          => $now,
            ];

            if ($existing) {
                DB::table('account_relationships')->where('id', $existing->id)->update($values);
                $id = (int) $existing->id;
            } else {
                $id = (int) DB::table('account_relationships')->insertGetId($values + [
                    'tenant_id'      => $tenantId,
                    'parent_user_id' => $guardianUserId,
                    'child_user_id'  => $wardUserId,
                    'created_at'     => $now,
                ]);
            }

            $this->event($tenantId, $id, $guardianUserId, $wardUserId, 'proposed', 'staff', $staffUserId, $notes);

            return ['ok' => true, 'id' => $id, 'code' => null];
        });
    }

    /**
     * Staff end an arrangement. Returns the row (guardian_user_id /
     * ward_user_id aliased for the caller's notification code) or null.
     */
    public function staffRevoke(int $staffUserId, int $tenantId, int $arrangementId): ?object
    {
        return DB::transaction(function () use ($staffUserId, $tenantId, $arrangementId): ?object {
            $row = DB::table('account_relationships')
                ->where('id', $arrangementId)
                ->where('tenant_id', $tenantId)
                ->whereNotNull('proposed_by_user_id')
                ->where('status', '!=', 'revoked')
                ->lockForUpdate()
                ->first();

            if (! $row) {
                return null;
            }

            DB::table('account_relationships')
                ->where('id', $arrangementId)
                ->update([
                    'status' => 'revoked',
                    'permissions' => json_encode(self::TIER_ZERO_PERMISSIONS),
                    'message_access_granted_at' => null,
                    'updated_at' => now(),
                ]);

            app(SupportPendingActionService::class)->cancelOpenForRelationship(
                $arrangementId,
                null,
                'guardian_arrangement_revoked',
            );

            $this->event($tenantId, $arrangementId, (int) $row->parent_user_id, (int) $row->child_user_id, 'revoked', 'staff', $staffUserId);

            return (object) [
                'id'               => (int) $row->id,
                'guardian_user_id' => (int) $row->parent_user_id,
                'ward_user_id'     => (int) $row->child_user_id,
            ];
        });
    }

    /**
     * Record the member's own response.
     *
     * @return array{ok:bool,code:?string,state:?string,already:bool}
     *   `ok=false` with a code the controller maps to a status. Never throws for
     *   ordinary refusals — the caller needs to distinguish "not yours" (404)
     *   from "not a legal transition" (422).
     */
    public function respond(
        int $wardId,
        int $tenantId,
        int $assignmentId,
        string $action,
        ?string $reason = null,
        ?string $ip = null,
        ?string $userAgent = null,
    ): array {
        if (! in_array($action, self::WARD_ACTIONS, true)) {
            return ['ok' => false, 'code' => 'INVALID_ACTION', 'state' => null, 'already' => false];
        }

        $reason = $this->normaliseReason($reason);

        return DB::transaction(function () use ($wardId, $tenantId, $assignmentId, $action, $reason, $ip, $userAgent): array {
            // Locked so two tabs cannot both transition the same row. Scoped to
            // the MEMBER the arrangement is about — a guardian cannot answer.
            $row = DB::table('account_relationships')
                ->where('id', $assignmentId)
                ->where('tenant_id', $tenantId)
                ->where('child_user_id', $wardId)
                ->whereNotNull('proposed_by_user_id')
                ->where('status', '!=', 'revoked')
                ->lockForUpdate()
                ->first();

            if (! $row) {
                return ['ok' => false, 'code' => 'NOT_FOUND', 'state' => null, 'already' => false];
            }

            $state = self::stateOf($row);

            // Idempotent: asking for the position you are already in succeeds.
            if ($this->stateMatchesAction($state, $action)) {
                return ['ok' => true, 'code' => null, 'state' => $state, 'already' => true];
            }

            if (! in_array($action, self::ALLOWED_FROM[$state] ?? [], true)) {
                return ['ok' => false, 'code' => 'INVALID_TRANSITION', 'state' => $state, 'already' => false];
            }

            $now = now();
            $endingConsent = in_array($action, [self::ACTION_DECLINED, self::ACTION_WITHDRAWN], true);
            DB::table('account_relationships')
                ->where('id', $assignmentId)
                ->update([
                    'status'          => $action === self::ACTION_CONSENTED ? 'active' : 'pending',
                    'approved_at'     => $action === self::ACTION_CONSENTED ? $now : null,
                    'declined_at'     => $action === self::ACTION_DECLINED ? $now : null,
                    'withdrawn_at'    => $action === self::ACTION_WITHDRAWN ? $now : null,
                    'response_reason' => $reason,
                    ...($endingConsent ? [
                        'permissions' => json_encode(self::TIER_ZERO_PERMISSIONS),
                        'message_access_granted_at' => null,
                    ] : []),
                    'updated_at'      => $now,
                ]);

            if ($endingConsent) {
                app(SupportPendingActionService::class)->cancelOpenForRelationship(
                    $assignmentId,
                    null,
                    $action === self::ACTION_WITHDRAWN ? 'guardian_consent_withdrawn' : 'guardian_consent_declined',
                );
            }

            $this->event(
                $tenantId,
                $assignmentId,
                (int) $row->parent_user_id,
                $wardId,
                self::EVENT_ACTION[$action],
                'member',
                $wardId,
                $reason,
                $ip,
                $userAgent,
            );

            $newState = $action === self::ACTION_CONSENTED ? 'consented'
                : ($action === self::ACTION_DECLINED ? 'declined' : 'withdrawn');

            // Notifications here are DB rows only, so writing them inside the
            // transaction is safe and keeps them from surviving a rollback.
            $this->notifyStaff($tenantId, $row, $wardId, $action, $reason);

            return ['ok' => true, 'code' => null, 'state' => $newState, 'already' => false];
        }, 3);
    }

    /**
     * The supported member grants (or changes, or removes) what their guardian
     * may actually do — the tiers from SupportTiers.
     *
     * 🔴 Why this exists, and why it lives HERE rather than on
     * SubAccountService::updatePermissions().
     *
     * Phase 5 folded staff-recorded arrangements into account_relationships and
     * then, correctly, refused to let anyone change their tiers through the
     * linked-accounts path: that path is driven by the PARENT of the
     * relationship, i.e. the guardian, and a guardian granting themselves
     * powers over the person they support is precisely the thing this whole
     * module exists to prevent. But no other route was provided, and one row
     * per pair means the member could not create an ordinary linked account
     * with that guardian either. The result was a dead end — the tiers became
     * permanently unreachable for any pair a coordinator had recorded (found
     * by the owner on 2026-08-07, on the only such pair in production).
     *
     * The fix is not to relax the guardian's block. It is to give the decision
     * to the person it belongs to. Every guard here follows from that:
     *
     * - Scoped to `child_user_id = $wardId`: only the SUPPORTED member may
     *   call this. The guardian gets NOT_FOUND, exactly as they do for
     *   consent.
     * - Only on an arrangement they have AGREED to (`status = 'active'`).
     *   Granting powers under an arrangement you have refused, withdrawn from,
     *   or not yet answered would let a grant stand in for the consent.
     * - Raising any tier re-asserts the safeguarding contact policy in both
     *   directions, at grant time, exactly as the linked-accounts path does.
     *   Lowering never does — withdrawing power must always be a safe exit.
     *
     * @param  array<string,string>  $tiers  capability => tier; absent keys unchanged
     * @return array{ok:bool,code:?string,tiers:?array<string,string>}
     */
    public function setTiers(int $wardId, int $tenantId, int $arrangementId, array $tiers): array
    {
        $clean = SupportTiers::sanitizeTiers($tiers);
        // Staff-recorded guardians may not hold `messages` at any tier: staff
        // oversight of conversations is the broker-copy mechanism with its own
        // audit, and the member-consent grant flow belongs to member-created
        // links only. Dropped silently — the capability is never offered on
        // this page, so a value here is a crafted request, not a UI state.
        unset($clean['messages']);
        if ($clean === []) {
            return ['ok' => false, 'code' => 'VALIDATION_ERROR', 'tiers' => null];
        }

        return DB::transaction(function () use ($wardId, $tenantId, $arrangementId, $clean): array {
            $row = DB::table('account_relationships')
                ->where('id', $arrangementId)
                ->where('tenant_id', $tenantId)
                ->where('child_user_id', $wardId)
                ->whereNotNull('proposed_by_user_id')
                ->where('status', 'active')
                ->lockForUpdate()
                ->first();

            if (! $row) {
                return ['ok' => false, 'code' => 'NOT_FOUND', 'tiers' => null];
            }

            $permissions = json_decode((string) $row->permissions, true);
            $before = SupportTiers::resolve(is_array($permissions) ? $permissions : []);
            $after = $before;
            foreach ($clean as $capability => $tier) {
                $after[$capability] = $tier;
            }

            if ($after === $before) {
                // Nothing changed: succeed without writing a no-op history row.
                return ['ok' => true, 'code' => null, 'tiers' => $after];
            }

            if (SupportTiers::isExpansion($before, $after)) {
                // May throw SafeguardingPolicyException — the controller maps it.
                $policy = app(SafeguardingInteractionPolicy::class);
                $policy->assertLocalContactAllowed((int) $row->parent_user_id, $wardId, $tenantId, 'guardian_tier_grant');
                $policy->assertLocalContactAllowed($wardId, (int) $row->parent_user_id, $tenantId, 'guardian_tier_grant');
            }

            DB::table('account_relationships')
                ->where('id', $arrangementId)
                ->update([
                    'permissions' => json_encode(
                        SupportTiers::toLegacyBooleans($after) + ['tiers' => $after],
                    ),
                    'updated_at' => now(),
                ]);

            $this->event(
                $tenantId,
                $arrangementId,
                (int) $row->parent_user_id,
                $wardId,
                'permissions_changed',
                'member',
                $wardId,
                null,
                null,
                null,
                ['tiers_before' => $before, 'tiers_after' => $after],
            );

            $this->notifyGuardianOfTierChange($tenantId, (int) $row->parent_user_id, $wardId);

            return ['ok' => true, 'code' => null, 'tiers' => $after];
        }, 3);
    }

    /**
     * The arrangements recorded against a member, for their settings screen.
     *
     * @return list<array<string,mixed>>
     */
    public function forWard(int $wardId, int $tenantId): array
    {
        return DB::table('account_relationships as ar')
            ->join('users as g', 'g.id', '=', 'ar.parent_user_id')
            ->where('ar.tenant_id', $tenantId)
            ->where('ar.child_user_id', $wardId)
            ->whereNotNull('ar.proposed_by_user_id')
            ->where('ar.status', '!=', 'revoked')
            ->orderByDesc('ar.created_at')
            ->select([
                'ar.id', 'ar.status', 'ar.created_at', 'ar.approved_at', 'ar.declined_at',
                'ar.withdrawn_at', 'ar.response_reason', 'ar.staff_notes', 'ar.permissions',
                'g.first_name', 'g.last_name', 'g.profile_type', 'g.organization_name',
            ])
            ->get()
            ->map(function ($r) {
                $permissions = json_decode((string) $r->permissions, true);

                return [
                    'id'                   => (int) $r->id,
                    'guardian_name'        => UserDisplayName::resolve($r),
                    'assigned_at'          => $r->created_at,
                    'consent_given_at'     => $r->approved_at,
                    'consent_declined_at'  => $r->declined_at,
                    'consent_withdrawn_at' => $r->withdrawn_at,
                    'ward_response_reason' => $r->response_reason,
                    'state'                => self::stateOf($r),
                    'consent_given'        => $r->approved_at !== null,
                    'notes'                => $r->staff_notes,
                    // What this guardian may actually DO, which only the
                    // supported member can set (see setTiers()).
                    'tiers'                => SupportTiers::resolve(is_array($permissions) ? $permissions : []),
                ];
            })
            ->all();
    }

    /**
     * The people a guardian has been made responsible for. Names and the
     * member's own position only — a guardian learning that someone has
     * refused is the point; their contact details are not.
     *
     * @return list<array<string,mixed>>
     */
    public function forGuardian(int $guardianId, int $tenantId): array
    {
        return DB::table('account_relationships as ar')
            ->join('users as w', 'w.id', '=', 'ar.child_user_id')
            ->where('ar.tenant_id', $tenantId)
            ->where('ar.parent_user_id', $guardianId)
            ->whereNotNull('ar.proposed_by_user_id')
            ->where('ar.status', '!=', 'revoked')
            ->orderByDesc('ar.created_at')
            ->select([
                'ar.id', 'ar.status', 'ar.created_at', 'ar.declined_at', 'ar.withdrawn_at',
                'w.first_name', 'w.last_name', 'w.profile_type', 'w.organization_name',
            ])
            ->get()
            ->map(fn ($r) => [
                'id'          => (int) $r->id,
                'ward_name'   => UserDisplayName::resolve($r),
                'assigned_at' => $r->created_at,
                'state'       => self::stateOf($r),
            ])
            ->all();
    }

    /**
     * How many arrangements are still awaiting this member's response.
     * Drives the dashboard prompt.
     */
    public function pendingCountForWard(int $wardId, int $tenantId): int
    {
        return (int) DB::table('account_relationships')
            ->where('tenant_id', $tenantId)
            ->where('child_user_id', $wardId)
            ->whereNotNull('proposed_by_user_id')
            ->where('status', 'pending')
            ->whereNull('declined_at')
            ->whereNull('withdrawn_at')
            ->count();
    }

    /**
     * The broker tab's list, in the shape it has always consumed.
     *
     * @return list<array<string,mixed>>
     */
    public function listForStaff(int $tenantId): array
    {
        return DB::table('account_relationships as ar')
            ->join('users as ward', 'ar.child_user_id', '=', 'ward.id')
            ->join('users as guardian', 'ar.parent_user_id', '=', 'guardian.id')
            ->where('ar.tenant_id', $tenantId)
            ->whereNotNull('ar.proposed_by_user_id')
            ->select([
                'ar.id', 'ar.child_user_id', 'ar.parent_user_id', 'ar.status',
                'ar.approved_at', 'ar.declined_at', 'ar.withdrawn_at', 'ar.created_at',
                DB::raw("COALESCE(ward.name, CONCAT(COALESCE(ward.first_name, ''), ' ', COALESCE(ward.last_name, ''))) as ward_name"),
                'ward.avatar_url as ward_avatar',
                DB::raw("COALESCE(guardian.name, CONCAT(COALESCE(guardian.first_name, ''), ' ', COALESCE(guardian.last_name, ''))) as guardian_name"),
                'guardian.avatar_url as guardian_avatar',
            ])
            ->orderByDesc('ar.created_at')
            ->get()
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'ward' => [
                    'id' => (int) $row->child_user_id,
                    'name' => trim($row->ward_name ?? ''),
                    'avatar_url' => $row->ward_avatar,
                ],
                'guardian' => [
                    'id' => (int) $row->parent_user_id,
                    'name' => trim($row->guardian_name ?? ''),
                    'avatar_url' => $row->guardian_avatar,
                ],
                'status' => $row->status === 'revoked' ? 'revoked'
                    : ($row->status === 'active' ? 'active' : 'pending'),
                'consent_given' => $row->approved_at !== null,
                'created_at' => $row->created_at,
                'expires_at' => null,
            ])
            ->all();
    }

    /** Live (not staff-revoked) arrangements in the tenant — dashboard stat. */
    public function activeCount(int $tenantId): int
    {
        return (int) DB::table('account_relationships')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('proposed_by_user_id')
            ->where('status', '!=', 'revoked')
            ->count();
    }

    /** Arrangements the member has agreed to — dashboard stat. */
    public function consentedCount(int $tenantId): int
    {
        return (int) DB::table('account_relationships')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('proposed_by_user_id')
            ->where('status', 'active')
            ->count();
    }

    private function normaliseReason(?string $reason): ?string
    {
        if ($reason === null) return null;
        $trimmed = trim($reason);
        return $trimmed === '' ? null : mb_substr($trimmed, 0, 500);
    }

    private function stateMatchesAction(string $state, string $action): bool
    {
        return ($state === 'consented' && $action === self::ACTION_CONSENTED)
            || ($state === 'declined' && $action === self::ACTION_DECLINED)
            || ($state === 'withdrawn' && $action === self::ACTION_WITHDRAWN);
    }

    /** Append to account_relationship_events (append-only, trigger-enforced). */
    private function event(
        int $tenantId,
        int $relationshipId,
        int $guardianUserId,
        int $wardUserId,
        string $action,
        string $actorRole,
        ?int $actorUserId,
        ?string $reason = null,
        ?string $ip = null,
        ?string $userAgent = null,
        ?array $details = null,
    ): void {
        DB::table('account_relationship_events')->insert([
            'tenant_id'       => $tenantId,
            'relationship_id' => $relationshipId,
            'parent_user_id'  => $guardianUserId,
            'child_user_id'   => $wardUserId,
            'action'          => $action,
            'actor_role'      => $actorRole,
            'actor_user_id'   => $actorUserId,
            'reason'          => $reason,
            'details'         => $details !== null ? json_encode($details) : null,
            'ip_address'      => $ip ?? request()?->ip(),
            'user_agent'      => mb_substr((string) ($userAgent ?? request()?->userAgent() ?? ''), 0, 255) ?: null,
            'created_at'      => now(),
        ]);
    }

    /**
     * Tell the guardian what they may now do. A change to someone's powers
     * that they only discover by trying is a poor way to run a support
     * relationship — and if the member did not mean to grant it, the notice
     * is how it comes to light. Rendered in the guardian's own language.
     */
    private function notifyGuardianOfTierChange(int $tenantId, int $guardianUserId, int $wardId): void
    {
        try {
            $guardian = User::where('id', $guardianUserId)->where('tenant_id', $tenantId)->first();
            if (! $guardian) {
                return;
            }

            $ward = User::where('id', $wardId)->where('tenant_id', $tenantId)->first();
            $wardName = $ward?->name ?: __('api_controllers_1.admin_safeguarding.a_member');

            LocaleContext::withLocale($guardian, function () use ($tenantId, $guardianUserId, $wardName): void {
                Notification::create([
                    'tenant_id' => $tenantId,
                    'user_id'   => $guardianUserId,
                    'type'      => 'safeguarding_assignment',
                    'message'   => __('api.safeguarding_guardian_tiers_changed_notification', ['name' => $wardName]),
                    'link'      => SubAccountService::LINKED_ACCOUNTS_LINK,
                    'is_read'   => false,
                ]);
            });
        } catch (\Throwable $e) {
            Log::warning('[GuardianArrangement] tier-change notification failed: ' . $e->getMessage(), [
                'guardian_user_id' => $guardianUserId,
            ]);
        }
    }

    /**
     * Tell the staff member who proposed the arrangement, and the guardian.
     *
     * Swallowed on failure: a notification problem must not roll back the
     * member's recorded decision. Logged at warning so the failure is visible.
     */
    private function notifyStaff(int $tenantId, object $row, int $wardId, string $action, ?string $reason): void
    {
        try {
            $ward = User::where('id', $wardId)->where('tenant_id', $tenantId)->first();
            $wardName = $ward?->name ?: __('api_controllers_1.admin_safeguarding.a_member');

            // 🔴 Deliberately in the gated-and-tooled `api` namespace — see the
            // lang/**/*.json coverage note in the git history of this file.
            $key = "api.safeguarding_ward_{$action}_notification";
            $recipients = array_unique(array_filter([
                $row->proposed_by_user_id !== null ? (int) $row->proposed_by_user_id : null,
                (int) $row->parent_user_id,
            ]));

            foreach ($recipients as $recipientId) {
                $recipient = User::where('id', $recipientId)->where('tenant_id', $tenantId)->first();
                if (! $recipient) continue;

                // Each recipient's own language — the subject and body must not
                // inherit the member's locale.
                LocaleContext::withLocale($recipient, function () use ($tenantId, $recipientId, $key, $wardName): void {
                    Notification::create([
                        'tenant_id' => $tenantId,
                        'user_id'   => $recipientId,
                        'type'      => 'safeguarding_assignment',
                        'message'   => __($key, ['name' => $wardName]),
                        'link'      => '/admin/safeguarding',
                        'is_read'   => false,
                    ]);
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[GuardianArrangement] staff notification failed: ' . $e->getMessage(), [
                'assignment_id' => $row->id ?? null,
                'action'        => $action,
            ]);
        }
    }
}
