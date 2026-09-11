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
        Schema::create('wallet_transfer_receipts', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('sender_id');
            $table->char('fingerprint', 40);
            $table->unsignedBigInteger('transaction_id');
            $table->timestamp('created_at');
            $table->unique(['tenant_id', 'sender_id', 'fingerprint'], 'wallet_transfer_receipt_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallet_transfer_receipts');
    }
};
