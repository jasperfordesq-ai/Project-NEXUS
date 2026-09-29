<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E061;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-228 — the Caring Community Warmth Pass is something a member shows to a
 * third party. It must never claim the member's identity was checked unless
 * they really passed identity verification, and its "Areas I help with" must
 * list help the member GAVE — never the help they asked for, which would put
 * their own care needs on a card they show to strangers.
 *
 * Until E-061 "identity verified" was `users.is_verified` (EMAIL verification)
 * OR any `verification_completed_at` (also set when verification FAILED), a
 * tier-3 pass was labelled "verified" whatever the identity state, and the
 * categories query read `caring_help_requests.category_id`, a column that does
 * not exist, so the section was always empty.
 */
class F228WarmthPassVerifiedClaimTest extends TestCase
{
    use DatabaseTransactions;

    private const MY_PASS = '/v2/caring-community/my-warmth-pass';

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
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string, mixed> $attrs */
    private function member(array $attrs = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attrs));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

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

    private function category(string $name, ?int $tenantId = null): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'name' => $name . ' ' . substr(uniqid(), -6),
            'slug' => 'f228-' . uniqid(),
            'type' => 'listing',
        ]);
    }

    private function categoryName(int $id): string
    {
        return (string) DB::table('categories')->where('id', $id)->value('name');
    }

    private function relationship(User $supporter, User $recipient, int $categoryId, string $status = 'active', ?int $tenantId = null): void
    {
        DB::table('caring_support_relationships')->insert([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'category_id' => $categoryId,
            'title' => 'F-228 support',
            'start_date' => now()->toDateString(),
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function myPass(User $user): array
    {
        Sanctum::actingAs($user);
        $response = $this->apiGet(self::MY_PASS);
        $response->assertStatus(200);

        return (array) $response->json('data');
    }

    public function test_email_verified_or_failed_verification_is_not_identity_verified(): void
    {
        // Email verified, and a FAILED identity attempt stamped verification_completed_at.
        $user = $this->member([
            'trust_tier' => 3,
            'is_verified' => 1,
            'verification_status' => 'failed',
            'verification_completed_at' => now(),
        ]);

        $pass = $this->myPass($user);

        $this->assertFalse($pass['identity_verified'], 'email verification / a failed attempt is not an identity check');
        $this->assertNotSame('verified', $pass['tier_label'], 'the pass must not be labelled "verified" without an identity check');
        $this->assertSame(2, $pass['tier']);
        $this->assertSame('trusted', $pass['tier_label']);
        $this->assertTrue($pass['eligible']);
    }

    public function test_member_with_active_id_verified_badge_is_identity_verified(): void
    {
        $user = $this->member(['trust_tier' => 3]);
        $this->grantIdBadge($user, $this->testTenantId);

        $pass = $this->myPass($user);

        $this->assertTrue($pass['identity_verified']);
        $this->assertSame(3, $pass['tier']);
        $this->assertSame('verified', $pass['tier_label']);
    }

    public function test_revoked_expired_or_other_tenant_badge_does_not_count(): void
    {
        $revoked = $this->member(['trust_tier' => 3]);
        $this->grantIdBadge($revoked, $this->testTenantId, ['revoked_at' => now()->subDay()]);

        $expired = $this->member(['trust_tier' => 3]);
        $this->grantIdBadge($expired, $this->testTenantId, ['expires_at' => now()->subDay()]);

        $elsewhere = $this->member(['trust_tier' => 3]);
        $this->grantIdBadge($elsewhere, self::OTHER_TENANT);

        foreach ([$revoked, $expired, $elsewhere] as $user) {
            $pass = $this->myPass($user);
            $this->assertFalse($pass['identity_verified'], "user {$user->id} must not read as identity verified");
            $this->assertSame('trusted', $pass['tier_label']);
        }
    }

    public function test_areas_i_help_with_lists_help_given_not_help_received(): void
    {
        $helper = $this->member(['trust_tier' => 2]);
        $other = $this->member();

        $given = $this->category('Gardening');
        $received = $this->category('Personal care');
        $cancelled = $this->category('Shopping');
        $foreign = $this->category('Foreign', self::OTHER_TENANT);

        $this->relationship($helper, $other, $given, 'active');
        $this->relationship($other, $helper, $received, 'active');   // help the member RECEIVES
        $this->relationship($helper, $other, $cancelled, 'cancelled');
        $this->relationship($helper, $other, $foreign, 'active');    // category owned by another tenant

        $pass = $this->myPass($helper);

        $this->assertContains($this->categoryName($given), $pass['categories']);
        $this->assertNotContains($this->categoryName($received), $pass['categories'], 'care the member receives must never appear on their pass');
        $this->assertNotContains($this->categoryName($cancelled), $pass['categories']);
        $this->assertNotContains($this->categoryName($foreign), $pass['categories']);
    }

    public function test_admin_lookup_is_tenant_scoped_and_shows_only_help_given(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $helper = $this->member(['trust_tier' => 2]);
        $other = $this->member();
        $outsider = $this->member(['trust_tier' => 4], self::OTHER_TENANT);

        $given = $this->category('Driving');
        $received = $this->category('Medication help');
        $this->relationship($helper, $other, $given);
        $this->relationship($other, $helper, $received);

        Sanctum::actingAs($admin);

        $ok = $this->apiGet('/v2/admin/caring-community/warmth-pass/' . $helper->id);
        $ok->assertStatus(200);
        $categories = (array) $ok->json('data.categories');
        $this->assertContains($this->categoryName($given), $categories);
        $this->assertNotContains($this->categoryName($received), $categories);

        // A member of another community is not visible from this one.
        $this->apiGet('/v2/admin/caring-community/warmth-pass/' . $outsider->id)->assertStatus(404);

        // An ordinary member cannot look up someone else's pass.
        Sanctum::actingAs($other);
        $this->apiGet('/v2/admin/caring-community/warmth-pass/' . $helper->id)->assertStatus(403);
    }
}
