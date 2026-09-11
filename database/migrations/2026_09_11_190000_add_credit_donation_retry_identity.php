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
        Schema::table('credit_donations', function (Blueprint $table): void {
            $table->char('idempotency_fingerprint', 40)->nullable();
            $table->unique(['tenant_id', 'donor_id', 'idempotency_fingerprint'], 'credit_donation_retry_unique');
        });
    }

    public function down(): void
    {
        Schema::table('credit_donations', function (Blueprint $table): void {
            $table->dropUnique('credit_donation_retry_unique');
            $table->dropColumn('idempotency_fingerprint');
        });
    }
};
