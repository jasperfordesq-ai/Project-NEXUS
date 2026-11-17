<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Failed sign-ins counted by the hour, per community (Platform team panel →
 * Security, Nov 2026).
 *
 * Why: `login_attempts` is not a record. App\Core\RateLimiter deletes every
 * row older than 20 minutes, and a successful sign-in deletes that account's
 * failed rows, so the Security page's "last hour / last 24 hours" figures
 * read from it showed far less than they claimed. RateLimiter::recordAttempt()
 * now adds one to `failures` for every failed email sign-in, and
 * RateLimiter::countRefusedSignIn() one to `refused` for every attempt the
 * lock-out turns away before the password is checked.
 *
 * 🔴 Counts only: an hour, a community id, a number. No email, no digest, no
 * IP address, nothing about a person.
 *
 * 🔴 PLATFORM-GLOBAL on purpose: `tenant_id` is a column being counted, not a
 * scope. 0 = the community was not known. Only the platform team reads it.
 * No foreign key to `tenants`: the counter runs on the sign-in path and must
 * never fail because of one; a removed community's rows age out.
 *
 * Kept 90 days (`nexus:prune-logs`).
 *
 * One new table: safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('sign_in_failure_hours')) {
            return;
        }

        Schema::create('sign_in_failure_hours', static function (Blueprint $table): void {
            $table->dateTime('hour_start');
            // No default, on purpose: a column named tenant_id must never
            // fill itself in (TenantlessInsertRefusedTest). Both counters
            // always give it; 0 means "community not known".
            $table->integer('tenant_id');
            $table->unsignedInteger('failures')->default(0);
            // Attempts refused by the lock-out before any password check
            // (RateLimiter::countRefusedSignIn()). Kept apart from `failures`:
            // a locked-out attacker's guesses never reach the password check.
            $table->unsignedInteger('refused')->default(0);

            $table->primary(['hour_start', 'tenant_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sign_in_failure_hours');
    }
};
