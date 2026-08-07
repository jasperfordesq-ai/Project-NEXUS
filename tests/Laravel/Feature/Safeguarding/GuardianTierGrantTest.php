<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The supported member decides what their guardian may DO.
 *
 * 🔴 The gap this closes (found by the owner, 2026-08-07). Phase 5 folded
 * staff-recorded arrangements into account_relationships and then refused to
 * let the linked-accounts path change their tiers — correctly, because that
 * path is driven by the GUARDIAN, and a guardian granting themselves powers
 * over the person they support is the thing this module exists to prevent.
 * But no other route existed, and one-row-per-pair blocked making an ordinary
 * link instead. The tiers were therefore unreachable for every pair a
 * coordinator had recorded.
 *
 * These tests pin the boundary the fix depends on: the decision belongs to
 * the supported member, only on an arrangement they have agreed to, and the
 * guardian can never make it.
 */
class GuardianTierGrantTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0:User,1:User,2:int} [guardian, supported, arrangementId] */
    private function seedArrangement(string $status = 'active', array $overrides = []): array
    {
        $tenantId = $this->testTenantId;

        $guardian = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Grace', 'last_name' => 'Guardian', 'status' => 'active', 'is_approved' => true,
        ]);
        $supported = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Molly', 'last_name' => 'Member', 'status' => 'active', 'is_approved' => true,
        ]);
        $staff = User::factory()->forTenant($tenantId)->admin()->create();

        $id = (int) DB::table('account_relationships')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'parent_user_id' => $guardian->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'guardian',
            'permissions' => json_encode([
                'can_view_activity' => false, 'can_manage_listings' => false,
                'can_transact' => false, 'can_view_messages' => false,
                'tiers' => ['activity' => 'none', 'listings' => 'none', 'credits' => 'none'],
            ]),
            'status' => $status,
            'proposed_by_user_id' => $staff->id,
            'approved_at' => $status === 'active' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return [$guardian, $supported, $id];
    }

    private function tiersOf(int $id): array
    {
        $permissions = json_decode(
            (string) DB::table('account_relationships')->where('id', $id)->value('permissions'),
            true,
        );

        return SupportTiers::resolve(is_array($permissions) ? $permissions : []);
    }

    public function test_the_supported_member_can_grant_a_level(): void
    {
        [, $supported, $id] = $this->seedArrangement();
        Sanctum::actingAs($supported);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id,
            'tiers' => ['listings' => SupportTiers::CO_DECIDE],
        ])->assertStatus(200)->assertJsonPath('data.tiers.listings', SupportTiers::CO_DECIDE);

        $tiers = $this->tiersOf($id);
        $this->assertSame(SupportTiers::CO_DECIDE, $tiers['listings']);
        // Untouched capabilities stay where they were — an absent key means
        // "leave alone", never "reset".
        $this->assertSame(SupportTiers::NONE, $tiers['credits']);
    }

    /** 🔴 The whole point. A guardian must never grant themselves powers. */
    public function test_the_guardian_cannot_grant_themselves_anything(): void
    {
        [$guardian, , $id] = $this->seedArrangement();
        Sanctum::actingAs($guardian);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id,
            'tiers' => ['credits' => SupportTiers::REPRESENT],
        ])->assertStatus(404);

        $this->assertSame(SupportTiers::NONE, $this->tiersOf($id)['credits']);
    }

    public function test_a_stranger_cannot_grant_anything(): void
    {
        [, , $id] = $this->seedArrangement();
        $stranger = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($stranger);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id,
            'tiers' => ['credits' => SupportTiers::REPRESENT],
        ])->assertStatus(404);

        $this->assertSame(SupportTiers::NONE, $this->tiersOf($id)['credits']);
    }

    /**
     * Granting powers under an arrangement you have NOT agreed to would let
     * the grant stand in for the consent.
     */
    public function test_powers_cannot_be_granted_before_the_member_has_agreed(): void
    {
        [, $supported, $id] = $this->seedArrangement('pending');
        Sanctum::actingAs($supported);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id,
            'tiers' => ['listings' => SupportTiers::REPRESENT],
        ])->assertStatus(404);

        $this->assertSame(SupportTiers::NONE, $this->tiersOf($id)['listings']);
    }

    public function test_an_unknown_level_is_refused_and_nothing_changes(): void
    {
        [, $supported, $id] = $this->seedArrangement();
        Sanctum::actingAs($supported);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id,
            'tiers' => ['listings' => 'do_anything'],
        ])->assertStatus(422);

        $this->assertSame(SupportTiers::NONE, $this->tiersOf($id)['listings']);
    }

    public function test_the_member_can_take_a_power_back(): void
    {
        [, $supported, $id] = $this->seedArrangement();
        Sanctum::actingAs($supported);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id, 'tiers' => ['credits' => SupportTiers::REPRESENT],
        ])->assertStatus(200);
        $this->assertSame(SupportTiers::REPRESENT, $this->tiersOf($id)['credits']);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id, 'tiers' => ['credits' => SupportTiers::NONE],
        ])->assertStatus(200);
        $this->assertSame(SupportTiers::NONE, $this->tiersOf($id)['credits']);
    }

    public function test_every_change_lands_in_the_immutable_trail_with_before_and_after(): void
    {
        [, $supported, $id] = $this->seedArrangement();
        Sanctum::actingAs($supported);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id, 'tiers' => ['listings' => SupportTiers::CO_DECIDE],
        ])->assertStatus(200);

        $event = DB::table('account_relationship_events')
            ->where('relationship_id', $id)
            ->where('action', 'permissions_changed')
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($event);
        $this->assertSame('member', $event->actor_role);
        $this->assertEquals($supported->id, (int) $event->actor_user_id);
        $details = json_decode((string) $event->details, true);
        $this->assertSame(SupportTiers::NONE, $details['tiers_before']['listings']);
        $this->assertSame(SupportTiers::CO_DECIDE, $details['tiers_after']['listings']);

        // The guardian is told what they may now do.
        $this->assertDatabaseHas('notifications', ['user_id' => DB::table('account_relationships')->where('id', $id)->value('parent_user_id')]);
    }

    public function test_setting_the_same_level_again_writes_no_history_row(): void
    {
        [, $supported, $id] = $this->seedArrangement();
        Sanctum::actingAs($supported);

        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id, 'tiers' => ['listings' => SupportTiers::NONE],
        ])->assertStatus(200);

        $this->assertSame(0, DB::table('account_relationship_events')
            ->where('relationship_id', $id)->where('action', 'permissions_changed')->count());
    }

    /**
     * A granted arrangement must reach the guardian's linked-accounts screen,
     * or the grant is decorative — that screen is where preparing happens.
     * Ungranted ones must stay out of it.
     */
    public function test_a_granted_arrangement_reaches_the_guardians_screen_read_only(): void
    {
        [$guardian, $supported, $id] = $this->seedArrangement();

        Sanctum::actingAs($guardian);
        $before = $this->apiGet('/v2/users/me/sub-accounts')->assertStatus(200)->json('data');
        $this->assertSame([], $before, 'An arrangement with nothing granted must not appear here.');

        Sanctum::actingAs($supported);
        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id, 'tiers' => ['listings' => SupportTiers::CO_DECIDE],
        ])->assertStatus(200);

        Sanctum::actingAs($guardian);
        $after = $this->apiGet('/v2/users/me/sub-accounts')->assertStatus(200)->json('data');
        $this->assertCount(1, $after);
        // Flagged so the screen shows the grant read-only rather than offering
        // the guardian a control to change it.
        $this->assertTrue($after[0]['staff_recorded']);
    }

    public function test_the_guardian_still_cannot_change_it_through_the_linked_accounts_path(): void
    {
        [$guardian, $supported, $id] = $this->seedArrangement();

        Sanctum::actingAs($supported);
        $this->apiPost('/v2/safeguarding/guardian-permissions', [
            'assignment_id' => $id, 'tiers' => ['listings' => SupportTiers::CO_DECIDE],
        ])->assertStatus(200);

        // Now visible to the guardian — but still not theirs to re-grant.
        Sanctum::actingAs($guardian);
        $this->apiPut("/v2/users/me/sub-accounts/{$id}/permissions", [
            'permissions' => ['tiers' => ['credits' => SupportTiers::REPRESENT]],
        ])->assertStatus(422);

        $this->assertSame(SupportTiers::NONE, $this->tiersOf($id)['credits']);
    }
}
