<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The "who was told" record (vol_wellbeing_alert_notifications) holds one row per
 * check-in, recipient and channel (deep audit S7, 21 Oct 2026). Two submits a
 * second apart could both run the chain and record everyone twice; with these
 * indexes a second write is refused and the service treats it as "already
 * recorded".
 *
 * Online: INPLACE with LOCK=NONE, which MariaDB refuses rather than lock the
 * table. If duplicate rows already exist the index cannot be built; the migration
 * stops with the count so a person decides, instead of deleting records itself.
 */
return new class extends Migration
{
    private const TABLE = 'vol_wellbeing_alert_notifications';

    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql' || !Schema::hasTable(self::TABLE)) {
            return;
        }

        $this->addUnique('uniq_vwan_checkin_user_channel', ['checkin_id', 'recipient_user_id', 'channel']);
        $this->addUnique('uniq_vwan_checkin_email_channel', ['checkin_id', 'recipient_email', 'channel']);
    }

    /** @param list<string> $columns */
    private function addUnique(string $name, array $columns): void
    {
        if ($this->hasIndex($name)) {
            return;
        }

        $cols = implode(', ', array_map(fn (string $c) => "`{$c}`", $columns));
        $notNull = implode(' AND ', array_map(fn (string $c) => "`{$c}` IS NOT NULL", $columns));
        $duplicates = (int) DB::selectOne(
            "SELECT COUNT(*) AS c FROM (SELECT 1 FROM `vol_wellbeing_alert_notifications` WHERE {$notNull} GROUP BY {$cols} HAVING COUNT(*) > 1) d"
        )->c;
        if ($duplicates > 0) {
            throw new \RuntimeException("{$name}: {$duplicates} duplicate group(s) in vol_wellbeing_alert_notifications; resolve them before this migration can add the index.");
        }

        DB::statement("ALTER TABLE `vol_wellbeing_alert_notifications` ADD UNIQUE INDEX `{$name}` ({$cols}), ALGORITHM=INPLACE, LOCK=NONE");
    }

    private function hasIndex(string $name): bool
    {
        return DB::selectOne(
            'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
            [self::TABLE, $name]
        )->c > 0;
    }

    public function down(): void
    {
        // Forward-only: removing the indexes would reopen the duplicate-record race.
    }
};
