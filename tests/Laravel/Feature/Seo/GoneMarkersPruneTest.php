<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Seo;

use App\Models\User;
use App\Services\SeoGoneMarkers;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A "gone" marker for an address that is live again (listed in the sitemap)
 * is removed by the hourly seo:publish-redirects run, so content republished
 * outside an Eloquent save is not reported to crawlers as gone (2026-10-23).
 */
class GoneMarkersPruneTest extends TestCase
{
    use DatabaseTransactions;

    public function test_markers_for_live_addresses_are_removed_and_others_kept(): void
    {
        $root = sys_get_temp_dir() . '/nexus-gone-prune-' . uniqid();
        mkdir($root, 0775, true);
        $markers = new SeoGoneMarkers($root);
        $this->app->instance(SeoGoneMarkers::class, $markers);

        try {
            $host = 'prune-' . uniqid() . '.test';
            $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
            $features = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
            DB::table('tenants')->where('id', $this->testTenantId)->update([
                'domain' => $host, 'is_active' => 1, 'features' => json_encode(array_merge($features, ['blog' => true])),
            ]);
            $author = User::factory()->forTenant($this->testTenantId)->create();
            $slug = 'back-again-' . uniqid();
            DB::table('posts')->insert([
                'tenant_id' => $this->testTenantId, 'author_id' => $author->id, 'title' => 'Back again',
                'slug' => $slug, 'content' => 'Body', 'status' => 'published',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            Cache::flush();

            $markers->mark($this->testTenantId, ['/blog/' . $slug, '/blog/still-removed']);
            $this->assertTrue($markers->isMarked($this->testTenantId, '/blog/' . $slug));

            $this->artisan('seo:publish-redirects')->assertExitCode(0);

            $this->assertFalse($markers->isMarked($this->testTenantId, '/blog/' . $slug), 'a live post is not gone');
            $this->assertTrue($markers->isMarked($this->testTenantId, '/blog/still-removed'));
        } finally {
            exec('rm -rf ' . escapeshellarg($root));
        }
    }
}
