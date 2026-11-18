<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Models\JobVacancy;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-632 (security register E-131): after every job application with a CV,
 * the website and the accessible site call GET /v2/jobs/applications/{id}/parse-cv,
 * and AiChatService::parseResume() sent the CV's text to OpenAI on the
 * PLATFORM's key — whatever the community's main AI switch said, and against
 * the owner's rule that AI keys are per community (8 and 18 Nov 2026).
 *
 * No real provider is contacted: Http::fake() answers and records.
 */
final class CvReadingRespectsCommunityAiTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM_KEY = 'sk-platform-key-fake-not-real';
    private const COMMUNITY_KEY = 'sk-community-key-fake-not-real';

    private int $applicationId;

    protected function setUp(): void
    {
        parent::setUp();
        AIServiceFactory::clearCache();
        config(['services.openai.api_key' => self::PLATFORM_KEY]);
        Storage::fake('local');
        Http::preventStrayRequests();
        Http::fake(['api.openai.com/*' => Http::response([
            'choices' => [['message' => ['content' => '{"skills":["Gardening"],"years_experience":3,"job_titles":[],"education":[],"summary":"Gardener"}']]],
        ])]);

        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $applicant = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $vacancy = JobVacancy::factory()->forTenant($this->testTenantId)->create(['user_id' => $owner->id, 'status' => 'open']);

        Storage::disk('local')->put('cvs/test-cv.txt', "Jane Example\nGardener, 3 years\nSkills: gardening, pruning");
        $this->applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'vacancy_id' => $vacancy->id,
            'user_id' => $applicant->id,
            'message' => 'Hello',
            'cv_path' => 'cvs/test-cv.txt',
            'status' => 'applied',
            'stage' => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($applicant, ['*']);
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    public function test_nothing_is_sent_while_the_communitys_ai_is_off(): void
    {
        $this->saveAiSetting('ai_enabled', '0');
        $this->saveAiSetting('openai_api_key', self::COMMUNITY_KEY);

        $this->apiGet("/v2/jobs/applications/{$this->applicationId}/parse-cv")->assertOk();

        Http::assertNothingSent();
    }

    public function test_the_platform_key_is_never_used(): void
    {
        $this->saveAiSetting('ai_enabled', '1');
        $this->saveAiSetting('openai_api_key', '');

        $this->apiGet("/v2/jobs/applications/{$this->applicationId}/parse-cv")->assertOk();

        Http::assertNothingSent();
    }

    public function test_with_ai_on_the_communitys_own_key_is_used(): void
    {
        $this->saveAiSetting('ai_enabled', '1');
        $this->saveAiSetting('openai_api_key', self::COMMUNITY_KEY);

        $this->apiGet("/v2/jobs/applications/{$this->applicationId}/parse-cv")
            ->assertOk()
            ->assertJsonPath('data.skills.0', 'Gardening');

        Http::assertSent(fn (HttpRequest $request) => $request->hasHeader('Authorization', 'Bearer ' . self::COMMUNITY_KEY));
        Http::assertNotSent(fn (HttpRequest $request) => $request->hasHeader('Authorization', 'Bearer ' . self::PLATFORM_KEY));
    }

    private function saveAiSetting(string $key, string $value): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
    }
}
