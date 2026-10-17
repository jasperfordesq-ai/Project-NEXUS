<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Migrations;

use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * The Footer page placement is retired (owner decision 2026-10-17). The only
 * footer pages in production are seed `terms`/`privacy` placeholders that
 * duplicate the real legal pages, so short ones are deleted; any other footer
 * page moves to the header column so it keeps a link.
 */
final class RetireFooterPagePlacementTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = 'database/migrations/2026_10_17_120000_retire_footer_page_placement.php';

    public function test_short_seed_stubs_are_deleted_and_other_footer_pages_move_to_header(): void
    {
        $tenantId = $this->testTenantId;
        DB::table('pages')
            ->where('tenant_id', $tenantId)
            ->whereIn('slug', ['terms', 'privacy', 'faq'])
            ->delete();

        $termsStub = $this->footerPage($tenantId, 'terms', str_repeat('t', 70));
        $privacyStub = $this->footerPage($tenantId, 'privacy', str_repeat('p', 101));
        $faq = $this->footerPage($tenantId, 'faq', 'Questions people ask.');

        // A real privacy page with content of its own is kept, not deleted.
        // `privacy` is unique per tenant, so it lives on a second tenant.
        $otherTenant = $tenantId + 1000;
        $longPrivacy = $this->footerPage($otherTenant, 'privacy', str_repeat('r', 400));

        $spy = Mockery::spy(RedisCache::class);
        $this->app->instance(RedisCache::class, $spy);

        $migration = require base_path(self::MIGRATION);
        $migration->up();

        self::assertFalse(DB::table('pages')->where('id', $termsStub)->exists());
        self::assertFalse(DB::table('pages')->where('id', $privacyStub)->exists());
        self::assertSame('header', DB::table('pages')->where('id', $faq)->value('menu_location'));
        self::assertSame('header', DB::table('pages')->where('id', $longPrivacy)->value('menu_location'));
        self::assertSame(0, DB::table('pages')->where('menu_location', 'footer')->count());

        $spy->shouldHaveReceived('delete')->with('tenant_bootstrap', $tenantId)->atLeast()->once();
        $spy->shouldHaveReceived('delete')->with('tenant_bootstrap', $otherTenant)->atLeast()->once();
    }

    public function test_menu_items_pointing_at_deleted_stubs_are_removed(): void
    {
        $tenantId = $this->testTenantId;
        DB::table('pages')->where('tenant_id', $tenantId)->whereIn('slug', ['terms', 'faq'])->delete();
        $stub = $this->footerPage($tenantId, 'terms', 'tiny');
        $kept = $this->footerPage($tenantId, 'faq', 'Questions people ask.');

        $menuId = (int) DB::table('menus')->insertGetId([
            'tenant_id' => $tenantId, 'name' => 'Retire test', 'slug' => 'retire-test-' . uniqid(), 'location' => 'footer',
        ]);
        $stubItem = (int) DB::table('menu_items')->insertGetId([
            'menu_id' => $menuId, 'type' => 'page', 'label' => 'Terms', 'page_id' => $stub,
        ]);
        $keptItem = (int) DB::table('menu_items')->insertGetId([
            'menu_id' => $menuId, 'type' => 'page', 'label' => 'FAQ', 'page_id' => $kept,
        ]);

        $this->app->instance(RedisCache::class, Mockery::spy(RedisCache::class));
        $migration = require base_path(self::MIGRATION);
        $migration->up();

        self::assertFalse(DB::table('menu_items')->where('id', $stubItem)->exists());
        self::assertTrue(DB::table('menu_items')->where('id', $keptItem)->exists());
    }

    public function test_pages_outside_the_footer_are_untouched(): void
    {
        $tenantId = $this->testTenantId;
        DB::table('pages')->where('tenant_id', $tenantId)->where('slug', 'terms')->delete();

        // A short `terms` page in the About menu is not a footer stub.
        $aboutTerms = (int) DB::table('pages')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => 'Terms',
            'slug' => 'terms',
            'content' => 'short',
            'is_published' => 1,
            'show_in_menu' => 1,
            'menu_location' => 'about',
        ]);

        $this->app->instance(RedisCache::class, Mockery::spy(RedisCache::class));
        $migration = require base_path(self::MIGRATION);
        $migration->up();

        self::assertSame('about', DB::table('pages')->where('id', $aboutTerms)->value('menu_location'));
    }

    private function footerPage(int $tenantId, string $slug, string $content): int
    {
        return (int) DB::table('pages')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => ucfirst($slug),
            'slug' => $slug,
            'content' => $content,
            'is_published' => 1,
            'show_in_menu' => 1,
            'menu_location' => 'footer',
        ]);
    }
}
