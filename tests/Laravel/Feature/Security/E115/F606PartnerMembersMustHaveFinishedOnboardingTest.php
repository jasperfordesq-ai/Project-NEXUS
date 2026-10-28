<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E115;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use App\Services\FederationSearchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * F-606 (E-115) — members of a partner community who never finished the
 * onboarding wizard were shown to other communities.
 *
 * Owner rule, 28 Oct 2026: when browsing a partner community's members, only
 * members who have completed onboarding may be seen. Federation opt-in alone is
 * not enough: a member who has not onboarded is invisible across communities —
 * in the member list, on the profile page, in reviews, in the search service
 * and in the partner member count.
 *
 * Every harm case has a control on an identical member who differs only in
 * `users.onboarding_completed`.
 */
final class F606PartnerMembersMustHaveFinishedOnboardingTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    private int $home = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
    }

    public function test_member_list_hides_a_partner_member_who_has_not_onboarded(): void
    {
        $partner = $this->partnerCommunity();
        $viewer = $this->federatedMember($this->home);
        $hidden = $this->federatedMember($partner, ['first_name' => 'F606Hidden', 'onboarding_completed' => false]);
        $shown = $this->federatedMember($partner, ['first_name' => 'F606Shown']);

        $this->as($viewer, $this->home);
        $response = $this->apiGet('/v2/federation/members?per_page=100&partner_id=' . $partner)->assertOk();
        $ids = array_map(fn ($r) => (int) $r['id'], $response->json('data') ?? []);

        $this->assertNotContains((int) $hidden->id, $ids, 'a member who has not onboarded must not be listed');
        $this->assertContains((int) $shown->id, $ids, 'control: an onboarded member is still listed');
        $this->assertStringNotContainsString('F606Hidden', (string) $response->getContent());
    }

    public function test_search_by_name_does_not_find_a_member_who_has_not_onboarded(): void
    {
        $partner = $this->partnerCommunity();
        $viewer = $this->federatedMember($this->home);
        $hidden = $this->federatedMember($partner, ['first_name' => 'F606Needle', 'onboarding_completed' => false]);

        $this->as($viewer, $this->home);
        $response = $this->apiGet('/v2/federation/members?q=F606Needle')->assertOk();

        $this->assertSame([], $response->json('data') ?? []);
        $this->assertNotContains((int) $hidden->id, array_map(fn ($r) => (int) $r['id'], $response->json('data') ?? []));
    }

    public function test_profile_and_reviews_are_refused_for_a_member_who_has_not_onboarded(): void
    {
        $partner = $this->partnerCommunity();
        $viewer = $this->federatedMember($this->home);
        $hidden = $this->federatedMember($partner, ['first_name' => 'F606Profile', 'onboarding_completed' => false]);
        $shown = $this->federatedMember($partner, ['first_name' => 'F606ProfileShown']);

        $this->as($viewer, $this->home);
        $this->apiGet('/v2/federation/members/' . $hidden->id . '?tenant_id=' . $partner)->assertStatus(404);

        $this->as($viewer, $this->home);
        $reviews = $this->apiGet('/v2/federation/members/' . $hidden->id . '/reviews?tenant_id=' . $partner)->assertOk();
        $this->assertEmpty($reviews->json('data'));

        $this->as($viewer, $this->home);
        $this->apiGet('/v2/federation/members/' . $shown->id . '?tenant_id=' . $partner)
            ->assertOk()
            ->assertJsonPath('data.first_name', 'F606ProfileShown');
    }

    public function test_partner_member_count_leaves_out_members_who_have_not_onboarded(): void
    {
        $partner = $this->partnerCommunity();
        $viewer = $this->federatedMember($this->home);
        $this->federatedMember($partner, ['onboarding_completed' => false]);
        $this->federatedMember($partner, ['onboarding_completed' => false]);
        $this->federatedMember($partner);

        $this->as($viewer, $this->home);
        $rows = $this->apiGet('/v2/federation/partners')->assertOk()->json('data') ?? [];
        $row = collect($rows)->first(fn ($r) => (int) ($r['partner_tenant_id'] ?? $r['tenant_id'] ?? $r['id'] ?? 0) === $partner);

        $this->assertNotNull($row, 'the partner community is listed');
        $count = $row['member_count'] ?? $row['partner_member_count'] ?? null;
        $this->assertSame(1, (int) $count, 'only the onboarded member is counted');
    }

    public function test_search_service_ignores_members_who_have_not_onboarded(): void
    {
        $partner = $this->partnerCommunity();
        $hidden = $this->federatedMember($partner, [
            'onboarding_completed' => false,
            'skills' => 'f606skillhidden',
            'location' => 'F606 Hidden Town',
        ]);
        $shown = $this->federatedMember($partner);
        DB::table('federation_user_settings')->where('user_id', $hidden->id)
            ->update(['show_skills_federated' => 1, 'show_location_federated' => 1]);

        $service = app(FederationSearchService::class);
        $ids = array_map(fn ($r) => (int) $r['id'], $service->searchMembers([$partner], ['limit' => 200])['members'] ?? []);
        $this->assertNotContains((int) $hidden->id, $ids);
        $this->assertContains((int) $shown->id, $ids);

        $skills = json_encode($service->getAvailableSkills([$partner], 'f606skill'));
        $this->assertStringNotContainsString('f606skillhidden', (string) $skills);

        $locations = json_encode($service->getAvailableLocations([$partner], 'F606 Hidden'));
        $this->assertStringNotContainsString('F606 Hidden Town', (string) $locations);
    }

    // ------------------------------------------------------------ helpers

    private function partnerCommunity(): int
    {
        $suffix = substr(bin2hex(random_bytes(4)), 0, 8);
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F606 Community ' . $suffix,
            'slug' => 'f606-' . $suffix,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->enableFederationForTenant($this->home);
        $this->enableFederationForTenant($tenantId);
        app(FederationFeatureService::class)->clearCache();

        $data = [
            'tenant_id' => $this->home,
            'partner_tenant_id' => $tenantId,
            'status' => 'active',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if (Schema::hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->home, $tenantId) . '-' . max($this->home, $tenantId);
        }
        DB::table('federation_partnerships')->insert($data);
        TenantContext::setById($this->home);

        return $tenantId;
    }

    /** @param array<string,mixed> $attributes */
    private function federatedMember(int $tenantId, array $attributes = []): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge(
            ['status' => 'active', 'is_approved' => true, 'onboarding_completed' => true],
            $attributes
        ));
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ]
        );

        return $user;
    }

    private function as(User $user, int $tenantId): void
    {
        $this->app['auth']->forgetGuards();
        $this->withTenant($tenantId);
        TenantContext::setById($tenantId);
        Sanctum::actingAs($user, ['*']);
    }
}
