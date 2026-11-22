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
 * The payments list learns four things it could not record.
 *
 *  - A CARD payment Stripe reported (`stripe_invoice_id`, unique: one row per
 *    invoice however many times Stripe sends the event), with the payment
 *    intent and charge it was taken on, so a later refund or dispute can be
 *    matched to it.
 *  - WHO WAS PAID (`payee_tenant_id`): NULL = the platform; otherwise the
 *    parent community a hub's manager recorded the payment for. Every row
 *    from before this column was recorded by the platform team.
 *  - A VOID (`voided_at`, `voided_by_user_id`, `void_reason`): a payment
 *    recorded by mistake is struck through, never deleted.
 *  - A REFUND or DISPUTE Stripe reported on a card payment
 *    (`refunded_amount`, `refunded_at`, `dispute_status`, `disputed_at`).
 *
 * ADD COLUMN only, every column NULL, at the end of the table, plus three
 * indexes on a table that holds a handful of rows: safe while the other
 * colour serves. Guarded column by column, so running it twice changes
 * nothing.
 */
return new class extends Migration
{
    private const TABLE = 'billing_payments';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        $add = static function (string $column, callable $define): void {
            if (Schema::hasColumn(self::TABLE, $column)) {
                return;
            }
            Schema::table(self::TABLE, static function (Blueprint $table) use ($define): void {
                $define($table);
            });
        };

        $add('payee_tenant_id', static function (Blueprint $table): void {
            $table->integer('payee_tenant_id')->nullable();
        });
        $add('stripe_invoice_id', static function (Blueprint $table): void {
            $table->string('stripe_invoice_id', 190)->nullable();
            $table->unique('stripe_invoice_id', 'uq_bp_stripe_invoice');
        });
        $add('stripe_payment_intent_id', static function (Blueprint $table): void {
            $table->string('stripe_payment_intent_id', 190)->nullable();
            $table->index('stripe_payment_intent_id', 'idx_bp_stripe_pi');
        });
        $add('stripe_charge_id', static function (Blueprint $table): void {
            $table->string('stripe_charge_id', 190)->nullable();
            $table->index('stripe_charge_id', 'idx_bp_stripe_charge');
        });
        $add('voided_at', static function (Blueprint $table): void {
            $table->timestamp('voided_at')->nullable();
        });
        $add('voided_by_user_id', static function (Blueprint $table): void {
            $table->unsignedInteger('voided_by_user_id')->nullable();
        });
        $add('void_reason', static function (Blueprint $table): void {
            $table->string('void_reason', 500)->nullable();
        });
        $add('refunded_amount', static function (Blueprint $table): void {
            $table->decimal('refunded_amount', 12, 2)->nullable();
        });
        $add('refunded_at', static function (Blueprint $table): void {
            $table->timestamp('refunded_at')->nullable();
        });
        $add('dispute_status', static function (Blueprint $table): void {
            $table->string('dispute_status', 40)->nullable();
        });
        $add('disputed_at', static function (Blueprint $table): void {
            $table->timestamp('disputed_at')->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        foreach ([
            'disputed_at', 'dispute_status', 'refunded_at', 'refunded_amount',
            'void_reason', 'voided_by_user_id', 'voided_at',
            'stripe_charge_id', 'stripe_payment_intent_id', 'stripe_invoice_id', 'payee_tenant_id',
        ] as $column) {
            if (!Schema::hasColumn(self::TABLE, $column)) {
                continue;
            }
            Schema::table(self::TABLE, static function (Blueprint $table) use ($column): void {
                $table->dropColumn($column);
            });
        }
    }
};
