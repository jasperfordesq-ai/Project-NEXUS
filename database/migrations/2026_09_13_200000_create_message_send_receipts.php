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
        Schema::create('message_send_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->integer('sender_id');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->integer('message_id');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'sender_id', 'idempotency_key_hash'],
                'message_send_receipt_key_unique',
            );
            $table->index(
                ['tenant_id', 'message_id'],
                'message_send_receipt_message_index',
            );
            $table->foreign('sender_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('message_id')->references('id')->on('messages')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_send_receipts');
    }
};
