<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\Group;
use App\Models\Tenant;
use App\Models\User;
use App\Services\GroupConfigurationService;
use App\Services\GroupScheduledPostService;
use App\Services\GroupWebhookService;
use App\Services\TenantFeatureConfig;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupScheduledPublishingReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private Group $group;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(
                array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['groups' => true]),
                JSON_THROW_ON_ERROR,
            ),
        ]);
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_ANNOUNCEMENTS, true);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_DISCUSSION, true);

        $this->owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $this->owner->id,
            'status' => GroupStatus::Active->value,
            'is_active' => true,
        ]);

        TenantContext::setById($this->testTenantId);
        Queue::fake();
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        Cache::forget('group_config:' . $this->testTenantId);
        parent::tearDown();
    }

    public function test_scheduled_creation_replays_the_exact_intent_once(): void
    {
        $payload = [
            'post_type' => 'discussion',
            'title' => 'Durable scheduled discussion',
            'content' => 'This should only be scheduled once.',
            'scheduled_at' => now()->addDay()->startOfMinute()->toIso8601String(),
            'is_recurring' => true,
            'recurrence_pattern' => 'weekly',
            'idempotency_key' => 'scheduled-post-replay-key',
        ];

        $first = GroupScheduledPostService::schedule($this->group->id, $this->owner->id, $payload);
        $second = GroupScheduledPostService::schedule($this->group->id, $this->owner->id, $payload);

        self::assertSame($first, $second);
        self::assertSame(1, DB::table('group_scheduled_posts')->where('id', $first)->count());
        self::assertSame(1, DB::table('group_content_creation_receipts')
            ->where('operation_type', 'scheduled_post')
            ->where('result_id', $first)
            ->count());
    }

    public function test_scheduled_creation_rejects_changed_intent_for_the_same_key(): void
    {
        $payload = [
            'post_type' => 'announcement',
            'title' => 'Original announcement',
            'content' => 'The original scheduled content.',
            'scheduled_at' => now()->addDay()->startOfMinute()->toIso8601String(),
            'is_recurring' => false,
            'recurrence_pattern' => null,
            'idempotency_key' => 'scheduled-post-conflict-key',
        ];
        GroupScheduledPostService::schedule($this->group->id, $this->owner->id, $payload);

        $this->expectException(DomainException::class);
        $this->expectExceptionMessage(GroupScheduledPostService::ERROR_IDEMPOTENCY_CONFLICT);
        GroupScheduledPostService::schedule($this->group->id, $this->owner->id, [
            ...$payload,
            'content' => 'Changed content must not reuse the key.',
        ]);
    }

    public function test_scheduled_creation_honours_the_selected_content_tab(): void
    {
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_ANNOUNCEMENTS, false);

        $this->expectException(AuthorizationException::class);
        GroupScheduledPostService::schedule($this->group->id, $this->owner->id, [
            'post_type' => 'announcement',
            'title' => 'Disabled announcement',
            'content' => 'This tab is disabled.',
            'scheduled_at' => now()->addDay()->toIso8601String(),
        ]);
    }

    public function test_scheduled_creation_api_maps_changed_intent_to_conflict(): void
    {
        Sanctum::actingAs($this->owner, ['*']);
        $payload = [
            'post_type' => 'discussion',
            'title' => 'API replay contract',
            'content' => 'Original API content.',
            'scheduled_at' => now()->addDay()->startOfMinute()->toIso8601String(),
            'is_recurring' => false,
            'recurrence_pattern' => null,
        ];

        $this->withHeader('Idempotency-Key', 'scheduled-api-conflict-key')
            ->apiPost('/v2/groups/' . $this->group->id . '/scheduled-posts', $payload)
            ->assertCreated();

        $this->withHeader('Idempotency-Key', 'scheduled-api-conflict-key')
            ->apiPost('/v2/groups/' . $this->group->id . '/scheduled-posts', [
                ...$payload,
                'content' => 'Changed API content.',
            ])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
    }

    public function test_canonical_discussion_publication_and_retry_are_exactly_once(): void
    {
        $webhookId = $this->insertWebhook([GroupWebhookService::EVENT_DISCUSSION_CREATED]);
        $scheduledId = $this->insertScheduled([
            'post_type' => 'discussion',
            'title' => 'Canonical scheduled discussion',
            'content' => 'This goes through the canonical discussion service.',
        ]);

        self::assertSame(1, GroupScheduledPostService::publishDue());
        self::assertSame(0, GroupScheduledPostService::publishDue());

        $scheduled = DB::table('group_scheduled_posts')->where('id', $scheduledId)->first();
        self::assertNotNull($scheduled);
        self::assertSame('published', $scheduled->status);
        self::assertSame('discussion', $scheduled->published_resource_type);
        self::assertNotNull($scheduled->published_resource_id);
        self::assertSame(1, DB::table('group_discussions')
            ->where('group_id', $this->group->id)
            ->where('title', 'Canonical scheduled discussion')
            ->count());
        self::assertSame(1, DB::table('group_posts')
            ->where('discussion_id', $scheduled->published_resource_id)
            ->count());

        $delivery = DB::table('group_webhook_deliveries')
            ->where('webhook_id', $webhookId)
            ->where('event', GroupWebhookService::EVENT_DISCUSSION_CREATED)
            ->first();
        self::assertNotNull($delivery, 'Canonical publication must emit the real discussion webhook event.');
        self::assertSame('queued', $delivery->status);
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    public function test_expired_claim_is_retried_without_duplicate_content(): void
    {
        $scheduledId = $this->insertScheduled([
            'post_type' => 'discussion',
            'title' => 'Expired lease publication',
            'status' => 'processing',
            'attempt_count' => 1,
            'claim_token' => '6bb7b0dc-ab91-4694-9320-ef9b768d64e9',
            'claimed_at' => now()->subMinutes(10),
            'lease_expires_at' => now()->subMinute(),
        ]);

        self::assertSame(1, GroupScheduledPostService::publishDue());
        self::assertSame(0, GroupScheduledPostService::publishDue());
        self::assertSame('published', DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('status'));
        self::assertSame(2, (int) DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('attempt_count'));
        self::assertSame(1, DB::table('group_discussions')
            ->where('group_id', $this->group->id)
            ->where('title', 'Expired lease publication')
            ->count());
    }

    public function test_recurrence_uses_the_prior_occurrence_not_worker_time(): void
    {
        $prior = now()->subDays(3)->startOfMinute();
        $scheduledId = $this->insertScheduled([
            'post_type' => 'announcement',
            'title' => 'Daily cadence',
            'scheduled_at' => $prior,
            'is_recurring' => true,
            'recurrence_pattern' => 'daily',
        ]);

        self::assertSame(1, GroupScheduledPostService::publishDue());

        $next = DB::table('group_scheduled_posts')
            ->where('recurrence_parent_id', $scheduledId)
            ->first();
        self::assertNotNull($next);
        self::assertSame(
            $prior->copy()->addDay()->toDateTimeString(),
            Carbon::parse((string) $next->scheduled_at)->toDateTimeString(),
        );
        self::assertTrue(Carbon::parse((string) $next->scheduled_at)->isPast());
    }

    public function test_archived_group_and_removed_author_fail_terminally_and_restore_context(): void
    {
        $archivedId = $this->insertScheduled(['title' => 'Archived parent canary']);

        $formerAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->group->id,
            'user_id' => $formerAdmin->id,
            'status' => 'active',
            'role' => 'admin',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $removedAuthorId = $this->insertScheduled([
            'user_id' => $formerAdmin->id,
            'title' => 'Removed author canary',
        ]);
        DB::table('group_members')
            ->where('group_id', $this->group->id)
            ->where('user_id', $formerAdmin->id)
            ->delete();

        DB::table('groups')->where('id', $this->group->id)->update([
            'status' => GroupStatus::Archived->value,
            'is_active' => false,
        ]);
        $sentinelTenantId = (int) Tenant::factory()->create()->id;
        self::assertTrue(TenantContext::setById($sentinelTenantId));

        self::assertSame(0, GroupScheduledPostService::publishDue());
        self::assertSame($sentinelTenantId, TenantContext::getId());
        self::assertSame('GROUP_UNAVAILABLE', DB::table('group_scheduled_posts')->where('id', $archivedId)->value('last_error_code'));
        self::assertSame('GROUP_UNAVAILABLE', DB::table('group_scheduled_posts')->where('id', $removedAuthorId)->value('last_error_code'));
        self::assertSame(0, DB::table('group_announcements')
            ->where('group_id', $this->group->id)
            ->whereIn('title', ['Archived parent canary', 'Removed author canary'])
            ->count());
    }

    public function test_removed_author_is_rejected_while_parent_remains_active(): void
    {
        $formerAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->group->id,
            'user_id' => $formerAdmin->id,
            'status' => 'active',
            'role' => 'admin',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $scheduledId = $this->insertScheduled([
            'user_id' => $formerAdmin->id,
            'title' => 'Removed author only',
        ]);
        DB::table('group_members')
            ->where('group_id', $this->group->id)
            ->where('user_id', $formerAdmin->id)
            ->delete();
        TenantContext::setById($this->testTenantId);

        self::assertSame(0, GroupScheduledPostService::publishDue());
        self::assertSame('AUTHOR_ACCESS_REVOKED', DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('last_error_code'));
        self::assertFalse(DB::table('group_announcements')->where('title', 'Removed author only')->exists());
    }

    public function test_tenant_group_feature_is_rechecked_at_publish_time(): void
    {
        $scheduledId = $this->insertScheduled(['title' => 'Disabled feature canary']);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(
                array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['groups' => false]),
                JSON_THROW_ON_ERROR,
            ),
        ]);
        TenantContext::setById($this->testTenantId);

        self::assertSame(0, GroupScheduledPostService::publishDue());
        self::assertSame('failed', DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('status'));
        self::assertSame('FEATURE_DISABLED', DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('last_error_code'));
        self::assertFalse(DB::table('group_announcements')->where('title', 'Disabled feature canary')->exists());
    }

    public function test_expired_final_lease_moves_to_failed_dead_letter_state(): void
    {
        $scheduledId = $this->insertScheduled([
            'title' => 'Exhausted lease canary',
            'status' => 'processing',
            'attempt_count' => 5,
            'claim_token' => '5c9d6253-a0ac-4fde-a1fe-52b3380ce24a',
            'lease_expires_at' => now()->subMinute(),
        ]);

        self::assertSame(0, GroupScheduledPostService::publishDue());
        self::assertSame('failed', DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('status'));
        self::assertSame('LEASE_EXHAUSTED', DB::table('group_scheduled_posts')->where('id', $scheduledId)->value('last_error_code'));
    }

    /** @param array<string, mixed> $overrides */
    private function insertScheduled(array $overrides = []): int
    {
        return (int) DB::table('group_scheduled_posts')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->group->id,
            'user_id' => $this->owner->id,
            'post_type' => 'announcement',
            'title' => 'Scheduled reliability canary',
            'content' => 'Scheduled reliability test content.',
            'is_recurring' => false,
            'recurrence_pattern' => null,
            'scheduled_at' => now()->subMinute(),
            'status' => 'scheduled',
            'attempt_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    /** @param list<string> $events */
    private function insertWebhook(array $events): int
    {
        return (int) DB::table('group_webhooks')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->group->id,
            'url' => 'https://8.8.8.8/group-hook',
            'events' => json_encode($events, JSON_THROW_ON_ERROR),
            'secret' => null,
            'is_active' => true,
            'failure_count' => 0,
            'disabled_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
