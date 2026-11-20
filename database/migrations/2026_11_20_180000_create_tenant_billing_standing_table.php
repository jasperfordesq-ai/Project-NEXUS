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
 * Payment standing of each community (20 Nov 2026).
 *
 * Until now nothing recorded whether a community was paid up, and the only
 * off-switch was `tenants.is_active = 0`, which locks the community's own
 * admins out as well and is refused while it has active children. This table
 * is the record a separate "paused for non-payment" state reads: who the
 * community pays, the date it is paid up to, whether it is suspended (and by
 * whom), and whether the platform team has exempted it.
 *
 * A new, empty table. Nothing existing is altered, so the migration is safe to
 * run while the other colour is serving. A community with no row is open and
 * is never acted on automatically.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tenant_billing_standing')) {
            return;
        }

        Schema::create('tenant_billing_standing', function (Blueprint $table): void {
            // Signed int to match tenants.id. No foreign key: communities are
            // soft-deleted, never removed, and this table must not be able to
            // block a tenant write.
            $table->integer('tenant_id')->primary();
            // NULL = decided by the community's position in the tree.
            $table->enum('payer', ['platform_card', 'platform_invoice', 'parent', 'not_billed'])->nullable();
            // Paid up to and including this date. NULL = no date is tracked.
            $table->date('paid_until')->nullable();
            $table->timestamp('suspended_at')->nullable();
            // NULL while suspended = the system did it.
            $table->unsignedInteger('suspended_by_user_id')->nullable();
            $table->enum('suspension_source', ['auto', 'manual'])->nullable();
            $table->string('suspension_note', 500)->nullable();
            $table->boolean('exempt')->default(false);
            $table->string('exempt_reason', 500)->nullable();
            $table->unsignedInteger('exempt_by_user_id')->nullable();
            $table->timestamp('exempt_at')->nullable();
            $table->string('last_notice_stage', 30)->nullable();
            $table->timestamp('last_notice_at')->nullable();
            $table->timestamps();
            $table->index('suspended_at', 'idx_tbs_suspended_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_billing_standing');
    }
};
