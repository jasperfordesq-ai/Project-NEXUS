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
 * Marketplace & Freecycle — "Borrow & lend" listings (owner, 17 Oct 2026).
 *
 * A member can now list something to LEND rather than sell or give away: a
 * ladder, a pressure washer, a sewing machine. The item stays theirs and comes
 * back. Lending is a listing TYPE, not a category, because a lend listing
 * behaves differently from a sale at every step: nothing is bought, no order
 * or payment is created, and the call to action is "ask to borrow" (a message
 * to the owner). A category could not switch those behaviours off.
 *
 * Schema rules honoured (AGENTS.md, "Changing an existing column"):
 *   - the enum value is APPENDED (`lend` after `contact`) and the statement
 *     demands ALGORITHM=INSTANT, LOCK=NONE, so MariaDB refuses rather than
 *     rebuilds the table while the other colour is serving. Measured locally
 *     on 10.11.18 (17 Oct 2026): accepted, metadata-only.
 *   - `loan_terms` is an appended NULLable column holding the owner's
 *     plain-language conditions ("up to two weeks, collect from Rathmines,
 *     please return clean").
 *
 * 🔴 The column add is NOT instant. `marketplace_listings` has a FULLTEXT
 * index (mpl_title_description_ft), and on MariaDB 10.11 that rules out a
 * metadata-only ADD COLUMN — measured 17 Oct 2026 locally:
 *   ADD COLUMN ..., ALGORITHM=INSTANT -> ERROR 1845 "not supported for this
 *                                        operation. Try ALGORITHM=INPLACE"
 * This is the same limit 2026_10_09_100100_add_geocode_attempted_at_to_users
 * hit on `users`, and the same answer: the plain schema-builder add below,
 * which MariaDB runs as an INPLACE rebuild under a SHARED lock. Reads carry
 * on; writes to marketplace listings wait for the copy. The table is small
 * (28 rows locally; the marketplace feature is OFF by default, so production
 * is of the same order) and the copy is well under a second. Check the
 * production row count before deploying if that ever changes.
 */
return new class extends Migration
{
    private const PRICE_TYPES_BEFORE = "'fixed','negotiable','free','auction','contact'";

    public function up(): void
    {
        if (! Schema::hasTable('marketplace_listings')) {
            return;
        }

        $type = (string) (DB::selectOne(
            "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'marketplace_listings'
               AND COLUMN_NAME = 'price_type'"
        )->t ?? '');

        if (! str_contains($type, "'lend'")) {
            DB::statement(
                'ALTER TABLE `marketplace_listings` MODIFY `price_type` ENUM(' . self::PRICE_TYPES_BEFORE . ",'lend') "
                . "NOT NULL DEFAULT 'fixed', ALGORITHM=INSTANT, LOCK=NONE"
            );
        }

        if (! Schema::hasColumn('marketplace_listings', 'loan_terms')) {
            Schema::table('marketplace_listings', static function (Blueprint $table): void {
                $table->string('loan_terms', 500)->nullable()->after('time_credit_price');
            });
        }
    }

    public function down(): void
    {
        // Deliberately a no-op. Narrowing the enum would fail on any row that
        // already says 'lend', and dropping the column discards member text.
    }
};
