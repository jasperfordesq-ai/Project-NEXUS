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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * A ward's own responses to a guardian arrangement: agree, refuse, withdraw.
 *
 * 🔴 Why this class exists rather than more methods on SafeguardingService.
 *
 * `safeguarding_assignments` shipped with one ward-facing column,
 * `consent_given_at`, so the only thing a ward could do was agree. There was no
 * refusal and no withdrawal — `revoked_at` is staff-only. A consent that cannot
 * be refused is not consent, and one that cannot be withdrawn fails the ordinary
 * expectation that withdrawing is as easy as giving. All three responses are now
 * one operation with one transition table, because they must share the audit
 * write and the staff notification or they will drift apart.
 *
 * Deliberate design choices:
 *
 *  - **Only the ward.** Every query is scoped by `ward_user_id = $wardId`. A
 *    guardian cannot respond on the subject's behalf; that would make the record
 *    worthless. Covered by tests.
 *  - **Reason is never mandatory.** Requiring someone to justify refusing a
 *    safeguarding arrangement is a pressure to consent. It is offered, and stored
 *    if given.
 *  - **The row states the current position; the events table states the story.**
 *    Each transition clears the other two timestamps, so the row is never
 *    ambiguous, and every change appends to `safeguarding_assignment_events`,
 *    which the database itself refuses to let anyone update or delete.
 *  - **Staff are told.** A ward refusing or withdrawing is a safeguarding signal.
 *    Silence would make the feature worse than useless. Notifications render in
 *    each recipient's own language via LocaleContext.
 *
 * 🔴 `SafeguardingService::recordConsent()` is superseded for these paths. Note
 * it updates EVERY unconsented assignment for the ward when no id is passed, and
 * returns `true` even when zero rows changed — do not reuse it here.
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

    /** Current position of an assignment row, from its three timestamps. */
    public static function stateOf(object $row): string
    {
        if (($row->consent_withdrawn_at ?? null) !== null) return 'withdrawn';
        if (($row->consent_declined_at ?? null) !== null) return 'declined';
        if (($row->consent_given_at ?? null) !== null) return 'consented';
        return 'pending';
    }

    /**
     * Record a ward's response.
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
            // Locked so two tabs cannot both transition the same row.
            $row = DB::table('safeguarding_assignments')
                ->where('id', $assignmentId)
                ->where('tenant_id', $tenantId)
                ->where('ward_user_id', $wardId)
                ->whereNull('revoked_at')
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
            DB::table('safeguarding_assignments')
                ->where('id', $assignmentId)
                ->update([
                    'consent_given_at'     => $action === self::ACTION_CONSENTED ? $now : null,
                    'consent_declined_at'  => $action === self::ACTION_DECLINED ? $now : null,
                    'consent_withdrawn_at' => $action === self::ACTION_WITHDRAWN ? $now : null,
                    'ward_response_reason' => $reason,
                ]);

            // Append-only; BEFORE UPDATE/DELETE triggers enforce it in the DB.
            DB::table('safeguarding_assignment_events')->insert([
                'tenant_id'        => $tenantId,
                'assignment_id'    => $assignmentId,
                'ward_user_id'     => $wardId,
                'guardian_user_id' => (int) $row->guardian_user_id,
                'action'           => $action,
                'actor_role'       => 'ward',
                'actor_user_id'    => $wardId,
                'reason'           => $reason,
                'ip_address'       => $ip,
                'user_agent'       => $userAgent !== null ? mb_substr($userAgent, 0, 255) : null,
                'created_at'       => $now,
            ]);

            $newState = $action === self::ACTION_CONSENTED ? 'consented'
                : ($action === self::ACTION_DECLINED ? 'declined' : 'withdrawn');

            // Outside the ward's control path but inside the transaction is
            // wrong for mail; notifications here are DB rows only, so it is safe
            // and keeps them from being lost if the update rolls back.
            $this->notifyStaff($tenantId, $row, $wardId, $action, $reason);

            return ['ok' => true, 'code' => null, 'state' => $newState, 'already' => false];
        }, 3);
    }

    /**
     * The arrangements recorded against a ward, for their own settings screen.
     *
     * @return list<array<string,mixed>>
     */
    public function forWard(int $wardId, int $tenantId): array
    {
        return DB::table('safeguarding_assignments as sa')
            ->join('users as g', 'g.id', '=', 'sa.guardian_user_id')
            ->where('sa.tenant_id', $tenantId)
            ->where('sa.ward_user_id', $wardId)
            ->whereNull('sa.revoked_at')
            ->orderByDesc('sa.assigned_at')
            ->select([
                'sa.id', 'sa.assigned_at', 'sa.consent_given_at', 'sa.consent_declined_at',
                'sa.consent_withdrawn_at', 'sa.ward_response_reason', 'sa.notes',
                'g.first_name', 'g.last_name',
            ])
            ->get()
            ->map(fn ($r) => [
                'id'                   => (int) $r->id,
                'guardian_name'        => trim(($r->first_name ?? '') . ' ' . ($r->last_name ?? '')),
                'assigned_at'          => $r->assigned_at,
                'consent_given_at'     => $r->consent_given_at,
                'consent_declined_at'  => $r->consent_declined_at,
                'consent_withdrawn_at' => $r->consent_withdrawn_at,
                'ward_response_reason' => $r->ward_response_reason,
                'state'                => self::stateOf($r),
                'consent_given'        => $r->consent_given_at !== null,
                'notes'                => $r->notes,
            ])
            ->all();
    }

    /**
     * The people a guardian has been made responsible for.
     *
     * 🔴 The guardian could previously see nothing at all: they were emailed that
     * an arrangement existed and had no screen for it, so half the relationship
     * was invisible. Names and the ward's own position only — a guardian learning
     * that someone has refused is the point; their contact details are not.
     *
     * @return list<array<string,mixed>>
     */
    public function forGuardian(int $guardianId, int $tenantId): array
    {
        return DB::table('safeguarding_assignments as sa')
            ->join('users as w', 'w.id', '=', 'sa.ward_user_id')
            ->where('sa.tenant_id', $tenantId)
            ->where('sa.guardian_user_id', $guardianId)
            ->whereNull('sa.revoked_at')
            ->orderByDesc('sa.assigned_at')
            ->select([
                'sa.id', 'sa.assigned_at', 'sa.consent_given_at', 'sa.consent_declined_at',
                'sa.consent_withdrawn_at', 'w.first_name', 'w.last_name',
            ])
            ->get()
            ->map(fn ($r) => [
                'id'          => (int) $r->id,
                'ward_name'   => trim(($r->first_name ?? '') . ' ' . ($r->last_name ?? '')),
                'assigned_at' => $r->assigned_at,
                'state'       => self::stateOf($r),
            ])
            ->all();
    }

    /**
     * How many arrangements are still awaiting this ward's response.
     *
     * Drives the prompt that tells a member there is something to decide. Without
     * it the only route in was an email, or knowing to look in Settings.
     */
    public function pendingCountForWard(int $wardId, int $tenantId): int
    {
        return (int) DB::table('safeguarding_assignments')
            ->where('tenant_id', $tenantId)
            ->where('ward_user_id', $wardId)
            ->whereNull('revoked_at')
            ->whereNull('consent_given_at')
            ->whereNull('consent_declined_at')
            ->whereNull('consent_withdrawn_at')
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

    /**
     * Tell the staff member who created the arrangement, and the guardian.
     *
     * Swallowed on failure: a notification problem must not roll back the ward's
     * recorded decision. It is logged at warning so the failure is visible.
     */
    private function notifyStaff(int $tenantId, object $row, int $wardId, string $action, ?string $reason): void
    {
        try {
            $ward = User::where('id', $wardId)->where('tenant_id', $tenantId)->first();
            $wardName = $ward?->name ?: __('api_controllers_1.admin_safeguarding.a_member');

            /*
             * 🔴 Deliberately in the `api` namespace, not `api_controllers_1`
             * where the sibling "guardian assigned" notification lives.
             * `api_controllers_1` exists only as lang/<locale>/*.json, and
             * lang/**\/*.json is covered by NO gate: check-i18n-drift.mjs scans
             * only react-frontend/public/locales, while the php-lang parity and
             * untranslated gates scan only lang/**\/*.php. There is also no
             * translator for it — translate-php-lang-gaps.mjs refuses anything
             * that is not a .php namespace. Since `__()` reads the JSON file
             * FIRST, a missing key there renders the raw key path to the user
             * with nothing to catch it. `api.php` is gated and tooled.
             */
            $key = "api.safeguarding_ward_{$action}_notification";
            $recipients = array_unique(array_filter([
                $row->assigned_by !== null ? (int) $row->assigned_by : null,
                (int) $row->guardian_user_id,
            ]));

            foreach ($recipients as $recipientId) {
                $recipient = User::where('id', $recipientId)->where('tenant_id', $tenantId)->first();
                if (! $recipient) continue;

                // Each recipient's own language — the subject and body must not
                // inherit the ward's locale.
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
