<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteerService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-188 (completes F-101) — the 24-hour-per-day cap on logged volunteer
 * hours was read before, and outside, the transaction that inserts the log.
 * Two concurrent submissions for different organisations on the same day
 * could each pass the check and together exceed 24h. The total must be
 * re-read under a per-member row lock inside the inserting transaction.
 *
 * The race is simulated deterministically: a competing log for the same day
 * is committed after the early check has passed but before the insert (hooked
 * on the duplicate-check query that runs between them).
 */
class VolunteerDailyHoursCapLockTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function organisationWithVolunteer(User $owner, User $volunteer): int
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'E035 daily cap fixture ' . uniqid(),
            'slug' => 'e035-daily-cap-' . uniqid(),
            'description' => 'F-188 regression fixture.',
            'status' => 'active',
            'auto_pay_enabled' => false,
            'balance' => 0,
            'created_at' => now(),
        ]);
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $volunteer->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $orgId;
    }

    private function dayTotal(User $volunteer, string $date): float
    {
        return (float) DB::table('vol_logs')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $volunteer->id)
            ->whereDate('date_logged', $date)
            ->sum('hours');
    }

    public function test_competing_log_committed_after_the_early_check_cannot_push_the_day_over_24h(): void
    {
        $volunteer = $this->member();
        $orgA = $this->organisationWithVolunteer($this->member(), $volunteer);
        $orgB = $this->organisationWithVolunteer($this->member(), $volunteer);
        $date = now()->subDays(2)->toDateString();

        $injected = false;
        DB::listen(function (QueryExecuted $query) use (&$injected, $volunteer, $orgB, $date): void {
            if ($injected || ! str_contains($query->sql, 'SELECT id FROM vol_logs WHERE user_id = ?')) {
                return;
            }
            $injected = true;
            // The "other request": 20h for a different organisation, same day.
            DB::table('vol_logs')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $volunteer->id,
                'organization_id' => $orgB,
                'date_logged' => $date,
                'hours' => 20,
                'description' => 'Concurrent submission',
                'status' => 'pending',
                'created_at' => now(),
            ]);
        });

        TenantContext::setById($this->testTenantId);
        $result = VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgA,
            'date' => $date,
            'hours' => 10,
            'description' => 'Neighbour support visit.',
        ]);

        $this->assertTrue($injected, 'the race hook must have fired');
        $this->assertNull($result, 'a 10h log on top of a concurrent 20h log would total 30h');
        $this->assertSame('hours', VolunteerService::getErrors()[0]['field'] ?? null);
        $this->assertLessThanOrEqual(24.0, $this->dayTotal($volunteer, $date));
    }

    public function test_daily_cap_is_still_enforced_sequentially_and_the_remainder_allowed(): void
    {
        $volunteer = $this->member();
        $orgA = $this->organisationWithVolunteer($this->member(), $volunteer);
        $orgB = $this->organisationWithVolunteer($this->member(), $volunteer);
        $date = now()->subDays(3)->toDateString();
        TenantContext::setById($this->testTenantId);

        $this->assertNotNull(VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgA, 'date' => $date, 'hours' => 20, 'description' => 'First.',
        ]));
        $this->assertNull(VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgB, 'date' => $date, 'hours' => 10, 'description' => 'Second.',
        ]));
        $this->assertNotNull(VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgB, 'date' => $date, 'hours' => 4, 'description' => 'Remainder.',
        ]));
        $this->assertSame(24.0, $this->dayTotal($volunteer, $date));
    }

    public function test_insert_transaction_takes_a_row_lock_on_the_member(): void
    {
        $volunteer = $this->member();
        $orgA = $this->organisationWithVolunteer($this->member(), $volunteer);
        $date = now()->subDays(4)->toDateString();

        $locked = false;
        DB::listen(function (QueryExecuted $query) use (&$locked): void {
            if (preg_match('/from\s+`?users`?\b.*for update/is', $query->sql) === 1) {
                $locked = true;
            }
        });
        TenantContext::setById($this->testTenantId);
        $this->assertNotNull(VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgA, 'date' => $date, 'hours' => 2, 'description' => 'Locked.',
        ]));
        $this->assertTrue($locked, 'logHours must lock the member row before re-reading the day total');
    }
}
