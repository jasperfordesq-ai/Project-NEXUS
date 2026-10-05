<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Group exchanges gain two kinds — "workshop or class" (givers earn their hours,
 * attendees pay theirs, leftover hours go to the community time fund) and "a team
 * helping someone" — and the community fund ledger gains a "group_exchange" entry
 * type for that leftover.
 *
 * Both values are APPENDED and the server is told ALGORITHM=INSTANT, LOCK=NONE, so
 * the change is metadata-only: MariaDB refuses the statement rather than rebuild
 * a table while the other colour is serving traffic.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('group_exchanges')) {
            DB::statement(
                "ALTER TABLE `group_exchanges` MODIFY `split_type`
                 ENUM('equal','custom','weighted','workshop','team') NOT NULL DEFAULT 'equal',
                 ALGORITHM=INSTANT, LOCK=NONE"
            );
        }

        if (Schema::hasTable('community_fund_transactions')) {
            DB::statement(
                "ALTER TABLE `community_fund_transactions` MODIFY `type`
                 ENUM('deposit','withdrawal','donation','starting_balance_grant','group_exchange') NOT NULL,
                 ALGORITHM=INSTANT, LOCK=NONE"
            );
        }
    }

    public function down(): void
    {
        // Removing enum values would rebuild both tables and fail on any row
        // that uses them, so this migration is not reversed.
    }
};
