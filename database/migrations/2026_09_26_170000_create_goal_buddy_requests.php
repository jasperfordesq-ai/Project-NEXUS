<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F-004 (E-038): offering to be a goal buddy becomes a request the goal owner
 * must accept. `goals.mentor_id` is only written when the owner accepts; until
 * then the offer lives here. A new, additive table — no existing row changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('goal_buddy_requests')) {
            return;
        }

        Schema::create('goal_buddy_requests', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('goal_id');
            $table->unsignedInteger('owner_id');
            $table->unsignedInteger('requester_id');
            $table->enum('status', ['pending', 'accepted', 'declined', 'superseded'])->default('pending');
            $table->timestamp('responded_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'goal_id', 'status'], 'goal_buddy_requests_goal_status_index');
            $table->index(['tenant_id', 'requester_id', 'status'], 'goal_buddy_requests_requester_status_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('goal_buddy_requests');
    }
};
