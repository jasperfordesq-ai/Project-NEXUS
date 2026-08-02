<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventRecurrenceService;
use App\Services\EventService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Finishing the legacy → v2 recurrence migration.
 *
 * The platform was left half-migrated: v2 was built, never switched on, but the
 * database still enforced v2's rules on legacy's rows — which is what broke
 * editing a single occurrence for everybody. This converts existing series so
 * one engine governs everything.
 *
 * The migration must be boring: identity columns change, participation does
 * not, and it can be run twice.
 */
final class MigrateRecurrenceToV2Test extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['events.recurrence.engine_v2_enabled' => false]);
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
     * A legacy weekly series shaped exactly like production's: engine 'legacy',
     * no recurrence_id, occurrence_key in the old "event:tenant:id" form, and a
     * rule row carrying the pattern.
     *
     * @return array{0:int,1:list<int>}
     */
    private function legacySeries(int $organiserId, int $occurrences = 3): array
    {
        $start = CarbonImmutable::parse('2027-03-05 20:00:00', 'UTC'); // a Friday

        $rootId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiserId,
            'title' => 'Legacy weekly series',
            'description' => 'Series root.',
            'location' => 'Union Street Hall',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'Europe/Dublin',
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

        DB::table('event_recurrence_rules')->insert([
            'event_id' => $rootId,
            'tenant_id' => $this->testTenantId,
            'frequency' => 'weekly',
            'interval_value' => 1,
            'days_of_week' => 'FR',
            'rrule' => 'RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=' . $occurrences,
            'ends_type' => 'after_count',
            'ends_after_count' => $occurrences,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ids = [];
        for ($i = 1; $i <= $occurrences; $i++) {
            $occurrenceStart = $start->addWeeks($i);
            $id = (int) DB::table('events')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'user_id' => $organiserId,
                'title' => 'Legacy weekly series',
                'description' => 'Occurrence ' . $i,
                'location' => 'Union Street Hall',
                'start_time' => $occurrenceStart,
                'end_time' => $occurrenceStart->addHours(2),
                'timezone' => 'Europe/Dublin',
                'timezone_source' => 'test',
                'all_day' => false,
                'status' => 'active',
                'publication_status' => 'published',
                'operational_status' => 'scheduled',
                'is_recurring_template' => 0,
                'parent_event_id' => $rootId,
                'recurrence_engine' => 'legacy',
                'recurrence_engine_version' => '1',
                'recurrence_id' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            // The legacy key form, derived from the row's own id.
            DB::table('events')->where('id', $id)->update([
                'occurrence_key' => 'event:' . $this->testTenantId . ':' . $id,
            ]);
            $ids[] = $id;
        }

        return [$rootId, $ids];
    }

    public function test_dry_run_changes_nothing(): void
    {
        $organiser = $this->organiser();
        [$rootId, $ids] = $this->legacySeries((int) $organiser->id);

        $this->artisan('events:migrate-recurrence-to-v2', ['--dry-run' => true, '--root' => $rootId])
            ->assertExitCode(0);

        self::assertSame('legacy', (string) DB::table('events')->where('id', $rootId)->value('recurrence_engine'));
        foreach ($ids as $id) {
            self::assertNull(DB::table('events')->where('id', $id)->value('recurrence_id'));
        }
        self::assertSame(
            0,
            (int) DB::table('event_recurrence_occurrence_ledger')->where('root_event_id', $rootId)->count(),
        );
    }

    public function test_the_series_is_converted_and_participation_is_untouched(): void
    {
        $organiser = $this->organiser();
        $attendee = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        [$rootId, $ids] = $this->legacySeries((int) $organiser->id);

        // A real registration on the middle occurrence: it must survive intact,
        // still attached to the same event row.
        $registrationId = (int) DB::table('event_registrations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $ids[1],
            'user_id' => (int) $attendee->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $organiser->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->artisan('events:migrate-recurrence-to-v2', ['--root' => $rootId])->assertExitCode(0);

        // Root and rule now name the v2 engine.
        self::assertSame(
            EventRecurrenceService::ENGINE,
            (string) DB::table('events')->where('id', $rootId)->value('recurrence_engine'),
        );
        $rule = DB::table('event_recurrence_rules')->where('event_id', $rootId)->first();
        self::assertSame(EventRecurrenceService::ENGINE, (string) $rule->recurrence_engine);
        self::assertSame('2', (string) $rule->recurrence_engine_version);
        self::assertNotNull($rule->rule_hash, 'A v2 rule must carry its hash.');
        self::assertStringContainsString('FREQ=WEEKLY', (string) $rule->rrule);

        // The root itself must NOT gain a recurrence_id — the trigger forbids it.
        self::assertNull(DB::table('events')->where('id', $rootId)->value('recurrence_id'));

        // Every occurrence gained a v2 identity derived from its own start time.
        foreach ($ids as $id) {
            $row = DB::table('events')->where('id', $id)->first([
                'start_time', 'recurrence_id', 'occurrence_key', 'recurrence_engine',
            ]);
            $expected = CarbonImmutable::parse((string) $row->start_time, 'UTC')->format('Ymd\THis\Z');
            self::assertSame($expected, (string) $row->recurrence_id);
            self::assertSame(EventRecurrenceService::ENGINE, (string) $row->recurrence_engine);
            self::assertStringStartsWith('recurrence:', (string) $row->occurrence_key);
        }

        // Participation is untouched: same row, same state, same person.
        $registration = DB::table('event_registrations')->where('id', $registrationId)->first();
        self::assertSame($ids[1], (int) $registration->event_id);
        self::assertSame('confirmed', (string) $registration->registration_state);
        self::assertSame((int) $attendee->id, (int) $registration->user_id);

        // One ledger row per occurrence keeps the health snapshot clean.
        self::assertSame(
            count($ids),
            (int) DB::table('event_recurrence_occurrence_ledger')->where('root_event_id', $rootId)->count(),
        );
    }

    public function test_running_it_twice_is_safe(): void
    {
        $organiser = $this->organiser();
        [$rootId, $ids] = $this->legacySeries((int) $organiser->id);

        $this->artisan('events:migrate-recurrence-to-v2', ['--root' => $rootId])->assertExitCode(0);
        $firstIds = DB::table('events')->whereIn('id', $ids)->pluck('recurrence_id', 'id');

        // A re-run must not duplicate ledger rows or disturb the identities that
        // are now immutable.
        $this->artisan('events:migrate-recurrence-to-v2', ['--root' => $rootId])->assertExitCode(0);

        self::assertEquals($firstIds, DB::table('events')->whereIn('id', $ids)->pluck('recurrence_id', 'id'));
        self::assertSame(
            count($ids),
            (int) DB::table('event_recurrence_occurrence_ledger')->where('root_event_id', $rootId)->count(),
        );
    }

    public function test_after_conversion_a_single_occurrence_edit_records_override_evidence(): void
    {
        // This is the payoff. On legacy the override bookkeeping was impossible
        // (the trigger refused it), so per-occurrence edits were untracked — and
        // until today they failed outright. On v2 the same edit records properly.
        $organiser = $this->organiser();
        [$rootId, $ids] = $this->legacySeries((int) $organiser->id);
        $this->artisan('events:migrate-recurrence-to-v2', ['--root' => $rootId])->assertExitCode(0);

        $target = $ids[1];
        self::assertTrue(
            EventService::updateRecurring(
                $target,
                (int) $organiser->id,
                ['description' => 'Bring snacks.'],
                'single',
            ),
            'Editing one occurrence must still work after conversion: ' . json_encode(EventService::getErrors()),
        );

        $row = DB::table('events')->where('id', $target)->first([
            'description', 'is_recurrence_exception', 'recurrence_override_fields', 'recurrence_override_version',
        ]);
        self::assertSame('Bring snacks.', (string) $row->description);
        self::assertSame(1, (int) $row->is_recurrence_exception, 'A v2 occurrence records that it diverged.');
        self::assertContains('description', json_decode((string) $row->recurrence_override_fields, true));
        self::assertGreaterThanOrEqual(1, (int) $row->recurrence_override_version);
    }
}
