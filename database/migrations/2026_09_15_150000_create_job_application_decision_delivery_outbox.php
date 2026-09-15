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
        Schema::create('job_application_decision_delivery_outbox', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('history_id');
            $table->unsignedInteger('application_id');
            $table->string('from_status', 30)->nullable();
            $table->string('to_status', 30);
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('claim_until')->nullable();
            $table->timestamp('bell_created_at')->nullable();
            $table->timestamp('push_dispatched_at')->nullable();
            $table->timestamp('realtime_dispatched_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('dead_lettered_at')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'history_id'], 'job_application_decision_delivery_history_unique');
            $table->index(
                ['completed_at', 'dead_lettered_at', 'next_attempt_at', 'claim_until'],
                'job_application_decision_delivery_pending_index',
            );
            $table->foreign('history_id')->references('id')->on('job_application_history')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_application_decision_delivery_outbox');
    }
};
