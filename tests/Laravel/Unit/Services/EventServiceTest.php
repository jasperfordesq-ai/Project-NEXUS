<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Laravel\TestCase;

class EventServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(int $userId, string $startTime, array $overrides = []): int
    {
        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Event service test ' . uniqid(),
            'description' => 'Database-backed EventService regression coverage.',
            'start_time' => $startTime,
            'end_time' => date('Y-m-d H:i:s', strtotime($startTime) + 3600),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    public function test_getAll_returns_expected_structure(): void
    {
        $user = $this->user();
        $eventId = $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'));

        $result = EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
            'when' => 'upcoming',
            'limit' => 20,
        ]);

        $this->assertSame(['items', 'cursor', 'has_more'], array_keys($result));
        $this->assertSame([$eventId], array_column($result['items'], 'id'));
        $this->assertNull($result['cursor']);
        $this->assertFalse($result['has_more']);
    }

    public function test_getAll_filters_by_upcoming_by_default(): void
    {
        $user = $this->user();
        $pastId = $this->event($user->id, now()->subDay()->format('Y-m-d H:i:s'));
        $futureId = $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'));

        $result = EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
        ]);
        $ids = array_column($result['items'], 'id');

        $this->assertContains($futureId, $ids);
        $this->assertNotContains($pastId, $ids);
    }

    public function test_getAll_applies_cursor_pagination(): void
    {
        $user = $this->user();
        $firstId = $this->event($user->id, now()->addDays(1)->format('Y-m-d H:i:s'));
        $secondId = $this->event($user->id, now()->addDays(2)->format('Y-m-d H:i:s'));

        $pageOne = EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
            'limit' => 1,
        ]);
        $this->assertTrue($pageOne['has_more']);
        $this->assertNotNull($pageOne['cursor']);

        $pageTwo = EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
            'limit' => 1,
            'cursor' => $pageOne['cursor'],
        ]);
        $seen = array_merge(
            array_column($pageOne['items'], 'id'),
            array_column($pageTwo['items'], 'id'),
        );

        $this->assertEqualsCanonicalizing([$firstId, $secondId], $seen);
        $this->assertCount(2, array_unique($seen));
    }

    public function test_getAll_filters_each_step_free_accessibility_state(): void
    {
        $user = $this->user();
        $yesId = $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'), [
            'accessibility_step_free' => true,
        ]);
        $noId = $this->event($user->id, now()->addDays(2)->format('Y-m-d H:i:s'), [
            'accessibility_step_free' => false,
        ]);
        $unknownId = $this->event($user->id, now()->addDays(3)->format('Y-m-d H:i:s'), [
            'accessibility_step_free' => null,
        ]);

        foreach ([
            'yes' => $yesId,
            'no' => $noId,
            'unknown' => $unknownId,
        ] as $stepFree => $expectedId) {
            $result = EventService::getAll([
                'viewer_id' => $user->id,
                'user_id' => $user->id,
                'step_free' => $stepFree,
            ]);

            $this->assertSame([$expectedId], array_column($result['items'], 'id'), $stepFree);
        }
    }

    public function test_getAll_applies_step_free_filter_inside_series_collapse(): void
    {
        $user = $this->user();
        $inaccessibleRootId = $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'), [
            'accessibility_step_free' => false,
        ]);
        $accessibleOccurrenceId = $this->event($user->id, now()->addDays(2)->format('Y-m-d H:i:s'), [
            'parent_event_id' => $inaccessibleRootId,
            'accessibility_step_free' => true,
        ]);

        $result = EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
            'step_free' => 'yes',
        ]);

        $this->assertSame([$accessibleOccurrenceId], array_column($result['items'], 'id'));
    }

    public function test_getAll_cursor_is_bound_to_normalized_step_free_filter(): void
    {
        $user = $this->user();
        $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'), [
            'accessibility_step_free' => true,
        ]);
        $this->event($user->id, now()->addDays(2)->format('Y-m-d H:i:s'), [
            'accessibility_step_free' => true,
        ]);

        $pageOne = EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
            'step_free' => 'yes',
            'limit' => 1,
        ]);
        $this->assertNotNull($pageOne['cursor']);

        $this->expectException(ValidationException::class);
        EventService::getAll([
            'viewer_id' => $user->id,
            'user_id' => $user->id,
            'step_free' => 'no',
            'limit' => 1,
            'cursor' => $pageOne['cursor'],
        ]);
    }

    public function test_getAll_rejects_unknown_step_free_filter_values(): void
    {
        $this->expectException(ValidationException::class);

        EventService::getAll(['step_free' => 'sometimes']);
    }

    /**
     * 🔴 canUpdateImage read the root event's publication_status through
     * `Builder::value()`, which APPLIES the model's casts and therefore hands back an
     * EventPublicationState enum — then cast it to string. That is a fatal Error, so
     * every cover-image change on an event with a publication status set died before
     * the authorisation answer was ever produced (NEXUS-PHP-4M).
     *
     * A published event must be allowed through; the assertion that matters is that
     * the call RETURNS AT ALL rather than throwing.
     */
    public function test_canUpdateImage_allows_a_published_event_and_does_not_choke_on_the_enum_cast(): void
    {
        $user = $this->user();
        $eventId = $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'), [
            'publication_status' => 'published',
        ]);

        $this->assertTrue(
            EventService::canUpdateImage($eventId, (int) $user->id),
            'A published event owned by the caller must be image-editable: ' . json_encode(EventService::getErrors()),
        );
    }

    /**
     * The other side of the same line: the pending-review refusal must still work.
     * Without this, the fix above could be "make it return true always" and pass.
     */
    public function test_canUpdateImage_still_refuses_an_event_awaiting_review(): void
    {
        $user = $this->user();
        $eventId = $this->event($user->id, now()->addDay()->format('Y-m-d H:i:s'), [
            'publication_status' => 'pending_review',
        ]);

        $this->assertFalse(EventService::canUpdateImage($eventId, (int) $user->id));
        $this->assertSame(
            ['EVENT_REVIEW_PENDING'],
            array_values(array_unique(array_column(EventService::getErrors(), 'code'))),
        );
    }
}
