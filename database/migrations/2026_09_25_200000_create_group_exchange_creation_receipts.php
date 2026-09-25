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
        Schema::create('group_exchange_creation_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->integer('tenant_id');
            $table->integer('actor_user_id');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->integer('group_exchange_id');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'actor_user_id', 'idempotency_key_hash'],
                'group_exchange_creation_key_unique',
            );
            $table->index(
                ['tenant_id', 'group_exchange_id'],
                'group_exchange_creation_result_index',
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_exchange_creation_receipts');
    }
};
