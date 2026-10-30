<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\RedisCache;
use App\Services\TranslationConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression (owner check of Admin → Translation settings for AWID, 30 Oct
 * 2026): of the page's seven settings only three were read anywhere. "Enable
 * translation", the per-member hourly limit and "auto-translate new
 * conversations" were saved and then ignored, so switching translation off or
 * capping it changed nothing.
 */
class TranslationSettingsWiringTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.openai.api_key' => 'synthetic-test-key']);
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => '1'],
        );
        AIServiceFactory::clearCache();
        // Google Translate is the default engine (30 Oct 2026); give it a platform key.
        app(\App\Services\PlatformSecretStore::class)->set(\App\Services\PlatformSecretStore::GOOGLE_TRANSLATE_KEY, 'platform-google-key-for-tests');
        Http::fake([
            'translation.googleapis.com/*' => Http::response(['data' => ['translations' => [['translatedText' => 'Hello, how are you?']]]]),
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Hello, how are you?']]],
            ]),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (array_keys(TranslationConfigurationService::DEFAULTS) as $key) {
            DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', $key)->delete();
        }
        Cache::flush();
        parent::tearDown();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    private function ugcTranslate(string $text): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/ugc-translate', [
            'content_type' => 'post',
            'content_id' => 1,
            'source_text' => $text,
            'target_locale' => 'en',
        ]);
    }

    public function test_switching_translation_off_stops_post_translation(): void
    {
        $this->member();
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_ENABLED, false);

        $this->ugcTranslate('Hola, ¿cómo estás?')
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'TRANSLATION_DISABLED');
        Http::assertNothingSent();
    }

    public function test_switching_translation_off_stops_message_translation(): void
    {
        $me = $this->member();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $other->id,
            'receiver_id' => $me->id,
            'body' => 'Hola, ¿nos vemos el sábado?',
            'is_read' => 0,
            'is_deleted' => 0,
            'created_at' => now(),
        ]);
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_ENABLED, false);

        $this->apiPost("/v2/messages/{$messageId}/translate", ['target_language' => 'en'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'TRANSLATION_DISABLED');
        Http::assertNothingSent();
    }

    public function test_the_hourly_limit_per_member_is_enforced(): void
    {
        $user = $this->member();
        RateLimiter::clear('translation-hourly:' . $this->testTenantId . ':' . $user->id);
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_MAX_PER_USER_PER_HOUR, 2);

        $this->ugcTranslate('Uno')->assertStatus(200);
        $this->ugcTranslate('Dos')->assertStatus(200);
        $this->ugcTranslate('Tres')
            ->assertStatus(429)
            ->assertJsonPath('errors.0.code', 'TRANSLATION_HOURLY_LIMIT');
    }

    public function test_the_websites_are_told_whether_translation_is_on_and_the_auto_translate_default(): void
    {
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_ENABLED, false);
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_AUTO_TRANSLATE_DEFAULT, true);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
            ->assertOk()
            ->assertJsonPath('data.translation.enabled', false)
            ->assertJsonPath('data.translation.auto_translate_default', true)
            ->assertJsonPath('data.translation.provider', 'google');
    }
}
