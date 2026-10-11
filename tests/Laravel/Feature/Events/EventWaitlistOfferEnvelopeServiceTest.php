<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Exceptions\EventWaitlistException;
use App\Models\User;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistOfferEnvelopeService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\Laravel\TestCase;

final class EventWaitlistOfferEnvelopeServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TEST_KEY = 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=';
    private const ROTATED_KEY = 'base64:EC6EXvujzJ3zuQmD0aFcvw9U8pUywrTfQCkHPK8r4oA=';

    private EventRegistrationService $registrations;
    private EventWaitlistService $waitlist;
    private EventWaitlistOfferEnvelopeService $envelopes;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('app.key', self::TEST_KEY);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('events.registration.offer_ttl_minutes', 15);
        Config::set('event_waitlist.envelope.active_key_version', 'test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.previous_keys', []);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $this->registrations = new EventRegistrationService();
        $this->envelopes = new EventWaitlistOfferEnvelopeService();
        $this->waitlist = new EventWaitlistService(
            $this->registrations,
            null,
            $this->envelopes,
        );
    }

    public function test_offer_secret_is_encrypted_hash_only_and_claim_result_refuses_serialization(): void
    {
        [$eventId, , $waiter, $offer, $outboxId] = $this->offeredFixture();
        $token = (string) $offer->offerToken;
        $envelope = DB::table('event_waitlist_offer_envelopes')
            ->where('outbox_id', $outboxId)
            ->first();

        self::assertNotNull($envelope);
        self::assertSame('sealed', $envelope->status);
        self::assertNotNull($envelope->token_ciphertext);
        self::assertStringNotContainsString($token, (string) $envelope->token_ciphertext);
        self::assertSame(hash('sha256', $token), DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', $waiter->id)
            ->value('offer_token_hash'));

        foreach ([
            DB::table('event_waitlist_entry_history')->where('event_id', $eventId)->get(),
            DB::table('event_domain_outbox')->where('event_id', $eventId)->get(),
            DB::table('event_waitlist_offer_envelopes')->where('event_id', $eventId)->get(),
            DB::table('event_waitlist_offer_envelope_access')->where('event_id', $eventId)->get(),
        ] as $persisted) {
            self::assertStringNotContainsString(
                $token,
                json_encode($persisted, JSON_THROW_ON_ERROR),
            );
        }

        $claim = $this->envelopes->claimForDelivery(
            $outboxId,
            'waitlist-notification-worker',
            'delivery-attempt-1',
        );
        self::assertSame($token, $claim->offerToken);
        self::assertSame(64, strlen($claim->claimToken));

        try {
            json_encode($claim, JSON_THROW_ON_ERROR);
            self::fail('The secret claim was JSON serialized.');
        } catch (LogicException $exception) {
            self::assertStringContainsString('cannot be JSON serialized', $exception->getMessage());
        }
        try {
            serialize($claim);
            self::fail('The secret claim was serialized.');
        } catch (LogicException $exception) {
            self::assertStringContainsString('cannot be serialized', $exception->getMessage());
        }
    }

    public function test_same_consumer_and_idempotency_can_resume_crash_window_but_conflicts_fail_closed(): void
    {
        [, , , $offer, $outboxId] = $this->offeredFixture();
        $claim = $this->envelopes->claimForDelivery(
            $outboxId,
            'waitlist-notification-worker',
            'delivery-attempt-resume',
        );

        $resumed = $this->envelopes->resumeClaimForDelivery(
            $outboxId,
            'waitlist-notification-worker',
            'delivery-attempt-resume',
        );
        $replayedResume = $this->envelopes->resumeClaimForDelivery(
            $outboxId,
            'waitlist-notification-worker',
            'delivery-attempt-resume',
        );
        self::assertSame($offer->offerToken, $resumed->offerToken);
        self::assertSame($claim->claimToken, $resumed->claimToken);
        self::assertSame($resumed->claimToken, $replayedResume->claimToken);
        self::assertSame(1, DB::table('event_waitlist_offer_envelope_access')
            ->where('outbox_id', $outboxId)
            ->where('operation', 'claim_resumed')
            ->count());

        $this->assertRejected(
            'event_waitlist_offer_envelope_resume_denied',
            fn () => $this->envelopes->resumeClaimForDelivery(
                $outboxId,
                'different-worker',
                'delivery-attempt-resume',
            ),
        );
        $this->assertRejected(
            'event_waitlist_offer_envelope_resume_denied',
            fn () => $this->envelopes->resumeClaimForDelivery(
                $outboxId,
                'waitlist-notification-worker',
                'different-attempt',
            ),
        );

        $completed = $this->envelopes->completeHandoff(
            (int) $resumed->envelope->getKey(),
            $resumed->claimToken,
            'waitlist-notification-worker',
            'handoff-resume',
        );
        self::assertSame('handed_off', $completed->status);
        self::assertNull($completed->getRawOriginal('token_ciphertext'));
        self::assertNull($completed->getRawOriginal('claim_token_hash'));
        self::assertSame('handed_off', $this->envelopes->completeHandoff(
            (int) $resumed->envelope->getKey(),
            $resumed->claimToken,
            'waitlist-notification-worker',
            'handoff-resume',
        )->status);
    }

    public function test_resume_is_expiry_checked_and_terminal_acceptance_erases_ciphertext(): void
    {
        [$eventId, , $waiter, $offer, $outboxId] = $this->offeredFixture();
        $this->envelopes->claimForDelivery(
            $outboxId,
            'waitlist-notification-worker',
            'delivery-before-expiry',
        );
        DB::table('event_waitlist_offer_envelopes')
            ->where('outbox_id', $outboxId)
            ->update(['expires_at' => now()->subSecond()]);
        $this->assertRejected(
            'event_waitlist_offer_envelope_expired',
            fn () => $this->envelopes->resumeClaimForDelivery(
                $outboxId,
                'waitlist-notification-worker',
                'delivery-before-expiry',
            ),
        );

        DB::table('event_waitlist_offer_envelopes')
            ->where('outbox_id', $outboxId)
            ->update(['expires_at' => now()->addMinutes(10)]);
        $this->waitlist->acceptOffer(
            $eventId,
            (int) $waiter->id,
            (string) $offer->offerToken,
            $waiter,
            'accept-erases-envelope',
        );
        $terminal = DB::table('event_waitlist_offer_envelopes')
            ->where('outbox_id', $outboxId)
            ->first();
        self::assertSame('erased', $terminal?->status);
        self::assertNull($terminal?->token_ciphertext);
        self::assertNull($terminal?->claim_token_hash);
        self::assertNotNull($terminal?->erased_at);
    }

    public function test_key_rotation_can_open_old_envelope_only_while_previous_key_is_available(): void
    {
        [, , , $offer, $outboxId] = $this->offeredFixture();
        Config::set('event_waitlist.envelope.active_key_version', 'test-v2');
        Config::set('event_waitlist.envelope.active_key', self::ROTATED_KEY);
        Config::set('event_waitlist.envelope.previous_keys', [
            'test-v1' => self::TEST_KEY,
        ]);

        $claim = $this->envelopes->claimForDelivery(
            $outboxId,
            'rotation-worker',
            'rotation-delivery',
        );
        self::assertSame($offer->offerToken, $claim->offerToken);
        self::assertSame('test-v1', $claim->envelope->key_version);
    }

    public function test_missing_valid_key_disables_timed_offers_without_partial_facts(): void
    {
        [$eventId, $holder, $waiter, $organizer] = $this->waitingFixture();
        Config::set('event_waitlist.envelope.active_key', 'invalid-key');
        Config::set('event_waitlist.envelope.fallback_to_app_key', false);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);

        $this->assertRejected(
            'event_waitlist_timed_offers_disabled',
            fn () => $this->waitlist->offerNext($eventId, $organizer, 'invalid-key-offer'),
        );
        self::assertSame('waiting', DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', $waiter->id)
            ->value('queue_state'));
        self::assertSame(0, DB::table('event_waitlist_entry_history')
            ->where('event_id', $eventId)
            ->where('action', 'offered')
            ->count());
        self::assertSame(0, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.waitlist.offered')
            ->count());
        self::assertSame(0, DB::table('event_waitlist_offer_envelopes')
            ->where('event_id', $eventId)
            ->count());
    }

    /** @return array{int,User,User,\App\Support\Events\EventWaitlistTransitionResult,int} */
    private function offeredFixture(): array
    {
        [$eventId, $holder, $waiter, $organizer] = $this->waitingFixture();
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $this->waitlist->offerNext($eventId, $organizer, 'create-delivery-envelope');
        self::assertNotNull($offer);
        self::assertNotNull($offer->offerToken);
        $outboxId = (int) DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.waitlist.offered')
            ->latest('id')
            ->value('id');
        self::assertGreaterThan(0, $outboxId);

        return [$eventId, $holder, $waiter, $offer, $outboxId];
    }

    /** @return array{int,User,User,User} */
    private function waitingFixture(): array
    {
        $organizer = $this->member();
        $holder = $this->member();
        $waiter = $this->member();
        $eventId = $this->event((int) $organizer->id);
        $this->registrations->confirm(
            $eventId,
            (int) $holder->id,
            $holder,
            'envelope-fill-capacity',
        );
        $this->waitlist->join(
            $eventId,
            (int) $waiter->id,
            $waiter,
            'envelope-join-waitlist',
        );
        // E-102: free the seat without a release; a release with timed offers
        // off now moves the head of the queue up itself (f50f60058).
        DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', $eventId)
            ->increment('max_attendees');

        return [$eventId, $holder, $waiter, $organizer];
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(int $organizerId): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Waitlist envelope fixture',
            'description' => 'Encrypted delivery-secret fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'envelope:' . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => 1,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function assertRejected(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected waitlist rejection {$reason}");
        } catch (EventWaitlistException $exception) {
            self::assertSame($reason, $exception->reasonCode);
        }
    }

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }
}
