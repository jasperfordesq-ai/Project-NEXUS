<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * F-381 (E-067) — the F-284 cross-community block turned the block list into a
 * name-and-photo harvester for members of partner communities who never joined
 * federation.
 *
 * BlockUserController::block() accepted any target whose community had a
 * federation_partnerships row in ANY status and never looked at the target's
 * federation opt-in; GET /v2/users/blocked then returned their name and avatar.
 *
 * Now: a member of another community can be blocked only while internal
 * federation could actually put them in front of the blocker — an ACTIVE
 * partnership and a target who has opted in — and the block list names a
 * partner member only while they stay visible across communities (the same
 * rule GET /v2/federation/members/{id} applies). A block made earlier of
 * someone who has since hidden is still listed, so it can be removed, but under
 * a neutral label with no surname or photo.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/a/A1BlockListCrossCommunityNameHarvestTest.php`,
 * which asserted the leak; every attack assertion is inverted.
 */
class F381BlockListPartnerVisibilityTest extends TestCase
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

    public function test_partner_member_who_never_opted_in_cannot_be_blocked_or_named(): void
    {
        $partner = $this->partnerCommunity('active');
        $attacker = $this->federatedMember($this->home);

        $victim = User::factory()->forTenant($partner)->create([
            'status' => 'active',
            'is_approved' => true,
            'first_name' => 'F381Hidden',
            'last_name' => 'Surname' . random_int(1000, 9999),
            'avatar_url' => '/uploads/f381/secret-avatar.png',
        ]);

        $this->as($attacker, $this->home);
        $this->apiPost('/v2/users/' . $victim->id . '/block')->assertStatus(404);

        $this->assertFalse(
            DB::table('user_blocks')->where('user_id', $attacker->id)->where('blocked_user_id', $victim->id)->exists(),
            'no block row is written for a member federation cannot put in front of the caller'
        );

        $this->as($attacker, $this->home);
        $rows = $this->apiGet('/v2/users/blocked')->assertOk()->json('data') ?? [];
        $this->assertNull(collect($rows)->firstWhere('user_id', (int) $victim->id));
    }

    public function test_a_partnership_that_is_not_active_is_not_enough(): void
    {
        $partner = $this->partnerCommunity('pending');
        $attacker = $this->federatedMember($this->home);
        // Even an opted-in member is out of reach while the partnership is pending.
        $victim = $this->federatedMember($partner);

        $this->as($attacker, $this->home);
        $this->apiPost('/v2/users/' . $victim->id . '/block')->assertStatus(404);
    }

    public function test_control_an_opted_in_partner_member_can_be_blocked_and_is_named(): void
    {
        $partner = $this->partnerCommunity('active');
        $attacker = $this->federatedMember($this->home);
        $visible = $this->federatedMember($partner, ['first_name' => 'F381Visible']);

        $this->as($attacker, $this->home);
        $this->apiPost('/v2/users/' . $visible->id . '/block')->assertOk();

        $this->as($attacker, $this->home);
        $rows = $this->apiGet('/v2/users/blocked')->assertOk()->json('data') ?? [];
        $row = collect($rows)->firstWhere('user_id', (int) $visible->id);
        $this->assertNotNull($row);
        $this->assertSame('F381Visible', $row['first_name']);
    }

    public function test_an_earlier_block_of_someone_who_has_since_hidden_is_listed_without_identity(): void
    {
        $partner = $this->partnerCommunity('active');
        $attacker = $this->federatedMember($this->home);
        $target = $this->federatedMember($partner, [
            'first_name' => 'F381Later',
            'last_name' => 'Hidden' . random_int(1000, 9999),
            'avatar_url' => '/uploads/f381/later.png',
        ]);

        $this->as($attacker, $this->home);
        $this->apiPost('/v2/users/' . $target->id . '/block')->assertOk();

        // The target stops being visible to other communities.
        DB::table('federation_user_settings')->where('user_id', $target->id)
            ->update(['profile_visible_federated' => 0]);

        $this->as($attacker, $this->home);
        $rows = $this->apiGet('/v2/users/blocked')->assertOk()->json('data') ?? [];
        $row = collect($rows)->firstWhere('user_id', (int) $target->id);

        $this->assertNotNull($row, 'the block is still listed so the member can remove it');
        $this->assertNotSame('F381Later', $row['first_name']);
        $this->assertNotSame($target->last_name, $row['last_name']);
        $this->assertStringNotContainsString('F381Later', (string) $row['name']);
        $this->assertNull($row['avatar_url']);
    }

    public function test_control_same_community_blocks_are_unchanged(): void
    {
        $attacker = $this->federatedMember($this->home);
        $neighbour = User::factory()->forTenant($this->home)->create([
            'status' => 'active',
            'is_approved' => true,
            'first_name' => 'F381Neighbour',
        ]);

        $this->as($attacker, $this->home);
        $this->apiPost('/v2/users/' . $neighbour->id . '/block')->assertOk();

        $this->as($attacker, $this->home);
        $rows = $this->apiGet('/v2/users/blocked')->assertOk()->json('data') ?? [];
        $this->assertSame('F381Neighbour', collect($rows)->firstWhere('user_id', (int) $neighbour->id)['first_name'] ?? null);
    }

    // ------------------------------------------------------------ helpers

    private function community(): int
    {
        $suffix = substr(bin2hex(random_bytes(4)), 0, 8);

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'F381 Community ' . $suffix,
            'slug' => 'f381-' . $suffix,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function partnerCommunity(string $status): int
    {
        $tenantId = $this->community();
        $this->enableFederationForTenant($this->home);
        $this->enableFederationForTenant($tenantId);
        app(FederationFeatureService::class)->clearCache();

        $data = [
            'tenant_id' => $this->home,
            'partner_tenant_id' => $tenantId,
            'status' => $status,
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => $status === 'active' ? now() : null,
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
            ['status' => 'active', 'is_approved' => true],
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
