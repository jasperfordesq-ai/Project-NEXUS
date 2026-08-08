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
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Legal-basis attestation (guardian redesign, phase 6) — the vetting-pattern
 * clone for act-alone (represent) power. The rules pinned here ARE the
 * design; weaken any and the surface stops being what it claims:
 *
 * - evidence content is refused outright, nothing written;
 * - the explicit sighted-acknowledgement is required, never inferred;
 * - free text is stored encrypted, never in the clear;
 * - revocation uses the closed vocabulary only;
 * - every transition lands in an append-only events table the database
 *   itself refuses to update.
 */
class SupportAuthorityAttestationTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0:User,1:User,2:int} [supporter, supported, relationshipId] */
    private function seedRepresentRelationship(string $tier = SupportTiers::REPRESENT): array
    {
        $tenantId = $this->testTenantId;

        $supporter = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Sam', 'last_name' => 'Supporter', 'status' => 'active', 'is_approved' => true,
        ]);
        $supported = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Molly', 'last_name' => 'Member', 'status' => 'active', 'is_approved' => true,
        ]);

        $relationshipId = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $tenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['tiers' => ['credits' => $tier]]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$supporter, $supported, $relationshipId];
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

    public function test_broker_without_safeguarding_manage_cannot_attest_authority(): void
    {
        [, , $relationshipId] = $this->seedRepresentRelationship();
        $this->actingBroker(false);

        $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'power_of_attorney',
            'acknowledged_sighted' => true,
        ])->assertStatus(403);
    }

    public function test_an_ordinary_member_cannot_reach_the_attest_endpoint(): void
    {
        [, , $relationshipId] = $this->seedRepresentRelationship();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'power_of_attorney',
            'acknowledged_sighted' => true,
        ])->assertStatus(403);

        $this->assertSame(0, DB::table('support_authority_attestations')->count());
    }

    public function test_attesting_requires_the_explicit_sighted_acknowledgement(): void
    {
        [, , $relationshipId] = $this->seedRepresentRelationship();
        $this->actingBroker();

        $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'power_of_attorney',
            'acknowledged_sighted' => false,
        ])->assertStatus(422);

        $this->assertSame(0, DB::table('support_authority_attestations')->count());
    }

    public function test_evidence_content_is_refused_and_nothing_is_written(): void
    {
        [, , $relationshipId] = $this->seedRepresentRelationship();
        $this->actingBroker();

        $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'dmr_court_order',
            'acknowledged_sighted' => true,
            // The platform must not become a store of capacity orders.
            'certificate_number' => 'DMR-2026-0042',
        ])->assertStatus(422);

        $this->assertSame(0, DB::table('support_authority_attestations')->count());
        $this->assertSame(0, DB::table('support_authority_attestation_events')->count());
    }

    public function test_a_broker_can_attest_and_free_text_is_encrypted_at_rest(): void
    {
        [, $supported, $relationshipId] = $this->seedRepresentRelationship();
        $broker = $this->actingBroker();

        $response = $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'power_of_attorney',
            'acknowledged_sighted' => true,
            'scope_summary' => 'Financial decisions only, per the registered EPA.',
        ]);

        $response->assertStatus(200);
        $attestationId = (int) $response->json('data.id');

        $row = DB::table('support_authority_attestations')->where('id', $attestationId)->first();
        $this->assertSame('active', $row->decision);
        $this->assertSame('power_of_attorney', $row->authority_type);
        $this->assertEquals($broker->id, (int) $row->attested_by);
        $this->assertEquals($supported->id, (int) $row->supported_user_id);
        // Encrypted at rest: the stored value is not the plaintext, and it
        // decrypts back to exactly what staff typed.
        $this->assertStringNotContainsString('Financial decisions', (string) $row->scope_summary_encrypted);
        $this->assertSame(
            'Financial decisions only, per the registered EPA.',
            Crypt::decryptString((string) $row->scope_summary_encrypted),
        );

        $event = DB::table('support_authority_attestation_events')->where('attestation_id', $attestationId)->first();
        $this->assertNotNull($event);
        $this->assertSame('attested', $event->event_type);
        $this->assertNull($event->decision_before);
        $this->assertSame('active', $event->decision_after);
        $this->assertEquals($broker->id, (int) $event->actor_user_id);
    }

    public function test_revocation_uses_the_closed_vocabulary_and_reattest_reuses_the_row(): void
    {
        [, , $relationshipId] = $this->seedRepresentRelationship();
        $this->actingBroker();

        $attestationId = (int) $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'dmr_court_order',
            'acknowledged_sighted' => true,
        ])->json('data.id');

        // Free-text reason refused.
        $this->apiPost("/v2/admin/safeguarding/authority-attestations/{$attestationId}/revoke", [
            'reason_code' => 'because I said so',
        ])->assertStatus(422);
        $this->assertSame('active', DB::table('support_authority_attestations')->where('id', $attestationId)->value('decision'));

        // Closed-vocabulary reason accepted.
        $this->apiPost("/v2/admin/safeguarding/authority-attestations/{$attestationId}/revoke", [
            'reason_code' => 'authority_ended',
        ])->assertStatus(200);
        $row = DB::table('support_authority_attestations')->where('id', $attestationId)->first();
        $this->assertSame('revoked', $row->decision);
        $this->assertSame('authority_ended', $row->revocation_reason_code);

        // Re-attesting transitions the SAME row back to active; history lives
        // in events, not in extra rows.
        $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'dmr_court_order',
            'acknowledged_sighted' => true,
        ])->assertStatus(200);
        $this->assertSame(1, DB::table('support_authority_attestations')->where('relationship_id', $relationshipId)->count());
        $this->assertSame('active', DB::table('support_authority_attestations')->where('id', $attestationId)->value('decision'));

        $types = DB::table('support_authority_attestation_events')
            ->where('attestation_id', $attestationId)
            ->orderBy('id')
            ->pluck('event_type')
            ->all();
        $this->assertSame(['attested', 'revoked', 're_attested'], $types);
    }

    public function test_the_events_table_refuses_updates_at_the_database_level(): void
    {
        [, , $relationshipId] = $this->seedRepresentRelationship();
        $this->actingBroker();

        $attestationId = (int) $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $relationshipId,
            'authority_type' => 'power_of_attorney',
            'acknowledged_sighted' => true,
        ])->json('data.id');

        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('support_authority_attestation_events')
            ->where('attestation_id', $attestationId)
            ->update(['decision_after' => 'tampered']);
    }

    public function test_the_list_shows_represent_relationships_only_with_decrypted_summaries(): void
    {
        [, , $representId] = $this->seedRepresentRelationship();
        // A co_decide-only relationship carries no act-alone power and is not
        // part of the population this record-keeping exists for.
        [, , $coDecideId] = $this->seedRepresentRelationship(SupportTiers::CO_DECIDE);
        $this->actingBroker();

        $this->apiPost('/v2/admin/safeguarding/authority-attestations', [
            'relationship_id' => $representId,
            'authority_type' => 'power_of_attorney',
            'acknowledged_sighted' => true,
            'scope_summary' => 'Financial decisions only.',
        ])->assertStatus(200);

        $response = $this->apiGet('/v2/admin/safeguarding/authority-attestations');
        $response->assertStatus(200);

        $rows = $response->json('data.relationships');
        $ids = array_column($rows, 'relationship_id');
        $this->assertContains($representId, $ids);
        $this->assertNotContains($coDecideId, $ids);

        $match = collect($rows)->firstWhere('relationship_id', $representId);
        $this->assertSame('Financial decisions only.', $match['attestations'][0]['scope_summary']);
    }
}
