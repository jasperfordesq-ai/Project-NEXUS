<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('user_totp_settings', function (Blueprint $table): void {
            if (!Schema::hasColumn('user_totp_settings', 'last_used_step')) {
                $table->unsignedBigInteger('last_used_step')->nullable();
            }
            if (!Schema::hasColumn('user_totp_settings', 'setup_revocation_version')) {
                $table->unsignedBigInteger('setup_revocation_version')->default(0);
            }
        });
    }

    public function down(): void
    {
        Schema::table('user_totp_settings', function (Blueprint $table): void {
            foreach (['last_used_step', 'setup_revocation_version'] as $column) {
                if (Schema::hasColumn('user_totp_settings', $column)) $table->dropColumn($column);
            }
        });
    }
};
