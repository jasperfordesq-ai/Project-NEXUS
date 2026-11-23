<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "How to pay": one plain-text note per PAYEE, written once by whoever is
 * paid and shown to every community that pays them, wherever payment is
 * asked for (owner decision, 23 November 2026).
 *
 *  - `payee_tenant_id` = 1 is the platform itself: the note the platform team
 *    writes for the communities that pay the platform by invoice.
 *  - any other id is a parent community: the note its manager writes for the
 *    communities that pay it.
 *
 * A community that was asked for payment was never told how to pay it: no
 * bank details, no contact, on any page or in any email.
 *
 * A NEW table, not a column on `tenant_billing_standing`: the platform has no
 * row there, and creating a table takes no lock on anything the other colour
 * is serving. No note = no row.
 */
return new class extends Migration
{
    private const TABLE = 'billing_how_to_pay_notes';

    public function up(): void
    {
        if (Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->integer('payee_tenant_id')->primary();
            $table->text('note');
            $table->unsignedInteger('updated_by_user_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }
};
