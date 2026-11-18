<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\Contracts\AIProviderInterface;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Security register E-131 (deeper audit): the functions the admin AI settings
 * page lacked or got wrong.
 *
 * - No way to test a saved key: the only test endpoint (POST /ai/test-provider)
 *   sits behind the members' AI chat feature, answers a bare "failed", and no
 *   screen calls it.
 * - No way to remove a saved key.
 * - The self-hosted (Ollama) address defaulted to http://localhost:11434, which
 *   the server refuses, and could not be cleared.
 * (Who changed what is recorded: AiSettingsChangesAreRecordedTest, F-635.)
 *
 * Stand-in providers are planted in the factory; nothing leaves the test.
 */
final class AiSettingsPageFunctionsTest extends TestCase
{
    use DatabaseTransactions;

    private int $adminId;

    protected function setUp(): void
    {
        parent::setUp();
        AIServiceFactory::clearCache();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->adminId = (int) $admin->id;
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id,
            $admin->tenant_id,
            TwoFactorPolicy::claims('totp')
        )]);
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    public function test_a_working_key_is_reported_as_working(): void
    {
        $this->plant('anthropic', new TestStandInProvider(null));

        $this->apiPost('/v2/admin/config/ai/test', ['provider' => 'anthropic'])
            ->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.reason', null);
    }

    /** @return array<string, array{string, string}> */
    public static function failures(): array
    {
        return [
            'key refused' => ['AI API error (401): invalid x-api-key', 'key_refused'],
            'forbidden' => ['AI API error (403): permission denied', 'key_refused'],
            'unknown model' => ['AI API error (404): model: claude-x not found', 'model_not_found'],
            'no credit' => ['AI API error (429): insufficient_quota', 'no_credit'],
            'no key saved' => ["AI Provider 'anthropic' is not configured. Missing API key.", 'not_configured'],
            'cannot connect' => ['AI API request failed: Could not resolve host', 'unreachable'],
            'provider down' => ['AI API error (529): overloaded', 'provider_error'],
        ];
    }

    /** @dataProvider failures */
    public function test_a_failure_is_explained_without_the_providers_text(string $exception, string $reason): void
    {
        $this->plant('anthropic', new TestStandInProvider($exception));

        $response = $this->apiPost('/v2/admin/config/ai/test', ['provider' => 'anthropic'])
            ->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.reason', $reason);
        $this->assertStringNotContainsString('x-api-key', (string) $response->getContent());
    }

    public function test_testing_does_not_need_the_member_chat_feature(): void
    {
        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['ai_chat'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        $this->plant('openai', new TestStandInProvider(null));

        $this->apiPost('/v2/admin/config/ai/test', ['provider' => 'openai'])->assertOk()->assertJsonPath('data.ok', true);
    }

    public function test_only_admins_may_test_and_only_known_providers(): void
    {
        $this->apiPost('/v2/admin/config/ai/test', ['provider' => 'mystery'])->assertStatus(422);

        $this->withHeaders(['Authorization' => '']);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(), ['*']);
        $this->apiPost('/v2/admin/config/ai/test', ['provider' => 'openai'])->assertStatus(403);
    }

    public function test_a_saved_key_can_be_removed(): void
    {
        $this->apiPut('/v2/admin/config/ai', ['anthropic_api_key' => 'sk-ant-fake-not-real'])->assertOk();
        $this->apiPut('/v2/admin/config/ai', ['anthropic_api_key' => ''])->assertOk();

        $this->apiGet('/v2/admin/config/ai')
            ->assertOk()
            ->assertJsonPath('data.api_key_set.anthropic', false);
    }

    public function test_the_self_hosted_address_has_no_unusable_default_and_can_be_cleared(): void
    {
        DB::table('ai_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', 'ollama_host')->delete();
        $this->apiGet('/v2/admin/config/ai')->assertJsonPath('data.ollama.host', '');

        $this->apiPut('/v2/admin/config/ai', ['ollama_host' => ''])->assertOk();
    }

    private function plant(string $id, AIProviderInterface $provider): void
    {
        $instances = new \ReflectionProperty(AIServiceFactory::class, 'instances');
        $instances->setValue(null, [$id => $provider]);
    }
}

final class TestStandInProvider implements AIProviderInterface
{
    public function __construct(private ?string $throw)
    {
    }

    public function chat(array $messages, array $options = []): array
    {
        if ($this->throw !== null) {
            throw new \Exception($this->throw);
        }

        return ['content' => 'OK', 'model' => 'stand-in-model', 'tokens_input' => 1, 'tokens_output' => 1];
    }

    public function complete(string $prompt, array $options = []): string
    {
        return '';
    }

    public function streamChat(array $messages, callable $onChunk, array $options = []): void
    {
    }

    public function embed(string $text): array
    {
        return [];
    }

    public function getModels(): array
    {
        return [];
    }

    public function isConfigured(): bool
    {
        return true;
    }

    public function getId(): string
    {
        return 'stand-in';
    }

    public function getName(): string
    {
        return 'stand-in';
    }

    public function testConnection(): array
    {
        return ['success' => true, 'message' => '', 'latency_ms' => 0];
    }
}
