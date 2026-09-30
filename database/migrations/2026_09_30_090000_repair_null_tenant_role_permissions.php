<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * F-350 (E-065): repair role_permissions rows left with a NULL tenant_id.
 *
 * `AdminEnterpriseController::createRole()` inserted role_permissions without a
 * tenant_id, so every permission attached while CREATING a role through the
 * admin panel landed with tenant_id NULL. `updateRole()` deletes
 * `WHERE role_id = ? AND tenant_id = ?`, which cannot match a NULL row, so the
 * permission could not be taken back — the editor reported success and the
 * grant stayed live.
 *
 * The code fix writes the tenant_id and also clears NULL rows on save. This
 * migration normalises the rows already in service so a community's permission
 * list is consistent without waiting for someone to re-save each role.
 *
 * Only rows whose ROLE belongs to a community are touched. A role with
 * tenant_id NULL is platform-global (municipality_announcer, verein_admin,
 * kiss_national_admin) and its permission rows are seeded NULL on purpose by
 * the migrations that create them — those are left exactly as they are.
 *
 * Data-only UPDATE against a small table (hundreds of rows at most); no schema
 * change, so no table rebuild and no lock concern for the other colour.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('role_permissions')
            || ! Schema::hasTable('roles')
            || ! Schema::hasColumn('role_permissions', 'tenant_id')
            || ! Schema::hasColumn('roles', 'tenant_id')) {
            return;
        }

        DB::statement(
            'UPDATE role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             SET rp.tenant_id = r.tenant_id
             WHERE rp.tenant_id IS NULL
               AND r.tenant_id IS NOT NULL'
        );
    }

    public function down(): void
    {
        // Deliberately not reversible: the original rows carried no information
        // about which community they belonged to, so setting them back to NULL
        // would reintroduce the defect without restoring anything.
    }
};
