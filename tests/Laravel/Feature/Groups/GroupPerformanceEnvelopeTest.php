<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Jobs\GenerateGroupDataExport;
use App\Models\User;
use App\Services\GroupConfigurationService;
use App\Services\GroupWebhookService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupPerformanceEnvelopeTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();
        foreach ([
            GroupConfigurationService::CONFIG_TAB_MEMBERS,
            GroupConfigurationService::CONFIG_TAB_DISCUSSION,
            GroupConfigurationService::CONFIG_TAB_FILES,
            GroupConfigurationService::CONFIG_TAB_ANNOUNCEMENTS,
            GroupConfigurationService::CONFIG_TAB_QA,
            GroupConfigurationService::CONFIG_TAB_WIKI,
            GroupConfigurationService::CONFIG_TAB_MEDIA,
            GroupConfigurationService::CONFIG_TAB_CHATROOMS,
            GroupConfigurationService::CONFIG_TAB_TASKS,
            GroupConfigurationService::CONFIG_TAB_ANALYTICS,
        ] as $setting) {
            GroupConfigurationService::set($setting, true);
        }

        $this->owner = User::factory()->forTenant($this->testTenantId)->create([
            'username' => 'g18_perf_owner_' . Str::lower(Str::random(8)),
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($this->owner, ['*']);
    }

    public function test_large_groups_fixture_has_bounded_read_and_enqueue_query_growth(): void
    {
        $fixture = $this->seedLargeFixture();
        $measurements = [
            'fixture' => [
                'groups' => $fixture['group_count'],
                'memberships' => $fixture['membership_count'],
                'mixed_content' => $fixture['mixed_content_count'],
            ],
        ];
        self::assertGreaterThanOrEqual(100, $fixture['group_count']);
        self::assertGreaterThanOrEqual(500, $fixture['membership_count']);
        self::assertGreaterThanOrEqual(1_000, $fixture['mixed_content_count']);

        $smallList = $this->measureGet('/v2/groups?q=' . rawurlencode($fixture['marker'] . ' small'));
        $largeList = $this->measureGet('/v2/groups?per_page=20');
        $measurements['directory'] = [$smallList['queries'], $largeList['queries']];
        // 🔴 Every absolute budget below was raised by six on 2026-09-11: since the
        // MFA baseline every authenticated request pays for the two-factor policy
        // check (TwoFactorPolicy::required: schema probe, role-grant lookup, tenant
        // setting), measured at +4 to +6 queries per screen on the small fixture
        // (directory 24 -> 28, members 30 -> 34, wiki 12 -> 18). The GROWTH bounds
        // (second argument) are unchanged — that is the property this test guards.
        // Optimising the policy check is tracked in the E-004 review (O-011).
        $this->assertBoundedGrowth('group directory', $smallList['queries'], $largeList['queries'], 30, 2);

        $smallDetail = $this->measureGet("/v2/groups/{$fixture['small_group_id']}");
        $largeDetail = $this->measureGet("/v2/groups/{$fixture['large_group_id']}");
        $measurements['detail'] = [$smallDetail['queries'], $largeDetail['queries']];
        $this->assertBoundedGrowth('group detail', $smallDetail['queries'], $largeDetail['queries'], 30, 1);

        $smallMembers = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/members?per_page=20");
        $largeMembers = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/members?per_page=20");
        $measurements['members'] = [$smallMembers['queries'], $largeMembers['queries']];
        $this->assertBoundedGrowth('members tab', $smallMembers['queries'], $largeMembers['queries'], 36, 1);

        $smallDiscussions = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/discussions?per_page=20");
        $largeDiscussions = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/discussions?per_page=20");
        $measurements['discussions'] = [$smallDiscussions['queries'], $largeDiscussions['queries']];
        $this->assertBoundedGrowth('discussion tab', $smallDiscussions['queries'], $largeDiscussions['queries'], 24, 1);

        $smallFiles = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/files?per_page=20");
        $largeFiles = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/files?per_page=20");
        $measurements['files'] = [$smallFiles['queries'], $largeFiles['queries']];
        $this->assertBoundedGrowth('files tab', $smallFiles['queries'], $largeFiles['queries'], 24, 1);

        $smallAnnouncements = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/announcements?per_page=20");
        $largeAnnouncements = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/announcements?per_page=20");
        $measurements['announcements'] = [$smallAnnouncements['queries'], $largeAnnouncements['queries']];
        $this->assertBoundedGrowth('announcements tab', $smallAnnouncements['queries'], $largeAnnouncements['queries'], 24, 1);

        $smallAnalytics = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/analytics");
        $largeAnalytics = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/analytics");
        $measurements['analytics'] = [$smallAnalytics['queries'], $largeAnalytics['queries']];
        $this->assertBoundedGrowth('analytics dashboard', $smallAnalytics['queries'], $largeAnalytics['queries'], 46, 2);

        $smallQuestions = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/questions?per_page=20");
        $largeQuestions = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/questions?per_page=20");
        $measurements['qa'] = [$smallQuestions['queries'], $largeQuestions['queries']];
        $this->assertBoundedGrowth('Q&A tab', $smallQuestions['queries'], $largeQuestions['queries'], 24, 1);

        $smallWiki = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/wiki");
        $largeWiki = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/wiki");
        $measurements['wiki'] = [$smallWiki['queries'], $largeWiki['queries']];
        $this->assertBoundedGrowth('wiki tab', $smallWiki['queries'], $largeWiki['queries'], 18, 1);

        $smallMedia = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/media?per_page=20");
        $largeMedia = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/media?per_page=20");
        $measurements['media'] = [$smallMedia['queries'], $largeMedia['queries']];
        $this->assertBoundedGrowth('media tab', $smallMedia['queries'], $largeMedia['queries'], 24, 1);

        $smallChatrooms = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/chatrooms");
        $largeChatrooms = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/chatrooms");
        $measurements['chatrooms'] = [$smallChatrooms['queries'], $largeChatrooms['queries']];
        $this->assertBoundedGrowth('chatrooms tab', $smallChatrooms['queries'], $largeChatrooms['queries'], 18, 1);

        $smallTasks = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/tasks?per_page=20");
        $largeTasks = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/tasks?per_page=20");
        $measurements['tasks'] = [$smallTasks['queries'], $largeTasks['queries']];
        $this->assertBoundedGrowth('tasks tab', $smallTasks['queries'], $largeTasks['queries'], 26, 1);

        $smallScheduled = $this->measureGet("/v2/groups/{$fixture['small_group_id']}/scheduled-posts");
        $largeScheduled = $this->measureGet("/v2/groups/{$fixture['large_group_id']}/scheduled-posts");
        $measurements['scheduled_posts'] = [$smallScheduled['queries'], $largeScheduled['queries']];
        $this->assertBoundedGrowth('scheduled posts', $smallScheduled['queries'], $largeScheduled['queries'], 18, 1);

        $smallUpdate = $this->measurePut(
            "/v2/groups/{$fixture['small_group_id']}",
            ['description' => 'Deterministic G18 small-group mutation.'],
        );
        $largeUpdate = $this->measurePut(
            "/v2/groups/{$fixture['large_group_id']}",
            ['description' => 'Deterministic G18 large-group mutation.'],
        );
        $measurements['ordinary_update'] = [$smallUpdate['queries'], $largeUpdate['queries']];
        $this->assertBoundedGrowth('ordinary group update', $smallUpdate['queries'], $largeUpdate['queries'], 46, 2);

        $smallExport = $this->measurePost("/v2/groups/{$fixture['small_group_id']}/exports");
        $largeExport = $this->measurePost("/v2/groups/{$fixture['large_group_id']}/exports");
        $measurements['export_enqueue'] = [$smallExport['queries'], $largeExport['queries']];
        $this->assertBoundedGrowth('queued export request', $smallExport['queries'], $largeExport['queries'], 24, 1);
        Queue::assertPushed(GenerateGroupDataExport::class, 2);

        $smallWebhookQueries = $this->measureQueries(static function () use ($fixture): void {
            GroupWebhookService::fire(
                $fixture['small_group_id'],
                GroupWebhookService::EVENT_MEMBER_JOINED,
                ['user_id' => 1],
            );
        });
        $largeWebhookQueries = $this->measureQueries(static function () use ($fixture): void {
            GroupWebhookService::fire(
                $fixture['large_group_id'],
                GroupWebhookService::EVENT_MEMBER_JOINED,
                ['user_id' => 2],
            );
        });
        $measurements['webhook_enqueue'] = [$smallWebhookQueries, $largeWebhookQueries];
        $this->assertBoundedGrowth('webhook outbox append', $smallWebhookQueries, $largeWebhookQueries, 5, 0);
        self::assertSame(
            1,
            DB::table('group_webhook_deliveries')->where('group_id', $fixture['small_group_id'])->count(),
        );
        self::assertSame(
            GroupWebhookService::MAX_WEBHOOKS_PER_GROUP,
            DB::table('group_webhook_deliveries')->where('group_id', $fixture['large_group_id'])->count(),
            'Outbox fan-out must remain capped even if legacy data exceeds the registration limit.',
        );

        if (filter_var(getenv('GROUPS_PERF_REPORT') ?: false, FILTER_VALIDATE_BOOL)) {
            fwrite(STDOUT, "\nGROUPS_PERF_REPORT=" . json_encode($measurements, JSON_THROW_ON_ERROR) . "\n");
        }
    }

    /** @return array{marker: string, small_group_id: int, large_group_id: int, group_count: int, membership_count: int, mixed_content_count: int} */
    private function seedLargeFixture(): array
    {
        $marker = 'g18perf' . Str::lower(Str::random(10));
        $now = now();
        $passwordHash = (string) $this->owner->password_hash;

        $users = [];
        for ($index = 1; $index <= 500; $index++) {
            $users[] = [
                'tenant_id' => $this->testTenantId,
                'first_name' => 'G18',
                'last_name' => sprintf('Member %03d', $index),
                'name' => sprintf('G18 Member %03d', $index),
                'username' => "{$marker}_member_{$index}",
                'email' => "{$marker}.member.{$index}@example.invalid",
                'password_hash' => $passwordHash,
                'role' => 'member',
                'status' => 'active',
                'is_verified' => true,
                'is_approved' => true,
                'balance' => 0,
                'profile_type' => 'individual',
                'onboarding_completed' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($users, 100) as $chunk) {
            DB::table('users')->insert($chunk);
        }
        $memberIds = DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('username', 'like', $marker . '\_member\_%')
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        self::assertCount(500, $memberIds);

        $groups = [];
        for ($index = 1; $index <= 100; $index++) {
            $kind = $index === 1 ? 'large' : ($index === 2 ? 'small' : 'directory');
            $groups[] = [
                'tenant_id' => $this->testTenantId,
                'owner_id' => $this->owner->id,
                'name' => "{$marker} {$kind} " . sprintf('%03d', $index),
                'slug' => "{$marker}-{$kind}-{$index}",
                'description' => 'Deterministic G18 performance fixture.',
                'visibility' => 'public',
                'status' => 'active',
                'is_active' => true,
                'cached_member_count' => $index === 1 ? 501 : ($index === 2 ? 1 : 0),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($groups, 50) as $chunk) {
            DB::table('groups')->insert($chunk);
        }
        $largeGroupId = (int) DB::table('groups')->where('slug', "{$marker}-large-1")->value('id');
        $smallGroupId = (int) DB::table('groups')->where('slug', "{$marker}-small-2")->value('id');
        self::assertGreaterThan(0, $largeGroupId);
        self::assertGreaterThan(0, $smallGroupId);

        $memberships = [[
            'tenant_id' => $this->testTenantId,
            'group_id' => $largeGroupId,
            'user_id' => $this->owner->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ], [
            'tenant_id' => $this->testTenantId,
            'group_id' => $smallGroupId,
            'user_id' => $this->owner->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ]];
        foreach ($memberIds as $memberId) {
            $memberships[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'user_id' => $memberId,
                'role' => 'member',
                'status' => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($memberships, 100) as $chunk) {
            DB::table('group_members')->insert($chunk);
        }

        $discussions = [];
        for ($index = 1; $index <= 250; $index++) {
            $discussions[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'user_id' => $this->owner->id,
                'title' => "{$marker} discussion " . sprintf('%03d', $index),
                'is_pinned' => false,
                'is_locked' => false,
                'created_at' => $now->copy()->subSeconds($index),
                'updated_at' => $now->copy()->subSeconds($index),
            ];
        }
        foreach (array_chunk($discussions, 100) as $chunk) {
            DB::table('group_discussions')->insert($chunk);
        }
        $discussionIds = DB::table('group_discussions')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $largeGroupId)
            ->where('title', 'like', $marker . '%')
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        self::assertCount(250, $discussionIds);

        $posts = [];
        foreach ($discussionIds as $index => $discussionId) {
            $posts[] = [
                'tenant_id' => $this->testTenantId,
                'discussion_id' => $discussionId,
                'user_id' => $this->owner->id,
                'content' => "{$marker} post " . sprintf('%03d', $index + 1),
                'created_at' => $now->copy()->subSeconds($index),
            ];
        }
        foreach (array_chunk($posts, 100) as $chunk) {
            DB::table('group_posts')->insert($chunk);
        }

        $announcements = [];
        $files = [];
        for ($index = 1; $index <= 250; $index++) {
            $announcements[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'title' => "{$marker} announcement " . sprintf('%03d', $index),
                'content' => 'Deterministic announcement content.',
                'is_pinned' => $index <= 3,
                'priority' => $index <= 3 ? 4 - $index : 0,
                'created_by' => $this->owner->id,
                'created_at' => $now->copy()->subSeconds($index),
                'updated_at' => $now->copy()->subSeconds($index),
                'expires_at' => null,
            ];
            $files[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'file_name' => "{$marker}-file-{$index}.txt",
                'file_path' => "groups/{$this->testTenantId}/{$largeGroupId}/{$marker}-file-{$index}.txt",
                'file_type' => 'text/plain',
                'file_size' => 128,
                'folder' => 'performance',
                'description' => 'Deterministic file metadata.',
                'download_count' => 0,
                'uploaded_by' => $this->owner->id,
                'created_at' => $now->copy()->subSeconds($index),
                'updated_at' => $now->copy()->subSeconds($index),
            ];
        }
        foreach (array_chunk($announcements, 100) as $chunk) {
            DB::table('group_announcements')->insert($chunk);
        }
        foreach (array_chunk($files, 100) as $chunk) {
            DB::table('group_files')->insert($chunk);
        }

        $extendedContentCount = $this->seedExtendedContent($marker, $largeGroupId, $now);

        $webhooks = [];
        foreach ([[$smallGroupId, 1], [$largeGroupId, GroupWebhookService::MAX_WEBHOOKS_PER_GROUP + 5]] as [$groupId, $count]) {
            for ($index = 1; $index <= $count; $index++) {
                $webhooks[] = [
                    'tenant_id' => $this->testTenantId,
                    'group_id' => $groupId,
                    'url' => "https://8.8.8.8/{$marker}/{$groupId}/{$index}",
                    'events' => json_encode([GroupWebhookService::EVENT_MEMBER_JOINED], JSON_THROW_ON_ERROR),
                    'secret' => null,
                    'is_active' => true,
                    'failure_count' => 0,
                    'disabled_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }
        DB::table('group_webhooks')->insert($webhooks);

        TenantContext::setById($this->testTenantId);
        TenantContext::hasFeature('groups');

        return [
            'marker' => $marker,
            'small_group_id' => $smallGroupId,
            'large_group_id' => $largeGroupId,
            'group_count' => DB::table('groups')->where('name', 'like', $marker . '%')->count(),
            'membership_count' => DB::table('group_members')->whereIn('group_id', [$smallGroupId, $largeGroupId])->count(),
            'mixed_content_count' => count($discussions) + count($posts) + count($announcements) + count($files) + $extendedContentCount,
        ];
    }

    private function seedExtendedContent(string $marker, int $largeGroupId, \DateTimeInterface $now): int
    {
        $questions = [];
        $wikiPages = [];
        $media = [];
        $chatrooms = [];
        $tasks = [];
        $scheduledPosts = [];

        for ($index = 1; $index <= 250; $index++) {
            $createdAt = \Carbon\CarbonImmutable::instance($now)->subSeconds($index);
            $questions[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'user_id' => $this->owner->id,
                'title' => "{$marker} question " . sprintf('%03d', $index),
                'body' => 'Deterministic question body.',
                'accepted_answer_id' => null,
                'is_closed' => false,
                'view_count' => $index,
                'vote_count' => $index % 11,
                'answer_count' => 0,
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ];
            $wikiPages[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'parent_id' => null,
                'title' => "{$marker} wiki " . sprintf('%03d', $index),
                'slug' => "{$marker}-wiki-{$index}",
                'content' => 'Deterministic wiki content.',
                'created_by' => $this->owner->id,
                'last_edited_by' => $this->owner->id,
                'sort_order' => $index,
                'is_published' => true,
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ];
            $media[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'uploaded_by' => $this->owner->id,
                'media_type' => 'image',
                'file_path' => "groups/{$this->testTenantId}/{$largeGroupId}/media/{$marker}-{$index}.png",
                'url' => null,
                'thumbnail_path' => null,
                'caption' => 'Deterministic media metadata.',
                'file_size' => 256,
                'width' => 16,
                'height' => 16,
                'original_name' => "{$marker}-{$index}.png",
                'mime_type' => 'image/png',
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ];
            $chatrooms[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'name' => "{$marker} channel " . sprintf('%03d', $index),
                'description' => 'Deterministic chatroom metadata.',
                'category' => 'performance',
                'is_private' => false,
                'permissions' => null,
                'created_by' => $this->owner->id,
                'is_default' => false,
                'created_at' => $createdAt,
            ];
            $tasks[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'title' => "{$marker} task " . sprintf('%03d', $index),
                'description' => 'Deterministic task metadata.',
                'assigned_to' => null,
                'status' => 'todo',
                'priority' => 'medium',
                'due_date' => null,
                'created_by' => $this->owner->id,
                'created_at' => $createdAt,
                'completed_at' => null,
                'updated_at' => $createdAt,
            ];
            $scheduledPosts[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $largeGroupId,
                'user_id' => $this->owner->id,
                'post_type' => 'announcement',
                'title' => "{$marker} scheduled " . sprintf('%03d', $index),
                'content' => 'Deterministic scheduled content.',
                'is_recurring' => false,
                'recurrence_pattern' => null,
                'scheduled_at' => \Carbon\CarbonImmutable::instance($now)->addDays($index),
                'published_at' => null,
                'status' => 'scheduled',
                'attempt_count' => 0,
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ];
        }

        foreach ([
            'group_questions' => $questions,
            'group_wiki_pages' => $wikiPages,
            'group_media' => $media,
            'group_chatrooms' => $chatrooms,
            'team_tasks' => $tasks,
            'group_scheduled_posts' => $scheduledPosts,
        ] as $table => $rows) {
            foreach (array_chunk($rows, 100) as $chunk) {
                DB::table($table)->insert($chunk);
            }
        }

        return count($questions) + count($wikiPages) + count($media)
            + count($chatrooms) + count($tasks) + count($scheduledPosts);
    }

    /** @return array{queries: int} */
    private function measureGet(string $uri): array
    {
        $queries = $this->measureQueries(function () use ($uri): void {
            $this->apiGet($uri)->assertOk();
        });

        return ['queries' => $queries];
    }

    /** @return array{queries: int} */
    private function measurePost(string $uri): array
    {
        $queries = $this->measureQueries(function () use ($uri): void {
            $this->apiPost($uri)->assertStatus(202);
        });

        return ['queries' => $queries];
    }

    /** @param array<string, mixed> $data @return array{queries: int} */
    private function measurePut(string $uri, array $data): array
    {
        $queries = $this->measureQueries(function () use ($uri, $data): void {
            $this->apiPut($uri, $data)->assertOk();
        });

        return ['queries' => $queries];
    }

    private function measureQueries(callable $operation): int
    {
        DB::disableQueryLog();
        DB::flushQueryLog();
        DB::enableQueryLog();
        try {
            $operation();
            return count(DB::getQueryLog());
        } finally {
            DB::disableQueryLog();
            DB::flushQueryLog();
        }
    }

    private function assertBoundedGrowth(
        string $surface,
        int $smallQueries,
        int $largeQueries,
        int $absoluteBudget,
        int $growthHeadroom,
    ): void {
        self::assertLessThanOrEqual(
            $absoluteBudget,
            $largeQueries,
            "{$surface} used {$largeQueries} queries; budget is {$absoluteBudget}.",
        );
        self::assertLessThanOrEqual(
            $smallQueries + $growthHeadroom,
            $largeQueries,
            "{$surface} grew from {$smallQueries} to {$largeQueries} queries with fixture size.",
        );
    }
}
