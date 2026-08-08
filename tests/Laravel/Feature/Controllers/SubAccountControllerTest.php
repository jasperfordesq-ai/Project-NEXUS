<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\AuditLogService;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;
use Mockery;

/**
 * Feature tests for SubAccountController — parent/child sub-account management.
 */
class SubAccountControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/me/sub-accounts
    // ------------------------------------------------------------------

    public function test_get_children_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/sub-accounts');

        $response->assertStatus(401);
    }

    public function test_get_children_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/sub-accounts');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/me/parent-accounts
    // ------------------------------------------------------------------

    public function test_get_parents_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/parent-accounts');

        $response->assertStatus(401);
    }

    public function test_get_parents_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/parent-accounts');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/users/me/sub-accounts
    // ------------------------------------------------------------------

    public function test_request_relationship_requires_auth(): void
    {
        $response = $this->apiPost('/v2/users/me/sub-accounts', [
            'child_email' => 'child@example.com',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  PUT /v2/users/me/sub-accounts/{id}/approve
    // ------------------------------------------------------------------

    public function test_approve_requires_auth(): void
    {
        $response = $this->apiPut('/v2/users/me/sub-accounts/1/approve');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DELETE /v2/users/me/sub-accounts/{id}
    // ------------------------------------------------------------------

    public function test_revoke_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/users/me/sub-accounts/1');

        $response->assertStatus(401);
    }

    public function test_request_relationship_denial_writes_no_pending_permissions(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($parent->id, $child->id, $this->testTenantId, 'sub_account_request')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v2/users/me/sub-accounts', [
            'child_user_id' => $child->id,
            'relationship_type' => 'guardian',
            'permissions' => [
                'can_view_activity' => true,
                'can_view_messages' => true,
            ],
        ]);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('account_relationships', [
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parent->id,
            'child_user_id' => $child->id,
        ]);
    }

    public function test_request_relationship_allowed_checks_both_directions_and_keeps_requested_permissions(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($parent->id, $child->id, $this->testTenantId, 'sub_account_request');
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($child->id, $parent->id, $this->testTenantId, 'sub_account_request');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v2/users/me/sub-accounts', [
            'child_user_id' => $child->id,
            'relationship_type' => 'guardian',
            'permissions' => ['can_view_messages' => true, 'can_view_activity' => true],
        ]);

        $response->assertCreated();
        $relationship = DB::table('account_relationships')
            ->where('tenant_id', $this->testTenantId)
            ->where('parent_user_id', $parent->id)
            ->where('child_user_id', $child->id)
            ->first();
        $this->assertNotNull($relationship);
        $this->assertSame('pending', $relationship->status);
        $permissions = json_decode((string) $relationship->permissions, true);
        // 🔴 Reversed pin (2026-08-07): the create endpoint STRIPS the dead
        // boolean now — the stored value is the DEFAULT_PERMISSIONS false,
        // never the caller's true. It persisted verbatim for years — harmless
        // while nothing read it, but with a real consent-gated `messages`
        // capability, any stored `true` is a standing invitation for a future
        // bug to honour it. The requested REAL permission still travels.
        $this->assertFalse((bool) ($permissions['can_view_messages'] ?? false));
        $this->assertTrue((bool) ($permissions['can_view_activity'] ?? false));
    }

    public function test_approval_rechecks_stored_requested_permissions_and_denial_leaves_pending(): void
    {
        $child = $this->authenticatedUser();
        $parent = User::factory()->forTenant($this->testTenantId)->create();
        $permissions = [
            'can_view_activity' => true,
            'can_manage_listings' => false,
            'can_transact' => true,
            'can_view_messages' => true,
        ];
        $relationshipId = DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parent->id,
            'child_user_id' => $child->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode($permissions),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($parent->id, $child->id, $this->testTenantId, 'sub_account_approval')
            ->andThrow(new SafeguardingPolicyException('SAFEGUARDING_CONTACT_RESTRICTED', 'Contact restricted'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/approve");

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');
        $relationship = DB::table('account_relationships')->where('id', $relationshipId)->first();
        $this->assertSame('pending', $relationship->status);
        $this->assertNull($relationship->approved_at);
        $this->assertSame($permissions, json_decode((string) $relationship->permissions, true));
    }

    public function test_permission_expansion_denial_leaves_permissions_unchanged(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create();
        $permissions = [
            'can_view_activity' => true,
            'can_manage_listings' => false,
            'can_transact' => false,
            'can_view_messages' => false,
        ];
        $relationshipId = $this->createActiveRelationship($parent, $child, $permissions);

        // A supporter can no longer reach the safeguarding policy on this
        // endpoint at all: raising their own tier is refused outright, because
        // expansion belongs to the supported member. The policy must therefore
        // never be consulted — if it were, a passing check would let a
        // self-granted expansion through.
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        // can_transact is a REAL expansion (credits none -> represent). The
        // payload used to be can_view_messages, but under the tier model that
        // key grants nothing, so enabling it is no longer an expansion at all —
        // see test_enabling_view_messages_is_inert below.
        $response = $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['can_transact' => true],
        ]);

        $response->assertStatus(422)->assertJsonPath('errors.0.code', 'MEMBER_APPROVAL_REQUIRED');
        $this->assertSame($permissions, $this->relationshipPermissions($relationshipId));
    }

    /**
     * The 503-on-unavailable-policy guarantee that used to live on the
     * supporter endpoint above. Expansion moved to the supported member, so
     * this moved with it rather than being dropped: when the safeguarding
     * policy cannot be evaluated, the grant is refused and nothing is written.
     */
    public function test_member_permission_grant_is_refused_when_the_safeguarding_policy_is_unavailable(): void
    {
        $child = $this->authenticatedUser();
        $parent = User::factory()->forTenant($this->testTenantId)->create();
        $permissions = [
            'can_view_activity' => true,
            'can_manage_listings' => false,
            'can_transact' => false,
            'can_view_messages' => false,
        ];
        $relationshipId = $this->createActiveRelationship($parent, $child, $permissions);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($parent->id, $child->id, $this->testTenantId, 'sub_account_member_permission_grant')
            ->andThrow(new SafeguardingPolicyException('SAFEGUARDING_POLICY_UNAVAILABLE', 'Policy unavailable'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPut("/v2/users/me/parent-accounts/{$relationshipId}/permissions", [
            'tiers' => ['credits' => 'represent'],
        ]);

        $response->assertStatus(503)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertSame($permissions, $this->relationshipPermissions($relationshipId));
    }

    public function test_enabling_view_messages_is_inert(): void
    {
        // can_view_messages confers no capability at any tier. Requesting it
        // must not consult the contact policy (nothing is being expanded) and
        // must never be stored as true — a historical row that carried it is
        // normalised to false on the next write.
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create();
        $relationshipId = $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
            'can_manage_listings' => false,
            'can_transact' => false,
            'can_view_messages' => false,
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['can_view_messages' => true],
        ]);

        $response->assertStatus(200);
        $stored = $this->relationshipPermissions($relationshipId);
        $this->assertFalse($stored['can_view_messages']);
        // The other grants survive the write untouched.
        $this->assertTrue($stored['can_view_activity']);
        $this->assertFalse($stored['can_transact']);
    }

    public function test_permission_removal_remains_available_without_a_contact_gate(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create();
        $relationshipId = $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
            'can_manage_listings' => true,
            'can_transact' => true,
            'can_view_messages' => true,
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => [
                'can_manage_listings' => false,
                'can_transact' => false,
                'can_view_messages' => false,
            ],
        ]);

        $response->assertOk();
        $permissions = $this->relationshipPermissions($relationshipId);
        $this->assertFalse((bool) $permissions['can_manage_listings']);
        $this->assertFalse((bool) $permissions['can_transact']);
        $this->assertFalse((bool) $permissions['can_view_messages']);
    }

    public function test_revoke_remains_available_without_a_contact_gate(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create();
        $relationshipId = $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiDelete("/v2/users/me/sub-accounts/{$relationshipId}");

        $response->assertOk();
        $this->assertDatabaseHas('account_relationships', [
            'id' => $relationshipId,
            'status' => 'revoked',
        ]);
    }

    /** @param array<string, bool> $permissions */
    private function createActiveRelationship(User $parent, User $child, array $permissions): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parent->id,
            'child_user_id' => $child->id,
            'relationship_type' => 'family',
            'permissions' => json_encode($permissions),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  Acting on a dependent's behalf — can_manage_listings / can_transact
    //
    //  🔴 These are the first tests of these permissions doing anything at all.
    //  Both were offered as toggles in the UI, with labels promising exactly these
    //  abilities, while hasPermission() had a single caller in the whole codebase
    //  (for can_view_activity) and no endpoint existed through which the others
    //  could be checked. Families were told a carer had powers the carer lacked.
    // ------------------------------------------------------------------

    /**
     * Listing validation requires a category belonging to this tenant. The CI seed
     * pins category id=1 to tenant 1, so force it onto the test tenant — this runs
     * inside DatabaseTransactions and is rolled back per test. Mirrors the helper
     * in ListingsControllerTest.
     */
    private function ensureListingCategory(int $id = 1): int
    {
        DB::table('categories')->updateOrInsert(
            ['id' => $id],
            [
                'tenant_id' => $this->testTenantId,
                'name' => 'General',
                'slug' => 'general',
                'type' => 'listing',
                'updated_at' => now(),
            ]
        );

        return $id;
    }

    public function test_carer_with_permission_can_post_a_listing_for_the_dependent(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $categoryId = $this->ensureListingCategory();
        $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
            'can_manage_listings' => true,
        ]);

        $response = $this->apiPost("/v2/users/me/sub-accounts/{$child->id}/listings", [
            'title' => 'Help with the weekly shop',
            'description' => 'Happy to collect groceries for neighbours on a Tuesday morning.',
            'type' => 'offer',
            'category_id' => $categoryId,
            'hours_estimate' => 2,
        ]);

        $response->assertStatus(201);
        $listingId = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $listingId);

        $listing = DB::table('listings')->where('id', $listingId)->first();
        // The listing belongs to the DEPENDENT...
        $this->assertEquals($child->id, (int) $listing->user_id);
        // ...but the carer who actually posted it is recorded.
        $this->assertEquals($parent->id, (int) $listing->acting_user_id);

        // A proxy action must leave a durable record beyond the notification.
        $audit = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'subaccount_listing_created')
            ->where('target_user_id', $child->id)
            ->first();
        $this->assertNotNull($audit, 'Posting for a dependent must be audited.');
        $this->assertEquals($parent->id, (int) $audit->user_id);

        // And the dependent is told something was posted in their name.
        $this->assertDatabaseHas('notifications', ['user_id' => $child->id]);
    }

    public function test_carer_without_the_listing_permission_is_refused(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
            'can_manage_listings' => false,
        ]);

        $this->apiPost("/v2/users/me/sub-accounts/{$child->id}/listings", [
            'title' => 'Should never be created',
            'description' => 'This request must be refused because the permission is off.',
            'type' => 'offer',
        ])->assertStatus(403);

        $this->assertDatabaseMissing('listings', ['user_id' => $child->id]);
    }

    public function test_a_stranger_cannot_post_for_another_member(): void
    {
        // No relationship at all — the permission check must fail closed.
        $parent = $this->authenticatedUser();
        $stranger = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $this->apiPost("/v2/users/me/sub-accounts/{$stranger->id}/listings", [
            'title' => 'Not my account',
            'description' => 'There is no linked-account relationship between these two users.',
            'type' => 'offer',
        ])->assertStatus(403);

        $this->assertDatabaseMissing('listings', ['user_id' => $stranger->id]);
    }

    public function test_carer_with_permission_can_send_credits_from_the_dependents_balance(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);
        $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
            'can_transact' => true,
        ]);

        // The factory assigns a random starting balance, so capture the carer's own
        // balance and assert it is UNCHANGED rather than assuming it is zero.
        $parentBalanceBefore = (float) DB::table('users')->where('id', $parent->id)->value('balance');

        $response = $this->apiPost("/v2/users/me/sub-accounts/{$child->id}/transfer", [
            'recipient' => $recipient->id,
            'amount' => 3.0,
            'description' => 'Thanks for the lift',
        ]);

        $response->assertStatus(200);

        // The credits leave the DEPENDENT's balance, and the carer's is untouched.
        $this->assertEquals(7.0, (float) DB::table('users')->where('id', $child->id)->value('balance'));
        $this->assertEquals(3.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $this->assertEquals(
            $parentBalanceBefore,
            (float) DB::table('users')->where('id', $parent->id)->value('balance'),
            "A carer's own balance must never change when they act for a dependent."
        );

        // The ledger row names the dependent as sender and the carer as the actor.
        $txn = DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $child->id)
            ->where('receiver_id', $recipient->id)
            ->first();
        $this->assertNotNull($txn);
        $this->assertEquals($parent->id, (int) $txn->acting_user_id, 'A proxy debit must be attributable to the carer.');

        $audit = DB::table('org_audit_log')
            ->where('action', 'subaccount_transfer_sent')
            ->where('target_user_id', $child->id)
            ->first();
        $this->assertNotNull($audit, 'Spending a dependent\'s credits must be audited.');
    }

    public function test_carer_without_the_transact_permission_cannot_spend_the_dependents_credits(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);
        $this->createActiveRelationship($parent, $child, [
            'can_view_activity' => true,
            'can_transact' => false,
        ]);

        $this->apiPost("/v2/users/me/sub-accounts/{$child->id}/transfer", [
            'recipient' => $recipient->id,
            'amount' => 3.0,
        ])->assertStatus(403);

        // Nothing moved.
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $child->id)->value('balance'));
        $this->assertEquals(0.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
    }

    public function test_a_pending_relationship_grants_nothing(): void
    {
        // Approval by the dependent is what legitimises a carer acting for them, so
        // a relationship the dependent has not approved must confer no powers.
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);

        DB::table('account_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parent->id,
            'child_user_id' => $child->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['can_manage_listings' => true, 'can_transact' => true]),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPost("/v2/users/me/sub-accounts/{$child->id}/listings", [
            'title' => 'Pending relationship should not work',
            'description' => 'The dependent has not approved this relationship yet.',
            'type' => 'offer',
        ])->assertStatus(403);
    }

    // ------------------------------------------------------------------
    //  Boolean writes must never escalate a deliberate tier
    // ------------------------------------------------------------------

    private function seedActiveRelationshipWithTiers(int $parentId, int $childId, array $tiers): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parentId,
            'child_user_id' => $childId,
            'relationship_type' => 'family',
            'permissions' => json_encode([
                'can_view_activity' => ($tiers['activity'] ?? 'none') !== 'none',
                // toLegacyBooleans projection: co_decide → false. That lossy
                // projection is exactly what the escalation guard exists for.
                'can_manage_listings' => ($tiers['listings'] ?? 'none') === 'represent',
                'can_transact' => ($tiers['credits'] ?? 'none') === 'represent',
                'can_view_messages' => false,
                'tiers' => $tiers,
            ]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * 🔴 The live safety bug this pins: a boolean-only client (the mobile app,
     * any legacy caller) renders a co_decide grant as an OFF toggle, so members
     * "turning it on" re-posted `can_manage_listings: true` — which used to
     * replace prepare-only with full act-alone authority. Boolean true must
     * mean "on", never "maximum power": an existing deliberate level survives.
     */
    public function test_boolean_true_does_not_escalate_a_co_decide_grant(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $relationshipId = $this->seedActiveRelationshipWithTiers($parent->id, $child->id, [
            'activity' => 'assist', 'listings' => 'co_decide', 'credits' => 'none',
        ]);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['can_manage_listings' => true],
        ])->assertOk();

        $stored = $this->relationshipPermissions($relationshipId);
        $this->assertSame('co_decide', $stored['tiers']['listings'] ?? null, 'Boolean true silently escalated co_decide to represent.');
        $this->assertFalse((bool) ($stored['can_manage_listings'] ?? true), 'The legacy boolean projection of co_decide must stay false.');
    }

    public function test_boolean_false_still_switches_a_capability_off(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $relationshipId = $this->seedActiveRelationshipWithTiers($parent->id, $child->id, [
            'activity' => 'assist', 'listings' => 'represent', 'credits' => 'co_decide',
        ]);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['can_manage_listings' => false],
        ])->assertOk();

        $stored = $this->relationshipPermissions($relationshipId);
        $this->assertSame('none', $stored['tiers']['listings'] ?? null, 'Switching off must always be honoured.');
        // The untouched capability keeps its deliberate middle level.
        $this->assertSame('co_decide', $stored['tiers']['credits'] ?? null);
    }

    public function test_supporter_cannot_grant_themselves_a_tier_from_none(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $relationshipId = $this->seedActiveRelationshipWithTiers($parent->id, $child->id, [
            'activity' => 'assist', 'listings' => 'none', 'credits' => 'none',
        ]);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['can_transact' => true],
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'MEMBER_APPROVAL_REQUIRED');

        $stored = $this->relationshipPermissions($relationshipId);
        // From none, a legacy boolean client's "on" keeps its historical
        // meaning (represent) — there is no deliberate level to protect.
        $this->assertSame('none', $stored['tiers']['credits'] ?? null);
    }

    public function test_only_supported_member_can_expand_explicit_tiers(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $relationshipId = $this->seedActiveRelationshipWithTiers($parent->id, $child->id, [
            'activity' => 'assist', 'listings' => 'co_decide', 'credits' => 'none',
        ]);

        // The guard is for the lossy boolean shorthand only: a client speaking
        // the tier vocabulary states its level explicitly and is honoured.
        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['listings' => 'represent']],
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'MEMBER_APPROVAL_REQUIRED');

        Sanctum::actingAs($child, ['*']);
        $this->apiPut("/v2/users/me/parent-accounts/{$relationshipId}/permissions", [
            'tiers' => ['listings' => 'represent'],
        ])->assertOk();

        $stored = $this->relationshipPermissions($relationshipId);
        $this->assertSame('represent', $stored['tiers']['listings'] ?? null);
    }

    public function test_proxy_transfer_rolls_back_when_the_audit_record_cannot_be_written(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 10.0,
        ]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);
        $this->createActiveRelationship($parent, $child, ['can_transact' => true]);

        $audit = Mockery::mock(AuditLogService::class);
        $audit->shouldReceive('logAction')->once()->andThrow(new \RuntimeException('audit unavailable'));
        $this->app->instance(AuditLogService::class, $audit);

        $this->apiPost("/v2/users/me/sub-accounts/{$child->id}/transfer", [
            'recipient' => $recipient->id,
            'amount' => 3.0,
        ])->assertStatus(422);

        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $child->id)->value('balance'));
        $this->assertEquals(0.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $this->assertDatabaseMissing('transactions', ['sender_id' => $child->id, 'receiver_id' => $recipient->id]);
    }

    public function test_unrelated_member_cannot_change_linked_account_tiers(): void
    {
        $parent = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $relationshipId = $this->seedActiveRelationshipWithTiers($parent->id, $child->id, [
            'activity' => 'none', 'listings' => 'none', 'credits' => 'none',
        ]);
        $stranger = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($stranger, ['*']);

        $this->apiPut("/v2/users/me/parent-accounts/{$relationshipId}/permissions", [
            'tiers' => ['credits' => 'represent'],
        ])->assertStatus(404);
        $this->assertSame('none', $this->relationshipPermissions($relationshipId)['tiers']['credits']);
    }

    /** @return array<string, mixed> */
    private function relationshipPermissions(int $relationshipId): array
    {
        $permissions = DB::table('account_relationships')
            ->where('id', $relationshipId)
            ->value('permissions');

        return json_decode((string) $permissions, true) ?: [];
    }
}
