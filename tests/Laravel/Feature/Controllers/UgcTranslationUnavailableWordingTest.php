<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\PlatformSecretStore;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression (AWID pilot, Oct 2026): members were told "This tenant is not
 * connected to AI. Please contact the administrator." whenever they pressed
 * Translate. AWID has no AI keys of its own and AI switched off, and every
 * translation used to need AI.
 *
 * Since 30 Oct 2026 Google Translate is the default engine (owner decision),
 * so a community in AWID's position translates, and the member never sees an
 * AI message for it. With no Google key anywhere the answer is "not set up",
 * which is something the community's administrator can fix (their own key).
 */
class UgcTranslationUnavailableWordingTest extends TestCase
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
        Http::fake([
            'translation.googleapis.com/*' => Http::response(['data' => ['translations' => [['translatedText' => 'Hello, how are you?']]]]),
        ]);
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

    public function test_a_community_with_ai_off_and_no_keys_translates_instead_of_being_told_about_ai(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, 'platform-google-key-for-tests');

        $response = $this->translate();

        $response->assertStatus(200)->assertJsonPath('data.translated_text', 'Hello, how are you?');
        $this->assertStringNotContainsString('AI', (string) $response->json('data.translated_text'));
    }

    public function test_with_no_google_key_anywhere_members_are_told_it_is_not_set_up_not_about_ai(): void
    {
        $response = $this->translate();

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'TRANSLATION_NOT_SET_UP')
            ->assertJsonPath('errors.0.message', __('api.translation_not_set_up'));
        $this->assertStringNotContainsString('AI', (string) $response->json('errors.0.message'));
    }
}
