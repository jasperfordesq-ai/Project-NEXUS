<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventRegistrationFormService;
use App\Services\EventRegistrationSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationSettingsAndFormServiceTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_settings_are_timezone_exact_boundary_safe_optimistic_and_idempotent(): void
    {
        $owner = $this->eventUser();
        $start = CarbonImmutable::create(2027, 7, 20, 10, 0, 0, 'Europe/Dublin');
        [$eventId] = $this->registrationEvent(
            (int) $owner->id,
            $start,
            $start->addHours(3),
            'Europe/Dublin',
        );
        $service = new EventRegistrationSettingsService();
        $payload = [
            'approval_mode' => 'manual',
            'opens_at' => '2027-07-01T09:00:00+01:00',
            'closes_at' => '2027-07-20T10:00:00+01:00',
            'cancellation_cutoff_at' => '2027-07-20T10:00:00+01:00',
            'per_member_limit' => 1,
            'guests_enabled' => false,
            'max_guests_per_registration' => 0,
            'guest_retention_days' => 30,
        ];
        $created = $service->save($eventId, $owner, $payload, null, 'settings-idempotent-create');
        $replay = $service->save($eventId, $owner, $payload, null, 'settings-idempotent-create');

        self::assertTrue($created['changed']);
        self::assertFalse($replay['changed']);
        self::assertSame(1, (int) $created['settings']->revision);
        self::assertSame('2027-07-20 09:00:00', $created['settings']->closes_at_utc?->format('Y-m-d H:i:s'));
        self::assertFalse((bool) $created['settings']->guests_enabled);
        self::assertSame(0, (int) $created['settings']->max_guests_per_registration);
        self::assertSame(1, DB::table('event_registration_settings')->count());
        self::assertSame(1, DB::table('event_registration_settings_history')->count());

        $this->assertReason(
            'event_registration_settings_idempotency_conflict',
            fn () => $service->save(
                $eventId,
                $owner,
                [...$payload, 'approval_mode' => 'auto'],
                null,
                'settings-idempotent-create',
            ),
        );
        $this->assertReason(
            'event_registration_timezone_offset_mismatch',
            fn () => $service->save(
                $eventId,
                $owner,
                ['opens_at' => '2027-07-02T09:00:00+00:00'],
                1,
                'settings-bad-offset',
            ),
        );
        $this->assertReason(
            'event_registration_settings_revision_conflict',
            fn () => $service->save(
                $eventId,
                $owner,
                ['approval_mode' => 'auto'],
                99,
                'settings-stale-version',
            ),
        );

        $published = $service->publish($eventId, $owner, 1, 'settings-publish');
        self::assertSame('published', $published['settings']->status->value);
        self::assertSame(2, (int) $published['settings']->revision);
    }

    public function test_explicit_null_clears_dates_while_omitted_dates_are_preserved(): void
    {
        $owner = $this->eventUser();
        $service = new EventRegistrationSettingsService();
        foreach (['_utc', ''] as $suffix) {
            [$eventId, $start] = $this->registrationEvent((int) $owner->id);
            $payload = [
                'opens_at' . $suffix => $start->subDays(7)->toIso8601String(),
                'closes_at' . $suffix => $start->toIso8601String(),
                'cancellation_cutoff_at' . $suffix => $start->toIso8601String(),
            ];
            $service->save($eventId, $owner, $payload, 0, 'date-create-' . $eventId);
            $preserved = $service->save($eventId, $owner, ['approval_mode' => 'manual'], 1, 'date-preserve-' . $eventId);
            self::assertSame($start->format('Y-m-d H:i:s'), $preserved['settings']->closes_at_utc->format('Y-m-d H:i:s'));
            self::assertNotNull($preserved['settings']->opens_at_utc);
            self::assertNotNull($preserved['settings']->cancellation_cutoff_at_utc);

            $clear = array_fill_keys(array_keys($payload), null);
            $cleared = $service->save($eventId, $owner, $clear, 2, 'date-clear-' . $eventId);
            foreach (['opens_at_utc', 'closes_at_utc', 'cancellation_cutoff_at_utc'] as $field) {
                self::assertNull($cleared['settings']->{$field}, $field . ' must be cleared by explicit null');
            }
            self::assertSame(3, (int) $cleared['settings']->revision);
            $replayed = $service->save($eventId, $owner, $clear, 2, 'date-clear-' . $eventId);
            self::assertFalse($replayed['changed']);
            self::assertSame(3, (int) $replayed['settings']->revision);
            self::assertSame(3, DB::table('event_registration_settings_history')->where('event_id', $eventId)->count());
        }
    }

    public function test_explicit_utc_fields_accept_client_instants_in_a_non_utc_event(): void
    {
        $owner = $this->eventUser();
        $start = CarbonImmutable::parse('2030-07-20T10:00:00+01:00');
        [$eventId] = $this->registrationEvent((int) $owner->id, $start, $start->addHours(2), 'Europe/Dublin');
        $service = new EventRegistrationSettingsService();
        $payload = ['opens_at_utc' => '2030-07-01T09:00:00.000Z', 'closes_at_utc' => '2030-07-20T09:00:00.000Z',
            'cancellation_cutoff_at_utc' => '2030-07-20T08:30:00.000Z'];
        $saved = $service->save($eventId, $owner, $payload, 0, 'utc-client-settings');
        self::assertSame('2030-07-20 09:00:00', $saved['settings']->closes_at_utc->format('Y-m-d H:i:s'));
        self::assertSame('Europe/Dublin', $saved['settings']->event_timezone_snapshot);
        self::assertFalse($service->save($eventId, $owner, $payload, 0, 'utc-client-settings')['changed']);
        $this->assertReason('event_registration_timezone_offset_mismatch', fn () => $service->save(
            $eventId, $owner, ['opens_at' => '2030-07-01T09:00:00Z'], 1, 'local-wrong-offset',
        ));
    }

    public function test_forms_are_versioned_and_published_definitions_are_database_immutable(): void
    {
        $owner = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $settings = $this->registrationSettings($eventId, $owner, $start);
        $service = new EventRegistrationFormService();
        $questions = $this->standardRegistrationQuestions();
        $draft = $service->createDraft(
            $eventId,
            $owner,
            'Enterprise registration',
            'Versioned form fixture',
            $questions,
            (int) $settings->revision,
            'form-create-idempotent',
        );
        $replay = $service->createDraft(
            $eventId,
            $owner,
            'Enterprise registration',
            'Versioned form fixture',
            $questions,
            (int) $settings->revision,
            'form-create-idempotent',
        );
        self::assertTrue($draft['changed']);
        self::assertFalse($replay['changed']);
        self::assertSame($draft['form']->id, $replay['form']->id);
        self::assertSame(1, (int) $draft['form']->version_number);
        self::assertCount(4, $draft['form']->questions);

        $updated = $service->updateDraft(
            $eventId,
            (int) $draft['form']->id,
            $owner,
            ['name' => 'Enterprise registration v1'],
            1,
            $draft['settings_revision'],
            'form-update-v1',
        );
        self::assertSame(2, (int) $updated['form']->revision);
        $published = $service->publish(
            $eventId,
            (int) $updated['form']->id,
            $owner,
            2,
            $updated['settings_revision'],
            'form-publish-v1',
        );
        self::assertSame('published', $published['form']->status->value);
        self::assertNotNull($published['form']->published_at);

        $this->assertImmutableQuery(
            fn () => DB::table('event_registration_form_versions')
                ->where('id', $published['form']->id)
                ->update(['name' => 'Tampered']),
            'event_registration_published_form_immutable',
        );
        $questionId = (int) $published['form']->questions->first()->id;
        $this->assertImmutableQuery(
            fn () => DB::table('event_registration_form_questions')
                ->where('id', $questionId)
                ->update(['prompt' => 'Tampered']),
            'event_registration_published_question_immutable',
        );
        $this->assertReason(
            'event_registration_published_form_immutable',
            fn () => $service->updateDraft(
                $eventId,
                (int) $published['form']->id,
                $owner,
                ['name' => 'Illegal mutation'],
                (int) $published['form']->revision,
                $published['settings_revision'],
                'form-illegal-update',
            ),
        );

        $fork = $service->forkPublished(
            $eventId,
            (int) $published['form']->id,
            $owner,
            $published['settings_revision'],
            'form-fork-v2',
        );
        self::assertSame(2, (int) $fork['form']->version_number);
        self::assertSame('draft', $fork['form']->status->value);
        self::assertSame(
            1,
            (int) DB::table('event_registration_settings')
                ->where('event_id', $eventId)
                ->value('published_form_version'),
            'A draft fork must not deactivate the currently published form.',
        );
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
