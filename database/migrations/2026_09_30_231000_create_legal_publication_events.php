<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('legal_publication_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('delivery_id');
            $table->string('event_type', 12);
            $table->timestamp('occurred_at');
            $table->index(['tenant_id', 'delivery_id', 'event_type'], 'legal_publication_event_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('legal_publication_events');
    }
};
