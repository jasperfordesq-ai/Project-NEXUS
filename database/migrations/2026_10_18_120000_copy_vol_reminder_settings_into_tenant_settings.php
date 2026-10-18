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
 * Copy each community's volunteer reminder settings from the retired
 * `vol_reminder_settings` table into its `volunteering.reminder_*` tenant
 * configuration (owner decision 2026-10-18: one place for every volunteering
 * setting, the admin Module Configuration window).
 *
 * Per saved row, two keys: `volunteering.reminder_<type>_enabled` and the one
 * timing the type uses. The old page had an on/off switch AND an email switch;
 * email was the only channel, so "on but email off" sent nothing — that
 * community is copied as switched off, which is what it experienced. A NULL
 * timing is not copied, so the platform default applies exactly as before.
 *
 * Idempotent: a key already present in tenant_settings is never overwritten,
 * because blue/green runs this on each colour and a value saved through the
 * new window in between must win. Data-only, no schema change, safe under
 * blue/green.
 *
 * 🔴 Known gap, accepted: while the old colour still serves, an admin saving
 * the OLD reminders page writes only the old table, and this copy has already
 * run. Such an edit (a few minutes' window) is lost. The old table itself
 * stays one release so the other colour keeps working, then is dropped.
 */
return new class extends Migration
{
    /** reminder_type → [timing column in the old table, timing key suffix]. */
    private const TIMINGS = [
        'pre_shift'           => ['hours_before', 'hours_before'],
        'post_shift_feedback' => ['hours_after', 'hours_after'],
        'lapsed_volunteer'    => ['days_inactive', 'days_inactive'],
        'credential_expiry'   => ['days_before_expiry', 'days_before'],
        'training_expiry'     => ['days_before_expiry', 'days_before'],
    ];

    public function up(): void
    {
        if (! Schema::hasTable('vol_reminder_settings') || ! Schema::hasTable('tenant_settings')) {
            return;
        }

        $rows = DB::table('vol_reminder_settings')
            ->whereIn('reminder_type', array_keys(self::TIMINGS))
            ->orderBy('id')
            ->get();

        if ($rows->isEmpty()) {
            return;
        }

        $touchedTenants = [];

        foreach ($rows as $row) {
            $tenantId = (int) $row->tenant_id;
            $type = (string) $row->reminder_type;
            [$column, $suffix] = self::TIMINGS[$type];

            $enabled = (bool) $row->enabled && (bool) $row->email_enabled;
            $this->insertIfMissing($tenantId, "volunteering.reminder_{$type}_enabled", $enabled ? 'true' : 'false', 'boolean');

            $timing = $row->{$column} ?? null;
            if ($timing !== null && (int) $timing >= 1) {
                $this->insertIfMissing($tenantId, "volunteering.reminder_{$type}_{$suffix}", (string) (int) $timing, 'integer');
            }

            $touchedTenants[$tenantId] = true;
        }

        // Both caches that carry the old value: the service's per-tenant config
        // cache and the tenant bootstrap payload the React app reads it from.
        $redis = app(RedisCache::class);
        foreach (array_keys($touchedTenants) as $tenantId) {
            Cache::forget("volunteering_config:{$tenantId}");
            $redis->delete('tenant_bootstrap', $tenantId);
        }
    }

    public function down(): void
    {
        // The old table is untouched and still holds every value, so there is
        // nothing to restore. The copied keys are left in place: removing them
        // would silently revert a community to the defaults.
    }

    private function insertIfMissing(int $tenantId, string $key, string $value, string $type): void
    {
        $exists = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', $key)
            ->exists();

        if ($exists) {
            return;
        }

        DB::table('tenant_settings')->insert([
            'tenant_id' => $tenantId,
            'setting_key' => $key,
            'setting_value' => $value,
            'setting_type' => $type,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
};
