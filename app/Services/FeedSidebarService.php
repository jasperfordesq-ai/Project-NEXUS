<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * FeedSidebarService — Laravel DI-based service for feed sidebar widgets.
 *
 * Provides community statistics, suggested members, and sidebar
 * data aggregation for the social feed layout.
 */
class FeedSidebarService
{
    /**
     * Get community statistics for the sidebar.
     */
    public function communityStats(): array
    {
        $tenantId = TenantContext::getId();
        $cacheKey = "feed_sidebar_stats:{$tenantId}";

        return Cache::remember($cacheKey, 120, function () use ($tenantId) {
            return [
                'total_members'    => (int) DB::table('users')->where('tenant_id', $tenantId)->where('status', 'active')->count(),
                'total_hours'      => (float) DB::table('transactions')->where('tenant_id', $tenantId)->where('status', 'completed')->sum('amount'),
                'total_listings'   => (int) DB::table('listings')->where('tenant_id', $tenantId)->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'active'))->count(),
                'total_events'     => (int) DB::table('events')->where('tenant_id', $tenantId)->where('status', 'published')->count(),
                'active_exchanges' => (int) DB::table('exchange_requests')->where('tenant_id', $tenantId)->whereIn('status', ['accepted', 'in_progress'])->count(),
            ];
        });
    }

    /**
     * Get suggested members for a user (members not yet connected).
     */
    public function suggestedMembers(int $userId, int $limit = 5): array
    {
        $tenantId = TenantContext::getId();

        $connectedIds = DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where(fn ($q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))
            ->where('status', 'accepted')
            ->get()
            ->map(fn ($c) => $c->requester_id === $userId ? $c->receiver_id : $c->requester_id)
            ->push($userId)
            ->unique()
            ->all();

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotIn('id', $connectedIds)
            ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', 'tagline')
            ->inRandomOrder()
            ->limit($limit)
            ->get()
            ->map(fn ($u) => (array) $u)
            ->all();
    }

    /**
     * Get complete sidebar data in one call.
     */
    public function sidebar(int $userId): array
    {
        return [
            'stats'     => $this->communityStats(),
            'suggested' => $this->suggestedMembers($userId),
        ];
    }
}
