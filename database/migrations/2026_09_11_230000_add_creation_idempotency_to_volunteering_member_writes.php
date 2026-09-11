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
    /** @var array<string, string> */
    private array $indexes = [
        'vol_certificates' => 'uq_vol_cert_creation_idempotency',
        'vol_expenses' => 'uq_vol_exp_creation_idempotency',
        'vol_donations' => 'uq_vol_donation_creation_idempotency',
        'vol_logs' => 'uq_vol_log_creation_idempotency',
    ];

    public function up(): void
    {
        foreach ($this->indexes as $tableName => $indexName) {
            Schema::table($tableName, function (Blueprint $table) use ($indexName): void {
                $table->char('creation_idempotency_key_hash', 64)->nullable();
                $table->char('creation_request_hash', 64)->nullable();
                $table->unique(
                    ['tenant_id', 'user_id', 'creation_idempotency_key_hash'],
                    $indexName
                );
            });
        }
    }

    public function down(): void
    {
        foreach (array_reverse($this->indexes, true) as $tableName => $indexName) {
            Schema::table($tableName, function (Blueprint $table) use ($indexName): void {
                $table->dropUnique($indexName);
                $table->dropColumn(['creation_idempotency_key_hash', 'creation_request_hash']);
            });
        }
    }
};
