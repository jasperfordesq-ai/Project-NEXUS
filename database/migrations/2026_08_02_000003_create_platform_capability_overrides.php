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
 * Platform-wide rollout switches the owner can set from the UI.
 *
 * Until now these lived only in server environment variables, so raising a
 * platform gate — turning on the attendance-credit engine, say — needed
 * somebody with SSH access. That is the wrong dependency for the person who
 * owns the platform.
 *
 * A row here OVERRIDES the environment value for one named capability.
 * No row means "use the environment", so an empty table reproduces today's
 * behaviour exactly and deleting a row is always a safe way back.
 *
 * Deliberately NOT tenant-scoped: this is the platform ceiling. Each community
 * still has its own switches underneath, and a tenant can never exceed the
 * ceiling set here.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('platform_capability_overrides')) {
            return;
        }

        Schema::create('platform_capability_overrides', function (Blueprint $table): void {
            $table->id();
            // The capability name, e.g. 'attendance_credits'. Validated against
            // a hardcoded allowlist in PlatformCapabilityService — an arbitrary
            // config path must never be settable over HTTP.
            $table->string('capability', 64)->unique();
            // Stored as a string so a capability can be a mode ('treasury')
            // rather than only on/off.
            $table->string('value', 64);
            $table->unsignedInteger('updated_by_user_id')->nullable();
            $table->string('reason', 500)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_capability_overrides');
    }
};
