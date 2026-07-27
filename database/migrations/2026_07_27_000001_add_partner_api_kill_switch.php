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
 * Partner API (AG60) kill switch — sibling of the external federation switch.
 *
 * The Partner API is a DIFFERENT external system from federation: third-party
 * bearer tokens with scopes, reading members/listings/wallet balances and
 * writing wallet credits, plus outbound webhook delivery. The external
 * federation kill switch does not cover it, so "external partner federation
 * off" was not the same as "no external access".
 *
 * It gets its own switch rather than being folded into the federation master,
 * so each label keeps meaning exactly what it says.
 *
 * Lives on `federation_system_control` because that singleton row is already
 * the platform-wide external-access control record (it also carries the
 * emergency lockdown). The column is named for its own system, not federation.
 *
 * Ships disabled: `partner_api` already defaults to false per tenant
 * (TenantFeatureConfig::FEATURE_DEFAULTS), so the API is opt-in and switching
 * the platform gate off by default matches the existing posture.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('federation_system_control')) {
            return;
        }

        if (! Schema::hasColumn('federation_system_control', 'partner_api_enabled')) {
            Schema::table('federation_system_control', function (Blueprint $table): void {
                // Keep ->default() on the SAME LINE as the declaration: the
                // deploy Migration Safety Gate greps per line for a
                // non-nullable add without a default, so a wrapped fluent
                // chain fails the deploy on a column that is in fact safe.
                $table->boolean('partner_api_enabled')->default(false)
                    ->comment('AG60 Partner API kill switch — not federation; see migration notes')
                    ->after('external_federation_updated_by');
                $table->string('partner_api_disabled_reason', 255)->nullable()->after('partner_api_enabled');
                $table->timestamp('partner_api_updated_at')->nullable()->after('partner_api_disabled_reason');
                $table->unsignedInteger('partner_api_updated_by')->nullable()->after('partner_api_updated_at');
            });
        }

        // Column defaults only apply to new rows; the control row already exists.
        DB::table('federation_system_control')->update([
            'partner_api_enabled' => 0,
            'partner_api_disabled_reason' => 'Disabled pending external partner access audit.',
            'partner_api_updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('federation_system_control')) {
            return;
        }

        $columns = array_values(array_filter(
            ['partner_api_enabled', 'partner_api_disabled_reason', 'partner_api_updated_at', 'partner_api_updated_by'],
            static fn (string $c): bool => Schema::hasColumn('federation_system_control', $c),
        ));

        if ($columns === []) {
            return;
        }

        Schema::table('federation_system_control', function (Blueprint $table) use ($columns): void {
            $table->dropColumn($columns);
        });
    }
};
