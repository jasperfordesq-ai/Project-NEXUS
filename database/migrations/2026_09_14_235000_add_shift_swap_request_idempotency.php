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
        Schema::table('vol_shift_swap_requests', function (Blueprint $table): void {
            $table->char('idempotency_key_hash', 64)->nullable()->after('message');
            $table->char('request_hash', 64)->nullable()->after('idempotency_key_hash');
            $table->unique(
                ['tenant_id', 'from_user_id', 'idempotency_key_hash'],
                'vol_shift_swap_request_key_unique',
            );
        });
    }

    public function down(): void
    {
        Schema::table('vol_shift_swap_requests', function (Blueprint $table): void {
            $table->dropUnique('vol_shift_swap_request_key_unique');
            $table->dropColumn(['idempotency_key_hash', 'request_hash']);
        });
    }
};
