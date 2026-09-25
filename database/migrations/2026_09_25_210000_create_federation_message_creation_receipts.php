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
        Schema::create('federation_message_creation_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->integer('sender_tenant_id');
            $table->integer('sender_user_id');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->integer('outbound_message_id');
            $table->integer('inbound_message_id');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(
                ['sender_tenant_id', 'sender_user_id', 'idempotency_key_hash'],
                'federation_message_creation_key_unique',
            );
            $table->index(
                ['sender_tenant_id', 'outbound_message_id'],
                'federation_message_creation_result_index',
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('federation_message_creation_receipts');
    }
};
