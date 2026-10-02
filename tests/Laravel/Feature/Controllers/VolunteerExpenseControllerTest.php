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
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for VolunteerExpenseController.
 *
 * Covers:
 *  - GET /v2/volunteering/expenses — my expenses (auth, feature gate)
 *  - GET /v2/admin/volunteering/expenses — admin-only listing
 *  - Feature flag disabled -> 403
 *  - reviewExpense validation of status enum
 */
class VolunteerExpenseControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteeringFeature(int $tenantId): void
    {
        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['volunteering'] = true;

        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode($features),
        ]);

        TenantContext::setById($tenantId);
    }

    public function test_my_expenses_requires_auth(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $response = $this->apiGet('/v2/volunteering/expenses');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_my_expenses_returns_data_for_authenticated_user(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $user = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($user);

        $response = $this->apiGet('/v2/volunteering/expenses');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    /**
     * fix(volunteering): myExpenses previously reduced its summary cards over the
     * current page only (max 50 rows), under-counting once a volunteer had more
     * than one page of expenses. The stats block must aggregate over the full
     * user-scoped set via getExpenseStats.
     */
    public function test_my_expenses_stats_aggregate_over_full_set_not_just_page(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $user = User::factory()->forTenant($this->testTenantId)->create();
        $org = VolOrganization::factory()->forTenant($this->testTenantId)->create();

        foreach ([['pending', 30], ['paid', 20], ['approved', 15]] as [$status, $amount]) {
            VolExpense::factory()->forTenant($this->testTenantId)->create([
                'user_id' => $user->id,
                'organization_id' => $org->id,
                'opportunity_id' => null,
                'status' => $status,
                'amount' => $amount,
                'submitted_at' => now(),
            ]);
        }

        Sanctum::actingAs($user);

        // per_page=1 → a page-scoped reduce would only see a single row.
        $response = $this->apiGet('/v2/volunteering/expenses?per_page=1');

        $response->assertStatus(200);
        $this->assertCount(1, $response->json('data.items'));

        $stats = $response->json('data.stats');
        $this->assertEqualsWithDelta(65.0, (float) $stats['total_submitted'], 0.001);
        $this->assertEqualsWithDelta(30.0, (float) $stats['pending_review'], 0.001);
        $this->assertEqualsWithDelta(35.0, (float) $stats['approved_total'], 0.001);
        $this->assertEqualsWithDelta(20.0, (float) $stats['paid_total'], 0.001);
    }

    public function test_my_expenses_returns_403_when_feature_disabled(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => false]),
        ]);
        TenantContext::setById($this->testTenantId);

        $user = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($user);

        $response = $this->apiGet('/v2/volunteering/expenses');

        $response->assertStatus(403);
    }

    public function test_admin_expenses_rejects_regular_member(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/volunteering/expenses');

        $response->assertStatus(403);
    }

    /**
     * 2026-06-17 audit: the admin expenses endpoint returned only the paged
     * list, so the React admin summary cards (Total Submitted / Pending /
     * Approved / Paid) were permanently zero. The payload must carry a stats
     * block aggregated over the full tenant-scoped set.
     */
    public function test_admin_expenses_includes_full_set_stats_summary(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $organization = VolOrganization::factory()->forTenant($this->testTenantId)->create();

        VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $organization->id,
            'opportunity_id' => null,
            'status' => 'pending',
            'amount' => 30,
            'submitted_at' => now(),
        ]);
        VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $organization->id,
            'opportunity_id' => null,
            'status' => 'paid',
            'amount' => 20,
            'submitted_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/volunteering/expenses');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'items',
                'stats' => ['total_submitted', 'pending_review', 'approved_total', 'paid_total'],
            ],
        ]);
        $stats = $response->json('data.stats');
        $this->assertEqualsWithDelta(50.0, (float) $stats['total_submitted'], 0.001);
        $this->assertEqualsWithDelta(30.0, (float) $stats['pending_review'], 0.001);
        $this->assertEqualsWithDelta(20.0, (float) $stats['paid_total'], 0.001);
        $this->assertEqualsWithDelta(20.0, (float) $stats['approved_total'], 0.001);
    }

    public function test_review_expense_validates_status(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/volunteering/expenses/1', [
            'status' => 'not_a_valid_status',
        ]);

        $response->assertStatus(422);
    }

    /**
     * Re-approving an already-approved expense used to answer 404 "not found",
     * though the expense plainly exists — the admin UI could only say "Failed to
     * update expense". A real expense in the wrong state is a 409, and it must
     * be left untouched.
     */
    public function test_review_expense_in_wrong_state_is_409_not_404(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $org = VolOrganization::factory()->forTenant($this->testTenantId)->create();
        $expense = VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $org->id,
            'opportunity_id' => null,
            'status' => 'approved',
            'amount' => 12.5,
            'submitted_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPut("/v2/admin/volunteering/expenses/{$expense->id}", [
            'status' => 'approved',
        ]);

        $response->assertStatus(409);
        $this->assertSame('approved', VolExpense::query()->whereKey($expense->id)->value('status'));
    }

    public function test_review_expense_that_does_not_exist_is_404(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/volunteering/expenses/999999999', [
            'status' => 'approved',
        ]);

        $response->assertStatus(404);
    }

    public function test_approved_expense_can_be_marked_paid(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $org = VolOrganization::factory()->forTenant($this->testTenantId)->create();
        $expense = VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $org->id,
            'opportunity_id' => null,
            'status' => 'approved',
            'amount' => 12.5,
            'submitted_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPut("/v2/admin/volunteering/expenses/{$expense->id}", [
            'status' => 'paid',
            'payment_reference' => 'BANK-1',
        ]);

        $response->assertStatus(200);
        $this->assertSame('paid', VolExpense::query()->whereKey($expense->id)->value('status'));
    }

    public function test_admin_expense_export_neutralizes_spreadsheet_formula_cells(): void
    {
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => '=IMPORTXML("https://example.test")',
            'last_name' => 'Member',
            'email' => 'volunteer@example.test',
        ]);
        $organization = VolOrganization::factory()->forTenant($this->testTenantId)->create([
            'name' => '+SUM(1,1)',
        ]);

        VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $organization->id,
            'opportunity_id' => null,
            'status' => 'pending',
            'description' => '@cmd',
            'review_notes' => "\t=hidden",
            'payment_reference' => '-10+20',
            'submitted_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/volunteering/expenses/export');

        $response->assertStatus(200);
        $csv = $response->getContent();
        $lines = array_values(array_filter(explode("\n", trim((string) $csv))));
        $rows = array_map('str_getcsv', $lines);
        $headers = array_shift($rows);
        $exported = null;
        foreach ($rows as $row) {
            $indexed = array_combine($headers, $row);
            if (($indexed['email'] ?? '') === 'volunteer@example.test') {
                $exported = $indexed;
                break;
            }
        }

        $this->assertNotNull($exported);
        $this->assertSame('\'=IMPORTXML("https://example.test")', $exported['first_name']);
        $this->assertSame('\'+SUM(1,1)', $exported['organization_name']);
        $this->assertSame('\'@cmd', $exported['description']);
        $this->assertSame("'\t=hidden", $exported['review_notes']);
        $this->assertSame('\'-10+20', $exported['payment_reference']);
    }

    // ------------------------------------------------------------------
    //  GET /v2/admin/volunteering/expenses/{id}/receipt — download
    // ------------------------------------------------------------------

    private function makeExpenseWithReceipt(int $tenantId, string $relPath): int
    {
        \Illuminate\Support\Facades\Storage::disk('local')->put($relPath, 'PDFDATA');
        $admin = User::factory()->forTenant($tenantId)->create();
        $org = VolOrganization::factory()->forTenant($tenantId)->create();

        return (int) VolExpense::factory()->forTenant($tenantId)->create([
            'user_id' => $admin->id,
            'organization_id' => $org->id,
            'opportunity_id' => null,
            'status' => 'pending',
            'amount' => 12,
            'receipt_path' => $relPath,
            'receipt_filename' => 'receipt.pdf',
            'submitted_at' => now(),
        ])->id;
    }

    public function test_admin_can_download_expense_receipt(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $this->enableVolunteeringFeature($this->testTenantId);
        $expenseId = $this->makeExpenseWithReceipt($this->testTenantId, "volunteer-expenses/{$this->testTenantId}/r1.pdf");

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/volunteering/expenses/{$expenseId}/receipt");

        $response->assertStatus(200);
    }

    public function test_expense_receipt_download_forbidden_for_regular_member(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $this->enableVolunteeringFeature($this->testTenantId);
        $expenseId = $this->makeExpenseWithReceipt($this->testTenantId, "volunteer-expenses/{$this->testTenantId}/r2.pdf");

        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet("/v2/admin/volunteering/expenses/{$expenseId}/receipt");

        $response->assertStatus(403);
    }

    public function test_expense_receipt_download_404_when_no_receipt(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $this->enableVolunteeringFeature($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $org = VolOrganization::factory()->forTenant($this->testTenantId)->create();
        $expenseId = (int) VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $org->id,
            'opportunity_id' => null,
            'status' => 'pending',
            'amount' => 10,
            'receipt_path' => null,
            'submitted_at' => now(),
        ])->id;

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/volunteering/expenses/{$expenseId}/receipt");

        $response->assertStatus(404);
    }
}
