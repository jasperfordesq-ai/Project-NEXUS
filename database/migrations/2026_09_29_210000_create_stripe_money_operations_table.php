<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F-283: a durable record of every Stripe call that moves money, written
 * BEFORE the call, so a retry after Stripe's 24-hour idempotency window finds
 * the earlier attempt instead of sending again. See
 * App\Services\StripeMoneyOperationService.
 *
 * Additive only: a new table, no change to any existing one.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('stripe_money_operations')) {
            return;
        }

        Schema::create('stripe_money_operations', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            // Also the Stripe idempotency key and metadata[nexus_operation_key].
            $table->string('operation_key', 191);
            $table->string('kind', 40);
            $table->string('subject_type', 40);
            $table->unsignedBigInteger('subject_id');
            $table->unsignedBigInteger('amount_minor')->default(0);
            $table->char('currency', 3);
            // pending | succeeded | failed (Stripe definitely did not act) | unknown
            $table->string('status', 16)->default('pending');
            $table->string('stripe_object_id', 255)->nullable();
            $table->unsignedInteger('attempts')->default(1);
            $table->string('last_error', 500)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique('operation_key', 'stripe_money_operations_key_unique');
            $table->index(['tenant_id', 'status'], 'stripe_money_operations_tenant_status');
            $table->index(['subject_type', 'subject_id', 'kind'], 'stripe_money_operations_subject');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stripe_money_operations');
    }
};
