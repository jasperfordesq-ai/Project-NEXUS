<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feed_post_creation_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('actor_user_id');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->unsignedInteger('post_id');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'actor_user_id', 'idempotency_key_hash'], 'feed_post_creation_receipt_key_unique');
            $table->index(['tenant_id', 'post_id'], 'feed_post_creation_receipt_post_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_post_creation_receipts');
    }
};
