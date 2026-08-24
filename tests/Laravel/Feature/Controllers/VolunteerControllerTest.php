<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Services\VolunteerService;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for VolunteerController — volunteering opportunities, applications,
 * shifts, hours, organisations, certificates, expenses, and more.
 */
class VolunteerControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createVolunteerOrganisation(int $ownerId, float $balance, bool $autoPayEnabled): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'KISS Partner ' . uniqid(),
            'slug' => 'kiss-partner-' . uniqid(),
            'description' => 'Neighbourhood caring community partner.',
            'status' => 'active',
            'auto_pay_enabled' => $autoPayEnabled,
            'balance' => $balance,
            'created_at' => now(),
        ]);
    }

    private function addVolunteerToOrganisation(int $userId, int $orgId): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function setCaringWorkflowApprovalRequired(bool $approvalRequired): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $this->testTenantId,
                'setting_key' => 'caring_community.workflow.approval_required',
            ],
            [
                'setting_value' => $approvalRequired ? '1' : '0',
                'setting_type' => 'boolean',
                'category' => 'caring_community',
                'description' => 'Caring community workflow policy setting.',
                'updated_at' => now(),
            ]
        );
    }

    private function enableVolunteeringFeature(): void
    {
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);

        TenantContext::setById($this->testTenantId);
    }

    private function createPublicOrganisation(User $owner, array $overrides = []): int
    {
        return (int) DB::table('vol_organizations')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Neighbourhood Care Collective',
            'slug' => 'neighbourhood-care-collective-' . uniqid(),
            'description' => 'A public organisation profile for local care and volunteering.',
            'contact_email' => 'hello@example.test',
            'website' => 'https://example.test/care',
            'logo_url' => '/uploads/tenants/hour-timebank/organisations/care-collective.png',
            'status' => 'active',
            'org_type' => 'organisation',
            'auto_pay_enabled' => true,
            'balance' => 42.50,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/opportunities
    // ------------------------------------------------------------------

    public function test_opportunities_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/opportunities');

        $response->assertStatus(200);
    }

    public function test_opportunities_do_not_expose_creator_internal_id(): void
    {
        $this->authenticatedUser();

        // VOL-BE-011: the public/browse list must not leak the creator's internal
        // users.id (name + avatar remain for display).
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $orgId = $this->createPublicOrganisation($owner);
        DB::table('vol_opportunities')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Creator Id Opportunity',
            'description' => 'Testing creator id stripping.',
            'is_active' => 1,
            'status' => 'open',
            'created_by' => $owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        $response = $this->apiGet('/v2/volunteering/opportunities');
        $response->assertStatus(200);

        $items = $response->json('data') ?? [];
        $creators = array_values(array_filter(array_map(
            static fn ($item) => $item['creator'] ?? null,
            $items
        )));

        $this->assertNotEmpty($creators, 'at least one opportunity should carry a creator');
        foreach ($creators as $creator) {
            $this->assertArrayNotHasKey('id', $creator);
            $this->assertArrayHasKey('first_name', $creator);
        }
    }

    public function test_legacy_opportunities_endpoint_returns_collection_without_type_error(): void
    {
        $this->authenticatedUser();

        $response = $this->getJson('/api/vol_opportunities', $this->withTenantHeader());

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ------------------------------------------------------------------
    //  POST /v2/volunteering/opportunities
    // ------------------------------------------------------------------

    public function test_create_opportunity_requires_auth(): void
    {
        $response = $this->apiPost('/v2/volunteering/opportunities', [
            'title' => 'Park Cleanup',
            'description' => 'Help clean up the local park',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/opportunities/{id}
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    //  POST /v2/volunteering/opportunities/{id}/apply
    // ------------------------------------------------------------------

public function test_apply_requires_auth(): void
    {
        $response = $this->apiPost('/v2/volunteering/opportunities/1/apply');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/applications
    // ------------------------------------------------------------------

    public function test_my_applications_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/applications');

        $response->assertStatus(401);
    }

    public function test_my_applications_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/applications');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/shifts
    // ------------------------------------------------------------------

    public function test_my_shifts_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/shifts');

        $response->assertStatus(401);
    }

    public function test_my_shifts_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/shifts');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/hours
    // ------------------------------------------------------------------

    public function test_my_hours_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/hours');

        $response->assertStatus(401);
    }

    public function test_my_hours_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/hours');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/volunteering/hours
    // ------------------------------------------------------------------

    public function test_log_hours_requires_auth(): void
    {
        $response = $this->apiPost('/v2/volunteering/hours', [
            'hours' => 2.5,
            'description' => 'Park cleanup',
        ]);

        $response->assertStatus(401);
    }

    public function test_auto_approved_hours_with_auto_pay_credit_wallets_and_write_audit_entries(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 3]);
        $orgId = $this->createVolunteerOrganisation($owner->id, 20.00, true);
        $this->addVolunteerToOrganisation($volunteer->id, $orgId);
        $this->setCaringWorkflowApprovalRequired(false);

        // User::factory()->forTenant() drifts TenantContext to tenant 1; re-pin it
        // so the direct (non-HTTP) service call scopes to the test tenant.
        TenantContext::setById($this->testTenantId);

        $logId = VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgId,
            'date' => now()->subDay()->toDateString(),
            'hours' => 2.75,
            'description' => 'Neighbour support visit.',
        ]);

        $this->assertNotNull($logId);
        $this->assertSame('approved', VolunteerService::getLastLogStatus());
        $this->assertSame('approved', DB::table('vol_logs')->where('id', $logId)->value('status'));
        $this->assertEquals(18.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(5, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));

        $orgTransaction = DB::table('vol_org_transactions')->where('vol_log_id', $logId)->first();
        $this->assertNotNull($orgTransaction);
        $this->assertSame('volunteer_payment', $orgTransaction->type);
        $this->assertEquals(-2.00, (float) $orgTransaction->amount);
        $this->assertEquals(18.00, (float) $orgTransaction->balance_after);

        $walletTransaction = DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $owner->id)
            ->where('receiver_id', $volunteer->id)
            ->where('transaction_type', 'volunteer')
            ->first();
        $this->assertNotNull($walletTransaction);
        $this->assertSame(2, (int) $walletTransaction->amount);
    }

    public function test_auto_approved_hours_with_insufficient_org_balance_still_credit_volunteer_and_go_negative(): void
    {
        // Credit conservation: approved hours are ALWAYS minted to the volunteer,
        // even when the org wallet is short — the org wallet is a reconciliation
        // figure, not a spending limit, and is allowed to go negative. This mirrors
        // verifyHours(). Previously the auto-pay path silently skipped payment on
        // insufficient balance, permanently stranding the volunteer's hours unpaid.
        $owner = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 1]);
        $orgId = $this->createVolunteerOrganisation($owner->id, 1.00, true);
        $this->addVolunteerToOrganisation($volunteer->id, $orgId);
        $this->setCaringWorkflowApprovalRequired(false);

        // User::factory()->forTenant() drifts TenantContext to tenant 1; re-pin it
        // so the direct (non-HTTP) service call scopes to the test tenant.
        TenantContext::setById($this->testTenantId);

        $logId = VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgId,
            'date' => now()->subDays(2)->toDateString(),
            'hours' => 3.00,
            'description' => 'Escorted appointment support.',
        ]);

        $this->assertNotNull($logId);
        $this->assertSame('approved', DB::table('vol_logs')->where('id', $logId)->value('status'));
        // floor(3.00) = 3 minted to the volunteer; org wallet 1.00 - 3 = -2.00.
        $this->assertEquals(-2.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(4, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));

        $orgTransaction = DB::table('vol_org_transactions')->where('vol_log_id', $logId)->first();
        $this->assertNotNull($orgTransaction);
        $this->assertSame('volunteer_payment', $orgTransaction->type);
        $this->assertEquals(-3.00, (float) $orgTransaction->amount);
        $this->assertEquals(-2.00, (float) $orgTransaction->balance_after);

        $this->assertSame(1, DB::table('transactions')
            ->where('receiver_id', $volunteer->id)
            ->where('transaction_type', 'volunteer')
            ->count());
    }

    public function test_auto_approved_hours_mint_credits_even_when_auto_pay_disabled(): void
    {
        // Approval ALWAYS mints — never gated by the org's auto_pay flag. The
        // schema default is auto_pay_enabled=0, so before this guarantee the
        // common case (auto-approve tenant + default org config) committed the
        // log as 'approved' but never paid the volunteer, and verifyHours()
        // only reprocesses 'pending' logs, so the credits were lost forever.
        $owner = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $orgId = $this->createVolunteerOrganisation($owner->id, 0.00, false); // auto-pay OFF (schema default)
        $this->addVolunteerToOrganisation($volunteer->id, $orgId);
        $this->setCaringWorkflowApprovalRequired(false);

        // User::factory()->forTenant() drifts TenantContext to tenant 1; re-pin it
        // so the direct (non-HTTP) service call scopes to the test tenant.
        TenantContext::setById($this->testTenantId);

        $logId = VolunteerService::logHours($volunteer->id, [
            'organization_id' => $orgId,
            'date' => now()->subDay()->toDateString(),
            'hours' => 2.50,
            'description' => 'Community garden session.',
        ]);

        $this->assertNotNull($logId);
        $this->assertSame('approved', VolunteerService::getLastLogStatus());
        $this->assertSame('approved', DB::table('vol_logs')->where('id', $logId)->value('status'));

        // floor(2.50) = 2 minted to the volunteer; org wallet 0.00 - 2 = -2.00.
        $this->assertEquals(2, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));
        $this->assertEquals(-2.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));

        $orgTransaction = DB::table('vol_org_transactions')->where('vol_log_id', $logId)->first();
        $this->assertNotNull($orgTransaction);
        $this->assertSame('volunteer_payment', $orgTransaction->type);
        $this->assertEquals(-2.00, (float) $orgTransaction->amount);
        $this->assertEquals(-2.00, (float) $orgTransaction->balance_after);

        $walletTransaction = DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $owner->id)
            ->where('receiver_id', $volunteer->id)
            ->where('transaction_type', 'volunteer')
            ->first();
        $this->assertNotNull($walletTransaction);
        $this->assertSame(2, (int) $walletTransaction->amount);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/hours/summary
    // ------------------------------------------------------------------

    public function test_hours_summary_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/hours/summary');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/organisations
    // ------------------------------------------------------------------

    public function test_organisations_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/organisations');

        $response->assertStatus(200);
    }

    public function test_organisations_public_contract_is_opt_in(): void
    {
        $this->authenticatedUser();

        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Organisation',
            'last_name' => 'Owner',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $orgId = $this->createPublicOrganisation($owner);

        $defaultResponse = $this->apiGet('/v2/volunteering/organisations?per_page=1');
        $defaultResponse->assertOk();
        $this->assertArrayNotHasKey('public_contract', $defaultResponse->json('data.0'));
        $this->assertArrayNotHasKey('balance', $defaultResponse->json('data.0'));
        $this->assertArrayNotHasKey('auto_pay_enabled', $defaultResponse->json('data.0'));

        $contractResponse = $this->apiGet('/v2/volunteering/organisations?per_page=1', [
            'X-Public-Contract' => '1',
        ]);
        $contractResponse->assertOk();
        $contractResponse->assertJsonStructure([
            'data' => [
                '*' => [
                    'id',
                    'name',
                    'public_contract' => [
                        'id',
                        'slug',
                        'name',
                        'description',
                        'excerpt',
                        'logo_image' => ['url', 'alt_text'],
                        'website',
                        'contact_email',
                        'location' => ['label'],
                        'owner' => ['display_name', 'avatar_url'],
                        'stats' => ['opportunity_count', 'volunteer_count', 'total_hours', 'review_count', 'average_rating'],
                        'org_type',
                        'created_at',
                        'updated_at',
                        'status',
                    ],
                ],
            ],
        ]);

        $contract = $contractResponse->json('data.0.public_contract');
        $this->assertSame($orgId, $contract['id']);
        $this->assertSame('Neighbourhood Care Collective', $contract['name']);
        $this->assertSame('A public organisation profile for local care and volunteering.', $contract['excerpt']);
        $this->assertSame('/uploads/tenants/hour-timebank/organisations/care-collective.png', $contract['logo_image']['url']);
        $this->assertSame('https://example.test/care', $contract['website']);
        $this->assertSame('hello@example.test', $contract['contact_email']);
        $this->assertSame('Organisation Owner', $contract['owner']['display_name']);
        // The owner's internal user id must never be exposed on the PUBLIC contract.
        $this->assertArrayNotHasKey('id', $contract['owner']);
        $this->assertSame('organisation', $contract['org_type']);
        $this->assertSame('active', $contract['status']);
        $this->assertArrayNotHasKey('balance', $contract);
        $this->assertArrayNotHasKey('auto_pay_enabled', $contract);
    }

    public function test_show_organisation_public_contract_is_opt_in(): void
    {
        $this->authenticatedUser();

        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Detail',
            'last_name' => 'Owner',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $orgId = $this->createPublicOrganisation($owner, [
            'name' => 'Community Kitchen',
            'slug' => 'community-kitchen',
            'description' => 'A detailed organisation profile for a community kitchen.',
            'website' => 'https://example.test/kitchen',
        ]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $owner->id,
            'title' => 'Kitchen helper',
            'description' => 'Help prepare community meals.',
            'location' => 'Community kitchen',
            'status' => 'open',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now(),
        ]);
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'organization_id' => $orgId,
            'opportunity_id' => $opportunityId,
            'date_logged' => now()->toDateString(),
            'hours' => 3.5,
            'description' => 'Kitchen shift',
            'status' => 'approved',
            'created_at' => now(),
        ]);
        DB::table('vol_reviews')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'reviewer_id' => $volunteer->id,
                'target_type' => 'organization',
                'target_id' => $orgId,
                'rating' => 5,
                'comment' => 'Excellent.',
                'created_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'reviewer_id' => $owner->id,
                'target_type' => 'organization',
                'target_id' => $orgId,
                'rating' => 4,
                'comment' => 'Well run.',
                'created_at' => now(),
            ],
        ]);

        $defaultResponse = $this->apiGet("/v2/volunteering/organisations/{$orgId}");
        $defaultResponse->assertOk();
        $defaultResponse->assertJsonPath('data.opportunity_count', 1);
        $defaultResponse->assertJsonPath('data.volunteer_count', 1);
        $defaultResponse->assertJsonPath('data.total_hours', 3.5);
        $defaultResponse->assertJsonPath('data.review_count', 2);
        $defaultResponse->assertJsonPath('data.average_rating', 4.5);
        $this->assertArrayNotHasKey('public_contract', $defaultResponse->json('data'));
        $this->assertArrayNotHasKey('balance', $defaultResponse->json('data'));
        $this->assertArrayNotHasKey('auto_pay_enabled', $defaultResponse->json('data'));

        $contractResponse = $this->apiGet("/v2/volunteering/organisations/{$orgId}", [
            'X-Public-Contract' => '1',
        ]);
        $contractResponse->assertOk();

        $contract = $contractResponse->json('data.public_contract');
        $this->assertSame($orgId, $contract['id']);
        $this->assertSame('community-kitchen', $contract['slug']);
        $this->assertSame('Community Kitchen', $contract['name']);
        $this->assertSame('A detailed organisation profile for a community kitchen.', $contract['description']);
        $this->assertSame('https://example.test/kitchen', $contract['website']);
        $this->assertSame('Detail Owner', $contract['owner']['display_name']);
        $this->assertSame(1, $contract['stats']['opportunity_count']);
        $this->assertSame(1, $contract['stats']['volunteer_count']);
        $this->assertSame(3.5, $contract['stats']['total_hours']);
        $this->assertSame(2, $contract['stats']['review_count']);
        $this->assertSame(4.5, $contract['stats']['average_rating']);
        $this->assertArrayNotHasKey('balance', $contract);
        $this->assertArrayNotHasKey('auto_pay_enabled', $contract);
    }

    public function test_show_organisation_hides_pending_and_suspended_profiles(): void
    {
        $this->authenticatedUser();

        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $pendingOrgId = $this->createPublicOrganisation($owner, [
            'name' => 'Pending Kitchen',
            'status' => 'pending',
        ]);
        $suspendedOrgId = $this->createPublicOrganisation($owner, [
            'name' => 'Suspended Kitchen',
            'status' => 'suspended',
        ]);

        $this->apiGet("/v2/volunteering/organisations/{$pendingOrgId}")->assertStatus(404);
        $this->apiGet("/v2/volunteering/organisations/{$suspendedOrgId}")->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/certificates
    // ------------------------------------------------------------------

    public function test_certificates_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/certificates');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/credentials
    // ------------------------------------------------------------------

    public function test_credentials_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/credentials');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/expenses
    // ------------------------------------------------------------------

    public function test_my_expenses_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/expenses');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/training
    // ------------------------------------------------------------------

    public function test_my_training_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/training');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/incidents
    // ------------------------------------------------------------------

    public function test_incidents_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/incidents');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/community-projects
    // ------------------------------------------------------------------

    public function test_community_projects_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/community-projects');

        $response->assertStatus(401);
    }

    public function test_community_projects_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/community-projects');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/wellbeing
    // ------------------------------------------------------------------

    public function test_wellbeing_dashboard_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/wellbeing');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/giving-days
    // ------------------------------------------------------------------

    public function test_giving_days_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/giving-days');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/volunteering/donations
    // ------------------------------------------------------------------

    public function test_donations_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/donations');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  Tenant isolation
    // ------------------------------------------------------------------

    public function test_opportunities_are_tenant_scoped(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/opportunities');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertIsArray($data);
    }

    // ------------------------------------------------------------------
    //  Form Request validation — apply / handleApplication / verifyHours
    // ------------------------------------------------------------------

    public function test_apply_accepts_missing_body_when_authenticated(): void
    {
        // ApplyOpportunityRequest has no required fields (message + shift_id are nullable).
        // With auth + valid form request, the controller should not return 422.
        // It may 404 (no such opportunity) or 400/409 (business rule) — just not 422.
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/volunteering/opportunities/999999/apply');

        $this->assertNotEquals(422, $response->getStatusCode());
    }

    public function test_apply_rejects_oversized_message(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/volunteering/opportunities/1/apply', [
            'message' => str_repeat('a', 3000), // max:2000
        ]);

        $response->assertStatus(422);
    }

    public function test_handle_application_rejects_invalid_action(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/volunteering/applications/1', [
            'action' => 'maybe',
        ]);

        $response->assertStatus(422);
    }

    public function test_handle_application_rejects_missing_action(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/volunteering/applications/1', []);

        $response->assertStatus(422);
    }

    public function test_verify_hours_rejects_invalid_action(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/volunteering/hours/1/verify', [
            'action' => 'pending',
        ]);

        $response->assertStatus(422);
    }

    public function test_verify_hours_rejects_missing_action(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/volunteering/hours/1/verify', []);

        $response->assertStatus(422);
    }

    // ------------------------------------------------------------------
    //  POST /v2/volunteering/organisations/{id}/wallet/deposit
    //  (money-moving endpoint — authorization + conservation)
    // ------------------------------------------------------------------

    public function test_org_wallet_deposit_moves_credits_from_owner_to_org(): void
    {
        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10,
        ]);
        Sanctum::actingAs($owner, ['*']);
        $orgId = $this->createVolunteerOrganisation($owner->id, 5.00, false);

        $response = $this->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", ['amount' => 4]);

        $response->assertStatus(200);
        // Conservation: the owner loses exactly what the org gains (whole credits).
        $this->assertEquals(9.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(6, (int) DB::table('users')->where('id', $owner->id)->value('balance'));
        $this->assertSame(1, DB::table('vol_org_transactions')
            ->where('vol_organization_id', $orgId)->where('type', 'deposit')->count());
    }

    /**
     * The endpoint must honour a client Idempotency-Key so a double-click or a
     * network retry moves the credits once. Accepted from the header AND the
     * body, matching the personal wallet transfer's contract — web-uk posts it
     * as a form field because a hidden input is all a no-JavaScript page has.
     */
    public function test_org_wallet_deposit_honours_an_idempotency_key_from_header_or_body(): void
    {
        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 20,
        ]);
        Sanctum::actingAs($owner, ['*']);
        $orgId = $this->createVolunteerOrganisation($owner->id, 0.00, false);

        $bodyKey = 'body-' . bin2hex(random_bytes(8));
        $this->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", [
            'amount' => 4,
            'idempotency_key' => $bodyKey,
        ])->assertStatus(200);
        $this->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", [
            'amount' => 4,
            'idempotency_key' => $bodyKey,
        ])->assertStatus(200);

        // One movement, one audit row — not two.
        $this->assertEquals(4.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(16, (int) DB::table('users')->where('id', $owner->id)->value('balance'));
        $this->assertSame(1, DB::table('vol_org_transactions')
            ->where('vol_organization_id', $orgId)->where('type', 'deposit')->count());

        // The header form of the same contract, with a distinct amount so the
        // content fingerprint cannot be what dedups it.
        $headerKey = 'header-' . bin2hex(random_bytes(8));
        $this->withHeaders(['Idempotency-Key' => $headerKey])
            ->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", ['amount' => 5])
            ->assertStatus(200);
        $this->withHeaders(['Idempotency-Key' => $headerKey])
            ->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", ['amount' => 5])
            ->assertStatus(200);

        $this->assertEquals(9.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(11, (int) DB::table('users')->where('id', $owner->id)->value('balance'));
        $this->assertSame(2, DB::table('vol_org_transactions')
            ->where('vol_organization_id', $orgId)->where('type', 'deposit')->count());
    }

    public function test_org_wallet_deposit_forbidden_for_non_manager(): void
    {
        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0,
        ]);
        $orgId = $this->createVolunteerOrganisation($owner->id, 5.00, false);

        // A different authenticated user who is neither owner, org admin, nor site admin.
        $outsider = $this->authenticatedUser();
        DB::table('users')->where('id', $outsider->id)->update(['balance' => 10]);

        $response = $this->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", ['amount' => 4]);

        $response->assertStatus(403);
        // No credits moved for a forbidden request.
        $this->assertEquals(5.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(10, (int) DB::table('users')->where('id', $outsider->id)->value('balance'));
    }

    public function test_org_wallet_deposit_requires_auth(): void
    {
        $response = $this->apiPost('/v2/volunteering/organisations/1/wallet/deposit', ['amount' => 4]);

        $response->assertStatus(401);
    }

    public function test_org_wallet_deposit_rejects_non_positive_amount(): void
    {
        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10,
        ]);
        Sanctum::actingAs($owner, ['*']);
        $orgId = $this->createVolunteerOrganisation($owner->id, 5.00, false);

        $response = $this->apiPost("/v2/volunteering/organisations/{$orgId}/wallet/deposit", ['amount' => 0]);

        $response->assertStatus(400);
        $this->assertEquals(5.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
    }

    // ------------------------------------------------------------------
    //  PUT /v2/volunteering/organisations/{id} — UpdateOrganisationRequest
    // ------------------------------------------------------------------

    public function test_update_organisation_rejects_javascript_website(): void
    {
        $owner = $this->authenticatedUser();
        $this->enableVolunteeringFeature();
        $orgId = $this->createPublicOrganisation($owner);

        // A javascript: scheme is rendered as an <a href> on the PUBLIC org page
        // for unauthenticated visitors — url:http,https must reject it (422) and
        // leave the stored website untouched.
        $response = $this->apiPut("/v2/volunteering/organisations/{$orgId}", [
            'website' => 'javascript:alert(document.cookie)',
        ]);

        $response->assertStatus(422);
        $this->assertSame(
            'https://example.test/care',
            DB::table('vol_organizations')->where('id', $orgId)->value('website')
        );
    }

    public function test_update_organisation_rejects_blank_and_overlong_name(): void
    {
        $owner = $this->authenticatedUser();
        $this->enableVolunteeringFeature();
        $orgId = $this->createPublicOrganisation($owner);

        // Blank name fails required; a 201-char name fails max:200. Neither
        // partial-update attempt may mutate the stored name.
        $this->apiPut("/v2/volunteering/organisations/{$orgId}", ['name' => ''])->assertStatus(422);
        $this->apiPut("/v2/volunteering/organisations/{$orgId}", ['name' => str_repeat('a', 201)])->assertStatus(422);

        $this->assertSame(
            'Neighbourhood Care Collective',
            DB::table('vol_organizations')->where('id', $orgId)->value('name')
        );
    }

    public function test_second_application_decision_is_noop_and_fires_no_new_notification(): void
    {
        $owner = $this->authenticatedUser();
        $this->enableVolunteeringFeature();
        $orgId = $this->createVolunteerOrganisation($owner->id, 0.00, false);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $owner->id,
            'title' => 'Decision Guard Opportunity',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        $applicant = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $appId = (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $applicant->id,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // First decision is a real pending -> approved transition.
        $first = $this->apiPut("/v2/volunteering/applications/{$appId}", ['action' => 'approve']);
        $first->assertStatus(200);
        $this->assertSame('approved', DB::table('vol_applications')->where('id', $appId)->value('status'));

        $notificationsAfterFirst = DB::table('notifications')->count();

        // Second decision on the already-decided application must be a no-op:
        // 409 conflict, status unchanged, and NO additional decision notification.
        $second = $this->apiPut("/v2/volunteering/applications/{$appId}", ['action' => 'decline']);
        $second->assertStatus(409);
        $this->assertSame('approved', DB::table('vol_applications')->where('id', $appId)->value('status'));
        $this->assertSame($notificationsAfterFirst, DB::table('notifications')->count());
    }
}
