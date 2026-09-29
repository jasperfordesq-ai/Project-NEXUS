<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E061;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\TrustTierService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-269 — the stored Caring Community trust tiers "Verified" (3) and
 * "Coordinator" (4) must only be reached by a member who really passed an
 * identity check: an active id_verified badge in their own tenant.
 *
 * Until E-061 TrustTierService::isIdentityVerified() accepted
 * `users.is_verified` (EMAIL verification) or any `verification_completed_at`
 * (also stamped when an identity check FAILS), and a tenant could switch the
 * identity requirement off for those tiers, so "Verified" could be earned
 * with an email address. Stored tiers are corrected by the normal recompute
 * paths: the member's own GET my-trust-tier and the admin "Recompute" action.
 */
class F269TrustTierIdentityVerifiedTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT = 1;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        DB::table('caring_trust_tier_config')->where('tenant_id', $this->testTenantId)->delete();
        TenantContext::setById($this->testTenantId);
    }

    /**
     * A member who meets every hours/reviews threshold up to Coordinator
     * (50 hours, 5 reviews), so identity is the only thing that decides 3/4.
     *
     * @param array<string, mixed> $attrs
     */
    private function busyMember(array $attrs = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'trust_tier' => 0,
        ], $attrs));

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => 60,
            'description' => 'F-269 support',
            'status' => 'approved',
        ]);

        for ($i = 0; $i < 5; $i++) {
            $reviewer = User::factory()->forTenant($this->testTenantId)->create();
            DB::table('reviews')->insert([
                'tenant_id' => $this->testTenantId,
                'reviewer_id' => $reviewer->id,
                'receiver_id' => $user->id,
                'rating' => 5,
                'comment' => 'Kind.',
                'status' => 'approved',
                'created_at' => now(),
            ]);
        }
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /** @param array<string, mixed> $extra */
    private function grantIdBadge(User $user, int $tenantId, array $extra = []): void
    {
        DB::table('member_verification_badges')->insert(array_merge([
            'user_id' => $user->id,
            'tenant_id' => $tenantId,
            'badge_type' => 'id_verified',
            'verified_by' => $user->id,
            'granted_at' => now(),
        ], $extra));
    }

    private function storedTier(User $user): int
    {
        return (int) DB::table('users')->where('id', $user->id)->value('trust_tier');
    }

    public function test_email_only_and_failed_attempt_members_do_not_reach_verified_or_coordinator(): void
    {
        $service = new TrustTierService();

        $emailOnly = $this->busyMember(['is_verified' => 1]);
        $failed = $this->busyMember([
            'is_verified' => 1,
            'verification_status' => 'failed',
            'verification_completed_at' => now(),
        ]);

        foreach ([$emailOnly, $failed] as $user) {
            $this->assertSame(
                TrustTierService::TIER_TRUSTED,
                $service->computeTier($user->id, $this->testTenantId),
                "user {$user->id} has no identity check and must stop at Trusted"
            );

            $breakdown = $service->computeBreakdownForUser($user->id, $this->testTenantId);
            $identity = collect($breakdown['signals'])->firstWhere('key', 'identity_verified');
            $this->assertSame(0, $identity['current']);
            $this->assertFalse($identity['achieved']);
        }
    }

    public function test_revoked_expired_and_other_tenant_badges_do_not_count(): void
    {
        $service = new TrustTierService();

        $revoked = $this->busyMember();
        $this->grantIdBadge($revoked, $this->testTenantId, ['revoked_at' => now()->subDay()]);
        $expired = $this->busyMember();
        $this->grantIdBadge($expired, $this->testTenantId, ['expires_at' => now()->subDay()]);
        $elsewhere = $this->busyMember();
        $this->grantIdBadge($elsewhere, self::OTHER_TENANT);

        foreach ([$revoked, $expired, $elsewhere] as $user) {
            $this->assertSame(TrustTierService::TIER_TRUSTED, $service->computeTier($user->id, $this->testTenantId));
        }
    }

    public function test_badge_holder_reaches_coordinator(): void
    {
        $service = new TrustTierService();
        $holder = $this->busyMember(['is_verified' => 0]);
        $this->grantIdBadge($holder, $this->testTenantId);

        $this->assertSame(TrustTierService::TIER_COORDINATOR, $service->computeTier($holder->id, $this->testTenantId));
    }

    public function test_tenant_config_cannot_remove_identity_requirement_above_trusted(): void
    {
        $service = new TrustTierService();
        $config = TrustTierService::DEFAULT_CRITERIA;
        $config['verified']['identity_verified'] = false;
        $config['coordinator']['identity_verified'] = false;
        $service->updateConfig($this->testTenantId, $config);

        $loaded = $service->getConfig($this->testTenantId);
        $this->assertTrue($loaded['verified']['identity_verified']);
        $this->assertTrue($loaded['coordinator']['identity_verified']);

        $member = $this->busyMember(['is_verified' => 1]);
        $this->assertSame(TrustTierService::TIER_TRUSTED, $service->computeTier($member->id, $this->testTenantId));
    }

    public function test_wrongly_high_stored_tier_is_lowered_by_the_normal_recompute_paths(): void
    {
        // Member's own trust-tier page recomputes and stores.
        $viaRead = $this->busyMember(['is_verified' => 1, 'trust_tier' => TrustTierService::TIER_COORDINATOR]);
        Sanctum::actingAs($viaRead);
        $this->apiGet('/v2/caring-community/my-trust-tier')
            ->assertStatus(200)
            ->assertJsonPath('data.tier', TrustTierService::TIER_TRUSTED);
        $this->assertSame(TrustTierService::TIER_TRUSTED, $this->storedTier($viaRead));

        // Admin "Recompute" corrects everyone else in the tenant.
        $viaAdmin = $this->busyMember(['is_verified' => 1, 'trust_tier' => TrustTierService::TIER_VERIFIED]);
        $control = $this->busyMember(['trust_tier' => 0]);
        $this->grantIdBadge($control, $this->testTenantId);

        (new TrustTierService())->recomputeAll($this->testTenantId);

        $this->assertSame(TrustTierService::TIER_TRUSTED, $this->storedTier($viaAdmin));
        $this->assertSame(TrustTierService::TIER_COORDINATOR, $this->storedTier($control));
    }
}
