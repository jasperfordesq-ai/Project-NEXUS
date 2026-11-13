<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Remove the settings the admin "Native App" page used to save (E-127 / F-621).
 *
 * The page offered twenty-four `native_app_*` settings — app name, store
 * identifiers, push credentials, web-app colours and so on. Nothing read any
 * of them: the phone app's identity is fixed in the app itself, push is sent
 * with server-level credentials, and the web-app manifest uses fixed values.
 * The form and its endpoints were removed on 13 Nov 2026, which leaves any
 * saved rows as orphans. Two of the keys (`native_app_fcm_server_key`,
 * `native_app_apns_key_id`) invited an administrator to paste a credential,
 * stored unencrypted, so the rows are deleted rather than left behind.
 *
 * Platform-wide on purpose: this clears a retired feature's rows in every
 * community, so it is deliberately NOT scoped by `tenant_id`.
 *
 * Data only: no table or column changes, so it is safe while the other
 * blue/green colour is still serving.
 *
 * The key names and tenant ids are logged before deletion — never the values —
 * so that "did any community ever save a credential here?" can still be
 * answered after the rows are gone.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tenant_settings')) {
            return;
        }

        // `_` is a single-character wildcard in LIKE; escape it so only real
        // `native_app_` keys match.
        $rows = DB::table('tenant_settings')
            ->where('setting_key', 'like', 'native\_app\_%')
            ->orderBy('tenant_id')
            ->orderBy('setting_key')
            ->get(['id', 'tenant_id', 'setting_key']);

        if ($rows->isEmpty()) {
            return;
        }

        $byTenant = [];
        foreach ($rows as $row) {
            $byTenant[(int) $row->tenant_id][] = (string) $row->setting_key;
        }

        Log::info('Removing unused native_app_* tenant settings (E-127 / F-621)', [
            'rows' => $rows->count(),
            'keys_by_tenant' => $byTenant,
        ]);

        DB::table('tenant_settings')
            ->whereIn('id', $rows->pluck('id')->all())
            ->delete();
    }

    public function down(): void
    {
        // Nothing to restore: the values were read by no code, and the form
        // that wrote them no longer exists.
    }
};
