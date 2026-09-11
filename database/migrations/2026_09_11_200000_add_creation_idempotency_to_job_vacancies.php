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
        Schema::table('job_vacancies', function (Blueprint $table): void {
            $table->char('creation_idempotency_key_hash', 64)->nullable()->after('user_id');
            $table->char('creation_request_hash', 64)->nullable()->after('creation_idempotency_key_hash');
            $table->unique(
                ['tenant_id', 'user_id', 'creation_idempotency_key_hash'],
                'job_vacancy_creation_idempotency_unique'
            );
        });
    }

    public function down(): void
    {
        Schema::table('job_vacancies', function (Blueprint $table): void {
            $table->dropUnique('job_vacancy_creation_idempotency_unique');
            $table->dropColumn(['creation_idempotency_key_hash', 'creation_request_hash']);
        });
    }
};
