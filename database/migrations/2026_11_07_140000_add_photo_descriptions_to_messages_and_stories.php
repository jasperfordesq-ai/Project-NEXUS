<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A photo sent in a message, and a photo story, can now carry a description
 * for screen-reader users (AWID accessibility report, point 6: every image a
 * member uploads should have one).
 *
 *  - message_attachments.alt_text  describes an image attachment
 *  - stories.media_alt             describes an image story's photo
 *
 * NULL means nobody wrote one, and the clients fall back to their generic
 * wording, as before. Adding nullable columns at the end is an instant,
 * metadata-only change on MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    /** @var array<string, string> */
    private const COLUMNS = [
        'message_attachments' => 'alt_text',
        'stories' => 'media_alt',
    ];

    public function up(): void
    {
        foreach (self::COLUMNS as $table => $column) {
            if (! Schema::hasTable($table) || Schema::hasColumn($table, $column)) {
                continue;
            }
            Schema::table($table, function (Blueprint $blueprint) use ($column) {
                $blueprint->string($column, 255)->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (self::COLUMNS as $table => $column) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
                continue;
            }
            Schema::table($table, function (Blueprint $blueprint) use ($column) {
                $blueprint->dropColumn($column);
            });
        }
    }
};
