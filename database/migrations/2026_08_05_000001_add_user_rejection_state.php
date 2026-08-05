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

/**
 * Rejection state for a pending member.
 *
 * Two problems, one fix.
 *
 * 1. **There was no way to reject an applicant.** A community could approve,
 *    suspend, ban or hard-delete a pending member, and nothing else. There was no
 *    reject endpoint and nowhere to record a reason — `users` has no
 *    `rejection_reason` column, so suspension and ban reasons survive only as free
 *    text inside an audit blob. Listings have done this properly for years
 *    (`listings.rejection_reason`, mandatory in ListingModerationService::reject()),
 *    and member vetting does it better still with closed reason codes. Member
 *    registration had nothing.
 *
 * 2. **`users.status` had no `rejected` value, but code already wrote one.**
 *    RegistrationService writes `status = 'rejected'` when an invite code is lost
 *    to a concurrent registration. This database runs with STRICT_TRANS_TABLES
 *    (verified), so that write does not silently coerce — it THROWS. The invite
 *    race therefore returned a 500 instead of the intended 422 INVITE_INVALID, and
 *    left the account `pending` rather than soft-deleted. Adding the enum value
 *    fixes that path as well as enabling rejection.
 *
 * Enum note: `rejected` is appended LAST. A 5→6 value enum still fits one byte, so
 * MariaDB can perform this as an in-place alter rather than a table rebuild —
 * important because `users` is one of the largest tables. Do not reorder the
 * existing values; that WOULD rewrite every row and would silently remap any
 * value stored by ordinal.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }

        // Append 'rejected' to the status enum, preserving existing values and order.
        DB::statement(
            "ALTER TABLE `users` MODIFY COLUMN `status`
             enum('active','inactive','suspended','banned','pending','rejected')
             DEFAULT 'active'"
        );

        if (! Schema::hasColumn('users', 'rejection_reason')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->string('rejection_reason', 500)->nullable()->default(null)->after('status')
                    ->comment('Why a pending registration was rejected; set with status = rejected');
                $table->timestamp('rejected_at')->nullable()->default(null)->after('rejection_reason');
                $table->integer('rejected_by')->nullable()->default(null)->after('rejected_at')
                    ->comment('Broker/admin who rejected the registration');
                $table->index(['tenant_id', 'rejected_at'], 'idx_users_rejected');
                $table->foreign('rejected_by', 'fk_users_rejected_by')
                    ->references('id')->on('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }

        if (Schema::hasColumn('users', 'rejection_reason')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->dropForeign('fk_users_rejected_by');
                $table->dropIndex('idx_users_rejected');
                $table->dropColumn(['rejection_reason', 'rejected_at', 'rejected_by']);
            });
        }

        // Any row still holding 'rejected' must be moved off it before the value is
        // removed, or the ALTER truncates it to '' under strict mode.
        DB::table('users')->where('status', 'rejected')->update(['status' => 'inactive']);

        DB::statement(
            "ALTER TABLE `users` MODIFY COLUMN `status`
             enum('active','inactive','suspended','banned','pending')
             DEFAULT 'active'"
        );
    }
};
