<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\FeedActivity;
use App\Models\FeedPost;
use App\Models\User;
use App\Services\FeedService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventFeedLifecycleVisibilityTest extends TestCase
{
    /** @var list<int> */
    private array $eventIds = [];

    /** @var list<int> */
    private array $userIds = [];

    protected function tearDown(): void
    {
        if ($this->eventIds !== []) {
            DB::table('feed_activity')
                ->where('tenant_id', $this->testTenantId)
                ->where('source_type', 'event')
                ->whereIn('source_id', $this->eventIds)
                ->delete();
            DB::table('events')
                ->where('tenant_id', $this->testTenantId)
                ->whereIn('id', $this->eventIds)
                ->delete();
        }
        if ($this->userIds !== []) {
            DB::table('users')
                ->where('tenant_id', $this->testTenantId)
                ->whereIn('id', $this->userIds)
                ->delete();
        }

        parent::tearDown();
    }

    public function test_feed_fails_closed_for_retained_but_non_discoverable_events(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->userIds[] = (int) $user->id;

        $publishedId = $this->event((int) $user->id, 'Published event', [
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
        ]);
        $this->event((int) $user->id, 'Draft event', [
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
        ]);
        $this->event((int) $user->id, 'Pending event', [
            'status' => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
        ]);
        $this->event((int) $user->id, 'Cancelled event', [
            'status' => 'cancelled',
            'publication_status' => 'published',
            'operational_status' => 'cancelled',
        ]);
        $this->event((int) $user->id, 'Recurring template', [
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 1,
        ]);

        $result = (new FeedService(new FeedActivity(), new FeedPost()))->getFeed(
            (int) $user->id,
            ['type' => 'events', 'mode' => 'chronological', 'limit' => 100],
        );

        $ownVisibleIds = array_values(array_intersect(
            array_column($result['items'], 'id'),
            $this->eventIds,
        ));
        self::assertSame([$publishedId], $ownVisibleIds);
    }

    /**
     * A finished event stays "published + scheduled" in the database — nothing
     * moves it to completed when its time passes — so the lifecycle check alone
     * kept past events on the feed after the events page had dropped them.
     */
    public function test_feed_hides_events_that_have_already_finished(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->userIds[] = (int) $user->id;

        $live = [
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
        ];
        $upcomingId = $this->event((int) $user->id, 'Upcoming event', $live);
        $runningId = $this->event((int) $user->id, 'Running event', $live + [
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);
        $this->event((int) $user->id, 'Finished event', $live + [
            'start_time' => now()->subDays(2),
            'end_time' => now()->subDays(2)->addHours(2),
        ]);
        $this->event((int) $user->id, 'Past event without an end time', $live + [
            'start_time' => now()->subDay(),
            'end_time' => null,
        ]);

        $service = new FeedService(new FeedActivity(), new FeedPost());
        foreach (['events', 'all'] as $type) {
            $result = $service->getFeed(
                (int) $user->id,
                ['type' => $type, 'mode' => 'chronological', 'limit' => 100],
            );

            $ownVisibleIds = array_values(array_intersect(
                array_column(array_filter(
                    $result['items'],
                    static fn (array $item): bool => ($item['type'] ?? null) === 'event',
                ), 'id'),
                $this->eventIds,
            ));
            sort($ownVisibleIds);
            $expected = [$upcomingId, $runningId];
            sort($expected);
            self::assertSame($expected, $ownVisibleIds, "feed type={$type}");
        }
    }

    /** @param array<string,mixed> $lifecycle */
    private function event(int $userId, string $title, array $lifecycle): int
    {
        $id = (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => $title,
            'description' => $title . ' description',
            'location' => 'Community venue',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHour(),
            'is_recurring_template' => 0,
            'lifecycle_version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $lifecycle));
        $this->eventIds[] = $id;

        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'source_type' => 'event',
            'source_id' => $id,
            'title' => $title,
            'content' => $title . ' description',
            'metadata' => json_encode([
                'start_date' => now()->addWeek()->toIso8601String(),
                'location' => 'Community venue',
            ], JSON_THROW_ON_ERROR),
            'is_visible' => 1,
            'created_at' => now(),
        ]);

        return $id;
    }
}
