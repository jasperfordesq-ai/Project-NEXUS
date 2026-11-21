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
 * A hub's own version of the default plans (21 Nov 2026).
 *
 * One row per hub per default plan, holding only what the hub changed: every
 * value column null means "follow the default", so a hub that changed nothing
 * has no rows and keeps tracking the platform's plans. Putting a plan back to
 * the default deletes its row. The resolver is App\Support\Billing\PlanTerms.
 *
 * A new, empty table. Nothing existing is altered, so the migration is safe to
 * run while the other colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('hub_plan_terms')) {
            return;
        }

        Schema::create('hub_plan_terms', function (Blueprint $table): void {
            $table->bigIncrements('id');
            // Signed int to match tenants.id and pay_plans.id. No foreign keys,
            // as tenant_billing_standing: removing a community or a plan must
            // not be blocked by a hub's settings.
            $table->integer('hub_tenant_id');
            $table->integer('pay_plan_id');
            $table->string('name', 100)->nullable();
            $table->text('description')->nullable();
            $table->unsignedInteger('max_users')->nullable();
            $table->decimal('price_monthly', 10, 2)->nullable();
            $table->decimal('price_yearly', 10, 2)->nullable();
            $table->decimal('setup_fee', 10, 2)->nullable();
            $table->decimal('price_monthly_gbp', 10, 2)->nullable();
            $table->decimal('price_yearly_gbp', 10, 2)->nullable();
            $table->decimal('setup_fee_gbp', 10, 2)->nullable();
            $table->boolean('is_offered')->default(true);
            $table->unsignedInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique(['hub_tenant_id', 'pay_plan_id'], 'uniq_hpt_hub_plan');
            $table->index('pay_plan_id', 'idx_hpt_plan');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hub_plan_terms');
    }
};
