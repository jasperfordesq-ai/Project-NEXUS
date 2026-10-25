<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\GroupAuditService;
use App\Services\GroupService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\CursorSigner;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Tests\Laravel\TestCase;

class GroupServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_getAll_is_tenant_scoped_and_respects_viewer_visibility(): void
    {
        Queue::fake();

        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $secondActiveMember = User::factory()->forTenant($this->testTenantId)->create();
        $pendingMember = User::factory()->forTenant($this->testTenantId)->create();
        $crossTenantOwner = User::factory()->forTenant(999)->create();
        TenantContext::setById($this->testTenantId);

        $marker = 'group-service-get-all-' . $viewer->id;
        $insertGroup = static function (
            int $tenantId,
            int $ownerId,
            string $name,
            string $visibility,
            ?int $parentId = null,
        ): int {
            return (int) DB::table('groups')->insertGetId([
                'tenant_id' => $tenantId,
                'owner_id' => $ownerId,
                'name' => $name,
                'description' => 'Deterministic GroupService::getAll fixture',
                'visibility' => $visibility,
                'parent_id' => $parentId,
                'is_featured' => 0,
                'cached_member_count' => 99,
                'status' => 'active',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        };

        $publicGroupId = $insertGroup(
            $this->testTenantId,
            (int) $owner->id,
            $marker . '-public',
            'public',
        );
        $ownedPrivateGroupId = $insertGroup(
            $this->testTenantId,
            (int) $viewer->id,
            $marker . '-owned-private',
            'private',
        );
        $memberPrivateGroupId = $insertGroup(
            $this->testTenantId,
            (int) $owner->id,
            $marker . '-member-private',
            'private',
        );
        $hiddenPrivateGroupId = $insertGroup(
            $this->testTenantId,
            (int) $owner->id,
            $marker . '-hidden-private',
            'private',
        );
        $childGroupId = $insertGroup(
            $this->testTenantId,
            (int) $owner->id,
            $marker . '-child',
            'public',
            $publicGroupId,
        );
        $crossTenantGroupId = $insertGroup(
            999,
            (int) $crossTenantOwner->id,
            $marker . '-cross-tenant-canary',
            'public',
        );

        DB::table('group_members')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $memberPrivateGroupId,
                'user_id' => $viewer->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $memberPrivateGroupId,
                'user_id' => $secondActiveMember->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $memberPrivateGroupId,
                'user_id' => $pendingMember->id,
                'role' => 'member',
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $anonymousResult = GroupService::getAll([
            'search' => $marker,
            'limit' => 100,
        ]);
        $anonymousIds = array_column($anonymousResult['items'], 'id');

        $this->assertContains($publicGroupId, $anonymousIds);
        $this->assertNotContains($ownedPrivateGroupId, $anonymousIds);
        $this->assertNotContains($memberPrivateGroupId, $anonymousIds);
        $this->assertNotContains($hiddenPrivateGroupId, $anonymousIds);
        $this->assertNotContains($childGroupId, $anonymousIds);
        $this->assertNotContains($crossTenantGroupId, $anonymousIds);

        $viewerResult = GroupService::getAll([
            'viewer_user_id' => (int) $viewer->id,
            'search' => $marker,
            'limit' => 100,
        ]);
        $viewerItems = collect($viewerResult['items'])->keyBy('id');

        $this->assertTrue($viewerItems->has($publicGroupId));
        $this->assertTrue($viewerItems->has($ownedPrivateGroupId));
        $this->assertTrue($viewerItems->has($memberPrivateGroupId));
        $this->assertFalse($viewerItems->has($hiddenPrivateGroupId));
        $this->assertFalse($viewerItems->has($childGroupId));
        $this->assertFalse($viewerItems->has($crossTenantGroupId));
        $this->assertSame(2, $viewerItems->get($memberPrivateGroupId)['member_count']);
        $this->assertFalse($viewerResult['has_more']);
        $this->assertNull($viewerResult['cursor']);
    }

    public function test_join_safeguarding_denial_writes_no_membership(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $joining = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Safeguarding cohort test',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $owner->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceContactAllowed')
            ->once()
            ->with((int) $joining->id, (int) $owner->id, $this->testTenantId, 'group_join')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            GroupService::join($groupId, (int) $joining->id);
            $this->fail('Expected safeguarding denial');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('group_members', [
            'group_id' => $groupId,
            'user_id' => $joining->id,
        ]);
    }

    public function test_member_cursor_is_signed_group_bound_and_does_not_skip_tied_roles(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $members = User::factory()->count(5)->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Composite cursor member roster',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherGroupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Cursor replay canary',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $expectedUserIds = [(int) $owner->id];
        $rows = [[
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $owner->id,
            'role' => 'owner',
            'status' => 'active',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]];
        foreach ($members as $member) {
            $expectedUserIds[] = (int) $member->id;
            $rows[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $member->id,
                'role' => 'member',
                'status' => 'active',
                'joined_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('group_members')->insert($rows);

        $seen = [];
        $cursor = null;
        $firstCursor = null;
        do {
            $page = GroupService::getMembers($groupId, [
                'viewer_user_id' => (int) $owner->id,
                'limit' => 2,
                'cursor' => $cursor,
            ]);
            $this->assertNotNull($page);
            array_push($seen, ...array_map('intval', array_column($page['items'], 'id')));
            $cursor = $page['cursor'];
            $firstCursor ??= $cursor;
        } while ($cursor !== null);

        $this->assertSame($expectedUserIds, $seen);
        $this->assertSame($seen, array_values(array_unique($seen)));
        $this->assertNotNull($firstCursor);
        $payload = CursorSigner::decode($firstCursor);
        $this->assertSame('group_members', $payload['kind'] ?? null);
        $this->assertSame($groupId, $payload['group_id'] ?? null);
        $this->assertArrayHasKey('role_rank', $payload);
        $this->assertArrayHasKey('membership_id', $payload);
        $this->assertSame('', $payload['q'] ?? null);

        $this->assertNull(GroupService::getMembers($groupId, ['cursor' => 'tampered']));
        $this->assertSame('INVALID_CURSOR', GroupService::getErrors()[0]['code']);

        $this->assertNull(GroupService::getMembers($otherGroupId, ['cursor' => $firstCursor]));
        $this->assertSame('INVALID_CURSOR', GroupService::getErrors()[0]['code']);
    }

    public function test_member_search_reaches_later_rows_and_binds_normalized_query_to_cursor(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Searchable roster',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $targetId = 0;
        $memberships = [];
        for ($index = 0; $index < 25; ++$index) {
            $member = User::factory()->forTenant($this->testTenantId)->create([
                'first_name' => 'Roster' . $index,
                'last_name' => $index === 24 ? 'Needle' : 'Member' . $index,
            ]);
            if ($index === 24) {
                $targetId = (int) $member->id;
            }
            $memberships[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $member->id,
                'role' => 'member',
                'status' => 'active',
                'joined_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('group_members')->insert($memberships);

        $this->assertSame(
            [$targetId],
            DB::table('group_members')
                ->join('users', 'group_members.user_id', '=', 'users.id')
                ->where('group_members.group_id', $groupId)
                ->where('group_members.tenant_id', $this->testTenantId)
                ->whereRaw("LOWER(CONCAT_WS(' ', users.first_name, users.last_name)) LIKE ?", ['%roster24 needle%'])
                ->pluck('group_members.user_id')
                ->map(static fn ($id): int => (int) $id)
                ->all(),
        );

        $result = GroupService::getMembers($groupId, [
            'viewer_user_id' => (int) $owner->id,
            'limit' => 20,
            'q' => '  ROSTER24   NEEDLE ',
        ]);
        $this->assertNotNull($result);
        $this->assertSame([$targetId], array_map('intval', array_column($result['items'], 'id')));

        $firstPage = GroupService::getMembers($groupId, [
            'viewer_user_id' => (int) $owner->id,
            'limit' => 5,
            'q' => ' ROSTER ',
        ]);
        $this->assertNotNull($firstPage);
        $this->assertNotNull($firstPage['cursor']);
        $cursorPayload = CursorSigner::decode($firstPage['cursor']);
        $this->assertSame('roster', $cursorPayload['q'] ?? null);

        $this->assertNull(GroupService::getMembers($groupId, [
            'viewer_user_id' => (int) $owner->id,
            'limit' => 5,
            'q' => 'needle',
            'cursor' => $firstPage['cursor'],
        ]));
        $this->assertSame('INVALID_CURSOR', GroupService::getErrors()[0]['code']);

        $this->assertNull(GroupService::getMembers($groupId, ['q' => str_repeat('x', 101)]));
        $this->assertSame('VALIDATION_ERROR', GroupService::getErrors()[0]['code']);
    }

    public function test_brand_colors_validate_persist_reload_and_clear_atomically(): void
    {
        Event::fake();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Brand color contract',
            'description' => 'A group with persisted appearance settings.',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertTrue(GroupService::update($groupId, (int) $owner->id, [
            'primary_color' => '#12abef',
            'accent_color' => '#A1B2C3',
        ]));
        $reloaded = GroupService::getById($groupId, (int) $owner->id);
        $this->assertSame('#12ABEF', $reloaded['primary_color'] ?? null);
        $this->assertSame('#A1B2C3', $reloaded['accent_color'] ?? null);

        $this->assertFalse(GroupService::update($groupId, (int) $owner->id, [
            'primary_color' => 'red',
            'accent_color' => '#000000',
        ]));
        $this->assertSame('primary_color', GroupService::getErrors()[0]['field'] ?? null);
        $this->assertDatabaseHas('groups', [
            'id' => $groupId,
            'primary_color' => '#12ABEF',
            'accent_color' => '#A1B2C3',
        ]);

        $this->assertTrue(GroupService::update($groupId, (int) $owner->id, [
            'primary_color' => '',
            'accent_color' => null,
        ]));
        $this->assertDatabaseHas('groups', [
            'id' => $groupId,
            'primary_color' => null,
            'accent_color' => null,
        ]);
    }

    public function test_admin_promotion_email_localizes_the_role_label_for_the_recipient(): void
    {
        Queue::fake();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'group-promotion-locale-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'de',
        ]);
        TenantContext::setById($this->testTenantId);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Localized promotion group',
            'description' => 'Promotion locale regression fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $owner->id,
                'role' => 'owner',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $member->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $mailer = new class extends EmailDispatchService {
            /** @var list<array{subject: string, body: string}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = ['subject' => $subject, 'body' => $body];

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        self::assertTrue(GroupService::updateMemberRole(
            $groupId,
            (int) $member->id,
            (int) $owner->id,
            'admin',
        ));
        self::assertCount(1, $mailer->calls);
        $rendered = html_entity_decode(
            $mailer->calls[0]['subject'] . ' ' . $mailer->calls[0]['body'],
            ENT_QUOTES | ENT_HTML5,
            'UTF-8',
        );
        self::assertStringContainsString('Administrator', $rendered);
        self::assertStringNotContainsString('>Admin<', $rendered);

        $roleAudit = DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', GroupAuditService::ACTION_MEMBER_ROLE_CHANGED)
            ->sole();
        $roleDetails = json_decode((string) $roleAudit->details, true, flags: JSON_THROW_ON_ERROR);
        self::assertSame((int) $owner->id, (int) $roleAudit->user_id);
        self::assertSame((int) $member->id, $roleDetails['target_user_id']);
        self::assertSame('member', $roleDetails['old_role']);
        self::assertSame('admin', $roleDetails['new_role']);

        self::assertTrue(GroupService::removeMember($groupId, (int) $member->id, (int) $owner->id));
        $this->assertDatabaseMissing('group_members', ['group_id' => $groupId, 'user_id' => $member->id]);
        $removalAudit = DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', GroupAuditService::ACTION_MEMBER_REMOVED)
            ->sole();
        $removalDetails = json_decode((string) $removalAudit->details, true, flags: JSON_THROW_ON_ERROR);
        self::assertSame((int) $owner->id, (int) $removalAudit->user_id);
        self::assertSame((int) $member->id, $removalDetails['target_user_id']);
        self::assertSame('admin', $removalDetails['old_role']);
        self::assertSame(0, DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', GroupAuditService::ACTION_MEMBER_LEFT)
            ->count());
    }
}
