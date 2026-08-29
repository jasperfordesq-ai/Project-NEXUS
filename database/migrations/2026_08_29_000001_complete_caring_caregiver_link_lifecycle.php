<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('caring_caregiver_links')) {
            return;
        }

        Schema::table('caring_caregiver_links', function (Blueprint $table): void {
            $table->timestamp('recipient_confirmed_at')->nullable()->after('approved_by');
            $table->unsignedInteger('recipient_confirmed_by')->nullable()->after('recipient_confirmed_at');
            $table->timestamp('consent_verified_at')->nullable()->after('recipient_confirmed_by');
            $table->unsignedInteger('consent_verified_by')->nullable()->after('consent_verified_at');
            $table->text('consent_evidence')->nullable()->after('consent_verified_by');
            $table->timestamp('approved_at')->nullable()->after('consent_evidence');
            $table->timestamp('rejected_at')->nullable()->after('approved_at');
            $table->unsignedInteger('rejected_by')->nullable()->after('rejected_at');
            $table->text('rejection_reason')->nullable()->after('rejected_by');
            $table->index(['tenant_id', 'status'], 'ccl_tenant_status_index');
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE caring_caregiver_links MODIFY status ENUM('pending','active','inactive','rejected') NOT NULL DEFAULT 'pending', ALGORITHM=INSTANT, LOCK=NONE");
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('caring_caregiver_links')) {
            return;
        }

        DB::table('caring_caregiver_links')->where('status', 'rejected')->update(['status' => 'inactive']);
        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE caring_caregiver_links MODIFY status ENUM('pending','active','inactive') NOT NULL DEFAULT 'pending', ALGORITHM=INSTANT, LOCK=NONE");
        }

        Schema::table('caring_caregiver_links', function (Blueprint $table): void {
            $table->dropIndex('ccl_tenant_status_index');
            $table->dropColumn([
                'recipient_confirmed_at',
                'recipient_confirmed_by',
                'consent_verified_at',
                'consent_verified_by',
                'consent_evidence',
                'approved_at',
                'rejected_at',
                'rejected_by',
                'rejection_reason',
            ]);
        });
    }
};
