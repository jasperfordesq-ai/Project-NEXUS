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
 * Attested offline confirmation (guardian redesign, phase 4).
 *
 * Some supported members will never click a link or open the app — the
 * redesign exists for them. A broker may record that the member confirmed a
 * prepared action offline: by phone, in person, or on paper. That record is
 * deliberately WEAKER evidence than the member's own click, and the row says
 * so plainly rather than dressing it up: `confirmed_via` becomes
 * 'attested_offline', and these columns name who attested, through which
 * channel, and who witnessed it. Recorded, not hidden — that distinction is
 * what the ICO fairness principle asks for.
 *
 * FK type note: users.id is signed int(11); nullOnDelete because losing the
 * attribution is the correct degradation when a staff account is deleted —
 * the member's listing/credits must never be touched by that deletion.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('support_pending_actions')
            || Schema::hasColumn('support_pending_actions', 'attested_by_user_id')) {
            return;
        }

        Schema::table('support_pending_actions', function (Blueprint $table): void {
            $table->integer('attested_by_user_id')->nullable()->default(null)->after('confirmed_via')
                ->comment('Staff member who recorded an offline confirmation; NULL for in_app/email_token');
            $table->string('attested_channel', 20)->nullable()->default(null)->after('attested_by_user_id')
                ->comment('phone | in_person | paper');
            $table->string('attested_witness', 160)->nullable()->default(null)->after('attested_channel')
                ->comment('Who witnessed the confirmation, as stated by the attesting staff member');

            $table->foreign('attested_by_user_id', 'fk_spa_attested_by')
                ->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('support_pending_actions')
            || ! Schema::hasColumn('support_pending_actions', 'attested_by_user_id')) {
            return;
        }

        Schema::table('support_pending_actions', function (Blueprint $table): void {
            $table->dropForeign('fk_spa_attested_by');
            $table->dropColumn(['attested_by_user_id', 'attested_channel', 'attested_witness']);
        });
    }
};
