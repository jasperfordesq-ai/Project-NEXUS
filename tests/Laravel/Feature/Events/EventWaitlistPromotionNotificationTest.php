<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Models\User;
use App\Services\EventNotificationOutboxProcessor;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-102 follow-up — a member moved up from the waitlist automatically was
 * sent two messages for one change: the registration notice ("Your
 * registration … is confirmed" / "… is pending") and the waitlist "accepted"
 * notice ("You accepted your place …"), which is wrong — they accepted
 * nothing, the system moved them.
 *
 * The registration notice already says what happened, so the automatic
 * promotion fact sends nothing of its own. A member who accepts an offer
 * themselves still gets the "accepted" wording.
 */
final class EventWaitlistPromotionNotificationTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        App::setLocale('en');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.channels', ['in_app']);
        Config::set('events.notification_delivery.max_attempts', 3);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.allow_allocation_keys', false);
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
    }

    public function test_an_automatically_promoted_member_gets_one_message_that_says_they_have_a_place(): void
    {
        [$eventId, $owner, $holder, $first] = $this->fullEventWithQueue('auto', 'Pottery evening');

        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'notify-promote-auto');
        $this->drainOutbox();

        self::assertSame(
            ['Your registration for “Pottery evening” is confirmed.'],
            $this->messagesFor($first, $eventId),
            'BAD OUTCOME: a member moved up automatically was told something other than that their place is confirmed.',
        );
        foreach ($this->messagesFor($owner, $eventId) as $message) {
            self::assertStringNotContainsString(
                'waitlist status',
                $message,
                'The organiser is told about the registration, not a waitlist "accepted" state the member never chose.',
            );
        }
    }

    public function test_an_automatic_promotion_under_manual_approval_says_the_request_is_pending(): void
    {
        [$eventId, , $holder, $first] = $this->fullEventWithQueue('manual', 'Choir rehearsal');

        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'notify-promote-manual');
        $this->drainOutbox();

        self::assertSame(
            ['Your registration for “Choir rehearsal” is pending.'],
            $this->messagesFor($first, $eventId),
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function drainOutbox(): void
    {
        $processor = app(EventNotificationOutboxProcessor::class);
        for ($i = 0; $i < 20; $i++) {
            if ((int) $processor->processBatch(50, $this->testTenantId)['claimed'] === 0) {
                return;
            }
        }
        self::fail('Fixture: the outbox did not drain.');
    }

    /** @return list<string> */
    private function messagesFor(User $user, int $eventId): array
    {
        $title = (string) DB::table('events')->where('id', $eventId)->value('title');

        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $user->id)
            ->where('message', 'like', '%' . $title . '%')
            ->orderBy('id')
            ->pluck('message')
            ->map(static fn ($message): string => (string) $message)
            ->values()
            ->all();
    }

    /** @return array{0:int,1:User,2:User,3:User,4:User} */
    private function fullEventWithQueue(string $approvalMode, string $title): array
    {
        $owner = $this->member();
        $holder = $this->member();
        $first = $this->member();
        $second = $this->member();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update([
            'max_attendees' => 1,
            'title' => $title,
        ]);
        $settings = new EventRegistrationSettingsService();
        $saved = $settings->save(
            $eventId,
            $owner,
            [
                'approval_mode' => $approvalMode,
                'opens_at' => $start->subDays(60)->format('Y-m-d\TH:i:sP'),
                'closes_at' => $start->format('Y-m-d\TH:i:sP'),
                'cancellation_cutoff_at' => $start->format('Y-m-d\TH:i:sP'),
                'per_member_limit' => 1,
                'guests_enabled' => false,
                'max_guests_per_registration' => 0,
                'guest_retention_days' => 30,
            ],
            null,
            'notify-settings-create-' . bin2hex(random_bytes(8)),
        );
        $settings->publish(
            $eventId,
            $owner,
            (int) $saved['settings']->revision,
            'notify-settings-publish-' . bin2hex(random_bytes(8)),
        );

        $registrations = new EventRegistrationService();
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'notify-holder-request');
        if ($approvalMode === 'manual') {
            $registrations->transition(
                $eventId,
                (int) $holder->id,
                EventCapacityRegistrationState::Confirmed,
                $owner,
                'notify-holder-approve',
            );
        }
        $waitlist = new EventWaitlistService();
        self::assertFalse($waitlist->timedOffersEnabled(), 'Fixture: timed offers are off.');
        $waitlist->join($eventId, (int) $first->id, $first, 'notify-join-first');
        $waitlist->join($eventId, (int) $second->id, $second, 'notify-join-second');
        // Earlier messages (joining the waitlist) are not what this test is about.
        $this->drainOutbox();
        DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('user_id', [(int) $owner->id, (int) $first->id])
            ->delete();

        return [$eventId, $owner, $holder, $first, $second];
    }

    private function member(): User
    {
        return $this->eventUser([
            'preferred_language' => 'en',
            'notification_preferences' => ['email_events' => false, 'push_enabled' => false],
        ]);
    }
}
