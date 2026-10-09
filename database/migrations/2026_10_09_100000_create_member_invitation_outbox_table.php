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
 * Durable queue of welcome invitations for the admin member import and the
 * "invite selected members" bulk action. A scheduled command sends them at a
 * steady pace, so a 5,000-member import does not become 5,000 emails in one
 * minute and a restart loses nothing.
 *
 * tenant_id / user_id are SIGNED int(11), matching tenants.id and users.id
 * exactly (a foreign key needs identical types). Deleting a member deletes
 * their queued invitation. One row per (tenant, member, request), so a retried
 * request cannot queue the same invitation twice.
 *
 * Pure CREATE TABLE: no lock on any live table.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('member_invitation_outbox')) {
            return;
        }

        Schema::create('member_invitation_outbox', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->integer('tenant_id');
            $table->integer('user_id');
            $table->char('request_key', 36);            // import id or bulk request uuid
            $table->string('source', 20);               // import | admin_bulk
            $table->integer('requested_by')->nullable(); // the admin who asked
            $table->string('status', 20)->default('pending'); // pending|processing|sent|skipped|failed
            $table->string('skip_reason', 40)->nullable();    // signed_in|not_active|suppressed|not_found|recently_invited|not_member
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->dateTime('available_at');           // not before this time (backoff)
            $table->char('claim_token', 36)->nullable();
            $table->dateTime('claimed_at')->nullable();
            $table->string('last_error', 500)->nullable();
            $table->dateTime('sent_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'user_id', 'request_key'], 'uq_invitation_request');
            $table->index(['status', 'available_at', 'id'], 'idx_invitation_due');
            $table->index(['tenant_id', 'user_id', 'status'], 'idx_invitation_user');

            $table->foreign('tenant_id', 'fk_invitation_outbox_tenant')
                ->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('user_id', 'fk_invitation_outbox_user')
                ->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('member_invitation_outbox');
    }
};
