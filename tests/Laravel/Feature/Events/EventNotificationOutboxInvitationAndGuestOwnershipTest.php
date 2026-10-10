<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Services\EmailDispatchService;
use App\Services\EventInvitationCampaignService;
use App\Services\EventInvitationService;
use App\Services\EventNotificationOutboxProcessor;
use App\Services\EventNotificationOutboxScope;
use App\Services\EventRegistrationGuestService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * Invitation and guest-withdrawal facts are recorded as outbox_authoritative
 * and EventNotificationOutboxActionHandler delivers them, but the scope that
 * the scheduled processor claims through did not include either action
 * (`event.registration_guest.%` does not match `event.registration.%`). Both
 * stayed `pending` for ever and the invited member / withdrawn guest was never
 * told. These tests drive the real scheduled processor end to end.
 */
final class EventNotificationOutboxInvitationAndGuestOwnershipTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
    }

    public function test_scope_owns_invitation_and_guest_withdrawal_actions(): void
    {
        self::assertTrue(EventNotificationOutboxScope::includes('event.invitation.issued'));
        self::assertTrue(EventNotificationOutboxScope::includes('event.registration_guest.withdrawn'));
        // Facts no consumer handles stay outside the boundary.
        self::assertFalse(EventNotificationOutboxScope::includes('event.attendance.transitioned'));
        self::assertFalse(EventNotificationOutboxScope::includes('event.attendance.recorded'));
    }

    public function test_scheduled_processor_delivers_a_member_invitation(): void
    {
        $owner = $this->eventUser();
        $target = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $target->id]],
            'outbox-ownership-invite-preview',
        );
        (new EventInvitationService())->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            [],
            1,
            'outbox-ownership-invite-issue',
            $start->subDay()->toIso8601String(),
        );
        $outbox = DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.invitation.issued')
            ->first();
        self::assertNotNull($outbox);
        self::assertSame('outbox_authoritative', (string) $outbox->production_mode);
        self::assertSame('pending', (string) $outbox->status);

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(100, $this->testTenantId);

        self::assertGreaterThanOrEqual(1, $summary['claimed']);
        self::assertSame(
            'processed',
            (string) DB::table('event_domain_outbox')->where('id', (int) $outbox->id)->value('status'),
        );
        self::assertSame(0, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('outbox_id', (int) $outbox->id)
            ->whereNotIn('status', ['delivered', 'suppressed', 'failed_terminal'])
            ->count());
        self::assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $target->id)
            ->where('type', 'event_invitation')
            ->count());
    }

    public function test_scheduled_processor_claims_a_guest_withdrawal(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($eventId, $owner, $start, true, 1, 30);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationGuestService();
        $captured = $service->capture(
            $eventId,
            $registrationId,
            $member,
            1,
            'Guest One',
            'outbox-guest@example.test',
            null,
            true,
            'Guest privacy notice',
            'guest-notice-v1',
            'en',
            true,
            'Email me about changes to this booking',
            'guest-notify-v1',
        );
        $service->cancel(
            $eventId,
            (int) $captured['guest']->id,
            $member,
            (int) $captured['guest']->revision,
            'Guest can no longer attend',
        );
        $outbox = DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.registration_guest.withdrawn')
            ->first();
        self::assertNotNull($outbox);
        self::assertSame('outbox_authoritative', (string) $outbox->production_mode);
        self::assertSame('pending', (string) $outbox->status);

        // Capture the outgoing email instead of hitting a provider.
        $mailer = new class extends EmailDispatchService {
            /** @var list<string> */
            public array $recipients = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->recipients[] = $to;

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        app(EventNotificationOutboxProcessor::class)->processBatch(100, $this->testTenantId);

        $stored = DB::table('event_domain_outbox')->where('id', (int) $outbox->id)->first();
        // Claimed and handed to EventRegistrationGuestNotificationConsumer.
        self::assertSame(1, (int) $stored->attempts);
        self::assertSame('processed', (string) $stored->status, (string) $stored->last_error);
        self::assertSame(1, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('outbox_id', (int) $outbox->id)
            ->where('channel', 'email')
            ->where('status', 'delivered')
            ->count());
        self::assertSame(['outbox-guest@example.test'], $mailer->recipients);
    }
}
