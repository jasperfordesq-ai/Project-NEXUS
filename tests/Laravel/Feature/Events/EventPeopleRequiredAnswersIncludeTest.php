<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Http\Resources\EventRosterResource;
use App\Models\User;
use App\Services\EventRegistrationSubmissionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-102 — organisers could not see who still owes the event's required
 * registration answers. Check-in was refused for those members and the
 * button withheld, with no label saying why.
 *
 * The People response is parsed by the store mobile app with strict schemas,
 * so the new per-row flag is opt-in: it appears only when the caller asks
 * for it with `include=required_answers`. Without the parameter the response
 * is byte-for-byte the shape today's app accepts.
 */
final class EventPeopleRequiredAnswersIncludeTest extends TestCase
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

    public function test_the_flag_is_absent_unless_the_caller_asks_for_it(): void
    {
        [$eventId, $owner] = $this->eventWithRequiredForm();
        Sanctum::actingAs($owner, ['*']);

        $rows = $this->apiGet("/v2/events/{$eventId}/people")->assertOk()->json('data');

        self::assertNotEmpty($rows);
        foreach ($rows as $row) {
            self::assertArrayNotHasKey(
                'required_answers_outstanding',
                $row['registration'],
                'The default People response grew a field the store app does not accept.',
            );
            self::assertArrayNotHasKey('required_answers_outstanding', $row);
        }
    }

    public function test_the_flag_names_who_still_owes_answers_when_asked_for(): void
    {
        [$eventId, $owner, $formId] = $this->eventWithRequiredForm();
        $owing = $this->member($eventId);
        $answered = $this->member($eventId);
        $this->submitAnswers($eventId, $answered[1], $formId, $answered[0]);
        $cancelled = $this->member($eventId, 'cancelled');
        Sanctum::actingAs($owner, ['*']);

        $rows = collect(
            $this->apiGet("/v2/events/{$eventId}/people?include=required_answers")
                ->assertOk()
                ->json('data'),
        )->keyBy(fn (array $row): int => (int) $row['member']['id']);

        self::assertTrue($rows[(int) $owing[0]->id]['registration']['required_answers_outstanding']);
        self::assertFalse($rows[(int) $owing[0]->id]['management_actions']['check_in']);
        self::assertFalse($rows[(int) $answered[0]->id]['registration']['required_answers_outstanding']);
        // A member no longer holding or seeking a place owes nothing.
        self::assertFalse($rows[(int) $cancelled[0]->id]['registration']['required_answers_outstanding']);
    }

    public function test_an_unknown_include_value_is_refused(): void
    {
        [$eventId, $owner] = $this->eventWithRequiredForm();
        Sanctum::actingAs($owner, ['*']);

        $this->apiGet("/v2/events/{$eventId}/people?include=email")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_QUERY_INVALID');
    }

    public function test_the_check_in_staff_projection_carries_the_flag_only_when_asked_for(): void
    {
        $row = ['user_id' => 7, 'registration_state' => 'confirmed', 'required_answers_outstanding' => true];

        self::assertArrayNotHasKey(
            'required_answers_outstanding',
            EventRosterResource::attendanceFromArray($row)['registration'],
        );
        self::assertTrue(
            EventRosterResource::attendanceFromArray($row, true)['registration']['required_answers_outstanding'],
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @var array<int,User> */
    private array $owners = [];

    /** @return array{0:int,1:User,2:int} */
    private function eventWithRequiredForm(): array
    {
        $owner = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $settings = $this->registrationSettings($eventId, $owner, $start);
        $form = $this->publishedRegistrationForm(
            $eventId,
            $owner,
            $settings,
            $this->standardRegistrationQuestions(),
        );
        $this->owners[$eventId] = $owner;
        $this->member($eventId);

        return [$eventId, $owner, (int) $form->id];
    }

    /** @return array{0:User,1:int} */
    private function member(int $eventId, string $state = 'confirmed'): array
    {
        $member = $this->eventUser();
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id, $state);

        return [$member, $registrationId];
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
            'include-answers-save-' . $registrationId,
        );
        $service->submit(
            $eventId,
            (int) $draft['submission']->id,
            $member,
            (int) $draft['submission']->revision,
            'include-answers-submit-' . $registrationId,
        );
        TenantContext::setById($this->testTenantId);
    }
}
