<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationCreditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminFederationCreditAgreementsController.
 *
 * Covers listing credit agreements, creating agreements, actions, and partners —
 * plus the credit-agreement state machine and dual-consent activation rules
 * (audit C1): the creating tenant must never be able to self-activate an
 * agreement, transitions must be legal, and activation requires an active
 * partnership between the two tenants.
 */
class AdminFederationCreditAgreementsControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // Seeding helpers (state machine tests)
    // ================================================================

    private function seedPartnerTenant(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Credit Partner',
            'slug' => 'credit-partner-' . substr(uniqid(), -8),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedActivePartnership(int $partnerTenantId): void
    {
        $data = [
            'tenant_id' => $this->testTenantId,
            'partner_tenant_id' => $partnerTenantId,
            'status' => 'active',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if (DB::getSchemaBuilder()->hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->testTenantId, $partnerTenantId) . '-' . max($this->testTenantId, $partnerTenantId);
        }
        DB::table('federation_partnerships')->insert($data);
    }

    /**
     * Seed a credit agreement FROM the test tenant TO the partner tenant.
     */
    private function seedAgreement(int $partnerTenantId, string $status, ?int $approvedByFrom = null, ?int $approvedByTo = null): int
    {
        return (int) DB::table('federation_credit_agreements')->insertGetId([
            'from_tenant_id' => $this->testTenantId,
            'to_tenant_id' => $partnerTenantId,
            'exchange_rate' => 1.0,
            'max_monthly_credits' => 100,
            'status' => $status,
            'approved_by_from' => $approvedByFrom,
            'approved_by_to' => $approvedByTo,
            'created_at' => now(),
        ]);
    }

    private function agreementStatus(int $id): string
    {
        return (string) DB::table('federation_credit_agreements')->where('id', $id)->value('status');
    }

    // ================================================================
    // INDEX — GET /v2/admin/federation/credit-agreements
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/federation/credit-agreements');

        // May return 200 or 503 if FederationCreditService is unavailable
        $this->assertContains($response->getStatusCode(), [200, 503]);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/federation/credit-agreements');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/federation/credit-agreements');

        $response->assertStatus(401);
    }

    // ================================================================
    // STORE — POST /v2/admin/federation/credit-agreements
    // ================================================================

    public function test_store_validates_partner_tenant_id(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/federation/credit-agreements', [
            'partner_tenant_id' => 0,
            'exchange_rate' => 1.0,
            'monthly_limit' => 100,
        ]);

        // Validation error
        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_store_rejects_self_agreement(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/federation/credit-agreements', [
            'partner_tenant_id' => $this->testTenantId,
            'exchange_rate' => 1.0,
            'monthly_limit' => 100,
        ]);

        // Validation error for self-agreement
        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_store_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/federation/credit-agreements', [
            'partner_tenant_id' => 99,
            'exchange_rate' => 1.0,
            'monthly_limit' => 100,
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // STATE MACHINE & DUAL CONSENT — POST .../credit-agreements/{id}/{action}
    // ================================================================

    public function test_creator_cannot_self_activate_pending_agreement(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $partnerTenantId = $this->seedPartnerTenant();
        $this->seedActivePartnership($partnerTenantId);
        // store() records the creator's approval in approved_by_from.
        $agreementId = $this->seedAgreement($partnerTenantId, 'pending', $admin->id);

        // The creating tenant approving its own agreement must NOT activate it —
        // the counterparty has not consented yet.
        $response = $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/approve");
        $response->assertStatus(200);
        $this->assertSame('pending', $response->json('data.status'));
        $this->assertSame('pending', $this->agreementStatus($agreementId));

        // Approving twice from the same side stays pending (idempotent).
        $again = $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/approve");
        $again->assertStatus(200);
        $this->assertSame('pending', $this->agreementStatus($agreementId));
    }

    public function test_counterparty_approval_activates_agreement(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $partnerTenantId = $this->seedPartnerTenant();
        $partnerAdmin = User::factory()->forTenant($partnerTenantId)->admin()->create();
        $this->seedActivePartnership($partnerTenantId);
        $agreementId = $this->seedAgreement($partnerTenantId, 'pending', $admin->id);

        // Counterparty consent (recorded from THEIR tenant context) completes
        // the dual approval and activates the agreement.
        TenantContext::setById($partnerTenantId);
        try {
            $result = (new FederationCreditService())->approveAgreement($agreementId, (int) $partnerAdmin->id);
        } finally {
            TenantContext::setById($this->testTenantId);
        }

        $this->assertTrue((bool) ($result['success'] ?? false));
        $this->assertSame('active', $result['status'] ?? null);
        $this->assertSame('active', $this->agreementStatus($agreementId));
    }

    public function test_approve_requires_active_partnership(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $partnerTenantId = $this->seedPartnerTenant();
        // NO partnership row between the tenants.
        $agreementId = $this->seedAgreement($partnerTenantId, 'pending', $admin->id);

        $response = $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/approve");

        $response->assertStatus(409);
        $this->assertSame('PARTNERSHIP_REQUIRED', $response->json('errors.0.code'));
        $this->assertSame('pending', $this->agreementStatus($agreementId));
    }

    public function test_terminated_agreement_cannot_be_resurrected(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $partnerTenantId = $this->seedPartnerTenant();
        $this->seedActivePartnership($partnerTenantId);
        $agreementId = $this->seedAgreement($partnerTenantId, 'terminated');

        foreach (['reactivate', 'activate', 'approve', 'suspend'] as $action) {
            $response = $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/{$action}");
            $this->assertSame(409, $response->getStatusCode(), "Action '{$action}' must be rejected on a terminated agreement");
            $this->assertSame('terminated', $this->agreementStatus($agreementId));
        }
    }

    public function test_pending_agreement_cannot_be_directly_activated_or_suspended(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $partnerTenantId = $this->seedPartnerTenant();
        $agreementId = $this->seedAgreement($partnerTenantId, 'pending', $admin->id);

        foreach (['activate', 'reactivate', 'suspend'] as $action) {
            $response = $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/{$action}");
            $this->assertSame(409, $response->getStatusCode(), "Action '{$action}' must be rejected on a pending agreement");
            $this->assertSame('INVALID_TRANSITION', $response->json('errors.0.code'));
            $this->assertSame('pending', $this->agreementStatus($agreementId));
        }
    }

    public function test_legal_lifecycle_transitions_succeed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $partnerTenantId = $this->seedPartnerTenant();
        $this->seedActivePartnership($partnerTenantId);
        $agreementId = $this->seedAgreement($partnerTenantId, 'active', $admin->id, 999999);

        // active -> suspended
        $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/suspend")->assertStatus(200);
        $this->assertSame('suspended', $this->agreementStatus($agreementId));

        // suspended -> active
        $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/reactivate")->assertStatus(200);
        $this->assertSame('active', $this->agreementStatus($agreementId));

        // active -> terminated
        $this->apiPost("/v2/admin/federation/credit-agreements/{$agreementId}/terminate")->assertStatus(200);
        $this->assertSame('terminated', $this->agreementStatus($agreementId));
    }

    // ================================================================
    // PARTNERS — GET /v2/admin/federation/partners
    // ================================================================

    public function test_partners_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/federation/partners');

        // May return 200 or 503 if service unavailable
        $this->assertContains($response->getStatusCode(), [200, 503]);
    }

    public function test_partners_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/federation/partners');

        $response->assertStatus(403);
    }

    // ================================================================
    // RESPONSE SHAPES the admin page reads (regressions, November 2026)
    //
    // The page's own tests mocked a shape the server never sent, so three
    // defects sat behind a green suite: the "New agreement" picker listed
    // blank names and posted a partnership id as a community id; an agreement
    // proposed BY the partner showed the caller's own name as the partner;
    // and the balance / sent / received figures were always 0.
    // ================================================================

    public function test_partners_identifies_the_partner_community_not_the_partnership_row(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();
        $this->seedActivePartnership($partnerTenantId);
        $partnershipId = (int) DB::table('federation_partnerships')
            ->where('tenant_id', $this->testTenantId)->where('partner_tenant_id', $partnerTenantId)->value('id');

        $response = $this->apiGet('/v2/admin/federation/partners');
        $response->assertStatus(200);

        $row = collect($response->json('data'))->firstWhere('partnership_id', $partnershipId);
        $this->assertNotNull($row, 'the seeded partnership must be listed');
        $this->assertSame($partnerTenantId, $row['id'], '`id` is what the page posts as partner_tenant_id');
        $this->assertSame('Credit Partner', $row['name'], '`name` is what the picker displays');
        $this->assertNotSame('', $row['slug']);
    }

    public function test_partners_resolves_the_partner_when_the_other_side_started_the_partnership(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();
        $data = [
            'tenant_id' => $partnerTenantId,
            'partner_tenant_id' => $this->testTenantId,
            'status' => 'active',
            'federation_level' => 3,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if (DB::getSchemaBuilder()->hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->testTenantId, $partnerTenantId) . '-' . max($this->testTenantId, $partnerTenantId);
        }
        DB::table('federation_partnerships')->insert($data);

        $response = $this->apiGet('/v2/admin/federation/partners');
        $response->assertStatus(200);

        $row = collect($response->json('data'))->firstWhere('id', $partnerTenantId);
        $this->assertNotNull($row, 'the partner community must be listed under its own id');
        $this->assertSame('Credit Partner', $row['name']);
    }

    public function test_index_names_the_other_community_as_partner_whichever_side_proposed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();

        // Proposed BY the partner TO us — the case that used to show our own name.
        $id = (int) DB::table('federation_credit_agreements')->insertGetId([
            'from_tenant_id' => $partnerTenantId,
            'to_tenant_id' => $this->testTenantId,
            'exchange_rate' => 1.0,
            'max_monthly_credits' => 50,
            'status' => 'pending',
            'approved_by_from' => 1,
            'approved_by_to' => null,
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/admin/federation/credit-agreements');
        $response->assertStatus(200);

        $row = collect($response->json('data'))->firstWhere('id', $id);
        $this->assertNotNull($row);
        $this->assertSame($partnerTenantId, $row['partner_tenant']['id']);
        $this->assertSame('Credit Partner', $row['partner_tenant']['name']);
        // The partner has approved, we have not: it is our move.
        $this->assertSame('you', $row['awaiting']);
    }

    public function test_index_says_when_a_pending_agreement_is_waiting_on_the_partner(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();
        $id = $this->seedAgreement($partnerTenantId, 'pending', $admin->id, null);

        $row = collect($this->apiGet('/v2/admin/federation/credit-agreements')->json('data'))->firstWhere('id', $id);

        $this->assertSame('partner', $row['awaiting']);
    }

    public function test_index_carries_the_real_sent_received_and_balance_figures(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();
        $id = $this->seedAgreement($partnerTenantId, 'active', 1, 2);

        $tx = fn (int $from, int $to, float $amount, string $status) => DB::table('federation_transactions')->insert([
            'sender_tenant_id' => $from,
            'sender_user_id' => $admin->id,
            'receiver_tenant_id' => $to,
            'receiver_user_id' => $admin->id,
            'amount' => $amount,
            'status' => $status,
            'created_at' => now(),
        ]);
        $tx($this->testTenantId, $partnerTenantId, 3.0, 'completed');   // we sent 3
        $tx($partnerTenantId, $this->testTenantId, 5.5, 'completed');   // we received 5.5
        $tx($this->testTenantId, $partnerTenantId, 40.0, 'pending');    // not completed — must not count

        $row = collect($this->apiGet('/v2/admin/federation/credit-agreements')->json('data'))->firstWhere('id', $id);

        $this->assertEqualsWithDelta(3.0, $row['credits_sent'], 0.001);
        $this->assertEqualsWithDelta(5.5, $row['credits_received'], 0.001);
        $this->assertEqualsWithDelta(2.5, $row['current_balance'], 0.001);
        $this->assertNull($row['awaiting'], 'an active agreement is waiting on nobody');
    }

    public function test_store_refuses_a_second_agreement_instead_of_reporting_success(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();
        $this->seedAgreement($partnerTenantId, 'active', 1, 2);

        $response = $this->apiPost('/v2/admin/federation/credit-agreements', [
            'partner_tenant_id' => $partnerTenantId,
            'exchange_rate' => 1.0,
            'monthly_limit' => 100,
        ]);

        $response->assertStatus(409);
        $this->assertSame(1, DB::table('federation_credit_agreements')
            ->where('from_tenant_id', $this->testTenantId)->where('to_tenant_id', $partnerTenantId)->count());
    }

    public function test_store_creates_a_pending_agreement_with_the_named_partner(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partnerTenantId = $this->seedPartnerTenant();

        $response = $this->apiPost('/v2/admin/federation/credit-agreements', [
            'partner_tenant_id' => $partnerTenantId,
            'exchange_rate' => 1.0,
            'monthly_limit' => 80,
        ]);

        $response->assertStatus(201);
        $row = DB::table('federation_credit_agreements')
            ->where('from_tenant_id', $this->testTenantId)->where('to_tenant_id', $partnerTenantId)->first();
        $this->assertNotNull($row);
        $this->assertSame('pending', $row->status);
        $this->assertEqualsWithDelta(80.0, (float) $row->max_monthly_credits, 0.001);
    }
}
