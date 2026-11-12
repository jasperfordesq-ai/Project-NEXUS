<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Community announcement banner (Nov 2026): one-line notices a community admin
 * posts, shown as a coloured banner across the top of that community's member
 * website. The current one is published in the tenant bootstrap as
 * `announcement` (App\Services\SiteAnnouncementService).
 *
 * `tenant_id` and `created_by` are signed int(11) because `tenants.id` and
 * `users.id` are — a foreign key needs the exact same type and signedness.
 *
 * A new table: safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('site_announcements')) {
            return;
        }

        Schema::create('site_announcements', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->integer('tenant_id');
            $table->string('message', 280);
            $table->string('style', 20)->default('info');
            $table->string('link_url', 500)->nullable();
            $table->string('link_label', 60)->nullable();
            $table->dateTime('starts_at')->nullable();
            $table->dateTime('ends_at')->nullable();
            $table->boolean('is_dismissible')->default(true);
            $table->boolean('is_active')->default(true);
            $table->integer('created_by')->nullable();
            $table->timestamps();

            $table->index('tenant_id', 'idx_site_announcements_tenant');
            $table->index(
                ['tenant_id', 'is_active', 'starts_at', 'ends_at'],
                'idx_site_announcements_current'
            );

            $table->foreign('tenant_id', 'fk_site_announcements_tenant')
                ->references('id')->on('tenants')
                ->cascadeOnDelete();
            $table->foreign('created_by', 'fk_site_announcements_created_by')
                ->references('id')->on('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('site_announcements');
    }
};
