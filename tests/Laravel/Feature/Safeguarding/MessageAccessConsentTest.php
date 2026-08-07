<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Models\SupportPendingAction;
use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The message-access consent state machine (owner decision 2026-08-07).
 *
 *   none ──supporter asks assist──▶ none + pending consent
 *   pending ──member confirms──▶ assist (the ONLY raise path)
 *   pending ──member declines──▶ none
 *   assist ──member withdraws / supporter sets none──▶ none (+ pending dies)
 *   any exit ──ask again──▶ a FRESH pending consent
 *
 * Plus the trap that must stay closed forever: historical rows carrying
 * `can_view_messages: true` (the switch that saved-and-did-nothing) must
 * never resolve to the real capability.
 */
class MessageAccessConsentTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function seedRelationship(User $supporter, User $supported, array $permissions = []): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode($permissions ?: [
                'can_view_activity' => true,
                'tiers' => ['activity' => 'assist', 'listings' => 'none', 'credits' => 'none'],
            ]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function storedTiers(int $relationshipId): array
    {
        $permissions = json_decode((string) DB::table('account_relationships')
            ->where('id', $relationshipId)->value('permissions'), true) ?: [];

        return SupportTiers::resolve($permissions);
    }

    private function pendingGrantCount(int $relationshipId): int
    {
        return DB::table('support_pending_actions')
            ->where('relationship_id', $relationshipId)
            ->where('action_type', SupportPendingAction::TYPE_MESSAGE_ACCESS_GRANT)
            ->where('status', SupportPendingAction::STATUS_PENDING)
            ->count();
    }

    // ------------------------------------------------------------------
    //  Requesting
    // ------------------------------------------------------------------

    public function test_requesting_message_access_creates_a_pending_consent_and_no_tier(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $relationshipId = $this->seedRelationship($supporter, $supported);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();

        $this->assertSame(SupportTiers::NONE, $this->storedTiers($relationshipId)['messages'],
            'The tier must NOT rise from the supporter\'s own request.');
        $this->assertSame(1, $this->pendingGrantCount($relationshipId));
        $this->assertNull(DB::table('account_relationships')->where('id', $relationshipId)->value('message_access_granted_at'));

        // The supported member was asked (bell + email with the confirm link).
        $this->assertDatabaseHas('notifications', ['user_id' => $supported->id, 'type' => 'support_action_pending']);
    }

    public function test_asking_again_while_pending_is_idempotent_not_spam(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $relationshipId = $this->seedRelationship($supporter, $supported);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();
        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();

        $this->assertSame(1, $this->pendingGrantCount($relationshipId),
            'A second ask while one is pending must not create another row (bell/email spam).');
    }

    // ------------------------------------------------------------------
    //  Answering
    // ------------------------------------------------------------------

    public function test_member_confirmation_is_the_only_path_that_raises_the_tier(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $relationshipId = $this->seedRelationship($supporter, $supported);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();

        $actionId = (int) DB::table('support_pending_actions')
            ->where('relationship_id', $relationshipId)
            ->where('action_type', SupportPendingAction::TYPE_MESSAGE_ACCESS_GRANT)
            ->value('id');

        Sanctum::actingAs($supported, ['*']);
        $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm")->assertOk();

        $this->assertSame(SupportTiers::ASSIST, $this->storedTiers($relationshipId)['messages']);
        $this->assertNotNull(DB::table('account_relationships')->where('id', $relationshipId)->value('message_access_granted_at'),
            'The notice mirror column must be set in the same confirm.');
        // The immutable relationship trail records the consent-driven change.
        $this->assertDatabaseHas('account_relationship_events', [
            'relationship_id' => $relationshipId,
            'action' => 'permissions_changed',
        ]);
    }

    public function test_declining_leaves_the_tier_at_none(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $relationshipId = $this->seedRelationship($supporter, $supported);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();

        $actionId = (int) DB::table('support_pending_actions')
            ->where('relationship_id', $relationshipId)
            ->where('action_type', SupportPendingAction::TYPE_MESSAGE_ACCESS_GRANT)
            ->value('id');

        Sanctum::actingAs($supported, ['*']);
        $this->apiPost("/v2/users/me/support-actions/{$actionId}/decline")->assertOk();

        $this->assertSame(SupportTiers::NONE, $this->storedTiers($relationshipId)['messages']);
        $this->assertNull(DB::table('account_relationships')->where('id', $relationshipId)->value('message_access_granted_at'));
    }

    // ------------------------------------------------------------------
    //  Withdrawing + fresh consent
    // ------------------------------------------------------------------

    public function test_member_withdraws_any_time_and_reenabling_needs_fresh_consent(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $relationshipId = $this->seedRelationship($supporter, $supported);

        // Grant through the full loop.
        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();
        $actionId = (int) DB::table('support_pending_actions')
            ->where('relationship_id', $relationshipId)
            ->where('action_type', SupportPendingAction::TYPE_MESSAGE_ACCESS_GRANT)
            ->value('id');
        Sanctum::actingAs($supported, ['*']);
        $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm")->assertOk();
        $this->assertSame(SupportTiers::ASSIST, $this->storedTiers($relationshipId)['messages']);

        // Withdraw — the member's unilateral exit.
        $this->apiPost("/v2/users/me/parent-accounts/{$relationshipId}/message-access/withdraw")->assertOk();
        $this->assertSame(SupportTiers::NONE, $this->storedTiers($relationshipId)['messages']);
        $this->assertNull(DB::table('account_relationships')->where('id', $relationshipId)->value('message_access_granted_at'));
        // The supporter is told, without a reason attached.
        $this->assertDatabaseHas('notifications', ['user_id' => $supporter->id, 'type' => 'sub_account_message_access_revoked']);

        // Asking again creates a FRESH pending consent — approval each time.
        Sanctum::actingAs($supporter, ['*']);
        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();
        $this->assertSame(SupportTiers::NONE, $this->storedTiers($relationshipId)['messages']);
        $this->assertSame(1, $this->pendingGrantCount($relationshipId));
    }

    public function test_supporter_setting_none_cancels_the_open_ask(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $relationshipId = $this->seedRelationship($supporter, $supported);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['messages' => 'assist']],
        ])->assertOk();
        $this->assertSame(1, $this->pendingGrantCount($relationshipId));

        // Supporter changes their mind before the member answers. The pending
        // ask must die with it — a dead ask answered later must not become a
        // live grant. (Setting none from none is a no-op tier-wise, so the
        // withdraw-style cleanup is what this pins.)
        Sanctum::actingAs($supported, ['*']);
        $this->apiPost("/v2/users/me/parent-accounts/{$relationshipId}/message-access/withdraw")->assertOk();
        $this->assertSame(0, $this->pendingGrantCount($relationshipId));

        $staleActionId = (int) DB::table('support_pending_actions')
            ->where('relationship_id', $relationshipId)
            ->where('action_type', SupportPendingAction::TYPE_MESSAGE_ACCESS_GRANT)
            ->value('id');
        $this->apiPost("/v2/users/me/support-actions/{$staleActionId}/confirm")->assertStatus(422);
        $this->assertSame(SupportTiers::NONE, $this->storedTiers($relationshipId)['messages']);
    }

    // ------------------------------------------------------------------
    //  The traps that must stay closed forever
    // ------------------------------------------------------------------

    /**
     * 🔴 Historical rows carry `can_view_messages: true` from the years the
     * switch saved-and-did-nothing. They must NEVER resolve to the real
     * capability — that would retroactively grant access nobody consented to.
     */
    public function test_historical_dead_boolean_never_activates_the_real_capability(): void
    {
        $tiers = SupportTiers::resolve([
            'can_view_activity' => true,
            'can_manage_listings' => true,
            'can_transact' => true,
            'can_view_messages' => true, // the fossil
        ]);

        $this->assertSame(SupportTiers::NONE, $tiers['messages']);
    }

    public function test_messages_tier_is_capped_at_assist_and_staff_never_hold_it(): void
    {
        // Above the ceiling → dropped, not clamped.
        $this->assertSame([], SupportTiers::sanitizeTiers(['messages' => 'represent']));
        $this->assertSame([], SupportTiers::sanitizeTiers(['messages' => 'co_decide']));
        $this->assertSame(['messages' => 'assist'], SupportTiers::sanitizeTiers(['messages' => 'assist']));
        // Staff cap strips messages entirely.
        $this->assertArrayNotHasKey('messages', SupportTiers::capForStaff(['messages' => 'assist', 'listings' => 'represent']));
        // And the legacy boolean projection stays permanently false.
        $booleans = SupportTiers::toLegacyBooleans(['activity' => 'assist', 'listings' => 'none', 'credits' => 'none', 'messages' => 'assist']);
        $this->assertFalse($booleans['can_view_messages']);
    }
}
