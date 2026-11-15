<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\JobInterviewSchedulingService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class JobInterviewSchedulingServiceTest extends TestCase
{
    private JobInterviewSchedulingService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new JobInterviewSchedulingService();
    }

    // ── getErrors ────────────────────────────────────────────────────

    public function test_getErrors_returns_empty_array_initially(): void
    {
        $this->assertSame([], $this->service->getErrors());
    }

    // ── createSlots ──────────────────────────────────────────────────

    public function test_createSlots_returns_empty_with_not_found_error_when_vacancy_missing(): void
    {
        // No vacancy exists in DB => RESOURCE_NOT_FOUND
        $result = $this->service->createSlots(999999, 1, [], $this->testTenantId);

        $this->assertSame([], $result);
        $errors = $this->service->getErrors();
        $this->assertCount(1, $errors);
        $this->assertSame('RESOURCE_NOT_FOUND', $errors[0]['code']);
        // The wording is the platform's voice since 15 Nov 2026 (api.job_vacancy_not_found).
        $this->assertStringContainsString("can't find that job", $errors[0]['message']);
    }

    public function test_createSlots_returns_forbidden_error_when_not_owner(): void
    {
        // Insert a real vacancy owned by user 10, then call as user 99
        $vacancyId = $this->insertTestVacancy(10);

        $result = $this->service->createSlots($vacancyId, 99, [], $this->testTenantId);

        $this->assertSame([], $result);
        $errors = $this->service->getErrors();
        $this->assertCount(1, $errors);
        $this->assertSame('RESOURCE_FORBIDDEN', $errors[0]['code']);
    }

    public function test_createSlots_skips_entries_missing_start_or_end(): void
    {
        $vacancyId = $this->insertTestVacancy(5);

        $result = $this->service->createSlots($vacancyId, 5, [
            ['start' => '', 'end' => '2027-06-01 10:00:00'],
            ['start' => '2027-06-01 09:00:00', 'end' => ''],
            [],
        ], $this->testTenantId);

        $this->assertSame([], $result);
        $this->assertSame([], $this->service->getErrors());
    }

    public function test_createSlots_creates_slot_with_default_type_video(): void
    {
        $vacancyId = $this->insertTestVacancy(5);

        $result = $this->service->createSlots($vacancyId, 5, [
            ['start' => '2027-06-01 09:00:00', 'end' => '2027-06-01 09:30:00'],
        ], $this->testTenantId);

        $this->assertCount(1, $result);
        $this->assertSame($vacancyId, $result[0]['job_id']);
        $this->assertSame('video', $result[0]['interview_type']);
        $this->assertStringStartsWith('https://meet.jit.si/nexus-interview-', $result[0]['meeting_link']);
    }

    public function test_createSlots_accepts_optional_fields(): void
    {
        $vacancyId = $this->insertTestVacancy(5);

        $result = $this->service->createSlots($vacancyId, 5, [
            [
                'start' => '2027-06-01 09:00:00',
                'end' => '2027-06-01 09:30:00',
                'type' => 'in_person',
                'meeting_link' => 'https://zoom.us/j/123',
                'location' => 'Office',
                'notes' => 'Bring ID',
            ],
        ], $this->testTenantId);

        $this->assertCount(1, $result);
        $this->assertSame('in_person', $result[0]['interview_type']);
        $this->assertSame('https://zoom.us/j/123', $result[0]['meeting_link']);
        $this->assertSame('Office', $result[0]['location']);
        $this->assertSame('Bring ID', $result[0]['notes']);
    }

    // ── getAvailableSlots ────────────────────────────────────────────

    public function test_getAvailableSlots_returns_empty_for_unknown_job(): void
    {
        $result = $this->service->getAvailableSlots(999999, $this->testTenantId, 5);
        $this->assertSame([], $result);
    }

    public function test_getAvailableSlots_returns_future_slots(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00');
        $this->insertTestSlot($vacancyId, 5, '2027-07-01 10:00:00', '2027-07-01 10:30:00');
        // Past slot should not appear
        $this->insertTestSlot($vacancyId, 5, '2020-01-01 09:00:00', '2020-01-01 09:30:00');

        $result = $this->service->getAvailableSlots($vacancyId, $this->testTenantId, 5);

        $this->assertCount(2, $result);
    }

    // ── bookSlot ─────────────────────────────────────────────────────

    public function test_bookSlot_returns_null_when_slot_not_found(): void
    {
        $result = $this->service->bookSlot(999999, 10, $this->testTenantId);

        $this->assertNull($result);
        $this->assertSame('RESOURCE_NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    public function test_bookSlot_returns_null_when_already_booked(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00', [
            'is_booked' => true,
            'booked_by_user_id' => 20,
            'booked_at' => now(),
        ]);

        $result = $this->service->bookSlot($slotId, 30, $this->testTenantId);

        $this->assertNull($result);
        $this->assertSame('RESOURCE_CONFLICT', $this->service->getErrors()[0]['code']);
    }

    public function test_bookSlot_returns_null_when_slot_is_past(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2020-01-01 09:00:00', '2020-01-01 09:30:00');

        $result = $this->service->bookSlot($slotId, 30, $this->testTenantId);

        $this->assertNull($result);
        $this->assertSame('VALIDATION_ERROR', $this->service->getErrors()[0]['code']);
    }

    public function test_bookSlot_returns_null_when_employer_books_own_slot(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00');

        $result = $this->service->bookSlot($slotId, 5, $this->testTenantId);

        $this->assertNull($result);
        $this->assertSame('RESOURCE_FORBIDDEN', $this->service->getErrors()[0]['code']);
    }

    public function test_bookSlot_succeeds_for_valid_candidate(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00');
        $this->insertTestApplication($vacancyId, 20);

        $result = $this->service->bookSlot($slotId, 20, $this->testTenantId);

        $this->assertNotNull($result);
        $this->assertTrue((bool) $result['is_booked']);
        $this->assertArrayNotHasKey('booked_by_user_id', $result);
        $this->assertNotNull($result['booked_at']);
        $this->assertSame([], $this->service->getErrors());
    }

    // ── cancelSlotBooking ────────────────────────────────────────────

    public function test_cancelSlotBooking_returns_false_when_not_found(): void
    {
        $this->assertFalse($this->service->cancelSlotBooking(999999, $this->testTenantId, 20));
        $this->assertSame('RESOURCE_NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    public function test_cancelSlotBooking_returns_false_when_not_booked(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00');

        $this->assertFalse($this->service->cancelSlotBooking($slotId, $this->testTenantId, 5));
        $this->assertSame('VALIDATION_ERROR', $this->service->getErrors()[0]['code']);
    }

    public function test_cancelSlotBooking_clears_booking_and_returns_true(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00', [
            'is_booked' => true,
            'booked_by_user_id' => 20,
            'booked_at' => now(),
        ]);

        $this->assertTrue($this->service->cancelSlotBooking($slotId, $this->testTenantId, 20));
        $this->assertSame([], $this->service->getErrors());
    }

    // ── deleteSlot ───────────────────────────────────────────────────

    public function test_deleteSlot_returns_false_when_not_found(): void
    {
        $this->assertFalse($this->service->deleteSlot(999999, $this->testTenantId, 5));
        $this->assertSame('RESOURCE_NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    public function test_deleteSlot_removes_record_and_returns_true(): void
    {
        $vacancyId = $this->insertTestVacancy(5);
        $slotId = $this->insertTestSlot($vacancyId, 5, '2027-07-01 09:00:00', '2027-07-01 09:30:00');

        $this->assertTrue($this->service->deleteSlot($slotId, $this->testTenantId, 5));
        $this->assertSame([], $this->service->getErrors());
    }

    // ── bulkCreateSlots ──────────────────────────────────────────────

    public function test_bulkCreateSlots_returns_empty_when_vacancy_missing(): void
    {
        $result = $this->service->bulkCreateSlots(999999, 1, '2027-06-01', '2027-06-05', 30, [], $this->testTenantId);

        $this->assertSame([], $result);
        $this->assertSame('RESOURCE_NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    public function test_bulkCreateSlots_returns_empty_when_no_matching_day_config(): void
    {
        $vacancyId = $this->insertTestVacancy(5);

        // 2027-12-06 Mon through 2027-12-10 Fri — Saturday not in range
        $result = $this->service->bulkCreateSlots(
            $vacancyId, 5, '2027-12-06', '2027-12-10', 30,
            ['saturday' => ['start' => '09:00', 'end' => '17:00']],
            $this->testTenantId
        );

        $this->assertSame([], $result);
    }

    public function test_bulkCreateSlots_generates_correct_slot_count_per_day(): void
    {
        $vacancyId = $this->insertTestVacancy(5);

        // 2027-12-07 is Tuesday, 2027-12-09 is Thursday
        // 2-hour window / 60-min slots = 2 per day, 2 days = 4 total
        $result = $this->service->bulkCreateSlots(
            $vacancyId, 5, '2027-12-06', '2027-12-10', 60,
            [
                'tuesday' => ['start' => '10:00', 'end' => '12:00'],
                'thursday' => ['start' => '14:00', 'end' => '16:00'],
            ],
            $this->testTenantId
        );

        $this->assertCount(4, $result);
    }

    public function test_bulkCreateSlots_clamps_duration_to_minimum_15(): void
    {
        $vacancyId = $this->insertTestVacancy(5);

        // 2027-12-01 Wednesday; 30-min window, duration 5 clamped to 15 => 2 slots
        $result = $this->service->bulkCreateSlots(
            $vacancyId, 5, '2027-12-01', '2027-12-01', 5,
            ['wednesday' => ['start' => '09:00', 'end' => '09:30']],
            $this->testTenantId
        );

        $this->assertCount(2, $result);
    }

    public function test_bulkCreateSlots_only_creates_future_slots(): void
    {
        Carbon::setTestNow(Carbon::parse('2027-06-15 12:00:00'));

        $vacancyId = $this->insertTestVacancy(5);

        // 2027-06-15 is Tuesday; 09:00-15:00, 60-min slots
        // Only starts > 12:00: 13:00-14:00, 14:00-15:00 = 2 slots
        $result = $this->service->bulkCreateSlots(
            $vacancyId, 5, '2027-06-15', '2027-06-15', 60,
            ['tuesday' => ['start' => '09:00', 'end' => '15:00']],
            $this->testTenantId
        );

        $this->assertCount(2, $result);

        Carbon::setTestNow();
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private function insertTestVacancy(int $userId): int
    {
        return \Illuminate\Support\Facades\DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Test Vacancy',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertTestSlot(int $jobId, int $employerId, string $start, string $end, array $extra = []): int
    {
        return \Illuminate\Support\Facades\DB::table('job_interview_slots')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'job_id' => $jobId,
            'employer_user_id' => $employerId,
            'slot_start' => $start,
            'slot_end' => $end,
            'is_booked' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    private function insertTestApplication(int $jobId, int $userId, string $status = 'applied'): int
    {
        return \Illuminate\Support\Facades\DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'vacancy_id' => $jobId,
            'user_id' => $userId,
            'status' => $status,
            'stage' => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
