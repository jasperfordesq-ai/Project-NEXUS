<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\PlatformSecretStore;
use App\Services\Translation\TranslationEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 30 Oct 2026: Google Translate is the default translation
 * engine for every community. It uses the community's own Google key when it
 * has one, otherwise the platform's fallback Google key. AI translation is a
 * community's choice and uses only that community's own AI key — never the
 * platform's — falling back to Google when it has none or AI is off.
 *
 * Until now every translation went to OpenAI on the platform's key, and only
 * when the community's AI was switched on, so AWID (AI off, no keys of its
 * own) could translate nothing, whatever the engine setting said.
 */
class GoogleTranslateEngineTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM_GOOGLE_KEY = 'platform-google-key-test';
    private const COMMUNITY_GOOGLE_KEY = 'community-google-key-test';
    private const COMMUNITY_OPENAI_KEY = 'community-openai-key-test';
    private const PLATFORM_OPENAI_KEY = 'platform-openai-key-test';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.openai.api_key' => self::PLATFORM_OPENAI_KEY, 'services.google_translate.api_key' => null]);
        $this->setAi(false);
        Http::fake([
            'translation.googleapis.com/*' => Http::response(['data' => ['translations' => [['translatedText' => 'Hello from Google']]]]),
            'api.openai.com/*' => Http::response(['choices' => [['message' => ['content' => 'Hello from OpenAI']]]]),
        ]);
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    private function setAi(bool $on, ?string $ownOpenAiKey = null): void
    {
        DB::table('ai_settings')->where('tenant_id', $this->testTenantId)->whereIn('setting_key', ['ai_enabled', 'openai_api_key'])->delete();
        DB::table('ai_settings')->insert(['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled', 'setting_value' => $on ? '1' : '0']);
        if ($ownOpenAiKey !== null) {
            DB::table('ai_settings')->insert(['tenant_id' => $this->testTenantId, 'setting_key' => 'openai_api_key', 'setting_value' => $ownOpenAiKey]);
        }
        AIServiceFactory::clearCache();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    private function admin(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    private function translatePost(string $text = 'Hola, ¿cómo estás?'): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/ugc-translate', [
            'content_type' => 'post', 'content_id' => 1, 'source_text' => $text, 'target_locale' => 'en',
        ]);
    }

    private function googleKeyUsed(): ?string
    {
        $key = null;
        Http::assertSent(function (HttpRequest $request) use (&$key) {
            if (!str_contains($request->url(), 'translation.googleapis.com')) {
                return false;
            }
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $key = $query['key'] ?? null;
            return true;
        });
        return $key;
    }

    public function test_with_ai_off_and_no_keys_of_its_own_a_community_translates_with_the_platform_google_key(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        $this->member();

        $this->translatePost()->assertStatus(200)->assertJsonPath('data.translated_text', 'Hello from Google');

        $this->assertSame(self::PLATFORM_GOOGLE_KEY, $this->googleKeyUsed());
        Http::assertNotSent(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com'));
    }

    public function test_a_community_key_is_used_instead_of_the_platform_key(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        TranslationEngine::setCommunityGoogleKey(self::COMMUNITY_GOOGLE_KEY);
        $this->member();

        $this->translatePost()->assertStatus(200);

        $this->assertSame(self::COMMUNITY_GOOGLE_KEY, $this->googleKeyUsed());
    }

    public function test_a_community_key_is_stored_encrypted(): void
    {
        TranslationEngine::setCommunityGoogleKey(self::COMMUNITY_GOOGLE_KEY);

        $stored = (string) DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->where('setting_key', TranslationEngine::COMMUNITY_GOOGLE_KEY_SETTING)->value('setting_value');
        $this->assertNotSame('', $stored);
        $this->assertStringNotContainsString(self::COMMUNITY_GOOGLE_KEY, $stored);
    }

    public function test_message_translation_works_through_google_with_ai_off(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        $me = $this->member();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $other->id, 'receiver_id' => $me->id,
            'body' => 'Hola, ¿nos vemos el sábado?', 'is_read' => 0, 'is_deleted' => 0, 'created_at' => now(),
        ]);

        $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'en'])
            ->assertStatus(200)
            ->assertJsonPath('data.translated_text', 'Hello from Google');
    }

    /**
     * Owner, 31 Oct 2026 (coverage audit): group-chat messages are stored with
     * receiver_id = 0, so only the SENDER could translate one — every other
     * member of the chat got 404 from the Translate button.
     */
    private function groupChatMessage(User $sender, array $members, bool $leftChat = false): int
    {
        $conversationId = (int) DB::table('conversations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'is_group' => 1, 'group_name' => 'Garden helpers',
            'created_by' => $sender->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach (array_merge([$sender], $members) as $index => $member) {
            DB::table('conversation_participants')->insert([
                'tenant_id' => $this->testTenantId, 'conversation_id' => $conversationId, 'user_id' => $member->id,
                'role' => $index === 0 ? 'admin' : 'member', 'joined_at' => now(),
                'left_at' => ($leftChat && $index > 0) ? now() : null,
            ]);
        }

        return (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId, 'conversation_id' => $conversationId, 'sender_id' => $sender->id,
            'receiver_id' => 0, 'body' => 'Hola a todas', 'is_read' => 0, 'is_deleted' => 0, 'created_at' => now(),
        ]);
    }

    public function test_a_member_of_a_group_chat_can_translate_another_members_message(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        $me = $this->member();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = $this->groupChatMessage($sender, [$me]);

        $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'en'])
            ->assertStatus(200)
            ->assertJsonPath('data.translated_text', 'Hello from Google');
    }

    public function test_someone_outside_the_group_chat_cannot_translate_its_messages(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $insider = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = $this->groupChatMessage($sender, [$insider]);
        $this->member();

        $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'en'])->assertStatus(404);
    }

    public function test_a_member_who_left_the_group_chat_cannot_translate_its_messages(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        $me = $this->member();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = $this->groupChatMessage($sender, [$me], leftChat: true);

        $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'en'])->assertStatus(404);
    }

    public function test_ai_translation_uses_only_the_communitys_own_ai_key(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        DB::table('tenant_settings')->insert(['tenant_id' => $this->testTenantId, 'setting_key' => 'translation.engine', 'setting_value' => 'ai']);
        $this->setAi(true, self::COMMUNITY_OPENAI_KEY);
        $this->member();

        $this->translatePost()->assertStatus(200)->assertJsonPath('data.translated_text', 'Hello from OpenAI');

        Http::assertSent(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com')
            && $r->hasHeader('Authorization', 'Bearer ' . self::COMMUNITY_OPENAI_KEY));
        Http::assertNotSent(fn (HttpRequest $r) => $r->hasHeader('Authorization', 'Bearer ' . self::PLATFORM_OPENAI_KEY));
    }

    public function test_ai_chosen_without_a_key_of_its_own_falls_back_to_google(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        DB::table('tenant_settings')->insert(['tenant_id' => $this->testTenantId, 'setting_key' => 'translation.engine', 'setting_value' => 'ai']);
        $this->setAi(true);
        $this->member();

        $this->translatePost()->assertStatus(200)->assertJsonPath('data.translated_text', 'Hello from Google');
        Http::assertNotSent(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com'));
    }

    public function test_with_no_google_key_anywhere_translation_is_reported_as_not_set_up(): void
    {
        $this->member();

        $this->translatePost()->assertStatus(422)->assertJsonPath('errors.0.code', 'TRANSLATION_NOT_SET_UP');
        Http::assertNothingSent();
    }

    public function test_admins_see_which_key_is_in_use_but_never_the_key(): void
    {
        app(PlatformSecretStore::class)->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, self::PLATFORM_GOOGLE_KEY);
        $this->admin();

        $this->apiPut('/v2/admin/config/translation/google-key', ['api_key' => self::COMMUNITY_GOOGLE_KEY])->assertStatus(200);
        $response = $this->apiGet('/v2/admin/config/translation')->assertStatus(200);

        $response->assertJsonPath('data.google_key.community_key_set', true)
            ->assertJsonPath('data.google_key.platform_key_set', true)
            ->assertJsonPath('data.google_key.in_use', 'community');
        $this->assertStringNotContainsString(self::COMMUNITY_GOOGLE_KEY, $response->getContent());
        $this->assertStringNotContainsString(self::PLATFORM_GOOGLE_KEY, $response->getContent());

        $this->apiDelete('/v2/admin/config/translation/google-key')->assertStatus(200);
        $this->apiGet('/v2/admin/config/translation')->assertJsonPath('data.google_key.in_use', 'platform');
    }

    public function test_only_a_platform_super_admin_can_set_the_platform_key(): void
    {
        $this->admin();
        $this->apiPut('/v2/admin/super/translation/google-key', ['api_key' => 'x'])->assertStatus(403);

        $super = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'is_super_admin' => 1, 'role' => 'admin']);
        Sanctum::actingAs($super, ['*']);
        $this->apiPut('/v2/admin/super/translation/google-key', ['api_key' => self::PLATFORM_GOOGLE_KEY])->assertStatus(200);
        $this->apiGet('/v2/admin/super/translation/google-key')
            ->assertStatus(200)
            ->assertJsonPath('data.platform_key_set', true);
        $this->assertSame(self::PLATFORM_GOOGLE_KEY, app(PlatformSecretStore::class)->get(PlatformSecretStore::GOOGLE_TRANSLATE_KEY));
    }
}
