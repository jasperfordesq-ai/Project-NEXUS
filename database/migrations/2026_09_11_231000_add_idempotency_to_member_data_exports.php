<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('member_data_exports', function (Blueprint $table): void {
            $table->string('creation_idempotency_key_hash', 64)->nullable()->after('user_id');
            $table->string('creation_request_hash', 64)->nullable()->after('creation_idempotency_key_hash');
            $table->timestamp('event_dispatched_at')->nullable()->after('file_size_bytes');
            $table->unique(
                ['tenant_id', 'user_id', 'creation_idempotency_key_hash'],
                'uq_mde_tenant_user_creation_key'
            );
        });
    }

    public function down(): void
    {
        Schema::table('member_data_exports', function (Blueprint $table): void {
            $table->dropUnique('uq_mde_tenant_user_creation_key');
            $table->dropColumn(['creation_idempotency_key_hash', 'creation_request_hash', 'event_dispatched_at']);
        });
    }
};
