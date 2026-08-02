<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Editing ONE occurrence of a legacy recurring series must work.
 *
 * 🔴 Found in production 2026-08-02: it did not. Saving a single occurrence
 * writes per-occurrence "override evidence", but the events trigger only
 * accepts that evidence when the row carries a recurrence_id AND engine
 * 'sabre-vobject' version '2'. Every occurrence the DEFAULT (legacy) engine has
 * ever produced has none of those, so the trigger raised
 * event_recurrence_override_evidence_invalid and the save failed — for every
 * recurring event, on every tenant. All 10 occurrences in production were
 * legacy.
 *
 * The content edit itself was always valid; only the override bookkeeping was
 * impossible. So a legacy occurrence now saves without that bookkeeping, which
 * it has no concept of anyway.
 */
final class EventLegacyOccurrenceEditTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function organiser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
    }

    /**
     * A legacy template plus one occurrence, shaped exactly as the legacy
     * engine leaves them: engine 'legacy', version '1', no recurrence_id.
     *
     * @return array{0:int,1:int}
     */
    private function legacySeries(int $organiserId): array
    {
        $start = CarbonImmutable::now('UTC')->addWeek()->startOfHour();

        $templateId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiserId,
            'title' => 'Legacy Catan series',
            'description' => 'Legacy series template.',
            'location' => 'Union Street Hall',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 1,
            'recurrence_engine' => 'legacy',
            'recurrence_engine_version' => '1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $occurrenceId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiserId,
            'title' => 'Legacy Catan series',
            'description' => 'Legacy occurrence.',
            'location' => 'Union Street Hall',
            'start_time' => $start->addWeek(),
            'end_time' => $start->addWeek()->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 0,
            'parent_event_id' => $templateId,
            // The shape that made this fail: legacy engine, no recurrence_id.
            'recurrence_engine' => 'legacy',
            'recurrence_engine_version' => '1',
            'recurrence_id' => null,
            'occurrence_key' => 'legacy-occurrence:' . bin2hex(random_bytes(10)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$templateId, $occurrenceId];
    }

    public function test_a_single_legacy_occurrence_can_be_edited(): void
    {
        $organiser = $this->organiser();
        [$templateId, $occurrenceId] = $this->legacySeries((int) $organiser->id);

        $updated = EventService::updateRecurring(
            $occurrenceId,
            (int) $organiser->id,
            ['description' => 'Bring your own snacks this week.'],
            'single',
        );

        self::assertTrue(
            $updated,
            'Editing one occurrence of a legacy series must succeed: ' . json_encode(EventService::getErrors()),
        );

        $row = DB::table('events')->where('id', $occurrenceId)->first([
            'description', 'is_recurrence_exception', 'recurrence_override_fields',
        ]);
        self::assertSame('Bring your own snacks this week.', (string) $row->description);

        // No override bookkeeping is written for a legacy row — the trigger
        // forbids it, and the legacy engine has no concept of it.
        self::assertSame(0, (int) $row->is_recurrence_exception);
        self::assertNull($row->recurrence_override_fields);

        // The rest of the series is untouched by a single-scope edit.
        self::assertSame(
            'Legacy series template.',
            (string) DB::table('events')->where('id', $templateId)->value('description'),
        );
    }

    public function test_editing_the_same_occurrence_twice_still_works(): void
    {
        $organiser = $this->organiser();
        [, $occurrenceId] = $this->legacySeries((int) $organiser->id);

        self::assertTrue(EventService::updateRecurring(
            $occurrenceId,
            (int) $organiser->id,
            ['description' => 'First edit.'],
            'single',
        ));
        self::assertTrue(
            EventService::updateRecurring(
                $occurrenceId,
                (int) $organiser->id,
                ['description' => 'Second edit.'],
                'single',
            ),
            'A second edit must not trip over evidence left by the first.',
        );

        self::assertSame(
            'Second edit.',
            (string) DB::table('events')->where('id', $occurrenceId)->value('description'),
        );
    }
}
