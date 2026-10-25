<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Events\SafeguardingFlaggedEvent;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Models\UserSafeguardingPreference;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Computes and activates behavioral triggers from safeguarding preferences.
 *
 * When a member selects safeguarding options during onboarding, this service:
 * 1. Merges triggers from all affirmatively selected, non-revoked options
 * 2. Writes only explicit broker-approval workflow flags to the existing
 *    user_messaging_restrictions infrastructure
 * 3. Syncs user-level safeguarding flags (works_with_children, etc.)
 * 4. Dispatches SafeguardingFlaggedEvent for admin/broker notification
 *
 * Eligibility and coordinator-contact preferences never authorise broker
 * visibility of message contents. Content monitoring is a separate, explicit
 * administrative control and must not be inferred from a member preference.
 */
class SafeguardingTriggerService
{
    private const CACHE_PREFIX = 'safeguarding_triggers:';
    private const CACHE_TTL = 300; // 5 minutes

    /**
     * Internal DB marker for monitoring rows created by the safeguarding system.
     * Must start with 'Safeguarding:' — the cleanup query uses LIKE 'Safeguarding:%'.
     * Do NOT translate this constant — it is stored in the database and matched programmatically.
     */
    public const MONITORING_REASON_ONBOARDING = 'Safeguarding: self-identified during onboarding';

    /**
     * Known trigger keys with their defaults.
     */
    private const TRIGGER_DEFAULTS = [
        'requires_vetted_interaction' => false,
        'requires_broker_approval' => false,
        'restricts_messaging' => false,
        'restricts_matching' => false,
        'notify_admin_on_selection' => false,
    ];

    /**
     * Get the merged active triggers for a user. Cached for performance.
     *
     * @return array<string, bool|string>
     */
    public static function getActiveTriggers(int $userId, ?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $cacheKey = self::CACHE_PREFIX . "{$tenantId}:{$userId}";

        return Cache::remember(
            $cacheKey,
            self::CACHE_TTL,
            static fn (): array => self::getActiveTriggersUncached($userId, $tenantId),
        );
    }

    /**
     * Resolve active triggers directly from tenant-scoped database state.
     *
     * @return array<string, mixed>
     */
    public static function getActiveTriggersUncached(int $userId, ?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $selections = self::activePreferenceSelections($userId, $tenantId, false);

        return self::mergedTriggersForSelections($selections, $tenantId, false);
    }

    /**
     * Resolve definitive trigger state while locking preferences and their
     * options in the common safeguarding write order. The tenant policy mutex
     * must have been acquired first by SafeguardingJurisdictionService.
     *
     * @return array<string, mixed>
     */
    public static function getActiveTriggersForUpdate(int $userId, int $tenantId): array
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Safeguarding trigger locks require an active database transaction.');
        }

        $selections = self::activePreferenceSelections($userId, $tenantId, true);

        return self::mergedTriggersForSelections($selections, $tenantId, true);
    }

    /**
     * Recompute protections based on a user's safeguarding preferences.
     *
     * Enforcement recomputation is notification-silent by default because it
     * is also called after policy and option maintenance. Only a fresh member
     * preference save may opt into the safeguarding disclosure notification.
     */
    public static function activateTriggersForUser(
        int $userId,
        ?int $tenantId = null,
        bool $notifyStaffOfMemberSelection = false,
    ): void
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        // Invalidate cache first. The activation side effects themselves use
        // an uncached read so an in-flight stale cache callback cannot drive
        // flags or notifications from pre-commit preference state.
        self::invalidateCache($userId, $tenantId);

        // Get fresh merged triggers
        $triggers = self::getActiveTriggersUncached($userId, $tenantId);

        // A member asking for coordinator-only or vetted contact has not
        // consented to broker surveillance of every message body. Monitoring is
        // deliberately never activated from self-selected safeguarding options.
        $needsMonitoring = false;
        $needsBrokerApproval = $triggers['requires_broker_approval'];
        $needsNotification = $triggers['notify_admin_on_selection'];

        // Preferences are evaluated directly by policy consumers. Never write
        // them into the single-row administrative monitoring record: doing so
        // can overwrite a separately authorised monitoring decision. Only
        // remove the exact legacy row state created by this service.
        DB::update(
            "UPDATE user_messaging_restrictions
             SET under_monitoring = 0, requires_broker_approval = 0
             WHERE tenant_id = ? AND user_id = ? AND monitoring_reason = ?",
            [$tenantId, $userId, self::MONITORING_REASON_ONBOARDING]
        );

        // Sync user-level safeguarding flags (transactional to keep flags consistent)
        DB::transaction(function () use ($userId, $tenantId, $triggers) {
            $user = User::where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($user) {
                $updates = [
                    'works_with_children' => false,
                    'works_with_vulnerable_adults' => false,
                    'no_home_visits' => false,
                ];
                // Until 25 Oct 2026 this ran only when restricts_matching was on,
                // which none of the three flagging options set, so these user
                // flags could never become true. They follow the member's
                // live selections on active options directly.
                $prefs = UserSafeguardingPreference::where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->active()
                    ->with('option')
                    ->get();

                foreach ($prefs as $pref) {
                    $option = $pref->option;
                    if (! $option || ! $option->is_active || ! UserSafeguardingPreference::isEffectivelySelected(
                        $option->option_type,
                        $pref->selected_value,
                    )) {
                        continue;
                    }

                    $key = $option->option_key;
                    if ($key === 'works_with_children') {
                        $updates['works_with_children'] = true;
                    }
                    if ($key === 'works_with_vulnerable_adults') {
                        $updates['works_with_vulnerable_adults'] = true;
                    }
                    if ($key === 'no_home_visits') {
                        $updates['no_home_visits'] = true;
                    }
                }
                User::where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->update($updates);
            }
        });

        // Notify admins/brokers only for a fresh member preference save. Policy
        // configuration, option maintenance and consent revocation also need to
        // recompute these triggers, but replaying an onboarding alert from those
        // administrative/system paths misrepresents an old selection as a new
        // safeguarding disclosure.
        // Deduplicate: if we just fired the event for this user/tenant within
        // the last 10 minutes (for example, the member retried their save),
        // skip the dispatch so admins don't receive N copies of the same alert.
        if ($notifyStaffOfMemberSelection && $needsNotification) {
            $dedupKey = self::CACHE_PREFIX . "flagged:{$tenantId}:{$userId}";
            if (Cache::add($dedupKey, 1, 600)) {
                try {
                    event(new SafeguardingFlaggedEvent($userId, $tenantId, $triggers));
                } catch (\Throwable $e) {
                    Log::error('SafeguardingTriggerService: failed to dispatch SafeguardingFlaggedEvent', [
                        'user_id' => $userId,
                        'error' => $e->getMessage(),
                    ]);
                    // Roll back the dedup key so a manual retry can re-fire
                    Cache::forget($dedupKey);
                }
            } else {
                Log::info('SafeguardingTriggerService: SafeguardingFlaggedEvent suppressed (dedup window)', [
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                ]);
            }
        }

        // Audit log trigger activation
        try {
            DB::table('activity_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'action' => 'safeguarding_triggers_activated',
                'action_type' => 'safeguarding',
                'entity_type' => 'user',
                'entity_id' => $userId,
                'details' => json_encode([
                    'needs_monitoring' => $needsMonitoring,
                    'needs_broker_approval' => $needsBrokerApproval,
                    'triggers' => $triggers,
                ]),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to log trigger activation', ['error' => $e->getMessage()]);
        }
    }

    // =========================================================================
    // Convenience check methods (used by other services)
    // =========================================================================

    public static function requiresVettedInteraction(int $userId, ?int $tenantId = null): bool
    {
        return (bool) (self::getActiveTriggers($userId, $tenantId)['requires_vetted_interaction'] ?? false);
    }

    public static function requiresBrokerApproval(int $userId, ?int $tenantId = null): bool
    {
        return (bool) (self::getActiveTriggers($userId, $tenantId)['requires_broker_approval'] ?? false);
    }

    public static function isMessagingRestricted(int $userId, ?int $tenantId = null): bool
    {
        return (bool) (self::getActiveTriggers($userId, $tenantId)['restricts_messaging'] ?? false);
    }

    public static function isMatchingRestricted(int $userId, ?int $tenantId = null): bool
    {
        return (bool) (self::getActiveTriggers($userId, $tenantId)['restricts_matching'] ?? false);
    }

    /**
     * Get vetting types required for interactions with this user.
     *
     * @return string[] e.g. ['garda_vetting'] or ['dbs_enhanced']
     */
    public static function getRequiredVettingTypes(int $userId, ?int $tenantId = null): array
    {
        return self::getActiveTriggers($userId, $tenantId)['vetting_types_required'] ?? [];
    }

    /**
     * Bulk variant of getRequiredVettingTypes — resolves required vetting types
     * for many users in a single query. Designed for SmartMatchingEngine's
     * post-filter loop where 200–400 candidates are checked per match request
     * and 200 per-user Cache::remember calls would add measurable latency.
     *
     * Returns a map keyed by user_id with a (possibly empty) array of vetting
     * types each user requires. Every input user_id is present in the output,
     * even users with no safeguarding preferences (empty array).
     *
     * Does NOT populate the per-user getActiveTriggers cache — that cache holds
     * the full merged trigger map (boolean flags + vetting types), and warming
     * it from this method would require fetching all trigger fields. Callers
     * that need the full trigger map should still call getActiveTriggers() per
     * user; the bulk method is specifically for discovery-time gating where
     * only the vetting-type list is needed.
     *
     * @param int[] $userIds
     * @return array<int, string[]> user_id => vetting_type[]
     */
    public static function getRequiredVettingTypesForUsers(array $userIds, ?int $tenantId = null): array
    {
        if (empty($userIds)) {
            return [];
        }

        $tenantId = $tenantId ?? TenantContext::getId();
        $uniqueIds = array_values(array_unique(array_map('intval', $userIds)));
        $uniqueIds = array_filter($uniqueIds, fn ($id) => $id > 0);

        $result = array_fill_keys($uniqueIds, []);

        if (empty($uniqueIds)) {
            return $result;
        }

        try {
            $rows = DB::table('user_safeguarding_preferences as p')
                ->join('tenant_safeguarding_options as o', function ($join) {
                    $join->on('o.id', '=', 'p.option_id')
                         ->where('o.is_active', 1);
                })
                ->where('p.tenant_id', $tenantId)
                ->whereIn('p.user_id', $uniqueIds)
                ->whereNull('p.revoked_at')
                ->select('p.user_id', 'p.selected_value', 'o.option_type', 'o.triggers')
                ->get();

            foreach ($rows as $row) {
                $userId = (int) $row->user_id;
                if (! UserSafeguardingPreference::isEffectivelySelected(
                    $row->option_type ?? null,
                    $row->selected_value ?? null,
                )) {
                    continue;
                }

                $triggers = is_string($row->triggers)
                    ? (json_decode($row->triggers, true) ?: [])
                    : (array) ($row->triggers ?? []);

                $vettingType = $triggers['vetting_type_required'] ?? null;
                if (is_string($vettingType) && $vettingType !== ''
                    && self::requiresVettedInteractionTrigger($triggers)
                    && !in_array($vettingType, $result[$userId], true)) {
                    $result[$userId][] = $vettingType;
                }
            }
        } catch (\Throwable $e) {
            Log::error('SafeguardingTriggerService::getRequiredVettingTypesForUsers failed', [
                'error' => $e->getMessage(),
                'tenant_id' => $tenantId,
                'user_count' => count($uniqueIds),
            ]);
        }

        return $result;
    }

    private static function requiresVettedInteractionTrigger(array $triggers): bool
    {
        return !empty($triggers['requires_vetted_interaction']);
    }

    /** @return array<int, string> option_id => selected_value */
    private static function activePreferenceSelections(int $userId, int $tenantId, bool $forUpdate): array
    {
        $query = DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->whereNull('revoked_at')
            ->orderBy('id');
        if ($forUpdate) {
            $query->lockForUpdate();
        }

        $selections = [];
        foreach ($query->get(['option_id', 'selected_value']) as $preference) {
            $optionId = (int) $preference->option_id;
            if ($optionId > 0) {
                $selections[$optionId] = (string) ($preference->selected_value ?? '');
            }
        }
        ksort($selections);

        return $selections;
    }

    /**
     * @param array<int, string> $selections option_id => selected_value
     * @return array<string, mixed>
     */
    private static function mergedTriggersForSelections(array $selections, int $tenantId, bool $forUpdate): array
    {
        if ($selections === []) {
            return self::TRIGGER_DEFAULTS;
        }

        $optionIds = array_keys($selections);
        $query = DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $optionIds)
            ->where('is_active', true)
            ->orderBy('id');
        if ($forUpdate) {
            $query->lockForUpdate();
        }

        $merged = self::TRIGGER_DEFAULTS;
        $vettingTypes = [];
        foreach ($query->get(['id', 'option_type', 'triggers']) as $option) {
            $optionId = (int) $option->id;
            if (! array_key_exists($optionId, $selections)
                || ! UserSafeguardingPreference::isEffectivelySelected(
                    $option->option_type ?? null,
                    $selections[$optionId],
                )) {
                continue;
            }

            $triggers = is_string($option->triggers ?? null)
                ? json_decode((string) $option->triggers, true)
                : (array) ($option->triggers ?? []);
            if (! is_array($triggers)) {
                $triggers = [];
            }

            foreach (self::TRIGGER_DEFAULTS as $key => $default) {
                if (! empty($triggers[$key])) {
                    $merged[$key] = true;
                }
            }

            $vettingType = $triggers['vetting_type_required'] ?? null;
            if (self::requiresVettedInteractionTrigger($triggers)
                && is_string($vettingType)
                && $vettingType !== '') {
                $vettingTypes[] = $vettingType;
            }
        }

        if ($vettingTypes !== []) {
            $merged['vetting_types_required'] = array_values(array_unique($vettingTypes));
        }

        return $merged;
    }

    /**
     * Invalidate the trigger cache for a user (called when preferences change).
     */
    public static function invalidateCache(int $userId, ?int $tenantId = null): void
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        Cache::forget(self::CACHE_PREFIX . "{$tenantId}:{$userId}");
    }
}
