<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\AiUsageGate;
use App\Services\JobConfigurationService;
use App\Services\ListingConfigurationService;
use App\Services\TranscriptionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * E-035 F-164 — member-triggered AI provider calls outside the chat path
 * ignored the community AI master switch and the member's AI budget.
 *
 * Every entry point below must go through {@see AiUsageGate}: with AI switched
 * off it makes ZERO provider requests (a voice message is still stored), with
 * AI on and budget left the call goes through and consumes one slot, and with
 * the budget spent it is refused (or, for voice, transcription is skipped).
 *
 * No real provider is ever contacted: Http::preventStrayRequests() plus a fake.
 */
final class AiProviderCallGateTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    private string $storage = '';

    protected function setUp(): void
    {
        parent::setUp();

        // A private, per-run storage root, removed in tearDown — never a fixed shared path.
        $this->storage = sys_get_temp_dir() . '/nexus-ai-gate-test-' . bin2hex(random_bytes(6)) . '/storage';
        @mkdir($this->storage, 0777, true);
        $this->app->useStoragePath($this->storage);

        config(['services.openai.api_key' => 'sk-e035-fake-not-real']);
        Http::preventStrayRequests();
        Http::fake([
            'api.openai.com/v1/audio/transcriptions' => Http::response(['text' => 'E035 FAKE TRANSCRIPT', 'language' => 'en'], 200),
            'api.openai.com/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'E035 FAKE COMPLETION']]],
            ], 200),
        ]);

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        foreach (['marketplace', 'job_vacancies', 'message_translation', 'listings', 'messages'] as $feature) {
            $features[$feature] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        ListingConfigurationService::set(ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true);
        JobConfigurationService::set(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true);
        AIServiceFactory::clearCache();
    }

    protected function tearDown(): void
    {
        if ($this->storage !== '') {
            exec('rm -rf ' . escapeshellarg(dirname($this->storage)));
        }
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  Voice messages
    // ------------------------------------------------------------------

    public function test_voice_message_with_ai_off_is_stored_without_transcription(): void
    {
        $this->setAiEnabled(false);
        [$sender, $receiver] = $this->pair();

        $response = $this->sendBase64Voice($receiver);

        $response->assertStatus(201);
        $messageId = (int) $response->json('data.message_id');
        $this->assertGreaterThan(0, $messageId);
        $this->assertNull($response->json('data.transcript'));
        $this->assertNull(DB::table('messages')->where('id', $messageId)->value('transcript'));
        $this->assertSame(0, $this->providerRequestCount());
        $this->assertBudgetUsed($sender, 0);
    }

    public function test_voice_message_with_ai_on_is_transcribed_and_consumes_budget(): void
    {
        $this->setAiEnabled(true);
        [$sender, $receiver] = $this->pair();
        $this->seedBudget($sender, dailyLimit: 5, dailyUsed: 0);

        $response = $this->sendBase64Voice($receiver);

        $response->assertStatus(201);
        $this->assertSame('E035 FAKE TRANSCRIPT', $response->json('data.transcript'));
        $this->assertSame(1, $this->providerRequestCount());
        $this->assertBudgetUsed($sender, 1);
    }

    public function test_voice_message_with_budget_spent_is_stored_without_transcription(): void
    {
        $this->setAiEnabled(true);
        [$sender, $receiver] = $this->pair();
        $this->seedBudget($sender, dailyLimit: 1, dailyUsed: 1);

        $response = $this->sendBase64Voice($receiver);

        $response->assertStatus(201);
        $this->assertNull($response->json('data.transcript'));
        $this->assertSame(0, $this->providerRequestCount());
    }

    public function test_member_transcription_helper_respects_switch_and_budget(): void
    {
        // The multipart /v2/messages/voice route cannot be driven end to end
        // under PHPUnit (move_uploaded_file rejects test uploads), so the gated
        // helper it calls is exercised directly, and the wiring is pinned below.
        [$sender] = $this->pair();
        $file = $this->storage . '/voice-probe.wav';
        file_put_contents($file, $this->wav());

        $this->setAiEnabled(false);
        $this->assertNull(TranscriptionService::transcribeForMember((int) $sender->id, $file));
        $this->assertSame(0, $this->providerRequestCount());

        $this->setAiEnabled(true);
        $this->seedBudget($sender, dailyLimit: 1, dailyUsed: 1);
        $this->assertNull(TranscriptionService::transcribeForMember((int) $sender->id, $file));
        $this->assertSame(0, $this->providerRequestCount());

        $this->seedBudget($sender, dailyLimit: 2, dailyUsed: 1);
        $result = TranscriptionService::transcribeForMember((int) $sender->id, $file);
        $this->assertSame('E035 FAKE TRANSCRIPT', $result['text'] ?? null);
        $this->assertSame(1, $this->providerRequestCount());
        @unlink($file);
    }

    public function test_both_voice_routes_use_the_gated_transcription_helper(): void
    {
        foreach ([
            'Http/Controllers/Api/MessagesController.php',
            'Http/Controllers/Api/VoiceMessageController.php',
        ] as $path) {
            $source = (string) file_get_contents(app_path($path));
            $this->assertStringContainsString('TranscriptionService::transcribeForMember(', $source, $path);
            $this->assertStringNotContainsString('TranscriptionService::transcribe(', $source, $path);
        }
    }

    // ------------------------------------------------------------------
    //  Generation / translation endpoints
    // ------------------------------------------------------------------

    /** @return array<string, array{0: string}> */
    public static function entryPoints(): array
    {
        return [
            'listing description' => ['listing_description'],
            'marketplace description' => ['marketplace_description'],
            'marketplace auto-reply' => ['marketplace_auto_reply'],
            'job description' => ['job_description'],
            'message translation' => ['message_translate'],
            'federation message translation' => ['federation_translate'],
            'ugc translation' => ['ugc_translate'],
        ];
    }

    /** @dataProvider entryPoints */
    public function test_entry_point_makes_no_provider_request_when_ai_is_off(string $entry): void
    {
        $this->setAiEnabled(false);
        $user = $this->actingMember();

        $response = $this->hit($entry, $user);

        $this->assertContains($response->getStatusCode(), [403, 422, 503], $entry . ': ' . $response->getContent());
        $this->assertSame(0, $this->providerRequestCount(), $entry);
        $this->assertBudgetUsed($user, 0);
    }

    /** @dataProvider entryPoints */
    public function test_entry_point_is_refused_when_budget_is_spent(string $entry): void
    {
        $this->setAiEnabled(true);
        $user = $this->actingMember();
        $this->seedBudget($user, dailyLimit: 2, dailyUsed: 2);

        $response = $this->hit($entry, $user);

        $response->assertStatus(429);
        $response->assertJsonPath('errors.0.code', 'RATE_LIMIT');
        $this->assertSame(0, $this->providerRequestCount(), $entry);
    }

    /** @dataProvider entryPoints */
    public function test_entry_point_reaches_provider_and_consumes_budget_when_allowed(string $entry): void
    {
        $this->setAiEnabled(true);
        $user = $this->actingMember();
        $this->seedBudget($user, dailyLimit: 5, dailyUsed: 0);

        $response = $this->hit($entry, $user);

        $response->assertOk();
        $this->assertSame(1, $this->providerRequestCount(), $entry . ': ' . $response->getContent());
        $this->assertBudgetUsed($user, 1);
    }

    public function test_listing_notes_are_bounded_before_reaching_the_provider(): void
    {
        $this->setAiEnabled(true);
        $user = $this->actingMember();
        $this->seedBudget($user, dailyLimit: 5, dailyUsed: 0);

        $this->apiPost('/v2/listings/generate-description', [
            'title' => str_repeat('T', 5000),
            'notes' => str_repeat('N', 50000),
        ])->assertOk();

        $sent = Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com'));
        $this->assertCount(1, $sent);
        $prompt = (string) ($sent[0][0]->data()['messages'][1]['content'] ?? '');
        $this->assertLessThan(AiUsageGate::MAX_PROMPT_TEXT + 2000, mb_strlen($prompt));
        $this->assertStringNotContainsString(str_repeat('N', AiUsageGate::MAX_PROMPT_TEXT + 1), $prompt);
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    private function hit(string $entry, User $user): \Illuminate\Testing\TestResponse
    {
        switch ($entry) {
            case 'listing_description':
                return $this->apiPost('/v2/listings/generate-description', ['title' => 'Garden help', 'notes' => 'weekends']);

            case 'marketplace_description':
                return $this->apiPost('/v2/marketplace/listings/generate-description', ['title' => 'Bicycle']);

            case 'marketplace_auto_reply':
                $listingId = (int) DB::table('marketplace_listings')->insertGetId([
                    'tenant_id' => $this->testTenantId,
                    'user_id' => $user->id,
                    'title' => 'E035 widget',
                    'description' => 'A widget for sale',
                    'price' => 10.00,
                    'price_currency' => 'EUR',
                    'status' => 'active',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                return $this->apiPost("/v2/marketplace/listings/{$listingId}/auto-reply", ['message' => 'Is this still available?']);

            case 'job_description':
                return $this->apiPost('/v2/jobs/generate-description', ['title' => 'Community gardener', 'skills' => ['digging']]);

            case 'message_translate':
                $peer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
                $messageId = (int) DB::table('messages')->insertGetId([
                    'tenant_id' => $this->testTenantId,
                    'sender_id' => $peer->id,
                    'receiver_id' => $user->id,
                    'body' => 'Hola, ¿cómo estás?',
                    'created_at' => now(),
                ]);
                return $this->apiPost("/v2/messages/{$messageId}/translate", ['target_language' => 'en']);

            case 'federation_translate':
                $this->enableFederationForTenant($this->testTenantId);
                TenantContext::setById($this->testTenantId);
                $messageId = (int) DB::table('federation_messages')->insertGetId([
                    'sender_tenant_id' => $this->testTenantId,
                    'sender_user_id' => $user->id,
                    'receiver_tenant_id' => 999999,
                    'receiver_user_id' => 999999,
                    'external_partner_id' => null,
                    'subject' => 'E035',
                    'body' => 'Bonjour tout le monde',
                    'direction' => 'outbound',
                    'status' => 'delivered',
                    'created_at' => now(),
                ]);
                return $this->apiPost("/v2/federation/messages/{$messageId}/translate", ['target_language' => 'en']);

            case 'ugc_translate':
                return $this->apiPost('/v2/ugc-translate', [
                    'content_type' => 'feed_post',
                    'content_id' => 1,
                    'source_text' => 'E035 unique text ' . uniqid('', true),
                    'source_locale' => 'fr',
                    'target_locale' => 'en',
                ]);
        }

        $this->fail('Unknown entry point ' . $entry);
    }

    private function sendBase64Voice(User $receiver): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/messages/voice', [
            'receiver_id' => $receiver->id,
            'duration' => 3,
            'audio_data' => base64_encode($this->wav()),
            'mime_type' => 'audio/wav',
        ]);
    }

    /** @return array{0: User, 1: User} */
    private function pair(): array
    {
        $sender = $this->actingMember();
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        return [$sender, $receiver];
    }

    private function actingMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function setAiEnabled(bool $enabled): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $enabled ? '1' : '0', 'updated_at' => now()]
        );
        AIServiceFactory::clearCache();
        $this->assertSame($enabled, AIServiceFactory::isEnabled(), 'control: AI switch did not take effect');
    }

    private function seedBudget(User $user, int $dailyLimit, int $dailyUsed): void
    {
        DB::table('ai_user_limits')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id],
            [
                'daily_limit' => $dailyLimit,
                'daily_used' => $dailyUsed,
                'monthly_limit' => 100,
                'monthly_used' => $dailyUsed,
                'last_reset_daily' => now()->toDateString(),
                'last_reset_monthly' => now()->toDateString(),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function assertBudgetUsed(User $user, int $expected): void
    {
        $used = (int) (DB::table('ai_user_limits')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->value('daily_used') ?? 0);
        $this->assertSame($expected, $used, 'daily AI budget used');
    }

    private function providerRequestCount(): int
    {
        return count(Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com')));
    }

    private function wav(): string
    {
        $samples = str_repeat("\x00\x00", 800);
        $fmt = pack('vvVVvv', 1, 1, 8000, 16000, 2, 16);

        return 'RIFF' . pack('V', 36 + strlen($samples)) . 'WAVE'
            . 'fmt ' . pack('V', 16) . $fmt
            . 'data' . pack('V', strlen($samples)) . $samples;
    }
}
