<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes for three hot paths a performance audit found scanning more than
 * they should. All three are read-path only — no data is rewritten.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. The monthly treasury cap SUM runs on EVERY mint and filters
        //    (tenant_id, claim_type, status, completed_at). The existing
        //    idx_event_credit_claim_status is (tenant_id, status, created_at,
        //    id) — note created_at, a DIFFERENT column from the one filtered —
        //    so the sum scanned every completed claim in the tenant's whole
        //    history on each check-in.
        if (Schema::hasTable('event_attendance_credit_claims')
            && ! Schema::hasIndex('event_attendance_credit_claims', 'idx_event_credit_claim_cap_window')) {
            Schema::table('event_attendance_credit_claims', function (Blueprint $table): void {
                $table->index(
                    ['tenant_id', 'claim_type', 'status', 'completed_at'],
                    'idx_event_credit_claim_cap_window',
                );
            });
        }

        // 2. The admin claims ledger's default view has no status filter, so
        //    ordering by created_at could not use the status-prefixed index
        //    and fell back to a filesort over the tenant's whole ledger.
        if (Schema::hasTable('event_attendance_credit_claims')
            && ! Schema::hasIndex('event_attendance_credit_claims', 'idx_event_credit_claim_recent')) {
            Schema::table('event_attendance_credit_claims', function (Blueprint $table): void {
                $table->index(['tenant_id', 'created_at', 'id'], 'idx_event_credit_claim_recent');
            });
        }

        // 3. memberVisitCountThisMonth() filters visited_on, but both visit
        //    indexes are built on visited_at (a different column), so the
        //    count walked the member's entire visit history on every scan.
        if (Schema::hasTable('partner_venue_visits')
            && ! Schema::hasIndex('partner_venue_visits', 'idx_partner_visits_user_visited_on')) {
            Schema::table('partner_venue_visits', function (Blueprint $table): void {
                $table->index(['tenant_id', 'user_id', 'visited_on'], 'idx_partner_visits_user_visited_on');
            });
        }

        // 4. The anonymous/crawler-facing public listing filters
        //    (tenant_id, publication_status) and orders by (start_time, id).
        //    The existing idx_events_tenant_lifecycle_start puts
        //    operational_status between them, and nothing filters that column,
        //    so it could not serve this ordering. This index matches the
        //    public query's shape exactly.
        if (Schema::hasTable('events')
            && ! Schema::hasIndex('events', 'idx_events_tenant_pub_start')) {
            Schema::table('events', function (Blueprint $table): void {
                $table->index(['tenant_id', 'publication_status', 'start_time', 'id'], 'idx_events_tenant_pub_start');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('event_attendance_credit_claims')) {
            Schema::table('event_attendance_credit_claims', function (Blueprint $table): void {
                foreach (['idx_event_credit_claim_cap_window', 'idx_event_credit_claim_recent'] as $index) {
                    if (Schema::hasIndex('event_attendance_credit_claims', $index)) {
                        $table->dropIndex($index);
                    }
                }
            });
        }

        if (Schema::hasTable('partner_venue_visits')
            && Schema::hasIndex('partner_venue_visits', 'idx_partner_visits_user_visited_on')) {
            Schema::table('partner_venue_visits', function (Blueprint $table): void {
                $table->dropIndex('idx_partner_visits_user_visited_on');
            });
        }

        if (Schema::hasTable('events') && Schema::hasIndex('events', 'idx_events_tenant_pub_start')) {
            Schema::table('events', function (Blueprint $table): void {
                $table->dropIndex('idx_events_tenant_pub_start');
            });
        }
    }
};
