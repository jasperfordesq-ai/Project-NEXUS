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
        Schema::create('group_join_request_decision_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('manager_user_id');
            $table->unsignedInteger('group_id');
            $table->unsignedInteger('requester_user_id');
            $table->string('action', 16);
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->json('result_payload');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'manager_user_id', 'idempotency_key_hash'],
                'group_join_decision_receipt_key_unique',
            );
            $table->index(
                ['tenant_id', 'group_id', 'requester_user_id'],
                'group_join_decision_request_index',
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_join_request_decision_receipts');
    }
};
