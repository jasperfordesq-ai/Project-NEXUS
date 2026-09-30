<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ExchangeWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-389 (E-067) — a broker could clear the compliance controls an administrator
 * put on the broker's OWN listing: create a certificate already "verified" for
 * themselves (with no verifier recorded), verify their own pending certificate,
 * or delete — or overwrite — the administrator's risk tag on their own listing.
 * The insurance gate on that listing's exchanges then stopped firing. Broker
 * self-interest, the F-217/F-218/F-219/F-254 class; the vetting controller
 * already refuses the equivalent self-confirmation.
 *
 * Now a broker (not the administrator tier) is refused on their own
 * certificate and their own listing, and a certificate created already
 * "verified" records who verified it.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/d/BrokerSelfCertifiesListingComplianceTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F389BrokerCannotClearOwnListingComplianceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_broker_cannot_record_a_verified_certificate_for_themselves(): void
    {
        $broker = $this->broker();
        $listing = $this->listing((int) $broker->id);
        $this->adminTag($listing, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $this->apiPost('/v2/admin/insurance', [
            'user_id' => (int) $broker->id, 'insurance_type' => 'public_liability', 'status' => 'verified',
        ])->assertStatus(403);

        $this->assertSame(0, DB::table('insurance_certificates')->where('user_id', $broker->id)->count());
        $this->assertTrue($this->insuranceViolation($listing, (int) $broker->id), 'the insurance gate stays in force');
    }

    public function test_broker_cannot_verify_their_own_certificate(): void
    {
        $broker = $this->broker();
        $certId = (int) DB::table('insurance_certificates')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $broker->id, 'insurance_type' => 'public_liability',
            'status' => 'submitted', 'created_at' => now(),
        ]);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/insurance/{$certId}/verify")->assertStatus(403);

        $this->assertSame('submitted', DB::table('insurance_certificates')->where('id', $certId)->value('status'));
    }

    public function test_broker_cannot_remove_or_overwrite_the_risk_tag_on_their_own_listing(): void
    {
        $broker = $this->broker();
        $listing = $this->listing((int) $broker->id);
        $this->adminTag($listing, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $this->apiDelete("/v2/admin/broker/risk-tags/{$listing}")->assertStatus(403);
        $this->apiPost("/v2/admin/broker/risk-tags/{$listing}", [
            'risk_level' => 'low',
            'risk_category' => array_key_first(\App\Services\ListingRiskTagService::CATEGORIES),
            'insurance_required' => false,
            'requires_approval' => false,
        ])->assertStatus(403);

        $tag = DB::table('listing_risk_tags')->where('listing_id', $listing)->first();
        $this->assertNotNull($tag, 'the administrator\'s tag survives');
        $this->assertSame('high', $tag->risk_level);
        $this->assertSame(1, (int) $tag->insurance_required);
    }

    public function test_control_broker_records_a_verified_certificate_for_another_member_with_a_verifier(): void
    {
        $member = $this->member();
        $broker = $this->broker();
        Sanctum::actingAs($broker);

        $this->apiPost('/v2/admin/insurance', [
            'user_id' => (int) $member->id, 'insurance_type' => 'public_liability', 'status' => 'verified',
        ])->assertStatus(201);

        $row = DB::table('insurance_certificates')->where('user_id', $member->id)->first();
        $this->assertSame('verified', $row->status);
        $this->assertSame((int) $broker->id, (int) $row->verified_by, 'the verifier is recorded');
        $this->assertNotNull($row->verified_at);
    }

    public function test_control_broker_can_still_untag_another_members_listing(): void
    {
        $member = $this->member();
        $listing = $this->listing((int) $member->id);
        $this->adminTag($listing, (int) $this->admin()->id);

        Sanctum::actingAs($this->broker());
        $this->apiDelete("/v2/admin/broker/risk-tags/{$listing}")->assertStatus(200);
        $this->assertSame(0, DB::table('listing_risk_tags')->where('listing_id', $listing)->count());
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

    private function listing(int $ownerId): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'title' => 'F389 fixture', 'description' => 'F389 fixture listing',
            'type' => 'offer', 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function adminTag(int $listingId, int $adminId): void
    {
        DB::table('listing_risk_tags')->insert([
            'listing_id' => $listingId, 'tenant_id' => $this->testTenantId,
            'risk_level' => 'high', 'risk_category' => array_key_first(\App\Services\ListingRiskTagService::CATEGORIES),
            'risk_notes' => 'F389 admin note', 'requires_approval' => 1, 'insurance_required' => 1,
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
