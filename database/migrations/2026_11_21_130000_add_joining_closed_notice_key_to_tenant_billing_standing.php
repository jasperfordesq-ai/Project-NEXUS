<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether a community has been told that a community ABOVE it has closed its
 * door to new members (21 Nov 2026, hub plans task 7A).
 *
 * `joining_closed_notice_key` is `<id of the community above>|<its terms
 * key>` (JoiningGate::noticeKeyFor()), recorded by the daily check once the
 * notice to this community's admins was accepted by the mailer. "Stop new
 * members joining" shuts this community's door because of a community above
 * only while the two match: warning first. Null = not told.
 *
 * One nullable `ADD COLUMN` appended to a small table: safe while the other
 * colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('tenant_billing_standing', 'joining_closed_notice_key')) {
            Schema::table('tenant_billing_standing', function (Blueprint $table): void {
                $table->string('joining_closed_notice_key', 80)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('tenant_billing_standing', 'joining_closed_notice_key')) {
            Schema::table('tenant_billing_standing', function (Blueprint $table): void {
                $table->dropColumn('joining_closed_notice_key');
            });
        }
    }
};
