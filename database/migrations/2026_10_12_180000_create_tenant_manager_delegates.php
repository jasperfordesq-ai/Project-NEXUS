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
 * A recorded identity for a manager from a parent community (owner, 12 Oct
 * 2026: "Go with option 3").
 *
 * About 45 event tables record the acting account with a composite foreign key
 * (<actor>, tenant_id) -> users(id, tenant_id): the database only accepts an
 * actor who belongs to the record's community. A tenant super admin managing a
 * community BELOW its own does not, so its changes there cannot be recorded.
 * The fix is a DELEGATE row inside that community — users.status = 'delegate',
 * linked to the real account here — that acts and is recorded on its behalf.
 *
 * Guarantees enforced by the database, not by convention:
 *   - a delegate can never be given a password, have its email, role or
 *     community changed, carry a platform flag, or be turned back into an
 *     ordinary account (so nobody in the lower community can take it over and
 *     act under the manager's name);
 *   - an ordinary account can never be turned into a delegate.
 * App\Http\Middleware\Authenticate already refuses every status but 'active',
 * and TokenService refuses to mint a token for a delegate.
 *
 * Schema rules honoured: the enum value is APPENDED and the statement demands
 * ALGORITHM=INSTANT, LOCK=NONE, so it can never become a locking rebuild of
 * `users` (AGENTS.md, "Changing an existing column").
 */
return new class extends Migration
{
    private const STATUS_VALUES_BEFORE = "'active','inactive','suspended','banned','pending','rejected'";
    private const INSERT_TRIGGER = 'trg_users_delegate_insert_guard';
    private const UPDATE_TRIGGER = 'trg_users_delegate_update_guard';

    public function up(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }

        $type = (string) (DB::selectOne(
            "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'"
        )->t ?? '');
        if (! str_contains($type, "'delegate'")) {
            DB::statement(
                'ALTER TABLE `users` MODIFY `status` ENUM(' . self::STATUS_VALUES_BEFORE . ",'delegate') "
                . "DEFAULT 'active', ALGORITHM=INSTANT, LOCK=NONE"
            );
        }

        if (! Schema::hasTable('tenant_manager_delegates')) {
            DB::statement(
                'CREATE TABLE `tenant_manager_delegates` (
                    `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                    `tenant_id` int(11) NOT NULL,
                    `delegate_user_id` int(11) NOT NULL,
                    `principal_user_id` int(11) DEFAULT NULL,
                    `principal_tenant_id` int(11) NOT NULL,
                    `created_at` timestamp NULL DEFAULT NULL,
                    `updated_at` timestamp NULL DEFAULT NULL,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uniq_manager_delegate_principal` (`tenant_id`, `principal_user_id`),
                    UNIQUE KEY `uniq_manager_delegate_user` (`delegate_user_id`),
                    KEY `idx_manager_delegate_principal` (`principal_user_id`),
                    CONSTRAINT `fk_manager_delegate_user` FOREIGN KEY (`delegate_user_id`, `tenant_id`)
                        REFERENCES `users` (`id`, `tenant_id`) ON DELETE CASCADE,
                    CONSTRAINT `fk_manager_delegate_principal` FOREIGN KEY (`principal_user_id`)
                        REFERENCES `users` (`id`) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
        }

        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        if (! $this->triggerExists(self::INSERT_TRIGGER)) {
            DB::unprepared(
                'CREATE TRIGGER `' . self::INSERT_TRIGGER . '` BEFORE INSERT ON `users` FOR EACH ROW '
                . "BEGIN IF NEW.`status` = 'delegate' AND (NEW.`password_hash` IS NOT NULL "
                . 'OR COALESCE(NEW.`is_super_admin`, 0) <> 0 OR COALESCE(NEW.`is_god`, 0) <> 0 '
                . 'OR COALESCE(NEW.`is_tenant_super_admin`, 0) <> 0) '
                . "THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_delegate_invalid'; END IF; END"
            );
        }
        if (! $this->triggerExists(self::UPDATE_TRIGGER)) {
            DB::unprepared(
                'CREATE TRIGGER `' . self::UPDATE_TRIGGER . '` BEFORE UPDATE ON `users` FOR EACH ROW '
                . "BEGIN IF OLD.`status` = 'delegate' AND (NOT (NEW.`status` <=> 'delegate') "
                . 'OR NEW.`password_hash` IS NOT NULL OR NOT (NEW.`email` <=> OLD.`email`) '
                . 'OR NOT (NEW.`role` <=> OLD.`role`) OR NOT (NEW.`tenant_id` <=> OLD.`tenant_id`) '
                . 'OR COALESCE(NEW.`is_super_admin`, 0) <> 0 OR COALESCE(NEW.`is_god`, 0) <> 0 '
                . 'OR COALESCE(NEW.`is_tenant_super_admin`, 0) <> 0) '
                . "THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_delegate_immutable'; "
                . "ELSEIF NOT (OLD.`status` <=> 'delegate') AND NEW.`status` = 'delegate' "
                . "THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_delegate_conversion_refused'; "
                . 'END IF; END'
            );
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::INSERT_TRIGGER . '`');
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::UPDATE_TRIGGER . '`');
        }
        Schema::dropIfExists('tenant_manager_delegates');
        // The 'delegate' enum value is left in place: removing it would rebuild
        // `users`, and any delegate rows would have to be deleted first.
    }

    private function triggerExists(string $trigger): bool
    {
        return DB::table('information_schema.TRIGGERS')
            ->where('TRIGGER_SCHEMA', DB::getDatabaseName())
            ->where('TRIGGER_NAME', $trigger)
            ->exists();
    }
};
