<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Models\VolExpense;
use App\Models\VolOrganization;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Organisation admins review the expense claims made to their own organisation
 * (owner decision, 2 October 2026): they approve or reject from the organisation
 * dashboard and they alone mark a claim paid. Community admins keep oversight on
 * the admin screen and can still approve or reject there, but no longer mark paid.
 *
 * Most of these tests are refusals: an organisation admin must never see or act on
 * another organisation's claims, another community's claims, or their own claim.
 */
class VolunteerOrgExpenseControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    private function org(?User $owner = null): VolOrganization
    {
        $owner ??= User::factory()->forTenant($this->testTenantId)->create();

        return VolOrganization::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'approved',
        ]);
    }

    private function member(int $orgId, int $userId, string $role, string $status = 'active'): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'role' => $role,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function claim(int $orgId, string $status = 'pending', ?int $userId = null, int $tenantId = 0): VolExpense
    {
        $tenantId = $tenantId ?: $this->testTenantId;
        $userId ??= User::factory()->forTenant($tenantId)->create()->id;

        return VolExpense::factory()->forTenant($tenantId)->create([
            'user_id' => $userId,
            'organization_id' => $orgId,
            'opportunity_id' => null,
            'status' => $status,
            'amount' => 12.5,
            'submitted_at' => now(),
        ]);
    }

    private function statusOf(VolExpense $expense): ?string
    {
        return DB::table('vol_expenses')->where('id', $expense->id)->value('status');
    }

    // ---------------------------------------------------------------- listing

    public function test_owner_lists_only_their_own_organisations_claims(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $mine = $this->org($owner);
        $theirs = $this->org();
        $own = $this->claim($mine->id);
        $this->claim($theirs->id);

        Sanctum::actingAs($owner);
        $response = $this->apiGet("/v2/volunteering/organisations/{$mine->id}/expenses");

        $response->assertStatus(200);
        $ids = array_column($response->json('data.items'), 'id');
        $this->assertSame([$own->id], $ids);
        $this->assertArrayHasKey('stats', $response->json('data'));
    }

    public function test_listing_does_not_expose_volunteer_email_or_receipt_path(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $org = $this->org($owner);
        $this->claim($org->id);

        Sanctum::actingAs($owner);
        $item = $this->apiGet("/v2/volunteering/organisations/{$org->id}/expenses")->json('data.items.0');

        $this->assertArrayNotHasKey('email', $item);
        $this->assertArrayNotHasKey('receipt_path', $item);
        $this->assertArrayNotHasKey('user', $item);
        $this->assertArrayHasKey('volunteer_name', $item);
    }

    public function test_plain_member_of_the_organisation_cannot_list_claims(): void
    {
        $org = $this->org();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $volunteer->id, 'member');
        $this->claim($org->id);

        Sanctum::actingAs($volunteer);
        $this->apiGet("/v2/volunteering/organisations/{$org->id}/expenses")->assertStatus(403);
    }

    public function test_admin_of_one_organisation_cannot_list_another_organisations_claims(): void
    {
        $orgA = $this->org();
        $orgB = $this->org();
        $adminA = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($orgA->id, $adminA->id, 'admin');
        $this->claim($orgB->id);

        Sanctum::actingAs($adminA);
        $this->apiGet("/v2/volunteering/organisations/{$orgB->id}/expenses")->assertStatus(403);
    }

    // ------------------------------------------------------------- reviewing

    public function test_organisation_admin_can_approve_then_mark_paid(): void
    {
        $org = $this->org();
        $orgAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $orgAdmin->id, 'admin');
        $expense = $this->claim($org->id);

        Sanctum::actingAs($orgAdmin);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", ['status' => 'approved'])
            ->assertStatus(200);
        $this->assertSame('approved', $this->statusOf($expense));
        $this->assertSame($orgAdmin->id, (int) DB::table('vol_expenses')->where('id', $expense->id)->value('reviewed_by'));

        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", [
            'status' => 'paid',
            'payment_reference' => 'BANK-7',
        ])->assertStatus(200);
        $this->assertSame('paid', $this->statusOf($expense));
    }

    public function test_owner_can_reject_with_notes(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $org = $this->org($owner);
        $expense = $this->claim($org->id);

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", [
            'status' => 'rejected',
            'review_notes' => 'No receipt',
        ])->assertStatus(200);

        $this->assertSame('rejected', $this->statusOf($expense));
        $this->assertSame('No receipt', DB::table('vol_expenses')->where('id', $expense->id)->value('review_notes'));
    }

    public function test_cannot_act_on_another_organisations_claim_through_own_organisation(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $mine = $this->org($owner);
        $theirs = $this->org();
        $expense = $this->claim($theirs->id);

        Sanctum::actingAs($owner);
        // The claim id is real, but it is not this organisation's claim.
        $this->apiPut("/v2/volunteering/organisations/{$mine->id}/expenses/{$expense->id}", ['status' => 'approved'])
            ->assertStatus(404);
        $this->assertSame('pending', $this->statusOf($expense));
    }

    public function test_cannot_act_on_another_communitys_claim(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $org = $this->org($owner);

        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Other Community',
            'slug' => 'other-community-' . substr(uniqid(), -8),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        // A claim in another community that happens to carry this organisation's id.
        $foreign = $this->claim($org->id, 'pending', null, $otherTenantId);
        TenantContext::setById($this->testTenantId);

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$foreign->id}", ['status' => 'approved'])
            ->assertStatus(404);
        $this->assertSame('pending', $this->statusOf($foreign));

        $ids = array_column($this->apiGet("/v2/volunteering/organisations/{$org->id}/expenses")->json('data.items'), 'id');
        $this->assertNotContains($foreign->id, $ids);
    }

    public function test_organisation_admin_cannot_review_or_pay_their_own_claim(): void
    {
        $org = $this->org();
        $orgAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $orgAdmin->id, 'admin');
        $pending = $this->claim($org->id, 'pending', $orgAdmin->id);
        $approved = $this->claim($org->id, 'approved', $orgAdmin->id);

        Sanctum::actingAs($orgAdmin);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$pending->id}", ['status' => 'approved'])
            ->assertStatus(403);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$approved->id}", ['status' => 'paid'])
            ->assertStatus(403);

        $this->assertSame('pending', $this->statusOf($pending));
        $this->assertSame('approved', $this->statusOf($approved));
    }

    public function test_wrong_state_is_409_and_leaves_claim_alone(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $org = $this->org($owner);
        $pending = $this->claim($org->id, 'pending');
        $paid = $this->claim($org->id, 'paid');

        Sanctum::actingAs($owner);
        $notApproved = $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$pending->id}", ['status' => 'paid']);
        $notApproved->assertStatus(409);
        $this->assertSame('INVALID_STATE', $notApproved->json('errors.0.code'));

        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$paid->id}", ['status' => 'rejected'])
            ->assertStatus(409);

        $this->assertSame('pending', $this->statusOf($pending));
        $this->assertSame('paid', $this->statusOf($paid));
    }

    public function test_invalid_status_is_422(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $org = $this->org($owner);
        $expense = $this->claim($org->id);

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", ['status' => 'pending'])
            ->assertStatus(422);
    }

    public function test_inactive_or_plain_members_cannot_review(): void
    {
        $org = $this->org();
        $formerAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $formerAdmin->id, 'admin', 'inactive');
        $expense = $this->claim($org->id);

        Sanctum::actingAs($formerAdmin);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", ['status' => 'approved'])
            ->assertStatus(403);
        $this->assertSame('pending', $this->statusOf($expense));
    }

    // ------------------------------------------------- community admin limits

    public function test_community_admin_cannot_review_through_the_organisation_route(): void
    {
        $org = $this->org();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $expense = $this->claim($org->id, 'approved');

        Sanctum::actingAs($admin);
        // Not an organisation admin, so the organisation route refuses — this is
        // what stops a community admin marking paid by the back door.
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", ['status' => 'paid'])
            ->assertStatus(403);
        $this->assertSame('approved', $this->statusOf($expense));
    }

    public function test_community_admin_can_no_longer_mark_paid_on_the_admin_screen(): void
    {
        $org = $this->org();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $expense = $this->claim($org->id, 'approved');

        Sanctum::actingAs($admin);
        $response = $this->apiPut("/v2/admin/volunteering/expenses/{$expense->id}", ['status' => 'paid']);

        $response->assertStatus(403);
        $this->assertSame(__('api.vol_expense_paid_by_organisation'), $response->json('errors.0.message'));
        $this->assertSame('approved', $this->statusOf($expense));
    }

    public function test_community_admin_can_still_approve_on_the_admin_screen(): void
    {
        $org = $this->org();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $expense = $this->claim($org->id, 'pending');

        Sanctum::actingAs($admin);
        $this->apiPut("/v2/admin/volunteering/expenses/{$expense->id}", ['status' => 'approved'])->assertStatus(200);
        $this->assertSame('approved', $this->statusOf($expense));
    }

    // --------------------------------------------------------------- receipts

    public function test_organisation_admin_can_download_own_claims_receipt_but_not_anothers(): void
    {
        Storage::fake('local');
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $mine = $this->org($owner);
        $theirs = $this->org();

        $path = "volunteer-expenses/{$this->testTenantId}/org-r1.pdf";
        Storage::disk('local')->put($path, 'PDFDATA');
        $own = $this->claim($mine->id);
        $other = $this->claim($theirs->id);
        DB::table('vol_expenses')->whereIn('id', [$own->id, $other->id])
            ->update(['receipt_path' => $path, 'receipt_filename' => 'receipt.pdf']);

        Sanctum::actingAs($owner);
        $this->apiGet("/v2/volunteering/organisations/{$mine->id}/expenses/{$own->id}/receipt")->assertStatus(200);
        $this->apiGet("/v2/volunteering/organisations/{$mine->id}/expenses/{$other->id}/receipt")->assertStatus(404);
        $this->apiGet("/v2/volunteering/organisations/{$theirs->id}/expenses/{$other->id}/receipt")->assertStatus(403);
    }

    // ---------------------------------------------------------- notifications

    public function test_new_claim_notifies_organisation_admins_but_not_the_claimant_or_plain_members(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $org = $this->org($owner);
        $orgAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $orgAdmin->id, 'admin');
        $plain = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $plain->id, 'member');
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($org->id, $volunteer->id, 'member');

        Sanctum::actingAs($volunteer);
        $this->apiPost('/v2/volunteering/expenses', [
            'organization_id' => $org->id,
            'expense_type' => 'travel',
            'amount' => 8,
            'description' => 'Bus fare',
        ])->assertStatus(201);

        $notified = DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('type', 'vol_expense_submitted')
            ->pluck('user_id')->map(fn ($id) => (int) $id)->all();

        sort($notified);
        $expected = [(int) $owner->id, (int) $orgAdmin->id];
        sort($expected);
        $this->assertSame($expected, $notified);
    }
}
