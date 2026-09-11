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
        Schema::create('marketplace_image_upload_receipts', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->foreignId('listing_id')->constrained('marketplace_listings')->cascadeOnDelete();
            $table->unsignedBigInteger('user_id');
            $table->char('operation_hash', 64);
            $table->char('payload_hash', 64);
            $table->longText('response_json');
            $table->timestamp('created_at');
            $table->unique(['listing_id', 'operation_hash'], 'marketplace_image_upload_operation_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('marketplace_image_upload_receipts');
    }
};
