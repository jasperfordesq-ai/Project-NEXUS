<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationRetentionService;
use App\Services\EventRegistrationSubmissionService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationGuestAndRetentionServiceTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_guests_are_disabled_by_default_bounded_encrypted_and_never_activate_party_capacity(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$disabledEventId, $disabledStart] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($disabledEventId, $owner, $disabledStart);
        $disabledRegistration = $this->canonicalRegistration($disabledEventId, (int) $member->id);
        $service = new EventRegistrationGuestService();
        $this->assertReason(
            'event_registration_guests_disabled',
            fn () => $service->capture(
                $disabledEventId,
                $disabledRegistration,
                $member,
                1,
                'Guest One',
                null,
                null,
                true,
                'Guest privacy notice',
                'guest-notice-v1',
            ),
        );

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($eventId, $owner, $start, true, 1, 30);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $this->assertReason(
            'event_registration_guest_consent_required',
            fn () => $service->capture(
                $eventId,
                $registrationId,
                $member,
                1,
                'Guest One',
                'guest@example.test',
                '+1 555 123 4567',
                false,
                'Guest privacy notice',
                'guest-notice-v1',
            ),
        );
        $captured = $service->capture(
            $eventId,
            $registrationId,
            $member,
            1,
            'Guest One',
            'guest@example.test',
            '+1 555 123 4567',
            true,
            'Guest privacy notice',
            'guest-notice-v1',
        );
        self::assertSame(1, $captured['party_size']);
        self::assertArrayNotHasKey('display_name_ciphertext', $captured['guest']->toArray());
        self::assertArrayNotHasKey('email_ciphertext', $captured['guest']->toArray());
        $stored = DB::table('event_registration_guests')->find($captured['guest']->id);
        self::assertNotNull($stored);
        self::assertStringNotContainsString('Guest One', (string) $stored->display_name_ciphertext);
        self::assertStringNotContainsString('guest@example.test', (string) $stored->email_ciphertext);
        self::assertSame(1, (int) DB::table('event_registrations')->where('id', $registrationId)->value('party_size'));
        self::assertSame(1, (int) DB::table('event_registrations')->where('id', $registrationId)->value('registration_version'));
        $this->assertReason(
            'event_registration_guest_limit_reached',
            fn () => $service->capture(
                $eventId,
                $registrationId,
                $member,
                1,
                'Guest Two',
                null,
                null,
                true,
                'Guest privacy notice',
                'guest-notice-v1',
            ),
        );
    }

    public function test_retention_requires_a_recorded_dry_run_then_anonymises_due_data_without_losing_audit_evidence(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        $start = CarbonImmutable::now('UTC')->subDays(10)->startOfHour();
        $end = $start->addHours(3);
        [$eventId] = $this->registrationEvent((int) $owner->id, $start, $end);
        $settings = $this->registrationSettings($eventId, $owner, $start, true, 1, 1);
        $form = $this->publishedRegistrationForm(
            $eventId,
            $owner,
            $settings,
            $this->standardRegistrationQuestions(1),
        );
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $guest = (new EventRegistrationGuestService())->capture(
            $eventId,
            $registrationId,
            $member,
            1,
            'Retention Guest',
            'retention-guest@example.test',
            null,
            true,
            'Guest privacy notice',
            'guest-notice-v1',
        );
        $submissions = new EventRegistrationSubmissionService();
        $draft = $submissions->saveDraft(
            $eventId,
            $registrationId,
            (int) $form->id,
            $member,
            [
                'display_name' => 'Retention Member',
                'dietary_needs' => 'Sensitive retention value',
                'meal_choice' => 'Standard',
                'waiver' => true,
            ],
            null,
            'retention-submission-save',
        );
        $submissions->submit(
            $eventId,
            (int) $draft['submission']->id,
            $member,
            1,
            'retention-submission-submit',
        );
        $submissions->readAnswers(
            $eventId,
            (int) $draft['submission']->id,
            $owner,
            'Pre-retention support access',
            'retention-access-correlation',
        );
        $auditCount = DB::table('event_registration_answer_access_audits')->count();
        $asOf = $end->addDays(2);
        $retention = new EventRegistrationRetentionService();
        $this->assertReason(
            'event_registration_retention_preview_not_found',
            fn () => $retention->apply($eventId, 999999, $owner, 'retention-apply-without-preview'),
        );
        $dryRun = $retention->dryRun(
            $eventId,
            $owner,
            $asOf->toIso8601String(),
            'retention-dry-run',
        );
        $dryReplay = $retention->dryRun(
            $eventId,
            $owner,
            $asOf->toIso8601String(),
            'retention-dry-run',
        );
        self::assertTrue($dryRun['changed']);
        self::assertFalse($dryReplay['changed']);
        self::assertSame(5, (int) $dryRun['run']->eligible_count);
        self::assertSame(0, (int) $dryRun['run']->affected_count);
        self::assertSame(4, DB::table('event_registration_form_answers')->whereNotNull('answer_ciphertext')->count());
        self::assertNotNull(DB::table('event_registration_guests')->where('id', $guest['guest']->id)->value('display_name_ciphertext'));

        $applied = $retention->apply(
            $eventId,
            (int) $dryRun['run']->id,
            $owner,
            'retention-apply',
        );
        $applyReplay = $retention->apply(
            $eventId,
            (int) $dryRun['run']->id,
            $owner,
            'retention-apply',
        );
        // A lost preview response must remain recoverable after another organiser
        // applies that snapshot; current candidates no longer describe the request.
        $afterApplyReplay = $retention->dryRun($eventId, $owner, $dryRun['run']->as_of_utc, 'retention-dry-run');
        self::assertFalse($afterApplyReplay['changed']);
        self::assertSame((int) $dryRun['run']->id, (int) $afterApplyReplay['run']->id);
        self::assertSame(5, (int) $afterApplyReplay['run']->eligible_count);
        self::assertSame(2, DB::table('event_registration_retention_runs')->where('event_id', $eventId)->count());
        $this->assertReason('event_registration_retention_idempotency_conflict', fn () =>
            $retention->dryRun($eventId, $owner, $asOf->addHour(), 'retention-dry-run'));
        $this->assertReason('event_registration_retention_idempotency_conflict', fn () =>
            $retention->dryRun($eventId, $owner, $asOf, 'retention-apply'));
        $freshPreview = $retention->dryRun($eventId, $owner, $asOf, 'retention-fresh-after-apply');
        self::assertTrue($freshPreview['changed']);
        self::assertSame(0, (int) $freshPreview['run']->eligible_count);
        self::assertTrue($applied['changed']);
        self::assertFalse($applyReplay['changed']);
        self::assertSame(5, (int) $applied['run']->affected_count);
        self::assertSame(0, DB::table('event_registration_form_answers')->whereNotNull('answer_ciphertext')->count());
        self::assertSame(4, DB::table('event_registration_form_answers')->whereNotNull('purged_at')->count());
        self::assertSame('anonymised', DB::table('event_registration_guests')->where('id', $guest['guest']->id)->value('status'));
        self::assertNull(DB::table('event_registration_guests')->where('id', $guest['guest']->id)->value('display_name_ciphertext'));
        self::assertSame('anonymised', DB::table('event_registration_form_submissions')->where('id', $draft['submission']->id)->value('status'));
        self::assertSame($auditCount, DB::table('event_registration_answer_access_audits')->count());
        self::assertSame(1, (int) DB::table('event_registrations')->where('id', $registrationId)->value('party_size'));
        self::assertSame(1, (int) DB::table('event_registrations')->where('id', $registrationId)->value('registration_version'));

        $runId = (int) $applied['run']->id;
        try {
            DB::table('event_registration_retention_runs')
                ->where('id', $runId)
                ->update(['affected_count' => 0]);
            self::fail('Retention evidence update was not blocked.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('ev_reg_retention_run_immutable', $exception->getMessage());
        }
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
}
