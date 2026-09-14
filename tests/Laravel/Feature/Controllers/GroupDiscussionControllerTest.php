<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\User;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupDiscussionControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $nonMember;
    private User $pendingMember;
    private User $member;
    private User $groupAdmin;
    private User $foreignOwner;
    private int $activeGroupId;
    private int $otherGroupId;
    private int $dormantGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = $this->user();
        $this->nonMember = $this->user();
        $this->pendingMember = $this->user();
        $this->member = $this->user();
        $this->groupAdmin = $this->user();
        $this->foreignOwner = User::factory()->forTenant(999)->create();

        TenantContext::setById($this->testTenantId);
        $this->activeGroupId = $this->group(GroupStatus::Active, $this->owner);
        $this->otherGroupId = $this->group(GroupStatus::Active, $this->owner);
        $this->dormantGroupId = $this->group(GroupStatus::Dormant, $this->owner);
        $this->archivedGroupId = $this->group(GroupStatus::Archived, $this->owner);
        $this->foreignGroupId = $this->group(GroupStatus::Active, $this->foreignOwner, 999);

        foreach ([$this->activeGroupId, $this->otherGroupId, $this->dormantGroupId, $this->archivedGroupId] as $groupId) {
            $this->membership($groupId, $this->pendingMember, 'member', 'pending');
            $this->membership($groupId, $this->member);
            $this->membership($groupId, $this->groupAdmin, 'admin');
        }

        $this->enableDiscussionRoutes();
    }

    protected function tearDown(): void
    {
        Cache::forget('group_config:' . $this->testTenantId);
        parent::tearDown();
    }

    public function test_discussion_routes_require_authentication(): void
    {
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions")->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [])->assertUnauthorized();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions/1")->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions/1/messages", [])->assertUnauthorized();
    }

    public function test_root_is_rendered_once_and_never_counted_as_a_reply(): void
    {
        $this->authenticate($this->member);
        $created = $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            'title' => 'Root contract',
            'content' => 'The root body must appear exactly once.',
        ])->assertCreated();
        $discussionId = (int) $created->json('data.id');
        $rootId = (int) DB::table('group_posts')
            ->where('discussion_id', $discussionId)
            ->sole()
            ->id;

        self::assertSame(0, (int) $created->json('data.reply_count'));
        $initial = $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions/{$discussionId}")
            ->assertOk();
        self::assertSame('The root body must appear exactly once.', $initial->json('data.discussion.content'));
        self::assertSame(0, (int) $initial->json('data.discussion.reply_count'));
        self::assertSame([], $initial->json('data.messages'));
        self::assertNull($initial->json('data.discussion.last_reply_at'));

        $firstReply = $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/discussions/{$discussionId}/messages",
            ['content' => 'First reply'],
        )->assertCreated();
        $secondReply = $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/discussions/{$discussionId}/messages",
            ['content' => 'Second reply'],
        )->assertCreated();

        $detail = $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions/{$discussionId}?per_page=10")
            ->assertOk();
        $messageIds = array_map('intval', array_column($detail->json('data.messages'), 'id'));
        self::assertSame(
            [(int) $firstReply->json('data.id'), (int) $secondReply->json('data.id')],
            $messageIds,
        );
        self::assertNotContains($rootId, $messageIds);
        self::assertSame(2, (int) $detail->json('data.discussion.reply_count'));
        self::assertSame(
            $secondReply->json('data.created_at'),
            $detail->json('data.discussion.last_reply_at'),
        );

        $list = $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions")->assertOk();
        self::assertSame(2, (int) $list->json('data.0.reply_count'));
        self::assertSame($secondReply->json('data.created_at'), $list->json('data.0.last_reply_at'));
    }

    public function test_discussion_content_is_sanitized_and_text_column_byte_limits_are_validated(): void
    {
        $this->authenticate($this->member);
        $created = $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            'title' => 'Sanitizer contract',
            'content' => '<p>Safe <a href="javascript:alert(1)" onclick="alert(2)">link</a></p><script>alert(3)</script>',
        ])->assertCreated();

        $discussionId = (int) $created->json('data.id');
        $storedRoot = (string) $created->json('data.content');
        self::assertStringContainsString('Safe', $storedRoot);
        self::assertStringNotContainsString('javascript:', $storedRoot);
        self::assertStringNotContainsString('onclick', $storedRoot);
        self::assertStringNotContainsString('<script', $storedRoot);
        self::assertStringNotContainsString('alert(3)', $storedRoot);

        $reply = $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/discussions/{$discussionId}/messages",
            ['content' => '<a href="javascript:alert(4)" onmouseover="alert(5)">Reply</a>'],
        )->assertCreated();
        $storedReply = (string) $reply->json('data.content');
        self::assertStringContainsString('Reply', $storedReply);
        self::assertStringNotContainsString('javascript:', $storedReply);
        self::assertStringNotContainsString('onmouseover', $storedReply);

        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            'title' => 'Empty after sanitizing',
            'content' => '<script>alert(6)</script>',
        ])->assertUnprocessable();

        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            'title' => 'Too many bytes',
            'content' => str_repeat("\u{1F600}", 15001),
        ])->assertUnprocessable();
    }

    public function test_discussion_creation_replays_one_committed_result_after_response_loss(): void
    {
        $this->authenticate($this->member);
        $payload = [
            'title' => 'Response loss rota',
            'content' => 'This exact operation must create one discussion.',
            'idempotency_key' => 'group-discussion-replay-1',
        ];
        $headers = ['Idempotency-Key' => $payload['idempotency_key']];

        $first = $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", $payload, $headers)->assertCreated();
        $replay = $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", $payload, $headers)->assertCreated();

        self::assertSame($first->json('data.id'), $replay->json('data.id'));
        self::assertSame(1, DB::table('group_discussions')->where('id', $first->json('data.id'))->count());
        self::assertSame(1, DB::table('group_content_creation_receipts')->where('operation_type', 'discussion')->count());

        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            ...$payload,
            'content' => 'Changed content cannot reuse the operation.',
        ], $headers)->assertConflict();
    }

    public function test_pinned_discussion_composite_cursor_never_skips_or_duplicates_equal_timestamps(): void
    {
        $createdAt = now()->subDay()->format('Y-m-d H:i:s');
        $unpinnedOne = $this->discussion($this->activeGroupId, $this->member, false, $createdAt)['id'];
        $pinnedOne = $this->discussion($this->activeGroupId, $this->member, true, $createdAt)['id'];
        $unpinnedTwo = $this->discussion($this->activeGroupId, $this->member, false, $createdAt)['id'];
        $pinnedTwo = $this->discussion($this->activeGroupId, $this->member, true, $createdAt)['id'];
        $unpinnedThree = $this->discussion($this->activeGroupId, $this->member, false, $createdAt)['id'];
        $legacyNullPinned = $this->discussion($this->activeGroupId, $this->member, false, $createdAt)['id'];
        DB::table('group_discussions')->where('id', $legacyNullPinned)->update(['is_pinned' => null]);

        $this->authenticate($this->member);
        $ids = [];
        $cursor = null;
        do {
            $query = $cursor === null
                ? '?per_page=2'
                : '?per_page=2&cursor=' . rawurlencode($cursor);
            $response = $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions{$query}")->assertOk();
            array_push($ids, ...array_map('intval', array_column($response->json('data'), 'id')));
            $cursor = $response->json('meta.cursor');
            $hasMore = (bool) $response->json('meta.has_more');
        } while ($hasMore);

        self::assertSame([$pinnedTwo, $pinnedOne], array_slice($ids, 0, 2));
        self::assertCount(6, $ids);
        self::assertCount(6, array_unique($ids));
        self::assertEqualsCanonicalizing(
            [$unpinnedOne, $pinnedOne, $unpinnedTwo, $pinnedTwo, $unpinnedThree, $legacyNullPinned],
            $ids,
        );
    }

    public function test_reply_composite_cursor_returns_latest_page_chronologically_then_older_pages(): void
    {
        $fixture = $this->discussion($this->activeGroupId, $this->member);
        $createdAt = now()->addHour()->format('Y-m-d H:i:s');
        $replyIds = [];
        foreach (range(1, 5) as $index) {
            $replyIds[] = $this->reply($fixture['id'], $this->member, "Reply {$index}", $createdAt);
        }

        $this->authenticate($this->member);
        $assembled = [];
        $cursor = null;
        do {
            $query = $cursor === null
                ? '?per_page=2'
                : '?per_page=2&cursor=' . rawurlencode($cursor);
            $response = $this->apiGet(
                "/v2/groups/{$this->activeGroupId}/discussions/{$fixture['id']}{$query}",
            )->assertOk();
            $pageIds = array_map('intval', array_column($response->json('data.messages'), 'id'));
            self::assertCount(count($pageIds), array_unique($pageIds));
            $chronological = $pageIds;
            sort($chronological);
            self::assertSame($chronological, $pageIds);
            $assembled = array_merge($pageIds, $assembled);
            $cursor = $response->json('meta.cursor');
            $hasMore = (bool) $response->json('meta.has_more');
            self::assertSame(5, (int) $response->json('data.discussion.reply_count'));
        } while ($hasMore);

        self::assertSame($replyIds, $assembled);
        self::assertNotContains($fixture['root_id'], $assembled);
    }

    public function test_composite_cursors_are_bound_to_their_group_or_discussion(): void
    {
        $this->discussion($this->activeGroupId, $this->member);
        $this->discussion($this->activeGroupId, $this->member);
        $this->discussion($this->otherGroupId, $this->member);

        $firstThread = $this->discussion($this->activeGroupId, $this->member);
        $secondThread = $this->discussion($this->activeGroupId, $this->member);
        $replyTime = now()->addMinute()->format('Y-m-d H:i:s');
        $this->reply($firstThread['id'], $this->member, 'First', $replyTime);
        $this->reply($firstThread['id'], $this->member, 'Second', $replyTime);

        $this->authenticate($this->member);
        $listCursor = (string) $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/discussions?per_page=1",
        )->assertOk()->json('meta.cursor');
        self::assertNotSame('', $listCursor);
        $this->apiGet(
            "/v2/groups/{$this->otherGroupId}/discussions?per_page=1&cursor=" . rawurlencode($listCursor),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
        $tamperedListCursor = substr($listCursor, 0, -1)
            . (str_ends_with($listCursor, 'A') ? 'B' : 'A');
        $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/discussions?per_page=1&cursor=" . rawurlencode($tamperedListCursor),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');

        $replyCursor = (string) $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/discussions/{$firstThread['id']}?per_page=1",
        )->assertOk()->json('meta.cursor');
        self::assertNotSame('', $replyCursor);
        $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/discussions/{$secondThread['id']}?per_page=1&cursor=" . rawurlencode($replyCursor),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
        $tamperedReplyCursor = substr($replyCursor, 0, -1)
            . (str_ends_with($replyCursor, 'A') ? 'B' : 'A');
        $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/discussions/{$firstThread['id']}?per_page=1&cursor=" . rawurlencode($tamperedReplyCursor),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
    }

    public function test_locked_discussion_rejects_replies_with_a_translated_conflict(): void
    {
        $locked = $this->discussion($this->activeGroupId, $this->member);
        DB::table('group_discussions')->where('id', $locked['id'])->update(['is_locked' => true]);
        $postCount = DB::table('group_posts')->where('discussion_id', $locked['id'])->count();

        $this->authenticate($this->member);
        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/discussions/{$locked['id']}/messages",
            ['content' => 'This reply must not be persisted.'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'DISCUSSION_LOCKED')
            ->assertJsonPath('errors.0.message', __('api.group_discussion_locked'));

        self::assertSame(
            $postCount,
            DB::table('group_posts')->where('discussion_id', $locked['id'])->count(),
        );
    }

    public function test_access_lifecycle_tenant_and_invalid_cursor_fail_with_truthful_statuses(): void
    {
        $other = $this->discussion($this->otherGroupId, $this->member);
        $foreign = $this->discussion($this->foreignGroupId, $this->foreignOwner, false, null, 999);

        $this->authenticate($this->nonMember);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions")->assertForbidden();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            'title' => 'Denied',
            'content' => 'Denied',
        ])->assertForbidden();

        $this->authenticate($this->pendingMember);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions")->assertForbidden();

        $this->authenticate($this->member);
        $this->apiGet("/v2/groups/{$this->dormantGroupId}/discussions")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/discussions")->assertForbidden();
        $this->apiPost("/v2/groups/{$this->archivedGroupId}/discussions", [
            'title' => 'Archived write',
            'content' => 'Must not persist',
        ])->assertForbidden();
        $this->apiGet("/v2/groups/{$this->foreignGroupId}/discussions")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions/{$other['id']}")->assertNotFound();
        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/discussions/{$foreign['id']}/messages",
            ['content' => 'Cross-tenant reply'],
        )->assertNotFound();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions?cursor=tampered")
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions/{$other['id']}?cursor=tampered")
            ->assertNotFound();

        $local = $this->discussion($this->activeGroupId, $this->member);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/discussions/{$local['id']}?cursor=tampered")
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
        $this->apiPost("/v2/groups/{$this->activeGroupId}/discussions", [
            'title' => ['not a scalar'],
            'content' => 'Body',
        ])->assertUnprocessable();
    }

    private function enableDiscussionRoutes(): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $features['groups'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_DISCUSSION, true);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_ENABLE_DISCUSSIONS, true);
    }

    private function authenticate(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function group(GroupStatus $status, User $owner, ?int $tenantId = null): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Discussion test ' . uniqid('', true),
            'description' => 'Discussion contract fixture.',
            'visibility' => 'private',
            'status' => $status->value,
            'is_active' => $status->legacyIsActive(),
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function membership(
        int $groupId,
        User $user,
        string $role = 'member',
        string $status = 'active',
    ): void {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array{id: int, root_id: int} */
    private function discussion(
        int $groupId,
        User $author,
        bool $pinned = false,
        ?string $createdAt = null,
        ?int $tenantId = null,
    ): array {
        $tenantId ??= $this->testTenantId;
        $createdAt ??= now()->format('Y-m-d H:i:s');
        $discussionId = (int) DB::table('group_discussions')->insertGetId([
            'tenant_id' => $tenantId,
            'group_id' => $groupId,
            'user_id' => $author->id,
            'title' => 'Discussion ' . uniqid('', true),
            'is_pinned' => $pinned,
            'is_locked' => false,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
        $rootId = (int) DB::table('group_posts')->insertGetId([
            'tenant_id' => $tenantId,
            'discussion_id' => $discussionId,
            'user_id' => $author->id,
            'content' => 'Root ' . $discussionId,
            'created_at' => $createdAt,
        ]);

        return ['id' => $discussionId, 'root_id' => $rootId];
    }

    private function reply(int $discussionId, User $author, string $content, string $createdAt): int
    {
        return (int) DB::table('group_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'discussion_id' => $discussionId,
            'user_id' => $author->id,
            'content' => $content,
            'created_at' => $createdAt,
        ]);
    }
}
