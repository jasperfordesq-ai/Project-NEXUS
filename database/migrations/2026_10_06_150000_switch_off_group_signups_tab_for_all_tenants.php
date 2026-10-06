<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Services\RedisCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Hide the volunteering "Group Sign-ups" tab on every community (owner
 * decision 2026-10-06). The feature is alpha: a group leader can block out
 * places on a shift, but the members added are never notified, are not real
 * shift sign-ups, cannot check in and earn no hours.
 *
 * The platform default flips to OFF in VolunteeringConfigurationService, but
 * the admin "Volunteering" configuration modal saves EVERY key when any one is
 * changed, so a community whose admin ever pressed Save holds an explicit
 * `true` row that would outlive the default change. Those rows are removed so
 * the default governs; an admin can still turn the (Alpha-badged) switch back
 * on deliberately, which writes a fresh row.
 *
 * Data-only: no schema change, no table rebuild, safe under blue/green.
 */
return new class extends Migration
{
    private const KEY = 'volunteering.tab_group_signups';

    public function up(): void
    {
        if (! Schema::hasTable('tenant_settings')) {
            return;
        }

        $tenantIds = DB::table('tenant_settings')
            ->where('setting_key', self::KEY)
            ->pluck('tenant_id')
            ->map(static fn ($id): int => (int) $id)
            ->unique()
            ->values();

        if ($tenantIds->isEmpty()) {
            return;
        }

        DB::table('tenant_settings')
            ->where('setting_key', self::KEY)
            ->delete();

        // Both caches that carry the old value: the service's per-tenant config
        // cache and the tenant bootstrap payload the React app reads it from.
        $redis = app(RedisCache::class);
        foreach ($tenantIds as $tenantId) {
            Cache::forget("volunteering_config:{$tenantId}");
            $redis->delete('tenant_bootstrap', $tenantId);
        }
    }

    public function down(): void
    {
        // The removed rows all held the old default (true), which the previous
        // code already assumed when no row existed. Nothing to restore.
    }
};
