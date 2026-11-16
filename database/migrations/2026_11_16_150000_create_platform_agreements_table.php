<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Agreements and renewals (Nov 2026): the agreements the platform has with
 * communities and others, kept by the platform team
 * (App\Services\PlatformTeam\PlatformAgreementService).
 *
 * 🔴 PLATFORM-GLOBAL: no `tenant_id`, on purpose. Only the platform team reads
 * or writes these rows. `community_id` is a pointer only: nullable and with
 * NO foreign key, so removing a community never fails and never deletes or
 * changes an agreement (the page says "Community no longer exists").
 *
 * `contact_name` and `contact_email` are a person outside the platform,
 * stored exactly as the platform team typed them.
 *
 * `created_by` / `updated_by` are signed int(11) because `users.id` is.
 *
 * One new table: safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('platform_agreements')) {
            return;
        }

        Schema::create('platform_agreements', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->integer('community_id')->nullable();
            $table->string('title', 160);
            $table->string('with_whom', 160);
            $table->date('starts_on')->nullable();
            $table->date('renews_on')->nullable();
            $table->date('ends_on')->nullable();
            $table->string('contact_name', 160)->nullable();
            $table->string('contact_email', 255)->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_ended')->default(false);
            $table->integer('created_by')->nullable();
            $table->integer('updated_by')->nullable();
            $table->timestamps();

            $table->index(['is_ended', 'renews_on'], 'idx_platform_agreements_renewal');

            $table->foreign('created_by', 'fk_platform_agreements_created_by')
                ->references('id')->on('users')->nullOnDelete();
            $table->foreign('updated_by', 'fk_platform_agreements_updated_by')
                ->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_agreements');
    }
};
