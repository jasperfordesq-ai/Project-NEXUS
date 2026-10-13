<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-104 (13 Oct 2026): a recurring series' template row carries the first
 * date too, so the "upcoming dates in this series" list showed that date
 * twice. The template is dropped when a generated occurrence has its start.
 */
final class EventSeriesOccurrencesExcludeTemplateTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{template:int, first:int, second:int} */
    private function createSeries(int $organizerId): array
    {
        $start = now()->addDays(7)->setTime(14, 0, 0);
        $base = [
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'E-104 series',
            'description' => 'Series fixture',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'timezone' => 'UTC',
            'created_at' => now(),
            'updated_at' => now(),
        ];
        $template = DB::table('events')->insertGetId($base + [
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'is_recurring_template' => 1,
            'recurrence_engine' => 'sabre-vobject',
            'recurrence_engine_version' => '2',
        ]);
        $first = DB::table('events')->insertGetId($base + [
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'parent_event_id' => $template,
            'recurrence_id' => $start->copy()->utc()->format('Ymd\THis\Z'),
            'recurrence_engine' => 'sabre-vobject',
            'recurrence_engine_version' => '2',
        ]);
        $second = DB::table('events')->insertGetId($base + [
            'start_time' => $start->copy()->addWeek(),
            'end_time' => $start->copy()->addWeek()->addHours(2),
            'parent_event_id' => $template,
            'recurrence_id' => $start->copy()->addWeek()->utc()->format('Ymd\THis\Z'),
            'recurrence_engine' => 'sabre-vobject',
            'recurrence_engine_version' => '2',
        ]);

        return ['template' => $template, 'first' => $first, 'second' => $second];
    }

    public function test_series_dates_list_the_concrete_occurrences_once_each(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);
        $ids = $this->createSeries($member->id);

        foreach ([$ids['template'], $ids['first']] as $viewed) {
            $response = $this->apiGet('/v2/events/' . $viewed, ['X-Events-Contract' => '2'])->assertOk();
            $occurrences = $response->json('data.series.recurrence.occurrences');
            $this->assertIsArray($occurrences);
            $listed = array_map(static fn (array $occ): int => (int) $occ['id'], $occurrences);
            $this->assertNotContains($ids['template'], $listed, 'the template row must not be listed as a date');
            $this->assertSame([$ids['first'], $ids['second']], $listed);
            $dates = array_map(static fn (array $occ): string => (string) $occ['start_at'], $occurrences);
            $this->assertSame($dates, array_values(array_unique($dates)), 'no date may appear twice');
        }
    }

    public function test_series_with_no_generated_dates_still_lists_its_template_date(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);
        $ids = $this->createSeries($member->id);
        DB::table('events')->whereIn('id', [$ids['first'], $ids['second']])->delete();

        $occurrences = $this->apiGet('/v2/events/' . $ids['template'], ['X-Events-Contract' => '2'])->assertOk()
            ->json('data.series.recurrence.occurrences');
        $this->assertSame([$ids['template']], array_map(static fn (array $occ): int => (int) $occ['id'], $occurrences));
    }
}
