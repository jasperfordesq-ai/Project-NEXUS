<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform-wide secrets a global super admin sets from the super-admin panel,
 * starting with the fallback Google Translate key (owner, 30 Oct 2026): Google
 * Translate is every community's default translation engine, on the
 * community's own Google key when it has one and on this platform key
 * otherwise. Values are encrypted with the application key; nothing ever
 * returns them to a browser.
 *
 * A new table: safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('platform_secrets')) {
            return;
        }

        Schema::create('platform_secrets', function (Blueprint $table) {
            $table->string('name', 100)->primary();
            $table->text('value');
            $table->integer('updated_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_secrets');
    }
};
