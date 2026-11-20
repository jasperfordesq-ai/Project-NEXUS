<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payments recorded by hand (Stage 6, 20 Nov 2026).
 *
 * The owner: "There has to be an alternative manual way, apart from Stripe
 * payments, to enter the payment dates", for example a bank transfer. Each
 * row is one payment the platform team recorded: when it arrived, how, a
 * reference, optionally how much, and the paid-until date before and after.
 * Rows are never updated or deleted by the application: this is the record.
 *
 * A new, empty table. Nothing existing is altered, so the migration is safe to
 * run while the other colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('billing_payments')) {
            return;
        }

        Schema::create('billing_payments', function (Blueprint $table): void {
            $table->bigIncrements('id');
            // Signed int to match tenants.id. No foreign key, as
            // tenant_billing_standing: communities are soft-deleted, never
            // removed, and this table must not be able to block a tenant write.
            $table->integer('tenant_id');
            $table->date('received_on');
            $table->string('method', 30);
            $table->string('reference', 190)->nullable();
            $table->decimal('amount', 12, 2)->nullable();
            $table->char('currency', 3)->nullable();
            $table->date('paid_until_before')->nullable();
            $table->date('paid_until_after');
            $table->unsignedInteger('recorded_by_user_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['tenant_id', 'received_on'], 'idx_bp_tenant_received');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_payments');
    }
};
