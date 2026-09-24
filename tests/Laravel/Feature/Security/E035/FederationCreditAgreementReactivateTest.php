<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-173 — a federation credit agreement suspended by one community must not be
 * reactivated by the other. Only the community that suspended it may bring it
 * back to active (mirroring the partnership reactivation rule).
 */
class FederationCreditAgreementReactivateTest extends TestCase
{
    use DatabaseTransactions;

    private function seedTenant(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'E035 Credit Partner ' . substr(uniqid(), -6),
            'slug' => 'e035-credit-' . substr(uniqid(), -6),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function headersFor(int $tenantId): array
    {
        return ['X-Tenant-ID' => (string) $tenantId, 'Accept' => 'application/json'];
    }

    private function actAsAdminOf(int $tenantId): User
    {
        $admin = User::factory()->forTenant($tenantId)->admin()->create();
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    public function test_other_side_cannot_reactivate_agreement_the_partner_suspended(): void
    {
        $partner = $this->seedTenant();

        $agreementId = (int) DB::table('federation_credit_agreements')->insertGetId([
            'from_tenant_id' => $this->testTenantId,
            'to_tenant_id' => $partner,
            'exchange_rate' => 1.0,
            'status' => 'active',
            'max_monthly_credits' => 100,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Partner community B suspends the agreement (writes the audit record).
        $this->actAsAdminOf($partner);
        $this->postJson('/api/v2/admin/federation/credit-agreements/' . $agreementId . '/suspend', [], $this->headersFor($partner))
            ->assertOk();
        $this->assertSame('suspended', DB::table('federation_credit_agreements')->where('id', $agreementId)->value('status'));

        // The OTHER side (A) must not be able to reactivate it.
        $this->actAsAdminOf($this->testTenantId);
        $reject = $this->postJson('/api/v2/admin/federation/credit-agreements/' . $agreementId . '/reactivate', [], $this->headersFor($this->testTenantId));
        $reject->assertStatus(409);
        $this->assertSame('suspended', DB::table('federation_credit_agreements')->where('id', $agreementId)->value('status'), 'agreement must stay suspended after the non-suspender is refused');

        // The suspender (B) may reactivate it.
        $this->actAsAdminOf($partner);
        $this->postJson('/api/v2/admin/federation/credit-agreements/' . $agreementId . '/reactivate', [], $this->headersFor($partner))
            ->assertOk();
        $this->assertSame('active', DB::table('federation_credit_agreements')->where('id', $agreementId)->value('status'));
    }
}
