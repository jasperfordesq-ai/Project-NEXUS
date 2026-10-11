<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventOperationalState;
use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventInvitationCampaignService;
use App\Services\EventInvitationService;
use App\Services\EventLifecycleService;
use App\Services\EventNotificationOutboxProcessor;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * Invitations must die with their event.
 *
 * The cancellation cascade covered registrations, the waitlist, reminders and
 * broadcasts but not invitation campaigns, and nothing on the issue, delivery
 * or acceptance path checked that the event was still going ahead — so a
 * campaign scheduled before a cancellation still invited people afterwards.
 */
final class EventInvitationLifecycleTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_cancelling_the_event_cancels_its_scheduled_and_previewed_campaigns(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $campaigns = new EventInvitationCampaignService();
        $source = ['member_ids' => [(int) $member->id]];
        $scheduled = $campaigns->preview($eventId, $owner, 'member', $source, 'lifecycle-scheduled-preview');
        $scheduledId = (int) $scheduled['campaign']->id;
        $campaigns->schedule(
            $eventId,
            $scheduledId,
            $owner,
            CarbonImmutable::now('UTC')->addHour()->toIso8601String(),
            1,
            'lifecycle-scheduled-schedule',
        );
        $previewed = $campaigns->preview($eventId, $owner, 'member', $source, 'lifecycle-previewed-preview');
        $previewedId = (int) $previewed['campaign']->id;

        app(EventLifecycleService::class)->transition(
            $eventId,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'Venue flooded',
        );

        foreach ([$scheduledId, $previewedId] as $campaignId) {
            $row = DB::table('event_invitation_campaigns')->where('id', $campaignId)->first();
            self::assertNotNull($row);
            self::assertSame('cancelled', (string) $row->status, 'A campaign must not outlive its cancelled event.');
            self::assertNull($row->scheduled_for_utc);
            self::assertNotNull($row->cancelled_at);
            self::assertSame('Venue flooded', (string) $row->cancelled_reason);
            $history = DB::table('event_invitation_campaign_history')
                ->where('campaign_id', $campaignId)
                ->orderByDesc('id')
                ->first();
            self::assertNotNull($history);
            self::assertSame('cancelled', (string) $history->action);
            self::assertSame((int) $row->revision, (int) $history->revision);
            self::assertStringContainsString('event_lifecycle', (string) $history->metadata);
        }
        self::assertSame([], (new EventInvitationCampaignService())->dueCampaignIds());
        $status = DB::table('event_status_history')->where('event_id', $eventId)->orderByDesc('id')->first();
        self::assertNotNull($status);
        self::assertStringContainsString('"invitation_campaigns_cancelled":2', (string) $status->metadata);
    }

    public function test_issuing_a_campaign_on_a_cancelled_event_is_refused(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $member->id]],
            'cancelled-issue-preview',
        );
        // Cancelled without the cascade (a race, or a path that skipped it):
        // the issue path must refuse on its own.
        $this->markCancelledWithoutCascade($eventId);

        try {
            (new EventInvitationService())->issueCampaign(
                $eventId,
                (int) $preview['campaign']->id,
                $owner,
                [],
                1,
                'cancelled-issue',
                $start->subDay()->toIso8601String(),
            );
            self::fail('Issuing invitations to a cancelled event must be refused.');
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame('event_registration_event_unavailable', $exception->getMessage());
        }
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());
        self::assertSame(
            'previewed',
            (string) DB::table('event_invitation_campaigns')->where('id', (int) $preview['campaign']->id)->value('status'),
        );
    }

    public function test_a_due_scheduled_campaign_on_a_cancelled_event_is_not_issued(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $campaigns = new EventInvitationCampaignService();
        $preview = $campaigns->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $member->id]],
            'cancelled-due-preview',
        );
        $campaignId = (int) $preview['campaign']->id;
        $campaigns->schedule(
            $eventId,
            $campaignId,
            $owner,
            CarbonImmutable::now('UTC')->addHour()->toIso8601String(),
            1,
            'cancelled-due-schedule',
        );
        $this->markCancelledWithoutCascade($eventId);
        CarbonImmutable::setTestNow(CarbonImmutable::now('UTC')->addHours(2));

        $results = (new EventInvitationService())->issueDueScheduled();

        // E-102: a campaign whose event stopped going ahead before the cancel
        // cascade existed is closed by the sweep instead of reporting "failed"
        // on every scheduler run.
        self::assertContains(
            ['campaign_id' => $campaignId, 'status' => 'cancelled', 'reason' => 'event_registration_event_unavailable'],
            $results,
        );
        self::assertSame('cancelled', DB::table('event_invitation_campaigns')->where('id', $campaignId)->value('status'));
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());
        self::assertSame([], array_values(array_filter(
            (new EventInvitationService())->issueDueScheduled(),
            static fn (array $row): bool => $row['campaign_id'] === $campaignId,
        )), 'The next sweep must not pick the campaign up again.');
    }

    public function test_a_queued_invitation_for_an_event_cancelled_after_issue_is_suppressed(): void
    {
        $owner = $this->eventUser();
        $target = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $target->id]],
            'cancelled-delivery-preview',
        );
        (new EventInvitationService())->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            [],
            1,
            'cancelled-delivery-issue',
            $start->subDay()->toIso8601String(),
        );
        $outbox = DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.invitation.issued')
            ->first();
        self::assertNotNull($outbox);

        app(EventLifecycleService::class)->transition(
            $eventId,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'Speaker withdrew',
        );
        app(EventNotificationOutboxProcessor::class)->processBatch(100, $this->testTenantId);

        self::assertSame(
            'processed',
            (string) DB::table('event_domain_outbox')->where('id', (int) $outbox->id)->value('status'),
        );
        $deliveries = DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('outbox_id', (int) $outbox->id)
            ->get();
        self::assertNotEmpty($deliveries);
        foreach ($deliveries as $delivery) {
            self::assertSame('suppressed', (string) $delivery->status);
        }
        // Channels the member's preferences already ruled out keep their own
        // reason; every channel that would have sent is stopped by the event.
        self::assertGreaterThan(0, $deliveries->where('suppression_reason', 'event_unavailable')->count());
        self::assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $target->id)
            ->where('type', 'event_invitation')
            ->count());
    }

    public function test_an_issued_invitation_cannot_be_accepted_once_the_event_is_cancelled(): void
    {
        $owner = $this->eventUser();
        $target = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $target->id]],
            'cancelled-accept-preview',
        );
        $service = new EventInvitationService();
        $issued = $service->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            [],
            1,
            'cancelled-accept-issue',
            $start->subDay()->toIso8601String(),
        );
        $invitationId = (int) $issued['invitations'][0]['invitation']->id;

        app(EventLifecycleService::class)->transition(
            $eventId,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'Organiser unwell',
        );

        try {
            $service->acceptMemberById($eventId, $invitationId, $target, 'cancelled-accept');
            self::fail('An invitation to a cancelled event must not be accepted.');
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame('event_registration_event_unavailable', $exception->getMessage());
        }
        self::assertSame(
            'issued',
            (string) DB::table('event_invitations')->where('id', $invitationId)->value('status'),
        );
        self::assertSame(0, DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $target->id)
            ->count());
    }

    private function markCancelledWithoutCascade(int $eventId): void
    {
        DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', $eventId)
            ->update([
                'operational_status' => 'cancelled',
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'updated_at' => now(),
            ]);
    }
}
