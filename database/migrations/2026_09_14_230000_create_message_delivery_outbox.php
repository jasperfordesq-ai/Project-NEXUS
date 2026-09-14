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
        Schema::create('message_delivery_outbox', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->integer('message_id');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('claim_until')->nullable();
            $table->timestamp('dispatched_at')->nullable();
            $table->timestamp('dead_lettered_at')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'message_id'], 'message_delivery_outbox_message_unique');
            $table->index(
                ['dispatched_at', 'dead_lettered_at', 'next_attempt_at', 'claim_until'],
                'message_delivery_outbox_pending_index',
            );
            $table->foreign('message_id')->references('id')->on('messages')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_delivery_outbox');
    }
};
