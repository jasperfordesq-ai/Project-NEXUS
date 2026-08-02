<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventBroadcastDeliveryStatus;
use App\Enums\EventBroadcastStatus;
use App\Enums\EventOperationalState;
use App\Models\User;
use App\Services\EventBroadcastAudienceResolver;
use App\Services\EventBroadcastService;
use App\Services\EventLifecycleService;
use App\Services\SafeguardingInteractionPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Cancelling an event must take its unsent announcements with it.
 *
 * Registrations, the waitlist and reminder schedules were all cascaded on
 * cancellation; broadcasts were not — so an announcement scheduled before the
 * cancellation still went out afterwards, telling attendees to come to an
 * event that is no longer happening.
 */
final class EventCancellationCascadeTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $name): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'name' => $name,
            'first_name' => $name,
            'preferred_language' => 'en',
            'status' => 'active',
            'is_approved' => true,
            'notification_preferences' => [],
        ]);
    }

    private function event(int $organizerId): int
    {
        $start = CarbonImmutable::now('UTC')->addDay()->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Cancellation cascade fixture',
            'description' => 'Cancellation cascade fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'is_recurring_template' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'occurrence_key' => 'cancel-cascade:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function confirmedRegistration(int $eventId, int $userId, int $actorId): void
    {
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $actorId,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function broadcastService(int $organizerId, int $recipientId): EventBroadcastService
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertManyLocalContactsAllowed')
            ->with($organizerId, [$recipientId], $this->testTenantId, 'event_broadcast')
            ->zeroOrMoreTimes();
        $policy->shouldReceive('assertLocalContactAllowed')
            ->zeroOrMoreTimes();

        return new EventBroadcastService(new EventBroadcastAudienceResolver($policy));
    }

    public function test_cancelling_an_event_cancels_its_scheduled_broadcast_and_pending_deliveries(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
            'configuration' => json_encode([
                'notifications' => [
                    'event_defaults' => [
                        'channels' => [
                            'email' => false,
                            'in_app' => true,
                            'web_push' => false,
                            'fcm' => false,
                            'realtime' => false,
                        ],
                        'cadence' => 'instant',
                        'reminders_enabled' => true,
                    ],
                ],
            ], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $organizer = $this->user('Cascade Organizer');
        $recipient = $this->user('Cascade Recipient');
        $eventId = $this->event((int) $organizer->id);
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);

        $broadcasts = $this->broadcastService((int) $organizer->id, (int) $recipient->id);
        $created = $broadcasts->createDraft(
            $eventId,
            $organizer,
            'announcement',
            ['registration_confirmed'],
            ['in_app'],
            'Doors open at seven.',
            'cascade-create-1',
        );
        $broadcastId = (int) $created['broadcast']->id;
        $broadcasts->schedule($broadcastId, $organizer, 1, null, 'cascade-schedule-1');

        self::assertSame(
            EventBroadcastStatus::Scheduled->value,
            (string) DB::table('event_broadcasts')->where('id', $broadcastId)->value('status'),
        );
        self::assertSame(1, (int) DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $broadcastId)
            ->where('status', EventBroadcastDeliveryStatus::Pending->value)
            ->count());

        // Cancel the event itself.
        app(EventLifecycleService::class)->transition(
            $eventId,
            $organizer,
            null,
            EventOperationalState::Cancelled,
            'Venue flooded',
        );

        self::assertSame(
            EventBroadcastStatus::Cancelled->value,
            (string) DB::table('event_broadcasts')->where('id', $broadcastId)->value('status'),
            'A scheduled announcement must not survive its own event being cancelled.',
        );
        self::assertSame(0, (int) DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $broadcastId)
            ->whereIn('status', [
                EventBroadcastDeliveryStatus::Pending->value,
                EventBroadcastDeliveryStatus::Retry->value,
            ])
            ->count(), 'No delivery may still be queued for a cancelled event.');

        // The append-only history records the cascade, so an operator can see
        // WHY the broadcast was cancelled rather than finding it mysteriously
        // dead.
        $history = DB::table('event_broadcast_history')
            ->where('broadcast_id', $broadcastId)
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($history);
        self::assertStringContainsString('event_lifecycle', (string) $history->metadata);
    }

    public function test_a_draft_broadcast_is_also_cancelled_and_the_event_records_the_cascade(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $organizer = $this->user('Draft Organizer');
        $recipient = $this->user('Draft Recipient');
        $eventId = $this->event((int) $organizer->id);
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);

        $broadcasts = $this->broadcastService((int) $organizer->id, (int) $recipient->id);
        $created = $broadcasts->createDraft(
            $eventId,
            $organizer,
            'announcement',
            ['registration_confirmed'],
            ['in_app'],
            'Draft that never got scheduled.',
            'cascade-create-2',
        );
        $broadcastId = (int) $created['broadcast']->id;

        app(EventLifecycleService::class)->transition(
            $eventId,
            $organizer,
            null,
            EventOperationalState::Cancelled,
            'Speaker withdrew',
        );

        self::assertSame(
            EventBroadcastStatus::Cancelled->value,
            (string) DB::table('event_broadcasts')->where('id', $broadcastId)->value('status'),
        );

        // The lifecycle history reports what the cascade touched.
        $status = DB::table('event_status_history')
            ->where('event_id', $eventId)
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($status);
        self::assertStringContainsString('broadcasts_cancelled', (string) $status->metadata);
    }
}
