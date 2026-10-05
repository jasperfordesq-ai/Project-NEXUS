<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/** The incident timeline is a permanent record: the database itself refuses edits and deletions. */
final class IncidentTimelineStorageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_both_tables_exist_with_the_spec_columns(): void
    {
        foreach (['id', 'tenant_id', 'incident_id', 'event_type', 'actor_user_id', 'actor_role', 'organization_id', 'body', 'data', 'created_at'] as $c) {
            $this->assertTrue(Schema::hasColumn('vol_incident_events', $c), "vol_incident_events.$c");
        }
        foreach (['id', 'tenant_id', 'incident_id', 'organization_id', 'shared_by', 'shared_at', 'withdrawn_at', 'withdrawn_by'] as $c) {
            $this->assertTrue(Schema::hasColumn('vol_incident_shares', $c), "vol_incident_shares.$c");
        }
    }

    public function test_a_timeline_row_cannot_be_changed(): void
    {
        $id = $this->row();
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('vol_incident_events_immutable');
        DB::table('vol_incident_events')->where('id', $id)->update(['body' => 'rewritten']);
    }

    public function test_a_timeline_row_cannot_be_deleted(): void
    {
        $id = $this->row();
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('vol_incident_events_immutable');
        DB::table('vol_incident_events')->where('id', $id)->delete();
    }

    public function test_existing_incident_notes_are_carried_into_the_timeline(): void
    {
        $id = (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $this->testTenantId, 'reported_by' => 1, 'title' => 'INCTL legacy',
            'incident_type' => 'concern', 'category' => 'general', 'severity' => 'low',
            'description' => 'legacy', 'status' => 'open', 'action_taken' => 'Called the volunteer',
            'resolution_notes' => 'Spoke to the organisation', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $migration = require base_path('database/migrations/2026_10_06_120000_create_vol_incident_timeline_and_shares.php');
        (new \ReflectionMethod($migration, 'backfill'))->invoke($migration);

        $rows = DB::table('vol_incident_events')->where('incident_id', $id)->orderBy('id')->get();
        $this->assertSame(['migrated', 'staff_note', 'staff_note'], $rows->pluck('event_type')->all());
        $this->assertSame('Called the volunteer', $rows[1]->body);
        $this->assertSame('Spoke to the organisation', $rows[2]->body);
    }

    private function row(): int
    {
        return (int) DB::table('vol_incident_events')->insertGetId([
            'tenant_id' => $this->testTenantId, 'incident_id' => 1, 'event_type' => 'staff_note',
            'actor_user_id' => null, 'actor_role' => 'system', 'body' => 'original', 'created_at' => now(),
        ]);
    }
}
