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
use Tests\Laravel\TestCase;

/**
 * VOL-BE-018: a monthly recurring pattern anchored on day 29/30/31 must still
 * generate a shift in shorter months (clamped to the last valid day) instead of
 * silently skipping them.
 *
 * 🔴 The expected dates are DERIVED from today, never written as literals.
 *
 * This test asserted on '2026-08-31' and '2026-09-30' and passed for as long as
 * it was written and reviewed — then failed on 2026-09-01 with no code change
 * behind it. RecurringShiftService::generateOccurrences() iterates today..+N days
 * and deliberately "never generate[s] before today", so once 31 August was in the
 * past the shift was correctly not created and the assertion could never pass
 * again. It reddened `main` on the previous commit before anyone pushed.
 *
 * Freezing the clock does NOT fix this one: the service reads PHP's own clock via
 * date()/strtotime(), not Carbon, so Carbon::setTestNow() has no effect on it.
 * Making it freezable would mean changing the shift generator to prove a property
 * of the shift generator. Deriving the window is the honest fix, and it holds on
 * every future run date rather than until the next month boundary.
 */
class RecurringShiftMonthlyClampTest extends TestCase
{
    use DatabaseTransactions;

    /** Matches the daysAhead passed to generateOccurrences() below. */
    private const DAYS_AHEAD = 100;

    public function test_monthly_pattern_on_day_31_generates_on_last_day_of_short_month(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Recurrence Clamp Org',
            'status' => 'approved',
            'balance' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Clamp Opportunity',
            'description' => 'x',
            'is_active' => 1,
            'status' => 'open',
            'created_by' => $owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Anchor day 31. The date itself is only read for its day-of-month, and it
        // stays in the past for good, so a literal is safe here — the service
        // clamps the ITERATION window to today regardless of how old the anchor is.
        $patternId = (int) DB::table('recurring_shift_patterns')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'created_by' => $owner->id,
            'frequency' => 'monthly',
            'start_time' => '09:00:00',
            'end_time' => '11:00:00',
            'capacity' => 5,
            'start_date' => '2026-01-31',
            'occurrences_generated' => 0,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        [$shortMonthDate, $longMonthDate] = $this->expectedTargetsInWindow();

        (new RecurringShiftService())->generateOccurrences($patternId, self::DAYS_AHEAD);

        // The clamp fires on the last day of a month shorter than 31 days;
        // without it, that month would be skipped entirely.
        $this->assertTrue(
            $this->shiftExists($patternId, $shortMonthDate),
            "expected a shift clamped to {$shortMonthDate} for a day-31 monthly pattern"
        );

        // A 31-day month fires on its 31st, unclamped.
        $this->assertTrue(
            $this->shiftExists($patternId, $longMonthDate),
            "expected an unclamped shift on {$longMonthDate}"
        );
    }

    private function shiftExists(int $patternId, string $date): bool
    {
        return DB::table('vol_shifts')
            ->where('tenant_id', $this->testTenantId)
            ->where('recurring_pattern_id', $patternId)
            ->where('start_time', $date . ' 09:00:00')
            ->exists();
    }

    /**
     * The first clamped and first unclamped target the service should produce,
     * for a day-31 anchor, inside its today..+DAYS_AHEAD window.
     *
     * No two consecutive months are both shorter than 31 days, and the window
     * spans at least three month ends, so both kinds are always present.
     *
     * @return array{0: string, 1: string} [short-month date, 31-day-month date]
     */
    private function expectedTargetsInWindow(): array
    {
        // Mirror the service: PHP's own clock, day granularity.
        $today = new \DateTimeImmutable(date('Y-m-d'));
        $windowEnd = $today->modify('+' . self::DAYS_AHEAD . ' days');

        $shortMonth = null;
        $longMonth = null;

        $month = $today->modify('first day of this month');

        while ($month <= $windowEnd) {
            $daysInMonth = (int) $month->format('t');

            // Same rule as RecurringShiftService: min(anchor day, days in month).
            $target = $month->setDate(
                (int) $month->format('Y'),
                (int) $month->format('n'),
                min(31, $daysInMonth)
            );

            if ($target >= $today && $target <= $windowEnd) {
                if ($daysInMonth === 31) {
                    $longMonth ??= $target->format('Y-m-d');
                } else {
                    $shortMonth ??= $target->format('Y-m-d');
                }
            }

            $month = $month->modify('first day of next month');
        }

        $this->assertNotNull(
            $shortMonth,
            'window should contain a month shorter than 31 days — check DAYS_AHEAD'
        );
        $this->assertNotNull(
            $longMonth,
            'window should contain a 31-day month — check DAYS_AHEAD'
        );

        return [$shortMonth, $longMonth];
    }
}
