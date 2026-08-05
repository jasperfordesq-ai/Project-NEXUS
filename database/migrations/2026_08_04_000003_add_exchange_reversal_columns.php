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
 * Reversal of a completed exchange.
 *
 * A completed exchange could not be corrected. `TRANSITIONS[completed]` is empty,
 * there was no reversal endpoint, and the only tool an administrator had was the
 * single-member balance adjustment — applied twice by hand, with no link back to
 * the exchange and (until 2026-08-04) no audit row at all. For a timebank that is
 * a real integrity gap: a mis-recorded exchange moved credits and nothing could
 * put them back as a traceable correction.
 *
 * `reversal_transaction_id` carries a UNIQUE index deliberately. It is the
 * STRUCTURAL guard against double reversal — the same shape as
 * `marketplace_orders.mo_wallet_refund_once_unique`, which backs
 * MarketplaceTimeCreditSettlementService::refund(). A service-level "already
 * reversed?" check races; a unique index cannot. Both are used.
 *
 * Note on status: the exchange stays `completed` rather than gaining a `reversed`
 * enum value. Adding one would mean touching the status enum plus every place that
 * reads it, for no gain — "was this reversed?" is answered precisely by
 * `reversal_transaction_id IS NOT NULL`, and the reversal is additionally visible
 * in `exchange_history`. Read that column, not the status, to decide whether an
 * exchange still stands.
 *
 * FK type note: `exchange_requests.transaction_id` and `users.id` are signed
 * `int(11)`, so these columns match.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('exchange_requests')) {
            return;
        }

        if (! Schema::hasColumn('exchange_requests', 'reversal_transaction_id')) {
            Schema::table('exchange_requests', function (Blueprint $table): void {
                $table->integer('reversal_transaction_id')->nullable()->default(null)->after('transaction_id')
                    ->comment('Compensating transaction that reversed this exchange; NULL = not reversed');
                // UNIQUE, not a plain index: one reversal per exchange, enforced by
                // the database so concurrent attempts cannot both succeed.
                $table->unique('reversal_transaction_id', 'uq_exchange_reversal_once');
            });
        }

        if (! Schema::hasColumn('exchange_requests', 'reversed_at')) {
            Schema::table('exchange_requests', function (Blueprint $table): void {
                $table->timestamp('reversed_at')->nullable()->default(null)->after('reversal_transaction_id');
                $table->integer('reversed_by')->nullable()->default(null)->after('reversed_at')
                    ->comment('Broker/admin who reversed this exchange');
                $table->string('reversal_reason', 500)->nullable()->default(null)->after('reversed_by');
                $table->index(['tenant_id', 'reversed_at'], 'idx_exchange_reversed');
                $table->foreign('reversed_by', 'fk_exchange_reversed_by')
                    ->references('id')->on('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('exchange_requests')) {
            return;
        }

        if (Schema::hasColumn('exchange_requests', 'reversed_at')) {
            Schema::table('exchange_requests', function (Blueprint $table): void {
                $table->dropForeign('fk_exchange_reversed_by');
                $table->dropIndex('idx_exchange_reversed');
                $table->dropColumn(['reversed_at', 'reversed_by', 'reversal_reason']);
            });
        }

        if (Schema::hasColumn('exchange_requests', 'reversal_transaction_id')) {
            Schema::table('exchange_requests', function (Blueprint $table): void {
                $table->dropUnique('uq_exchange_reversal_once');
                $table->dropColumn('reversal_transaction_id');
            });
        }
    }
};
