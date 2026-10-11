<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Exceptions\EventAttendanceException;
use App\Models\Event;
use App\Models\User;
use App\Services\EventAttendanceService;
use App\Services\EventPeopleService;
use App\Services\EventRegistrationSubmissionService;
use App\Services\EventService;
use App\Support\Events\EventPeopleQuery;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-102 — "required" registration questions (including waiver and consent
 * questions) were required of nobody.
 *
 * A form submission can only be made after a registration exists, and neither
 * the registration writer nor the attendance writer read
 * event_registration_form_submissions, so a member who never answered the
 * required questions — never accepted the waiver — could hold a place and be
 * checked in.
 *
 * Behaviour after the fix: confirming a place is unchanged (answers follow
 * it), but when the event's published form has required questions a member
 * with no submitted answers cannot be checked in on any path, and the
 * organiser's people list does not offer check-in for them.
 */
final class EventCheckInRequiresSubmittedAnswersTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.attendance_credit_mode', 'off');
    }

    public function test_a_member_who_has_not_submitted_required_answers_cannot_be_checked_in(): void
    {
        [$eventId, $owner, $member] = $this->eventWithForm(true);
        $this->startNow($eventId);

        $this->assertRefused(fn () => app(EventAttendanceService::class)->transition(
            $eventId,
            (int) $member->id,
            EventAttendanceAction::CheckIn,
            $owner,
            0,
            null,
            'answers-outstanding-transition',
        ));
        $this->assertRefused(fn () => app(EventAttendanceService::class)->record(
            $eventId,
            (int) $member->id,
            $owner,
            null,
            null,
            'answers-outstanding-record',
        ));
        self::assertFalse(
            DB::table('event_attendance')->where('event_id', $eventId)->exists(),
            'BAD OUTCOME: a member who never answered the required questions was checked in.',
        );
    }

    public function test_a_saved_but_unsubmitted_draft_does_not_count(): void
    {
        [$eventId, $owner, $member, $registrationId, $formId] = $this->eventWithForm(true);
        (new EventRegistrationSubmissionService())->saveDraft(
            $eventId,
            $registrationId,
            $formId,
            $member,
            ['display_name' => 'Draft only'],
            null,
            'answers-draft-only',
        );
        $this->startNow($eventId);

        $this->assertRefused(fn () => app(EventAttendanceService::class)->transition(
            $eventId,
            (int) $member->id,
            EventAttendanceAction::CheckIn,
            $owner,
            0,
            null,
            'answers-draft-transition',
        ));
    }

    public function test_control_a_member_who_submitted_the_answers_is_checked_in(): void
    {
        [$eventId, $owner, $member, $registrationId, $formId] = $this->eventWithForm(true);
        $this->submitAnswers($eventId, $registrationId, $formId, $member);
        $this->startNow($eventId);

        $result = app(EventAttendanceService::class)->transition(
            $eventId,
            (int) $member->id,
            EventAttendanceAction::CheckIn,
            $owner,
            0,
            null,
            'answers-submitted-transition',
        );

        self::assertSame('checked_in', $result->toState->value);
    }

    public function test_control_a_form_without_required_questions_does_not_block_check_in(): void
    {
        [$eventId, $owner, $member] = $this->eventWithForm(false);
        $this->startNow($eventId);

        $result = app(EventAttendanceService::class)->transition(
            $eventId,
            (int) $member->id,
            EventAttendanceAction::CheckIn,
            $owner,
            0,
            null,
            'answers-optional-transition',
        );

        self::assertSame('checked_in', $result->toState->value);
    }

    public function test_the_organiser_people_endpoint_refuses_with_a_clear_error(): void
    {
        [$eventId, $owner, $member] = $this->eventWithForm(true);
        $this->startNow($eventId);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost(
            "/v2/events/{$eventId}/people/{$member->id}/attendance",
            ['action' => 'check_in', 'expected_version' => 0],
            ['Idempotency-Key' => 'answers-outstanding-http'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_ATTENDANCE_REQUIRED_ANSWERS_OUTSTANDING')
            ->assertJsonPath('errors.0.message', __('event_registration.required_answers_outstanding'));
        self::assertFalse(DB::table('event_attendance')->where('event_id', $eventId)->exists());
    }

    public function test_the_legacy_check_in_routes_refuse_with_the_same_clear_error(): void
    {
        [$eventId, $owner, $member] = $this->eventWithForm(true);
        $this->startNow($eventId);
        Sanctum::actingAs($owner, ['*']);

        // Before the fix both routes answered 500 CHECKIN_ERROR ("check-in
        // failed"), which tells the organiser nothing they can act on.
        $this->apiPost(
            "/v2/events/{$eventId}/attendees/{$member->id}/check-in",
            [],
            ['Idempotency-Key' => 'answers-outstanding-legacy-checkin'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_ATTENDANCE_REQUIRED_ANSWERS_OUTSTANDING')
            ->assertJsonPath('errors.0.message', __('event_registration.required_answers_outstanding'));

        $this->apiPost(
            "/v2/events/{$eventId}/attendance",
            ['user_id' => (int) $member->id],
            ['Idempotency-Key' => 'answers-outstanding-legacy-attendance'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_ATTENDANCE_REQUIRED_ANSWERS_OUTSTANDING');

        $bulk = $this->apiPost(
            "/v2/events/{$eventId}/attendance/bulk",
            ['user_ids' => [(int) $member->id]],
            ['Idempotency-Key' => 'answers-outstanding-legacy-bulk'],
        )->assertOk();
        self::assertSame(
            'EVENT_ATTENDANCE_REQUIRED_ANSWERS_OUTSTANDING',
            $bulk->json('data.outcomes.0.error.code'),
        );
        self::assertSame(409, $bulk->json('data.outcomes.0.http_status'));

        self::assertFalse(DB::table('event_attendance')->where('event_id', $eventId)->exists());
    }

    public function test_the_legacy_attendance_service_reports_the_clear_error(): void
    {
        [$eventId, $owner, $member] = $this->eventWithForm(true);
        $this->startNow($eventId);

        self::assertFalse(EventService::markAttended($eventId, (int) $member->id, (int) $owner->id));
        $errors = EventService::getErrors();
        self::assertSame('EVENT_ATTENDANCE_REQUIRED_ANSWERS_OUTSTANDING', $errors[0]['code'] ?? null);
        self::assertSame(__('event_registration.required_answers_outstanding'), $errors[0]['message'] ?? null);
    }

    public function test_the_people_list_does_not_offer_check_in_while_answers_are_outstanding(): void
    {
        [$eventId, , $member] = $this->eventWithForm(true);
        [, , $answered, $answeredRegistration, $formId] = $this->addMember($eventId);
        $this->submitAnswers($eventId, $answeredRegistration, $formId, $answered);
        $this->startNow($eventId);
        /** @var Event $event */
        $event = Event::withoutGlobalScopes()->findOrFail($eventId);

        $items = collect(app(EventPeopleService::class)->paginate($event, new EventPeopleQuery())['items'])
            ->keyBy(fn (array $person): int => (int) $person['member']['id']);

        self::assertFalse(
            $items[(int) $member->id]['management_actions']['check_in'],
            'Check-in is offered for a member whose required answers are outstanding.',
        );
        self::assertTrue($items[(int) $answered->id]['management_actions']['check_in']);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @var array<int,array{0:User,1:int}> */
    private array $fixtures = [];

    /** @return array{0:int,1:User,2:User,3:int,4:int} */
    private function eventWithForm(bool $withRequiredQuestions): array
    {
        $owner = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $settings = $this->registrationSettings($eventId, $owner, $start);
        $questions = $this->standardRegistrationQuestions();
        if (! $withRequiredQuestions) {
            $questions = array_map(static function (array $question): array {
                $question['is_required'] = false;

                return $question;
            }, $questions);
        }
        $form = $this->publishedRegistrationForm($eventId, $owner, $settings, $questions);
        $this->fixtures[$eventId] = [$owner, (int) $form->id];
        [, , $member, $registrationId] = $this->addMember($eventId);

        return [$eventId, $owner, $member, $registrationId, (int) $form->id];
    }

    /** @return array{0:int,1:User,2:User,3:int,4:int} */
    private function addMember(int $eventId): array
    {
        [$owner, $formId] = $this->fixtures[$eventId];
        $member = $this->eventUser();
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $member->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$eventId, $owner, $member, $registrationId, $formId];
    }

    private function submitAnswers(int $eventId, int $registrationId, int $formId, User $member): void
    {
        $service = new EventRegistrationSubmissionService();
        $draft = $service->saveDraft(
            $eventId,
            $registrationId,
            $formId,
            $member,
            [
                'display_name' => 'Answered attendee',
                'meal_choice' => 'Standard',
                'waiver' => true,
            ],
            null,
            'answers-save-' . $registrationId,
        );
        $service->submit(
            $eventId,
            (int) $draft['submission']->id,
            $member,
            (int) $draft['submission']->revision,
            'answers-submit-' . $registrationId,
        );
        TenantContext::setById($this->testTenantId);
    }

    private function startNow(int $eventId): void
    {
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', $eventId)->update([
            'start_time' => now()->subMinutes(10),
            'end_time' => now()->addHours(2),
        ]);
    }

    private function assertRefused(callable $checkIn): void
    {
        try {
            $checkIn();
            self::fail('BAD OUTCOME: check-in succeeded although the required registration answers were outstanding.');
        } catch (EventAttendanceException $exception) {
            self::assertSame('event_attendance_required_answers_outstanding', $exception->reasonCode);
        }
    }
}
