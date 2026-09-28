<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\SubAccountService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-239 (E-055 B-2 / E-1, fixed in E-057): GET /v2/users/{id}/activity/dashboard
 * built its timeline from feed_posts / comments / event_rsvps / connections
 * filtered only by author, so any member of the community read another
 * member's secret-group posts, scheduled and moderator-hidden posts, comments
 * on posts they cannot open, secret-group event titles and connections' full
 * surnames — and the route ignored "profile visible to connections only" and
 * blocks.
 *
 * Safe behaviour: another viewer gets the same profile gate as GET /v2/users/{id},
 * and every timeline entry passes the read rule of the item it describes for
 * THAT viewer. The member themselves keeps the full view.
 */
class F239MemberActivityDashboardVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    private User $author;
    private User $outsider;
    private User $insider;
    private int $groupId;
    private string $tag;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);

        $this->tag = 'F239' . substr(md5(uniqid('', true)), 0, 10);
        $this->author = $this->makeUser();
        $this->outsider = $this->makeUser();
        $this->insider = $this->makeUser();

        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->author->id,
            'name' => 'Secret group ' . $this->tag,
            'description' => 'synthetic',
            'visibility' => 'secret',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        foreach ([$this->author->id, $this->insider->id] as $uid) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $this->groupId,
                'user_id' => $uid,
                'status' => 'active',
                'role' => $uid === $this->author->id ? 'owner' : 'member',
                'created_at' => now(),
            ]);
        }
    }

    private function makeUser(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function makePost(array $overrides): int
    {
        return (int) DB::table('feed_posts')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->author->id,
            'content' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
        ], $overrides));
    }

    private function dashboardAs(User $viewer, ?User $owner = null): string
    {
        Sanctum::actingAs($viewer, ['*']);
        $owner ??= $this->author;

        return (string) json_encode(
            $this->apiGet("/v2/users/{$owner->id}/activity/dashboard")->assertOk()->json('data.timeline')
        );
    }

    public function test_secret_group_post_is_shown_only_to_group_members_and_the_author(): void
    {
        $marker = 'GroupPostBody' . $this->tag;
        $this->makePost(['group_id' => $this->groupId, 'content' => $marker]);
        $public = 'PublicPostBody' . $this->tag;
        $this->makePost(['content' => $public]);

        $outsiderView = $this->dashboardAs($this->outsider);
        $this->assertStringNotContainsString($marker, $outsiderView);
        $this->assertStringContainsString($public, $outsiderView, 'ordinary public post still shown');

        $this->assertStringContainsString($marker, $this->dashboardAs($this->insider), 'group member sees the group post');
        $this->assertStringContainsString($marker, $this->dashboardAs($this->author), 'author sees own full timeline');
    }

    public function test_scheduled_and_hidden_posts_are_not_shown_to_other_members(): void
    {
        $scheduled = 'ScheduledBody' . $this->tag;
        $hidden = 'AdminHiddenBody' . $this->tag;
        $normal = 'NormalBody' . $this->tag;
        $this->makePost(['content' => $scheduled, 'publish_status' => 'scheduled', 'scheduled_at' => now()->addWeek()]);
        $this->makePost(['content' => $hidden, 'is_hidden' => 1]);
        $this->makePost(['content' => $normal]);

        $body = $this->dashboardAs($this->outsider);
        $this->assertStringNotContainsString($scheduled, $body);
        $this->assertStringNotContainsString($hidden, $body);
        $this->assertStringContainsString($normal, $body);
    }

    public function test_comment_is_shown_only_where_the_viewer_can_open_the_parent(): void
    {
        $groupPost = $this->makePost(['group_id' => $this->groupId, 'content' => 'x']);
        $publicPost = $this->makePost(['content' => 'y']);
        $secret = 'GroupCommentBody' . $this->tag;
        $open = 'PublicCommentBody' . $this->tag;
        foreach ([[$groupPost, $secret], [$publicPost, $open]] as [$postId, $content]) {
            DB::table('comments')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $this->author->id,
                'target_type' => 'post',
                'target_id' => $postId,
                'content' => $content,
                'created_at' => now(),
            ]);
        }

        $outsiderView = $this->dashboardAs($this->outsider);
        $this->assertStringNotContainsString($secret, $outsiderView);
        $this->assertStringContainsString($open, $outsiderView);

        $this->assertStringContainsString($secret, $this->dashboardAs($this->insider));
    }

    public function test_connection_is_named_without_surname_for_other_members(): void
    {
        $first = 'Friendfirst' . $this->tag;
        $surname = 'Surname' . $this->tag;
        $friend = $this->makeUser(['first_name' => $first, 'last_name' => $surname]);
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $this->author->id,
            'receiver_id' => $friend->id,
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $outsiderView = $this->dashboardAs($this->outsider);
        $this->assertStringNotContainsString($surname, $outsiderView);
        $this->assertStringContainsString($first, $outsiderView, 'the connection is still listed by first name');

        $this->assertStringContainsString($surname, $this->dashboardAs($this->author), 'the member sees their own connection in full');
    }

    public function test_rsvp_is_shown_only_for_events_the_viewer_can_open(): void
    {
        $title = 'SecretEventTitle' . $this->tag;
        $openTitle = 'OpenEventTitle' . $this->tag;
        foreach ([[$this->groupId, $title], [null, $openTitle]] as [$groupId, $eventTitle]) {
            $eventId = (int) DB::table('events')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'user_id' => $this->author->id,
                'group_id' => $groupId,
                'title' => $eventTitle,
                'description' => 'synthetic',
                'start_time' => now()->addDays(3),
                'end_time' => now()->addDays(3)->addHour(),
                'status' => 'active',
                'publication_status' => 'published',
                'created_at' => now(),
            ]);
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $this->author->id,
                'status' => 'going',
                'created_at' => now(),
            ]);
        }

        $outsiderView = $this->dashboardAs($this->outsider);
        $this->assertStringNotContainsString($title, $outsiderView);
        $this->assertStringContainsString($openTitle, $outsiderView);

        $this->assertStringContainsString($title, $this->dashboardAs($this->insider));
    }

    public function test_connections_only_profile_is_refused_like_the_profile_route(): void
    {
        $private = $this->makeUser(['privacy_profile' => 'connections']);
        $this->makePost(['user_id' => $private->id, 'content' => 'PrivateMemberPost' . $this->tag]);

        Sanctum::actingAs($this->outsider, ['*']);
        $this->apiGet("/v2/users/{$private->id}/activity/dashboard")
            ->assertNotFound()
            ->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');

        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $private->id,
            'receiver_id' => $this->insider->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
        $this->assertStringContainsString('PrivateMemberPost' . $this->tag, $this->dashboardAs($this->insider, $private));
        $this->assertStringContainsString('PrivateMemberPost' . $this->tag, $this->dashboardAs($private, $private));
    }

    public function test_block_in_either_direction_is_refused_like_the_profile_route(): void
    {
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->author->id,
            'blocked_user_id' => $this->outsider->id,
            'created_at' => now(),
        ]);

        // Blocked viewer, and the blocker looking back at the blocked member.
        Sanctum::actingAs($this->outsider, ['*']);
        $this->apiGet("/v2/users/{$this->author->id}")->assertForbidden();
        $this->apiGet("/v2/users/{$this->author->id}/activity/dashboard")->assertForbidden();
        Sanctum::actingAs($this->author, ['*']);
        $this->apiGet("/v2/users/{$this->outsider->id}/activity/dashboard")->assertForbidden();

        // Unrelated member unaffected.
        $this->dashboardAs($this->insider);
    }

    public function test_supporter_view_of_supported_member_filters_third_party_private_content(): void
    {
        $supporter = $this->makeUser();
        DB::table('account_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $this->author->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['can_view_activity' => true]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
        ]);
        $marker = 'GroupPostBody' . $this->tag;
        $public = 'PublicPostBody' . $this->tag;
        $this->makePost(['group_id' => $this->groupId, 'content' => $marker]);
        $this->makePost(['content' => $public]);

        $summary = app(SubAccountService::class)->getChildActivitySummary($supporter->id, $this->author->id);
        $this->assertIsArray($summary);
        $timeline = (string) json_encode($summary['timeline']);
        $this->assertStringNotContainsString($marker, $timeline);
        $this->assertStringContainsString($public, $timeline);
    }
}
