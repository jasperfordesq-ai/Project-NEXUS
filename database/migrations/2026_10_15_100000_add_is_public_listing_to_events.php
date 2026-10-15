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
 * Per-event opt-in to the community's public events pages.
 *
 * Until now a community that switched on `public_events` advertised EVERY
 * published event to signed-out visitors; the organiser had no say. The owner
 * decided (2026-10-15) that an event is listed publicly only when its organiser
 * ticks "List as a public event", and that existing events become members-only
 * until someone does — hence a default of 0 for every existing row.
 *
 * The public listing additionally requires the tenant feature, publication and
 * the group-audience rule; this column alone never makes anything public.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('events') || Schema::hasColumn('events', 'is_public_listing')) {
            return;
        }

        Schema::table('events', function (Blueprint $table): void {
            $table->boolean('is_public_listing')->default(false)
                ->comment('Organiser opted this event into the public events pages');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('events') || ! Schema::hasColumn('events', 'is_public_listing')) {
            return;
        }

        Schema::table('events', function (Blueprint $table): void {
            $table->dropColumn('is_public_listing');
        });
    }
};
