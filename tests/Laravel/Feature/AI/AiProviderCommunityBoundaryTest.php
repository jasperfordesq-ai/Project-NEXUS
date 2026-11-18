<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Core\TenantContext;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\Contracts\AIProviderInterface;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-628 (security register E-131): AIServiceFactory cached each provider
 * object by provider id alone. A long-lived process that serves several
 * communities in turn — the hourly `agents:run`, a Horizon worker running
 * GenerateMatchExplanationsJob — then handed community B the provider built
 * from community A's settings: A's API key, A's model, A's Ollama address,
 * with B's member data.
 *
 * A web request is one community, so the tests switch community the way those
 * processes do (TenantContext::runForTenant) without clearing the cache.
 * No provider is ever contacted: only the constructed object is inspected.
 */
final class AiProviderCommunityBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    private const KEY_A = 'sk-community-a-fake-not-real';
    private const KEY_B = 'sk-community-b-fake-not-real';

    private int $tenantA;
    private int $tenantB;

    protected function setUp(): void
    {
        parent::setUp();
        AIServiceFactory::clearCache();

        $this->tenantA = $this->testTenantId;
        $this->tenantB = (int) DB::table('tenants')->insertGetId([
            'name' => 'AI boundary community B',
            'slug' => 'ai-boundary-b-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->saveAiSetting($this->tenantA, 'openai_api_key', self::KEY_A);
        $this->saveAiSetting($this->tenantA, 'openai_model', 'model-of-a');
        $this->saveAiSetting($this->tenantB, 'openai_api_key', self::KEY_B);
        $this->saveAiSetting($this->tenantB, 'openai_model', 'model-of-b');
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        TenantContext::setById($this->testTenantId);
        parent::tearDown();
    }

    public function test_a_second_community_in_the_same_process_gets_its_own_key_and_model(): void
    {
        $forA = TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('openai'));
        $forB = TenantContext::runForTenant($this->tenantB, fn () => AIServiceFactory::getProvider('openai'));

        $this->assertSame(self::KEY_A, $this->field($forA, 'apiKey'));
        $this->assertSame(self::KEY_B, $this->field($forB, 'apiKey'), "community B was given community A's API key");
        $this->assertSame('model-of-b', $this->field($forB, 'defaultModel'));
    }

    public function test_a_community_without_a_key_is_not_given_another_communitys_key(): void
    {
        $this->saveAiSetting($this->tenantB, 'openai_api_key', '');

        TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('openai'));

        $this->expectException(\Exception::class);
        $this->expectExceptionMessage('Missing API key');
        TenantContext::runForTenant($this->tenantB, fn () => AIServiceFactory::getProvider('openai'));
    }

    public function test_a_second_community_does_not_get_another_communitys_ollama_address(): void
    {
        $this->saveAiSetting($this->tenantA, 'ollama_host', 'https://ollama-a.example.org');
        $this->saveAiSetting($this->tenantB, 'ollama_host', 'https://ollama-b.example.org');

        TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('ollama'));
        $forB = TenantContext::runForTenant($this->tenantB, fn () => AIServiceFactory::getProvider('ollama'));

        $this->assertStringStartsWith('https://ollama-b.example.org', $this->field($forB, 'apiUrl'));
    }

    public function test_a_key_changed_by_an_admin_is_used_without_restarting_the_process(): void
    {
        TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('openai'));
        $this->saveAiSetting($this->tenantA, 'openai_api_key', 'sk-community-a-new-fake-not-real');

        $again = TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('openai'));

        $this->assertSame('sk-community-a-new-fake-not-real', $this->field($again, 'apiKey'));
    }

    public function test_the_same_community_and_settings_reuse_one_object(): void
    {
        $first = TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('openai'));
        $second = TenantContext::runForTenant($this->tenantA, fn () => AIServiceFactory::getProvider('openai'));

        $this->assertSame($first, $second);
    }

    private function field(AIProviderInterface $provider, string $name): string
    {
        $property = new \ReflectionProperty($provider, $name);

        return (string) $property->getValue($provider);
    }

    private function saveAiSetting(int $tenantId, string $key, string $value): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
    }
}
