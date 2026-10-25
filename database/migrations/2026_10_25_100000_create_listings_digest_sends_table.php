<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per listing shown to a member in the offers & requests round-up
 * (App\Services\ListingsDigestService). It is what keeps the round-up from
 * repeating itself, and the latest sent_at per member is when that member
 * was last sent one, which decides when the next is due.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('listings_digest_sends')) {
            return;
        }

        Schema::create('listings_digest_sends', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('listing_id');
            $table->timestamp('sent_at')->useCurrent();

            $table->unique(['tenant_id', 'user_id', 'listing_id'], 'uq_listings_digest_sends_member_listing');
            $table->index(['tenant_id', 'user_id', 'sent_at'], 'idx_listings_digest_sends_member_sent');
            $table->index('sent_at', 'idx_listings_digest_sends_sent_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('listings_digest_sends');
    }
};
