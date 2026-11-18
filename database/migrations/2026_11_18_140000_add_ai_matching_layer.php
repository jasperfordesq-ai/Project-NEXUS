<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The AI layer of smart matching (18 Nov 2026), for communities that switch
 * AI on with an OpenAI or Anthropic key. Matching works the same without it.
 *
 *  - listing_match_enrichments: what the AI read in each listing, once per
 *    version of its text — plain English terms and the kinds of help it
 *    covers (MatchConcepts keys). The engine adds them to the listing's own
 *    words, so a listing written in any language or wording meets the
 *    listings that answer it. A new, empty table: nothing is rewritten.
 *  - match_cache.ai_rerank_delta: the AI's judgement of one cached match,
 *    -5..+5. It used to be added into match_score, which the next cache
 *    refresh overwrote and which the matches page never reads (it scores
 *    live), so the judgement reached no member. Appended as the last column
 *    with ALGORITHM=INSTANT, LOCK=NONE: MariaDB refuses the statement rather
 *    than rebuild the table while the other colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('listing_match_enrichments')) {
            Schema::create('listing_match_enrichments', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->integer('listing_id');
                $table->char('content_hash', 64);
                $table->text('terms');
                $table->text('concepts');
                $table->string('provider', 30)->nullable();
                $table->string('model', 100)->nullable();
                $table->timestamps();
                $table->unique(['tenant_id', 'listing_id'], 'uk_lme_tenant_listing');
            });
        }

        if (Schema::hasTable('match_cache') && ! Schema::hasColumn('match_cache', 'ai_rerank_delta')) {
            DB::statement(
                'ALTER TABLE `match_cache` ADD COLUMN `ai_rerank_delta` DECIMAL(4,2) NULL DEFAULT NULL, ALGORITHM=INSTANT, LOCK=NONE'
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('listing_match_enrichments');
        if (Schema::hasTable('match_cache') && Schema::hasColumn('match_cache', 'ai_rerank_delta')) {
            Schema::table('match_cache', function (Blueprint $table): void {
                $table->dropColumn('ai_rerank_delta');
            });
        }
    }
};
