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
 * External partner federation kill switch.
 *
 * `federation_enabled` gates cross-tenant federation between tenants inside
 * THIS install. It does not distinguish that from protocol traffic exchanged
 * with OTHER installations (Komunitin, Credit Commons, the legacy v1 API,
 * partner webhooks, caring hour transfers, aggregate queries). These columns
 * add that second, narrower axis so external protocols can be switched off
 * for safety review without disturbing internal cross-tenant federation.
 *
 * Every column defaults to 0 (blocked) and `up()` explicitly zeroes the
 * existing singleton row: external federation ships OFF and is re-enabled
 * per protocol from the super-admin UI as each protocol's audit passes.
 */
return new class extends Migration
{
    /** @var array<int, string> */
    private const PROTOCOL_COLUMNS = [
        'external_protocol_nexus_enabled',
        'external_protocol_komunitin_enabled',
        'external_protocol_credit_commons_enabled',
        'external_protocol_legacy_v1_enabled',
        'external_protocol_webhooks_enabled',
        'external_protocol_hour_transfer_enabled',
        'external_protocol_aggregates_enabled',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('federation_system_control')) {
            return;
        }

        Schema::table('federation_system_control', function (Blueprint $table): void {
            // NOTE: keep ->default()/->nullable() on the SAME LINE as the column
            // declaration. The deploy Migration Safety Gate greps per line for
            // "non-nullable add without default", so wrapping the fluent chain
            // hides the default from it and fails the deploy on a safe column.
            if (! Schema::hasColumn('federation_system_control', 'external_federation_enabled')) {
                $table->boolean('external_federation_enabled')->default(false)
                    ->after('federation_enabled');
            }

            $after = 'external_federation_enabled';
            foreach (self::PROTOCOL_COLUMNS as $column) {
                if (! Schema::hasColumn('federation_system_control', $column)) {
                    $table->boolean($column)->default(false)->after($after);
                }
                $after = $column;
            }

            if (! Schema::hasColumn('federation_system_control', 'external_federation_disabled_reason')) {
                $table->string('external_federation_disabled_reason', 255)->nullable()->after($after);
            }
            if (! Schema::hasColumn('federation_system_control', 'external_federation_updated_at')) {
                $table->timestamp('external_federation_updated_at')->nullable()
                    ->after('external_federation_disabled_reason');
            }
            if (! Schema::hasColumn('federation_system_control', 'external_federation_updated_by')) {
                $table->unsignedInteger('external_federation_updated_by')->nullable()
                    ->after('external_federation_updated_at');
            }
        });

        // Column defaults only apply to new rows. The control row already
        // exists on every deployed install, so zero it explicitly.
        $off = ['external_federation_enabled' => 0];
        foreach (self::PROTOCOL_COLUMNS as $column) {
            $off[$column] = 0;
        }
        $off['external_federation_disabled_reason'] = 'Disabled pending external federation protocol audit.';
        $off['external_federation_updated_at'] = now();

        DB::table('federation_system_control')->update($off);
    }

    public function down(): void
    {
        if (! Schema::hasTable('federation_system_control')) {
            return;
        }

        $columns = array_merge(
            ['external_federation_enabled'],
            self::PROTOCOL_COLUMNS,
            [
                'external_federation_disabled_reason',
                'external_federation_updated_at',
                'external_federation_updated_by',
            ],
        );

        $existing = array_values(array_filter(
            $columns,
            static fn (string $column): bool => Schema::hasColumn('federation_system_control', $column),
        ));

        if ($existing === []) {
            return;
        }

        Schema::table('federation_system_control', function (Blueprint $table) use ($existing): void {
            $table->dropColumn($existing);
        });
    }
};
