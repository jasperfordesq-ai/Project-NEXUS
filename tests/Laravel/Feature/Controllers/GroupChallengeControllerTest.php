<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupChallengeService;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupChallengeControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $member;
    private User $groupAdmin;
    private User $nonMember;
    private User $tenantAdmin;
    private User $foreignOwner;
    private int $activeGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::factory()->forTenant($this->testTenantId)->create();
        $this->member = User::factory()->forTenant($this->testTenantId)->create();
        $this->groupAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $this->nonMember = User::factory()->forTenant($this->testTenantId)->create();
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->foreignOwner = User::factory()->forTenant(999)->create();
        TenantContext::setById($this->testTenantId);

        $this->activeGroupId = $this->insertGroup('active', $this->testTenantId, (int) $this->owner->id);
        $this->archivedGroupId = $this->insertGroup('archived', $this->testTenantId, (int) $this->owner->id);
        $this->foreignGroupId = $this->insertGroup('active', 999, (int) $this->foreignOwner->id);
        $this->insertMembership($this->activeGroupId, (int) $this->member->id, 'member');
        $this->insertMembership($this->activeGroupId, (int) $this->groupAdmin->id, 'admin');

        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_CHALLENGES, true);
    }

    protected function tearDown(): void
    {
        Cache::forget('group_config:' . $this->testTenantId);
        parent::tearDown();
    }

    public function test_routes_require_authentication(): void
    {
        $this->apiGet("/v2/groups/{$this->activeGroupId}/challenges")->assertStatus(401);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", [])->assertStatus(401);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/1")->assertStatus(401);
    }

    public function test_member_can_list_stable_dtos_but_nonmember_and_archived_parent_cannot(): void
    {
        $challengeId = $this->insertChallenge($this->activeGroupId);
        $legacyEventsId = $this->insertChallenge($this->activeGroupId, 'events');

        Sanctum::actingAs($this->member, ['*']);
        $response = $this->apiGet("/v2/groups/{$this->activeGroupId}/challenges?all=1");
        $response->assertOk()
            ->assertJsonPath('data.0.id', $challengeId)
            ->assertJsonPath('data.0.group_id', $this->activeGroupId)
            ->assertJsonPath('data.0.metric', 'posts')
            ->assertJsonPath('data.0.current_value', 0)
            ->assertJsonPath('data.0.target_value', 5)
            ->assertJsonPath('data.0.reward_xp', 25)
            ->assertJsonPath('data.0.status', 'active')
            ->assertJsonPath('data.0.creator.id', (int) $this->owner->id);
        self::assertNotNull($response->json('data.0.starts_at'));
        self::assertNotNull($response->json('data.0.ends_at'));
        self::assertArrayNotHasKey('end_date', $response->json('data.0'));
        self::assertNotContains($legacyEventsId, array_column($response->json('data'), 'id'));

        Sanctum::actingAs($this->nonMember, ['*']);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/challenges")->assertStatus(403);

        Sanctum::actingAs($this->owner, ['*']);
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/challenges")->assertStatus(403);
    }

    public function test_cross_tenant_group_ids_are_concealed_before_admin_override(): void
    {
        $foreignChallengeId = $this->insertChallenge($this->foreignGroupId);
        Sanctum::actingAs($this->tenantAdmin, ['*']);

        $this->apiGet("/v2/groups/{$this->foreignGroupId}/challenges")
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_FOUND');
        $this->apiPost("/v2/groups/{$this->foreignGroupId}/challenges", $this->validPayload())
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_FOUND');
        $this->apiDelete("/v2/groups/{$this->foreignGroupId}/challenges/{$foreignChallengeId}")
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_FOUND');
    }

    public function test_only_group_managers_can_create_and_archived_groups_are_read_only(): void
    {
        foreach ([$this->nonMember, $this->member] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", $this->validPayload())
                ->assertStatus(403);
        }

        foreach ([$this->owner, $this->groupAdmin, $this->tenantAdmin] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", $this->validPayload())
                ->assertStatus(201);
        }

        Sanctum::actingAs($this->owner, ['*']);
        $this->apiPost("/v2/groups/{$this->archivedGroupId}/challenges", $this->validPayload())
            ->assertStatus(403);
    }

    public function test_frontend_form_payload_returns_canonical_dto_and_server_reward_band(): void
    {
        Sanctum::actingAs($this->owner, ['*']);
        $response = $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", [
            'title' => 'Write five helpful posts',
            'description' => 'Help the community by sharing five useful updates.',
            'metric' => 'posts',
            'target_value' => 5,
            'reward_xp' => 50,
            'ends_at' => now()->addWeek()->toDateString(),
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.group_id', $this->activeGroupId)
            ->assertJsonPath('data.title', 'Write five helpful posts')
            ->assertJsonPath('data.description', 'Help the community by sharing five useful updates.')
            ->assertJsonPath('data.metric', 'posts')
            ->assertJsonPath('data.target_value', 5)
            ->assertJsonPath('data.current_value', 0)
            ->assertJsonPath('data.reward_xp', 50)
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.creator.id', (int) $this->owner->id);
        self::assertNotNull($response->json('data.starts_at'));
        self::assertNotNull($response->json('data.ends_at'));
        self::assertArrayNotHasKey('end_date', $response->json('data'));
    }

    public function test_temporary_end_date_alias_is_accepted_and_reward_defaults_to_zero(): void
    {
        Sanctum::actingAs($this->owner, ['*']);
        $response = $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", [
            'title' => 'Welcome new members',
            'description' => 'Welcome several new members into the community.',
            'metric' => 'members',
            'target_value' => 5,
            'end_date' => now()->addWeek()->toDateString(),
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.reward_xp', 0)
            ->assertJsonPath('data.metric', 'members');
        self::assertNotNull($response->json('data.ends_at'));
    }

    public function test_create_replays_exact_mobile_request_and_conflicts_changed_intent(): void
    {
        Sanctum::actingAs($this->owner, ['*']);
        $payload = $this->validPayload();
        $headers = ['Idempotency-Key' => 'mobile-group-challenge-create-1'];

        $first = $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", $payload, $headers);
        $replay = $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", $payload, $headers);

        $first->assertCreated();
        $replay->assertCreated()
            ->assertJsonPath('data.id', $first->json('data.id'))
            ->assertJsonPath('data._idempotent_replay', true);
        self::assertSame(1, DB::table('group_challenges')
            ->where('group_id', $this->activeGroupId)
            ->where('title', $payload['title'])
            ->count());
        self::assertSame(1, DB::table('group_audit_log')
            ->where('group_id', $this->activeGroupId)
            ->where('action', 'challenge_created')
            ->count());

        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/challenges",
            [...$payload, 'target_value' => $payload['target_value'] + 1],
            $headers,
        )->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
    }

    public function test_invalid_values_return_translated_validation_errors_and_write_nothing(): void
    {
        Sanctum::actingAs($this->owner, ['*']);
        $valid = $this->validPayload();
        $cases = [
            'short title' => [['title' => 'ab'], 'title'],
            'long title' => [['title' => str_repeat('x', GroupChallengeService::TITLE_MAX + 1)], 'title'],
            'short description' => [['description' => 'short'], 'description'],
            'long description' => [['description' => str_repeat('x', GroupChallengeService::DESCRIPTION_MAX + 1)], 'description'],
            'events without hook' => [['metric' => 'events'], 'metric'],
            'unknown metric' => [['metric' => 'likes'], 'metric'],
            'zero target' => [['target_value' => 0], 'target_value'],
            'target above cap' => [['target_value' => GroupChallengeService::TARGET_MAX + 1], 'target_value'],
            'boolean target' => [['target_value' => true], 'target_value'],
            'fractional target' => [['target_value' => 1.5], 'target_value'],
            'arbitrary reward' => [['reward_xp' => 30], 'reward_xp'],
            'reward above cap' => [['reward_xp' => 1000], 'reward_xp'],
            'boolean reward' => [['reward_xp' => false], 'reward_xp'],
            'fractional reward' => [['reward_xp' => 25.5], 'reward_xp'],
            'arbitrary badge' => [['reward_badge' => 'invented'], 'reward_xp'],
            'past end' => [['ends_at' => now()->subDay()->toIso8601String()], 'ends_at'],
            'end before start' => [[
                'starts_at' => now()->addDays(2)->toIso8601String(),
                'ends_at' => now()->addDay()->toIso8601String(),
            ], 'ends_at'],
            'invalid date' => [['ends_at' => 'not-a-date'], 'ends_at'],
        ];
        $before = DB::table('group_challenges')->where('group_id', $this->activeGroupId)->count();

        foreach ($cases as $label => [$changes, $expectedField]) {
            $response = $this->apiPost(
                "/v2/groups/{$this->activeGroupId}/challenges",
                array_replace($valid, $changes),
            );
            $response->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
                ->assertJsonPath('errors.0.field', $expectedField);
            $message = $response->json('errors.0.message');
            self::assertIsString($message, $label);
            self::assertNotSame('', trim($message), $label);
            self::assertStringNotContainsString('api.', $message, $label);
        }

        self::assertSame($before, DB::table('group_challenges')->where('group_id', $this->activeGroupId)->count());
    }

    public function test_disabled_challenges_feature_rejects_reads_and_writes(): void
    {
        $challengeId = $this->insertChallenge($this->activeGroupId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_CHALLENGES, false);
        Sanctum::actingAs($this->owner, ['*']);

        $this->apiGet("/v2/groups/{$this->activeGroupId}/challenges")
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'GROUP_TAB_DISABLED');
        $this->apiPost("/v2/groups/{$this->activeGroupId}/challenges", $this->validPayload())
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'GROUP_TAB_DISABLED');
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/{$challengeId}")
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'GROUP_TAB_DISABLED');
        $this->assertDatabaseHas('group_challenges', ['id' => $challengeId]);
    }

    public function test_cancel_is_group_scoped_manager_only_and_idempotent(): void
    {
        $challengeId = $this->insertChallenge($this->activeGroupId);
        $archivedChallengeId = $this->insertChallenge($this->archivedGroupId);

        Sanctum::actingAs($this->nonMember, ['*']);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/{$challengeId}")
            ->assertStatus(403);

        Sanctum::actingAs($this->owner, ['*']);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/{$archivedChallengeId}")
            ->assertStatus(404);
        $this->assertDatabaseHas('group_challenges', ['id' => $archivedChallengeId]);
        $this->apiDelete("/v2/groups/{$this->archivedGroupId}/challenges/{$archivedChallengeId}")
            ->assertStatus(403);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/{$challengeId}")
            ->assertOk()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.challenge.id', $challengeId)
            ->assertJsonPath('data.challenge.status', 'cancelled');
        $this->assertDatabaseHas('group_challenges', ['id' => $challengeId, 'status' => 'cancelled']);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/{$challengeId}")
            ->assertOk()
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.challenge.status', 'cancelled');
        $this->apiGet("/v2/groups/{$this->activeGroupId}/challenges?all=1")
            ->assertOk()
            ->assertJsonFragment(['id' => $challengeId, 'status' => 'cancelled']);
        self::assertSame(1, DB::table('group_audit_log')
            ->where('group_id', $this->activeGroupId)
            ->where('action', 'challenge_cancelled')
            ->count());
    }

    public function test_completed_rewarded_challenge_returns_typed_conflict_without_mutation(): void
    {
        $challengeId = $this->insertChallenge($this->activeGroupId);
        DB::table('group_challenges')->where('id', $challengeId)->update(['target_value' => 1]);
        GroupChallengeService::incrementProgress($this->activeGroupId, 'posts');

        $ledgerCount = DB::table('group_challenge_rewards')->where('challenge_id', $challengeId)->count();
        $xpLogCount = DB::table('user_xp_log')
            ->where('source_reference', 'group_challenge:' . $challengeId)
            ->count();

        Sanctum::actingAs($this->owner, ['*']);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/challenges/{$challengeId}")
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', GroupChallengeService::ERROR_IMMUTABLE);

        $this->assertDatabaseHas('group_challenges', ['id' => $challengeId, 'status' => 'completed']);
        self::assertSame($ledgerCount, DB::table('group_challenge_rewards')->where('challenge_id', $challengeId)->count());
        self::assertSame($xpLogCount, DB::table('user_xp_log')
            ->where('source_reference', 'group_challenge:' . $challengeId)
            ->count());
        self::assertSame(0, DB::table('group_audit_log')
            ->where('group_id', $this->activeGroupId)
            ->where('action', 'challenge_cancelled')
            ->count());
    }

    /** @return array<string, mixed> */
    private function validPayload(): array
    {
        return [
            'title' => 'Create useful discussions',
            'description' => 'Start several constructive discussions for members.',
            'metric' => 'discussions',
            'target_value' => 5,
            'reward_xp' => 25,
            'ends_at' => now()->addWeek()->toIso8601String(),
        ];
    }

    private function insertGroup(string $status, int $tenantId, int $ownerId): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $ownerId,
            'name' => 'Group challenge controller ' . $status . ' ' . uniqid('', true),
            'description' => 'Group challenge controller fixture.',
            'visibility' => 'private',
            'status' => $status,
            'is_active' => $status === 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertMembership(int $groupId, int $userId, string $role): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertChallenge(int $groupId, string $metric = 'posts'): int
    {
        return (int) DB::table('group_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'created_by' => $this->owner->id,
            'title' => 'Existing challenge',
            'description' => 'Existing group challenge fixture.',
            'metric' => $metric,
            'target_value' => 5,
            'current_value' => 0,
            'reward_xp' => 25,
            'status' => 'active',
            'starts_at' => now()->subMinute(),
            'ends_at' => now()->addWeek(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
