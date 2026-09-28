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
        Schema::create('federation_debit_approvals', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->string('protocol', 32);
            $table->string('reference_id', 100);
            $table->unsignedBigInteger('partner_key_id')->nullable();
            $table->string('partner_request_id', 100)->nullable();
            $table->char('request_hash', 64)->nullable();
            $table->unsignedBigInteger('payer_user_id');
            $table->unsignedBigInteger('payee_user_id')->nullable();
            $table->string('payee_label', 100);
            $table->decimal('amount', 12, 4);
            $table->text('description')->nullable();
            $table->string('status', 16)->default('pending');
            $table->timestamp('expires_at');
            $table->timestamp('decided_at')->nullable();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'protocol', 'reference_id'], 'federation_debit_reference_unique');
            $table->unique(['tenant_id', 'protocol', 'partner_key_id', 'partner_request_id'], 'federation_debit_partner_request_unique');
            $table->index(['tenant_id', 'payer_user_id', 'status'], 'federation_debit_payer_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('federation_debit_approvals');
    }
};
