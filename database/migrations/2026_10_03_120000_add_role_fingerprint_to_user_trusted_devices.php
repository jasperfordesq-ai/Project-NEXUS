<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A remembered device records the account's authority at the moment it was
 * remembered. When the role or an admin flag changes, the fingerprint no longer
 * matches and the device stops skipping the second factor (security register
 * E-085). Nullable and appended (metadata-only); a NULL row predates this column
 * and is honoured only for accounts that hold no staff authority.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('user_trusted_devices')) {
            return;
        }

        Schema::table('user_trusted_devices', function (Blueprint $table) {
            if (!Schema::hasColumn('user_trusted_devices', 'role_fingerprint')) {
                $table->string('role_fingerprint', 64)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('user_trusted_devices')) {
            return;
        }

        Schema::table('user_trusted_devices', function (Blueprint $table) {
            if (Schema::hasColumn('user_trusted_devices', 'role_fingerprint')) {
                $table->dropColumn('role_fingerprint');
            }
        });
    }
};
