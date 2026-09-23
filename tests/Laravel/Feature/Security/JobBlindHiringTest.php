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

/**
 * F-102 — "blind hiring" on a vacancy must hide the candidate's identity on
 * every employer-facing path, not only the applications list. The CSV export
 * (name + email), the audit trail, the interview list and the AI ranking
 * prompt all used to reveal it.
 */
class JobBlindHiringTest extends TestCase
{
    use DatabaseTransactions;

    private const FIRST = 'Zelphinia';
    private const LAST = 'Quorrendale';
    private const EMAIL = 'zelphinia.quorrendale@blind.example.test';
    private const BIO = 'Zelphinia bio text about me';
    private const COVER = 'Cover letter signed Zelphinia';

    /** @var array<string,mixed>|null */
    private static ?array $aiMessages = null;

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        self::$aiMessages = null;
        parent::tearDown();
    }

    /** @return array{owner:User, vacancy:JobVacancy, application_id:int} */
    private function fixture(bool $blind): array
    {
        $tid = $this->testTenantId;
        $owner = User::factory()->forTenant($tid)->create(['status' => 'active', 'is_approved' => true]);
        $candidate = User::factory()->forTenant($tid)->create([
            'status' => 'active',
            'is_approved' => true,
            'first_name' => self::FIRST,
            'last_name' => self::LAST,
            'email' => self::EMAIL,
            'bio' => self::BIO,
        ]);

        $vacancy = JobVacancy::factory()->forTenant($tid)->create([
            'user_id' => $owner->id,
            'status' => 'open',
            'type' => 'volunteer',
        ]);
        $vacancy->forceFill(['blind_hiring' => $blind])->save();

        $applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $tid,
            'vacancy_id' => $vacancy->id,
            'user_id' => $candidate->id,
            'status' => 'interview',
            'stage' => 'interview',
            'message' => self::COVER,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('job_application_history')->insert([
            'application_id' => $applicationId,
            'from_status' => 'applied',
            'to_status' => 'interview',
            'changed_by' => $owner->id,
            'changed_at' => now(),
        ]);
        // A candidate-initiated change: the actor is the candidate themselves.
        DB::table('job_application_history')->insert([
            'application_id' => $applicationId,
            'from_status' => 'interview',
            'to_status' => 'interview',
            'changed_by' => $candidate->id,
            'changed_at' => now(),
        ]);
        DB::table('job_interviews')->insert([
            'tenant_id' => $tid,
            'vacancy_id' => $vacancy->id,
            'application_id' => $applicationId,
            'proposed_by' => $owner->id,
            'interview_type' => 'video',
            'scheduled_at' => now()->addWeek(),
            'duration_mins' => 30,
            'status' => 'proposed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('job_offers')->insert([
            'tenant_id' => $tid,
            'vacancy_id' => $vacancy->id,
            'application_id' => $applicationId,
            'user_id' => $candidate->id,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($owner, ['*']);

        return ['owner' => $owner, 'vacancy' => $vacancy, 'application_id' => $applicationId];
    }

    private function assertNoIdentity(string $body, string $surface): void
    {
        $this->assertStringNotContainsString(self::FIRST, $body, "$surface leaks the candidate's first name under blind hiring");
        $this->assertStringNotContainsString(self::LAST, $body, "$surface leaks the candidate's last name under blind hiring");
        $this->assertStringNotContainsString(self::EMAIL, $body, "$surface leaks the candidate's email under blind hiring");
    }

    private function label(): string
    {
        return __('api.job_candidate_label', ['number' => 1]);
    }

    public function test_csv_export_is_anonymised_under_blind_hiring(): void
    {
        $f = $this->fixture(true);
        $response = $this->apiGet("/v2/jobs/{$f['vacancy']->id}/applications/export-csv");
        $response->assertOk();
        $body = (string) $response->getContent();
        $this->assertNoIdentity($body, 'CSV export');
        $this->assertStringContainsString($this->label(), $body);
    }

    public function test_audit_trail_is_anonymised_under_blind_hiring(): void
    {
        $f = $this->fixture(true);
        $response = $this->apiGet("/v2/jobs/{$f['vacancy']->id}/audit-trail");
        $response->assertOk();
        $body = (string) $response->getContent();
        $this->assertNoIdentity($body, 'Audit trail');
        $this->assertStringContainsString($this->label(), $body);
    }

    public function test_interview_list_is_anonymised_under_blind_hiring(): void
    {
        $f = $this->fixture(true);
        $response = $this->apiGet("/v2/jobs/{$f['vacancy']->id}/interviews");
        $response->assertOk();
        $body = (string) $response->getContent();
        $this->assertNoIdentity($body, 'Interview list');
        $this->assertStringNotContainsString(self::COVER, $body, 'Interview list leaks the cover message under blind hiring');
        $this->assertSame($this->label(), $response->json('data.0.application.applicant.name'));
        $this->assertNull($response->json('data.0.application.user_id'));
    }

    public function test_ai_ranking_prompt_is_anonymised_under_blind_hiring(): void
    {
        $f = $this->fixture(true);
        $this->installFakeAiProvider($f['application_id']);

        $response = $this->apiPost("/v2/jobs/{$f['vacancy']->id}/ai-rank", []);
        $response->assertOk();

        $this->assertNotNull(self::$aiMessages, 'the fake AI provider should have been called');
        $prompt = (string) json_encode(self::$aiMessages);
        $this->assertNoIdentity($prompt, 'AI ranking prompt');
        $this->assertStringNotContainsString(self::BIO, $prompt);
        $this->assertStringNotContainsString(self::COVER, $prompt);
        $this->assertNoIdentity((string) $response->getContent(), 'AI ranking response');
    }

    public function test_non_blind_vacancy_keeps_candidate_identity_for_the_employer(): void
    {
        $f = $this->fixture(false);

        $csv = (string) $this->apiGet("/v2/jobs/{$f['vacancy']->id}/applications/export-csv")->assertOk()->getContent();
        $this->assertStringContainsString(self::EMAIL, $csv);
        $this->assertStringContainsString(self::FIRST, $csv);

        $audit = (string) $this->apiGet("/v2/jobs/{$f['vacancy']->id}/audit-trail")->assertOk()->getContent();
        $this->assertStringContainsString(self::FIRST, $audit);

        $interviews = $this->apiGet("/v2/jobs/{$f['vacancy']->id}/interviews")->assertOk();
        $this->assertSame(self::FIRST, $interviews->json('data.0.application.applicant.first_name'));

        $this->installFakeAiProvider($f['application_id']);
        $this->apiPost("/v2/jobs/{$f['vacancy']->id}/ai-rank", [])->assertOk();
        $this->assertStringContainsString(self::FIRST, (string) json_encode(self::$aiMessages));
    }

    private function installFakeAiProvider(int $applicationId): void
    {
        $provider = new class ($applicationId) implements AIProviderInterface {
            public function __construct(private int $applicationId) {}
            public function chat(array $messages, array $options = []): array
            {
                JobBlindHiringTest::recordAiMessages($messages);
                return ['content' => json_encode([['application_id' => $this->applicationId, 'score' => 80, 'reasoning' => 'ok']])];
            }
            public function complete(string $prompt, array $options = []): string { return ''; }
            public function embed(string $text): array { return []; }
            public function streamChat(array $messages, callable $onChunk, array $options = []): void {}
            public function getModels(): array { return []; }
            public function isConfigured(): bool { return true; }
            public function getName(): string { return 'Fake'; }
            public function getId(): string { return 'fake'; }
            public function testConnection(): array { return ['success' => true, 'message' => '', 'latency_ms' => 0]; }
        };

        $ref = new \ReflectionClass(AIServiceFactory::class);
        $ref->getProperty('config')->setValue(null, [
            'enabled' => true,
            'default_provider' => 'fake',
            'providers' => [],
            'features' => [],
            'limits' => [],
        ]);
        $ref->getProperty('instances')->setValue(null, ['fake' => $provider]);
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => '1'],
        );
    }

    /** @param array<int,mixed> $messages */
    public static function recordAiMessages(array $messages): void
    {
        self::$aiMessages = $messages;
    }
}
