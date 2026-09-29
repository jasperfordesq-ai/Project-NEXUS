<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Refuse any row written without a tenant, instead of filing it under a
 * default community (O-087, E-063).
 *
 * 608 of the platform's tenant_id columns are NOT NULL with no default, so an
 * insert that forgets the tenant fails. These tables instead declared
 * DEFAULT 1 (the master tenant) or DEFAULT 0, so the same mistake silently
 * filed the row under the master community or under none. That is how
 * TimeBank Ireland reviews, group posts, a volunteer application and 34 badges
 * ended up in tenant 1 in Feb–Mar 2026, and goal reminders in tenant 0.
 *
 * Dropping the default alone is not enough: the Laravel connection runs with
 * strict => false, where an omitted NOT NULL column becomes an implicit 0
 * with only a warning. So each table also gets a BEFORE INSERT trigger that
 * SIGNALs when NEW.tenant_id is NULL or 0. Measured on MariaDB 10.11 in
 * non-strict mode: omitted, NULL and 0 are all refused — for plain INSERT,
 * multi-row INSERT (whole statement refused), INSERT IGNORE, ON DUPLICATE
 * KEY UPDATE, REPLACE and INSERT … SELECT — while an explicit tenant, and a
 * genuine duplicate under INSERT IGNORE, behave exactly as before.
 *
 * Both statements are metadata-only: ALTER COLUMN … DROP DEFAULT runs with
 * ALGORITHM=INSTANT (the server refuses it otherwise), and CREATE TRIGGER
 * touches no rows. Explicit tenant_id = 1 stays valid — the master tenant
 * legitimately owns rows here (platform help articles, legal documents,
 * settings).
 */
return new class extends Migration
{
    /** table => the default it had before this migration (restored by down()). */
    private const TABLES = [
        'campaign_awards' => 1,
        'comments' => 1,
        'connections' => 1,
        'event_rsvps' => 1,
        'group_discussions' => 1,
        'group_members' => 1,
        'group_posts' => 1,
        'help_articles' => 1,
        'help_article_feedback' => 1,
        'legal_documents' => 1,
        'likes' => 1,
        'marketplace_delivery_offers' => 1,
        'post_shares' => 1,
        'reviews' => 1,
        'tenant_settings' => 1,
        'user_badges' => 1,
        'vol_applications' => 1,
        'vol_emergency_alert_recipients' => 1,
        'vol_logs' => 1,
        'vol_opportunities' => 1,
        'vol_reviews' => 1,
        'vol_shifts' => 1,
        'vol_shift_group_members' => 1,
        'exchange_history' => 0,
        'message_reactions' => 0,
        'poll_options' => 0,
        'poll_votes' => 0,
        'user_hidden_posts' => 0,
        'user_muted_users' => 0,
    ];

    public function up(): void
    {
        foreach (array_keys(self::TABLES) as $table) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'tenant_id')) {
                continue;
            }

            if ($this->columnDefault($table) !== null) {
                DB::statement("ALTER TABLE `{$table}` ALTER COLUMN `tenant_id` DROP DEFAULT, ALGORITHM=INSTANT, LOCK=NONE");
            }

            $trigger = $this->triggerName($table);
            if (! $this->triggerExists($trigger)) {
                DB::unprepared(
                    "CREATE TRIGGER `{$trigger}` BEFORE INSERT ON `{$table}` FOR EACH ROW "
                    . "BEGIN IF NEW.tenant_id IS NULL OR NEW.tenant_id = 0 THEN "
                    . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{$table}: insert without a tenant_id refused'; "
                    . "END IF; END"
                );
            }
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table => $default) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'tenant_id')) {
                continue;
            }

            DB::unprepared('DROP TRIGGER IF EXISTS `' . $this->triggerName($table) . '`');
            DB::statement("ALTER TABLE `{$table}` ALTER COLUMN `tenant_id` SET DEFAULT {$default}, ALGORITHM=INSTANT, LOCK=NONE");
        }
    }

    private function triggerName(string $table): string
    {
        return "trg_{$table}_require_tenant";
    }

    private function triggerExists(string $name): bool
    {
        return DB::selectOne(
            'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?',
            [$name],
        ) !== null;
    }

    private function columnDefault(string $table): ?string
    {
        $row = DB::selectOne(
            'SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [$table, 'tenant_id'],
        );

        return $row?->d;
    }
};
