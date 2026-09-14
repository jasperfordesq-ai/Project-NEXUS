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
        Schema::create('ideation_mutation_receipts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('actor_user_id');
            $table->string('operation_type', 32);
            $table->unsignedInteger('resource_id');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->unsignedInteger('result_id')->nullable();
            $table->boolean('result_state')->nullable();
            $table->unsignedInteger('result_count')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'actor_user_id', 'operation_type', 'idempotency_key_hash'],
                'ideation_mutation_receipt_key_unique',
            );
            $table->index(
                ['tenant_id', 'operation_type', 'resource_id'],
                'ideation_mutation_receipt_resource_index',
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ideation_mutation_receipts');
    }
};
