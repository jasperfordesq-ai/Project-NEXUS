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
        Schema::create('vol_org_deposit_receipts', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('user_id');
            $table->char('fingerprint', 40);
            $table->decimal('new_balance', 20, 4);
            $table->timestamp('created_at');
            $table->unique(['tenant_id', 'user_id', 'fingerprint'], 'vol_org_deposit_receipt_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vol_org_deposit_receipts');
    }
};
