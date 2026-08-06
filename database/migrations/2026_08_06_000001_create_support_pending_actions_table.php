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
 * Pending actions for the co_decide support tier (guardian redesign, phase 3).
 *
 * A supporter holding `co_decide` for a capability PREPARES an action (a
 * listing, a credit transfer); it takes effect only when the supported member
 * CONFIRMS it — in-app, or through a single-use emailed token, or (phase 4)
 * by broker-attested offline confirmation. This table is the queue of those
 * prepared actions, one row per action, with the confirmation evidence held
 * on the row (who confirmed, via which channel, when, from where).
 *
 * The token design copies `event_guardian_consents`, the platform's reference
 * consent implementation: only a SHA-256 hash of the token is stored, the
 * token is single-use (`token_consumed_at`), and it expires. The read-only
 * lookup endpoint is separate from the confirming endpoint so a mail scanner
 * following the link cannot confirm anything.
 *
 * FK type note: `users.id` and `account_relationships.id` are signed int(11),
 * so these columns are signed integers deliberately — unsigned would fail to
 * create the constraints. User FKs cascade: a deleted account's pending
 * actions are meaningless. The relationship FK cascades for the same reason —
 * revocation is a status change, not a delete, so cascade only fires when the
 * row is truly destroyed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('support_pending_actions')) {
            return;
        }

        Schema::create('support_pending_actions', function (Blueprint $table): void {
            $table->increments('id');
            $table->integer('tenant_id')->index();
            $table->integer('relationship_id')
                ->comment('The account_relationships row this action was prepared under');
            $table->integer('supported_user_id')
                ->comment('The member the action belongs to; owner of the listing/credits');
            $table->integer('supporter_user_id')
                ->comment('Who prepared it; becomes acting_user_id on execution');
            $table->string('action_type', 40)
                ->comment('listing_create | credit_transfer');
            $table->longText('payload')
                ->comment('JSON: the prepared action exactly as the member-facing endpoint would receive it');
            $table->string('status', 20)->default('pending')
                ->comment('pending | confirmed | declined | expired | cancelled');
            $table->string('token_hash', 64)->unique()
                ->comment('SHA-256 of the single-use email confirmation token; token itself is never stored');
            $table->timestamp('token_consumed_at')->nullable();
            $table->timestamp('expires_at')
                ->comment('Unconfirmed actions expire rather than lingering');
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('declined_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('confirmed_via', 20)->nullable()
                ->comment('in_app | email_token | attested_offline (phase 4)');
            $table->text('decline_reason')->nullable()
                ->comment('Optional, NEVER required - requiring a reason is pressure to consent');
            $table->string('response_ip', 45)->nullable();
            $table->string('response_user_agent', 255)->nullable();
            $table->integer('result_id')->nullable()
                ->comment('listing id / transaction id once executed');
            $table->timestamps();

            $table->index(['tenant_id', 'supported_user_id', 'status'], 'idx_spa_supported_status');
            $table->index(['tenant_id', 'supporter_user_id', 'status'], 'idx_spa_supporter_status');
            $table->index(['status', 'expires_at'], 'idx_spa_expiry_sweep');

            $table->foreign('relationship_id', 'fk_spa_relationship')
                ->references('id')->on('account_relationships')->cascadeOnDelete();
            $table->foreign('supported_user_id', 'fk_spa_supported_user')
                ->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('supporter_user_id', 'fk_spa_supporter_user')
                ->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_pending_actions');
    }
};
