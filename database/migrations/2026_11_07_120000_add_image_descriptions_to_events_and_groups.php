<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An event's cover photo and a group's picture and cover can now carry a
 * description for screen-reader users (AWID accessibility report, Oct 2026,
 * point 6: every uploaded image should have one).
 *
 *  - events.image_alt          describes events.cover_image (EventContractMapper
 *                              already read this key; the column never existed,
 *                              so the title was always used)
 *  - groups.image_alt          describes groups.image_url (the group's picture)
 *  - groups.cover_image_alt    describes groups.cover_image_url
 *
 * NULL means nobody wrote one, and the websites fall back to their wording
 * with the title or name, as before. Adding nullable columns at the end is an
 * instant, metadata-only change on MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    /** @var array<string, array<int, string>> */
    private const COLUMNS = [
        'events' => ['image_alt'],
        'groups' => ['image_alt', 'cover_image_alt'],
    ];

    public function up(): void
    {
        foreach (self::COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }
            foreach ($columns as $column) {
                if (Schema::hasColumn($table, $column)) {
                    continue;
                }
                Schema::table($table, function (Blueprint $blueprint) use ($column) {
                    $blueprint->string($column, 255)->nullable();
                });
            }
        }
    }

    public function down(): void
    {
        foreach (self::COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }
            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) {
                    continue;
                }
                Schema::table($table, function (Blueprint $blueprint) use ($column) {
                    $blueprint->dropColumn($column);
                });
            }
        }
    }
};
