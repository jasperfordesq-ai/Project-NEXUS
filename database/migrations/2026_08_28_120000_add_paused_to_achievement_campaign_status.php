<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Give `achievement_campaigns.status` the value the admin UI has always sent.
 *
 * 🔴 The admin campaign screen offers three states — Draft, Active, Paused —
 * and posts them verbatim. The column is
 * `enum('draft','scheduled','running','completed','cancelled')`, so BOTH
 * 'active' and 'paused' were outside it. `activateCampaign()` and
 * `pauseCampaign()` wrote them anyway; on a non-strict connection MySQL
 * silently coerces an out-of-range enum to the empty string, which is how a
 * campaign an admin had just activated ended up in no state at all.
 *
 * The knock-on was total: the hourly cron selects `status = 'running'`, so no
 * campaign an admin activated was ever eligible, and nothing was ever awarded.
 *
 * The fix is split deliberately. 'active' is NOT added here — 'running' is
 * already the enum's word for the live state, and two spellings of one state is
 * how this class of bug starts. The service now maps the UI's 'active' to
 * 'running' and back, the same way it already maps campaign types. 'paused' has
 * no equivalent in the enum and is a genuinely distinct state (activated, then
 * deliberately stopped, and `activated_at` must survive), so it is added.
 *
 * Existing rows stranded at '' by the old writes are moved to 'draft': that is
 * the safe reading, because a campaign in an unknown state must not start
 * awarding credit the moment the cron can finally see it.
 */
return new class extends Migration
{
    private const TABLE = 'achievement_campaigns';

    public function up(): void
    {
        if (! Schema::hasTable(self::TABLE)) {
            return;
        }

        DB::statement(
            "ALTER TABLE `" . self::TABLE . "` MODIFY `status`
             ENUM('draft','scheduled','running','paused','completed','cancelled')
             NOT NULL DEFAULT 'draft'"
        );

        // Rows the pre-fix writers stranded outside the enum. Compared against
        // the empty string rather than NULL: that is what MySQL substitutes for
        // an out-of-range enum value on a non-strict connection.
        DB::table(self::TABLE)->where('status', '')->update(['status' => 'draft']);
    }

    public function down(): void
    {
        if (! Schema::hasTable(self::TABLE)) {
            return;
        }

        // Nothing may be left on a value the narrower enum cannot hold.
        DB::table(self::TABLE)->where('status', 'paused')->update(['status' => 'draft']);

        DB::statement(
            "ALTER TABLE `" . self::TABLE . "` MODIFY `status`
             ENUM('draft','scheduled','running','completed','cancelled')
             NOT NULL DEFAULT 'draft'"
        );
    }
};
