<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Services\RedisCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Retire the Footer page placement (audit finding A4, owner decision
 * 2026-10-17). A footer page rendered as an orphan single column in the desktop
 * footer and did not exist on phones at all.
 *
 * 1. The only footer pages in production are seed placeholders: `terms` and
 *    `privacy` stubs of 70 and 101 characters created 2026-03-06 on six
 *    communities. They duplicate the real legal pages the footer already links,
 *    so they are deleted. The length bound keeps any page an admin actually
 *    wrote under those slugs.
 * 2. Every other footer page moves to the header column so it keeps a link.
 * 3. The tenant bootstrap payload (which carries `menu_pages`) is dropped from
 *    the cache for every affected community.
 *
 * Data-only: no schema change, no table rebuild, safe under blue/green.
 */
return new class extends Migration
{
    private const STUB_SLUGS = ['terms', 'privacy'];

    private const STUB_MAX_CHARS = 200;

    public function up(): void
    {
        if (! Schema::hasTable('pages')) {
            return;
        }

        // Collected before either statement, so a community whose only footer
        // pages are deleted stubs still has its cache dropped.
        $tenantIds = DB::table('pages')
            ->where('menu_location', 'footer')
            ->pluck('tenant_id')
            ->map(static fn ($id): int => (int) $id)
            ->unique()
            ->values();

        if ($tenantIds->isEmpty()) {
            return;
        }

        DB::table('pages')
            ->where('menu_location', 'footer')
            ->whereIn('slug', self::STUB_SLUGS)
            ->whereRaw('CHAR_LENGTH(COALESCE(content, \'\')) < ?', [self::STUB_MAX_CHARS])
            ->delete();

        DB::table('pages')
            ->where('menu_location', 'footer')
            ->update(['menu_location' => 'header']);

        $redis = app(RedisCache::class);
        foreach ($tenantIds as $tenantId) {
            $redis->delete('tenant_bootstrap', $tenantId);
        }
    }

    public function down(): void
    {
        // Not reversible: the deleted seed stubs held no content of value (the
        // real legal pages are separate), and which header pages were moved
        // from the footer is not recorded. The Footer placement no longer
        // exists, so there is nothing to put them back into.
    }
};
