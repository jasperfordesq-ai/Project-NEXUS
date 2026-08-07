<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Denormalized mirror of an ACTIVE message-access grant on a linked-account
 * relationship (messages tier = assist, consent-confirmed).
 *
 * 🔴 This column is written only inside the consent-confirm transaction
 * (SubAccountService::applyConsentedMessageAccess) and cleared on withdrawal /
 * tier removal / revocation. It exists for exactly two readers:
 *
 *  1. The counterparty-notice query on the messages restriction-status
 *     endpoint — one indexed lookup per conversation open, which a
 *     JSON_EXTRACT over `permissions` could not index.
 *  2. Humans auditing WHEN access began, without JSON spelunking.
 *
 * It is NEVER read for authorization: the tiers object inside `permissions`
 * remains the single authority the viewer endpoints check. If the two ever
 * disagree, the tiers object wins and this column is the bug.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('account_relationships', 'message_access_granted_at')) {
            Schema::table('account_relationships', function (Blueprint $table) {
                $table->timestamp('message_access_granted_at')->nullable()->after('approved_at');
                $table->index(['tenant_id', 'child_user_id', 'message_access_granted_at'], 'idx_ar_msg_access_child');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('account_relationships', 'message_access_granted_at')) {
            Schema::table('account_relationships', function (Blueprint $table) {
                $table->dropIndex('idx_ar_msg_access_child');
                $table->dropColumn('message_access_granted_at');
            });
        }
    }
};
