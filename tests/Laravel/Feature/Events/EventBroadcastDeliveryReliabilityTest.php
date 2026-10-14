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
use App\Enums\EventBroadcastStatus;
use App\Models\User;
use App\Services\EventBroadcastAudienceResolver;
use App\Services\EventBroadcastDeliveryConsumer;
use App\Services\EventBroadcastService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\Events\EventBroadcastRenderedMessage;
use App\Support\Events\EventBroadcastTransportResult;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use Tests\Laravel\TestCase;

/**
 * E-106: the organiser broadcast send path must deliver what it says it
 * delivered, survive a retry, never duplicate a bell notification, and never
 * leave a finished broadcast stuck in "sending".
 */
final class EventBroadcastDeliveryReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    private EventBroadcastService $broadcasts;

    protected function setUp(): void
    {
        parent::setUp();
        // No community email default: the out-of-the-box configuration (FN-1).
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
            'configuration' => json_encode([], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertManyLocalContactsAllowed')->zeroOrMoreTimes();
        $policy->shouldReceive('assertLocalContactAllowed')->zeroOrMoreTimes();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
        $this->broadcasts = new EventBroadcastService(new EventBroadcastAudienceResolver($policy));
    }

    // ---- FN-1: email cadence ------------------------------------------------

    public function test_email_goes_out_at_once_to_a_member_who_never_chose_a_digest(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $recipient = $this->member('No choice');
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcastId = $this->scheduledBroadcast($eventId, $organizer, ['email']);

        $transport = $this->recordingTransport();
        $summary = $this->consumer($transport)->processBatch(10, $this->testTenantId);

        self::assertSame(1, $summary['delivered'], 'A member who made no choice must receive the email.');
        self::assertSame(0, $summary['suppressed']);
        self::assertSame('instant', $transport->calls[0]['cadence']);
        self::assertSame(EventBroadcastStatus::Sent->value, $this->broadcastStatus($broadcastId));
    }

    public function test_a_member_who_turned_the_digest_off_is_still_skipped(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $recipient = $this->member('Chose off');
        $this->globalFrequency((int) $recipient->id, 'off');
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcastId = $this->scheduledBroadcast($eventId, $organizer, ['email']);

        $transport = $this->recordingTransport();
        $summary = $this->consumer($transport)->processBatch(10, $this->testTenantId);

        self::assertSame(0, $summary['delivered']);
        self::assertSame(1, $summary['suppressed']);
        self::assertSame([], $transport->calls);
        self::assertSame('email_cadence_off', DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $broadcastId)
            ->value('suppression_reason'));
    }

    public function test_a_member_on_the_daily_digest_keeps_the_daily_digest(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $recipient = $this->member('Daily');
        $this->globalFrequency((int) $recipient->id, 'daily');
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $this->scheduledBroadcast($eventId, $organizer, ['email']);

        $transport = $this->recordingTransport();
        $this->consumer($transport)->processBatch(10, $this->testTenantId);

        self::assertCount(1, $transport->calls);
        self::assertSame('daily', $transport->calls[0]['cadence']);
    }

    // ---- FN-2: retry must not crash the sender ------------------------------

    public function test_retrying_failed_deliveries_does_not_crash_the_next_batch(): void
    {
        config()->set('events.broadcast.max_attempts', 1);
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $recipient = $this->member('Unreachable');
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcastId = $this->scheduledBroadcast($eventId, $organizer, ['in_app']);

        $failing = $this->failingTransport();
        $first = $this->consumer($failing)->processBatch(10, $this->testTenantId);
        self::assertSame(1, $first['dead_lettered']);
        self::assertSame(EventBroadcastStatus::Failed->value, $this->broadcastStatus($broadcastId));

        $this->broadcasts->retryFailed(
            $broadcastId,
            $organizer,
            $this->version($broadcastId),
            'e106-retry-' . $broadcastId,
        );

        // Before the fix this threw a unique-key violation from inside the
        // failure handler, aborting the whole batch.
        $second = $this->consumer($failing)->processBatch(10, $this->testTenantId);
        self::assertSame(1, $second['dead_lettered']);
        self::assertSame(EventBroadcastStatus::Failed->value, $this->broadcastStatus($broadcastId));
        self::assertSame([1, 2], DB::table('event_broadcast_delivery_attempts')
            ->where('broadcast_id', $broadcastId)
            ->orderBy('attempt_number')
            ->pluck('attempt_number')
            ->map(static fn (mixed $n): int => (int) $n)
            ->all());
    }

    // ---- FN-3: one bell notification, however often it is delivered --------

    public function test_a_redelivered_in_app_message_creates_one_notification(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $recipient = $this->member('Bell');
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcastId = $this->scheduledBroadcast($eventId, $organizer, ['in_app']);
        $before = $this->notificationCount((int) $recipient->id);

        // The real dispatcher, as the scheduler uses it.
        $consumer = $this->consumer(null);
        $consumer->processBatch(10, $this->testTenantId);
        self::assertSame($before + 1, $this->notificationCount((int) $recipient->id));

        // Simulate the hand-off being repeated (a stale claim released after
        // the notification was written but before the row was acknowledged).
        $deliveryKey = (string) DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $broadcastId)
            ->value('delivery_key');
        $message = new EventBroadcastRenderedMessage('Subject', 'Body', '<p>Body</p>', '/events/' . $eventId, 'event_broadcast');
        (new \App\Services\EventBroadcastChannelDispatcher())->send(
            EventBroadcastChannel::InApp,
            $this->testTenantId,
            $eventId,
            $recipient,
            $message,
            $deliveryKey,
            'instant',
        );

        self::assertSame($before + 1, $this->notificationCount((int) $recipient->id));
    }

    // ---- FN-4: a finished broadcast is never left "sending" -----------------

    public function test_a_finished_broadcast_left_sending_is_closed_by_the_next_batch(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $recipient = $this->member('Stuck');
        $this->confirmedRegistration($eventId, (int) $recipient->id, (int) $organizer->id);
        $broadcastId = $this->scheduledBroadcast($eventId, $organizer, ['in_app']);

        // Deliver the only row by hand, as if the worker died before it
        // reconciled the broadcast.
        self::assertTrue($this->broadcasts->markSending($this->testTenantId, $broadcastId));
        $now = now();
        DB::table('event_broadcast_deliveries')->where('broadcast_id', $broadcastId)->update([
            'status' => 'processing',
            'attempts' => 1,
            'claim_token' => '00000000-0000-0000-0000-000000000106',
            'claimed_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('event_broadcast_deliveries')->where('broadcast_id', $broadcastId)->update([
            'status' => 'delivered',
            'delivered_at' => $now,
            'claim_token' => null,
            'claimed_at' => null,
            'provider' => 'test',
            'updated_at' => $now,
        ]);
        self::assertSame(EventBroadcastStatus::Sending->value, $this->broadcastStatus($broadcastId));

        $summary = $this->consumer($this->recordingTransport())->processBatch(10, $this->testTenantId);

        self::assertSame(0, $summary['claimed']);
        self::assertSame(1, $summary['reconciled']);
        self::assertSame(EventBroadcastStatus::Sent->value, $this->broadcastStatus($broadcastId));
    }

    // ---- FN-5: one scheduled run drains what is due ----------------------------

    public function test_one_run_of_the_sender_keeps_going_until_nothing_is_due(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        foreach (['A', 'B', 'C'] as $name) {
            $member = $this->member('Batch ' . $name);
            $this->confirmedRegistration($eventId, (int) $member->id, (int) $organizer->id);
        }
        $broadcastId = $this->scheduledBroadcast($eventId, $organizer, ['in_app']);

        // Batches of one: before E-106 a run processed exactly one batch.
        $exit = \Illuminate\Support\Facades\Artisan::call('events:process-broadcasts', [
            '--tenant' => (string) $this->testTenantId,
            '--limit' => '1',
            '--budget-seconds' => '30',
            '--json' => true,
        ]);

        self::assertSame(0, $exit);
        self::assertSame(3, DB::table('event_broadcast_deliveries')
            ->where('broadcast_id', $broadcastId)
            ->where('status', 'delivered')
            ->count());
        self::assertSame(EventBroadcastStatus::Sent->value, $this->broadcastStatus($broadcastId));
    }

    // ---- opt-in summary for the organiser screen ------------------------------

    public function test_the_list_explains_skipped_deliveries_only_when_asked(): void
    {
        [$organizer, $eventId] = $this->eventWithOrganizer();
        $optedOut = $this->member('Opted out');
        $this->globalFrequency((int) $optedOut->id, 'off');
        $this->confirmedRegistration($eventId, (int) $optedOut->id, (int) $organizer->id);
        $this->scheduledBroadcast($eventId, $organizer, ['email']);
        $this->consumer($this->recordingTransport())->processBatch(10, $this->testTenantId);
        \Laravel\Sanctum\Sanctum::actingAs($organizer, ['*']);

        $plain = $this->apiGet("/v2/events/{$eventId}/broadcasts");
        $plain->assertOk()->assertJsonMissingPath('data.0.summary');

        $withSummary = $this->apiGet("/v2/events/{$eventId}/broadcasts?include=summary");
        $withSummary->assertOk()
            ->assertJsonPath('data.0.summary.excerpt', 'Doors open at 18:30.')
            ->assertJsonPath('data.0.summary.skipped_reasons.email_cadence_off', 1)
            ->assertJsonPath('data.0.summary.failed_reasons', []);
        // An empty reason map must be a JSON object, never a list.
        self::assertStringContainsString('"failed_reasons":{}', (string) $withSummary->getContent());
        self::assertStringNotContainsString((string) $optedOut->email, (string) $withSummary->getContent());
    }

    // ---- helpers -------------------------------------------------------------

    /** @return array{0:User,1:int} */
    private function eventWithOrganizer(): array
    {
        $organizer = $this->member('Organizer');
        $start = CarbonImmutable::now('UTC')->addDay()->startOfHour();
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $organizer->id,
            'title' => 'E-106 broadcast reliability',
            'description' => 'Fixture.',
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
            'occurrence_key' => 'e106:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$organizer, $eventId];
    }

    private function member(string $name): User
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

    private function globalFrequency(int $userId, string $frequency): void
    {
        DB::table('notification_settings')->insert([
            'user_id' => $userId,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => $frequency,
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

    /** @param list<string> $channels */
    private function scheduledBroadcast(int $eventId, User $organizer, array $channels): int
    {
        $created = $this->broadcasts->createDraft(
            $eventId,
            $organizer,
            'announcement',
            ['registration_confirmed'],
            $channels,
            'Doors open at 18:30.',
            'e106-create-' . $eventId . '-' . implode('-', $channels),
        );
        $broadcastId = (int) $created['broadcast']->id;
        $this->broadcasts->schedule($broadcastId, $organizer, 1, null, 'e106-schedule-' . $broadcastId);

        return $broadcastId;
    }

    private function consumer(?EventBroadcastTransport $transport): EventBroadcastDeliveryConsumer
    {
        return new EventBroadcastDeliveryConsumer(
            $this->broadcasts,
            $this->app->make(SafeguardingInteractionPolicy::class),
            transport: $transport,
        );
    }

    private function recordingTransport(): EventBroadcastTransport
    {
        return new class implements EventBroadcastTransport
        {
            /** @var list<array{channel:string,cadence:string}> */
            public array $calls = [];

            public function send(
                EventBroadcastChannel $channel,
                int $tenantId,
                int $eventId,
                object $recipient,
                EventBroadcastRenderedMessage $message,
                string $deliveryKey,
                string $emailCadence,
            ): EventBroadcastTransportResult {
                $this->calls[] = ['channel' => $channel->value, 'cadence' => $emailCadence];

                return new EventBroadcastTransportResult('test_transport', $deliveryKey);
            }
        };
    }

    private function failingTransport(): EventBroadcastTransport
    {
        return new class implements EventBroadcastTransport
        {
            public function send(
                EventBroadcastChannel $channel,
                int $tenantId,
                int $eventId,
                object $recipient,
                EventBroadcastRenderedMessage $message,
                string $deliveryKey,
                string $emailCadence,
            ): EventBroadcastTransportResult {
                throw new RuntimeException('event_broadcast_push_provider_rejected');
            }
        };
    }

    private function broadcastStatus(int $broadcastId): string
    {
        return (string) DB::table('event_broadcasts')->where('id', $broadcastId)->value('status');
    }

    private function version(int $broadcastId): int
    {
        return (int) DB::table('event_broadcasts')->where('id', $broadcastId)->value('broadcast_version');
    }

    private function notificationCount(int $userId): int
    {
        return DB::table('notifications')->where('user_id', $userId)->count();
    }
}
