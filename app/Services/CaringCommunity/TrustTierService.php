<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Services\Identity\MemberIdentityVerification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * AG67 — Platform-Wide Member Trust-Level Tier System
 *
 * Computes and stores the trust tier for members within a tenant.
 * Tiers: Newcomer (0) → Member (1) → Trusted (2) → Verified (3) → Coordinator (4)
 *
 * Tier is calculated from configurable per-tenant criteria:
 *   - hours_logged: count of approved vol_logs
 *   - reviews_received: count of reviews received
 *   - identity_verified: an active id_verified badge (MemberIdentityVerification)
 *
 * E-061 F-269: every tier above MAX_TIER_WITHOUT_IDENTITY ("Verified",
 * "Coordinator") requires a real identity check whatever a tenant configures.
 * Stored tiers are corrected by the recompute paths: GET my-trust-tier
 * (recomputeForUser) and the admin "Recompute" action (recomputeAll).
 */
class TrustTierService
{
    public const TIER_NEWCOMER    = 0;
    public const TIER_MEMBER      = 1;
    public const TIER_TRUSTED     = 2;
    public const TIER_VERIFIED    = 3;
    public const TIER_COORDINATOR = 4;

    public const TIER_LABELS = [
        0 => 'newcomer',
        1 => 'member',
        2 => 'trusted',
        3 => 'verified',
        4 => 'coordinator',
    ];

    /** Highest tier a member can hold without an identity check. */
    public const MAX_TIER_WITHOUT_IDENTITY = self::TIER_TRUSTED;

    public const DEFAULT_CRITERIA = [
        'member'      => ['hours_logged' => 1,  'reviews_received' => 0, 'identity_verified' => false],
        'trusted'     => ['hours_logged' => 10, 'reviews_received' => 3, 'identity_verified' => false],
        'verified'    => ['hours_logged' => 10, 'reviews_received' => 3, 'identity_verified' => true],
        'coordinator' => ['hours_logged' => 50, 'reviews_received' => 5, 'identity_verified' => true],
    ];

    /**
     * Returns the criteria config for the given tenant (from DB or defaults).
     *
     * @return array<string, array<string, mixed>>
     */
    public function getConfig(int $tenantId): array
    {
        if (!Schema::hasTable('caring_trust_tier_config')) {
            return self::DEFAULT_CRITERIA;
        }

        $row = DB::table('caring_trust_tier_config')
            ->where('tenant_id', $tenantId)
            ->first();

        if ($row === null) {
            return self::DEFAULT_CRITERIA;
        }

        $decoded = json_decode((string) $row->criteria, true);

        if (!is_array($decoded) || empty($decoded)) {
            return self::DEFAULT_CRITERIA;
        }

        // Merge with defaults to ensure all tiers exist
        $config = self::DEFAULT_CRITERIA;
        foreach (array_keys(self::DEFAULT_CRITERIA) as $tierName) {
            if (isset($decoded[$tierName]) && is_array($decoded[$tierName])) {
                $config[$tierName] = array_merge(self::DEFAULT_CRITERIA[$tierName], $decoded[$tierName]);
            }
        }

        return $this->enforceIdentityAboveTrusted($config);
    }

    /**
     * E-061 F-269: tiers above MAX_TIER_WITHOUT_IDENTITY are named "Verified"
     * and "Coordinator", so a tenant setting cannot remove their identity
     * requirement. Applied on read, so computeTier, the breakdown and the admin
     * config screen all see the same rule.
     *
     * @param array<string, array<string, mixed>> $config
     * @return array<string, array<string, mixed>>
     */
    private function enforceIdentityAboveTrusted(array $config): array
    {
        foreach (self::TIER_LABELS as $tierInt => $tierName) {
            if ($tierInt > self::MAX_TIER_WITHOUT_IDENTITY && isset($config[$tierName])) {
                $config[$tierName]['identity_verified'] = true;
            }
        }

        return $config;
    }

    /**
     * Upsert the trust tier criteria config for a tenant.
     *
     * @param array<string, array<string, mixed>> $criteria
     */
    public function updateConfig(int $tenantId, array $criteria): void
    {
        $now = now();

        DB::table('caring_trust_tier_config')->upsert(
            [
                'tenant_id'  => $tenantId,
                'criteria'   => json_encode($criteria),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            ['tenant_id'],
            ['criteria', 'updated_at']
        );
    }

    /**
     * Compute the trust tier for a user based on live data.
     *
     * Walks tiers from highest (coordinator) to lowest (member).
     * Returns TIER_NEWCOMER if no tier's criteria pass.
     */
    public function computeTier(int $userId, int $tenantId): int
    {
        $criteria = $this->getConfig($tenantId);

        // Gather actual stats for this user
        $hoursLogged       = $this->countApprovedHours($userId, $tenantId);
        $reviewsReceived   = $this->countReviewsReceived($userId, $tenantId);
        $identityVerified  = $this->isIdentityVerified($userId, $tenantId);

        // Walk from highest tier to lowest
        $tierOrder = [
            self::TIER_COORDINATOR => 'coordinator',
            self::TIER_VERIFIED    => 'verified',
            self::TIER_TRUSTED     => 'trusted',
            self::TIER_MEMBER      => 'member',
        ];

        foreach ($tierOrder as $tierInt => $tierName) {
            $threshold = $criteria[$tierName] ?? self::DEFAULT_CRITERIA[$tierName];

            $hoursOk    = $hoursLogged    >= (int) ($threshold['hours_logged']      ?? 0);
            $reviewsOk  = $reviewsReceived >= (int) ($threshold['reviews_received'] ?? 0);
            $identityOk = !((bool) ($threshold['identity_verified'] ?? false)) || $identityVerified;

            if ($hoursOk && $reviewsOk && $identityOk) {
                return $tierInt;
            }
        }

        return self::TIER_NEWCOMER;
    }

    /**
     * Read the stored trust_tier value directly from the users table.
     */
    public function getTier(int $userId, int $tenantId): int
    {
        $row = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('trust_tier');

        return $row !== null ? (int) $row : self::TIER_NEWCOMER;
    }

    /**
     * Return the string label for a tier integer.
     */
    public function getTierLabel(int $tier): string
    {
        return self::TIER_LABELS[$tier] ?? self::TIER_LABELS[self::TIER_NEWCOMER];
    }

    /**
     * Recompute and store trust tiers for ALL active users in a tenant.
     *
     * @return int Number of users updated
     */
    public function recomputeAll(int $tenantId): int
    {
        if (!$this->isAvailable()) {
            return 0;
        }

        $userIds = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->pluck('id')
            ->all();

        $count = 0;
        foreach ($userIds as $userId) {
            try {
                $this->recomputeForUser((int) $userId, $tenantId);
                $count++;
            } catch (\Throwable $e) {
                Log::warning('[TrustTierService] recomputeAll failed for user', [
                    'user_id'   => $userId,
                    'tenant_id' => $tenantId,
                    'error'     => $e->getMessage(),
                ]);
            }
        }

        return $count;
    }

    /**
     * Recompute and store the trust tier for a single user.
     *
     * @return int The new tier value
     */
    public function recomputeForUser(int $userId, int $tenantId): int
    {
        $newTier = $this->computeTier($userId, $tenantId);

        DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->update(['trust_tier' => $newTier]);

        return $newTier;
    }

    /**
     * Whether the trust tier system tables and columns exist and are ready.
     */
    public function isAvailable(): bool
    {
        return Schema::hasTable('caring_trust_tier_config')
            && Schema::hasColumn('users', 'trust_tier');
    }

    /**
     * Compute the trust tier and a per-signal breakdown for a user, showing
     * exactly which criteria contributed to the current tier and what is still
     * needed to reach the next one.
     *
     * Tenant-scoped via the underlying signal queries.
     *
     * @return array{
     *     tier: int,
     *     tier_label: string,
     *     next_tier_label: string|null,
     *     progress_pct: float,
     *     signals: list<array{
     *         key: string,
     *         label_key: string,
     *         current: int,
     *         required: int,
     *         achieved: bool,
     *         unit: string
     *     }>
     * }
     */
    public function computeBreakdownForUser(int $userId, int $tenantId): array
    {
        $tier = $this->computeTier($userId, $tenantId);
        $tierLabel = $this->getTierLabel($tier);

        $nextTierInt = $tier < self::TIER_COORDINATOR ? $tier + 1 : null;
        $nextTierLabel = $nextTierInt !== null ? $this->getTierLabel($nextTierInt) : null;

        // Live stats (tenant-scoped inside each helper)
        $hoursLogged      = $this->countApprovedHours($userId, $tenantId);
        $reviewsReceived  = $this->countReviewsReceived($userId, $tenantId);
        $identityVerified = $this->isIdentityVerified($userId, $tenantId);

        // Decide which tier's thresholds to display:
        //   - if there is a next tier, show what's needed to reach it
        //   - otherwise (already coordinator) show the coordinator thresholds (all achieved)
        $criteria = $this->getConfig($tenantId);
        $targetTierName = $nextTierLabel ?? 'coordinator';
        $thresholds = $criteria[$targetTierName] ?? self::DEFAULT_CRITERIA[$targetTierName] ?? self::DEFAULT_CRITERIA['member'];

        $hoursRequired   = (int) ($thresholds['hours_logged'] ?? 0);
        $reviewsRequired = (int) ($thresholds['reviews_received'] ?? 0);
        $identityRequired = (bool) ($thresholds['identity_verified'] ?? false);

        $signals = [
            [
                'key'       => 'hours_logged',
                'label_key' => 'trust_tier.signals.hours_logged',
                'current'   => $hoursLogged,
                'required'  => $hoursRequired,
                'achieved'  => $hoursRequired === 0 || $hoursLogged >= $hoursRequired,
                'unit'      => 'hours',
            ],
            [
                'key'       => 'reviews_received',
                'label_key' => 'trust_tier.signals.reviews_received',
                'current'   => $reviewsReceived,
                'required'  => $reviewsRequired,
                'achieved'  => $reviewsRequired === 0 || $reviewsReceived >= $reviewsRequired,
                'unit'      => 'reviews',
            ],
            [
                'key'       => 'identity_verified',
                'label_key' => 'trust_tier.signals.identity_verified',
                'current'   => $identityVerified ? 1 : 0,
                'required'  => $identityRequired ? 1 : 0,
                'achieved'  => !$identityRequired || $identityVerified,
                'unit'      => 'boolean',
            ],
        ];

        // Progress: fraction of signals achieved toward the next tier (0–100)
        $achieved = 0;
        foreach ($signals as $s) {
            if ($s['achieved']) {
                $achieved++;
            }
        }
        $total = count($signals);
        $progressPct = $total > 0 ? round(($achieved / $total) * 100, 1) : 0.0;

        return [
            'tier'            => $tier,
            'tier_label'      => $tierLabel,
            'next_tier_label' => $nextTierLabel,
            'progress_pct'    => (float) $progressPct,
            'signals'         => $signals,
        ];
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private function countApprovedHours(int $userId, int $tenantId): int
    {
        if (!Schema::hasTable('vol_logs')) {
            return 0;
        }

        return (int) DB::table('vol_logs')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->sum('hours');
    }

    private function countReviewsReceived(int $userId, int $tenantId): int
    {
        if (!Schema::hasTable('reviews')) {
            return 0;
        }

        $column = 'receiver_id';
        if (! Schema::hasColumn('reviews', $column)) {
            // Older exports used reviewed_id/reviewee_id.
            $column = Schema::hasColumn('reviews', 'reviewed_id') ? 'reviewed_id' : 'reviewee_id';
        }

        if (!Schema::hasColumn('reviews', $column)) {
            return 0;
        }

        $query = DB::table('reviews')
            ->where($column, $userId)
            ->where('tenant_id', $tenantId);

        if (Schema::hasColumn('reviews', 'status')) {
            $query->where('status', 'approved');
        }

        return (int) $query->count();
    }

    /**
     * E-061 F-269: the active id_verified badge only (shared with the Warmth
     * Pass). This used to accept users.is_verified (EMAIL verification) and any
     * verification_completed_at (also stamped on a FAILED check).
     */
    private function isIdentityVerified(int $userId, int $tenantId): bool
    {
        return MemberIdentityVerification::isVerified($userId, $tenantId);
    }
}
