<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Access review (Platform team panel, Nov 2026): every so often the platform
 * team goes through the senior accounts and records, for each one, "keep" or
 * "should be removed" (App\Services\PlatformTeam\AccessReviewService). The
 * record changes nobody's access.
 *
 * 🔴 PLATFORM-GLOBAL: neither table has a `tenant_id`, on purpose. A review
 * covers every community's senior accounts at once. Do not add tenant scoping
 * to queries on these tables; only the platform team can reach them.
 *
 * 🔴 Ids only. No name and no email address is stored: names are read from
 * `users` when shown, so an erased account shows as erased.
 *
 * 🔴 Append-only, enforced by the database (BEFORE UPDATE / BEFORE DELETE
 * signal triggers, the supporter_message_view_audits pattern): a review can be
 * written once and never altered, by anyone, including an administrator with
 * SQL access. One exception: the review's free-text `note` may be set to NULL
 * while every other column stays the same, so the note can be erased
 * (AccessReviewService::clearNote()). Any other update is refused, and so is
 * any update to `senior_access_review_items`. 🔴 A column added to
 * `senior_access_reviews` later must be added to that trigger's comparison,
 * or it becomes changeable. For the same reason there is NO foreign key to `users`: a
 * cascade or SET NULL from `users` would be an UPDATE or DELETE here, which
 * the triggers refuse, and would block the change to `users`. A review
 * naming an account that no longer exists shows it as erased.
 *
 * `reviewed_by`, `user_id` and `community_id` are signed int(11) to match
 * `users.id` / `tenants.id`.
 *
 * Two new tables: safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    /**
     * Refuses every update except clearing the note: NEW.note IS NULL and
     * every other column equal (NULL-safe) to its old value.
     */
    private const SAR_NO_UPDATE_BODY = "BEFORE UPDATE ON `senior_access_reviews` FOR EACH ROW\n"
        . "BEGIN\n"
        . "  IF NOT (NEW.`note` IS NULL\n"
        . "      AND NEW.`id` <=> OLD.`id`\n"
        . "      AND NEW.`reviewed_by` <=> OLD.`reviewed_by`\n"
        . "      AND NEW.`account_count` <=> OLD.`account_count`\n"
        . "      AND NEW.`remove_count` <=> OLD.`remove_count`\n"
        . "      AND NEW.`created_at` <=> OLD.`created_at`) THEN\n"
        . "    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'senior_access_review_immutable';\n"
        . "  END IF;\n"
        . "END";

    public function up(): void
    {
        if (! Schema::hasTable('senior_access_reviews')) {
            Schema::create('senior_access_reviews', static function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('reviewed_by');
                $table->string('note', 500)->nullable();
                $table->integer('account_count');
                $table->integer('remove_count');
                $table->timestamp('created_at')->useCurrent();

                $table->index('created_at', 'idx_senior_access_reviews_created');
            });
        }

        if (! Schema::hasTable('senior_access_review_items')) {
            Schema::create('senior_access_review_items', static function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('review_id');
                $table->integer('user_id');
                $table->string('level', 40);
                $table->integer('community_id')->nullable();
                $table->enum('decision', ['keep', 'remove']);
                $table->timestamp('created_at')->useCurrent();

                $table->index('review_id', 'idx_senior_access_review_items_review');

                $table->foreign('review_id', 'fk_senior_access_review_items_review')
                    ->references('id')->on('senior_access_reviews')->restrictOnDelete();
            });
        }

        $this->createTrigger('trg_sar_no_update', self::SAR_NO_UPDATE_BODY);
        $this->createSignalTrigger('trg_sar_no_delete', 'BEFORE DELETE ON `senior_access_reviews` FOR EACH ROW');
        $this->createSignalTrigger('trg_sari_no_update', 'BEFORE UPDATE ON `senior_access_review_items` FOR EACH ROW');
        $this->createSignalTrigger('trg_sari_no_delete', 'BEFORE DELETE ON `senior_access_review_items` FOR EACH ROW');
    }

    public function down(): void
    {
        foreach (['trg_sar_no_update', 'trg_sar_no_delete', 'trg_sari_no_update', 'trg_sari_no_delete'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS `{$trigger}`");
        }
        Schema::dropIfExists('senior_access_review_items');
        Schema::dropIfExists('senior_access_reviews');
    }

    private function createSignalTrigger(string $name, string $timing): void
    {
        $this->createTrigger(
            $name,
            "{$timing} SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'senior_access_review_immutable'",
        );
    }

    private function createTrigger(string $name, string $definition): void
    {
        $exists = DB::selectOne(
            'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?',
            [$name],
        );
        if ($exists !== null) {
            return;
        }
        DB::unprepared("CREATE TRIGGER `{$name}` {$definition}");
    }
};
