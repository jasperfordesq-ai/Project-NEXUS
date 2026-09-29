<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Services\Identity\MemberIdentityVerification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * WarmthPass — Community trust credential for Tier 2+ members.
 *
 * The pass is computed on-demand from existing data; no separate table is needed.
 *
 * E-061 F-228: a member shows this pass to people outside the platform, so it
 * must not over-state what was checked.
 *  - "Identity verified" is the member's active `id_verified` verification
 *    badge, the same signal their profile badge shows. `users.is_verified` is
 *    EMAIL verification, and `verification_completed_at` is also stamped when
 *    an identity check FAILS, so neither may be read as identity.
 *  - Tiers above Trusted are labelled "verified" / "coordinator". The pass never
 *    shows them without that badge: tenants can configure those tiers without
 *    an identity check, and the stored tier can predate a revoked badge.
 *  - "Areas I help with" is built from help the member GIVES, never from help
 *    they asked for, so their own care needs never appear on the pass.
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

    /** Lowest tier that holds a pass. */
    public const MIN_ELIGIBLE_TIER = 2;

    /** Highest tier the pass may show for a member without an identity check. */
    public const MAX_TIER_WITHOUT_IDENTITY = TrustTierService::MAX_TIER_WITHOUT_IDENTITY;

    /** The verification badge that records a passed identity check. */
    public const IDENTITY_BADGE_TYPE = MemberIdentityVerification::BADGE_TYPE;

    /** Support relationships that count as help the member gives. */
    private const HELP_GIVEN_RELATIONSHIP_STATUSES = ['active', 'completed'];

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

        // 1b. Identity verified: the active id_verified badge only (see class doc).
        $identityVerified = $userRow !== null && $this->hasActiveIdentityBadge($userId, $tenantId);

        if (!$identityVerified && $tier > self::MAX_TIER_WITHOUT_IDENTITY) {
            $tier = self::MAX_TIER_WITHOUT_IDENTITY;
        }

        // 2. Eligibility
        $eligible = $tier >= self::MIN_ELIGIBLE_TIER;

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

        // 8. Tenant name
        $tenantName = 'Community';
        if (Schema::hasTable('tenants')) {
            $tenantRow = DB::table('tenants')->where('id', $tenantId)->first(['name']);
            if ($tenantRow !== null && !empty($tenantRow->name)) {
                $tenantName = (string) $tenantRow->name;
            }
        }

        // 9. Areas I help with: help the member GIVES (see class doc).
        $categories = $userRow !== null ? $this->helpGivenCategories($userId, $tenantId) : [];

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

    /**
     * Whether the member belongs to this tenant. The admin lookup uses it so a
     * member of another community reads as not found, not as an empty pass.
     */
    public function memberExists(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
    }

    /**
     * An active (not revoked, not expired) id_verified badge in this tenant.
     * Shared with TrustTierService so the two cannot drift (E-061 F-269).
     */
    private function hasActiveIdentityBadge(int $userId, int $tenantId): bool
    {
        return MemberIdentityVerification::isVerified($userId, $tenantId);
    }

    /**
     * Category names of help the member gives: caring support relationships in
     * which they are the SUPPORTER, and approved volunteer hours on categorised
     * opportunities. Every table, categories included, is scoped to the tenant.
     *
     * @return list<string>
     */
    private function helpGivenCategories(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('categories')) {
            return [];
        }

        $names = [];

        if (Schema::hasTable('caring_support_relationships')) {
            $names = array_merge($names, DB::table('caring_support_relationships as csr')
                ->join('categories as c', function ($join) use ($tenantId): void {
                    $join->on('c.id', '=', 'csr.category_id')
                        ->where('c.tenant_id', '=', $tenantId);
                })
                ->where('csr.tenant_id', $tenantId)
                ->where('csr.supporter_id', $userId)
                ->whereIn('csr.status', self::HELP_GIVEN_RELATIONSHIP_STATUSES)
                ->distinct()
                ->pluck('c.name')
                ->all());
        }

        if (Schema::hasTable('vol_logs') && Schema::hasTable('vol_opportunities')) {
            $names = array_merge($names, DB::table('vol_logs as vl')
                ->join('vol_opportunities as vo', function ($join) use ($tenantId): void {
                    $join->on('vo.id', '=', 'vl.opportunity_id')
                        ->where('vo.tenant_id', '=', $tenantId);
                })
                ->join('categories as c', function ($join) use ($tenantId): void {
                    $join->on('c.id', '=', 'vo.category_id')
                        ->where('c.tenant_id', '=', $tenantId);
                })
                ->where('vl.tenant_id', $tenantId)
                ->where('vl.user_id', $userId)
                ->where('vl.status', 'approved')
                ->distinct()
                ->pluck('c.name')
                ->all());
        }

        $names = array_filter(array_map('strval', $names), static fn (string $name): bool => $name !== '');

        return array_values(array_unique($names));
    }
}
