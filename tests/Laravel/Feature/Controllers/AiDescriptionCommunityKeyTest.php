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
use App\Services\JobConfigurationService;
use App\Services\ListingConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 8 Nov 2026: the "Generate description" buttons (listings,
 * jobs, marketplace) use the community's OWN OpenAI key from Admin › AI
 * settings when one is saved, and the platform key (OPENAI_API_KEY) only when
 * the community has saved none.
 *
 * Until now every request used the platform key, whatever the community saved.
 *
 * No real provider is ever contacted: Http::preventStrayRequests() plus a fake.
 */
final class AiDescriptionCommunityKeyTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM_KEY = 'sk-platform-key-fake-not-real';
    private const COMMUNITY_KEY = 'sk-community-own-key-fake-not-real';
    private const OTHER_COMMUNITY_KEY = 'sk-other-community-key-fake-not-real';

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.openai.api_key' => self::PLATFORM_KEY]);
        Http::preventStrayRequests();

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        foreach (['marketplace', 'job_vacancies', 'listings'] as $feature) {
            $features[$feature] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        ListingConfigurationService::set(ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true);
        JobConfigurationService::set(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true);
        $this->saveAiSetting($this->testTenantId, 'ai_enabled', '1');
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
            'listing' => ['listing'],
            'job' => ['job'],
            'marketplace' => ['marketplace'],
        ];
    }

    /** @dataProvider generators */
    public function test_uses_the_community_own_key_when_one_is_saved(string $generator): void
    {
        $this->fakeOpenAiSuccess();
        $this->saveAiSetting($this->testTenantId, 'openai_api_key', self::COMMUNITY_KEY);
        $this->actingMember();

        $this->generate($generator)->assertOk()->assertJsonPath('data.description', 'FAKE DESCRIPTION');

        $this->assertSame(['Bearer ' . self::COMMUNITY_KEY], $this->authorizationHeadersSent());
    }

    /** @dataProvider generators */
    public function test_uses_the_platform_key_when_the_community_has_saved_none(string $generator): void
    {
        $this->fakeOpenAiSuccess();
        $this->actingMember();

        $this->generate($generator)->assertOk()->assertJsonPath('data.description', 'FAKE DESCRIPTION');

        $this->assertSame(['Bearer ' . self::PLATFORM_KEY], $this->authorizationHeadersSent());
    }

    public function test_a_blank_saved_key_counts_as_no_key(): void
    {
        $this->fakeOpenAiSuccess();
        $this->saveAiSetting($this->testTenantId, 'openai_api_key', '   ');
        $this->actingMember();

        $this->generate('listing')->assertOk();

        $this->assertSame(['Bearer ' . self::PLATFORM_KEY], $this->authorizationHeadersSent());
    }

    public function test_another_community_key_is_never_used(): void
    {
        $this->fakeOpenAiSuccess();
        $this->saveAiSetting(999_001, 'openai_api_key', self::OTHER_COMMUNITY_KEY);
        $this->actingMember();

        $this->generate('listing')->assertOk();

        $this->assertSame(['Bearer ' . self::PLATFORM_KEY], $this->authorizationHeadersSent());
    }

    public function test_a_rejected_community_key_fails_without_inventing_a_description_or_falling_back(): void
    {
        Http::fake([
            'api.openai.com/v1/chat/completions' => Http::response(
                ['error' => ['message' => 'Incorrect API key provided', 'type' => 'invalid_request_error']],
                401
            ),
        ]);
        $this->saveAiSetting($this->testTenantId, 'openai_api_key', self::COMMUNITY_KEY);
        $this->actingMember();

        $response = $this->generate('listing');

        $response->assertStatus(503);
        $response->assertJsonPath('errors.0.code', 'AI_SERVICE_ERROR');
        $this->assertStringNotContainsString('No response.', (string) $response->getContent());
        // One attempt, on the community's key. The platform key is not used to
        // paper over a broken community key.
        $this->assertSame(['Bearer ' . self::COMMUNITY_KEY], $this->authorizationHeadersSent());
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    private function generate(string $generator): \Illuminate\Testing\TestResponse
    {
        return match ($generator) {
            'listing' => $this->apiPost('/v2/listings/generate-description', ['title' => 'Garden help', 'notes' => 'weekends']),
            'job' => $this->apiPost('/v2/jobs/generate-description', ['title' => 'Community gardener', 'skills' => ['digging']]),
            'marketplace' => $this->apiPost('/v2/marketplace/listings/generate-description', ['title' => 'Bicycle']),
        };
    }

    private function fakeOpenAiSuccess(): void
    {
        Http::fake([
            'api.openai.com/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'FAKE DESCRIPTION']]],
            ], 200),
        ]);
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

    /** @return list<string> */
    private function authorizationHeadersSent(): array
    {
        return array_values(array_map(
            fn (array $pair) => $pair[0]->header('Authorization')[0] ?? '',
            Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), 'api.openai.com'))->all()
        ));
    }
}
