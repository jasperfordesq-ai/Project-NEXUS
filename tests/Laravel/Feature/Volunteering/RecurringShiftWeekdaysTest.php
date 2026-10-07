<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\RecurringShiftService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Weekly and fortnightly repeating shifts land on the chosen weekdays — never
 * on every day.
 *
 * Gap A3 of the volunteering journey walk (6 Oct 2026): a weekly pattern saved
 * with no weekdays was accepted and generated a shift EVERY day (15 in the
 * 14-day window), with no warning. A weekly or fortnightly pattern now needs at
 * least one weekday (1 = Monday … 7 = Sunday), and an old row stored without
 * any repeats on its start date's weekday.
 */
class RecurringShiftWeekdaysTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    /** @return array{0: User, 1: int} [owner, opportunityId] */
    private function ownedOpportunity(): array
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Weekday fixture organisation',
            'slug' => 'weekday-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $owner->id,
            'title' => 'Weekday fixture opportunity',
            'description' => 'Repeats weekly.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$owner, $oppId];
    }

    /** @return list<int> ISO weekday of every shift the pattern generated */
    private function generatedWeekdays(int $patternId): array
    {
        return DB::table('vol_shifts')
            ->where('recurring_pattern_id', $patternId)
            ->pluck('start_time')
            ->map(static fn ($t) => (int) (new \DateTimeImmutable((string) $t))->format('N'))
            ->all();
    }

    private function weeklyPayload(array $overrides = []): array
    {
        return array_merge([
            'frequency' => 'weekly',
            'start_time' => '14:00:00',
            'end_time' => '16:00:00',
            'capacity' => 3,
            'start_date' => now()->addDay()->format('Y-m-d'),
        ], $overrides);
    }

    public function test_a_weekly_pattern_lands_only_on_the_chosen_weekdays(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost(
            "/v2/volunteering/opportunities/{$oppId}/recurring-patterns",
            $this->weeklyPayload(['days_of_week' => [2, 4]])
        )->assertCreated();

        $weekdays = $this->generatedWeekdays((int) $response->json('data.id'));
        $this->assertNotEmpty($weekdays);
        $this->assertLessThanOrEqual(5, count($weekdays), 'two days a week over 14 days is at most 5 shifts');
        $this->assertSame([], array_values(array_diff($weekdays, [2, 4])), 'every shift is on a Tuesday or Thursday');
        $this->assertSame([2, 4], $response->json('data.days_of_week'));
    }

    public function test_weekdays_sent_as_text_are_understood(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost(
            "/v2/volunteering/opportunities/{$oppId}/recurring-patterns",
            $this->weeklyPayload(['days_of_week' => ['2', '4']])
        )->assertCreated();

        $weekdays = $this->generatedWeekdays((int) $response->json('data.id'));
        $this->assertNotEmpty($weekdays);
        $this->assertSame([], array_values(array_diff($weekdays, [2, 4])));
    }

    public function test_a_weekly_pattern_with_no_weekdays_is_refused(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/recurring-patterns", $this->weeklyPayload())
            ->assertStatus(400);
        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/recurring-patterns", $this->weeklyPayload(['days_of_week' => []]))
            ->assertStatus(400);

        $this->assertFalse(DB::table('recurring_shift_patterns')->where('opportunity_id', $oppId)->exists());
        $this->assertFalse(DB::table('vol_shifts')->where('opportunity_id', $oppId)->exists(), 'no shift was generated');
    }

    public function test_a_fortnightly_pattern_with_no_weekdays_is_refused(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/recurring-patterns", $this->weeklyPayload(['frequency' => 'biweekly']))
            ->assertStatus(400);
        $this->assertFalse(DB::table('recurring_shift_patterns')->where('opportunity_id', $oppId)->exists());
    }

    public function test_a_weekday_outside_monday_to_sunday_is_refused(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        foreach ([[0], [8], ['Tuesday']] as $bad) {
            $this->apiPost("/v2/volunteering/opportunities/{$oppId}/recurring-patterns", $this->weeklyPayload(['days_of_week' => $bad]))
                ->assertStatus(400);
        }
        $this->assertFalse(DB::table('recurring_shift_patterns')->where('opportunity_id', $oppId)->exists());
    }

    public function test_a_daily_pattern_needs_no_weekdays(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/recurring-patterns", $this->weeklyPayload(['frequency' => 'daily', 'max_occurrences' => 3]))
            ->assertCreated()
            ->assertJsonPath('data.shifts_generated', 3);
    }

    public function test_an_old_weekly_pattern_stored_without_weekdays_repeats_on_its_start_weekday_only(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        $start = now()->addDay();
        $patternId = (int) DB::table('recurring_shift_patterns')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'created_by' => $owner->id,
            'frequency' => 'weekly',
            'days_of_week' => null,
            'start_time' => '14:00:00',
            'end_time' => '16:00:00',
            'capacity' => 3,
            'start_date' => $start->format('Y-m-d'),
            'is_active' => 1,
            'created_at' => now(),
        ]);

        app(RecurringShiftService::class)->generateOccurrences($patternId, 14);

        $weekdays = $this->generatedWeekdays($patternId);
        $this->assertNotEmpty($weekdays);
        $this->assertLessThanOrEqual(2, count($weekdays), 'once a week over 14 days, not every day');
        $this->assertSame([(int) $start->format('N')], array_values(array_unique($weekdays)));
    }

    public function test_changing_a_pattern_to_no_weekdays_is_refused(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $patternId = (int) $this->apiPost(
            "/v2/volunteering/opportunities/{$oppId}/recurring-patterns",
            $this->weeklyPayload(['days_of_week' => [3]])
        )->assertCreated()->json('data.id');

        $this->apiPut("/v2/volunteering/recurring-patterns/{$patternId}", ['days_of_week' => []])->assertStatus(400);
        $this->assertSame([3], json_decode((string) DB::table('recurring_shift_patterns')->where('id', $patternId)->value('days_of_week'), true));
    }

    /**
     * Found walking the journey (7 Oct 2026): changing a pattern's weekdays changed
     * only the pattern row. Future shifts on the dropped days stayed listed and the
     * new day appeared only when the cron next ran. Now the edit applies at once —
     * except that a shift somebody is booked on is kept, never taken from them.
     */
    public function test_changing_the_weekdays_moves_the_future_shifts_but_keeps_a_booked_one(): void
    {
        $this->enableVolunteering();
        [$owner, $oppId] = $this->ownedOpportunity();
        Sanctum::actingAs($owner, ['*']);

        $patternId = (int) $this->apiPost(
            "/v2/volunteering/opportunities/{$oppId}/recurring-patterns",
            $this->weeklyPayload(['days_of_week' => [2, 4]])
        )->assertCreated()->json('data.id');

        // A volunteer is booked on the first Thursday shift.
        $volunteer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $bookedShift = DB::table('vol_shifts')->where('recurring_pattern_id', $patternId)->get(['id', 'start_time'])
            ->first(static fn ($row) => (int) (new \DateTimeImmutable((string) $row->start_time))->format('N') === 4);
        $this->assertNotNull($bookedShift, 'the 14-day window holds at least one Thursday');
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => $bookedShift->id,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPut("/v2/volunteering/recurring-patterns/{$patternId}", ['days_of_week' => [1]])->assertOk();

        $shifts = DB::table('vol_shifts')->where('recurring_pattern_id', $patternId)->get(['id', 'start_time']);
        $weekdays = $shifts->map(static fn ($row) => (int) (new \DateTimeImmutable((string) $row->start_time))->format('N'))->all();
        $this->assertContains(1, $weekdays, 'the new Monday shifts exist straight away, not after the next cron run');
        $this->assertNotContains(2, $weekdays, 'unbooked Tuesday shifts are gone');
        $this->assertSame(1, $shifts->filter(static fn ($row) => (int) (new \DateTimeImmutable((string) $row->start_time))->format('N') === 4)->count(),
            'only the booked Thursday remains; the unbooked Thursdays are gone');
        $this->assertTrue($shifts->contains('id', $bookedShift->id), 'the booked shift is never taken from the volunteer');
        $this->assertSame(1, $response->json('data.shifts_kept'));
        $this->assertGreaterThan(0, $response->json('data.shifts_removed'));
        $this->assertGreaterThan(0, $response->json('data.shifts_generated'));
    }
}
