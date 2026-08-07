<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\AccountRelationship;
use App\Support\Safeguarding\SupportTiers;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * SubAccountService — Laravel DI-based service for family/guardian accounts.
 *
 * Manages parent-child account relationships with permission controls.
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class SubAccountService
{
    public const RELATIONSHIP_TYPES = ['family', 'guardian', 'carer', 'organization'];

    /**
     * 🔴 THREE of these are enforced. `can_view_messages` is NOT, and is no
     * longer offered by either frontend (2026-08-05).
     *
     * Since phase 2 of the guardian redesign these booleans are SHORTHAND over
     * the three-tier model in {@see \App\Support\Safeguarding\SupportTiers}
     * (assist / co_decide / represent, per capability). Enforcement translates
     * each key to its capability + minimum tier; rows written by
     * updatePermissions() store both representations, kept in sync.
     *
     * | key                 | enforced as          | where                        |
     * |---------------------|----------------------|------------------------------|
     * | can_view_activity   | activity ≥ assist    | getChildActivitySummary()    |
     * | can_manage_listings | listings ≥ represent | createListingForChild()      |
     * | can_transact        | credits ≥ represent  | transferForChild()           |
     * | can_view_messages   | NOTHING, at any tier | hasPermission() hard-false   |
     *
     * It stays in this list only so historical rows that already stored it
     * continue to parse, and because the permissions endpoint still accepts it
     * for backward compatibility. Both UIs deliberately stopped rendering it:
     * they showed a switch labelled "View their messages" that saved
     * successfully and did nothing, so a family could be told a carer could read
     * a dependent's conversations. The `account_relationships.permissions`
     * column comment lists only the first three — the fourth reached the UIs and
     * never the schema.
     *
     * Do NOT wire it up without building the counterparty notice first. Letting
     * a carer read a dependent's messages exposes the OTHER party to that
     * conversation, who never agreed to it. The established pattern is to notify
     * — see BrokerMessageVisibilityService::getUserRestrictionStatus()'s
     * `review_notice_required`.
     */
    public const DEFAULT_PERMISSIONS = [
        'can_view_activity'   => true,
        'can_manage_listings' => false,
        'can_transact'        => false,
        'can_view_messages'   => false,
    ];

    /** Maximum number of child accounts a parent can have */
    public const MAX_CHILDREN = 20;

    /**
     * Deep link for every linked-account notification.
     *
     * 🔴 The `?tab=linked-accounts` query string is load-bearing. Plain
     * `/settings` opens the Profile tab, so a member who followed the bell
     * notification landed on a page of ten tabs with no indication which one
     * held the request waiting for them — reported by the owner 2026-08-06.
     * `SETTINGS_TABS` in react-frontend/src/pages/settings/SettingsPage.tsx is
     * the authority for this value; the accessible frontend has its own page at
     * /{tenantSlug}/accessible/settings/linked-accounts and does not use this.
     */
    public const LINKED_ACCOUNTS_LINK = '/settings?tab=linked-accounts';

    private array $errors = [];

    public function __construct(
        private readonly AccountRelationship $relationship,
        private readonly MemberActivityService $activityService,
    ) {}

    /**
     * Get validation errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Clamp a relationship type to a known value so it can be used to build a
     * translation key. Unknown values fall back to 'family' rather than
     * producing a missing-key string in a member-facing notification.
     */
    public static function normalizeRelationshipType(?string $type): string
    {
        return in_array($type, self::RELATIONSHIP_TYPES, true) ? (string) $type : 'family';
    }

    /**
     * Get child accounts linked to a parent user.
     */
    public function getChildren(int $parentUserId): array
    {
        return $this->relationship->newQuery()
            ->with('childUser:id,first_name,last_name,email,avatar_url')
            ->where('parent_user_id', $parentUserId)
            ->where('status', 'active')
            // Staff-proposed guardian arrangements (phase 5) live in this
            // table too but belong to the SAFEGUARDING screens, not the
            // linked-accounts ones — showing them here would double-display
            // and blur who created what.
            ->whereNull('proposed_by_user_id')
            ->orderByDesc('created_at')
            ->get()
            ->map(function (AccountRelationship $rel) {
                $data = $rel->toArray();
                if ($rel->childUser) {
                    $data['first_name'] = $rel->childUser->first_name;
                    $data['last_name'] = $rel->childUser->last_name;
                    $data['email'] = $rel->childUser->email;
                    $data['avatar_url'] = $rel->childUser->avatar_url;
                }
                return $data;
            })
            ->all();
    }

    /**
     * Get child accounts managed by a parent user (with relationship details).
     */
    public function getChildAccounts(int $parentUserId): array
    {
        return $this->relationship->newQuery()
            ->join('users as u', 'account_relationships.child_user_id', '=', 'u.id')
            ->where('account_relationships.parent_user_id', $parentUserId)
            ->whereIn('account_relationships.status', ['active', 'pending'])
            ->select(
                'account_relationships.id as relationship_id',
                'account_relationships.relationship_type',
                'account_relationships.permissions',
                'account_relationships.status',
                'account_relationships.proposed_by_user_id',
                'account_relationships.approved_at',
                'account_relationships.created_at',
                'u.id as user_id',
                'u.first_name',
                'u.last_name',
                'u.avatar_url',
                'u.email'
            )
            ->orderByDesc('account_relationships.created_at')
            ->get()
            ->map(fn ($r) => $r->toArray())
            // Staff-recorded arrangements belong to the safeguarding screens —
            // EXCEPT once the supported member has granted a real tier on one
            // (GuardianArrangementService::setTiers). Then the guardian needs
            // somewhere to USE it, and this is the screen that prepares
            // listings and transfers. Those rows carry `staff_recorded` so the
            // UI shows the grant read-only: the guardian may act on it, and
            // may never re-grant it to themselves.
            ->filter(function (array $row): bool {
                if (($row['proposed_by_user_id'] ?? null) === null) {
                    return true;
                }
                $tiers = SupportTiers::resolve($row['permissions'] ?? []);

                return $tiers !== SupportTiers::noneGranted();
            })
            ->map(function (array $row): array {
                $row['staff_recorded'] = ($row['proposed_by_user_id'] ?? null) !== null;
                unset($row['proposed_by_user_id']);

                return $row;
            })
            ->values()
            ->all();
    }

    /**
     * Get parent accounts that manage this user.
     */
    public function getParentAccounts(int $childUserId): array
    {
        return $this->relationship->newQuery()
            ->join('users as u', 'account_relationships.parent_user_id', '=', 'u.id')
            ->where('account_relationships.child_user_id', $childUserId)
            ->whereIn('account_relationships.status', ['active', 'pending'])
            // Staff-proposed arrangements belong to the safeguarding screens.
            ->whereNull('account_relationships.proposed_by_user_id')
            ->select(
                'account_relationships.id as relationship_id',
                'account_relationships.relationship_type',
                'account_relationships.permissions',
                'account_relationships.status',
                'account_relationships.approved_at',
                'account_relationships.created_at',
                'u.id as user_id',
                'u.first_name',
                'u.last_name',
                'u.avatar_url',
                'u.email'
            )
            ->orderByDesc('account_relationships.created_at')
            ->get()
            ->map(fn ($r) => $r->toArray())
            ->all();
    }

    /**
     * Request a parent-child relationship.
     *
     * @return int|null Relationship ID or null on failure.
     */
    public function requestRelationship(int $parentUserId, int $childUserId, string $type = 'family', array $permissions = []): ?int
    {
        $this->errors = [];

        if ($parentUserId === $childUserId) {
            $this->errors[] = ['code' => 'SELF_RELATIONSHIP', 'message' => __('api.subaccount_self_relationship')];
            return null;
        }

        if (! in_array($type, self::RELATIONSHIP_TYPES, true)) {
            $this->errors[] = ['code' => 'INVALID_TYPE', 'message' => __('api.subaccount_invalid_type'), 'field' => 'relationship_type'];
            return null;
        }

        // Verify both users exist in same tenant
        $parent = User::query()->where('id', $parentUserId)->first();
        $child = User::query()->where('id', $childUserId)->first();

        if (! $parent || ! $child) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.user_not_found')];
            return null;
        }

        // Check for existing relationship
        $existing = $this->relationship->newQuery()
            ->where('parent_user_id', $parentUserId)
            ->where('child_user_id', $childUserId)
            ->first();

        if ($existing) {
            if ($existing->status === 'active') {
                $this->errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.subaccount_already_exists')];
                return $existing->id;
            }

            if ($existing->status === 'pending') {
                $this->errors[] = ['code' => 'PENDING', 'message' => __('api.subaccount_request_pending')];
                return $existing->id;
            }

            // If revoked, allow re-request
            $this->assertRelationshipContactsAllowed(
                $parentUserId,
                $childUserId,
                'sub_account_request',
            );

            $existing->update([
                'status'            => 'pending',
                'relationship_type' => $type,
                'permissions'       => array_merge(self::DEFAULT_PERMISSIONS, $permissions),
                'approved_at'       => null,
            ]);

            return $existing->id;
        }

        // Prevent circular: child cannot also be parent of the requester
        $circular = $this->relationship->newQuery()
            ->where('parent_user_id', $childUserId)
            ->where('child_user_id', $parentUserId)
            ->whereIn('status', ['active', 'pending'])
            ->exists();

        if ($circular) {
            $this->errors[] = ['code' => 'CIRCULAR', 'message' => __('api.subaccount_circular')];
            return null;
        }

        // Prevent infinite nesting: a child account cannot also be a parent of other accounts
        $childIsParent = $this->relationship->newQuery()
            ->where('parent_user_id', $childUserId)
            ->whereIn('status', ['active', 'pending'])
            ->exists();

        if ($childIsParent) {
            $this->errors[] = ['code' => 'NESTING_NOT_ALLOWED', 'message' => __('api.subaccount_child_is_parent')];
            return null;
        }

        // Prevent a user who is already a child from becoming a parent
        $parentIsChild = $this->relationship->newQuery()
            ->where('child_user_id', $parentUserId)
            ->whereIn('status', ['active', 'pending'])
            ->exists();

        if ($parentIsChild) {
            $this->errors[] = ['code' => 'NESTING_NOT_ALLOWED', 'message' => __('api.subaccount_parent_is_child')];
            return null;
        }

        // Enforce maximum children limit
        $currentChildCount = $this->relationship->newQuery()
            ->where('parent_user_id', $parentUserId)
            ->whereIn('status', ['active', 'pending'])
            ->count();

        if ($currentChildCount >= self::MAX_CHILDREN) {
            $this->errors[] = ['code' => 'LIMIT_REACHED', 'message' => __('api.subaccount_limit_reached', ['max' => self::MAX_CHILDREN])];
            return null;
        }

        $mergedPermissions = array_merge(self::DEFAULT_PERMISSIONS, $permissions);

        // The pending row exposes the requested permissions and notifies the
        // child, so the protected-contact decision must happen before either
        // write. A linked account is inherently two-way even though the parent
        // initiates it.
        $this->assertRelationshipContactsAllowed(
            $parentUserId,
            $childUserId,
            'sub_account_request',
        );

        $rel = $this->relationship->newInstance([
            'tenant_id'         => TenantContext::getId(),
            'parent_user_id'    => $parentUserId,
            'child_user_id'     => $childUserId,
            'relationship_type' => $type,
            'permissions'       => $mergedPermissions,
            'status'            => 'pending',
        ]);
        $rel->save();

        // Notify the child user in their preferred_language so the bell is
        // readable to them rather than rendered in the parent's locale.
        //
        // 🔴 This goes through NotificationDispatcher, NOT Notification::create.
        // Until 2026-08-06 it wrote the bell row directly, so the person being
        // asked to hand over control of their account got a bell entry and
        // NOTHING else — no email, no push — because nothing observes that
        // table. The dispatcher is the only path that also reaches the email
        // queue and the push fan-out. Both sub-account activity types are listed
        // in NotificationDispatcher's $criticalInstantTypes so the email goes out
        // immediately instead of waiting for a digest the member has not opted
        // into (the digest default is 'off').
        try {
            $parentName = trim($parent->first_name . ' ' . $parent->last_name);
            $child = User::find($childUserId);

            LocaleContext::withLocale($child, function () use ($childUserId, $parentUserId, $parentName, $type) {
                // The bell text interpolates a HUMAN label, not the raw enum
                // value. It used to pass $type straight through, so the German
                // bell read "… als organization" — an untranslated code word in
                // the middle of a translated sentence.
                $typeLabel = __('emails_notifications.sub_account.type_' . self::normalizeRelationshipType($type));

                NotificationDispatcher::dispatch(
                    $childUserId,
                    'global',
                    0,
                    'sub_account_request',
                    __('svc_notifications.sub_account.management_request', ['name' => $parentName, 'type' => $typeLabel]),
                    self::LINKED_ACCOUNTS_LINK,
                    NotificationDispatcher::buildSubAccountRequestEmail($parentName, $type),
                    // 🔴 No actor id on purpose. Passing one makes the dispatcher
                    // apply the recipient's mute list, which would silently drop
                    // the notice — recreating the exact silent-pending-row
                    // problem this change fixes. There is no abuse channel to
                    // guard against: the text is fully templated, the requester
                    // supplies no free text, and nothing happens to the account
                    // until the recipient accepts.
                );
            });
        } catch (\Throwable $e) {
            Log::warning('SubAccountService::requestRelationship notification failed', [
                'parent_user_id' => $parentUserId,
                'child_user_id'  => $childUserId,
                'error'          => $e->getMessage(),
            ]);
        }

        $this->relationshipEvent($rel, 'requested', 'member', $parentUserId);

        return $rel->id;
    }

    /**
     * Approve a pending relationship request.
     */
    public function approve(int $relationshipId, int $childUserId): bool
    {
        $this->errors = [];

        /** @var AccountRelationship|null $pending */
        $pending = $this->relationship->newQuery()
            ->where('id', $relationshipId)
            ->where('child_user_id', $childUserId)
            ->where('status', 'pending')
            // Staff-proposed arrangements are answered through the safeguarding
            // respond flow (GuardianArrangementService) — approving one here
            // would bypass its transition table, events and staff notification.
            ->whereNull('proposed_by_user_id')
            ->first();

        if (! $pending) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.subaccount_relationship_not_found')];
            return false;
        }

        // Re-evaluate the relationship and its already-stored requested
        // permissions at approval time; a request-time decision may now be
        // stale. Denial leaves the pending row untouched so it can be revoked.
        $this->assertRelationshipContactsAllowed(
            (int) $pending->parent_user_id,
            $childUserId,
            'sub_account_approval',
        );

        $approved = $this->relationship->newQuery()
            ->where('id', $relationshipId)
            ->where('child_user_id', $childUserId)
            ->where('status', 'pending')
            ->update([
                'status'      => 'active',
                'approved_at' => now(),
                'updated_at'  => now(),
            ]) > 0;

        if (! $approved) {
            return false;
        }

        $this->relationshipEvent($pending, 'approved', 'member', $childUserId);

        // Tell the requester their request was accepted. Until 2026-08-06 the
        // approval was silent in every channel: the person who asked had no way
        // to learn the answer except by revisiting the settings tab and noticing
        // the status had changed. Rendered in the RECIPIENT's language — the
        // approving member's locale is the active one at this point.
        $parentUserId = (int) $pending->parent_user_id;

        try {
            $child = User::find($childUserId);
            $parent = User::find($parentUserId);
            $childName = $child !== null
                ? trim($child->first_name . ' ' . $child->last_name)
                : '';

            if ($parent !== null) {
                LocaleContext::withLocale($parent, function () use ($parentUserId, $childName) {
                    NotificationDispatcher::dispatch(
                        $parentUserId,
                        'global',
                        0,
                        'sub_account_approved',
                        __('svc_notifications.sub_account.request_approved', ['name' => $childName]),
                        self::LINKED_ACCOUNTS_LINK,
                        NotificationDispatcher::buildSubAccountApprovedEmail($childName),
                        // No actor id — see the note on the request notification
                        // above. The answer to a request must always arrive.
                    );
                });
            }
        } catch (\Throwable $e) {
            Log::warning('SubAccountService::approve notification failed', [
                'relationship_id' => $relationshipId,
                'parent_user_id'  => $parentUserId,
                'child_user_id'   => $childUserId,
                'error'           => $e->getMessage(),
            ]);
        }

        return true;
    }

    /**
     * Approve a pending relationship request (alias).
     */
    public function approveRelationship(int $childUserId, int $relationshipId): bool
    {
        return $this->approve($relationshipId, $childUserId);
    }

    /**
     * Revoke an active relationship.
     */
    public function revoke(int $relationshipId, int $userId): bool
    {
        /** @var AccountRelationship|null $row */
        $row = $this->relationship->newQuery()
            ->where('id', $relationshipId)
            ->where(fn (Builder $q) => $q->where('parent_user_id', $userId)->orWhere('child_user_id', $userId))
            // Staff-proposed arrangements end through the safeguarding flows:
            // the member withdraws via GuardianArrangementService::respond,
            // staff revoke via the admin endpoint.
            ->whereNull('proposed_by_user_id')
            ->first();

        if (! $row) {
            return false;
        }

        $revoked = $this->relationship->newQuery()
            ->where('id', $relationshipId)
            ->update([
                'status'     => 'revoked',
                'updated_at' => now(),
            ]) > 0;

        if ($revoked) {
            $this->relationshipEvent($row, 'revoked', 'member', $userId);

            // Tell the OTHER party. Until 2026-08-07 revocation was silent in
            // every channel — the other member learned by absence, which for a
            // supported member could mean their helper quietly vanished, and
            // for a helper that their access ended without a word. Standard
            // (non-instant) delivery: informative, not action-required.
            $otherUserId = (int) ($userId === (int) $row->parent_user_id
                ? $row->child_user_id
                : $row->parent_user_id);

            try {
                $actor = User::find($userId);
                $other = User::find($otherUserId);
                $actorName = $actor !== null ? trim($actor->first_name . ' ' . $actor->last_name) : '';

                LocaleContext::withLocale($other, function () use ($otherUserId, $actorName) {
                    NotificationDispatcher::dispatch(
                        $otherUserId,
                        'global',
                        0,
                        'sub_account_revoked',
                        __('svc_notifications.sub_account.link_revoked_bell', ['name' => $actorName]),
                        self::LINKED_ACCOUNTS_LINK,
                        null,
                    );
                });
            } catch (\Throwable $e) {
                Log::warning('SubAccountService::revoke notification failed', [
                    'relationship_id' => $relationshipId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $revoked;
    }

    /**
     * Revoke a relationship (alias).
     */
    public function revokeRelationship(int $userId, int $relationshipId): bool
    {
        return $this->revoke($relationshipId, $userId);
    }

    /**
     * Update permissions for a relationship (parent only).
     *
     * Accepts both grant vocabularies and stores one canonical shape:
     *
     * - Legacy boolean keys (`can_view_activity`…) — what both frontends still
     *   send. A boolean is applied only when it CHANGES what that boolean has
     *   always meant, so a client re-sending an unchanged `true` cannot
     *   silently coarsen a finer-grained tier (e.g. a stored `co_decide`
     *   projects to `false`; re-sending `false` is a no-op, not a downgrade).
     * - An explicit `tiers` object (`{"listings": "co_decide"}`), which wins
     *   over the boolean shorthand. Unknown capabilities and invalid tier
     *   values are dropped by sanitisation — absent means unchanged, never
     *   reset.
     *
     * The stored row is always `toLegacyBooleans(tiers) + ['tiers' => tiers]`,
     * so every pre-tier reader keeps working and the two representations can
     * never disagree. Shrinking any tier remains a safe unilateral exit;
     * RAISING any tier re-asserts the safeguarding contact policy first.
     */
    public function updatePermissions(int $parentUserId, int $relationshipId, array $permissions): bool
    {
        $this->errors = [];

        /** @var AccountRelationship|null $existing */
        $existing = $this->relationship->newQuery()
            ->where('id', $relationshipId)
            ->where('parent_user_id', $parentUserId)
            ->where('status', 'active')
            // A guardian must not grant THEMSELVES tiers on a staff-proposed
            // arrangement — those stay tier 0 until a deliberate product
            // decision gives the supported member a grant flow for them.
            ->whereNull('proposed_by_user_id')
            ->first();

        if (! $existing) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.subaccount_relationship_not_found')];
            return false;
        }

        $currentPermissions = is_array($existing->permissions) ? $existing->permissions : [];
        $beforeTiers = SupportTiers::resolve($currentPermissions);
        $afterTiers = $beforeTiers;

        // Boolean shorthand: apply only actual changes (see docblock).
        $projected = SupportTiers::toLegacyBooleans($beforeTiers);
        foreach ($permissions as $legacyKey => $enabled) {
            $requirement = SupportTiers::legacyRequirement((string) $legacyKey);
            if ($requirement === null) {
                continue; // can_view_messages, 'tiers', unknown keys
            }
            [$capability, $grantedTier] = $requirement;
            if ((bool) $enabled === ($projected[$legacyKey] ?? false)) {
                continue;
            }

            // 🔴 Boolean `true` means "on", never "maximum power". A boolean-only
            // client (the mobile app, any legacy caller) renders a `co_decide`
            // grant as an OFF toggle, because toLegacyBooleans projects
            // co_decide → false. Without this guard, a member "turning on" what
            // looked like an off switch replaced their prepare-only arrangement
            // with act-alone authority — a silent escalation of the exact power
            // the middle tier exists to withhold. If the capability already
            // holds ANY deliberate level, boolean true keeps it. `false` still
            // means none: switching off is always honoured.
            if ($enabled && $beforeTiers[$capability] !== SupportTiers::NONE) {
                continue;
            }

            $afterTiers[$capability] = $enabled ? $grantedTier : SupportTiers::NONE;
        }

        // Explicit tier grants win over the boolean shorthand.
        foreach (SupportTiers::sanitizeTiers($permissions['tiers'] ?? null) as $capability => $tier) {
            $afterTiers[$capability] = $tier;
        }

        // Shrinking remains a safe exit. Raising any tier can expose new
        // activity, listing, or transaction capabilities, so re-check the
        // relationship against the safeguarding contact policy before writing.
        if (SupportTiers::isExpansion($beforeTiers, $afterTiers)) {
            $this->assertRelationshipContactsAllowed(
                $parentUserId,
                (int) $existing->child_user_id,
                'sub_account_permission_expansion',
            );
        }

        $existing->update([
            'permissions' => SupportTiers::toLegacyBooleans($afterTiers) + ['tiers' => $afterTiers],
        ]);

        if ($afterTiers !== $beforeTiers) {
            $this->relationshipEvent($existing, 'permissions_changed', 'member', $parentUserId, null, [
                'tiers_before' => $beforeTiers,
                'tiers_after' => $afterTiers,
            ]);

            // Tell the supported member their supporter's levels changed. The
            // guardian path has always done this (GuardianArrangementService
            // notifies on tier changes); the member-link path was silent —
            // asymmetric, and the member is the one the levels are ABOUT. An
            // expansion goes instant (someone's power over your account grew);
            // a shrink is informative bell-level news.
            try {
                $parent = User::find($parentUserId);
                $child = User::find((int) $existing->child_user_id);
                $parentName = $parent !== null ? trim($parent->first_name . ' ' . $parent->last_name) : '';
                $expanded = SupportTiers::isExpansion($beforeTiers, $afterTiers);

                LocaleContext::withLocale($child, function () use ($existing, $parentName, $expanded) {
                    NotificationDispatcher::dispatch(
                        (int) $existing->child_user_id,
                        'global',
                        0,
                        $expanded ? 'sub_account_permissions_expanded' : 'sub_account_permissions_changed',
                        __($expanded
                            ? 'svc_notifications.sub_account.permissions_expanded_bell'
                            : 'svc_notifications.sub_account.permissions_changed_bell', ['name' => $parentName]),
                        self::LINKED_ACCOUNTS_LINK,
                        null,
                    );
                });
            } catch (\Throwable $e) {
                Log::warning('SubAccountService::updatePermissions notification failed', [
                    'relationship_id' => $relationshipId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return true;
    }

    /**
     * Check if a parent has a specific permission for a child.
     *
     * Since the three-tier model (phase 2 of the guardian redesign), the
     * boolean key is translated to its capability + minimum tier and checked
     * against the relationship's resolved tiers. For rows that predate tiers
     * the resolution derives from the stored booleans, so behaviour for the
     * three real permissions is unchanged. Two deliberate deltas:
     *
     * - `can_view_messages` now returns false even when an old row stored it
     *   true. It never had a caller and confers no capability at any tier.
     * - A `co_decide` grant does NOT satisfy these checks: the boolean keys
     *   mean "may act alone" (or "may view", for activity), and every caller
     *   of this method performs an immediate action or read. The co-decide
     *   prepare-and-confirm path (phase 3) will have its own gate.
     */
    public function hasPermission(int $parentUserId, int $childUserId, string $permission): bool
    {
        /** @var AccountRelationship|null $row */
        $row = $this->relationship->newQuery()
            ->where('parent_user_id', $parentUserId)
            ->where('child_user_id', $childUserId)
            ->where('status', 'active')
            ->first();

        if (! $row) {
            return false;
        }

        $requirement = SupportTiers::legacyRequirement($permission);
        if ($requirement === null) {
            return false;
        }

        [$capability, $requiredTier] = $requirement;
        $tiers = SupportTiers::resolve(is_array($row->permissions) ? $row->permissions : []);

        return SupportTiers::atLeast($tiers, $capability, $requiredTier);
    }

    /**
     * The resolved support tiers a parent holds for a child, for callers that
     * need finer grain than the boolean shorthand (the phase-3 confirm loop
     * gates on `co_decide` through this). Null when no active relationship
     * exists — deliberately distinct from "a relationship with nothing
     * granted".
     *
     * @return array<string, string>|null capability => tier
     */
    public function resolvedTiers(int $parentUserId, int $childUserId): ?array
    {
        /** @var AccountRelationship|null $row */
        $row = $this->relationship->newQuery()
            ->where('parent_user_id', $parentUserId)
            ->where('child_user_id', $childUserId)
            ->where('status', 'active')
            ->first();

        if (! $row) {
            return null;
        }

        return SupportTiers::resolve(is_array($row->permissions) ? $row->permissions : []);
    }

    /**
     * Get activity summary for a child account (parent view).
     */
    public function getChildActivitySummary(int $parentUserId, int $childUserId): ?array
    {
        if (! $this->hasPermission($parentUserId, $childUserId, 'can_view_activity')) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.subaccount_no_activity_permission')];
            return null;
        }

        return $this->activityService->getDashboardData($childUserId);
    }

    /**
     * The supported member's spendable balance, for a supporter who may spend it.
     *
     * Gated on `can_transact`, NOT on `can_view_activity`: the balance is only
     * needed to decide how much can be sent, so the permission that grants it
     * is the one that permits sending. A supporter who may only look at
     * activity has no business reading the wallet.
     *
     * The prepare screen validates against this the way the member's own
     * transfer dialog validates against theirs; WalletService::transfer()
     * re-checks server-side regardless, so a stale figure here can only produce
     * a clear refusal, never an overdraft.
     *
     * @return array{balance: float}|null
     */
    public function getChildWalletSummary(int $parentUserId, int $childUserId): ?array
    {
        if (! $this->hasPermission($parentUserId, $childUserId, 'can_transact')) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return null;
        }

        $balance = User::query()
            ->where('id', $childUserId)
            ->where('tenant_id', TenantContext::getId())
            ->value('balance');

        if ($balance === null) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.user_not_found')];
            return null;
        }

        return ['balance' => (float) $balance];
    }

    /**
     * Post a listing on a dependent's behalf (`can_manage_listings`).
     *
     * The listing BELONGS to the dependent — it is their offer, and any exchange
     * that follows is theirs. `acting_user_id` records that the carer posted it.
     *
     * 🔴 Context, because this is the first real enforcement of these permissions.
     * `account_relationships` has offered `can_manage_listings`, `can_transact` and
     * `can_view_messages` for a long time, and both frontends show all three as
     * toggles with explicit labels ("Manage their listings", "Send and receive time
     * credits", "View their messages") — but `hasPermission()` had exactly one
     * caller in the whole codebase, for `can_view_activity`. Nothing checked the
     * other three, and there was no endpoint through which they could have been
     * checked. Families were being told a carer had powers the carer did not have.
     *
     * The safeguarding contact policy is re-asserted at use time, not just at
     * grant time: a relationship approved months ago must not keep working after a
     * safeguarding restriction lands on either party.
     *
     * @return int|null Listing id, or null with $this->errors populated.
     */
    public function createListingForChild(int $parentUserId, int $childUserId, array $data): ?int
    {
        if (! $this->hasPermission($parentUserId, $childUserId, 'can_manage_listings')) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return null;
        }

        try {
            $this->assertRelationshipContactsAllowed($parentUserId, $childUserId, 'subaccount_manage_listings');
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => $e->getMessage()];
            return null;
        }

        try {
            $listing = ListingService::create($childUserId, $data, $parentUserId);
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => $e->getMessage()];
            return null;
        }

        // Skill tags are part of the listing form, but the member-facing route
        // that saves them (PUT /v2/listings/{id}/tags) checks
        // ListingService::canModify(), which admits the owner or an admin and
        // refuses a carer. Applying them HERE keeps them inside the operation
        // whose authority was already established above, rather than widening
        // that ownership check for everyone. A tag failure must not undo a
        // listing that exists: log and carry on, exactly as the member's own
        // form does.
        $skillTags = $data['skill_tags'] ?? null;
        if (is_array($skillTags) && $skillTags !== []) {
            try {
                app(ListingSkillTagService::class)->setTags((int) $listing->id, $skillTags);
            } catch (\Throwable $e) {
                Log::warning('Failed to apply skill tags to proxy listing', [
                    'listing_id' => $listing->id,
                    'parent_user_id' => $parentUserId,
                    'child_user_id' => $childUserId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->auditProxyAction($parentUserId, $childUserId, 'subaccount_listing_created', [
            'listing_id' => $listing->id,
        ]);

        // The dependent is told, in their own language, that something was posted
        // in their name. A proxy action the owner never learns about is not
        // consent, it is substitution.
        $this->notifyChildOfProxyAction(
            $parentUserId,
            $childUserId,
            'sub_account_proxy_listing',
            'svc_notifications.sub_account.proxy_listing_bell',
            '/listings/' . $listing->id,
        );

        return (int) $listing->id;
    }

    /**
     * Attach a photo to a listing posted for a supported member.
     *
     * Mirrors ListingsController::uploadImage's validation exactly (same mime
     * allow-list, same ImageUploader call) so a supporter's upload is neither
     * more nor less permissive than the member's own. The extra check is
     * ownership: the listing must belong to THIS supported member, so an active
     * relationship cannot be turned into a way to alter arbitrary listings.
     *
     * @return string|null The stored image URL, or null with $this->errors set.
     */
    public function attachListingImageForChild(
        int $parentUserId,
        int $childUserId,
        int $listingId,
        mixed $file,
    ): ?string {
        $this->errors = [];

        if (! $this->hasPermission($parentUserId, $childUserId, 'can_manage_listings')) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return null;
        }

        try {
            $this->assertRelationshipContactsAllowed($parentUserId, $childUserId, 'subaccount_manage_listings');
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => $e->getMessage()];
            return null;
        }

        $listing = ListingService::getById($listingId);
        if (! $listing || (int) ($listing['user_id'] ?? 0) !== $childUserId) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.listing_not_found')];
            return null;
        }

        if (! $file || ! $file->isValid()) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.listing_no_image_uploaded')];
            return null;
        }

        if (! in_array($file->getMimeType(), ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.listing_image_invalid_type')];
            return null;
        }

        try {
            $imageUrl = \App\Core\ImageUploader::upload([
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ]);

            ListingService::update($listingId, ['image_url' => $imageUrl]);
        } catch (\Throwable $e) {
            Log::error('Proxy listing image upload failed', [
                'listing_id' => $listingId,
                'parent_user_id' => $parentUserId,
                'error' => $e->getMessage(),
            ]);
            $this->errors[] = ['code' => 'UPLOAD_FAILED', 'message' => __('api.listing_image_upload_failed')];
            return null;
        }

        $this->auditProxyAction($parentUserId, $childUserId, 'subaccount_listing_image_added', [
            'listing_id' => $listingId,
        ]);

        return $imageUrl;
    }

    /**
     * Send credits from a dependent's balance on their behalf (`can_transact`).
     *
     * Delegates to WalletService::transfer(), which already carries the transfer
     * cap, decimal-precision rule, safeguarding contact check, deterministic lock
     * ordering, over-spend guard and idempotency claim. Re-implementing any of that
     * here would be a second, weaker money path — the carer route must be exactly
     * as safe as the member's own, not similar to it.
     *
     * @return array<string,mixed>|null Formatted transaction, or null with errors.
     */
    public function transferForChild(int $parentUserId, int $childUserId, array $data): ?array
    {
        if (! $this->hasPermission($parentUserId, $childUserId, 'can_transact')) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return null;
        }

        try {
            $this->assertRelationshipContactsAllowed($parentUserId, $childUserId, 'subaccount_transact');
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => $e->getMessage()];
            return null;
        }

        try {
            // Sender is the DEPENDENT (it is their balance); the carer is recorded
            // as the acting user on the ledger row.
            $txn = app(WalletService::class)->transfer($childUserId, $data, $parentUserId);
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'TRANSFER_FAILED', 'message' => $e->getMessage()];
            return null;
        }

        $this->auditProxyAction($parentUserId, $childUserId, 'subaccount_transfer_sent', [
            'transaction_id' => $txn['id'] ?? null,
            'amount' => $data['amount'] ?? null,
        ]);

        $this->notifyChildOfProxyAction(
            $parentUserId,
            $childUserId,
            'sub_account_proxy_transfer',
            'svc_notifications.sub_account.proxy_transfer_bell',
            '/wallet',
        );

        return $txn;
    }

    /**
     * Record a proxy action against the durable tenant audit log.
     *
     * Deliberately `org_audit_log` rather than only a notification: a carer
     * spending a dependent's credits, or posting in their name, must leave a record
     * that outlives the notification and is exportable by an administrator.
     */
    private function auditProxyAction(int $parentUserId, int $childUserId, string $action, array $details): void
    {
        try {
            app(AuditLogService::class)->logAction(
                TenantContext::getId(),
                $action,
                $parentUserId,
                $details,
                null,
                $childUserId,
            );
        } catch (\Throwable $e) {
            // Never fail the member-facing action on an audit hiccup, but do not
            // let it pass silently either.
            Log::error('Failed to audit linked-account proxy action', [
                'action' => $action,
                'parent_user_id' => $parentUserId,
                'child_user_id' => $childUserId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Tell the dependent, in their own language, that a carer acted for them —
     * bell, EMAIL and push, and naming the carer.
     *
     * 🔴 Until 2026-08-07 this wrote the bell row directly, so someone could
     * spend a member's credits or post in their name and the member received
     * no email and no push — the identical defect the request/approval
     * notifications had before 2026-08-06, on a strictly more consequential
     * event. Both proxy types are in NotificationDispatcher's
     * $criticalInstantTypes: money leaving your account is not digest
     * material. And the carer is NAMED — "someone who manages your account"
     * withheld the one fact the member would act on.
     *
     * No actor id is passed to the dispatcher on purpose: an actor id applies
     * the recipient's mute list, and a member must never be able to mute the
     * disclosure that their own account was acted on.
     */
    private function notifyChildOfProxyAction(
        int $parentUserId,
        int $childUserId,
        string $activityType,
        string $bellKey,
        string $link,
    ): void {
        try {
            $parent = User::find($parentUserId);
            $child = User::find($childUserId);
            $parentName = $parent !== null ? trim($parent->first_name . ' ' . $parent->last_name) : '';

            LocaleContext::withLocale($child, function () use ($childUserId, $activityType, $bellKey, $link, $parentName) {
                NotificationDispatcher::dispatch(
                    $childUserId,
                    'global',
                    0,
                    $activityType,
                    __($bellKey, ['name' => $parentName]),
                    $link,
                    $activityType === 'sub_account_proxy_transfer'
                        ? NotificationDispatcher::buildSubAccountProxyTransferEmail($parentName)
                        : NotificationDispatcher::buildSubAccountProxyListingEmail($parentName, $link),
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify dependent of linked-account proxy action', [
                'child_user_id' => $childUserId,
                'activity_type' => $activityType,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Append to the relationship's immutable trail (account_relationship_events,
     * DB-trigger enforced). A grant of real power over another member's
     * listings and credits deserves at least the audit rigor of the
     * record-only assignments table. Never fails the member action — but
     * never passes silently either.
     *
     * @param AccountRelationship|object $rel Needs id/tenant_id/parent_user_id/child_user_id.
     * @param array<string, mixed>|null $details
     */
    private function relationshipEvent(
        object $rel,
        string $action,
        string $actorRole,
        ?int $actorUserId,
        ?string $reason = null,
        ?array $details = null,
    ): void {
        try {
            DB::table('account_relationship_events')->insert([
                'tenant_id' => (int) ($rel->tenant_id ?? TenantContext::getId()),
                'relationship_id' => (int) $rel->id,
                'parent_user_id' => (int) $rel->parent_user_id,
                'child_user_id' => (int) $rel->child_user_id,
                'action' => $action,
                'actor_role' => $actorRole,
                'actor_user_id' => $actorUserId,
                'reason' => $reason,
                'details' => $details !== null ? json_encode($details) : null,
                'ip_address' => request()?->ip(),
                'user_agent' => mb_substr((string) request()?->userAgent(), 0, 255),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to write account relationship event', [
                'relationship_id' => $rel->id ?? null,
                'action' => $action,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * A linked-account relationship grants the parent capabilities over the
     * child while also requiring approval/contact from the child. Evaluate both
     * directions through the central fail-closed policy.
     */
    private function assertRelationshipContactsAllowed(
        int $parentUserId,
        int $childUserId,
        string $channel,
    ): void {
        $policy = app(SafeguardingInteractionPolicy::class);
        $tenantId = TenantContext::getId();

        $policy->assertLocalContactAllowed(
            $parentUserId,
            $childUserId,
            $tenantId,
            $channel,
        );
        $policy->assertLocalContactAllowed(
            $childUserId,
            $parentUserId,
            $tenantId,
            $channel,
        );
    }

}
