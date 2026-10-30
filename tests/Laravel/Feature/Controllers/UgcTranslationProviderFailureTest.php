<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\PlatformSecretStore;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID audit A2 (30 Oct 2026): when Google refused or could not be reached, the
 * endpoint answered 200 with the ORIGINAL text as `translated_text`, so the
 * button switched to "Show original" over untranslated words. A provider
 * failure must be reported as a failure, and must not be cached.
 */
class UgcTranslationProviderFailureTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => '0'],
        );
        AIServiceFactory::clearCache();
        Cache::flush();
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, 'platform-google-key-for-tests');
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    private function translate()
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        return $this->apiPost('/v2/ugc-translate', [
            'content_type' => 'post',
            'content_id' => 1,
            'source_text' => 'Hola, ¿cómo estás?',
            'target_locale' => 'en',
        ]);
    }

    private function assertReportedAsFailure($response): void
    {
        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'TRANSLATION_FAILED')
            ->assertJsonPath('errors.0.message', __('api.message_translation_failed'));
    }

    public function test_google_refusing_the_key_is_reported_not_disguised_as_a_translation(): void
    {
        Http::fake(['translation.googleapis.com/*' => Http::response(['error' => ['message' => 'API key not valid']], 403)]);

        $this->assertReportedAsFailure($this->translate());
    }

    public function test_google_quota_exhausted_is_reported(): void
    {
        Http::fake(['translation.googleapis.com/*' => Http::response(['error' => ['message' => 'Quota exceeded']], 429)]);

        $this->assertReportedAsFailure($this->translate());
    }

    public function test_google_unreachable_is_reported(): void
    {
        Http::fake(['translation.googleapis.com/*' => fn () => throw new ConnectionException('unreachable')]);

        $this->assertReportedAsFailure($this->translate());
    }

    public function test_a_failure_is_not_cached_so_the_next_try_reaches_google(): void
    {
        Http::fake(['translation.googleapis.com/*' => Http::sequence()
            ->push(['error' => ['message' => 'Backend error']], 500)
            ->push(['data' => ['translations' => [['translatedText' => 'Hello, how are you?']]]], 200)]);

        $this->assertReportedAsFailure($this->translate());

        $this->translate()->assertStatus(200)->assertJsonPath('data.translated_text', 'Hello, how are you?');
    }
}
