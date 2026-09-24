<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventInvitationCampaignService;
use App\Services\EventRegistrationGuestAttendanceService;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationSubmissionService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationPhaseBTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_schedule_retry_after_due_time_returns_receipt_without_rescheduling(): void
    {
        $now = CarbonImmutable::parse('2027-08-01T10:00:00Z');
        CarbonImmutable::setTestNow($now);
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id, $now->addDay());
        $service = new EventInvitationCampaignService();
        $source = ['member_ids' => [(int) $member->id]];
        $preview = $service->preview($eventId, $owner, 'member', $source, 'due-replay-preview');
        $campaignId = (int) $preview['campaign']->id;
        $scheduledFor = $now->addHour();
        $scheduled = $service->schedule($eventId, $campaignId, $owner, $scheduledFor, 1, 'due-replay-schedule');
        self::assertTrue($scheduled['changed']);
        $tables = ['event_invitation_campaign_history', 'event_invitations', 'event_domain_outbox'];
        $counts = array_map(fn ($table) => DB::table($table)->count(), $tables);
        CarbonImmutable::setTestNow($now->addHours(2));
        $replay = $service->schedule($eventId, $campaignId, $owner, $scheduledFor, 1, 'due-replay-schedule');
        self::assertFalse($replay['changed']);
        self::assertSame($campaignId, (int) $replay['campaign']->id);
        self::assertSame(2, (int) $replay['campaign']->revision);
        self::assertSame($counts, array_map(fn ($table) => DB::table($table)->count(), $tables));
        $this->assertReason('event_invitation_campaign_idempotency_conflict', fn () =>
            $service->schedule($eventId, $campaignId, $owner, $scheduledFor->addMinute(), 1, 'due-replay-schedule'));
        $this->assertReason('event_invitation_campaign_schedule_invalid', fn () =>
            $service->schedule($eventId, $campaignId, $owner, '', 1, 'due-replay-schedule'));

        $fresh = $service->preview($eventId, $owner, 'member', $source, 'due-fresh-preview');
        $this->assertReason('event_invitation_campaign_schedule_invalid', fn () =>
            $service->schedule($eventId, (int) $fresh['campaign']->id, $owner, $scheduledFor, 1, 'due-fresh-schedule'));
        $this->assertReason('event_invitation_campaign_schedule_invalid', fn () =>
            $service->schedule($eventId, (int) $fresh['campaign']->id, $owner, $now->addDay(), 1, 'due-start-schedule'));
        self::assertSame('previewed', $fresh['campaign']->fresh()->status->value);

        $service->cancel($eventId, $campaignId, $owner, 2, 'Synthetic cancellation', 'due-replay-cancel');
        $historyCount = DB::table('event_invitation_campaign_history')->count();
        $cancelledReplay = $service->schedule($eventId, $campaignId, $owner, $scheduledFor, 1, 'due-replay-schedule');
        self::assertFalse($cancelledReplay['changed']);
        self::assertSame('cancelled', $cancelledReplay['campaign']->status->value);
        self::assertSame(3, (int) $cancelledReplay['campaign']->revision);
        self::assertSame($historyCount, DB::table('event_invitation_campaign_history')->count());
        self::assertSame($counts[1], DB::table('event_invitations')->count());
        self::assertSame($counts[2], DB::table('event_domain_outbox')->count());
    }

    public function test_submitted_answers_are_amended_as_an_immutable_lineage(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $settings = $this->registrationSettings($eventId, $owner, $start);
        $form = $this->publishedRegistrationForm($eventId, $owner, $settings);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationSubmissionService();
        $draft = $service->saveDraft(
            $eventId,
            $registrationId,
            (int) $form->id,
            $member,
            [
                'display_name' => 'Original attendee',
                'dietary_needs' => 'Original sensitive value',
                'meal_choice' => 'Plant-based',
                'waiver' => true,
            ],
            null,
            'phase-b-amendment-draft',
        );
        $submitted = $service->submit(
            $eventId,
            (int) $draft['submission']->id,
            $member,
            (int) $draft['submission']->revision,
            'phase-b-amendment-submit',
        );
        $sourceId = (int) $submitted['submission']->id;
        $sourceRevision = (int) $submitted['submission']->revision;
        $sourceCiphertexts = $this->answerCiphertexts($sourceId);

        $amendment = $service->createAmendment(
            $eventId,
            $sourceId,
            $member,
            $sourceRevision,
            'phase-b-amendment-create',
        );
        $replay = $service->createAmendment(
            $eventId,
            $sourceId,
            $member,
            $sourceRevision,
            'phase-b-amendment-create',
        );

        self::assertTrue($amendment['changed']);
        self::assertFalse($replay['changed']);
        self::assertSame((int) $amendment['submission']->id, (int) $replay['submission']->id);
        self::assertSame($sourceId, (int) $amendment['submission']->supersedes_submission_id);
        self::assertSame($sourceId, (int) $amendment['submission']->lineage_root_submission_id);
        self::assertSame(2, (int) $amendment['submission']->attempt_number);
        self::assertSame(1, (int) $amendment['submission']->effective_slot);
        self::assertSame('draft', $amendment['submission']->status->value);
        self::assertSame($sourceCiphertexts, $this->answerCiphertexts((int) $amendment['submission']->id));
        self::assertSame($sourceCiphertexts, $this->answerCiphertexts($sourceId));

        $source = DB::table('event_registration_form_submissions')->find($sourceId);
        self::assertNotNull($source);
        self::assertNull($source->effective_slot);
        self::assertNotNull($source->superseded_at);
        self::assertSame($sourceRevision + 1, (int) $source->revision);
        self::assertSame(1, DB::table('event_registration_form_submissions')
            ->where('registration_id', $registrationId)
            ->where('form_version_id', (int) $form->id)
            ->where('effective_slot', 1)
            ->count());

        $this->assertReason(
            'event_registration_submission_amendment_conflict',
            fn () => $service->createAmendment(
                $eventId,
                $sourceId,
                $member,
                $sourceRevision,
                'phase-b-amendment-stale',
            ),
        );
        $answerId = (int) DB::table('event_registration_form_answers')
            ->where('submission_id', $sourceId)
            ->value('id');
        $this->assertImmutableQuery(
            fn () => DB::table('event_registration_form_answers')
                ->where('id', $answerId)
                ->update(['answer_ciphertext' => 'tampered']),
            'event_registration_submitted_answer_immutable',
        );
    }

    public function test_audience_campaign_snapshot_schedule_and_cancellation_are_versioned_and_private(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2027-05-01T10:00:00Z'));
        // E-035 F-161: community-wide (all_active) audiences are admin-only.
        $owner = $this->eventUser(['created_at' => '2027-01-02 10:00:00', 'role' => 'admin']);
        $this->eventUser(['created_at' => '2027-02-02 10:00:00']);
        [$eventId, $start] = $this->registrationEvent(
            (int) $owner->id,
            CarbonImmutable::parse('2027-06-01T10:00:00Z'),
        );
        $service = new EventInvitationCampaignService();
        $source = [
            'criteria' => [
                'all_active' => true,
                'approved' => true,
                'joined_after' => '2027-01-01',
                'joined_before' => '2027-12-31',
            ],
        ];
        $preview = $service->preview(
            $eventId,
            $owner,
            'audience',
            $source,
            'phase-b-campaign-preview',
            'fr',
        );
        $previewReplay = $service->preview(
            $eventId,
            $owner,
            'audience',
            $source,
            'phase-b-campaign-preview',
            'fr',
        );
        self::assertTrue($preview['changed']);
        self::assertFalse($previewReplay['changed']);
        self::assertSame('fr', $preview['campaign']->default_locale);
        self::assertSame(1, (int) $preview['campaign']->source_schema_version);
        $campaignRow = DB::table('event_invitation_campaigns')->find($preview['campaign']->id);
        self::assertNotNull($campaignRow);
        self::assertStringNotContainsString('2027-01-01', (string) $campaignRow->source_snapshot_ciphertext);
        self::assertStringNotContainsString('2027-12-31', (string) $campaignRow->source_snapshot_ciphertext);
        $snapshot = json_decode(
            Crypt::decryptString((string) $campaignRow->source_snapshot_ciphertext),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertSame($source['criteria'], $snapshot['criteria']);

        $scheduledFor = $start->subDay();
        $scheduled = $service->schedule(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            $scheduledFor,
            1,
            'phase-b-campaign-schedule',
        );
        $scheduleReplay = $service->schedule(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            $scheduledFor,
            1,
            'phase-b-campaign-schedule',
        );
        self::assertTrue($scheduled['changed']);
        self::assertFalse($scheduleReplay['changed']);
        self::assertSame('scheduled', $scheduled['campaign']->status->value);

        $cancelled = $service->cancel(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            2,
            'Audience no longer required',
            'phase-b-campaign-cancel',
        );
        self::assertTrue($cancelled['changed']);
        self::assertSame('cancelled', $cancelled['campaign']->status->value);
        self::assertSame(3, DB::table('event_invitation_campaign_history')
            ->where('campaign_id', $preview['campaign']->id)
            ->count());

        $this->assertReason(
            'event_invitation_audience_joined_after_invalid',
            fn () => $service->preview(
                $eventId,
                $owner,
                'audience',
                ['criteria' => ['all_active' => true, 'joined_after' => '2027-02-31']],
                'phase-b-campaign-invalid-date',
            ),
        );
    }

    public function test_guest_notification_consent_attendance_undo_and_cancellation_preserve_evidence(): void
    {
        $now = CarbonImmutable::parse('2027-08-01T10:00:00Z');
        CarbonImmutable::setTestNow($now);
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent(
            (int) $owner->id,
            $now->addMinutes(10),
            $now->addHours(2),
        );
        $this->registrationSettings($eventId, $owner, $start, true, 2, 30);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $guests = new EventRegistrationGuestService();
        $this->assertReason(
            'event_registration_guest_notification_consent_invalid',
            fn () => $guests->capture(
                $eventId,
                $registrationId,
                $member,
                1,
                'Guest without delivery address',
                null,
                null,
                true,
                'Guest privacy notice',
                'guest-notice-v1',
                'fr',
                true,
                'Send operational event notifications.',
                'guest-notification-v1',
            ),
        );
        $captured = $guests->capture(
            $eventId,
            $registrationId,
            $member,
            1,
            'Notification Guest',
            'notification-guest@example.test',
            null,
            true,
            'Guest privacy notice',
            'guest-notice-v1',
            'fr',
            true,
            'Send operational event notifications.',
            'guest-notification-v1',
        );
        $guestId = (int) $captured['guest']->id;
        self::assertSame(1, $captured['party_size']);
        self::assertTrue((bool) $captured['guest']->notification_consent);
        self::assertSame('fr', $captured['guest']->preferred_locale);
        self::assertNotNull($captured['guest']->notification_consented_at);

        $attendance = new EventRegistrationGuestAttendanceService();
        $checkIn = $attendance->transition(
            $eventId,
            $guestId,
            $owner,
            'check_in',
            0,
            'phase-b-guest-check-in',
        );
        $checkInReplay = $attendance->transition(
            $eventId,
            $guestId,
            $owner,
            'check_in',
            0,
            'phase-b-guest-check-in',
        );
        self::assertTrue($checkIn['changed']);
        self::assertFalse($checkInReplay['changed']);
        self::assertTrue($checkInReplay['replayed']);
        self::assertSame('checked_in', $checkIn['attendance']->attendance_status->value);
        $this->assertReason(
            'event_registration_guest_attendance_reason_required',
            fn () => $attendance->transition(
                $eventId,
                $guestId,
                $owner,
                'undo',
                1,
                'phase-b-guest-undo-without-reason',
            ),
        );
        $undo = $attendance->transition(
            $eventId,
            $guestId,
            $owner,
            'undo',
            1,
            'phase-b-guest-undo',
            'Incorrect guest selected',
        );
        self::assertSame('not_checked_in', $undo['attendance']->attendance_status->value);
        self::assertSame(2, (int) $undo['attendance']->attendance_version);
        self::assertSame(2, DB::table('event_registration_guest_attendance_history')
            ->where('guest_id', $guestId)
            ->count());

        $cancelled = $guests->cancel(
            $eventId,
            $guestId,
            $member,
            1,
            'Guest can no longer attend',
        );
        $cancelReplay = $guests->cancel(
            $eventId,
            $guestId,
            $member,
            1,
            'Guest can no longer attend',
        );
        self::assertTrue($cancelled['changed']);
        self::assertFalse($cancelReplay['changed']);
        self::assertSame('withdrawn', $cancelled['guest']->status);
        self::assertSame(1, $cancelled['party_size']);
        self::assertTrue((bool) $cancelled['guest']->notification_consent);
        self::assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.registration_guest.withdrawn')
            ->count());
        self::assertSame(2, DB::table('event_registration_guest_attendance_history')
            ->where('guest_id', $guestId)
            ->count());
    }

    /** @return array<int,string> */
    private function answerCiphertexts(int $submissionId): array
    {
        return DB::table('event_registration_form_answers')
            ->where('submission_id', $submissionId)
            ->orderBy('question_id')
            ->get(['question_id', 'answer_ciphertext'])
            ->mapWithKeys(static fn (object $answer): array => [
                (int) $answer->question_id => (string) $answer->answer_ciphertext,
            ])
            ->all();
    }

    /** @param callable():mixed $operation */
    private function assertReason(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame($reason, $exception->getMessage());
        }
    }

    /** @param callable():mixed $operation */
    private function assertImmutableQuery(callable $operation, string $needle): void
    {
        try {
            $operation();
            self::fail("Expected {$needle}.");
        } catch (QueryException $exception) {
            self::assertStringContainsString($needle, $exception->getMessage());
        }
    }
}
