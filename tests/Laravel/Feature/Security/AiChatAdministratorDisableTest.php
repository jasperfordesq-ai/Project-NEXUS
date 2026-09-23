<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\JobVacancy;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\Contracts\AIProviderInterface;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class AiChatAdministratorDisableTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    public function test_member_chat_does_not_dispatch_primary_or_fallback_when_master_ai_is_disabled(): void
    {
        [$primary, $fallback] = $this->installRetainedProviders();
        $this->setAiSettings(false, true);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/ai/chat', ['message' => 'Can you help me?']);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertSame(0, $primary->chatCalls);
        $this->assertSame(0, $fallback->chatCalls);
        $this->assertDatabaseMissing('ai_conversations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
    }

    public function test_member_chat_does_not_dispatch_primary_or_fallback_when_chat_is_disabled(): void
    {
        [$primary, $fallback] = $this->installRetainedProviders();
        $this->setAiSettings(true, false);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/ai/chat', ['message' => 'Can you help me?']);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertSame(0, $primary->chatCalls);
        $this->assertSame(0, $fallback->chatCalls);
        $this->assertDatabaseMissing('ai_conversations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
    }

    public function test_malformed_chat_switch_fails_closed_when_master_ai_is_enabled(): void
    {
        [$primary, $fallback] = $this->installRetainedProviders();
        $this->setRawAiSettings('1', 'unexpected-value');
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $this->apiPost('/ai/chat', ['message' => 'Can you help me?'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertSame(0, $primary->chatCalls);
        $this->assertSame(0, $fallback->chatCalls);
    }

    public function test_job_chat_obeys_the_chat_switch_before_dispatch(): void
    {
        [$primary, $fallback] = $this->installRetainedProviders();
        $this->setAiSettings(true, false);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $vacancy = JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost("/v2/jobs/{$vacancy->id}/ai-chat", [
            'message' => 'How should I apply?',
        ]);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertSame(0, $primary->chatCalls);
        $this->assertSame(0, $fallback->chatCalls);
    }

    public function test_enabled_chat_can_fall_back_to_a_retained_provider(): void
    {
        [$primary, $fallback] = $this->installRetainedProviders();
        $this->setAiSettings(true, true);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/ai/chat', ['message' => 'Can you help me?']);

        $response->assertOk()->assertJsonPath('data.message.content', 'Fallback answer');
        $this->assertSame(1, $primary->chatCalls);
        $this->assertSame(1, $fallback->chatCalls);
    }

    private function setAiSettings(bool $masterEnabled, bool $chatEnabled): void
    {
        $this->setRawAiSettings($masterEnabled ? '1' : '0', $chatEnabled ? '1' : '0');
    }

    private function setRawAiSettings(string $masterEnabled, string $chatEnabled): void
    {
        foreach ([
            'ai_enabled' => $masterEnabled,
            'ai_chat_enabled' => $chatEnabled,
            'ai_provider' => 'gemini',
            'gemini_api_key' => 'retained-primary-key',
            'openai_api_key' => 'retained-fallback-key',
        ] as $key => $value) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => $value, 'updated_at' => now()]
            );
        }
    }

    /** @return array{FailingAiProvider, SuccessfulAiProvider} */
    private function installRetainedProviders(): array
    {
        $primary = new FailingAiProvider('gemini');
        $fallback = new SuccessfulAiProvider('openai');
        $reflection = new \ReflectionClass(AIServiceFactory::class);

        $instances = $reflection->getProperty('instances');
        $instances->setValue(null, ['gemini' => $primary, 'openai' => $fallback]);

        $config = $reflection->getProperty('config');
        $config->setValue(null, [
            'enabled' => true,
            'default_provider' => 'gemini',
            'features' => ['chat' => true],
            'providers' => [
                'gemini' => ['free_tier' => false],
                'openai' => ['free_tier' => false],
            ],
            'limits' => [],
        ]);

        return [$primary, $fallback];
    }
}

abstract class RecordingAiProvider implements AIProviderInterface
{
    public int $chatCalls = 0;

    public function __construct(private readonly string $id) {}
    public function complete(string $prompt, array $options = []): string { return ''; }
    public function embed(string $text): array { return []; }
    public function streamChat(array $messages, callable $onChunk, array $options = []): void {}
    public function getModels(): array { return []; }
    public function isConfigured(): bool { return true; }
    public function getName(): string { return $this->id; }
    public function getId(): string { return $this->id; }
    public function testConnection(): array { return ['success' => true, 'message' => 'ok', 'latency_ms' => 0]; }
}

final class FailingAiProvider extends RecordingAiProvider
{
    public function chat(array $messages, array $options = []): array
    {
        $this->chatCalls++;
        throw new \RuntimeException('Synthetic primary failure');
    }
}

final class SuccessfulAiProvider extends RecordingAiProvider
{
    public function chat(array $messages, array $options = []): array
    {
        $this->chatCalls++;
        return [
            'content' => 'Fallback answer',
            'tokens_used' => 3,
            'tokens_input' => 2,
            'tokens_output' => 1,
            'model' => 'synthetic-model',
        ];
    }
}
