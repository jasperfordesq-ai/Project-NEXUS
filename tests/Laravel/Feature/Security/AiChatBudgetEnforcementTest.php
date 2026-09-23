<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\JobVacancy;
use App\Models\AiUserLimit;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\Contracts\AIProviderInterface;
use App\Services\EmbeddingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class AiChatBudgetEnforcementTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    public function test_exhausted_member_budget_blocks_general_chat_before_provider_or_persistence(): void
    {
        $provider = $this->installProvider();
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        $this->seedBudget($user, dailyLimit: 1, dailyUsed: 1);

        $this->apiPost('/ai/chat', ['message' => 'Please use the provider'])
            ->assertStatus(429)
            ->assertJsonPath('errors.0.code', 'RATE_LIMIT');

        $this->assertSame(0, $provider->chatCalls);
        $this->assertDatabaseMissing('ai_conversations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
    }

    public function test_exhausted_member_budget_blocks_job_chat_before_provider(): void
    {
        $provider = $this->installProvider();
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        $this->seedBudget($user, monthlyLimit: 1, monthlyUsed: 1);
        $vacancy = JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $this->apiPost("/v2/jobs/{$vacancy->id}/ai-chat", ['message' => 'How should I apply?'])
            ->assertStatus(429)
            ->assertJsonPath('errors.0.code', 'RATE_LIMIT');

        $this->assertSame(0, $provider->chatCalls);
    }

    public function test_successful_chat_atomically_consumes_the_last_available_slot(): void
    {
        $provider = $this->installProvider();
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        $this->seedBudget($user, dailyLimit: 1, dailyUsed: 0);

        $this->apiPost('/ai/chat', ['message' => 'Use my final slot'])
            ->assertOk()
            ->assertJsonPath('data.limits.daily_remaining', 0)
            ->assertJsonPath('data.limits.monthly_remaining', 99);

        $this->assertSame(1, $provider->chatCalls);
        $this->assertDatabaseHas('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'daily_used' => 1,
            'monthly_used' => 1,
        ]);
    }

    public function test_primary_failure_and_fallback_consume_two_provider_attempts(): void
    {
        [$primary, $fallback] = $this->installFallbackProviders();
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        $this->seedBudget($user, dailyLimit: 2, dailyUsed: 0);

        $this->apiPost('/ai/chat', ['message' => 'Use fallback'])->assertOk();

        $this->assertSame(1, $primary->chatCalls);
        $this->assertSame(1, $fallback->chatCalls);
        $this->assertDatabaseHas('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'daily_used' => 2,
            'monthly_used' => 2,
        ]);
    }

    public function test_tool_hop_cannot_dispatch_after_the_last_budget_slot(): void
    {
        $provider = $this->installProvider([[
            'content' => '',
            'tokens_used' => 1,
            'tokens_input' => 1,
            'tokens_output' => 0,
            'model' => 'synthetic-model',
            'tool_calls' => [[
                'id' => 'synthetic_tool_call',
                'name' => 'get_my_wallet_balance',
                'arguments' => [],
            ]],
        ]]);
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        $this->seedBudget($user, dailyLimit: 1, dailyUsed: 0);

        $this->apiPost('/ai/chat', ['message' => 'What is my balance?'])
            ->assertOk()
            ->assertJsonPath('data.success', false)
            ->assertJsonPath('data.limits.allowed', false);

        $this->assertSame(1, $provider->chatCalls);
        $this->assertDatabaseHas('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'daily_used' => 1,
            'monthly_used' => 1,
        ]);
        $conversationId = (int) DB::table('ai_conversations')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->value('id');
        $this->assertGreaterThan(0, $conversationId);
        $this->assertSame(2, DB::table('ai_messages')->where('conversation_id', $conversationId)->count());
        $this->assertSame(
            __('api.ai_rate_limit'),
            DB::table('ai_messages')->where('conversation_id', $conversationId)->orderByDesc('id')->value('content')
        );
    }

    public function test_semantic_search_embedding_cannot_dispatch_after_the_last_budget_slot(): void
    {
        $provider = $this->installProvider([[
            'content' => '',
            'tokens_used' => 1,
            'tokens_input' => 1,
            'tokens_output' => 0,
            'model' => 'synthetic-model',
            'tool_calls' => [[
                'id' => 'synthetic_semantic_call',
                'name' => 'semantic_search',
                'arguments' => ['query' => 'gardening help'],
            ]],
        ]]);
        $embeddings = new BudgetRecordingEmbeddingService();
        $this->app->instance(EmbeddingService::class, $embeddings);
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        $this->seedBudget($user, dailyLimit: 1, dailyUsed: 0);

        $this->apiPost('/ai/chat', ['message' => 'Find gardening help'])
            ->assertOk()
            ->assertJsonPath('data.success', false)
            ->assertJsonPath('data.limits.allowed', false);

        $this->assertSame(1, $provider->chatCalls);
        $this->assertSame(0, $embeddings->semanticSearchCalls);
        $this->assertDatabaseHas('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'daily_used' => 1,
            'monthly_used' => 1,
        ]);
    }

    public function test_empty_semantic_search_does_not_consume_a_provider_budget_slot(): void
    {
        $this->assertNoopSemanticSearchDoesNotConsumeBudget('', true);
    }

    public function test_semantic_search_without_an_embedding_key_does_not_consume_a_provider_budget_slot(): void
    {
        $this->assertNoopSemanticSearchDoesNotConsumeBudget('gardening help', false);
    }

    public function test_invalid_general_chat_does_not_create_or_consume_a_budget(): void
    {
        $this->installProvider();
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();

        $this->apiPost('/ai/chat', [])->assertStatus(400);

        $this->assertDatabaseMissing('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
    }

    public function test_missing_job_does_not_create_or_consume_a_budget(): void
    {
        $this->installProvider();
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();

        $this->apiPost('/v2/jobs/987654321/ai-chat', ['message' => 'Hello'])->assertNotFound();

        $this->assertDatabaseMissing('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
    }

    public function test_providerless_failure_omits_limits_and_does_not_consume_a_budget(): void
    {
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        DB::table('ai_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'gemini_api_key')
            ->delete();
        $reflection = new \ReflectionClass(AIServiceFactory::class);
        $reflection->getProperty('instances')->setValue(null, []);
        $reflection->getProperty('config')->setValue(null, [
            'enabled' => true,
            'default_provider' => 'gemini',
            'features' => ['chat' => true],
            'providers' => ['gemini' => ['free_tier' => true]],
            'limits' => [],
        ]);

        $response = $this->apiPost('/ai/chat', ['message' => 'No provider is configured']);

        $response->assertOk()->assertJsonMissingPath('data.limits');
        $this->assertDatabaseMissing('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
    }

    public function test_new_limit_row_inherits_tenant_defaults(): void
    {
        $user = $this->authenticatedUser();
        foreach (['default_daily_limit' => '2', 'default_monthly_limit' => '3'] as $key => $value) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => $value, 'updated_at' => now()]
            );
        }

        $result = AiUserLimit::admitRequest((int) $user->id, $this->testTenantId);

        $this->assertTrue($result['allowed']);
        $this->assertSame(2, $result['daily_limit']);
        $this->assertSame(3, $result['monthly_limit']);
        $this->assertSame(1, $result['daily_used']);
        $this->assertSame(1, $result['monthly_used']);
    }

    public function test_atomic_admission_resets_stale_daily_and_monthly_windows(): void
    {
        $user = $this->authenticatedUser();
        $this->seedBudget($user, dailyLimit: 1, dailyUsed: 1, monthlyLimit: 1, monthlyUsed: 1);
        DB::table('ai_user_limits')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->update([
                'last_reset_daily' => now()->subDay()->toDateString(),
                'last_reset_monthly' => now()->subMonth()->toDateString(),
            ]);

        $result = AiUserLimit::admitRequest((int) $user->id, $this->testTenantId);

        $this->assertTrue($result['allowed']);
        $this->assertSame(1, $result['daily_used']);
        $this->assertSame(1, $result['monthly_used']);
        $this->assertSame(0, $result['daily_remaining']);
        $this->assertSame(0, $result['monthly_remaining']);
    }

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function seedEnabledChat(): void
    {
        foreach ([
            'ai_enabled' => '1',
            'ai_chat_enabled' => '1',
            'ai_provider' => 'gemini',
            'gemini_api_key' => 'synthetic-retained-key',
        ] as $key => $value) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => $value, 'updated_at' => now()]
            );
        }
    }

    private function seedBudget(
        User $user,
        int $dailyLimit = 10,
        int $dailyUsed = 0,
        int $monthlyLimit = 100,
        int $monthlyUsed = 0,
    ): void {
        DB::table('ai_user_limits')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id],
            [
                'daily_limit' => $dailyLimit,
                'daily_used' => $dailyUsed,
                'monthly_limit' => $monthlyLimit,
                'monthly_used' => $monthlyUsed,
                'last_reset_daily' => now()->toDateString(),
                'last_reset_monthly' => now()->toDateString(),
                'updated_at' => now(),
            ]
        );
    }

    private function assertNoopSemanticSearchDoesNotConsumeBudget(string $query, bool $withOpenAiKey): void
    {
        $provider = $this->installProvider([
            [
                'content' => '',
                'tokens_used' => 1,
                'tokens_input' => 1,
                'tokens_output' => 0,
                'model' => 'synthetic-model',
                'tool_calls' => [[
                    'id' => 'synthetic_semantic_call',
                    'name' => 'semantic_search',
                    'arguments' => ['query' => $query],
                ]],
            ],
            [
                'content' => 'Synthetic answer after no-op search',
                'tokens_used' => 1,
                'tokens_input' => 1,
                'tokens_output' => 1,
                'model' => 'synthetic-model',
            ],
        ]);
        $user = $this->authenticatedUser();
        $this->seedEnabledChat();
        if ($withOpenAiKey) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => 'openai_api_key'],
                ['setting_value' => 'synthetic-retained-key', 'updated_at' => now()]
            );
        } else {
            DB::table('ai_settings')
                ->where('tenant_id', $this->testTenantId)
                ->where('setting_key', 'openai_api_key')
                ->delete();
        }
        $this->seedBudget($user, dailyLimit: 2, dailyUsed: 0);

        $this->apiPost('/ai/chat', ['message' => 'Find gardening help'])
            ->assertOk()
            ->assertJsonPath('data.success', true)
            ->assertJsonPath('data.limits.daily_used', 2);

        $this->assertSame(2, $provider->chatCalls);
        $this->assertDatabaseHas('ai_user_limits', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'daily_used' => 2,
            'monthly_used' => 2,
        ]);
    }

    /** @param list<array<string, mixed>> $responses */
    private function installProvider(array $responses = []): BudgetRecordingAiProvider
    {
        $provider = new BudgetRecordingAiProvider($responses);
        $this->installProviderInstances(['gemini' => $provider]);

        return $provider;
    }

    /** @return array{BudgetFailingAiProvider, BudgetRecordingAiProvider} */
    private function installFallbackProviders(): array
    {
        $primary = new BudgetFailingAiProvider();
        $fallback = new BudgetRecordingAiProvider();
        $this->installProviderInstances(['gemini' => $primary, 'openai' => $fallback]);

        return [$primary, $fallback];
    }

    /** @param array<string, AIProviderInterface> $instances */
    private function installProviderInstances(array $instances): void
    {
        $reflection = new \ReflectionClass(AIServiceFactory::class);
        $reflection->getProperty('instances')->setValue(null, $instances);
        $reflection->getProperty('config')->setValue(null, [
            'enabled' => true,
            'default_provider' => 'gemini',
            'features' => ['chat' => true],
            'providers' => array_map(
                static fn (): array => ['free_tier' => false],
                $instances
            ),
            'limits' => [],
        ]);
    }
}

class BudgetRecordingAiProvider implements AIProviderInterface
{
    public int $chatCalls = 0;

    /** @param list<array<string, mixed>> $responses */
    public function __construct(private array $responses = []) {}

    public function chat(array $messages, array $options = []): array
    {
        $this->chatCalls++;
        return array_shift($this->responses) ?? [
            'content' => 'Synthetic answer',
            'tokens_used' => 3,
            'tokens_input' => 2,
            'tokens_output' => 1,
            'model' => 'synthetic-model',
        ];
    }

    public function complete(string $prompt, array $options = []): string { return ''; }
    public function embed(string $text): array { return []; }
    public function streamChat(array $messages, callable $onChunk, array $options = []): void {}
    public function getModels(): array { return []; }
    public function isConfigured(): bool { return true; }
    public function getName(): string { return 'Synthetic'; }
    public function getId(): string { return 'gemini'; }
    public function testConnection(): array { return ['success' => true, 'message' => 'ok', 'latency_ms' => 0]; }
}

final class BudgetFailingAiProvider extends BudgetRecordingAiProvider
{
    public function chat(array $messages, array $options = []): array
    {
        $this->chatCalls++;
        throw new \RuntimeException('Synthetic primary failure');
    }
}

final class BudgetRecordingEmbeddingService extends EmbeddingService
{
    public int $semanticSearchCalls = 0;

    public function semanticSearch(
        string $query,
        int $tenantId,
        array $contentTypes = [],
        int $limit = 10,
        int $candidateCap = 2000,
        ?callable $beforeProviderCall = null,
    ): array {
        if ($beforeProviderCall !== null) {
            $beforeProviderCall('synthetic_embeddings');
        }
        $this->semanticSearchCalls++;
        return [];
    }
}
