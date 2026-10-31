<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Translation;

use App\Models\Listing;
use App\Models\User;
use App\Services\Translation\TaxonomyNameLocalizer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner, 31 Oct 2026: category names must reach every member in their own
 * language, wherever the name is shown — not only in the pickers. Names are
 * translated ahead of time (name_translations); display reads them with no
 * provider call. An English reader still sees the stored name.
 */
class CategoryNamesShownEverywhereTest extends TestCase
{
    use DatabaseTransactions;

    private ?string $originalConfiguration = null;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TaxonomyNameLocalizer::flushNameMaps();
        Http::fake();

        $this->originalConfiguration = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = json_decode((string) $this->originalConfiguration, true) ?: [];
        $config['default_language'] = 'en';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
    }

    protected function tearDown(): void
    {
        TaxonomyNameLocalizer::flushNameMaps();
        Cache::flush();
        parent::tearDown();
    }

    private function category(string $type = 'listing'): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Home & Garden ' . bin2hex(random_bytes(3)),
            'slug' => 'home-garden-' . bin2hex(random_bytes(3)),
            'type' => $type,
            'is_active' => 1,
            'sort_order' => 0,
            'color' => 'green',
            'created_at' => now(),
            'updated_at' => now(),
            'name_translations' => json_encode(['es' => 'Hogar y jardín', 'fr' => 'Maison et jardin']),
        ]);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_a_listing_shows_its_category_in_the_readers_language(): void
    {
        $categoryId = $this->category();
        $owner = $this->member();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id, 'category_id' => $categoryId, 'status' => 'active',
        ]);

        // The detail also carries the whole category; the website's listing page
        // reads its name first (found on the 31 Oct signed-in walkthrough).
        $this->apiGet("/v2/listings/{$listing->id}", ['Accept-Language' => 'es'])
            ->assertOk()
            ->assertJsonPath('data.category_name', 'Hogar y jardín')
            ->assertJsonPath('data.category.name', 'Hogar y jardín');

        TaxonomyNameLocalizer::flushNameMaps();
        $english = $this->apiGet("/v2/listings/{$listing->id}", ['Accept-Language' => 'en'])->assertOk();
        $this->assertStringStartsWith('Home & Garden', (string) $english->json('data.category_name'));

        Http::assertNothingSent();
    }

    public function test_a_language_with_no_saved_translation_falls_back_to_the_stored_name(): void
    {
        $categoryId = $this->category();
        $stored = (string) DB::table('categories')->where('id', $categoryId)->value('name');

        app()->setLocale('ja');

        $this->assertSame($stored, TaxonomyNameLocalizer::nameFor('categories', $categoryId, $stored));
        Http::assertNothingSent();
    }

    public function test_explore_shows_categories_in_the_readers_language_even_from_its_cache(): void
    {
        $categoryId = $this->category();
        $this->member();

        $first = $this->apiGet('/v2/explore', ['Accept-Language' => 'fr'])->assertOk();
        $names = array_column((array) $first->json('data.categories'), 'name', 'id');
        $this->assertSame('Maison et jardin', $names[$categoryId] ?? null);

        // The second request is served from the per-community cache, filled in French above.
        TaxonomyNameLocalizer::flushNameMaps();
        $second = $this->apiGet('/v2/explore', ['Accept-Language' => 'es'])->assertOk();
        $names = array_column((array) $second->json('data.categories'), 'name', 'id');
        $this->assertSame('Hogar y jardín', $names[$categoryId] ?? null);
    }

    public function test_the_payload_translator_ignores_rows_without_a_category_id(): void
    {
        $this->category();
        app()->setLocale('es');

        $payload = ['items' => [['title' => 'x', 'category_name' => 'Free text']], 'category' => ['name' => 'No id']];

        $this->assertSame($payload, TaxonomyNameLocalizer::localizePayload($payload));
    }
}
