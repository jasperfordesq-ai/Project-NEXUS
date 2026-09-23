<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MunicipalSurveyService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-127 — municipal survey results must not be forgeable by a member:
 *  - one response per member per survey (anonymous surveys included, across days);
 *  - answers validated against the question type and its options;
 *  - multi-choice answers de-duplicated (one response = at most one vote per option);
 *  - unknown question ids rejected;
 *  - the anonymity token and IP hash are keyed (HMAC), not plain sha256.
 */
class MunicipalSurveyIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    private int $surveyId;
    private int $singleId;
    private int $multiId;
    private int $likertId;
    private int $yesNoId;
    private int $openId;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function makeSurvey(bool $anonymous, int $createdBy): void
    {
        $this->surveyId = (int) DB::table('municipality_surveys')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'created_by'     => $createdBy,
            'title'          => 'Integrity survey ' . uniqid('', true),
            'status'         => 'active',
            'is_anonymous'   => $anonymous ? 1 : 0,
            'response_count' => 0,
            'created_at'     => now()->subDays(10),
            'updated_at'     => now()->subDays(10),
        ]);

        $q = function (string $type, ?array $options, int $sort, int $required = 0): int {
            return (int) DB::table('municipality_survey_questions')->insertGetId([
                'survey_id'     => $this->surveyId,
                'tenant_id'     => $this->testTenantId,
                'question_text' => ucfirst($type) . ' question',
                'question_type' => $type,
                'options'       => $options === null ? null : json_encode($options),
                'is_required'   => $required,
                'sort_order'    => $sort,
                'created_at'    => now(),
                'updated_at'    => now(),
            ]);
        };

        $this->singleId = $q('single_choice', ['Library', 'Park', 'Pool'], 1, 1);
        $this->multiId  = $q('multi_choice', ['A', 'B', 'C'], 2);
        $this->likertId = $q('likert', null, 3);
        $this->yesNoId  = $q('yes_no', null, 4);
        $this->openId   = $q('open_text', null, 5);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    /** @param array<string, mixed> $answers */
    private function respond(User $user, array $answers): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($user);

        return $this->apiPost("/v2/caring-community/surveys/{$this->surveyId}/respond", ['answers' => $answers]);
    }

    private function validAnswers(): array
    {
        return [
            (string) $this->singleId => 'Park',
            (string) $this->multiId  => ['A', 'C'],
            (string) $this->likertId => '4',
            (string) $this->yesNoId  => 'yes',
            (string) $this->openId   => 'More benches please',
        ];
    }

    private function responseCount(): int
    {
        return DB::table('municipality_survey_responses')->where('survey_id', $this->surveyId)->count();
    }

    // ── Control ───────────────────────────────────────────────────────────────

    public function test_control_valid_answers_are_accepted_and_tallied(): void
    {
        $this->makeSurvey(true, $this->member()->id);

        $this->respond($this->member(), $this->validAnswers())
            ->assertStatus(200)
            ->assertJsonPath('data.ok', true);

        $this->assertSame(1, $this->responseCount());

        $analytics = MunicipalSurveyService::getAnalytics($this->surveyId, $this->testTenantId);
        $multi = collect($analytics['questions'])->firstWhere('question_id', $this->multiId);
        $counts = collect($multi['breakdown'])->pluck('count', 'option')->all();
        $this->assertSame(['A' => 1, 'B' => 0, 'C' => 1], $counts);
    }

    // ── (a) daily re-vote on anonymous surveys ──────────────────────────────

    public function test_anonymous_member_cannot_respond_again_the_next_day(): void
    {
        $this->makeSurvey(true, $this->member()->id);
        $voter = $this->member();

        $this->respond($voter, $this->validAnswers())->assertStatus(200);

        Carbon::setTestNow(now()->addDay()->addHour());
        $this->respond($voter, $this->validAnswers())->assertStatus(422);

        Carbon::setTestNow(now()->addDays(5));
        $this->respond($voter, $this->validAnswers())->assertStatus(422);

        $this->assertSame(1, $this->responseCount());
    }

    public function test_respondent_with_a_legacy_daily_token_stays_deduplicated(): void
    {
        $this->makeSurvey(true, $this->member()->id);
        $voter = $this->member();

        // A response written by the previous code, three days ago.
        $legacyDay = now()->subDays(3);
        DB::table('municipality_survey_responses')->insert([
            'survey_id'     => $this->surveyId,
            'tenant_id'     => $this->testTenantId,
            'user_id'       => null,
            'session_token' => hash('sha256', "{$voter->id}|{$this->surveyId}|" . $legacyDay->toDateString()),
            'answers'       => json_encode([(string) $this->singleId => 'Park']),
            'submitted_at'  => $legacyDay,
            'ip_hash'       => null,
        ]);

        $this->assertTrue(MunicipalSurveyService::hasResponded($this->surveyId, $this->testTenantId, (int) $voter->id));
        $this->respond($voter, $this->validAnswers())->assertStatus(422);
        $this->assertSame(1, $this->responseCount());
    }

    // ── (d) keyed token + ip hash ────────────────────────────────────────────

    public function test_session_token_and_ip_hash_are_keyed_not_plain_sha256(): void
    {
        $this->makeSurvey(true, $this->member()->id);
        $voter = $this->member();

        $this->respond($voter, $this->validAnswers())->assertStatus(200);

        $row = DB::table('municipality_survey_responses')->where('survey_id', $this->surveyId)->first();
        $this->assertNotNull($row);
        $this->assertNull($row->user_id);
        $this->assertNotEmpty($row->session_token);

        $today = Carbon::today()->toDateString();
        $this->assertNotSame(hash('sha256', "{$voter->id}|{$this->surveyId}|{$today}"), $row->session_token);
        $this->assertNotSame(hash('sha256', "{$voter->id}|{$this->surveyId}"), $row->session_token);

        $this->assertNotEmpty($row->ip_hash);
        $this->assertNotSame(hash('sha256', '127.0.0.1'), $row->ip_hash);
    }

    // ── (b) multi-choice stuffing ────────────────────────────────────────────

    public function test_multi_choice_repeats_count_once(): void
    {
        $this->makeSurvey(true, $this->member()->id);

        $answers = $this->validAnswers();
        $answers[(string) $this->multiId] = array_fill(0, 500, 'A');

        $this->respond($this->member(), $answers)->assertStatus(200);

        $stored = json_decode((string) DB::table('municipality_survey_responses')
            ->where('survey_id', $this->surveyId)->value('answers'), true);
        $this->assertSame(['A'], $stored[(string) $this->multiId]);

        $analytics = MunicipalSurveyService::getAnalytics($this->surveyId, $this->testTenantId);
        $multi = collect($analytics['questions'])->firstWhere('question_id', $this->multiId);
        $counts = collect($multi['breakdown'])->pluck('count', 'option')->all();
        $this->assertSame(1, $counts['A']);
    }

    public function test_analytics_ignores_stuffed_rows_already_in_the_database(): void
    {
        $this->makeSurvey(true, $this->member()->id);

        DB::table('municipality_survey_responses')->insert([
            'survey_id'     => $this->surveyId,
            'tenant_id'     => $this->testTenantId,
            'user_id'       => null,
            'session_token' => bin2hex(random_bytes(32)),
            'answers'       => json_encode([
                (string) $this->singleId => 'Casino',
                (string) $this->multiId  => ['B', 'B', 'B', 'B', 'Z'],
            ]),
            'submitted_at'  => now(),
            'ip_hash'       => null,
        ]);

        $analytics = MunicipalSurveyService::getAnalytics($this->surveyId, $this->testTenantId);

        $multi = collect($analytics['questions'])->firstWhere('question_id', $this->multiId);
        $this->assertSame(['A' => 0, 'B' => 1, 'C' => 0], collect($multi['breakdown'])->pluck('count', 'option')->all());

        $single = collect($analytics['questions'])->firstWhere('question_id', $this->singleId);
        $this->assertSame(['Library' => 0, 'Park' => 0, 'Pool' => 0], collect($single['breakdown'])->pluck('count', 'option')->all());
    }

    // ── (c) option validation + unknown questions ────────────────────────────

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function invalidAnswerProvider(): array
    {
        return [
            'single_choice not an option' => ['single', 'Casino'],
            'single_choice array'         => ['single', ['Park', 'Pool']],
            'multi_choice unknown option' => ['multi', ['A', 'Z']],
            'multi_choice scalar'         => ['multi', 'A'],
            'likert out of range'         => ['likert', '9'],
            'likert text'                 => ['likert', 'excellent'],
            'yes_no other value'          => ['yesNo', 'maybe'],
            'open_text array'             => ['open', ['a', 'b']],
        ];
    }

    /** @dataProvider invalidAnswerProvider */
    public function test_answers_outside_the_question_options_are_rejected(string $question, mixed $value): void
    {
        $this->makeSurvey(true, $this->member()->id);

        $answers = $this->validAnswers();
        $answers[(string) $this->{$question . 'Id'}] = $value;

        $this->respond($this->member(), $answers)->assertStatus(422);
        $this->assertSame(0, $this->responseCount());
    }

    public function test_unknown_question_ids_are_rejected(): void
    {
        $this->makeSurvey(true, $this->member()->id);

        $answers = $this->validAnswers();
        $answers['99999999'] = 'Park';

        $this->respond($this->member(), $answers)->assertStatus(422);
        $this->assertSame(0, $this->responseCount());
    }

    public function test_control_optional_questions_may_be_omitted_and_non_anonymous_dedup_still_works(): void
    {
        $this->makeSurvey(false, $this->member()->id);
        $voter = $this->member();

        $this->respond($voter, [(string) $this->singleId => 'Library'])->assertStatus(200);
        $this->respond($voter, [(string) $this->singleId => 'Pool'])->assertStatus(422);

        $row = DB::table('municipality_survey_responses')->where('survey_id', $this->surveyId)->first();
        $this->assertSame((int) $voter->id, (int) $row->user_id);
        $this->assertSame(1, $this->responseCount());
    }
}
