<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Settings;

use App\Models\User;
use App\Services\RedisCache;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * `general.welcome_message` was retired on 2026-10-15.
 *
 * The admin Settings page offered a "Welcome message" box promising the text
 * was "shown to new members on their first sign-in". No client ever displayed
 * it — not react-frontend, not web-uk, not the mobile app — while the public
 * bootstrap payload still published it to anonymous callers. Since a5c85eaa6 a
 * working "Welcome text for the approval email" box sits beside it.
 *
 * These tests pin the removal from every surface: the setting must not be
 * published, offered, returned or writable. Rows already saved are left in
 * the database untouched (one production community had one).
 */
final class RetiredWelcomeMessageSettingTest extends TestCase
{
    use DatabaseTransactions;

    private function seedSetting(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'setting_type' => 'string', 'updated_at' => now()]
        );
    }

    private function setting(string $key): ?string
    {
        $value = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', $key)
            ->value('setting_value');

        return $value === null ? null : (string) $value;
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    public function test_public_bootstrap_no_longer_publishes_the_welcome_message(): void
    {
        $this->seedSetting('general.welcome_message', 'Hello from an old setting');
        $this->seedSetting('general.footer_text', 'Still public');
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        try {
            $settings = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                ->assertOk()
                ->json('data.settings');

            // Control: the neighbouring public setting is still published, so
            // this test cannot pass merely because settings came back empty.
            $this->assertSame('Still public', $settings['footer_text'] ?? null);
            $this->assertArrayNotHasKey('welcome_message', $settings);
        } finally {
            app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        }
    }

    public function test_enterprise_config_neither_returns_nor_saves_the_welcome_message(): void
    {
        $this->seedSetting('general.welcome_message', 'before');
        Sanctum::actingAs($this->admin());

        $this->apiGet('/v2/admin/enterprise/config')
            ->assertOk()
            ->assertJsonMissingPath('data.welcome_message');

        $this->apiPut('/v2/admin/enterprise/config', [
            'welcome_message' => 'after',
            'footer_text' => 'saved',
        ])->assertOk();

        $this->assertSame('saved', $this->setting('general.footer_text'));
        $this->assertSame('before', $this->setting('general.welcome_message'), 'a saved row is left alone, not overwritten');
    }

    public function test_admin_settings_endpoint_neither_returns_nor_accepts_the_welcome_message(): void
    {
        $this->seedSetting('general.welcome_message', 'before');
        Sanctum::actingAs($this->admin());

        $this->apiGet('/v2/admin/settings')
            ->assertOk()
            ->assertJsonMissingPath('data.settings.welcome_message');

        $this->apiPut('/v2/admin/settings', ['welcome_message' => 'after'])
            ->assertStatus(422);

        $this->assertSame('before', $this->setting('general.welcome_message'));
    }
}
