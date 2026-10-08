<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Owner decision, 8 Oct 2026: an account invitation (the "set your password"
 * link an administrator-created member is emailed) lasts 7 days, while a
 * forgot-password link keeps its 1 hour. Both live in `password_resets`, so a
 * row now carries its own expiry. NULL means "a reset link: created_at + 1
 * hour", so every existing row and every reset path is unchanged.
 * See App\Services\Auth\PasswordResetTokens. Nullable and appended
 * (metadata-only).
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('password_resets')) {
            return;
        }

        Schema::table('password_resets', function (Blueprint $table) {
            if (!Schema::hasColumn('password_resets', 'expires_at')) {
                $table->dateTime('expires_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('password_resets')) {
            return;
        }

        Schema::table('password_resets', function (Blueprint $table) {
            if (Schema::hasColumn('password_resets', 'expires_at')) {
                $table->dropColumn('expires_at');
            }
        });
    }
};
