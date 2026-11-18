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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Security register E-131 (deeper audit): the marketplace "suggest a reply"
 * (AI writes a seller's reply to a buyer) checked the community's main AI
 * switch and allowance but not "Content generation", the admin page switch
 * described as "AI-assisted drafting of posts, listings, and messages". So a
 * community that switched drafting off still had AI writing replies.
 *
 * Http::fake() answers; nothing leaves the test.
 */
final class MarketplaceAutoReplyFollowsContentSwitchTest extends TestCase
{
    use DatabaseTransactions;

    private int $listingId;

    protected function setUp(): void
    {
        parent::setUp();
        AIServiceFactory::clearCache();
        Http::preventStrayRequests();
        Http::fake(['api.openai.com/*' => Http::response(['choices' => [['message' => ['content' => 'Yes, still available.']]]])]);

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['marketplace'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $this->saveAiSetting('ai_enabled', '1');
        $this->saveAiSetting('openai_api_key', 'sk-community-key-fake-not-real');

        $seller = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'title' => 'Bicycle',
            'description' => 'A red bicycle',
            'price' => 10.00,
            'price_currency' => 'EUR',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($seller, ['*']);
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    public function test_with_content_generation_off_no_reply_is_written(): void
    {
        $this->saveAiSetting('ai_content_gen_enabled', '0');

        $this->apiPost("/v2/marketplace/listings/{$this->listingId}/auto-reply", ['message' => 'Is this still available?'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        Http::assertNothingSent();
        $this->assertSame(0, (int) DB::table('ai_user_limits')->where('tenant_id', $this->testTenantId)->sum('daily_used'));
    }

    public function test_with_content_generation_on_a_reply_is_written(): void
    {
        $this->saveAiSetting('ai_content_gen_enabled', '1');

        $this->apiPost("/v2/marketplace/listings/{$this->listingId}/auto-reply", ['message' => 'Is this still available?'])
            ->assertOk();

        Http::assertSentCount(1);
    }

    private function saveAiSetting(string $key, string $value): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
    }
}
