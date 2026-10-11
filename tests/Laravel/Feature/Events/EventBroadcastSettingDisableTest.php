<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Contracts\EventBroadcastTransport;
use App\Core\TenantContext;
use App\Enums\EventBroadcastChannel;
use App\Enums\EventBroadcastDeliveryStatus;
use App\Enums\EventBroadcastStatus;
use App\Models\User;
use App\Services\EventBroadcastAudienceResolver;
use App\Services\EventBroadcastDeliveryConsumer;
use App\Services\EventBroadcastService;
use App\Services\EventConfigurationService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\Events\EventBroadcastRenderedMessage;
use App\Support\Events\EventBroadcastTransportResult;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Switching a community's organiser broadcasts off must stop broadcasts that
 * are already scheduled.
 *
 * The setting was only checked when a broadcast was created, scheduled or
 * retried, so anything already scheduled still went out — even though the
 * settings page counted those broadcasts as the impact of switching it off
 * and asked the admin to confirm.
 */
final class EventBroadcastSettingDisableTest extends TestCase
{
    use DatabaseTransactions;

    public function test_switching_broadcasts_off_cancels_scheduled_broadcasts(): void
    {
        $this->enableEvents();
        $organizer = $this->user('Setting Organizer');
        $recipient = $this->user('Setting Recipient');
        $eventId = $this->event((int) $organizer->id);
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcasts = $this->broadcastService();
        $scheduledId = $this->scheduledBroadcast($broadcasts, $eventId, $organizer, 'setting-off-scheduled');
        $draft = $broadcasts->createDraft(
            $eventId,
            $organizer,
            'announcement',
            ['registration_confirmed'],
            ['in_app'],
            'A draft is not going anywhere.',
            'setting-off-draft',
        );
        $draftId = (int) $draft['broadcast']->id;

        $config = app(EventConfigurationService::class);
        $config->update(
            $this->testTenantId,
            (int) $organizer->id,
            $config->inspect($this->testTenantId)['version'],
            ['organizer_broadcasts_enabled' => false],
            'Pausing organiser announcements',
            true,
        );

        self::assertSame(
            EventBroadcastStatus::Cancelled->value,
            (string) DB::table('event_broadcasts')->where('id', $scheduledId)->value('status'),
            'A scheduled broadcast must not survive its community switching broadcasts off.',
        );
        self::assertSame(0, DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $scheduledId)
            ->whereIn('status', [
                EventBroadcastDeliveryStatus::Pending->value,
                EventBroadcastDeliveryStatus::Retry->value,
            ])
            ->count());
        $history = DB::table('event_broadcast_history')
            ->where('broadcast_id', $scheduledId)
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($history);
        self::assertSame('cancelled', (string) $history->action);
        self::assertStringContainsString('events_configuration', (string) $history->metadata);
        // Drafts cannot be scheduled while the setting is off; leave them.
        self::assertSame(
            EventBroadcastStatus::Draft->value,
            (string) DB::table('event_broadcasts')->where('id', $draftId)->value('status'),
        );
        self::assertSame(0, $config->inspect($this->testTenantId)['impact']['scheduled_broadcasts']);
    }

    public function test_a_queued_broadcast_is_suppressed_when_the_setting_is_off_at_delivery_time(): void
    {
        $this->enableEvents();
        $organizer = $this->user('Race Organizer');
        $recipient = $this->user('Race Recipient');
        $eventId = $this->event((int) $organizer->id);
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcasts = $this->broadcastService();
        $broadcastId = $this->scheduledBroadcast($broadcasts, $eventId, $organizer, 'setting-race');

        // Switched off without the cascade having reached this broadcast (a
        // race between the settings save and the delivery worker).
        $root = json_decode(
            (string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'),
            true,
        );
        $root = is_array($root) ? $root : [];
        $root['events']['organizer_broadcasts_enabled'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($root, JSON_THROW_ON_ERROR),
        ]);

        $transport = new class implements EventBroadcastTransport
        {
            public int $calls = 0;

            public function send(
                EventBroadcastChannel $channel,
                int $tenantId,
                int $eventId,
                object $recipient,
                EventBroadcastRenderedMessage $message,
                string $deliveryKey,
                string $emailCadence,
            ): EventBroadcastTransportResult {
                $this->calls++;

                return new EventBroadcastTransportResult('test_transport', 'evidence');
            }
        };
        $summary = (new EventBroadcastDeliveryConsumer(
            $broadcasts,
            $this->safeguarding(),
            transport: $transport,
        ))->processBatch(10, $this->testTenantId);

        self::assertSame(0, $transport->calls, 'Nothing may be sent once broadcasts are switched off.');
        self::assertSame(1, $summary['suppressed']);
        self::assertSame(0, $summary['delivered']);
        $delivery = DB::table('event_broadcast_deliveries')->where('broadcast_id', $broadcastId)->first();
        self::assertNotNull($delivery);
        self::assertSame(EventBroadcastDeliveryStatus::Suppressed->value, (string) $delivery->status);
        self::assertSame('organizer_broadcasts_disabled', (string) $delivery->suppression_reason);
    }

    private function scheduledBroadcast(
        EventBroadcastService $broadcasts,
        int $eventId,
        User $organizer,
        string $key,
    ): int {
        $created = $broadcasts->createDraft(
            $eventId,
            $organizer,
            'announcement',
            ['registration_confirmed'],
            ['in_app'],
            'Doors open at seven.',
            $key . '-create',
        );
        $broadcastId = (int) $created['broadcast']->id;
        $broadcasts->schedule($broadcastId, $organizer, 1, null, $key . '-schedule');
        self::assertSame(1, DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $broadcastId)
            ->where('status', EventBroadcastDeliveryStatus::Pending->value)
            ->count());

        return $broadcastId;
    }

    private function enableEvents(): void
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
    }

    private function safeguarding(): SafeguardingInteractionPolicy
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertManyLocalContactsAllowed')->zeroOrMoreTimes();
        $policy->shouldReceive('assertLocalContactAllowed')->zeroOrMoreTimes();

        return $policy;
    }

    private function broadcastService(): EventBroadcastService
    {
        return new EventBroadcastService(new EventBroadcastAudienceResolver($this->safeguarding()));
    }

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
            'title' => 'Broadcast setting fixture',
            'description' => 'Broadcast setting fixture.',
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
            'occurrence_key' => 'broadcast-setting:' . bin2hex(random_bytes(12)),
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
}
