<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SubAccountService;
use App\Services\MemberActivityService;
use App\Services\SafeguardingInteractionPolicy;
use App\Models\AccountRelationship;
use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Mockery;

class SubAccountServiceTest extends TestCase
{
    private SubAccountService $service;
    private $mockRelationship;
    private $mockActivity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockRelationship = Mockery::mock(AccountRelationship::class);
        $this->mockActivity = Mockery::mock(MemberActivityService::class);
        $this->service = new SubAccountService($this->mockRelationship, $this->mockActivity);
    }

    // ── constants ──

    public function test_relationship_types_constant(): void
    {
        $this->assertEquals(['family', 'guardian', 'carer', 'organization'], SubAccountService::RELATIONSHIP_TYPES);
    }

    public function test_default_permissions_constant(): void
    {
        $perms = SubAccountService::DEFAULT_PERMISSIONS;
        $this->assertTrue($perms['can_view_activity']);
        $this->assertFalse($perms['can_manage_listings']);
        $this->assertFalse($perms['can_transact']);
        $this->assertFalse($perms['can_view_messages']);
    }

    // ── requestRelationship ──

    public function test_requestRelationship_rejects_self(): void
    {
        $result = $this->service->requestRelationship(1, 1);
        $this->assertNull($result);
        $this->assertEquals('SELF_RELATIONSHIP', $this->service->getErrors()[0]['code']);
    }

    public function test_requestRelationship_rejects_invalid_type(): void
    {
        $result = $this->service->requestRelationship(1, 2, 'invalid');
        $this->assertNull($result);
        $this->assertEquals('INVALID_TYPE', $this->service->getErrors()[0]['code']);
    }

    public function test_requestRelationship_fails_when_user_not_found(): void
    {
        // User::query()->where('id', X)->first() returns null
        $result = $this->service->requestRelationship(9999, 9998, 'family');
        $this->assertNull($result);
    }

    // ── approve ──

    public function test_approve_returns_false_when_not_found(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturnNull();
        $this->mockRelationship->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->approve(999, 1);
        $this->assertFalse($result);
    }

    // ── revoke ──

    public function test_revoke_returns_false_when_not_found(): void
    {
        // revoke() now fetches the row first (the immutable event trail needs
        // the parties), so a missing row returns false before any update.
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturnNull();
        $this->mockRelationship->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->revoke(999, 1);
        $this->assertFalse($result);
    }

    // ── hasPermission ──

    public function test_hasPermission_returns_false_when_no_relationship(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturnNull();
        $this->mockRelationship->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->hasPermission(1, 2, 'can_view_activity');
        $this->assertFalse($result);
    }

    // ── updatePermissions ──

    public function test_updatePermissions_fails_when_not_found(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturnNull();
        $this->mockRelationship->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->updatePermissions(1, 999, ['can_transact' => true]);
        $this->assertFalse($result);
        $this->assertEquals('NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    // ── getChildActivitySummary ──

    public function test_getChildActivitySummary_returns_null_without_permission(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturnNull();
        $this->mockRelationship->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->getChildActivitySummary(1, 2);
        $this->assertNull($result);
    }

    // ── getErrors ──

    public function test_getErrors_initially_empty(): void
    {
        $this->assertEquals([], $this->service->getErrors());
    }

    // ── three-tier wiring (guardian redesign, phase 2) ──
    //
    // hasPermission/updatePermissions now translate the legacy boolean keys
    // through SupportTiers. These tests pin the wiring itself; the tier
    // arithmetic is pinned in Tests\Laravel\Unit\Support\SupportTiersTest.

    /** Query mock whose ->where(...)->first() chain returns $row. */
    private function mockQueryReturning(mixed $row): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturn($row);
        $this->mockRelationship->shouldReceive('newQuery')->andReturn($mockQuery);
    }

    /**
     * A relationship row with real Eloquent attribute/cast behaviour and a
     * capturing update() — Mockery partial mocks of Eloquent models break on
     * the framework's static calls (isIgnoringTimestamps), so this is a real
     * instance that never touches the database.
     */
    private function relationshipRow(array $permissions): AccountRelationship
    {
        $row = new class extends AccountRelationship {
            /** @var array<string, mixed>|null */
            public ?array $updatedWith = null;

            public function update(array $attributes = [], array $options = [])
            {
                $this->updatedWith = $attributes;

                return true;
            }
        };
        $row->permissions = $permissions;
        $row->child_user_id = 2;

        return $row;
    }

    public function test_hasPermission_legacy_boolean_rows_grant_exactly_what_they_always_did(): void
    {
        $this->mockQueryReturning($this->relationshipRow([
            'can_view_activity' => true,
            'can_manage_listings' => true,
            'can_transact' => false,
        ]));

        $this->assertTrue($this->service->hasPermission(1, 2, 'can_view_activity'));
        $this->assertTrue($this->service->hasPermission(1, 2, 'can_manage_listings'));
        $this->assertFalse($this->service->hasPermission(1, 2, 'can_transact'));
    }

    public function test_hasPermission_view_messages_is_false_even_when_an_old_row_stored_it_true(): void
    {
        // can_view_messages never had a caller and confers no capability at
        // any tier. A historical row that stored it must not start granting it.
        $this->mockQueryReturning($this->relationshipRow(['can_view_messages' => true]));

        $this->assertFalse($this->service->hasPermission(1, 2, 'can_view_messages'));
    }

    public function test_hasPermission_co_decide_never_authorizes_acting_alone(): void
    {
        // co_decide = prepare, the supported member confirms. The boolean keys
        // gate immediate actions, so co_decide must NOT satisfy listings or
        // credits — but activity only needs assist, which co_decide exceeds.
        $this->mockQueryReturning($this->relationshipRow([
            'tiers' => [
                'activity' => SupportTiers::CO_DECIDE,
                'listings' => SupportTiers::CO_DECIDE,
                'credits' => SupportTiers::CO_DECIDE,
            ],
        ]));

        $this->assertFalse($this->service->hasPermission(1, 2, 'can_manage_listings'));
        $this->assertFalse($this->service->hasPermission(1, 2, 'can_transact'));
        $this->assertTrue($this->service->hasPermission(1, 2, 'can_view_activity'));
    }

    public function test_resolvedTiers_distinguishes_no_relationship_from_nothing_granted(): void
    {
        $this->mockQueryReturning(null);

        $this->assertNull($this->service->resolvedTiers(1, 2));
    }

    public function test_updatePermissions_shrink_writes_canonical_shape_without_policy_recheck(): void
    {
        // Revoking must stay a safe unilateral exit: no safeguarding re-check
        // on the way DOWN, and the write carries both representations in sync.
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->never();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $row = $this->relationshipRow([
            'can_view_activity' => true,
            'can_manage_listings' => true,
        ]);
        $this->mockQueryReturning($row);

        $this->assertTrue($this->service->updatePermissions(1, 10, ['can_manage_listings' => false]));

        $p = $row->updatedWith['permissions'] ?? null;
        $this->assertIsArray($p);
        $this->assertTrue($p['can_view_activity']);
        $this->assertFalse($p['can_manage_listings']);
        $this->assertFalse($p['can_transact']);
        $this->assertFalse($p['can_view_messages']);
        $this->assertSame([
            'activity' => SupportTiers::ASSIST,
            'listings' => SupportTiers::NONE,
            'credits' => SupportTiers::NONE,
        ], $p['tiers']);
    }

    public function test_updatePermissions_resending_an_unchanged_boolean_does_not_coarsen_a_tier(): void
    {
        // A stored co_decide grant projects to can_manage_listings=false. A
        // client re-sending that same false must be a no-op on the tier, not a
        // downgrade to none — booleans only apply when they CHANGE something.
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->never();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $row = $this->relationshipRow([
            'can_manage_listings' => false,
            'tiers' => ['listings' => SupportTiers::CO_DECIDE],
        ]);
        $this->mockQueryReturning($row);

        $this->assertTrue($this->service->updatePermissions(1, 10, ['can_manage_listings' => false]));

        $this->assertSame(
            SupportTiers::CO_DECIDE,
            $row->updatedWith['permissions']['tiers']['listings'] ?? null,
        );
    }

    public function test_updatePermissions_raising_a_tier_reasserts_the_contact_policy_both_ways(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->twice();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $row = $this->relationshipRow(SubAccountService::DEFAULT_PERMISSIONS);
        $this->mockQueryReturning($row);

        $this->assertTrue($this->service->updatePermissions(1, 10, [
            'tiers' => ['credits' => SupportTiers::CO_DECIDE],
        ]));

        // co_decide on credits is stored as the tier, but projects to
        // can_transact=false — a co-decider may not act alone.
        $p = $row->updatedWith['permissions'] ?? null;
        $this->assertIsArray($p);
        $this->assertSame(SupportTiers::CO_DECIDE, $p['tiers']['credits']);
        $this->assertFalse($p['can_transact']);
    }
}
