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
 * Volunteers an organisation has retired from its roster. The volunteer's
 * applications, hours and history are untouched; this row only moves them
 * from the organisation's active roster to its retired list. Reinstating them
 * deletes the row.
 *
 * tenant_id / organization_id / user_id / retired_by are SIGNED int(11),
 * matching tenants.id, vol_organizations.id and users.id. Deleting the
 * member or the organisation deletes the row.
 *
 * Pure CREATE TABLE: no lock on any live table.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('vol_org_retired_volunteers')) {
            return;
        }

        Schema::create('vol_org_retired_volunteers', function (Blueprint $table): void {
            $table->increments('id');
            $table->integer('tenant_id');
            $table->integer('organization_id');
            $table->integer('user_id');
            $table->integer('retired_by')->nullable();
            $table->dateTime('retired_at');

            $table->unique(['tenant_id', 'organization_id', 'user_id'], 'uq_vol_org_retired');
            $table->index(['user_id'], 'idx_vol_org_retired_user');

            $table->foreign('tenant_id', 'fk_vol_org_retired_tenant')
                ->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('organization_id', 'fk_vol_org_retired_org')
                ->references('id')->on('vol_organizations')->cascadeOnDelete();
            $table->foreign('user_id', 'fk_vol_org_retired_user')
                ->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('retired_by', 'fk_vol_org_retired_by')
                ->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vol_org_retired_volunteers');
    }
};
