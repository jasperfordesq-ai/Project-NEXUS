<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Volunteering safeguarding incidents become a case record: an append-only timeline
 * (the database refuses UPDATE and DELETE, as event_status_history does) and a record
 * of when the full report was shared with an organisation's safeguarding lead.
 *
 * New tables only — no ALTER of a live table, so the blue/green migration safety gate
 * passes without an override. Existing incidents get a 'migrated' row, and any text
 * already in action_taken / resolution_notes is carried in as a staff note.
 */
return new class extends Migration
{
    private const UPDATE_TRIGGER = 'vol_incident_events_no_update';
    private const DELETE_TRIGGER = 'vol_incident_events_no_delete';

    public function up(): void
    {
        if (!Schema::hasTable('vol_incident_events')) {
            Schema::create('vol_incident_events', function (Blueprint $t) {
                $t->bigIncrements('id');
                $t->unsignedInteger('tenant_id');
                $t->unsignedInteger('incident_id');
                $t->string('event_type', 40);
                $t->unsignedInteger('actor_user_id')->nullable();
                $t->string('actor_role', 20);
                $t->unsignedInteger('organization_id')->nullable();
                $t->text('body')->nullable();
                $t->json('data')->nullable();
                $t->dateTime('created_at');
                $t->index(['tenant_id', 'incident_id', 'id'], 'idx_vie_incident');
                $t->index(['tenant_id', 'organization_id'], 'idx_vie_org');
            });
        }
        if (!Schema::hasTable('vol_incident_shares')) {
            Schema::create('vol_incident_shares', function (Blueprint $t) {
                $t->increments('id');
                $t->unsignedInteger('tenant_id');
                $t->unsignedInteger('incident_id');
                $t->unsignedInteger('organization_id');
                $t->unsignedInteger('shared_by');
                $t->dateTime('shared_at');
                $t->dateTime('withdrawn_at')->nullable();
                $t->unsignedInteger('withdrawn_by')->nullable();
                $t->index(['tenant_id', 'incident_id'], 'idx_vis_incident');
            });
        }
        $this->installTriggers();
        $this->backfill();
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::UPDATE_TRIGGER . '`');
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::DELETE_TRIGGER . '`');
        }
        Schema::dropIfExists('vol_incident_shares');
        Schema::dropIfExists('vol_incident_events');
    }

    private function installTriggers(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }
        foreach ([self::UPDATE_TRIGGER => 'UPDATE', self::DELETE_TRIGGER => 'DELETE'] as $name => $op) {
            $exists = DB::table('information_schema.TRIGGERS')
                ->where('TRIGGER_SCHEMA', DB::getDatabaseName())
                ->where('TRIGGER_NAME', $name)
                ->exists();
            if (!$exists) {
                DB::unprepared(
                    'CREATE TRIGGER `' . $name . '` BEFORE ' . $op . ' ON `vol_incident_events` FOR EACH ROW '
                    . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vol_incident_events_immutable'"
                );
            }
        }
    }

    /** One 'migrated' row per existing incident, plus its old free-text notes as staff notes. Idempotent. */
    private function backfill(): void
    {
        DB::table('vol_safeguarding_incidents')
            ->orderBy('id')
            ->chunkById(500, function ($incidents) {
                foreach ($incidents as $i) {
                    $already = DB::table('vol_incident_events')
                        ->where('tenant_id', $i->tenant_id)
                        ->where('incident_id', $i->id)
                        ->exists();
                    if ($already) {
                        continue;
                    }
                    $at = $i->created_at ?? now();
                    $rows = [[
                        'tenant_id' => $i->tenant_id, 'incident_id' => $i->id, 'event_type' => 'migrated',
                        'actor_user_id' => null, 'actor_role' => 'system', 'organization_id' => null,
                        'body' => null, 'data' => json_encode(['note' => 'created before the timeline existed']),
                        'created_at' => $at,
                    ]];
                    foreach (['action_taken', 'resolution_notes'] as $col) {
                        $text = trim((string) ($i->{$col} ?? ''));
                        if ($text !== '') {
                            $rows[] = [
                                'tenant_id' => $i->tenant_id, 'incident_id' => $i->id, 'event_type' => 'staff_note',
                                'actor_user_id' => null, 'actor_role' => 'system', 'organization_id' => null,
                                'body' => $text, 'data' => json_encode(['migrated_from' => $col]),
                                'created_at' => $i->updated_at ?? $at,
                            ];
                        }
                    }
                    DB::table('vol_incident_events')->insert($rows);
                }
            });
    }
};
