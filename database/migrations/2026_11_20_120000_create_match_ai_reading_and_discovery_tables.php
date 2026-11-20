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
 * Two stores for the AI layer of smart matching (20 Nov 2026). Both are new
 * and empty; nothing existing is touched. Neither is needed for matching to
 * work: a community without AI never writes to them.
 *
 * match_text_readings — the AI's reading of a short text that is not a
 * listing: a profile skill name, a volunteering opportunity, an event. Keyed
 * by a hash of the text, never by member, so "Hedge trimming" is read once
 * for the whole community and no row says whose skill it is.
 *
 * listing_match_discoveries — for one listing, the other listings and
 * profile skills the AI judged a real fit when it was shown the community's
 * open offers or requests.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('match_text_readings')) {
            Schema::create('match_text_readings', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->char('text_hash', 64);
                // 'skill', 'opportunity' or 'event'
                $table->string('source', 20);
                $table->text('terms');
                $table->text('concepts');
                $table->string('provider', 30)->nullable();
                $table->string('model', 100)->nullable();
                $table->timestamps();
                $table->unique(['tenant_id', 'text_hash'], 'uk_mtr_tenant_text');
            });
        }

        if (!Schema::hasTable('listing_match_discoveries')) {
            Schema::create('listing_match_discoveries', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->integer('listing_id');
                $table->char('content_hash', 64);
                // {"l": {"<listing id>": 1-3}, "s": {"<skill text hash>": 1-3}}
                $table->text('fits');
                $table->integer('considered')->default(0);
                $table->string('provider', 30)->nullable();
                $table->string('model', 100)->nullable();
                $table->timestamps();
                $table->unique(['tenant_id', 'listing_id'], 'uk_lmd_tenant_listing');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('listing_match_discoveries');
        Schema::dropIfExists('match_text_readings');
    }
};
