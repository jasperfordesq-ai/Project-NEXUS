<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Migrations;

use Illuminate\Database\Migrations\Migration;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * 2026_11_13_150000_remove_unused_native_app_settings (E-127 / F-621).
 *
 * The admin Native App page stored twenty-four `native_app_*` settings that
 * nothing read, two of them push credentials. Once the page's form is gone the
 * rows are orphans; this migration removes them and nothing else.
 */
final class RemoveUnusedNativeAppSettingsTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = '2026_11_13_150000_remove_unused_native_app_settings.php';

    /** The secondary tenant seeded by TestCase. */
    private const OTHER_TENANT_ID = 999;

    private function migration(): Migration
    {
        return require database_path('migrations/' . self::MIGRATION);
    }

    private function setting(int $tenantId, string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'setting_type' => 'string']
        );
    }

    private function keysFor(int $tenantId): array
    {
        return DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->pluck('setting_key')
            ->all();
    }

    public function test_it_removes_native_app_rows_in_every_community(): void
    {
        $this->setting($this->testTenantId, 'native_app_name', 'KISS Musterstadt');
        $this->setting($this->testTenantId, 'native_app_fcm_server_key', 'a-pasted-credential');
        $this->setting(self::OTHER_TENANT_ID, 'native_app_store_mode', 'tenant_branded');

        $this->migration()->up();

        $this->assertNotContains('native_app_name', $this->keysFor($this->testTenantId));
        $this->assertNotContains('native_app_fcm_server_key', $this->keysFor($this->testTenantId));
        $this->assertNotContains('native_app_store_mode', $this->keysFor(self::OTHER_TENANT_ID));
    }

    public function test_it_leaves_every_other_setting_alone(): void
    {
        $this->setting($this->testTenantId, 'general.site_name', 'Kept');
        $this->setting($this->testTenantId, 'seo_title', 'Kept too');
        // `_` is a single-character wildcard in LIKE. A key that only matches
        // when the underscores are treated as wildcards must survive.
        $this->setting($this->testTenantId, 'nativeXappXlookalike', 'Kept as well');
        $this->setting($this->testTenantId, 'native_app_name', 'Removed');

        $this->migration()->up();

        $keys = $this->keysFor($this->testTenantId);
        $this->assertContains('general.site_name', $keys);
        $this->assertContains('seo_title', $keys);
        $this->assertContains('nativeXappXlookalike', $keys);
        $this->assertNotContains('native_app_name', $keys);
    }

    public function test_it_logs_which_keys_went_but_never_their_values(): void
    {
        $this->setting($this->testTenantId, 'native_app_fcm_server_key', 'a-pasted-credential');

        Log::spy();
        $this->migration()->up();

        Log::shouldHaveReceived('info')
            ->withArgs(function (string $message, array $context): bool {
                $flat = json_encode($context);

                return str_contains($flat, 'native_app_fcm_server_key')
                    && ! str_contains($flat, 'a-pasted-credential');
            })
            ->once();
    }

    public function test_it_is_quiet_and_safe_when_there_is_nothing_to_remove(): void
    {
        DB::table('tenant_settings')->where('setting_key', 'like', 'native\_app\_%')->delete();

        Log::spy();
        $this->migration()->up();

        Log::shouldNotHaveReceived('info');
        $this->assertTrue(true);
    }
}
