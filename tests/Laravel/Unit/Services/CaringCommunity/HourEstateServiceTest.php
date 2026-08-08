<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\HourEstateService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Tests\Laravel\TestCase;

class HourEstateServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById($this->testTenantId);
    }

    private function service(): HourEstateService
    {
        return app(HourEstateService::class);
    }

    public function test_my_estate_returns_unset_envelope_when_member_has_no_nomination(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->myEstate($this->testTenantId, $member->id);

        $this->assertSame('not_set', $result['status']);
        $this->assertNull($result['policy_action']);
        $this->assertNull($result['beneficiary_user_id']);
        $this->assertSame($member->id, $result['member_user_id']);
    }

    public function test_nominate_donate_to_solidarity_clears_beneficiary(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'donate_to_solidarity',
            // beneficiary should be ignored for solidarity action
            'beneficiary_user_id' => 12345,
            'member_notes' => 'Please honour my wishes',
        ]);

        $this->assertSame('nominated', $result['status']);
        $this->assertSame('donate_to_solidarity', $result['policy_action']);
        $this->assertNull($result['beneficiary_user_id']);
        $this->assertSame('Please honour my wishes', $result['member_notes']);
    }

    public function test_nominate_transfer_to_beneficiary_requires_valid_other_tenant_user(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => 0,
        ]);
    }

    public function test_nominate_transfer_to_beneficiary_rejects_self(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $member->id,
        ]);
    }

    public function test_nominate_transfer_to_beneficiary_rejects_user_outside_tenant(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $otherTenantUser = User::factory()->forTenant(999)->create();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $otherTenantUser->id,
        ]);
    }

    public function test_nominate_transfer_to_beneficiary_persists_when_valid(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $beneficiary = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $beneficiary->id,
        ]);

        $this->assertSame('nominated', $result['status']);
        $this->assertSame('transfer_to_beneficiary', $result['policy_action']);
        $this->assertSame($beneficiary->id, $result['beneficiary_user_id']);
    }

    public function test_nominate_rejects_unknown_policy_action(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'set_on_fire',
        ]);
    }

    public function test_report_deceased_snapshots_balance_and_marks_reported(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 42]);
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $estate = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'donate_to_solidarity',
        ]);

        $reported = $this->service()->reportDeceased(
            $this->testTenantId,
            $estate['id'],
            $coordinator->id,
            'Notified by family.'
        );

        $this->assertSame('reported', $reported['status']);
        $this->assertSame(42.0, $reported['reported_balance_hours']);
    }

    public function test_report_deceased_rejects_already_settled(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $estate = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'donate_to_solidarity',
        ]);
        $this->service()->reportDeceased($this->testTenantId, $estate['id'], $coordinator->id, null);
        $this->service()->settle($this->testTenantId, $estate['id'], $coordinator->id, null);

        $this->expectException(RuntimeException::class);
        $this->service()->reportDeceased($this->testTenantId, $estate['id'], $coordinator->id, null);
    }

    public function test_settle_donate_to_solidarity_zeroes_balance_without_recipient(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10]);
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $estate = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'donate_to_solidarity',
        ]);
        $this->service()->reportDeceased($this->testTenantId, $estate['id'], $coordinator->id, null);

        $settled = $this->service()->settle($this->testTenantId, $estate['id'], $coordinator->id, 'Closing out.');

        $this->assertSame('settled', $settled['status']);
        $this->assertSame(10.0, $settled['settled_hours']);
        $this->assertEquals(0, (int) DB::table('users')->where('id', $member->id)->value('balance'));
    }

    public function test_settle_transfer_to_beneficiary_moves_balance(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8]);
        $beneficiary = User::factory()->forTenant($this->testTenantId)->create(['balance' => 2]);
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $estate = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $beneficiary->id,
        ]);
        $this->service()->reportDeceased($this->testTenantId, $estate['id'], $coordinator->id, null);

        $settled = $this->service()->settle($this->testTenantId, $estate['id'], $coordinator->id, null);

        $this->assertSame('settled', $settled['status']);
        $this->assertSame(8.0, $settled['settled_hours']);
        $this->assertEquals(0, (int) DB::table('users')->where('id', $member->id)->value('balance'));
        $this->assertEquals(10, (int) DB::table('users')->where('id', $beneficiary->id)->value('balance'));
    }

    public function test_settle_rejects_when_not_yet_reported(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 4]);
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $estate = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'donate_to_solidarity',
        ]);

        $this->expectException(RuntimeException::class);
        $this->service()->settle($this->testTenantId, $estate['id'], $coordinator->id, null);
    }

    public function test_list_estates_filters_by_status_and_excludes_other_tenants(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $other = User::factory()->forTenant(999)->create();

        $estate = $this->service()->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'donate_to_solidarity',
        ]);

        // Plant a row for tenant 999 that should never be returned for our tenant.
        DB::table('caring_hour_estates')->insert([
            'tenant_id' => 999,
            'member_user_id' => $other->id,
            'policy_action' => 'donate_to_solidarity',
            'status' => 'nominated',
            'nominated_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $allOurs = $this->service()->listEstates($this->testTenantId);
        $ids = array_column($allOurs, 'id');
        $this->assertContains($estate['id'], $ids);
        foreach ($allOurs as $row) {
            $this->assertSame($this->testTenantId, $row['tenant_id']);
        }

        $nominatedOnly = $this->service()->listEstates($this->testTenantId, 'nominated');
        foreach ($nominatedOnly as $row) {
            $this->assertSame('nominated', $row['status']);
        }

        $settledOnly = $this->service()->listEstates($this->testTenantId, 'settled');
        $this->assertSame([], array_filter($settledOnly, fn ($r) => $r['status'] !== 'settled'));
    }
}
