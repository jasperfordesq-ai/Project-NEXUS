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
 * An index for the Platform team panel's Security page (Nov 2026).
 *
 * That page reads `org_audit_log` by action across EVERY community: who
 * signed in as another member, and senior access given or removed from a
 * community's admin panel (App\Services\PlatformTeam\SecurityOverviewService).
 * All three existing indexes on the table lead with `tenant_id`, which is
 * right for a community's own screens and useless for a query that names no
 * community, so each page load read the whole table.
 *
 * Read-path only: no row is rewritten. Adding a secondary index to an InnoDB
 * table is an online operation (the table stays readable and writable), so
 * this is safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('org_audit_log')
            && ! Schema::hasIndex('org_audit_log', 'idx_org_audit_action_created')) {
            Schema::table('org_audit_log', function (Blueprint $table): void {
                $table->index(['action', 'created_at'], 'idx_org_audit_action_created');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('org_audit_log')
            && Schema::hasIndex('org_audit_log', 'idx_org_audit_action_created')) {
            Schema::table('org_audit_log', function (Blueprint $table): void {
                $table->dropIndex('idx_org_audit_action_created');
            });
        }
    }
};
