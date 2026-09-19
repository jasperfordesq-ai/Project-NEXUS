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
        Schema::table('course_quiz_attempts', function (Blueprint $table) {
            $table->string('idempotency_key_hash', 64)->nullable();
            $table->string('request_hash', 64)->nullable();
            $table->unique(['tenant_id', 'user_id', 'quiz_id', 'idempotency_key_hash'], 'crs_attempt_replay_unique');
        });
    }

    public function down(): void
    {
        Schema::table('course_quiz_attempts', function (Blueprint $table) {
            $table->dropUnique('crs_attempt_replay_unique');
            $table->dropColumn(['idempotency_key_hash', 'request_hash']);
        });
    }
};
