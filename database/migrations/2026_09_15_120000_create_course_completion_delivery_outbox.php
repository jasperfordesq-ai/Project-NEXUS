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
        Schema::table('notifications', function (Blueprint $table): void {
            $table->string('idempotency_key', 191)->nullable()->after('type');
            $table->unique(
                ['tenant_id', 'user_id', 'idempotency_key'],
                'notifications_recipient_idempotency_unique',
            );
        });

        Schema::create('course_completion_delivery_outbox', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('enrollment_id');
            $table->unsignedBigInteger('course_id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('claim_until')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('dead_lettered_at')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'enrollment_id'], 'course_completion_delivery_enrollment_unique');
            $table->index(
                ['completed_at', 'dead_lettered_at', 'next_attempt_at', 'claim_until'],
                'course_completion_delivery_pending_index',
            );
            $table->foreign('enrollment_id')->references('id')->on('course_enrollments')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('course_completion_delivery_outbox');
        Schema::table('notifications', function (Blueprint $table): void {
            $table->dropUnique('notifications_recipient_idempotency_unique');
            $table->dropColumn('idempotency_key');
        });
    }
};
