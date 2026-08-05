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
 * Attribution for actions one member performs on another member's behalf.
 *
 * Linked accounts (`account_relationships`) let a member grant a family member,
 * carer, guardian or organisation the ability to manage their listings and to
 * send and receive time credits for them. Those permissions are presented to
 * users in both frontends, but until now nothing enforced them — and there was
 * nowhere to record a proxy action even if something had.
 *
 * `listings` carries only `user_id` and `transactions` only sender/receiver, so a
 * carer's action would have been indistinguishable from the dependent's own. For
 * a feature that lets one person spend another's credits — often a vulnerable
 * person's — that is not acceptable: the owner stays the dependent (so the
 * listing is theirs and the credits are theirs), and `acting_user_id` records who
 * actually performed the action.
 *
 * NULL means "the owner did it themselves", which is the case for every existing
 * row and for all ordinary use. Only proxy actions populate it.
 *
 * `ON DELETE SET NULL` rather than CASCADE: deleting a carer's account must never
 * delete the dependent's listings or destroy ledger rows. Losing the attribution
 * is the correct degradation.
 *
 * FK type note: `users.id`, `listings.user_id` and `transactions.sender_id` are
 * all signed `int(11)`, so these columns match deliberately — an unsigned column
 * here would fail to create the constraint.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('listings') && ! Schema::hasColumn('listings', 'acting_user_id')) {
            Schema::table('listings', function (Blueprint $table): void {
                $table->integer('acting_user_id')->nullable()->default(null)->after('user_id')
                    ->comment('Who actually created/edited this on the owner\'s behalf; NULL = the owner did it');
                $table->index(['tenant_id', 'acting_user_id'], 'idx_listings_acting_user');
                $table->foreign('acting_user_id', 'fk_listings_acting_user')
                    ->references('id')->on('users')->nullOnDelete();
            });
        }

        if (Schema::hasTable('transactions') && ! Schema::hasColumn('transactions', 'acting_user_id')) {
            Schema::table('transactions', function (Blueprint $table): void {
                $table->integer('acting_user_id')->nullable()->default(null)->after('sender_id')
                    ->comment('Who actually initiated this on a party\'s behalf; NULL = the party did it');
                $table->index(['tenant_id', 'acting_user_id'], 'idx_transactions_acting_user');
                $table->foreign('acting_user_id', 'fk_transactions_acting_user')
                    ->references('id')->on('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('listings') && Schema::hasColumn('listings', 'acting_user_id')) {
            Schema::table('listings', function (Blueprint $table): void {
                $table->dropForeign('fk_listings_acting_user');
                $table->dropIndex('idx_listings_acting_user');
                $table->dropColumn('acting_user_id');
            });
        }

        if (Schema::hasTable('transactions') && Schema::hasColumn('transactions', 'acting_user_id')) {
            Schema::table('transactions', function (Blueprint $table): void {
                $table->dropForeign('fk_transactions_acting_user');
                $table->dropIndex('idx_transactions_acting_user');
                $table->dropColumn('acting_user_id');
            });
        }
    }
};
