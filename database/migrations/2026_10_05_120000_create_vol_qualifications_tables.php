<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Volunteer qualifications register (owner decision, 5 Oct 2026).
 *
 * A record of the training and qualifications a volunteer holds — no files
 * are uploaded. Organisation owners/admins and community staff confirm a
 * record after seeing the original, checking an online register, or hearing
 * from the issuer. The old `vol_credentials` table and its code are untouched;
 * nothing here reads or writes it.
 *
 * `vol_qualification_events` is append-only history: the application never
 * updates or deletes a row.
 *
 * `user_id` is a signed int to match `users.id` (int(11)), which is what the
 * cascade foreign key needs; the spec's "int unsigned" cannot reference it.
 *
 * Two new tables, so the migration takes no lock on anything live.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('vol_qualifications')) {
            Schema::create('vol_qualifications', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('tenant_id');
                $table->integer('user_id');
                $table->string('qualification_type', 60);
                $table->string('title', 160)->nullable();
                $table->string('issuer', 160)->nullable();
                $table->string('reference_number', 100)->nullable();
                $table->date('obtained_at')->nullable();
                $table->date('expires_at')->nullable();
                $table->enum('status', ['recorded', 'confirmed', 'expired', 'withdrawn'])->default('recorded');
                $table->integer('confirmed_by')->nullable();
                $table->dateTime('confirmed_at')->nullable();
                $table->enum('confirmation_method', ['saw_original', 'online_register', 'issuer_confirmed'])->nullable();
                $table->integer('confirmed_for_organization_id')->nullable();
                $table->integer('withdrawn_by')->nullable();
                $table->dateTime('withdrawn_at')->nullable();
                $table->enum('withdrawal_reason', ['entered_in_error', 'no_longer_held', 'replaced', 'volunteer_request'])->nullable();
                $table->dateTime('expiry_reminder_sent_at')->nullable();
                $table->dateTime('expired_notice_sent_at')->nullable();
                $table->string('notes', 500)->nullable();
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();

                $table->index(['tenant_id', 'user_id'], 'idx_vol_qualifications_tenant_user');
                $table->index(['tenant_id', 'status', 'expires_at'], 'idx_vol_qualifications_tenant_status_expiry');
                $table->index(['tenant_id', 'confirmed_for_organization_id'], 'idx_vol_qualifications_tenant_org');

                $table->foreign('user_id', 'vol_qualifications_user_id_foreign')
                    ->references('id')->on('users')
                    ->cascadeOnDelete()->cascadeOnUpdate();
            });
        }

        if (! Schema::hasTable('vol_qualification_events')) {
            Schema::create('vol_qualification_events', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedInteger('tenant_id');
                $table->unsignedInteger('qualification_id');
                $table->integer('actor_user_id')->nullable();
                $table->enum('event', ['recorded', 'updated', 'confirmed', 'withdrawn', 'expired', 'reminder_sent', 'expired_notice_sent']);
                $table->integer('organization_id')->nullable();
                $table->json('details')->nullable();
                $table->dateTime('created_at')->nullable();

                $table->index(['tenant_id', 'qualification_id'], 'idx_vol_qualification_events_tenant_qual');

                $table->foreign('qualification_id', 'vol_qualification_events_qualification_id_foreign')
                    ->references('id')->on('vol_qualifications')
                    ->cascadeOnDelete()->cascadeOnUpdate();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('vol_qualification_events');
        Schema::dropIfExists('vol_qualifications');
    }
};
