<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gap D8 (7 Oct 2026): community admins can revoke a volunteer certificate issued
 * in error. A certificate is shown to employers, and until now nothing could
 * withdraw one. A revoked certificate no longer passes the public check and its
 * printable copy is no longer served. Nullable and appended (metadata-only).
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('vol_certificates')) {
            return;
        }

        Schema::table('vol_certificates', function (Blueprint $table) {
            if (!Schema::hasColumn('vol_certificates', 'revoked_at')) {
                $table->dateTime('revoked_at')->nullable();
            }
            if (!Schema::hasColumn('vol_certificates', 'revoked_by')) {
                $table->unsignedInteger('revoked_by')->nullable();
            }
            if (!Schema::hasColumn('vol_certificates', 'revoke_reason')) {
                $table->string('revoke_reason', 500)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('vol_certificates')) {
            return;
        }

        Schema::table('vol_certificates', function (Blueprint $table) {
            foreach (['revoke_reason', 'revoked_by', 'revoked_at'] as $column) {
                if (Schema::hasColumn('vol_certificates', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
