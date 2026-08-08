<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Attested offline confirmation (guardian redesign, phase 4c).
 *
 * Some supported members never click a link or open the app — this flow
 * exists for them. A broker records that the member confirmed offline (by
 * phone, in person, or on paper), naming the channel and any witness. The
 * record is honest about being weaker evidence: confirmed_via says
 * 'attested_offline', never the member's own click — and the member is
 * notified that it happened in their name, because an attestation they never
 * learn about is substitution, not consent.
 */
class SupportActionAttestationTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0:User,1:User,2:int} [supporter, supported, actionId] */
    private function seedPendingTransfer(): array
    {
        $tenantId = $this->testTenantId;

        $supporter = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Molly', 'last_name' => 'Member',
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $recipient = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);

        $relationshipId = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $tenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['tiers' => ['credits' => SupportTiers::CO_DECIDE]]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $tenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => $recipient->id, 'amount' => 3.0, 'description' => 'Weekly shop']),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'attest-test-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$supporter, $supported, $actionId];
    }

    private function actingBroker(bool $grantManage = true): User
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker', 'status' => 'active', 'is_approved' => true,
        ]);
        if ($grantManage) {
            // The committed schema dump seeds only the migration tables, so
            // `permissions` is empty in CI and this lookup returns null —
            // which made the insert below fail on the NOT NULL column rather
            // than granting anything. Create the row when it is absent, the
            // same way SafeguardingEscalationDeliveryTest does.
            $permissionId = DB::table('permissions')->where('name', 'safeguarding.manage')->value('id');
            if (!$permissionId) {
                $permissionId = DB::table('permissions')->insertGetId([
                    'name' => 'safeguarding.manage',
                    'display_name' => 'Manage safeguarding',
                    'description' => 'Manage safeguarding records and attestations',
                    'category' => 'safeguarding',
                    'is_dangerous' => 0,
                    'tenant_id' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
            DB::table('user_permissions')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $broker->id,
                'permission_id' => $permissionId,
                'granted' => 1,
                'granted_at' => now(),
            ]);
        }
        Sanctum::actingAs($broker, ['*']);

        return $broker;
    }

    public function test_broker_without_safeguarding_manage_cannot_attest(): void
    {
        [, , $actionId] = $this->seedPendingTransfer();
        $this->actingBroker(false);

        $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'phone',
        ])->assertStatus(403);
        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    public function test_an_ordinary_member_cannot_reach_the_attest_endpoint(): void
    {
        [, , $actionId] = $this->seedPendingTransfer();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);

        $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'phone',
        ])->assertStatus(403);

        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    public function test_a_broker_can_record_an_offline_confirmation_and_it_executes(): void
    {
        [$supporter, $supported, $actionId] = $this->seedPendingTransfer();
        $broker = $this->actingBroker();

        $response = $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'phone',
            'witness' => 'Nora Neighbour',
        ]);

        $response->assertStatus(200);
        $this->assertSame('attested_offline', $response->json('data.confirmed_via'));

        // Executed through the member's own wallet path, attributed to the SUPPORTER.
        $this->assertEquals(7.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $txn = DB::table('transactions')->where('sender_id', $supported->id)->first();
        $this->assertNotNull($txn);
        $this->assertEquals($supporter->id, (int) $txn->acting_user_id);

        // The row says plainly HOW this was confirmed and by whom — weaker
        // evidence, recorded as such, never dressed up as the member's click.
        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('confirmed', $row->status);
        $this->assertSame('attested_offline', $row->confirmed_via);
        $this->assertEquals($broker->id, (int) $row->attested_by_user_id);
        $this->assertSame('phone', $row->attested_channel);
        $this->assertSame('Nora Neighbour', $row->attested_witness);

        // The member is told an offline confirmation was recorded in their name.
        $this->assertDatabaseHas('notifications', ['user_id' => $supported->id]);
    }

    public function test_offline_attestation_fails_after_authority_is_downgraded(): void
    {
        [, $supported, $actionId] = $this->seedPendingTransfer();
        $this->actingBroker();

        $relationshipId = DB::table('support_pending_actions')->where('id', $actionId)->value('relationship_id');
        DB::table('account_relationships')->where('id', $relationshipId)->update([
            'permissions' => json_encode(['tiers' => ['activity' => 'none', 'listings' => 'none', 'credits' => 'none']]),
        ]);

        $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'phone',
        ])->assertStatus(422);

        $this->assertSame('cancelled', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
    }

    public function test_an_unknown_channel_is_refused_and_nothing_executes(): void
    {
        [, $supported, $actionId] = $this->seedPendingTransfer();
        $this->actingBroker();

        $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'carrier_pigeon',
        ])->assertStatus(422);

        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    public function test_the_witness_is_optional(): void
    {
        [, , $actionId] = $this->seedPendingTransfer();
        $this->actingBroker();

        $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'in_person',
        ])->assertStatus(200);

        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('in_person', $row->attested_channel);
        $this->assertNull($row->attested_witness);
    }

    public function test_staff_can_list_the_tenants_pending_queue(): void
    {
        [, , $actionId] = $this->seedPendingTransfer();
        $this->actingBroker();

        $response = $this->apiGet('/v2/admin/safeguarding/support-actions');

        $response->assertStatus(200);
        $actions = $response->json('data.actions');
        $ids = array_column($actions, 'id');
        $this->assertContains($actionId, $ids);
        // Both parties are named for the staff view, and the raw payload is
        // not dumped — only the safe summary.
        $match = collect($actions)->firstWhere('id', $actionId);
        $this->assertSame('Molly Member', $match['supported_name']);
        $this->assertArrayNotHasKey('payload', $match);
    }
}
