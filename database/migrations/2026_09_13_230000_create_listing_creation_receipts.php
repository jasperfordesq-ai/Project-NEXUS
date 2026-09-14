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
        Schema::create('listing_creation_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->integer('user_id');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->integer('listing_id');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'user_id', 'idempotency_key_hash'],
                'listing_creation_receipt_key_unique',
            );
            $table->index(['tenant_id', 'listing_id'], 'listing_creation_receipt_listing_index');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('listing_creation_receipts');
    }
};
