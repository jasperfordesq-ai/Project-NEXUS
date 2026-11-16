<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform-wide notices (Nov 2026): a short notice the platform team writes
 * once and every community's admins see as a band at the top of the admin
 * panel (App\Services\PlatformTeam\PlatformNoticeService). Members never see
 * one.
 *
 * 🔴 PLATFORM-GLOBAL: neither table has a `tenant_id`, on purpose. A notice is
 * for every community at once, and "closed it" belongs to a person, not to a
 * community. Do not add tenant scoping to queries on these tables; the access
 * rule is "the platform team writes, admins read", enforced in the
 * controllers.
 *
 * `created_by`, `updated_by`, `ended_by` and `user_id` are signed int(11)
 * because `users.id` is — a foreign key needs the exact same type and
 * signedness.
 *
 * Two new tables: safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('platform_notices')) {
            Schema::create('platform_notices', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('message', 280);
                $table->string('kind', 20)->default('info');
                $table->string('link_url', 500)->nullable();
                $table->string('link_label', 60)->nullable();
                $table->dateTime('starts_at')->nullable();
                $table->dateTime('ends_at')->nullable();
                $table->boolean('is_dismissible')->default(true);
                $table->boolean('is_active')->default(true);
                $table->integer('created_by')->nullable();
                $table->integer('updated_by')->nullable();
                $table->integer('ended_by')->nullable();
                $table->dateTime('ended_at')->nullable();
                $table->timestamps();

                $table->index(['is_active', 'starts_at', 'ends_at'], 'idx_platform_notices_current');

                $table->foreign('created_by', 'fk_platform_notices_created_by')
                    ->references('id')->on('users')->nullOnDelete();
                $table->foreign('updated_by', 'fk_platform_notices_updated_by')
                    ->references('id')->on('users')->nullOnDelete();
                $table->foreign('ended_by', 'fk_platform_notices_ended_by')
                    ->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('platform_notice_dismissals')) {
            Schema::create('platform_notice_dismissals', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('notice_id');
                $table->integer('user_id');
                $table->dateTime('dismissed_at');

                $table->unique(['notice_id', 'user_id'], 'uq_platform_notice_dismissals');
                $table->index('user_id', 'idx_platform_notice_dismissals_user');

                $table->foreign('notice_id', 'fk_platform_notice_dismissals_notice')
                    ->references('id')->on('platform_notices')->cascadeOnDelete();
                $table->foreign('user_id', 'fk_platform_notice_dismissals_user')
                    ->references('id')->on('users')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_notice_dismissals');
        Schema::dropIfExists('platform_notices');
    }
};
