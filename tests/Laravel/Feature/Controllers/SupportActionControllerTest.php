<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\SupportPendingAction;
use App\Support\Safeguarding\SupportTiers;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for the co_decide confirm loop (guardian redesign, phase 3):
 * a supporter PREPARES an action, the supported member CONFIRMS or DECLINES,
 * and only confirmation executes anything — through the member's own code
 * path, attributed to the supporter.
 */
class SupportActionControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function actingUser(array $attributes = []): User
    {
        // NB: extra attributes must go through the factory — User::update()
        // silently drops non-fillable columns like `balance`.
        $user = User::factory()->forTenant($this->testTenantId)->create($attributes + [
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function relationshipWithTiers(User $supporter, User $supported, array $tiers): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['tiers' => $tiers]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  Prepare
    // ------------------------------------------------------------------

    public function test_prepare_requires_auth(): void
    {
        $this->apiPost('/v2/users/me/support-actions', [
            'supported_user_id' => 1,
            'action_type' => 'credit_transfer',
            'payload' => ['amount' => 1],
        ])->assertStatus(401);
    }

    public function test_co_decide_supporter_can_prepare_but_not_act_directly(): void
    {
        $supporter = $this->actingUser();
        $supported = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);
        $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        // The direct act-alone route refuses a co-decider…
        $this->apiPost("/v2/users/me/sub-accounts/{$supported->id}/transfer", [
            'recipient' => $recipient->id,
            'amount' => 3.0,
        ])->assertStatus(403);
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));

        // …but preparing is allowed and creates a pending row that does NOTHING yet.
        $response = $this->apiPost('/v2/users/me/support-actions', [
            'supported_user_id' => $supported->id,
            'action_type' => 'credit_transfer',
            'payload' => ['recipient' => $recipient->id, 'amount' => 3.0, 'description' => 'Weekly shop'],
        ]);
        $response->assertStatus(200);
        $actionId = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $actionId);

        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('pending', $row->status);
        // The raw token must never be stored or returned to the supporter.
        $this->assertSame(64, strlen((string) $row->token_hash));
        $this->assertNull($response->json('data.token'));

        // Nothing moved.
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));

        // The supported member was told something awaits them (bell row exists).
        $this->assertDatabaseHas('notifications', ['user_id' => $supported->id]);
    }

    public function test_supporter_without_the_tier_cannot_prepare(): void
    {
        $supporter = $this->actingUser();
        $supported = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        // assist can see, not prepare.
        $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::ASSIST]);

        $this->apiPost('/v2/users/me/support-actions', [
            'supported_user_id' => $supported->id,
            'action_type' => 'credit_transfer',
            'payload' => ['recipient' => 1, 'amount' => 1.0],
        ])->assertStatus(403);

        $this->assertSame(0, DB::table('support_pending_actions')->count());
    }

    // ------------------------------------------------------------------
    //  Confirm (in-app) — the only thing that executes
    // ------------------------------------------------------------------

    public function test_supported_member_confirming_executes_with_attribution(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = $this->actingUser(['balance' => 10.0]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => $recipient->id, 'amount' => 3.0, 'description' => 'Groceries']),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm");
        $response->assertStatus(200);

        // Executed through the member's own wallet path, attributed to the supporter.
        $this->assertEquals(7.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $this->assertEquals(3.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $txn = DB::table('transactions')
            ->where('sender_id', $supported->id)
            ->where('receiver_id', $recipient->id)
            ->first();
        $this->assertNotNull($txn);
        $this->assertEquals($supporter->id, (int) $txn->acting_user_id);

        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('confirmed', $row->status);
        $this->assertSame('in_app', $row->confirmed_via);
        $this->assertNotNull($row->result_id);

        // Audited, and the supporter is told.
        $this->assertNotNull(DB::table('org_audit_log')->where('action', 'support_action_confirmed')->first());
        $this->assertDatabaseHas('notifications', ['user_id' => $supporter->id]);
    }

    public function test_only_the_supported_member_can_confirm(): void
    {
        $supporter = $this->actingUser(); // the SUPPORTER tries to self-confirm
        $supported = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => 1, 'amount' => 3.0]),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // The confirm route scopes to supported_user_id = the caller, so the
        // supporter confirming their own preparation must 422 and move nothing.
        $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm")->assertStatus(422);
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    // ------------------------------------------------------------------
    //  Decline — reason optional, never required
    // ------------------------------------------------------------------

    public function test_decline_without_a_reason_is_accepted_and_executes_nothing(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = $this->actingUser(['balance' => 10.0]);
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => 1, 'amount' => 3.0]),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPost("/v2/users/me/support-actions/{$actionId}/decline")->assertStatus(200);

        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('declined', $row->status);
        $this->assertNull($row->decline_reason);
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        // The supporter learns the answer.
        $this->assertDatabaseHas('notifications', ['user_id' => $supporter->id]);
    }

    // ------------------------------------------------------------------
    //  Token flow — GET must not confirm; POST is single-use
    // ------------------------------------------------------------------

    public function test_token_get_is_read_only_and_post_confirms_once(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        $token = bin2hex(random_bytes(32));
        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => $recipient->id, 'amount' => 3.0]),
            'status' => 'pending',
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Unauthenticated GET: shows what's waiting, changes NOTHING — a mail
        // scanner following the link cannot confirm.
        $show = $this->apiGet("/v2/support-actions/confirm/{$token}");
        $show->assertStatus(200);
        $this->assertSame('pending', $show->json('data.status'));
        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));

        // Unauthenticated POST confirms and executes.
        $this->apiPost("/v2/support-actions/confirm/{$token}")->assertStatus(200);
        $this->assertEquals(7.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('confirmed', $row->status);
        $this->assertSame('email_token', $row->confirmed_via);
        $this->assertNotNull($row->token_consumed_at);

        // Single-use: replaying the same token must fail and move nothing more.
        $this->apiPost("/v2/support-actions/confirm/{$token}")->assertStatus(422);
        $this->assertEquals(7.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
    }

    public function test_expired_action_cannot_be_confirmed(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = $this->actingUser(['balance' => 10.0]);
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => 1, 'amount' => 3.0]),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->subDay(),
            'created_at' => now()->subDays(15),
            'updated_at' => now()->subDays(15),
        ]);

        $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm")->assertStatus(422);
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    // ------------------------------------------------------------------
    //  Listing preparation executes through ListingService on confirm
    // ------------------------------------------------------------------

    public function test_prepared_listing_is_created_for_the_supported_member_on_confirm(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = $this->actingUser();
        DB::table('categories')->updateOrInsert(
            ['id' => 1],
            ['tenant_id' => $this->testTenantId, 'name' => 'General', 'slug' => 'general', 'type' => 'listing', 'updated_at' => now()],
        );
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['listings' => SupportTiers::CO_DECIDE]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'listing_create',
            'payload' => json_encode([
                'title' => 'Help with the weekly shop',
                'description' => 'Happy to collect groceries for neighbours on a Tuesday morning.',
                'type' => 'offer',
                'category_id' => 1,
                'hours_estimate' => 2,
            ]),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm")->assertStatus(200);

        $listing = DB::table('listings')->where('user_id', $supported->id)->first();
        $this->assertNotNull($listing);
        // The listing belongs to the supported member; the supporter is the actor.
        $this->assertEquals($supporter->id, (int) $listing->acting_user_id);
        $this->assertEquals(
            (int) $listing->id,
            (int) DB::table('support_pending_actions')->where('id', $actionId)->value('result_id'),
        );
    }

    // ------------------------------------------------------------------
    //  Index + cancel
    // ------------------------------------------------------------------

    public function test_supported_member_sees_their_pending_queue_and_count(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $supported = $this->actingUser();
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        DB::table('support_pending_actions')->insert([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => 1, 'amount' => 2.0]),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/users/me/support-actions');
        $response->assertStatus(200);
        $this->assertSame(1, $response->json('data.pending_count'));
        $this->assertCount(1, $response->json('data.actions'));
        // The raw payload is never dumped into the list — only a safe summary.
        $this->assertArrayNotHasKey('payload', $response->json('data.actions.0'));
        $this->assertEquals(2.0, $response->json('data.actions.0.payload_summary.amount'));
    }

    public function test_supporter_can_cancel_their_own_pending_action(): void
    {
        $supporter = $this->actingUser();
        $supported = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $relationshipId = $this->relationshipWithTiers($supporter, $supported, ['credits' => SupportTiers::CO_DECIDE]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => 1, 'amount' => 2.0]),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'test-token-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiDelete("/v2/users/me/support-actions/{$actionId}")->assertStatus(200);
        $this->assertSame('cancelled', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }
}
