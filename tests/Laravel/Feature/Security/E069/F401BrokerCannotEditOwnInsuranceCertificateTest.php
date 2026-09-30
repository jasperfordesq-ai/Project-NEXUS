<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ExchangeWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-401 (E-069) — residual gap in the F-389 fix.
 *
 * F-389 added AdminInsuranceCertificateController::guardBrokerNotSubject() and
 * called it from store() and verify(), but not from the two sibling write paths
 * on the same record: update() (PUT /v2/admin/insurance/{id}) and destroy()
 * (DELETE /v2/admin/insurance/{id}).
 *
 * The compliance gate F-389 protects is
 * ExchangeWorkflowService::checkComplianceRequirements():
 * `status = 'verified' AND (expiry_date IS NULL OR expiry_date > NOW())`.
 * InsuranceCertificateService::update() permits `expiry_date`, so a broker whose
 * own verified certificate had expired pushed the expiry out (or nulled it) and
 * the insurance requirement an administrator attached to the broker's own
 * listing stopped firing — with no re-verification and no new evidence.
 * destroy() additionally let the broker erase an administrator's *rejection*.
 *
 * Now a broker (not the administrator tier) is refused on both paths.
 *
 * Adapted from `.local-docs-archive/security-log/E-069/repro/h/H1BrokerEditsOwnInsuranceCertificateTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F401BrokerCannotEditOwnInsuranceCertificateTest extends TestCase
{
    use DatabaseTransactions;

    public function test_broker_cannot_move_the_expiry_on_their_own_certificate(): void
    {
        $broker = $this->broker();
        $listing = $this->listing((int) $broker->id);
        $this->adminTag($listing, (int) $this->admin()->id);
        $certId = $this->certificate((int) $broker->id, 'verified', now()->subDay()->toDateString());

        $this->assertTrue(
            $this->insuranceViolation($listing, (int) $broker->id),
            'precondition: the expired certificate leaves the insurance violation in place'
        );

        Sanctum::actingAs($broker);
        $this->apiPut("/v2/admin/insurance/{$certId}", [
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertStatus(403);

        $row = DB::table('insurance_certificates')->where('id', $certId)->first();
        $this->assertSame(
            now()->subDay()->toDateString(),
            (string) $row->expiry_date,
            'the certificate still expires when the administrator left it expiring'
        );
        $this->assertTrue(
            $this->insuranceViolation($listing, (int) $broker->id),
            'the insurance gate on the broker\'s own listing stays in force'
        );
    }

    public function test_broker_cannot_null_the_expiry_on_their_own_certificate(): void
    {
        $broker = $this->broker();
        $certId = $this->certificate((int) $broker->id, 'verified', now()->subDay()->toDateString());

        Sanctum::actingAs($broker);
        $this->apiPut("/v2/admin/insurance/{$certId}", ['expiry_date' => null])->assertStatus(403);

        $this->assertNotNull(
            DB::table('insurance_certificates')->where('id', $certId)->value('expiry_date'),
            'the certificate still carries an expiry date'
        );
    }

    public function test_broker_cannot_delete_the_record_of_their_own_rejected_insurance(): void
    {
        $broker = $this->broker();
        $admin = $this->admin();
        $certId = $this->certificate((int) $broker->id, 'rejected', now()->addYear()->toDateString());
        DB::table('insurance_certificates')->where('id', $certId)->update([
            'verified_by' => $admin->id,
            'verified_at' => now(),
            'notes' => 'F401 fixture rejection reason.',
        ]);

        Sanctum::actingAs($broker);
        $this->apiDelete("/v2/admin/insurance/{$certId}")->assertStatus(403);

        $row = DB::table('insurance_certificates')->where('id', $certId)->first();
        $this->assertNotNull($row, 'the administrator\'s rejection survives');
        $this->assertSame('rejected', (string) $row->status);
        $this->assertSame((int) $admin->id, (int) $row->verified_by);
    }

    public function test_control_an_administrator_may_still_update_a_certificate(): void
    {
        $broker = $this->broker();
        $certId = $this->certificate((int) $broker->id, 'verified', now()->subDay()->toDateString());

        Sanctum::actingAs($this->admin());
        $this->apiPut("/v2/admin/insurance/{$certId}", [
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertStatus(200);

        $this->assertSame(
            now()->addYear()->toDateString(),
            (string) DB::table('insurance_certificates')->where('id', $certId)->value('expiry_date')
        );
    }

    public function test_control_an_administrator_may_still_delete_a_certificate(): void
    {
        $broker = $this->broker();
        $certId = $this->certificate((int) $broker->id, 'rejected', now()->addYear()->toDateString());

        Sanctum::actingAs($this->admin());
        $this->apiDelete("/v2/admin/insurance/{$certId}")->assertStatus(200);

        $this->assertSame(0, DB::table('insurance_certificates')->where('id', $certId)->count());
    }

    public function test_control_a_broker_may_still_update_another_members_certificate(): void
    {
        $member = $this->member();
        $certId = $this->certificate((int) $member->id, 'verified', now()->subDay()->toDateString());

        Sanctum::actingAs($this->broker());
        $this->apiPut("/v2/admin/insurance/{$certId}", [
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertStatus(200);

        $this->assertSame(
            now()->addYear()->toDateString(),
            (string) DB::table('insurance_certificates')->where('id', $certId)->value('expiry_date'),
            'ordinary moderation is unaffected — only the subject is refused'
        );
    }

    public function test_control_a_broker_may_still_delete_another_members_certificate(): void
    {
        $member = $this->member();
        $certId = $this->certificate((int) $member->id, 'rejected', now()->addYear()->toDateString());

        Sanctum::actingAs($this->broker());
        $this->apiDelete("/v2/admin/insurance/{$certId}")->assertStatus(200);

        $this->assertSame(0, DB::table('insurance_certificates')->where('id', $certId)->count());
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker', 'status' => 'active', 'is_approved' => 1,
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
    }

    private function certificate(int $userId, string $status, ?string $expiry): int
    {
        return (int) DB::table('insurance_certificates')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'insurance_type' => 'public_liability',
            'provider_name' => 'F401 fixture insurer',
            'start_date' => now()->subYear()->toDateString(),
            'expiry_date' => $expiry,
            'status' => $status,
            'verified_by' => $status === 'verified' ? $userId : null,
            'verified_at' => $status === 'verified' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function listing(int $ownerId): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'title' => 'F401 fixture', 'description' => 'F401 fixture listing',
            'type' => 'offer', 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function adminTag(int $listingId, int $adminId): void
    {
        DB::table('listing_risk_tags')->insert([
            'listing_id' => $listingId, 'tenant_id' => $this->testTenantId,
            'risk_level' => 'high', 'risk_category' => array_key_first(\App\Services\ListingRiskTagService::CATEGORIES),
            'risk_notes' => 'F401 admin note', 'requires_approval' => 0, 'insurance_required' => 1,
            'dbs_required' => 0, 'tagged_by' => $adminId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function insuranceViolation(int $listingId, int $providerId): bool
    {
        TenantContext::setById($this->testTenantId);
        $v = ExchangeWorkflowService::checkComplianceRequirements($listingId, $providerId);

        return in_array('Provider requires valid insurance certificate for this listing.', $v, true);
    }
}
