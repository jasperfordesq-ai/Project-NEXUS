<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A fundraising campaign (vol_giving_days) can raise money for one volunteering
 * organisation, and every donation records the organisation it benefits so the
 * attribution survives on the donation itself (and in the Stripe PaymentIntent
 * metadata) even if the campaign is later edited.
 *
 * Both columns are nullable and appended: a metadata-only change on MariaDB
 * 10.11, so it cannot lock the colour still serving. NULL means "the whole
 * community", which is what every existing campaign and donation was.
 * Signed int to match vol_organizations.id. No foreign key, matching the
 * other vol_donations reference columns.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('vol_giving_days') && !Schema::hasColumn('vol_giving_days', 'organization_id')) {
            Schema::table('vol_giving_days', function (Blueprint $table) {
                $table->integer('organization_id')->nullable();
                $table->index(['tenant_id', 'organization_id'], 'idx_vol_giving_days_org');
            });
        }

        if (Schema::hasTable('vol_donations') && !Schema::hasColumn('vol_donations', 'organization_id')) {
            Schema::table('vol_donations', function (Blueprint $table) {
                $table->integer('organization_id')->nullable();
                $table->index(['tenant_id', 'organization_id'], 'idx_vol_donations_org');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('vol_donations') && Schema::hasColumn('vol_donations', 'organization_id')) {
            Schema::table('vol_donations', function (Blueprint $table) {
                $table->dropIndex('idx_vol_donations_org');
                $table->dropColumn('organization_id');
            });
        }

        if (Schema::hasTable('vol_giving_days') && Schema::hasColumn('vol_giving_days', 'organization_id')) {
            Schema::table('vol_giving_days', function (Blueprint $table) {
                $table->dropIndex('idx_vol_giving_days_org');
                $table->dropColumn('organization_id');
            });
        }
    }
};
