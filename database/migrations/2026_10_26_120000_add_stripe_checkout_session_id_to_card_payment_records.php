<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hosted Stripe payment pages for the identity-verification fee, volunteering
 * donations and club dues (owner, 26 Oct 2026: the accessible site must take the
 * same payments as the website, and it works without JavaScript).
 *
 * Each record remembers the Stripe Checkout Session that may pay it, so the
 * webhook can find the record from the session Stripe issued, and an open page
 * can be reused or closed before the website's card form is used.
 *
 * Adding a nullable column is an instant, metadata-only change on MariaDB 10.11;
 * the secondary index is built online. No existing row changes.
 */
return new class extends Migration
{
    private const TABLES = [
        'identity_verification_sessions' => 'idx_ivs_checkout_session',
        'vol_donations' => 'idx_vd_checkout_session',
        'verein_member_dues' => 'verein_dues_checkout_session_idx',
    ];

    public function up(): void
    {
        foreach (self::TABLES as $table => $index) {
            if (! Schema::hasTable($table) || Schema::hasColumn($table, 'stripe_checkout_session_id')) {
                continue;
            }
            Schema::table($table, function (Blueprint $blueprint) use ($index) {
                $blueprint->string('stripe_checkout_session_id', 255)->nullable();
                $blueprint->index('stripe_checkout_session_id', $index);
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table => $index) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'stripe_checkout_session_id')) {
                continue;
            }
            Schema::table($table, function (Blueprint $blueprint) use ($index) {
                $blueprint->dropIndex($index);
                $blueprint->dropColumn('stripe_checkout_session_id');
            });
        }
    }
};
