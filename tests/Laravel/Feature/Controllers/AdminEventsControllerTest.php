<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminEventsController.
 *
 * Covers index, show, approve, destroy, and cancel.
 */
class AdminEventsControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        Config::set('events.notification_delivery.mode', 'direct');
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
    }

    private function eventActionOutboxCountForRecipient(
        int $eventId,
        string $action,
        int $recipientUserId,
    ): int {
        return DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', $action)
            ->get(['payload'])
            ->filter(static function (object $row) use ($recipientUserId): bool {
                $payload = json_decode((string) $row->payload, true);

                return is_array($payload)
                    && (int) ($payload['recipient_user_id'] ?? 0) === $recipientUserId;
            })
            ->count();
    }

    /** @param array<string,mixed> $overrides */
    private function createEvent(int $tenantId, array $overrides = [], ?User $organizer = null): int
    {
        $organizer ??= User::factory()->forTenant($tenantId)->create();
        $start = now()->addDays(7);

        return DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'user_id' => $organizer->id,
            'title' => 'Test Event',
            'description' => 'A test event description',
            'status' => 'active',
            'publication_status' => null,
            'operational_status' => null,
            'lifecycle_version' => null,
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function setDailyNotificationPreference(int $userId): void
    {
        DB::table('notification_settings')->insert([
            'user_id' => $userId,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => 'daily',
        ]);
    }

    // ================================================================
    // INDEX — GET /v2/admin/events
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/events');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'meta']);
    }

    public function test_index_returns_correct_data_with_events(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->createEvent($this->testTenantId, [
            'start_time' => '2026-07-01 13:00:00',
            'end_time' => '2026-07-01 15:00:00',
        ]);

        $response = $this->apiGet('/v2/admin/events');

        $response->assertStatus(200);
        $response->assertJsonPath('meta.total', 1);
        // Stored timestamps are zone-less UTC; the client must receive them
        // with an explicit offset or it parses them as browser-local time
        // (E-104: the admin list showed 13:00 IST for a 14:00 IST event).
        $response->assertJsonPath('data.0.start_at', '2026-07-01T13:00:00+00:00');
        $response->assertJsonPath('data.0.start_date', '2026-07-01T13:00:00+00:00');
        $response->assertJsonPath('data.0.end_date', '2026-07-01T15:00:00+00:00');
    }

    /**
     * E-104 (13 Oct 2026): one row whose legacy `events.status` disagreed with
     * its canonical lifecycle columns made the whole admin list answer 500, so
     * the moderation queue was unusable. The list must degrade per row.
     */
    public function test_index_lists_an_event_whose_legacy_status_disagrees_with_its_lifecycle(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $healthy = $this->createEvent($this->testTenantId, [
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
        ]);
        $inconsistent = $this->createEvent($this->testTenantId, [
            'title' => 'Archived but still active',
            'status' => 'active',
            'publication_status' => 'archived',
            'operational_status' => 'scheduled',
        ]);

        $response = $this->apiGet('/v2/admin/events');

        $response->assertStatus(200);
        $rows = collect($response->json('data'))->keyBy('id');
        $this->assertTrue($rows->has($healthy) && $rows->has($inconsistent));
        $this->assertSame('published', $rows[$healthy]['publication_state']);
        $this->assertFalse($rows[$healthy]['lifecycle_inconsistent']);
        // The canonical columns win; the row is flagged, not hidden and not fatal.
        $this->assertSame('archived', $rows[$inconsistent]['publication_state']);
        $this->assertSame('scheduled', $rows[$inconsistent]['operational_state']);
        $this->assertTrue($rows[$inconsistent]['lifecycle_inconsistent']);

        $this->apiGet('/v2/admin/events/' . $inconsistent)
            ->assertStatus(200)
            ->assertJsonPath('data.lifecycle_inconsistent', true);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/events');

        $response->assertStatus(403);
    }

    public function test_pending_review_index_paginates_canonical_roots_instead_of_series_occurrences(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);
        $templateId = $this->createEvent($this->testTenantId, [
            'title' => 'Large pending series root',
            'status' => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 1,
        ], $organizer);
        $occurrenceIds = [];
        for ($index = 1; $index <= 105; $index++) {
            $occurrenceIds[] = $this->createEvent($this->testTenantId, [
                'title' => "Pending series occurrence {$index}",
                'status' => 'draft',
                'publication_status' => 'pending_review',
                'operational_status' => 'scheduled',
                'parent_event_id' => $templateId,
                'is_recurring_template' => 0,
                'start_time' => now()->addDays($index),
                'end_time' => now()->addDays($index)->addHour(),
            ], $organizer);
        }
        $standaloneId = $this->createEvent($this->testTenantId, [
            'title' => 'Unrelated pending standalone Event',
            'status' => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
        ], $organizer);

        $response = $this->apiGet('/v2/admin/events?publication_state=pending_review&per_page=100')
            ->assertOk()
            ->assertJsonPath('meta.total', 2);
        $ids = array_map('intval', array_column($response->json('data'), 'id'));
        sort($ids);
        $expected = [$templateId, $standaloneId];
        sort($expected);
        self::assertSame($expected, $ids);
        self::assertSame([], array_values(array_intersect($occurrenceIds, $ids)));

        $root = collect($response->json('data'))->firstWhere('id', $templateId);
        self::assertIsArray($root);
        self::assertTrue($root['is_recurring_template']);
        self::assertSame(105, $root['series']['occurrence_count']);
        self::assertSame(105, $root['series']['future_occurrence_count']);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/events');

        $response->assertStatus(401);
    }

    // ================================================================
    // SHOW — GET /v2/admin/events/{id}
    // ================================================================

    public function test_show_returns_event_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $eventId = $this->createEvent($this->testTenantId);

        $response = $this->apiGet("/v2/admin/events/{$eventId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_show_returns_404_for_nonexistent_event(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/events/999999');

        $response->assertStatus(404);
    }

    public function test_show_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/events/1');

        $response->assertStatus(403);
    }

    // ================================================================
    // APPROVE — POST /v2/admin/events/{id}/approve
    // ================================================================

    public function test_approve_uses_event_owner_and_is_idempotent(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'preferred_language' => 'en',
        ]);
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Pending event',
            'description' => 'Awaiting moderation.',
            'status' => 'draft',
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/events/{$eventId}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.publication_state', 'published')
            ->assertJsonPath('data.operational_state', 'scheduled')
            ->assertJsonPath('data.lifecycle_version', 1)
            ->assertJsonPath('data.transition.changed', true);

        $this->assertDatabaseHas('events', [
            'id' => $eventId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
        ]);
        $this->assertSame(1, DB::table('event_status_history')->where('event_id', $eventId)->count());
        $this->assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.lifecycle.transitioned')
            ->count());
        $this->assertSame(0, $this->eventActionOutboxCountForRecipient(
            $eventId,
            'event.admin_publication.created',
            (int) $admin->id,
        ));
        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $organizer->id)
            ->where('link', "/events/{$eventId}")
            ->count());

        $this->apiPost("/v2/admin/events/{$eventId}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.transition.changed', false);
        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $organizer->id)
            ->where('link', "/events/{$eventId}")
            ->count());
        $this->assertSame(1, DB::table('event_status_history')->where('event_id', $eventId)->count());
        $this->assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.lifecycle.transitioned')
            ->count());
        $this->assertSame(0, $this->eventActionOutboxCountForRecipient(
            $eventId,
            'event.admin_publication.created',
            (int) $admin->id,
        ));
    }

    public function test_approve_does_not_cross_tenant_boundary(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $eventId = $this->createEvent(999);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/events/{$eventId}/approve")
            ->assertNotFound();
    }

    public function test_approve_is_tenant_admin_only(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $eventId = $this->createEvent($this->testTenantId, ['status' => 'draft']);
        Sanctum::actingAs($member);

        $this->apiPost("/v2/admin/events/{$eventId}/approve")->assertForbidden();
        $this->assertDatabaseHas('events', [
            'id' => $eventId,
            'status' => 'draft',
            'publication_status' => null,
        ]);
    }

    public function test_every_admin_lifecycle_action_is_tenant_scoped(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $eventId = $this->createEvent(999, [
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);
        Sanctum::actingAs($admin);

        foreach (['approve', 'reject', 'postpone', 'cancel', 'complete', 'archive', 'restore', 'reschedule'] as $action) {
            $this->apiPost("/v2/admin/events/{$eventId}/{$action}", ['reason' => 'tenant.boundary'])
                ->assertNotFound();
        }
        $this->apiDelete("/v2/admin/events/{$eventId}")->assertNotFound();

        $this->assertDatabaseHas('events', [
            'id' => $eventId,
            'tenant_id' => 999,
            'lifecycle_version' => 0,
        ]);
        $this->assertSame(0, DB::table('event_status_history')->where('event_id', $eventId)->count());
    }

    public function test_authoritative_outbox_mode_does_not_dual_dispatch_publication_side_effects(): void
    {
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $eventId = $this->createEvent($this->testTenantId, [
            'status' => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/events/{$eventId}/approve")
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'published');

        $this->assertDatabaseHas('event_domain_outbox', [
            'event_id' => $eventId,
            'action' => 'event.lifecycle.transitioned',
            'production_mode' => 'outbox_authoritative',
            'status' => 'pending',
        ]);
        $this->assertSame(0, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.admin_publication.created')
            ->count());
        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('link', "/events/{$eventId}")
            ->count());
    }

    // ================================================================
    // DELETE — DELETE /v2/admin/events/{id}
    // ================================================================

    public function test_destroy_archives_instead_of_deleting_and_is_idempotent(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $eventId = $this->createEvent($this->testTenantId);

        $this->apiDelete("/v2/admin/events/{$eventId}", ['reason' => 'operations.event_retired'])
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'archived')
            ->assertJsonPath('data.operational_state', 'cancelled')
            ->assertJsonPath('data.transition.action', 'archive')
            ->assertJsonPath('data.transition.changed', true);

        $this->assertDatabaseHas('events', [
            'id' => $eventId,
            'tenant_id' => $this->testTenantId,
            'publication_status' => 'archived',
            'operational_status' => 'cancelled',
            'status' => 'cancelled',
        ]);
        $this->apiDelete("/v2/admin/events/{$eventId}")
            ->assertOk()
            ->assertJsonPath('data.transition.changed', false);
        $this->assertSame(1, DB::table('event_status_history')->where('event_id', $eventId)->count());
    }

    public function test_destroy_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiDelete('/v2/admin/events/1');

        $response->assertStatus(403);
    }

    // ================================================================
    // CANCEL — POST /v2/admin/events/{id}/cancel
    // ================================================================

    public function test_cancel_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/events/1/cancel', [
            'reason' => 'Test cancellation',
        ]);

        $response->assertStatus(403);
    }

    public function test_cancel_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/events/1/cancel');

        $response->assertStatus(401);
    }

    public function test_admin_cancel_and_archive_fan_out_from_a_template_to_future_occurrences(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        foreach (['cancel', 'archive'] as $action) {
            $templateId = $this->createEvent($this->testTenantId, [
                'title' => "Admin {$action} series",
                'status' => 'active',
                'publication_status' => 'published',
                'operational_status' => 'scheduled',
                'is_recurring_template' => 1,
            ], $organizer);
            $occurrenceIds = [];
            foreach ([2, 3] as $weeks) {
                $occurrenceIds[] = $this->createEvent($this->testTenantId, [
                    'title' => "Admin {$action} occurrence {$weeks}",
                    'status' => 'active',
                    'publication_status' => 'published',
                    'operational_status' => 'scheduled',
                    'parent_event_id' => $templateId,
                    'start_time' => now()->addWeeks($weeks),
                    'end_time' => now()->addWeeks($weeks)->addHour(),
                ], $organizer);
            }

            $this->apiPost("/v2/admin/events/{$templateId}/{$action}", [
                'reason' => "Admin {$action} series regression",
            ])
                ->assertOk()
                ->assertJsonPath('data.transition.series.target_count', 3)
                ->assertJsonPath('data.transition.series.changed_count', 3);

            $rows = DB::table('events')
                ->whereIn('id', array_merge([$templateId], $occurrenceIds))
                ->orderBy('id')
                ->get(['publication_status', 'operational_status']);
            self::assertCount(3, $rows);
            foreach ($rows as $row) {
                self::assertSame('cancelled', $row->operational_status);
                self::assertSame(
                    $action === 'archive' ? 'archived' : 'published',
                    $row->publication_status,
                );
            }
        }
    }

    public function test_admin_cancel_notifies_attendees_waitlist_and_organizer(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'admin-cancel-organizer-' . uniqid('', true) . '@example.test',
        ]);
        $attendee = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'admin-cancel-attendee-' . uniqid('', true) . '@example.test',
        ]);
        $waitlisted = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'admin-cancel-waitlisted-' . uniqid('', true) . '@example.test',
        ]);
        Sanctum::actingAs($admin);

        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Admin Cancel Event',
            'description' => 'A test event description',
            'status' => 'active',
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHours(2),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $waitlisted->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDays(7)->subHour(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ([$organizer, $attendee, $waitlisted] as $user) {
            $this->setDailyNotificationPreference((int) $user->id);
        }

        $response = $this->apiPost("/v2/admin/events/{$eventId}/cancel", [
            'reason' => 'Venue closed',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.publication_state', 'published')
            ->assertJsonPath('data.operational_state', 'cancelled')
            ->assertJsonPath('data.transition.changed', true)
            ->assertJsonPath('data.transition.cascade.reminders_cancelled', 1)
            ->assertJsonPath('data.transition.cascade.waitlist_cancelled', 1)
            ->assertJsonPath('data.transition.cascade.registrations_cancelled', 1);
        $this->assertDatabaseHas('event_rsvps', [
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'cancelled',
        ]);
        $this->assertDatabaseHas('event_waitlist', [
            'event_id' => $eventId,
            'user_id' => $waitlisted->id,
            'status' => 'cancelled',
        ]);
        $this->assertDatabaseHas('event_reminders', [
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'cancelled',
        ]);
        $this->assertSame(3, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('link', "/events/{$eventId}")->where('type', 'event')->count());
        $this->assertSame(3, DB::table('notification_queue')->where('tenant_id', $this->testTenantId)->where('link', "/events/{$eventId}")->where('activity_type', 'event_cancellation')->count());

        $this->apiPost("/v2/admin/events/{$eventId}/cancel", ['reason' => 'Venue closed'])
            ->assertOk()
            ->assertJsonPath('data.transition.changed', false);
        $this->assertSame(3, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('link', "/events/{$eventId}")->where('type', 'event')->count());
        $this->assertSame(1, DB::table('event_status_history')->where('event_id', $eventId)->count());
        $this->assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.lifecycle.transitioned')
            ->count());
    }

    public function test_named_moderation_and_operational_actions_follow_the_state_machine(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        $eventId = $this->createEvent($this->testTenantId, [
            'title' => 'Moderated lifecycle event',
            'status' => 'draft',
            'publication_status' => EventPublicationState::PendingReview->value,
            'operational_status' => EventOperationalState::Scheduled->value,
            'lifecycle_version' => 0,
        ], $organizer);
        DB::table('content_moderation_queue')->insert([
            'tenant_id' => $this->testTenantId,
            'content_type' => 'event',
            'content_id' => $eventId,
            'author_id' => $organizer->id,
            'title' => 'Moderated lifecycle event',
            'status' => 'pending',
            'auto_flagged' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/events/{$eventId}/reject")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'reason');
        $this->apiPost("/v2/admin/events/{$eventId}/reject", ['reason' => 'moderation.revision_required'])
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'draft')
            ->assertJsonPath('data.lifecycle_version', 1);
        $this->apiPost("/v2/admin/events/{$eventId}/approve")
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'published')
            ->assertJsonPath('data.lifecycle_version', 2);
        $this->apiPost("/v2/admin/events/{$eventId}/postpone", ['reason' => 'operations.weather'])
            ->assertOk()
            ->assertJsonPath('data.operational_state', 'postponed')
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.lifecycle_version', 3);
        $this->apiPost("/v2/admin/events/{$eventId}/reschedule", ['reason' => 'operations.new_slot'])
            ->assertOk()
            ->assertJsonPath('data.operational_state', 'scheduled')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.lifecycle_version', 4);
        $this->apiPost("/v2/admin/events/{$eventId}/complete")
            ->assertOk()
            ->assertJsonPath('data.operational_state', 'completed')
            ->assertJsonPath('data.lifecycle_version', 5);
        $this->apiPost("/v2/admin/events/{$eventId}/archive", ['reason' => 'operations.series_complete'])
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'archived')
            ->assertJsonPath('data.operational_state', 'completed')
            ->assertJsonPath('data.lifecycle_version', 6);
        $this->apiPost("/v2/admin/events/{$eventId}/restore")
            ->assertStatus(409);

        $this->assertSame(6, DB::table('event_status_history')->where('event_id', $eventId)->count());
        $this->assertSame(6, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.lifecycle.transitioned')
            ->count());
    }

    public function test_archive_and_restore_reschedule_a_live_event_without_deleting_it(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $eventId = $this->createEvent($this->testTenantId, [
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/events/{$eventId}/archive", ['reason' => 'operations.schedule_replaced'])
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'archived')
            ->assertJsonPath('data.operational_state', 'cancelled');
        $this->apiPost("/v2/admin/events/{$eventId}/restore")
            ->assertOk()
            ->assertJsonPath('data.publication_state', 'draft')
            ->assertJsonPath('data.operational_state', 'scheduled')
            ->assertJsonPath('data.status', 'draft');

        $this->assertDatabaseHas('events', ['id' => $eventId, 'lifecycle_version' => 2]);
    }

    public function test_admin_projection_reports_real_counts_and_combined_filters(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Projection Organizer',
        ]);
        $attendee = User::factory()->forTenant($this->testTenantId)->create();
        $interested = User::factory()->forTenant($this->testTenantId)->create();
        $waitlisted = User::factory()->forTenant($this->testTenantId)->create();
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $organizer->id,
            'name' => 'Projection Group',
            'slug' => 'projection-group-' . uniqid(),
            'description' => null,
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $start = now()->addDays(9)->startOfHour();
        $eventId = $this->createEvent($this->testTenantId, [
            'title' => 'Unique projection workshop',
            'group_id' => $groupId,
            'status' => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 4,
            'max_attendees' => 1,
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
        ], $organizer);
        foreach ([[$attendee->id, 'going'], [$interested->id, 'interested']] as [$userId, $status]) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $waitlisted->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'checked_in_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $query = http_build_query([
            'publication_state' => 'pending_review',
            'operational_state' => 'scheduled',
            'organizer_id' => $organizer->id,
            'group_id' => $groupId,
            'date_from' => $start->toDateString(),
            'date_to' => $start->toDateString(),
            'capacity' => 'full',
            'search' => 'Unique projection',
        ]);
        $this->apiGet('/v2/admin/events?' . $query)
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $eventId)
            ->assertJsonPath('data.0.publication_state', 'pending_review')
            ->assertJsonPath('data.0.operational_state', 'scheduled')
            ->assertJsonPath('data.0.lifecycle_version', 4)
            ->assertJsonPath('data.0.capacity.confirmed', 1)
            ->assertJsonPath('data.0.capacity.is_full', true)
            ->assertJsonPath('data.0.metrics.interested_count', 1)
            ->assertJsonPath('data.0.metrics.waitlist_count', 1)
            ->assertJsonPath('data.0.metrics.attendance_count', 1)
            ->assertJsonPath('data.0.organizer.id', $organizer->id)
            ->assertJsonPath('data.0.group.id', $groupId);
    }

    public function test_admin_projection_is_canonical_first_and_reserves_live_offers(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalConfirmed = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalCancelled = User::factory()->forTenant($this->testTenantId)->create();
        $legacyConfirmed = User::factory()->forTenant($this->testTenantId)->create();
        $offered = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalWaiting = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalWaitlistCancelled = User::factory()->forTenant($this->testTenantId)->create();
        $legacyWaiting = User::factory()->forTenant($this->testTenantId)->create();
        $now = now();
        $eventId = $this->createEvent($this->testTenantId, [
            'title' => 'Canonical admin projection fixture',
            'max_attendees' => 3,
        ], $organizer);

        DB::table('event_registrations')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $canonicalConfirmed->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'confirmed',
                'registration_version' => 1,
                'state_changed_at' => $now,
                'state_changed_by' => $canonicalConfirmed->id,
                'confirmed_at' => $now,
                'cancelled_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $canonicalCancelled->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'cancelled',
                'registration_version' => 2,
                'state_changed_at' => $now,
                'state_changed_by' => $canonicalCancelled->id,
                'confirmed_at' => null,
                'cancelled_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        foreach ([
            [$canonicalConfirmed->id, 'going'],
            [$canonicalCancelled->id, 'going'],
            [$legacyConfirmed->id, 'attended'],
        ] as [$userId, $status]) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'status' => $status,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        DB::table('event_waitlist_entries')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $offered->id,
                'capacity_pool_key' => 'event',
                'queue_state' => 'offered',
                'queue_version' => 2,
                'queue_sequence' => 1,
                'state_changed_at' => $now,
                'state_changed_by' => $organizer->id,
                'offered_at' => $now,
                'offer_expires_at' => $now->copy()->addHour(),
                'offer_token_hash' => hash('sha256', 'admin-capacity-offer'),
                'cancelled_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $canonicalWaiting->id,
                'capacity_pool_key' => 'event',
                'queue_state' => 'waiting',
                'queue_version' => 1,
                'queue_sequence' => 2,
                'state_changed_at' => $now,
                'state_changed_by' => $canonicalWaiting->id,
                'offered_at' => null,
                'offer_expires_at' => null,
                'offer_token_hash' => null,
                'cancelled_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $canonicalWaitlistCancelled->id,
                'capacity_pool_key' => 'event',
                'queue_state' => 'cancelled',
                'queue_version' => 2,
                'queue_sequence' => 3,
                'state_changed_at' => $now,
                'state_changed_by' => $canonicalWaitlistCancelled->id,
                'offered_at' => null,
                'offer_expires_at' => null,
                'offer_token_hash' => null,
                'cancelled_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        foreach ([
            [$offered->id, 1],
            [$canonicalWaitlistCancelled->id, 2],
            [$legacyWaiting->id, 3],
        ] as [$userId, $position]) {
            DB::table('event_waitlist')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'position' => $position,
                'status' => 'waiting',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        Sanctum::actingAs($admin);
        $this->apiGet("/v2/admin/events/{$eventId}")
            ->assertOk()
            ->assertJsonPath('data.capacity.confirmed', 2)
            ->assertJsonPath('data.capacity.remaining', 0)
            ->assertJsonPath('data.capacity.is_full', true)
            ->assertJsonPath('data.metrics.confirmed_count', 2)
            ->assertJsonPath('data.metrics.waitlist_count', 3);
        $this->apiGet('/v2/admin/events?' . http_build_query([
            'capacity' => 'full',
            'search' => 'Canonical admin projection fixture',
        ]))
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $eventId);
    }

    public function test_invalid_lifecycle_and_date_filters_are_rejected(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiGet('/v2/admin/events?publication_state=unknown')->assertStatus(422);
        $this->apiGet('/v2/admin/events?operational_state=unknown')->assertStatus(422);
        $this->apiGet('/v2/admin/events?date_from=2030-99-99')->assertStatus(422);
        $this->apiGet('/v2/admin/events?capacity=unknown')->assertStatus(422);
    }
}
