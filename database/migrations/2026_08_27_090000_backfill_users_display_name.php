<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Repair the stored `users.name` display column.
 *
 * `users.name` is a real NOT NULL column that well over a hundred call sites
 * read directly, including many that select it WITHOUT `profile_type` or
 * `organization_name` and so cannot resolve an organisation's name themselves.
 * Three historical writers left it wrong:
 *
 *  - `RegistrationService` never set it, so every self-registered account
 *    stored an empty string;
 *  - `User::createWithTenant()` and the admin create endpoint stored
 *    `first_name . ' ' . last_name` regardless of `profile_type`, so an
 *    ORGANISATION account stored its contact person's personal name;
 *  - `UserService::update()` let `profile_type` / `organization_name` /
 *    `first_name` / `last_name` change without ever recomputing `name`, so
 *    switching an existing account to an organisation in profile settings left
 *    the personal name behind for ever.
 *
 * All three write paths are fixed and `UserObserver::saving()` now keeps the
 * column in step; this backfill repairs the rows that predate that.
 *
 * Deliberately NOT reversible in the data sense: `down()` cannot know what the
 * previous wrong value was, and restoring a wrong display name would be a
 * regression rather than a rollback.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }
        if (! Schema::hasColumn('users', 'organization_name') || ! Schema::hasColumn('users', 'profile_type')) {
            return;
        }

        // Organisation accounts: the trading name is the display name.
        DB::statement("
            UPDATE users
               SET name = organization_name
             WHERE profile_type = 'organisation'
               AND organization_name IS NOT NULL
               AND organization_name != ''
               AND (name IS NULL OR name != organization_name)
        ");

        // Everyone else: repair only rows whose stored name is empty. A
        // non-empty individual name is left alone on purpose — imports and SSO
        // accounts can carry a single-field name in `name` that first/last
        // cannot reproduce, and overwriting it would lose the only name they have.
        DB::statement("
            UPDATE users
               SET name = TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')))
             WHERE (name IS NULL OR TRIM(name) = '')
               AND (
                     (first_name IS NOT NULL AND TRIM(first_name) != '')
                  OR (last_name  IS NOT NULL AND TRIM(last_name)  != '')
               )
        ");
    }

    public function down(): void
    {
        // No-op: see the class docblock. The previous values were incorrect
        // display names and are not worth restoring.
    }
};
