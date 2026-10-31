<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Translation;

use App\Jobs\FillCategoryNameTranslations;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\PlatformSecretStore;
use App\Services\SkillTaxonomyService;
use App\Services\TranslationConfigurationService;
use App\Services\Translation\TaxonomyNameLocalizer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID accessibility report, item 2 (30 Oct 2026): "When choosing what to offer
 * or request (gardening, art, support…) the lists are not fully translated.
 * Spanish speakers need basic English to pick the right option. The same
 * happens with profile skills."
 *
 * Category and skill-category names are admin-written once, in the community's
 * language. They are now shown in the reader's language: translated the first
 * time someone reads the list in that language, saved, and reused.
 */
class CategoryNamesInReaderLanguageTest extends TestCase
{
    use DatabaseTransactions;

    private ?string $originalConfiguration = null;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TaxonomyNameLocalizer::flushNameMaps();
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => '0'],
        );
        AIServiceFactory::clearCache();
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, 'platform-google-key-for-tests');

        // The community writes in English.
        $this->originalConfiguration = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = json_decode((string) $this->originalConfiguration, true) ?: [];
        $config['default_language'] = 'en';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    private function seedCategory(string $name): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => $name,
            'slug' => 'awid-' . bin2hex(random_bytes(4)),
            'type' => 'listing',
            'is_active' => 1,
            'sort_order' => 0,
            'color' => 'blue',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function nameOf(array $rows, int $id): ?string
    {
        foreach ($rows as $row) {
            if ((int) $row['id'] === $id) {
                return $row['name'];
            }
        }
        return null;
    }

    private function fakeGoogle(string $translated): void
    {
        Http::fake(['translation.googleapis.com/*' => Http::response([
            'data' => ['translations' => [['translatedText' => $translated]]],
        ], 200)]);
    }

    public function test_a_spanish_reader_sees_the_category_in_spanish_translated_once_and_saved(): void
    {
        $id = $this->seedCategory('Home & Garden AWID');
        $this->fakeGoogle('Hogar y jardín AWID');

        $first = $this->apiGet('/v2/categories?type=listing', ['Accept-Language' => 'es']);
        $first->assertOk();
        $this->assertSame('Hogar y jardín AWID', $this->nameOf($first->json('data'), $id));
        $this->assertStringContainsString('Accept-Language', (string) $first->headers->get('Vary'));
        Http::assertSent(fn ($request) => ($request->data()['source'] ?? null) === 'en' && ($request->data()['target'] ?? null) === 'es');

        $stored = json_decode((string) DB::table('categories')->where('id', $id)->value('name_translations'), true);
        $this->assertSame('Hogar y jardín AWID', $stored['es']);

        $callsAfterFirst = count(Http::recorded());
        $second = $this->apiGet('/v2/categories?type=listing', ['Accept-Language' => 'es']);
        $this->assertSame('Hogar y jardín AWID', $this->nameOf($second->json('data'), $id));
        $this->assertSame($callsAfterFirst, count(Http::recorded()), 'a saved translation is reused, not fetched again');
    }

    public function test_the_translations_column_is_never_published(): void
    {
        $this->seedCategory('Technology AWID');
        $this->fakeGoogle('Tecnología AWID');

        $response = $this->apiGet('/v2/categories?type=listing', ['Accept-Language' => 'es']);

        foreach ($response->json('data') as $row) {
            $this->assertArrayNotHasKey('name_translations', $row);
        }
    }

    public function test_a_reader_in_the_community_language_gets_the_stored_name_and_no_translation_call(): void
    {
        $id = $this->seedCategory('Transport AWID');
        Http::fake();

        $response = $this->apiGet('/v2/categories?type=listing', ['Accept-Language' => 'en']);

        $this->assertSame('Transport AWID', $this->nameOf($response->json('data'), $id));
        Http::assertNothingSent();
    }

    public function test_when_translation_is_switched_off_the_stored_name_is_shown(): void
    {
        $id = $this->seedCategory('Community AWID');
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_ENABLED, false);
        Cache::flush();
        Http::fake();

        $response = $this->apiGet('/v2/categories?type=listing', ['Accept-Language' => 'es']);

        $this->assertSame('Community AWID', $this->nameOf($response->json('data'), $id));
        Http::assertNothingSent();
    }

    public function test_when_google_refuses_the_stored_name_is_shown_and_nothing_is_saved(): void
    {
        $id = $this->seedCategory('Creative & Arts AWID');
        Http::fake(['translation.googleapis.com/*' => Http::response(['error' => ['message' => 'Quota exceeded']], 429)]);

        $response = $this->apiGet('/v2/categories?type=listing', ['Accept-Language' => 'es']);

        $this->assertSame('Creative & Arts AWID', $this->nameOf($response->json('data'), $id));
        $this->assertNull(DB::table('categories')->where('id', $id)->value('name_translations'));
    }

    public function test_skill_categories_are_shown_in_the_reader_language_too(): void
    {
        $id = (int) DB::table('skill_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Gardening AWID',
            'slug' => 'gardening-awid-' . bin2hex(random_bytes(3)),
            'display_order' => 0,
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $this->fakeGoogle('Jardinería AWID');

        $response = $this->apiGet('/v2/skills/categories?format=flat', ['Accept-Language' => 'es']);

        $response->assertOk();
        $this->assertSame('Jardinería AWID', $this->nameOf($response->json('data'), $id));
    }

    public function test_renaming_a_skill_category_drops_translations_of_the_old_name(): void
    {
        $id = (int) DB::table('skill_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Cooking AWID',
            'slug' => 'cooking-awid-' . bin2hex(random_bytes(3)),
            'display_order' => 0,
            'is_active' => 1,
            'created_at' => now(),
            'name_translations' => json_encode(['es' => 'Cocina AWID']),
        ]);

        app(SkillTaxonomyService::class)->updateCategory($id, ['name' => 'Baking AWID']);

        $this->assertNull(DB::table('skill_categories')->where('id', $id)->value('name_translations'));
    }

    // ------------------------------------------------------------------
    // Every language up front (owner, 31 Oct 2026: "this needs to work for
    // everyone, wherever they are and whatever language they speak")
    // ------------------------------------------------------------------

    public function test_a_category_is_translated_into_every_platform_language_at_once(): void
    {
        $id = $this->seedCategory('Gardening AWID');
        Http::fake(['translation.googleapis.com/*' => function ($request) {
            return Http::response(['data' => ['translations' => [['translatedText' => 'Gardening-' . $request->data()['target']]]]], 200);
        }]);

        $result = TaxonomyNameLocalizer::fillMissing('categories', $id);

        $expected = array_values(array_diff(TaxonomyNameLocalizer::platformLanguages(), ['en']));
        $this->assertSame(count($expected), $result['filled']);
        $stored = json_decode((string) DB::table('categories')->where('id', $id)->value('name_translations'), true);
        $this->assertEqualsCanonicalizing($expected, array_keys($stored));
        $this->assertSame('Gardening-ja', $stored['ja']);
    }

    public function test_filling_never_overwrites_an_existing_translation(): void
    {
        $id = $this->seedCategory('Gardening AWID');
        DB::table('categories')->where('id', $id)->update(['name_translations' => json_encode(['fr' => 'Jardinage (corrigé)'])]);
        Http::fake(['translation.googleapis.com/*' => Http::response(['data' => ['translations' => [['translatedText' => 'machine']]]], 200)]);

        TaxonomyNameLocalizer::fillMissing('categories', $id);

        $stored = json_decode((string) DB::table('categories')->where('id', $id)->value('name_translations'), true);
        $this->assertSame('Jardinage (corrigé)', $stored['fr']);
        Http::assertNotSent(fn ($request) => ($request->data()['target'] ?? null) === 'fr');
    }

    public function test_the_nightly_command_fills_every_category_of_a_community(): void
    {
        $id = $this->seedCategory('Transport AWID');
        Http::fake(['translation.googleapis.com/*' => Http::response(['data' => ['translations' => [['translatedText' => 'Transporte']]]], 200)]);

        $this->artisan('taxonomy:translate-names', ['--tenant' => $this->testTenantId])->assertExitCode(0);

        $stored = json_decode((string) DB::table('categories')->where('id', $id)->value('name_translations'), true);
        $this->assertSame('Transporte', $stored['es']);
    }

    public function test_an_admin_corrects_a_translation_and_an_empty_box_removes_it(): void
    {
        $id = $this->seedCategory('Care practices AWID');
        DB::table('categories')->where('id', $id)->update(['name_translations' => json_encode(['fr' => 'pratiques de soins', 'de' => 'Pflegepraxis'])]);
        Bus::fake();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->apiPut("/v2/admin/categories/{$id}", [
            'name' => 'Care practices AWID',
            'name_translations' => ['fr' => 'Pratiques de soin', 'de' => '', 'xx' => 'ignored'],
        ])->assertOk();

        $stored = json_decode((string) DB::table('categories')->where('id', $id)->value('name_translations'), true);
        $this->assertSame(['fr' => 'Pratiques de soin'], $stored);
    }

    public function test_creating_a_category_fills_every_language_in_the_background(): void
    {
        Bus::fake([FillCategoryNameTranslations::class]);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->apiPost('/v2/admin/categories', ['name' => 'Repair cafe AWID', 'type' => 'listing'])->assertSuccessful();

        Bus::assertDispatched(FillCategoryNameTranslations::class, fn ($job) => $job->table === 'categories' && $job->tenantId === $this->testTenantId);
    }
}
