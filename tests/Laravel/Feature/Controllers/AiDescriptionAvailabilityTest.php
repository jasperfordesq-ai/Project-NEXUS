<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\AiDescriptionAvailability;
use App\Services\AI\CommunityOpenAiKey;
use App\Services\JobConfigurationService;
use App\Services\ListingConfigurationService;
use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 8 Nov 2026: the "Generate description" buttons (listings,
 * jobs, marketplace) show only when the community can actually use them, and
 * every switch involved is off by default.
 *
 * Available only when ALL hold: the community's AI is on, "Content generation"
 * is on, the area's own switch is on (listings, jobs), the community has saved
 * its own OpenAI key, and OpenAI has not refused that key (wrong key / no
 * credit) in the last 24 hours. The platform key is never used for these
 * buttons. The server refuses a request the buttons would not have offered.
 *
 * No real provider is ever contacted: Http::preventStrayRequests() plus a fake.
 */
final class AiDescriptionAvailabilityTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM_KEY = 'sk-platform-key-fake-not-real';
    private const COMMUNITY_KEY = 'sk-community-own-key-fake-not-real';
    private const OTHER_COMMUNITY_KEY = 'sk-other-community-key-fake-not-real';

    protected function setUp(): void
    {
        parent::setUp();

        // The platform key is configured so that any use of it would be visible.
        config(['services.openai.api_key' => self::PLATFORM_KEY]);
        Http::preventStrayRequests();

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        foreach (['marketplace', 'job_vacancies', 'listings'] as $feature) {
            $features[$feature] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        // A community that has switched everything on and saved its own key.
        $this->saveAiSetting($this->testTenantId, 'ai_enabled', '1');
        $this->saveAiSetting($this->testTenantId, AiDescriptionAvailability::CONTENT_GENERATION_SETTING, '1');
        $this->saveAiSetting($this->testTenantId, 'openai_api_key', self::COMMUNITY_KEY);
        ListingConfigurationService::set(ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true);
        JobConfigurationService::set(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true);
        AIServiceFactory::clearCache();
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    /** @return array<string, array{0: string}> */
    public static function generators(): array
    {
        return [
            'listing' => [AiDescriptionAvailability::LISTINGS],
            'job' => [AiDescriptionAvailability::JOBS],
            'marketplace' => [AiDescriptionAvailability::MARKETPLACE],
        ];
    }

    // ------------------------------------------------------------------
    //  Which buttons are offered
    // ------------------------------------------------------------------

    public function test_every_button_is_offered_when_everything_is_switched_on_and_a_key_is_saved(): void
    {
        $this->assertSame(
            ['listings' => true, 'jobs' => true, 'marketplace' => true],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_every_switch_is_off_by_default(): void
    {
        $this->assertFalse(ListingConfigurationService::DEFAULTS[ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS]);
        $this->assertFalse(JobConfigurationService::DEFAULTS[JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS]);

        // A community that has never touched its AI settings.
        DB::table('ai_settings')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', [ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS])
            ->delete();
        $this->forgetConfigCaches();

        $this->assertSame(
            ['listings' => false, 'jobs' => false, 'marketplace' => false],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function communityWideConditions(): array
    {
        return [
            'AI switched off' => ['ai_enabled', '0'],
            'content generation switched off' => [AiDescriptionAvailability::CONTENT_GENERATION_SETTING, '0'],
            'no key saved' => ['openai_api_key', ''],
            'blank key saved' => ['openai_api_key', '   '],
        ];
    }

    /** @dataProvider communityWideConditions */
    public function test_no_button_is_offered_when(string $setting, string $value): void
    {
        $this->saveAiSetting($this->testTenantId, $setting, $value);
        AIServiceFactory::clearCache();

        $this->assertSame(
            ['listings' => false, 'jobs' => false, 'marketplace' => false],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_the_listings_switch_only_hides_the_listings_button(): void
    {
        ListingConfigurationService::set(ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, false);

        $this->assertSame(
            ['listings' => false, 'jobs' => true, 'marketplace' => true],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_the_jobs_switch_only_hides_the_jobs_button(): void
    {
        JobConfigurationService::set(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, false);

        $this->assertSame(
            ['listings' => true, 'jobs' => false, 'marketplace' => true],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_another_community_key_does_not_count(): void
    {
        $this->saveAiSetting($this->testTenantId, 'openai_api_key', '');
        $this->saveAiSetting(999_001, 'openai_api_key', self::OTHER_COMMUNITY_KEY);

        $this->assertSame(
            ['listings' => false, 'jobs' => false, 'marketplace' => false],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_the_bootstrap_tells_the_apps_which_buttons_to_show(): void
    {
        JobConfigurationService::set(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, false);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        $response = $this->apiGet('/v2/tenant/bootstrap');

        $response->assertOk();
        $response->assertJsonPath('data.ai_descriptions', ['listings' => true, 'jobs' => false, 'marketplace' => true]);
    }

    // ------------------------------------------------------------------
    //  What the server does when asked to generate
    // ------------------------------------------------------------------

    /** @dataProvider generators */
    public function test_uses_the_community_own_key(string $generator): void
    {
        $this->fakeOpenAi(['choices' => [['message' => ['content' => 'FAKE DESCRIPTION']]]], 200);
        $this->actingMember();

        $this->generate($generator)->assertOk()->assertJsonPath('data.description', 'FAKE DESCRIPTION');

        $this->assertSame(['Bearer ' . self::COMMUNITY_KEY], $this->authorizationHeadersSent());
    }

    /** @dataProvider generators */
    public function test_without_a_community_key_the_request_is_refused_and_the_platform_key_is_never_used(string $generator): void
    {
        $this->fakeOpenAi(['choices' => [['message' => ['content' => 'FAKE DESCRIPTION']]]], 200);
        $this->saveAiSetting($this->testTenantId, 'openai_api_key', '');
        $this->actingMember();

        $response = $this->generate($generator);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertSame([], $this->authorizationHeadersSent());
    }

    /** @dataProvider generators */
    public function test_with_content_generation_off_the_request_is_refused(string $generator): void
    {
        $this->fakeOpenAi(['choices' => [['message' => ['content' => 'FAKE DESCRIPTION']]]], 200);
        $this->saveAiSetting($this->testTenantId, AiDescriptionAvailability::CONTENT_GENERATION_SETTING, '0');
        $this->actingMember();

        $this->generate($generator)->assertStatus(403);
        $this->assertSame([], $this->authorizationHeadersSent());
    }

    // ------------------------------------------------------------------
    //  A key OpenAI refuses switches the buttons off by itself
    // ------------------------------------------------------------------

    public function test_a_key_with_no_credit_hides_every_button_for_a_day_then_they_return(): void
    {
        $this->fakeOpenAi(['error' => ['message' => 'You exceeded your current quota.', 'type' => 'insufficient_quota', 'code' => 'insufficient_quota']], 429);
        $this->actingMember();

        $response = $this->generate(AiDescriptionAvailability::LISTINGS);

        $response->assertStatus(503);
        $response->assertJsonPath('errors.0.code', 'AI_SERVICE_ERROR');
        $this->assertStringNotContainsString('No response.', (string) $response->getContent());
        $this->assertSame(['Bearer ' . self::COMMUNITY_KEY], $this->authorizationHeadersSent(), 'one attempt, community key only');
        $this->assertSame(
            ['listings' => false, 'jobs' => false, 'marketplace' => false],
            AiDescriptionAvailability::forCurrentCommunity()
        );
        $this->assertSame('no_credit', DB::table('ai_settings')->where('tenant_id', $this->testTenantId)
            ->where('setting_key', CommunityOpenAiKey::REFUSED_REASON_SETTING)->value('setting_value'));

        $this->travel(CommunityOpenAiKey::REFUSAL_HOLD_HOURS + 1)->hours();

        $this->assertSame(
            ['listings' => true, 'jobs' => true, 'marketplace' => true],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_a_rejected_key_hides_every_button(): void
    {
        $this->fakeOpenAi(['error' => ['message' => 'Incorrect API key provided', 'type' => 'invalid_request_error', 'code' => 'invalid_api_key']], 401);
        $this->actingMember();

        $this->generate(AiDescriptionAvailability::JOBS)->assertStatus(503);

        $this->assertSame(
            ['listings' => false, 'jobs' => false, 'marketplace' => false],
            AiDescriptionAvailability::forCurrentCommunity()
        );
        // And the server refuses the next request without contacting OpenAI.
        $this->generate(AiDescriptionAvailability::MARKETPLACE)->assertStatus(403);
        $this->assertCount(1, $this->authorizationHeadersSent());
    }

    public function test_a_passing_rate_limit_does_not_hide_the_buttons(): void
    {
        $this->fakeOpenAi(['error' => ['message' => 'Rate limit reached', 'type' => 'requests', 'code' => 'rate_limit_exceeded']], 429);
        $this->actingMember();

        $this->generate(AiDescriptionAvailability::LISTINGS)->assertStatus(503);

        $this->assertSame(
            ['listings' => true, 'jobs' => true, 'marketplace' => true],
            AiDescriptionAvailability::forCurrentCommunity()
        );
    }

    public function test_saving_a_key_in_ai_settings_brings_the_buttons_back_at_once(): void
    {
        CommunityOpenAiKey::recordRefusal($this->testTenantId, 'no_credit');
        $this->assertFalse(AiDescriptionAvailability::isAvailable(AiDescriptionAvailability::LISTINGS));

        $admin = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'role' => 'admin']);
        Sanctum::actingAs($admin, ['*']);
        $this->apiPut('/v2/admin/config/ai', ['openai_api_key' => 'sk-topped-up-key-fake-not-real'])->assertOk();

        $this->assertTrue(AiDescriptionAvailability::isAvailable(AiDescriptionAvailability::LISTINGS));
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    private function generate(string $generator): \Illuminate\Testing\TestResponse
    {
        return match ($generator) {
            AiDescriptionAvailability::LISTINGS => $this->apiPost('/v2/listings/generate-description', ['title' => 'Garden help', 'notes' => 'weekends']),
            AiDescriptionAvailability::JOBS => $this->apiPost('/v2/jobs/generate-description', ['title' => 'Community gardener', 'skills' => ['digging']]),
            AiDescriptionAvailability::MARKETPLACE => $this->apiPost('/v2/marketplace/listings/generate-description', ['title' => 'Bicycle']),
        };
    }

    /** @param array<string, mixed> $body */
    private function fakeOpenAi(array $body, int $status): void
    {
        Http::fake(['api.openai.com/v1/chat/completions' => Http::response($body, $status)]);
    }

    private function actingMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        DB::table('ai_user_limits')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id],
            [
                'daily_limit' => 10,
                'daily_used' => 0,
                'monthly_limit' => 100,
                'monthly_used' => 0,
                'last_reset_daily' => now()->toDateString(),
                'last_reset_monthly' => now()->toDateString(),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        return $user;
    }

    private function saveAiSetting(int $tenantId, string $key, string $value): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
    }

    private function forgetConfigCaches(): void
    {
        Cache::forget("listing_config:{$this->testTenantId}");
        Cache::forget("job_config:{$this->testTenantId}");
    }

    /** @return list<string> */
    private function authorizationHeadersSent(): array
    {
        return array_values(array_map(
            fn (array $pair) => $pair[0]->header('Authorization')[0] ?? '',
            Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com'))->all()
        ));
    }
}
