<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * Security register E-131: what the admin "AI settings" page saves must be
 * what the code reads. Every assertion here goes through the real endpoint
 * the page calls, `PUT /v2/admin/config/ai`, never a hand-seeded row — the
 * older tests seeded `ai_content_generation_enabled`, a key no screen
 * writes, and so never noticed that the page's "Content generation" switch
 * (`ai_content_gen_enabled`) reached nothing in `AIServiceFactory`.
 */
final class AiSettingsPageWiringTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        AIServiceFactory::clearCache();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
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

    public function test_the_content_generation_switch_on_the_page_turns_content_generation_on(): void
    {
        $this->apiPut('/v2/admin/config/ai', ['ai_enabled' => true, 'ai_content_gen_enabled' => true])->assertOk();

        TenantContext::setById($this->testTenantId);
        $this->assertTrue(AIServiceFactory::isFeatureEnabled('content_generation'));
    }

    public function test_the_content_generation_switch_on_the_page_turns_content_generation_off(): void
    {
        $this->apiPut('/v2/admin/config/ai', ['ai_enabled' => true, 'ai_content_gen_enabled' => false])->assertOk();

        TenantContext::setById($this->testTenantId);
        $this->assertFalse(AIServiceFactory::isFeatureEnabled('content_generation'));
    }

    public function test_the_chat_switch_on_the_page_reaches_the_chat_check(): void
    {
        $this->apiPut('/v2/admin/config/ai', ['ai_enabled' => true, 'ai_chat_enabled' => false])->assertOk();
        TenantContext::setById($this->testTenantId);
        $this->assertFalse(AIServiceFactory::isFeatureEnabled('chat'));

        $this->apiPut('/v2/admin/config/ai', ['ai_chat_enabled' => true])->assertOk();
        $this->assertTrue(AIServiceFactory::isFeatureEnabled('chat'));
    }

    public function test_the_provider_chosen_on_the_page_is_the_provider_used(): void
    {
        $this->apiPut('/v2/admin/config/ai', ['ai_provider' => 'anthropic'])->assertOk();

        TenantContext::setById($this->testTenantId);
        $this->assertSame('anthropic', AIServiceFactory::getDefaultProvider());
    }
}
