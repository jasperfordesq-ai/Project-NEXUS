<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupExchangeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-177 (E-035): creating a group exchange trusted the client's `status` and
 * `broker_id` (and `broker_notes`), so an organiser could create an exchange
 * already in `pending_confirmation` — skipping start()'s provider/receiver and
 * conservation checks — or present it as overseen by a broker who never saw it.
 * Completion must recompute confirmations and the split under the row lock.
 */
class GroupExchangeServerDerivedFieldsTest extends TestCase
{
    use DatabaseTransactions;

    private GroupExchangeService $service;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->service = app(GroupExchangeService::class);
    }

    public function test_create_ignores_client_supplied_status_and_broker_fields(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $broker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'role' => 'broker']);

        $id = $this->service->create((int) $organizer->id, [
            'title' => 'F-177',
            'total_hours' => 4,
            'split_type' => 'equal',
            'status' => 'pending_confirmation',
            'broker_id' => (int) $broker->id,
            'broker_notes' => 'Approved by the broker',
        ]);

        $this->assertIsInt($id);
        $row = DB::table('group_exchanges')->where('id', $id)->first();
        $this->assertSame('draft', $row->status, 'client-supplied status was trusted');
        $this->assertNull($row->broker_id, 'client-supplied broker_id was trusted');
        $this->assertNull($row->broker_notes, 'client-supplied broker_notes was trusted');
    }

    public function test_organiser_update_cannot_set_broker_fields(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $broker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'role' => 'broker']);
        $id = $this->service->create((int) $organizer->id, ['title' => 'F-177u', 'total_hours' => 4]);

        $this->assertTrue($this->service->update((int) $id, [
            'title' => 'F-177u renamed',
            'broker_id' => (int) $broker->id,
            'broker_notes' => 'Approved by the broker',
        ]));

        $row = DB::table('group_exchanges')->where('id', $id)->first();
        $this->assertSame('F-177u renamed', $row->title);
        $this->assertNull($row->broker_id);
        $this->assertNull($row->broker_notes);
    }

    public function test_completion_recomputes_confirmations_after_terms_change(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'balance' => 0]);
        $provider = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'balance' => 0]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'balance' => 20]);

        $id = (int) DB::table('group_exchanges')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organizer_id' => $organizer->id, 'title' => 'F-177c',
            'status' => 'pending_confirmation', 'split_type' => 'custom', 'total_hours' => 2,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([[(int) $provider->id, 'provider'], [(int) $receiver->id, 'receiver']] as [$uid, $role]) {
            DB::table('group_exchange_participants')->insert([
                'group_exchange_id' => $id, 'user_id' => $uid, 'role' => $role, 'hours' => 2,
                'confirmed' => 1, 'confirmed_at' => now(), 'created_at' => now(),
            ]);
        }

        // Terms change after everyone confirmed: confirmations must reset, and
        // completion must see that rather than a stale earlier read.
        $this->assertTrue($this->service->update($id, ['total_hours' => 8]));

        $result = $this->service->complete($id);

        $this->assertFalse($result['success']);
        $this->assertSame('20.00', (string) DB::table('users')->where('id', $receiver->id)->value('balance'));
        $this->assertSame('0.00', (string) DB::table('users')->where('id', $provider->id)->value('balance'));
        $this->assertSame('pending_confirmation', (string) DB::table('group_exchanges')->where('id', $id)->value('status'));
    }
}
