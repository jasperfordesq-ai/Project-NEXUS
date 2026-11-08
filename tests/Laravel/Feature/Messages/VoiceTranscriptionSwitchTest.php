<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Messages;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\TranscriptionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 8 Nov 2026: voice-message transcription is disabled for the
 * whole platform. A voice message is still stored, sent and playable; the
 * recording is never sent to a speech-to-text provider and no AI allowance is
 * used — even in a community with AI switched on, a key configured and
 * allowance left. The platform switch (`services.openai.voice_transcription`,
 * env VOICE_TRANSCRIPTION_ENABLED) is off unless deliberately turned on.
 *
 * No real provider is ever contacted: Http::preventStrayRequests() plus a fake.
 */
final class VoiceTranscriptionSwitchTest extends TestCase
{
    use DatabaseTransactions;

    private string $storage = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->storage = sys_get_temp_dir() . '/nexus-voice-switch-test-' . bin2hex(random_bytes(6)) . '/storage';
        @mkdir($this->storage, 0777, true);
        $this->app->useStoragePath($this->storage);

        // Everything that used to allow transcription is in place.
        config(['services.openai.api_key' => 'sk-platform-key-fake-not-real']);
        Http::preventStrayRequests();
        Http::fake([
            'api.openai.com/v1/audio/transcriptions' => Http::response(['text' => 'FAKE TRANSCRIPT', 'language' => 'en'], 200),
        ]);

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['messages'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => '1', 'updated_at' => now()]
        );
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

    public function test_transcription_is_off_unless_deliberately_switched_on(): void
    {
        $this->assertFalse(TranscriptionService::isTranscriptionEnabled());
    }

    public function test_a_voice_message_is_sent_but_never_transcribed(): void
    {
        [$sender, $receiver] = $this->pair();
        $this->seedBudget($sender);

        $response = $this->sendBase64Voice($receiver);

        $response->assertStatus(201);
        $messageId = (int) $response->json('data.message_id');
        $this->assertGreaterThan(0, $messageId);
        $this->assertNotNull(DB::table('messages')->where('id', $messageId)->value('audio_url'));
        $this->assertNull($response->json('data.transcript'));
        $this->assertNull(DB::table('messages')->where('id', $messageId)->value('transcript'));
        $this->assertSame(0, $this->providerRequestCount(), 'the recording must not leave the platform');
        $this->assertBudgetUsed($sender, 0);
    }

    public function test_the_transcription_helpers_send_nothing(): void
    {
        [$sender] = $this->pair();
        $this->seedBudget($sender);
        $file = $this->storage . '/voice-probe.wav';
        file_put_contents($file, $this->wav());

        $this->assertNull(TranscriptionService::transcribeForMember((int) $sender->id, $file));
        $this->assertNull(TranscriptionService::transcribe($file));

        $this->assertSame(0, $this->providerRequestCount());
        $this->assertBudgetUsed($sender, 0);
    }

    public function test_switching_it_back_on_restores_transcription(): void
    {
        config(['services.openai.voice_transcription' => true]);
        [$sender, $receiver] = $this->pair();
        $this->seedBudget($sender);

        $response = $this->sendBase64Voice($receiver);

        $response->assertStatus(201);
        $this->assertSame('FAKE TRANSCRIPT', $response->json('data.transcript'));
        $this->assertSame(1, $this->providerRequestCount());
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    /** @return array{0: User, 1: User} */
    private function pair(): array
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($sender, ['*']);

        return [$sender, $receiver];
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

    private function seedBudget(User $user): void
    {
        DB::table('ai_user_limits')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id],
            [
                'daily_limit' => 5,
                'daily_used' => 0,
                'monthly_limit' => 100,
                'monthly_used' => 0,
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
        $this->assertSame($expected, $used, 'daily AI allowance used');
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
