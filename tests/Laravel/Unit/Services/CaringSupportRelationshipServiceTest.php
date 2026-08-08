<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringSupportRelationshipService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class CaringSupportRelationshipServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById($this->testTenantId);
    }

    private function service(): CaringSupportRelationshipService
    {
        return app(CaringSupportRelationshipService::class);
    }

    public function test_create_validates_supporter_recipient_must_differ(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->create($this->testTenantId, [
            'supporter_id' => $user->id,
            'recipient_id' => $user->id,
        ], $coord->id);

        $this->assertFalse($result['success']);
        $this->assertSame('VALIDATION_ERROR', $result['code']);
    }

    public function test_create_rejects_users_outside_tenant(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $stranger = User::factory()->forTenant(999)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $stranger->id,
        ], $coord->id);

        $this->assertFalse($result['success']);
        $this->assertSame('USER_NOT_FOUND', $result['code']);
    }

    public function test_create_persists_relationship_with_defaults_and_next_check_in(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'frequency' => 'weekly',
            'expected_hours' => 2,
            'start_date' => '2026-04-01',
            'title' => 'Weekly check-ins',
        ], $coord->id);

        $this->assertTrue($result['success']);
        $rel = $result['relationship'];
        $this->assertSame('active', $rel['status']);
        $this->assertSame('weekly', $rel['frequency']);
        $this->assertSame(2.0, $rel['expected_hours']);
        $this->assertSame('Weekly check-ins', $rel['title']);
        $this->assertSame($supporter->id, $rel['supporter']['id']);
        $this->assertSame($recipient->id, $rel['recipient']['id']);
        // weekly -> +7 days from start_date at 09:00:00
        $this->assertSame('2026-04-08 09:00:00', $rel['next_check_in_at']);
    }

    public function test_create_clamps_expected_hours_to_safe_range(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();

        $low = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'expected_hours' => 0.01,
        ], $coord->id);
        $this->assertSame(0.25, $low['relationship']['expected_hours']);

        $high = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'expected_hours' => 999,
        ], $coord->id);
        $this->assertSame(24.0, $high['relationship']['expected_hours']);
    }

    public function test_create_normalises_invalid_frequency_to_weekly(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'frequency' => 'yearly-on-the-third-blue-moon',
        ], $coord->id);

        $this->assertSame('weekly', $result['relationship']['frequency']);
    }

    public function test_update_changes_status_and_normalises_unknown_status(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();
        $created = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ], $coord->id);
        $id = $created['relationship']['id'];

        $paused = $this->service()->update($this->testTenantId, $id, ['status' => 'paused']);
        $this->assertSame('paused', $paused['status']);

        // Unknown status is silently dropped — previous state preserved.
        $unchanged = $this->service()->update($this->testTenantId, $id, ['status' => 'bogus']);
        $this->assertSame('paused', $unchanged['status']);
    }

    public function test_update_returns_null_for_other_tenant_relationship(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();
        $created = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ], $coord->id);

        $this->assertNull($this->service()->update(999, $created['relationship']['id'], ['status' => 'paused']));
    }

    public function test_list_returns_stats_and_filters_by_status(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->create();

        // Wipe pre-existing rows so stats are deterministic.
        DB::table('caring_support_relationships')->where('tenant_id', $this->testTenantId)->delete();

        $a = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'expected_hours' => 3,
        ], $coord->id);
        $b = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'expected_hours' => 1.5,
        ], $coord->id);
        $this->service()->update($this->testTenantId, $b['relationship']['id'], ['status' => 'paused']);

        $listAll = $this->service()->list($this->testTenantId, ['status' => 'all']);
        $this->assertCount(2, $listAll['items']);
        $this->assertSame(1, $listAll['stats']['active_count']);
        $this->assertSame(1, $listAll['stats']['paused_count']);
        $this->assertSame(3.0, $listAll['stats']['expected_active_hours']);

        $listActive = $this->service()->list($this->testTenantId, ['status' => 'active']);
        $this->assertCount(1, $listActive['items']);
        $this->assertSame($a['relationship']['id'], $listActive['items'][0]['id']);
    }

    public function test_log_hours_rejects_inactive_relationship(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $created = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ], $coord->id);
        $id = $created['relationship']['id'];
        $this->service()->update($this->testTenantId, $id, ['status' => 'paused']);

        $result = $this->service()->logHours($this->testTenantId, $id, [
            'date' => date('Y-m-d'),
            'hours' => 1.5,
        ], $coord->id);

        $this->assertFalse($result['success']);
        $this->assertSame('RELATIONSHIP_INACTIVE', $result['code']);
    }

    public function test_log_hours_rejects_future_dates_and_zero_hours(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $created = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ], $coord->id);
        $id = $created['relationship']['id'];

        $future = $this->service()->logHours($this->testTenantId, $id, [
            'date' => date('Y-m-d', strtotime('+5 days')),
            'hours' => 1,
        ], $coord->id);
        $this->assertFalse($future['success']);
        $this->assertSame('VALIDATION_ERROR', $future['code']);

        $zero = $this->service()->logHours($this->testTenantId, $id, [
            'date' => date('Y-m-d'),
            'hours' => 0,
        ], $coord->id);
        $this->assertFalse($zero['success']);
        $this->assertSame('VALIDATION_ERROR', $zero['code']);
    }

    public function test_log_hours_blocks_duplicate_same_date_entries(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $created = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ], $coord->id);
        $id = $created['relationship']['id'];
        $today = date('Y-m-d');

        $first = $this->service()->logHours($this->testTenantId, $id, [
            'date' => $today,
            'hours' => 1,
            'description' => 'First',
        ], $coord->id);
        $this->assertTrue($first['success']);

        $duplicate = $this->service()->logHours($this->testTenantId, $id, [
            'date' => $today,
            'hours' => 2,
            'description' => 'Same date',
        ], $coord->id);
        $this->assertFalse($duplicate['success']);
        $this->assertSame('ALREADY_EXISTS', $duplicate['code']);
    }

    public function test_log_hours_mints_even_when_org_auto_pay_disabled_and_balance_low(): void
    {
        // Regression: an auto-approved caring log ALWAYS mints time credits — never
        // gated by the org's auto_pay_enabled flag or wallet balance. The org wallet
        // is debited unconditionally and allowed to go negative, mirroring
        // VolunteerService. Previously auto_pay_enabled=0 skipped payment and a low
        // balance returned 'insufficient_balance', so the supporter's approved hours
        // were never credited.
        $supporter = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $coord = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'KISS Zug',
            'balance' => 1, // far less than the 3 owed
            'auto_pay_enabled' => 0, // auto-pay OFF — approval must still mint
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $created = $this->service()->create($this->testTenantId, [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'organization_id' => $orgId,
        ], $coord->id);
        $id = $created['relationship']['id'];

        $result = $this->service()->logHours($this->testTenantId, $id, [
            'date' => date('Y-m-d'),
            'hours' => 3.5,
            'description' => 'Support visit.',
        ], $coord->id);

        $this->assertTrue($result['success']);
        $this->assertSame('approved', $result['log']['status']);
        $this->assertSame('paid', $result['log']['payment_result']);

        // floor(3.5) = 3 minted to the supporter; org debited the same 3 → 1 - 3 = -2.
        $this->assertSame(3, (int) DB::table('users')->where('id', $supporter->id)->value('balance'));
        $this->assertEqualsWithDelta(-2.0, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'), 0.001);
    }
}
