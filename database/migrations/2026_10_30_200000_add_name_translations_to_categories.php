<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Category and skill-category names in other languages (AWID pilot feedback,
 * 30 Oct 2026: Spanish speakers choosing what to offer or request saw only the
 * English names). `name_translations` holds a JSON object of language code to
 * name, e.g. {"es":"Hogar y jardín"}. NULL means none yet; the name is then
 * shown as stored. Filled by TaxonomyNameLocalizer; cleared when the name changes.
 *
 * Adding a nullable column at the end is an instant, metadata-only change on
 * MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    private const TABLES = ['categories', 'skill_categories'];

    public function up(): void
    {
        foreach (self::TABLES as $tableName) {
            if (! Schema::hasTable($tableName) || Schema::hasColumn($tableName, 'name_translations')) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) {
                $table->text('name_translations')->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $tableName) {
            if (! Schema::hasTable($tableName) || ! Schema::hasColumn($tableName, 'name_translations')) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) {
                $table->dropColumn('name_translations');
            });
        }
    }
};
