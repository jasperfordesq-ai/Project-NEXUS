<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * AdminListingsService — Laravel DI-based service for admin listing management.
 *
 * Read-only listing queries for admin dashboards.
 *
 * NOTE: this class is not reached from any route. The live listing moderation
 * path is App\Services\ListingModerationService, which AdminListingsController
 * injects. `approve()` and `reject()` used to live here and wrote
 * `listings.approved_by` / `listings.approved_at`, neither of which exists —
 * every write threw and was swallowed. They were deleted on 2026-08-28 rather
 * than repaired, because ListingModerationService already does the job.
 */
class AdminListingsService
{
    /**
     * Get pending listings for a tenant.
     */
    public function getPending(int $tenantId, int $limit = 20, int $offset = 0): array
    {
        $query = DB::table('listings as l')
            ->leftJoin('users as u', 'l.user_id', '=', 'u.id')
            ->where('l.tenant_id', $tenantId)
            ->where('l.status', 'pending')
            ->select('l.*', 'u.name as author_name');

        $total = $query->count();
        $items = $query->orderByDesc('l.created_at')
            ->offset($offset)
            ->limit(min($limit, 100))
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Get listing statistics for admin dashboard.
     */
    public function getStats(int $tenantId): array
    {
        $rows = DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status')
            ->all();

        return [
            'active'   => (int) ($rows['active'] ?? 0),
            'pending'  => (int) ($rows['pending'] ?? 0),
            'rejected' => (int) ($rows['rejected'] ?? 0),
            'expired'  => (int) ($rows['expired'] ?? 0),
            'total'    => array_sum(array_map('intval', $rows)),
        ];
    }
}
