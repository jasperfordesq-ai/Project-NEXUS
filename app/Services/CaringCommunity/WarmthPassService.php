<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * WarmthPass — Community trust credential for Tier 2+ members.
 *
 * The pass is computed on-demand from existing data; no separate table is needed.
 */
class WarmthPassService
{
    /** Inline tier labels (mirrors TrustTierService::TIER_LABELS to avoid circular dependency). */
    private const TIER_LABELS = [
        0 => 'newcomer',
        1 => 'member',
        2 => 'trusted',
        3 => 'verified',
        4 => 'coordinator',
    ];

    /**
     * Build the Warmth Pass payload for a given user.
     *
     * @return array{
     *   eligible: bool,
     *   tier: int,
     *   tier_label: string,
     *   hours_logged: float,
     *   reviews_received: int,
     *   identity_verified: bool,
     *   member_since: string|null,
     *   pass_active_since: string|null,
     *   tenant_name: string,
     *   member_name: string,
     *   categories: list<string>,
     * }
     */
    public function buildPass(int $userId, int $tenantId): array
    {
        // 1. Trust tier
        $userRow = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        $tier = $userRow !== null ? (int) ($userRow->trust_tier ?? 0) : 0;

        // 2. Eligibility
        $eligible = $tier >= 2;

        // 3. Member name
        $memberName = '';
        if ($userRow !== null) {
            $resolvedMemberName = UserDisplayName::resolve($userRow);
            if ($resolvedMemberName !== '') {
                $memberName = $resolvedMemberName;
            }
        }

        // 4. Member since
        $memberSince = null;
        if ($userRow !== null && !empty($userRow->created_at)) {
            try {
                $memberSince = (string) \Carbon\Carbon::parse((string) $userRow->created_at)->toDateString();
            } catch (\Throwable) {
                $memberSince = null;
            }
        }

        // 5. Hours logged
        $hoursLogged = 0.0;
        if (Schema::hasTable('vol_logs')) {
            $hoursLogged = (float) DB::table('vol_logs')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'approved')
                ->sum('hours');
        }

        // 6. Reviews received
        $reviewsReceived = 0;
        if (Schema::hasTable('reviews')) {
            $receiverCol = 'receiver_id';
            if (!Schema::hasColumn('reviews', $receiverCol)) {
                if (Schema::hasColumn('reviews', 'reviewed_id')) {
                    $receiverCol = 'reviewed_id';
                } elseif (Schema::hasColumn('reviews', 'reviewee_id')) {
                    $receiverCol = 'reviewee_id';
                } else {
                    $receiverCol = null;
                }
            }

            if ($receiverCol !== null && Schema::hasColumn('reviews', $receiverCol)) {
                $query = DB::table('reviews')
                    ->where($receiverCol, $userId)
                    ->where('tenant_id', $tenantId);

                if (Schema::hasColumn('reviews', 'status')) {
                    $query->where('status', 'approved');
                }

                $reviewsReceived = (int) $query->count();
            }
        }

        // 7. Identity verified
        $identityVerified = false;
        if ($userRow !== null) {
            $identityVerified = (bool) ($userRow->is_verified ?? false)
                || (string) ($userRow->verification_status ?? '') === 'passed'
                || !empty($userRow->verification_completed_at);
        }

        // 8. Tenant name
        $tenantName = 'Community';
        if (Schema::hasTable('tenants')) {
            $tenantRow = DB::table('tenants')->where('id', $tenantId)->first(['name']);
            if ($tenantRow !== null && !empty($tenantRow->name)) {
                $tenantName = (string) $tenantRow->name;
            }
        }

        // 9. Caring categories
        $categories = [];
        if (Schema::hasTable('caring_help_requests')) {
            $hasCategory = Schema::hasColumn('caring_help_requests', 'category_id');
            if ($hasCategory && Schema::hasTable('categories')) {
                $rows = DB::table('caring_help_requests as chr')
                    ->join('categories as c', 'c.id', '=', 'chr.category_id')
                    ->where('chr.user_id', $userId)
                    ->where('chr.tenant_id', $tenantId)
                    ->where('chr.status', 'matched')
                    ->distinct()
                    ->pluck('c.name')
                    ->all();

                $categories = array_values(array_filter(array_map('strval', $rows)));
            }
        }

        // 10. Pass active since (proxy: updated_at when tier >= 2)
        $passActiveSince = null;
        if ($eligible && $userRow !== null && !empty($userRow->updated_at)) {
            try {
                $passActiveSince = (string) \Carbon\Carbon::parse((string) $userRow->updated_at)->toDateString();
            } catch (\Throwable) {
                $passActiveSince = null;
            }
        }

        // 11. Tier label
        $tierLabel = self::TIER_LABELS[$tier] ?? self::TIER_LABELS[0];

        return [
            'eligible'          => $eligible,
            'tier'              => $tier,
            'tier_label'        => $tierLabel,
            'hours_logged'      => $hoursLogged,
            'reviews_received'  => $reviewsReceived,
            'identity_verified' => $identityVerified,
            'member_since'      => $memberSince,
            'pass_active_since' => $passActiveSince,
            'tenant_name'       => $tenantName,
            'member_name'       => $memberName,
            'categories'        => $categories,
        ];
    }
}
