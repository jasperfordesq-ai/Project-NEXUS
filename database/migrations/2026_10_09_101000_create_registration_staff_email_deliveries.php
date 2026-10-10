<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('registration_staff_email_deliveries')) {
            return;
        }

        Schema::create('registration_staff_email_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('registrant_user_id');
            $table->unsignedBigInteger('recipient_user_id');
            $table->enum('status', [
                'captured', 'pending', 'claimed', 'accepted', 'definite_failure', 'unknown', 'cancelled',
            ])->default('captured');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->uuid('claim_token')->nullable();
            $table->uuid('dispatch_id')->nullable()->unique();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->string('provider_message_id', 255)->nullable();
            $table->unsignedBigInteger('reconciled_from_email_log_id')->nullable();
            $table->timestamp('reconciled_at')->nullable();
            $table->string('last_error_code', 64)->nullable();
            $table->timestamps();

            $table->unique(
                ['tenant_id', 'registrant_user_id', 'recipient_user_id'],
                'uq_registration_staff_email_recipient'
            );
            $table->index(['tenant_id', 'status', 'created_at'], 'idx_registration_staff_email_status');
            $table->index(['status', 'claimed_at'], 'idx_registration_staff_email_stale_claim');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('registration_staff_email_deliveries');
    }
};
