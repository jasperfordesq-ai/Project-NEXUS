<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\AiSettings;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\Contracts\AIProviderInterface;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 O-066 (found while remediating F-164). The seven /ai/generate/* endpoints
 * called AiUserLimit::canMakeRequest($userId) / incrementUsage($userId) with one
 * argument where both require (userId, tenantId), so every call threw before the
 * provider was reached. They now go through the shared AiUsageGate.
 */
final class AiChatGenerateEndpointsGateTest extends TestCase
{
    use DatabaseTransactions;

    private AIProviderInterface $fake;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        TenantContext::setById($this->testTenantId);
        foreach (['ai_enabled' => '1', 'ai_content_generation_enabled' => '1'] as $key => $value) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => $value, 'updated_at' => now()]
            );
        }
        AIServiceFactory::clearCache();
        $this->assertTrue(AIServiceFactory::isEnabled(), 'control: AI switch did not take effect');

        // The chat-path providers use raw curl, which Http::fake cannot intercept,
        // so inject an in-process fake provider: no network request is possible.
        AiSettings::setMultiple($this->testTenantId, ['ai_provider' => 'e035fake']);
        $this->fake = new class implements AIProviderInterface {
            public int $calls = 0;
            public function chat(array $messages, array $options = []): array { $this->calls++; return ['content' => 'E035 FAKE COMPLETION', 'tokens_input' => 1, 'tokens_output' => 1]; }
            public function complete(string $prompt, array $options = []): string { $this->calls++; return 'E035 FAKE COMPLETION'; }
            public function embed(string $text): array { return []; }
            public function streamChat(array $messages, callable $onChunk, array $options = []): void { $this->calls++; }
            public function getModels(): array { return []; }
            public function isConfigured(): bool { return true; }
            public function getName(): string { return 'E035 Fake'; }
            public function getId(): string { return 'e035fake'; }
            public function testConnection(): array { return ['success' => true]; }
        };
        $instances = new \ReflectionProperty(AIServiceFactory::class, 'instances');
        $instances->setAccessible(true);
        $instances->setValue(null, ['e035fake' => $this->fake]);
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    private function member(int $dailyLimit, int $dailyUsed): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('ai_user_limits')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id],
            [
                'daily_limit' => $dailyLimit, 'daily_used' => $dailyUsed,
                'monthly_limit' => 100, 'monthly_used' => $dailyUsed,
                'last_reset_daily' => now()->toDateString(), 'last_reset_monthly' => now()->toDateString(),
                'created_at' => now(), 'updated_at' => now(),
            ]
        );
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function used(User $user): int
    {
        return (int) (DB::table('ai_user_limits')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)->value('daily_used') ?? 0);
    }

    private function providerCalls(): int
    {
        return $this->fake->calls;
    }

    public function test_generate_listing_works_and_consumes_one_unit(): void
    {
        $user = $this->member(5, 0);

        $response = $this->apiPost('/ai/generate/listing', ['title' => 'Garden help', 'type' => 'offer']);

        $this->assertNotSame(500, $response->getStatusCode(), 'generate endpoint must not crash: ' . $response->getContent());
        $response->assertStatus(200);
        $this->assertSame(1, $this->providerCalls());
        $this->assertSame(1, $this->used($user));
    }

    public function test_generate_listing_is_refused_when_the_allowance_is_spent(): void
    {
        $user = $this->member(1, 1);

        $response = $this->apiPost('/ai/generate/listing', ['title' => 'Garden help', 'type' => 'offer']);

        $response->assertStatus(429);
        $this->assertSame(0, $this->providerCalls());
        $this->assertSame(1, $this->used($user));
    }

    public function test_no_generate_endpoint_uses_the_broken_one_argument_calls(): void
    {
        $source = (string) file_get_contents(app_path('Http/Controllers/Api/AiChatController.php'));
        $this->assertDoesNotMatchRegularExpression('/AiUserLimit::(canMakeRequest|incrementUsage)\(\$userId\)/', $source);
    }
}
