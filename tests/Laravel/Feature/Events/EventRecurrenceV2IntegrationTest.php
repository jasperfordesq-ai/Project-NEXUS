<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use App\Services\EventRecurrenceService;
use App\Services\EventNotificationOutboxProcessor;
use App\Services\EventPublicationWorkflowService;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventRecurrenceV2IntegrationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('events.recurrence.engine_v2_enabled', true);
        config()->set('events.recurrence.max_occurrences', 366);
        config()->set('events.recurrence.max_horizon_years', 20);
    }

    public function test_flagged_create_is_atomic_and_materializes_count_including_dtstart(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);

        $response = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'V2 count-ten series',
            'recurrence_frequency' => 'daily',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 10,
        ]))->assertCreated();

        $templateId = (int) $response->json('data.template.id');
        $this->assertSame(10, (int) $response->json('data.occurrences_created'));
        $template = DB::table('events')->where('id', $templateId)->first();
        $rule = DB::table('event_recurrence_rules')->where('event_id', $templateId)->first();
        $occurrences = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('parent_event_id', $templateId)
            ->orderBy('start_time')
            ->get();

        $this->assertNotNull($template);
        $this->assertNotNull($rule);
        $this->assertNull($template->occurrence_key);
        $this->assertNull($template->recurrence_id);
        $this->assertSame(EventRecurrenceService::ENGINE, $template->recurrence_engine);
        $this->assertSame(EventRecurrenceService::ENGINE_VERSION, $template->recurrence_engine_version);
        $this->assertSame('FREQ=DAILY;INTERVAL=1;COUNT=10', $rule->rrule);
        $this->assertSame(EventRecurrenceService::ENGINE, $rule->recurrence_engine);
        $this->assertSame(EventRecurrenceService::ENGINE_VERSION, $rule->recurrence_engine_version);
        $this->assertSame(64, strlen((string) $rule->rule_hash));
        $this->assertCount(10, $occurrences);
        $this->assertSame($template->start_time, $occurrences->first()->start_time);
        $this->assertSame('2027-06-15', $occurrences->first()->occurrence_date);
        $this->assertSame('2027-06-24', $occurrences->last()->occurrence_date);

        foreach ($occurrences as $occurrence) {
            $this->assertSame('draft', $occurrence->status);
            $this->assertSame('draft', $occurrence->publication_status);
            $this->assertSame(EventRecurrenceService::ENGINE, $occurrence->recurrence_engine);
            $this->assertSame(EventRecurrenceService::ENGINE_VERSION, $occurrence->recurrence_engine_version);
            $this->assertSame(
                (new \DateTimeImmutable((string) $occurrence->start_time, new \DateTimeZone('UTC')))
                    ->format('Ymd\\THis\\Z'),
                $occurrence->recurrence_id,
            );
            $this->assertStringStartsWith(
                "recurrence:{$this->testTenantId}:{$templateId}:",
                (string) $occurrence->occurrence_key,
            );
        }
    }

    public function test_exclusions_additions_and_last_day_rule_persist_losslessly(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);

        $response = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'V2 month-end exceptions',
            'start_time' => '2027-01-31 09:00:00',
            'end_time' => '2027-01-31 10:00:00',
            'timezone' => 'UTC',
            'recurrence_rrule' => 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3',
            'recurrence_exdates' => ['2027-02-28 09:00:00'],
            'recurrence_additions' => ['2027-02-27 09:00:00'],
            'recurrence_frequency' => 'custom',
        ]))->assertCreated();

        $templateId = (int) $response->json('data.template.id');
        $rule = DB::table('event_recurrence_rules')->where('event_id', $templateId)->first();
        $dates = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('parent_event_id', $templateId)
            ->orderBy('start_time')
            ->pluck('occurrence_date')
            ->all();

        $this->assertSame('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', $rule->rrule);
        $this->assertNull($rule->day_of_month);
        $this->assertSame(['20270228T090000Z'], json_decode($rule->exdates, true, 512, JSON_THROW_ON_ERROR));
        $this->assertSame(['20270227T090000Z'], json_decode($rule->rdates, true, 512, JSON_THROW_ON_ERROR));
        $this->assertSame(['2027-01-31', '2027-02-27', '2027-03-31'], $dates);
    }

    public function test_regeneration_is_authorized_and_idempotent(): void
    {
        $organizer = $this->activeUser();
        $other = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'V2 regeneration target',
            'recurrence_frequency' => 'weekly',
            'recurrence_days' => '2,4',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 4,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $before = DB::table('events')->where('parent_event_id', $templateId)->pluck('occurrence_key')->all();

        $this->assertSame(0, EventService::regenerateRecurring($templateId, (int) $organizer->id));
        $after = DB::table('events')->where('parent_event_id', $templateId)->pluck('occurrence_key')->all();
        $this->assertSame($before, $after);

        $this->assertNull(EventService::regenerateRecurring($templateId, (int) $other->id));
        $this->assertSame('FORBIDDEN', EventService::getErrors()[0]['code']);
        $this->assertSame($before, DB::table('events')->where('parent_event_id', $templateId)->pluck('occurrence_key')->all());
    }

    public function test_recurrence_identity_is_immutable_and_unique_within_series(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Immutable recurrence identity',
            'recurrence_frequency' => 'daily',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $rows = DB::table('events')->where('parent_event_id', $templateId)->orderBy('id')->get();
        $first = $rows->first();

        try {
            DB::table('events')->where('id', (int) $first->id)->update([
                'recurrence_id' => '20990101T000000Z',
            ]);
            self::fail('A persisted recurrence identity was mutable.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('event_recurrence_id_immutable', $exception->getMessage());
        }

        $duplicate = (array) $rows->last();
        unset($duplicate['id']);
        $duplicate['occurrence_key'] = 'recurrence-duplicate-' . bin2hex(random_bytes(8));
        $duplicate['recurrence_id'] = (string) $first->recurrence_id;
        try {
            DB::table('events')->insert($duplicate);
            self::fail('A duplicate recurrence identity was accepted.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('uq_events_tenant_parent_recurrence_id', $exception->getMessage());
        }
    }

    public function test_regeneration_fails_closed_when_existing_v2_child_is_missing_recurrence_identity(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Missing recurrence identity',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $additionalRecurrenceId = '20270720T090000Z';
        $additionalOccurrenceKey = app(EventRecurrenceService::class)->occurrenceKey(
            $this->testTenantId,
            $templateId,
            $additionalRecurrenceId,
        );
        DB::table('event_recurrence_rules')->where('event_id', $templateId)->update([
            'rdates' => json_encode([$additionalRecurrenceId], JSON_THROW_ON_ERROR),
        ]);
        $row = (array) DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('id')
            ->first();
        unset($row['id']);
        $row['start_time'] = '2027-07-20 09:00:00';
        $row['end_time'] = '2027-07-20 10:30:00';
        $row['occurrence_date'] = '2027-07-20';
        $row['occurrence_key'] = $additionalOccurrenceKey;
        $row['recurrence_id'] = null;
        $row['created_at'] = now();
        $row['updated_at'] = now();
        DB::table('events')->insert($row);

        self::assertNull(EventService::regenerateRecurring($templateId, (int) $organizer->id));
        self::assertSame('SERVER_ERROR', EventService::getErrors()[0]['code'] ?? null);
        self::assertSame(1, DB::table('events')
            ->where('parent_event_id', $templateId)
            ->where('occurrence_key', $row['occurrence_key'])
            ->whereNull('recurrence_id')
            ->count());
    }

    public function test_regeneration_rechecks_the_locked_root_and_cannot_add_draft_children_after_publication(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Published regeneration boundary',
            'recurrence_frequency' => 'daily',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 4,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $additionalRecurrenceId = '20270720T090000Z';
        $additionalOccurrenceKey = app(EventRecurrenceService::class)->occurrenceKey(
            $this->testTenantId,
            $templateId,
            $additionalRecurrenceId,
        );
        DB::table('event_recurrence_rules')->where('event_id', $templateId)->update([
            'rdates' => json_encode([$additionalRecurrenceId], JSON_THROW_ON_ERROR),
        ]);
        DB::table('events')->where('id', $templateId)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);
        $before = DB::table('events')->where('parent_event_id', $templateId)->count();

        try {
            EventService::regenerateRecurring($templateId, (int) $organizer->id);
            self::fail('Published recurrence root accepted materialisation.');
        } catch (ValidationException $exception) {
            self::assertArrayHasKey('publication_status', $exception->errors());
        }

        self::assertSame($before, DB::table('events')->where('parent_event_id', $templateId)->count());
        self::assertSame(0, DB::table('events')
            ->where('parent_event_id', $templateId)
            ->where('occurrence_key', $additionalOccurrenceKey)
            ->count());
    }

    public function test_series_wide_edit_always_updates_a_past_template_and_only_future_children(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Past root source title',
            'recurrence_frequency' => 'daily',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 3,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $children = DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        DB::table('events')->where('id', $templateId)->update(['start_time' => now()->subDays(2)]);
        DB::table('events')->where('id', $children[0])->update(['start_time' => now()->subDay()]);

        self::assertTrue(EventService::updateRecurring(
            $children[1],
            (int) $organizer->id,
            ['title' => 'Canonical updated source title'],
            'all',
        ));

        self::assertSame('Canonical updated source title', DB::table('events')->where('id', $templateId)->value('title'));
        self::assertSame('Past root source title', DB::table('events')->where('id', $children[0])->value('title'));
        self::assertSame('Canonical updated source title', DB::table('events')->where('id', $children[1])->value('title'));
        self::assertSame('Canonical updated source title', DB::table('events')->where('id', $children[2])->value('title'));
    }

    public function test_generic_update_rejects_templates_and_attached_occurrences_without_recurrence_scope(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Scoped update boundary',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $occurrenceId = (int) DB::table('events')->where('parent_event_id', $templateId)->value('id');

        foreach ([$templateId, $occurrenceId] as $eventId) {
            $this->apiPut("/v2/events/{$eventId}", ['title' => 'Bypassed scoped update'])
                ->assertUnprocessable()
                ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_SCOPE_REQUIRED');
        }

        self::assertSame('Scoped update boundary', DB::table('events')->where('id', $templateId)->value('title'));
        self::assertSame('Scoped update boundary', DB::table('events')->where('id', $occurrenceId)->value('title'));
        self::assertSame(0, DB::table('event_domain_outbox')
            ->whereIn('event_id', [$templateId, $occurrenceId])
            ->where('action', 'event.updated')
            ->count());
    }

    public function test_single_occurrence_override_retains_series_membership_lifecycle_and_regeneration_identity(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Immutable recurrence membership',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $occurrenceIds = DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $exceptionId = $occurrenceIds[0];

        self::assertTrue(EventService::updateRecurring(
            $exceptionId,
            (int) $organizer->id,
            ['title' => 'Customized occurrence title'],
            'single',
        ));
        $exception = DB::table('events')->where('id', $exceptionId)->first();
        self::assertSame($templateId, (int) $exception->parent_event_id);
        self::assertSame(1, (int) $exception->is_recurrence_exception);
        self::assertSame(['title'], json_decode(
            (string) $exception->recurrence_override_fields,
            true,
            512,
            JSON_THROW_ON_ERROR,
        ));
        self::assertSame(1, (int) $exception->recurrence_override_version);
        self::assertTrue(EventService::updateRecurring(
            $exceptionId,
            (int) $organizer->id,
            ['title' => 'Customized occurrence title'],
            'single',
        ));
        self::assertSame(1, (int) DB::table('events')
            ->where('id', $exceptionId)
            ->value('recurrence_override_version'));
        if (Schema::hasTable('event_recurrence_occurrence_ledger')) {
            self::assertSame(1, DB::table('event_recurrence_occurrence_ledger')
                ->where('event_id', $exceptionId)
                ->where('state', 'customized')
                ->count());
        }

        self::assertSame(0, EventService::regenerateRecurring($templateId, (int) $organizer->id));
        self::assertSame(2, DB::table('events')->where('parent_event_id', $templateId)->count());

        self::assertTrue(EventService::updateRecurring(
            $templateId,
            (int) $organizer->id,
            ['title' => 'Series-wide source title', 'location' => 'Updated venue'],
            'all',
        ));
        self::assertSame('Customized occurrence title', DB::table('events')->where('id', $exceptionId)->value('title'));
        self::assertSame('Updated venue', DB::table('events')->where('id', $exceptionId)->value('location'));
        self::assertSame('Series-wide source title', DB::table('events')->where('id', $occurrenceIds[1])->value('title'));

        app(EventPublicationWorkflowService::class)->publish($templateId, $organizer);
        self::assertSame('published', DB::table('events')->where('id', $exceptionId)->value('publication_status'));
        self::assertTrue(EventService::cancelEvent(
            $templateId,
            (int) $organizer->id,
            'Series lifecycle includes customized occurrence',
            'recurrence-exception-series-cancel',
        ), json_encode(EventService::getErrors(), JSON_THROW_ON_ERROR));
        self::assertSame('cancelled', DB::table('events')->where('id', $exceptionId)->value('operational_status'));
        self::assertSame($templateId, (int) DB::table('events')->where('id', $exceptionId)->value('parent_event_id'));
    }

    public function test_single_scope_full_form_noop_does_not_create_override_evidence(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'No-op override boundary',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $occurrenceId = (int) DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('id')
            ->value('id');

        self::assertTrue(EventService::updateRecurring(
            $occurrenceId,
            (int) $organizer->id,
            $this->payload(['title' => 'No-op override boundary']),
            'single',
        ), json_encode(EventService::getErrors(), JSON_THROW_ON_ERROR));
        $row = DB::table('events')->where('id', $occurrenceId)->first();
        self::assertNotNull($row);
        self::assertSame(0, (int) $row->is_recurrence_exception);
        self::assertNull($row->recurrence_override_fields);
        self::assertSame(0, (int) $row->recurrence_override_version);
        if (Schema::hasTable('event_recurrence_occurrence_ledger')) {
            self::assertSame(0, DB::table('event_recurrence_occurrence_ledger')
                ->where('event_id', $occurrenceId)
                ->where('state', 'customized')
                ->count());
        }
    }

    public function test_description_only_all_scope_has_suppressed_durable_series_fact(): void
    {
        config()->set('events.notification_delivery.mode', 'outbox_authoritative');
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Description audit boundary',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        DB::table('events')
            ->where(static fn ($series) => $series
                ->where('id', $templateId)
                ->orWhere('parent_event_id', $templateId))
            ->update(['status' => 'active', 'publication_status' => 'published']);

        self::assertTrue(EventService::updateRecurring(
            $templateId,
            (int) $organizer->id,
            ['description' => 'Audited series description change.'],
            'all',
        ), json_encode(EventService::getErrors(), JSON_THROW_ON_ERROR));
        self::assertSame(0, DB::table('events')
            ->where(static fn ($series) => $series
                ->where('id', $templateId)
                ->orWhere('parent_event_id', $templateId))
            ->where('description', '!=', 'Audited series description change.')
            ->count());
        $outbox = DB::table('event_domain_outbox')
            ->where('event_id', $templateId)
            ->where('action', 'event.updated')
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($outbox);
        $payload = json_decode((string) $outbox->payload, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(['description'], $payload['changed_fields']);
        self::assertTrue($payload['metadata']['notifications_suppressed']);
        self::assertSame('non_notifiable_event_update_audit', $payload['metadata']['notification_policy']);
    }

    public function test_all_scope_schedule_fields_require_previewed_revision_workflow(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Schedule revision boundary',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $timezoneBefore = DB::table('events')->where('id', $templateId)->value('timezone');

        $this->apiPut("/v2/events/{$templateId}/recurring", [
            'scope' => 'all',
            'timezone' => 'America/New_York',
        ])->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_SCHEDULE_REVISION_REQUIRED')
            ->assertJsonPath('errors.0.field', 'scope');
        self::assertSame($timezoneBefore, DB::table('events')->where('id', $templateId)->value('timezone'));
    }

    public function test_series_update_uses_one_deduplicated_authoritative_audience_in_every_delivery_mode(): void
    {
        config()->set('events.notification_delivery.consumer_enabled', true);
        config()->set('events.notification_delivery.channels', ['in_app']);

        foreach (['direct', 'shadow_outbox', 'outbox_authoritative'] as $mode) {
            config()->set('events.notification_delivery.mode', $mode);
            $organizer = $this->activeUser();
            $attendee = $this->activeUser();
            Sanctum::actingAs($organizer, ['*']);
            $created = $this->apiPost('/v2/events/recurring', $this->payload([
                'title' => "Series audience {$mode}",
                'recurrence_frequency' => 'weekly',
                'recurrence_ends_type' => 'after_count',
                'recurrence_ends_after_count' => 2,
            ]))->assertCreated();
            $templateId = (int) $created->json('data.template.id');
            $occurrenceIds = DB::table('events')
                ->where('parent_event_id', $templateId)
                ->orderBy('id')
                ->pluck('id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all();
            DB::table('events')
                ->where(static fn ($series) => $series
                    ->where('id', $templateId)
                    ->orWhere('parent_event_id', $templateId))
                ->update(['status' => 'active', 'publication_status' => 'published']);
            foreach ($occurrenceIds as $occurrenceId) {
                DB::table('event_rsvps')->insert([
                    'tenant_id' => $this->testTenantId,
                    'event_id' => $occurrenceId,
                    'user_id' => $attendee->id,
                    'status' => 'going',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            self::assertTrue(EventService::updateRecurring(
                $templateId,
                (int) $organizer->id,
                ['title' => "Updated series audience {$mode}"],
                'all',
            ), json_encode(EventService::getErrors(), JSON_THROW_ON_ERROR));
            $rootOutbox = DB::table('event_domain_outbox')
                ->where('event_id', $templateId)
                ->where('action', 'event.updated')
                ->first();
            self::assertNotNull($rootOutbox);
            self::assertSame('outbox_authoritative', $rootOutbox->production_mode);
            self::assertSame('pending', $rootOutbox->status);
            $rootPayload = json_decode((string) $rootOutbox->payload, true, 512, JSON_THROW_ON_ERROR);
            self::assertSame([(int) $attendee->id], $rootPayload['affected_recipient_user_ids']);
            self::assertSame(1, $rootPayload['metadata']['series']['recipient_count']);
            $presentationEventId = (int) $rootPayload['presentation_event_id'];
            self::assertContains($presentationEventId, $occurrenceIds);
            self::assertSame(
                $presentationEventId,
                (int) $rootPayload['metadata']['series']['recipient_event_ids'][(string) $attendee->id],
            );

            foreach (DB::table('event_domain_outbox')
                ->whereIn('event_id', $occurrenceIds)
                ->where('action', 'event.updated')
                ->pluck('payload') as $payload) {
                $decoded = json_decode((string) $payload, true, 512, JSON_THROW_ON_ERROR);
                self::assertTrue($decoded['metadata']['notifications_suppressed']);
            }

            app(EventNotificationOutboxProcessor::class)->processBatch(20, $this->testTenantId);
            self::assertSame(1, DB::table('notifications')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $attendee->id)
                ->where('type', 'event_update')
                ->where('link', "/events/{$presentationEventId}")
                ->count());
        }
    }

    public function test_series_update_honours_recipient_opt_out_on_their_concrete_occurrence(): void
    {
        config()->set('events.notification_delivery.mode', 'outbox_authoritative');
        config()->set('events.notification_delivery.consumer_enabled', true);
        config()->set('events.notification_delivery.channels', ['in_app']);
        $organizer = $this->activeUser();
        $attendee = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Concrete preference series',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $occurrenceIds = DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('start_time')
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $recipientEventId = $occurrenceIds[1];
        DB::table('events')
            ->where(static fn ($series) => $series
                ->where('id', $templateId)
                ->orWhere('parent_event_id', $templateId))
            ->update(['status' => 'active', 'publication_status' => 'published']);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $recipientEventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_notification_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $attendee->id,
            'event_id' => $recipientEventId,
            'category_id' => null,
            'email_enabled' => null,
            'in_app_enabled' => false,
            'web_push_enabled' => null,
            'fcm_enabled' => null,
            'realtime_enabled' => null,
            'cadence' => null,
            'reminders_enabled' => null,
            'preference_version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        self::assertTrue(EventService::updateRecurring(
            $templateId,
            (int) $organizer->id,
            ['title' => 'Concrete preference series updated'],
            'all',
        ), json_encode(EventService::getErrors(), JSON_THROW_ON_ERROR));
        $rootOutbox = DB::table('event_domain_outbox')
            ->where('event_id', $templateId)
            ->where('action', 'event.updated')
            ->first();
        self::assertNotNull($rootOutbox);
        $payload = json_decode((string) $rootOutbox->payload, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(
            $recipientEventId,
            (int) $payload['metadata']['series']['recipient_event_ids'][(string) $attendee->id],
        );

        app(EventNotificationOutboxProcessor::class)->processBatch(20, $this->testTenantId);
        self::assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $attendee->id)
            ->where('type', 'event_update')
            ->count());
        $this->assertDatabaseHas('event_notification_deliveries', [
            'tenant_id' => $this->testTenantId,
            'outbox_id' => $rootOutbox->id,
            'recipient_user_id' => $attendee->id,
            'channel' => 'in_app',
            'status' => 'suppressed',
            'suppression_reason' => 'channel_disabled_event',
        ]);
    }

    public function test_series_update_excludes_attendee_whose_occurrence_fully_overrides_changed_fields(): void
    {
        config()->set('events.notification_delivery.mode', 'outbox_authoritative');
        config()->set('events.notification_delivery.consumer_enabled', true);
        config()->set('events.notification_delivery.channels', ['in_app']);

        $organizer = $this->activeUser();
        $affectedAttendee = $this->activeUser();
        $exceptionOnlyAttendee = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Selective series audience',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $occurrenceIds = DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $exceptionId = $occurrenceIds[0];
        $affectedId = $occurrenceIds[1];

        self::assertTrue(EventService::updateRecurring(
            $exceptionId,
            (int) $organizer->id,
            ['title' => 'Occurrence-specific title'],
            'single',
        ));
        DB::table('events')
            ->where(static fn ($series) => $series
                ->where('id', $templateId)
                ->orWhere('parent_event_id', $templateId))
            ->update(['status' => 'active', 'publication_status' => 'published']);
        foreach ([
            [$affectedId, (int) $affectedAttendee->id],
            [$exceptionId, (int) $exceptionOnlyAttendee->id],
        ] as [$eventId, $userId]) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'status' => 'going',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        self::assertTrue(EventService::updateRecurring(
            $templateId,
            (int) $organizer->id,
            ['title' => 'New series title'],
            'all',
        ), json_encode(EventService::getErrors(), JSON_THROW_ON_ERROR));
        $rootOutbox = DB::table('event_domain_outbox')
            ->where('event_id', $templateId)
            ->where('action', 'event.updated')
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($rootOutbox);
        $payload = json_decode((string) $rootOutbox->payload, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame([(int) $affectedAttendee->id], $payload['affected_recipient_user_ids']);
        self::assertSame([$templateId, $affectedId], $payload['metadata']['series']['affected_event_ids']);

        app(EventNotificationOutboxProcessor::class)->processBatch(20, $this->testTenantId);
        self::assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $affectedAttendee->id)
            ->where('type', 'event_update')
            ->count());
        self::assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $exceptionOnlyAttendee->id)
            ->where('type', 'event_update')
            ->count());
    }

    public function test_template_is_not_registrable_but_concrete_occurrence_is(): void
    {
        $organizer = $this->activeUser();
        $attendee = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'V2 concrete registration target',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');
        $occurrenceId = (int) DB::table('events')
            ->where('parent_event_id', $templateId)
            ->orderBy('start_time')
            ->value('id');
        DB::table('events')->where('id', $occurrenceId)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);

        Sanctum::actingAs($attendee, ['*']);
        $this->apiPost("/v2/events/{$templateId}/rsvp", ['status' => 'going'])
            ->assertNotFound();
        $this->apiPost("/v2/events/{$occurrenceId}/rsvp", ['status' => 'going'])
            ->assertOk();
        $this->assertDatabaseHas('event_rsvps', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $occurrenceId,
            'user_id' => $attendee->id,
            'status' => 'going',
        ]);
    }

    public function test_unsupported_rule_rolls_back_template_rule_and_occurrences(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $title = 'V2 rollback unsupported rule';

        $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => $title,
            'recurrence_frequency' => 'custom',
            'recurrence_rrule' => 'FREQ=HOURLY;COUNT=10',
        ]))->assertUnprocessable();

        $this->assertSame(0, DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', $title)
            ->count());
        $this->assertSame(0, DB::table('event_recurrence_rules')
            ->where('tenant_id', $this->testTenantId)
            ->where('recurrence_engine', EventRecurrenceService::ENGINE)
            ->whereNotExists(function ($query): void {
                $query->selectRaw('1')
                    ->from('events')
                    ->whereColumn('events.id', 'event_recurrence_rules.event_id');
            })
            ->count());
    }

    /**
     * Turning the rollout flag off must NOT silently resurrect the old engine.
     *
     * This test used to assert the opposite — that a false flag produced a
     * 'legacy' series. The legacy generator has since been REMOVED, so there is
     * nothing to fall back to. The flag now governs only the optional v2 extras
     * (materialization, revisions, blueprints) and what capability the API
     * advertises. Pinning that here stops anyone from assuming the switch is
     * still a way back to the old behaviour.
     */
    public function test_the_rollout_flag_no_longer_gates_creation(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', false);
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);

        $created = $this->apiPost('/v2/events/recurring', $this->payload([
            'title' => 'Series created with the rollout flag off',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();
        $templateId = (int) $created->json('data.template.id');

        $this->assertSame(
            'sabre-vobject',
            DB::table('events')->where('id', $templateId)->value('recurrence_engine'),
            'Creation is v2 regardless of the flag — the legacy engine no longer exists.',
        );
        $this->assertSame('2', DB::table('events')->where('id', $templateId)->value('recurrence_engine_version'));

        // v2 counts the start date as the first occurrence, the way calendar
        // software does; legacy started one interval later. COUNT=2 therefore
        // yields 2 occurrences including the DTSTART instant.
        $this->assertSame(2, DB::table('events')->where('parent_event_id', $templateId)->count());
        $this->assertSame(
            0,
            DB::table('events')->where('parent_event_id', $templateId)->whereNull('recurrence_id')->count(),
            'Every occurrence carries a v2 calendar identity.',
        );
    }

    private function activeUser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @return array<string,mixed> */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'V2 recurrence fixture',
            'description' => 'Enterprise recurrence integration fixture.',
            'start_time' => '2027-06-15 09:00:00',
            'end_time' => '2027-06-15 10:00:00',
            'timezone' => 'Europe/Dublin',
            'all_day' => false,
            'location' => 'Community hall',
            'is_online' => false,
            'allow_remote_attendance' => false,
            'federated_visibility' => 'none',
        ], $overrides);
    }
}
