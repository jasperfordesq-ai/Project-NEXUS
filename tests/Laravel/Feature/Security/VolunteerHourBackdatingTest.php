<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-101 / F-141 (E-027): volunteer hours could be logged for any past date.
 *
 * The only date rule was "not in the future", and duplicates were blocked
 * only per organisation + date + opportunity. An organisation owner and a
 * second account could therefore mint 24 credits a day per opportunity back
 * for years; where hours auto-approve, one volunteer could do it alone.
 */
class VolunteerHourBackdatingTest extends TestCase
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
            'name' => 'Backdating fixture ' . uniqid(),
            'slug' => 'backdating-fixture-' . uniqid(),
            'description' => 'F-101 regression fixture.',
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

    private function log(User $volunteer, int $orgId, string $date, float $hours): ?int
    {
        TenantContext::setById($this->testTenantId);

        return VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgId,
            'date' => $date,
            'hours' => $hours,
            'description' => 'Neighbour support visit.',
        ]);
    }

    public function test_hours_older_than_the_backdating_window_are_refused(): void
    {
        $owner = $this->member();
        $volunteer = $this->member();
        $orgId = $this->organisationWithVolunteer($owner, $volunteer);

        $this->assertNull($this->log($volunteer, $orgId, now()->subYears(3)->toDateString(), 24));
        $this->assertSame('date', VolunteerService::getErrors()[0]['field'] ?? null);

        // Control: a recent date is still accepted.
        $this->assertNotNull($this->log($volunteer, $orgId, now()->subDays(5)->toDateString(), 3));
    }

    public function test_one_day_cannot_hold_more_than_24_hours_across_organisations(): void
    {
        $volunteer = $this->member();
        $orgA = $this->organisationWithVolunteer($this->member(), $volunteer);
        $orgB = $this->organisationWithVolunteer($this->member(), $volunteer);
        $date = now()->subDays(2)->toDateString();

        $this->assertNotNull($this->log($volunteer, $orgA, $date, 20));
        $this->assertNull($this->log($volunteer, $orgB, $date, 10), 'A second 10h log on the same day would total 30h');
        $this->assertSame('hours', VolunteerService::getErrors()[0]['field'] ?? null);

        // Control: the remainder of the day is still allowed.
        $this->assertNotNull($this->log($volunteer, $orgB, $date, 4));
    }
}
