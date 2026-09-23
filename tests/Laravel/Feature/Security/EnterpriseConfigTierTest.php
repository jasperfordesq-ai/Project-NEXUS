<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-054 — the "enterprise config" endpoints must apply the same tier gates as
 * the main settings page (AdminConfigController): email verification and
 * administrator approval are platform-super-admin only, maintenance mode is
 * super-admin only, the 2FA/passkey feature switches are super-admin only and
 * disabling passkeys needs an explicit confirmation. Unknown keys must not be
 * merged into tenants.configuration.
 */
final class EnterpriseConfigTierTest extends TestCase
{
    use DatabaseTransactions;

    /** @param array<string,mixed> $data */
    private function apiPatch(string $uri, array $data = []): \Illuminate\Testing\TestResponse
    {
        return $this->patchJson('/api' . $uri, $data, $this->withTenantHeader([]));
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function tenantSuperAdmin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create([
            'is_tenant_super_admin' => 1,
        ]);
    }

    private function platformSuperAdmin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'super_admin',
            'is_super_admin' => 1,
        ]);
    }

    private function setting(string $key): ?string
    {
        $value = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', $key)
            ->value('setting_value');

        return $value === null ? null : (string) $value;
    }

    private function seedSetting(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'setting_type' => 'string', 'updated_at' => now()]
        );
    }

    /** @return array<string,mixed> */
    private function configuration(): array
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');

        return json_decode((string) ($raw ?? '{}'), true) ?: [];
    }

    /** @return array<string,mixed> */
    private function features(): array
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');

        return json_decode((string) ($raw ?? '{}'), true) ?: [];
    }

    // ── updateConfig ─────────────────────────────────────────────────────

    public function test_admin_cannot_disable_email_verification_or_admin_approval(): void
    {
        $this->seedSetting('general.email_verification', 'true');
        $this->seedSetting('general.admin_approval', 'true');
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/enterprise/config', ['require_email_verification' => false])
            ->assertStatus(403);
        $this->apiPut('/v2/admin/enterprise/config', ['require_approval' => false])
            ->assertStatus(403);

        $this->assertSame('true', $this->setting('general.email_verification'));
        $this->assertSame('true', $this->setting('general.admin_approval'));
    }

    public function test_tenant_super_admin_cannot_change_platform_reserved_settings(): void
    {
        $this->seedSetting('general.email_verification', 'true');
        Sanctum::actingAs($this->tenantSuperAdmin());

        $this->apiPut('/v2/admin/enterprise/config', ['require_email_verification' => false])
            ->assertStatus(403);

        $this->assertSame('true', $this->setting('general.email_verification'));
    }

    public function test_admin_cannot_turn_on_maintenance_mode(): void
    {
        $this->seedSetting('general.maintenance_mode', 'false');
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/enterprise/config', ['maintenance_mode' => true])
            ->assertStatus(403);

        $this->assertSame('false', $this->setting('general.maintenance_mode'));
    }

    public function test_rejected_request_writes_nothing_even_for_ordinary_keys_in_the_same_payload(): void
    {
        $this->seedSetting('general.welcome_message', 'before');
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/enterprise/config', [
            'welcome_message' => 'after',
            'require_email_verification' => false,
        ])->assertStatus(403);

        $this->assertSame('before', $this->setting('general.welcome_message'));
    }

    public function test_unknown_keys_are_not_merged_into_tenant_configuration(): void
    {
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/enterprise/config', [
            'welcome_message' => 'hello',
            'jobs_require_moderation' => false,
            'modules' => ['wallet' => false],
            'f054_probe' => 'x',
        ])->assertStatus(200);

        $configuration = $this->configuration();
        $this->assertArrayNotHasKey('f054_probe', $configuration);
        $this->assertArrayNotHasKey('jobs_require_moderation', $configuration);
        $this->assertNotSame(['wallet' => false], $configuration['modules'] ?? null);
        $this->assertSame('hello', $this->setting('general.welcome_message'));
    }

    public function test_admin_can_still_change_ordinary_settings(): void
    {
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/enterprise/config', [
            'welcome_message' => 'Welcome F-054',
            'max_listing_images' => 7,
            'site_description' => 'Enterprise config control',
        ])->assertStatus(200)
            ->assertJsonPath('data.welcome_message', 'Welcome F-054');

        $this->assertSame('Welcome F-054', $this->setting('general.welcome_message'));
        $this->assertSame('7', $this->setting('listing.max_images'));
        $this->assertSame(
            'Enterprise config control',
            DB::table('tenants')->where('id', $this->testTenantId)->value('description')
        );
    }

    public function test_tenant_super_admin_can_set_maintenance_mode(): void
    {
        $this->seedSetting('general.maintenance_mode', 'false');
        Sanctum::actingAs($this->tenantSuperAdmin());

        $this->apiPut('/v2/admin/enterprise/config', ['maintenance_mode' => true])
            ->assertStatus(200);

        $this->assertSame('true', $this->setting('general.maintenance_mode'));
    }

    public function test_platform_super_admin_can_still_change_reserved_settings(): void
    {
        $this->seedSetting('general.email_verification', 'true');
        $this->seedSetting('general.admin_approval', 'false');
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->apiPut('/v2/admin/enterprise/config', [
            'require_email_verification' => false,
            'require_approval' => true,
        ])->assertStatus(200);

        $this->assertSame('false', $this->setting('general.email_verification'));
        $this->assertSame('true', $this->setting('general.admin_approval'));
    }

    // ── resetConfig ──────────────────────────────────────────────────────

    public function test_admin_reset_all_keeps_reserved_settings_and_unrelated_configuration(): void
    {
        $this->seedSetting('general.email_verification', 'true');
        $this->seedSetting('general.admin_approval', 'true');
        $this->seedSetting('general.welcome_message', 'reset me');
        $configuration = $this->configuration();
        $configuration['modules'] = ['wallet' => false];
        $configuration['jobs_require_moderation'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['configuration' => json_encode($configuration)]);
        Sanctum::actingAs($this->admin());

        $this->apiPost('/v2/admin/enterprise/config/reset', [])->assertStatus(200);

        $this->assertSame('true', $this->setting('general.email_verification'));
        $this->assertSame('true', $this->setting('general.admin_approval'));
        $this->assertNull($this->setting('general.welcome_message'), 'ordinary keys are still reset');
        $after = $this->configuration();
        $this->assertSame(['wallet' => false], $after['modules'] ?? null);
        $this->assertTrue($after['jobs_require_moderation'] ?? null);
    }

    public function test_admin_cannot_reset_a_named_reserved_setting(): void
    {
        $this->seedSetting('general.admin_approval', 'true');
        Sanctum::actingAs($this->admin());

        $this->apiPost('/v2/admin/enterprise/config/reset', ['keys' => ['require_approval']])
            ->assertStatus(403);

        $this->assertSame('true', $this->setting('general.admin_approval'));
    }

    public function test_admin_can_reset_a_named_ordinary_setting(): void
    {
        $this->seedSetting('general.welcome_message', 'reset me');
        Sanctum::actingAs($this->admin());

        $this->apiPost('/v2/admin/enterprise/config/reset', ['keys' => ['welcome_message']])
            ->assertStatus(200);

        $this->assertNull($this->setting('general.welcome_message'));
    }

    public function test_platform_super_admin_reset_all_still_resets_reserved_settings(): void
    {
        $this->seedSetting('general.admin_approval', 'true');
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->apiPost('/v2/admin/enterprise/config/reset', [])->assertStatus(200);

        $this->assertNull($this->setting('general.admin_approval'));
    }

    // ── updateFeatureFlag ────────────────────────────────────────────────

    public function test_admin_cannot_toggle_two_factor_or_passkey_features(): void
    {
        $features = $this->features();
        $features['two_factor_authentication'] = true;
        $features['biometric_login'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        Sanctum::actingAs($this->admin());

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'two_factor_authentication', 'value' => false, 'type' => 'feature',
        ])->assertStatus(403);
        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'biometric_login', 'value' => false, 'type' => 'feature', 'confirm_disable' => true,
        ])->assertStatus(403);

        $after = $this->features();
        $this->assertTrue($after['two_factor_authentication']);
        $this->assertTrue($after['biometric_login']);
    }

    public function test_super_admin_must_confirm_disabling_passkeys(): void
    {
        $features = $this->features();
        $features['biometric_login'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        Sanctum::actingAs($this->tenantSuperAdmin());

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'biometric_login', 'value' => false, 'type' => 'feature',
        ])->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'PASSKEY_DISABLE_CONFIRMATION_REQUIRED');
        $this->assertTrue($this->features()['biometric_login']);

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'biometric_login', 'value' => false, 'type' => 'feature', 'confirm_disable' => true,
        ])->assertStatus(200);
        $this->assertFalse($this->features()['biometric_login']);
    }

    public function test_unknown_feature_or_module_keys_are_rejected(): void
    {
        Sanctum::actingAs($this->admin());

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'f054_unknown_feature', 'value' => true, 'type' => 'feature',
        ])->assertStatus(422);
        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'f054_unknown_module', 'value' => true, 'type' => 'module',
        ])->assertStatus(422);

        $this->assertArrayNotHasKey('f054_unknown_feature', $this->features());
    }

    public function test_admin_can_still_toggle_ordinary_features_and_modules(): void
    {
        Sanctum::actingAs($this->admin());

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'events', 'value' => false, 'type' => 'feature',
        ])->assertStatus(200);
        $this->assertFalse($this->features()['events']);

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'wallet', 'value' => false, 'type' => 'module',
        ])->assertStatus(200);
        $this->assertFalse($this->configuration()['modules']['wallet']);
    }
}
