<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Models\Event;
use App\Services\AuthenticationConfigurationService;
use App\Services\PrerenderContentInvalidator;
use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminConfigController.
 *
 * Covers config, features, modules, cache, jobs, settings, AI, feed algorithm,
 * algorithm config/health, images, SEO, languages, native app, cron jobs.
 */
class AdminConfigControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        AuthenticationConfigurationService::clearCache($this->testTenantId);
        parent::tearDown();
    }

    // ================================================================
    // GET CONFIG — GET /v2/admin/config
    // ================================================================

    public function test_get_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_config_reports_passkey_disable_impact(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $passwordUser = User::factory()->forTenant($this->testTenantId)->create();
        $passkeyOnlyUser = User::factory()->forTenant($this->testTenantId)->create([
            'password_hash' => null,
            'password' => null,
        ]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        foreach ([$passwordUser, $passkeyOnlyUser] as $index => $user) {
            DB::table('webauthn_credentials')->insert([
                'user_id' => $user->id,
                'tenant_id' => $this->testTenantId,
                'credential_id' => str_repeat($index === 0 ? 'A' : 'B', 43),
                'user_handle' => str_repeat($index === 0 ? 'C' : 'D', 43),
                'public_key' => 'test-public-key',
                'created_at' => now(),
            ]);
        }

        $this->apiGet('/v2/admin/config')
            ->assertOk()
            ->assertJsonPath('data.security_impact.biometric_login.credential_count', 2)
            ->assertJsonPath('data.security_impact.biometric_login.registered_users', 2)
            ->assertJsonPath('data.security_impact.biometric_login.passkey_only_users', 1);
    }

    public function test_get_config_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/config');

        $response->assertStatus(403);
    }

    public function test_get_config_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/config');

        $response->assertStatus(401);
    }

    public function test_events_configuration_is_tenant_scoped_versioned_and_audited(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['branding' => ['theme' => 'preserved']]),
        ]);

        $this->apiGet('/v2/admin/config/events')
            ->assertOk()
            ->assertJsonPath('data.version', 0)
            ->assertJsonPath('data.config.creation_role', 'members')
            ->assertJsonPath('data.config.waitlist_enabled', true)
            ->assertJsonStructure(['data' => ['capabilities' => ['recurrence_v2', 'notification_delivery', 'safety']]]);

        $this->apiPut('/v2/admin/config/events', [
            'version' => 0,
            'reason' => 'Require staff ownership for the pilot.',
            'settings' => [
                'creation_role' => 'staff',
                'default_capacity' => 75,
                'waitlist_enabled' => false,
            ],
        ])->assertOk()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.config.creation_role', 'staff')
            ->assertJsonPath('data.config.default_capacity', 75)
            ->assertJsonPath('data.config.waitlist_enabled', false);

        $stored = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true);
        self::assertSame('preserved', $stored['branding']['theme']);
        self::assertSame(1, $stored['events']['config_version']);
        self::assertSame('staff', $stored['events']['creation_role']);

        $audit = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'events_configuration_updated')
            ->latest('id')
            ->first();
        self::assertNotNull($audit);
        self::assertSame($admin->id, (int) $audit->user_id);
    }

    public function test_events_configuration_rejects_stale_or_unauthorized_updates(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);
        $this->apiGet('/v2/admin/config/events')->assertForbidden();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['events' => ['config_version' => 3]]),
        ]);

        $this->apiPut('/v2/admin/config/events', [
            'version' => 2,
            'reason' => 'Stale browser tab.',
            'settings' => ['waitlist_enabled' => false],
        ])->assertUnprocessable();
    }

    public function test_events_configuration_rejects_unsafe_dependencies(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/config/events', [
            'version' => 0,
            'reason' => 'Invalid waitlist combination.',
            'settings' => [
                'waitlist_enabled' => false,
                'timed_waitlist_offers_enabled' => true,
            ],
        ])->assertUnprocessable();
    }

    public function test_events_restore_removes_only_event_overrides_and_exposes_audit_history(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode([
                'branding' => ['theme' => 'preserved'],
                'events' => [
                    'config_version' => 4,
                    'creation_role' => 'admins',
                    'default_capacity' => 80,
                ],
            ]),
        ]);

        $this->apiPost('/v2/admin/config/events/restore-defaults', [
            'version' => 4,
            'reason' => 'Restore creation policy only.',
            'keys' => ['creation_role'],
        ])->assertOk()
            ->assertJsonPath('data.version', 5)
            ->assertJsonPath('data.config.creation_role', 'members')
            ->assertJsonPath('data.config.default_capacity', 80);

        $stored = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true);
        self::assertSame('preserved', $stored['branding']['theme']);
        self::assertArrayNotHasKey('creation_role', $stored['events']);
        self::assertSame(80, $stored['events']['default_capacity']);
        self::assertSame(5, $stored['events']['config_version']);

        $this->apiPost('/v2/admin/config/events/restore-defaults', [
            'version' => 5,
            'reason' => 'Return all remaining settings to inherited policy.',
        ])->assertOk()
            ->assertJsonPath('data.version', 6)
            ->assertJsonPath('data.config.default_capacity', 0);

        $this->apiGet('/v2/admin/config/events/audit-log')
            ->assertOk()
            ->assertJsonPath('data.0.action', 'events_configuration_defaults_restored')
            ->assertJsonPath('data.0.actor_id', $admin->id)
            ->assertJsonPath('data.0.reason', 'Return all remaining settings to inherited policy.')
            ->assertJsonPath('data.0.version', 6);

        $this->apiPost('/v2/admin/config/events/restore-defaults', [
            'version' => 6,
            'reason' => 'Idempotent repeat.',
        ])->assertOk()->assertJsonPath('data.version', 6);
    }

    public function test_events_configuration_requires_server_side_confirmation_for_live_impact(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Event::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $admin->id,
            'federated_visibility' => 'listed',
        ]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $payload = [
            'version' => 0,
            'reason' => 'Pause federation sharing.',
            'settings' => ['federation_sharing_enabled' => false],
        ];
        $this->apiPut('/v2/admin/config/events', $payload)
            ->assertUnprocessable();

        $this->apiPut('/v2/admin/config/events', [
            ...$payload,
            'confirm_disruptive' => true,
        ])->assertOk()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.config.federation_sharing_enabled', false)
            ->assertJsonPath('data.impact.shared_events', 0);
        self::assertSame('none', Event::withoutGlobalScopes()->where('tenant_id', $this->testTenantId)->value('federated_visibility'));
    }

    public function test_bulk_volunteering_config_rejects_missing_settings_with_translated_error(): void
    {
        // VOL-BE-010: the missing-settings validation message must be translated,
        // not a hardcoded English literal.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiPut('/v2/admin/config/volunteering/bulk', []);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.message', __('api.missing_required_field', ['field' => 'settings']));
        $this->assertStringNotContainsString('Settings array is required', $response->getContent());
    }

    public function test_group_config_validation_errors_are_translated(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $missingKey = $this->apiPut('/v2/admin/config/groups', ['value' => true]);
        $missingKey->assertStatus(422);
        $missingKey->assertJsonPath('errors.0.message', __('api.group_config_key_required'));

        $unknownKey = $this->apiPut('/v2/admin/config/groups', [
            'key' => 'not_a_supported_groups_setting',
            'value' => true,
        ]);
        $unknownKey->assertStatus(422);
        $unknownKey->assertJsonPath(
            'errors.0.message',
            __('api.group_config_key_invalid', ['key' => 'not_a_supported_groups_setting']),
        );

        $missingValue = $this->apiPut('/v2/admin/config/groups', [
            'key' => 'allow_private_groups',
        ]);
        $missingValue->assertStatus(422);
        $missingValue->assertJsonPath('errors.0.message', __('api.group_config_value_required'));

        $missingSettings = $this->apiPut('/v2/admin/config/groups/bulk', []);
        $missingSettings->assertStatus(422);
        $missingSettings->assertJsonPath('errors.0.message', __('api.group_config_settings_required'));
    }

    // ================================================================
    // AUTHENTICATION CONFIG — /v2/admin/config/authentication
    // ================================================================

    public function test_authentication_config_returns_safe_defaults_for_super_admin(): void
    {
        $this->resetAuthenticationConfig();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/authentication');

        $response->assertStatus(200);
        $response->assertJsonPath('data.config', AuthenticationConfigurationService::DEFAULTS);
        $response->assertJsonPath('data.defaults', AuthenticationConfigurationService::DEFAULTS);
    }

    public function test_ordinary_admins_can_read_policy_but_cannot_change_passkey_controls(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiGet('/v2/admin/config/authentication')->assertOk()->assertJsonPath('data.writable_keys', ['two_factor.require_members']);
        $this->apiPut('/v2/admin/config/authentication/bulk', [
            'settings' => [
                AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL => false,
            ],
        ])->assertStatus(403);
    }

    public function test_authentication_config_bulk_update_persists_typed_values_and_clears_public_caches(): void
    {
        $this->resetAuthenticationConfig();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->mock(RedisCache::class, function ($mock): void {
            $mock->shouldReceive('delete')
                ->once()
                ->with('tenant_bootstrap', $this->testTenantId)
                ->andReturn(true);
            $mock->shouldReceive('delete')
                ->once()
                ->with('tenants_list_public')
                ->andReturn(true);
            $mock->shouldReceive('delete')
                ->once()
                ->with('tenants_list_public_all')
                ->andReturn(true);
        });

        $settings = [
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS => 45,
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_BACKUP_CODE_COUNT => 12,
            AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL => false,
        ];

        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => $settings])
            ->assertStatus(200)
            ->assertJsonPath('data.updated', $settings);

        $rows = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', array_keys($settings))
            ->pluck('setting_type', 'setting_key');

        $this->assertSame('integer', $rows[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS]);
        $this->assertSame('integer', $rows[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_BACKUP_CODE_COUNT]);
        $this->assertSame('boolean', $rows[AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL]);
        $this->assertSame(
            array_merge(AuthenticationConfigurationService::DEFAULTS, $settings),
            AuthenticationConfigurationService::getAll()
        );
    }

    public function test_authentication_config_bulk_update_validates_every_key_before_mutating(): void
    {
        $this->resetAuthenticationConfig();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/config/authentication/bulk', [
            'settings' => [
                AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS => 60,
                'passkeys.unrecognized_policy' => true,
            ],
        ])->assertStatus(422);

        $this->assertFalse(DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS)
            ->exists());

        $this->apiPut('/v2/admin/config/authentication/bulk', [
            'settings' => [
                AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS => '60',
            ],
        ])->assertStatus(422);
    }

    public function test_disabling_trusted_devices_revokes_only_active_devices_for_current_tenant(): void
    {
        $this->resetAuthenticationConfig();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $otherTenantId = $this->testTenantId === 1 ? 999999 : 1;

        DB::table('user_trusted_devices')->insert([
            [
                'user_id' => $admin->id,
                'tenant_id' => $this->testTenantId,
                'device_token_hash' => hash('sha256', 'active-current-' . $admin->id),
                'ip_address' => '203.0.113.10',
                'trusted_at' => now(),
                'expires_at' => now()->addDays(30),
                'is_revoked' => 0,
                'revoked_at' => null,
                'revoked_reason' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => $admin->id,
                'tenant_id' => $this->testTenantId,
                'device_token_hash' => hash('sha256', 'revoked-current-' . $admin->id),
                'ip_address' => '203.0.113.11',
                'trusted_at' => now(),
                'expires_at' => now()->addDays(30),
                'is_revoked' => 1,
                'revoked_at' => now()->subDay(),
                'revoked_reason' => 'user_action',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => $admin->id,
                'tenant_id' => $otherTenantId,
                'device_token_hash' => hash('sha256', 'active-other-' . $admin->id),
                'ip_address' => '203.0.113.12',
                'trusted_at' => now(),
                'expires_at' => now()->addDays(30),
                'is_revoked' => 0,
                'revoked_at' => null,
                'revoked_reason' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $this->apiPut('/v2/admin/config/authentication/bulk', [
            'settings' => [
                AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES => false,
            ],
        ])->assertStatus(200);

        $currentRows = DB::table('user_trusted_devices')
            ->where('user_id', $admin->id)
            ->where('tenant_id', $this->testTenantId)
            ->orderBy('id')
            ->get();
        $this->assertSame(1, (int) $currentRows[0]->is_revoked);
        $this->assertSame('tenant_policy_disabled', $currentRows[0]->revoked_reason);
        $this->assertNotNull($currentRows[0]->revoked_at);
        $this->assertSame('user_action', $currentRows[1]->revoked_reason);
        $this->assertSame(
            0,
            (int) DB::table('user_trusted_devices')
                ->where('user_id', $admin->id)
                ->where('tenant_id', $otherTenantId)
                ->where('device_token_hash', hash('sha256', 'active-other-' . $admin->id))
                ->value('is_revoked')
        );
    }

    // ================================================================
    // CACHE STATS — GET /v2/admin/cache/stats
    // ================================================================

    public function test_cache_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/cache/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_cache_stats_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/cache/stats');

        $response->assertStatus(403);
    }

    // ================================================================
    // CLEAR CACHE — POST /v2/admin/cache/clear
    // ================================================================

    public function test_clear_cache_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiPost('/v2/admin/cache/clear');

        $response->assertStatus(200);
    }

    public function test_clear_cache_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/cache/clear');

        $response->assertStatus(403);
    }

    // ================================================================
    // SETTINGS — GET /v2/admin/settings
    // ================================================================

    public function test_get_settings_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/settings');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_settings_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/settings');

        $response->assertStatus(403);
    }

    public function test_settings_validate_every_field_before_mutating_tenant_routing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $originalSlug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');

        $this->apiPut('/v2/admin/settings', [
            'slug' => 'should-not-persist',
            'welcome_credits' => 101,
        ])->assertStatus(422);

        $this->assertSame(
            $originalSlug,
            (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug')
        );
    }

    public function test_settings_reject_reserved_tenant_slug(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/settings', ['slug' => 'about'])
            ->assertStatus(422);
    }

    public function test_routing_setting_schedules_authoritative_prerender_refresh(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshAllOrFail')->once()->andReturn(987);
        });

        $slug = 'config-route-' . $this->testTenantId;
        $this->apiPut('/v2/admin/settings', ['slug' => $slug])
            ->assertStatus(200);

        $this->assertSame($slug, DB::table('tenants')->where('id', $this->testTenantId)->value('slug'));
    }

    public function test_tenant_admin_cannot_change_tenant_routing_identity(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/settings', ['domain' => 'tenant-admin.example'])
            ->assertStatus(403);
    }

    public function test_platform_service_host_cannot_be_claimed_as_tenant_domain(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/settings', ['domain' => 'api.project-nexus.ie'])
            ->assertStatus(422);
    }

    public function test_domain_change_reports_passkey_rp_impact_and_preserves_the_current_domain(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'is_super_admin' => true,
        ]);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'current-passkey.example.test',
        ]);
        DB::table('webauthn_credentials')->insert([
            'user_id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => str_repeat('R', 43),
            'user_handle' => str_repeat('H', 43),
            'public_key' => 'test-public-key',
            'rp_id' => 'current-passkey.example.test',
            'registration_origin' => 'https://current-passkey.example.test',
            'created_at' => now(),
        ]);

        $this->apiPut('/v2/admin/settings', [
            'domain' => 'replacement.example.test',
        ])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'PASSKEY_RP_CHANGE_BLOCKED')
            ->assertJsonPath('meta.security_impact.credential_count', 1)
            ->assertJsonPath('meta.security_impact.registered_users', 1);

        $this->assertSame(
            'current-passkey.example.test',
            DB::table('tenants')->where('id', $this->testTenantId)->value('domain')
        );
    }

    public function test_render_affecting_setting_schedules_tenant_prerender_refresh(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')
                ->once()
                ->with($this->testTenantId, true)
                ->andReturn(988);
        });

        $this->apiPut('/v2/admin/settings', ['tagline' => 'Fresh tenant tagline'])
            ->assertStatus(200);
    }

    public function test_settings_roll_back_when_durable_prerender_intent_cannot_be_written(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $original = DB::table('tenants')->where('id', $this->testTenantId)->value('tagline');
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')
                ->once()
                ->andThrow(new \RuntimeException('queue unavailable'));
        });

        $this->apiPut('/v2/admin/settings', ['tagline' => 'Must roll back'])
            ->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'PRERENDER_REFRESH_FAILED');

        $this->assertSame(
            $original,
            DB::table('tenants')->where('id', $this->testTenantId)->value('tagline')
        );
    }

    public function test_landing_page_config_rolls_back_when_rebuild_intent_fails(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'landing_page.config'],
            ['setting_value' => json_encode(['sections' => []]), 'setting_type' => 'json']
        );
        $original = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'landing_page.config')
            ->value('setting_value');

        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')
                ->once()
                ->with($this->testTenantId, true)
                ->andThrow(new \RuntimeException('queue unavailable'));
        });

        $this->apiPut('/v2/admin/config/landing-page', [
            'config' => [
                'sections' => [[
                    'id' => 'hero',
                    'type' => 'hero',
                    'enabled' => true,
                    'order' => 0,
                ]],
            ],
        ])->assertStatus(503);

        $this->assertSame(
            $original,
            DB::table('tenant_settings')
                ->where('tenant_id', $this->testTenantId)
                ->where('setting_key', 'landing_page.config')
                ->value('setting_value')
        );
    }

    public function test_feature_toggle_rolls_back_when_rebuild_intent_fails(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $original = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')
                ->once()
                ->with($this->testTenantId, true, true)
                ->andThrow(new \RuntimeException('queue unavailable'));
        });

        $this->apiPut('/v2/admin/config/features', [
            'feature' => 'events',
            'enabled' => false,
        ])->assertStatus(503);

        $this->assertSame($original, DB::table('tenants')->where('id', $this->testTenantId)->value('features'));
    }

    // ================================================================
    // BACKGROUND JOBS — GET /v2/admin/background-jobs
    // ================================================================

    public function test_get_jobs_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/background-jobs');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['*' => ['id', 'translation_key', 'status']]]);
        $this->assertSame('digest_emails', $response->json('data.0.translation_key'));
        $this->assertArrayNotHasKey('name', $response->json('data.0'));
    }

    // ================================================================
    // AI CONFIG — GET /v2/admin/config/ai
    // ================================================================

    public function test_get_ai_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/ai');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_ai_config_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/config/ai');

        $response->assertStatus(403);
    }

    // ================================================================
    // FEED ALGORITHM — GET /v2/admin/config/feed-algorithm
    // ================================================================

    public function test_get_feed_algorithm_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/feed-algorithm');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // ALGORITHM CONFIG — GET /v2/admin/config/algorithms
    // ================================================================

    public function test_get_algorithm_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/algorithms');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // ALGORITHM HEALTH — GET /v2/admin/config/algorithm-health
    // ================================================================

    public function test_get_algorithm_health_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/algorithm-health');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // IMAGE CONFIG — GET /v2/admin/config/images
    // ================================================================

    public function test_get_image_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/images');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // SEO CONFIG — GET /v2/admin/config/seo
    // ================================================================

    public function test_get_seo_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/seo');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // LANGUAGE CONFIG — GET /v2/admin/config/languages
    // ================================================================

    public function test_get_language_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/languages');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // NATIVE APP CONFIG — GET /v2/admin/config/native-app
    // ================================================================

    public function test_get_native_app_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/config/native-app');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_native_app_config_tracks_tenant_branded_store_readiness(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $update = $this->apiPut('/v2/admin/config/native-app', [
            'native_app_name' => 'KISS Musterstadt',
            'native_app_short_name' => 'KISS',
            'native_app_bundle_id' => 'ch.kiss.musterstadt',
            'native_app_package_name' => 'ch.kiss.musterstadt',
            'native_app_push_enabled' => true,
            'native_app_store_mode' => 'tenant_branded',
            'native_app_build_profile' => 'production',
            'native_app_ios_app_store_id' => '1234567890',
            'native_app_android_play_store_id' => 'ch.kiss.musterstadt',
            'native_app_marketing_url' => 'https://example.test/app',
            'native_app_privacy_url' => 'https://example.test/privacy',
            'native_app_support_url' => 'https://example.test/support',
            'native_app_push_sender_id' => 'kiss-musterstadt',
            'native_app_tenant_channel_prefix' => 'tenant-2-kiss',
        ]);

        $update->assertStatus(200);
        $update->assertJsonPath('data.updated', true);

        $response = $this->apiGet('/v2/admin/config/native-app');

        $response->assertStatus(200);
        $response->assertJsonPath('data.native_app.native_app_store_mode', 'tenant_branded');
        $response->assertJsonPath('data.deployment_readiness.has_ios_identity', true);
        $response->assertJsonPath('data.deployment_readiness.has_android_identity', true);
        $response->assertJsonPath('data.deployment_readiness.has_store_metadata', true);
        $response->assertJsonPath('data.deployment_readiness.push_routing_configured', true);
        $response->assertJsonPath('data.deployment_readiness.tenant_branded_ready', true);

        $manifest = $this->apiGet('/v2/admin/config/native-app/build-manifest');

        $manifest->assertStatus(200);
        $manifest->assertJsonPath('data.manifest_version', 'native-app-build-manifest-v1');
        $manifest->assertJsonPath('data.app.name', 'KISS Musterstadt');
        $manifest->assertJsonPath('data.app.bundle_id', 'ch.kiss.musterstadt');
        $manifest->assertJsonPath('data.store.mode', 'tenant_branded');
        $manifest->assertJsonPath('data.push.enabled', true);
        $manifest->assertJsonPath('data.deployment_readiness.tenant_branded_ready', true);
    }

    public function test_native_app_tenant_branded_readiness_lists_missing_requirements(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $update = $this->apiPut('/v2/admin/config/native-app', [
            'native_app_store_mode' => 'tenant_branded',
            'native_app_name' => 'KISS Musterstadt',
            'native_app_bundle_id' => '',
            'native_app_package_name' => '',
            'native_app_ios_app_store_id' => '',
            'native_app_android_play_store_id' => '',
            'native_app_marketing_url' => '',
            'native_app_privacy_url' => '',
            'native_app_support_url' => '',
            'native_app_push_enabled' => false,
            'native_app_push_sender_id' => '',
            'native_app_tenant_channel_prefix' => '',
        ]);

        $update->assertStatus(200);

        $response = $this->apiGet('/v2/admin/config/native-app');

        $response->assertStatus(200);
        $response->assertJsonPath('data.deployment_readiness.tenant_branded_ready', false);
        $response->assertJsonPath('data.deployment_readiness.missing_requirements', [
            'ios_identity',
            'android_identity',
            'store_metadata',
            'push_routing',
        ]);

        $manifest = $this->apiGet('/v2/admin/config/native-app/build-manifest');

        $manifest->assertStatus(200);
        $manifest->assertJsonPath('data.deployment_readiness.missing_requirements', [
            'ios_identity',
            'android_identity',
            'store_metadata',
            'push_routing',
        ]);
    }

    // ================================================================
    // CRON JOBS — GET /v2/admin/system/cron-jobs
    // ================================================================

    public function test_get_cron_jobs_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiGet('/v2/admin/system/cron-jobs');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['*' => [
            'id', 'slug', 'translation_key', 'command', 'schedule', 'status', 'category',
        ]]]);
        $this->assertSame('run_all', $response->json('data.0.translation_key'));
        $this->assertArrayNotHasKey('name', $response->json('data.0'));
        $this->assertArrayNotHasKey('description', $response->json('data.0'));
    }

    public function test_get_cron_jobs_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/system/cron-jobs');

        $response->assertStatus(401);
    }

    // ================================================================
    // UPDATE FEATURES — PUT /v2/admin/config/features
    // ================================================================

    public function test_update_feature_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiPut('/v2/admin/config/features', [
            'feature' => 'events',
            'enabled' => true,
        ]);

        $response->assertStatus(200);
    }

    public function test_update_feature_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPut('/v2/admin/config/features', [
            'feature' => 'events',
            'enabled' => true,
        ]);

        $response->assertStatus(403);
    }

    public function test_authentication_feature_switches_reject_ordinary_admins(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $original = DB::table('tenants')->where('id', $this->testTenantId)->value('features');

        foreach (['two_factor_authentication', 'biometric_login'] as $feature) {
            $this->apiPut('/v2/admin/config/features', [
                'feature' => $feature,
                'enabled' => false,
            ])->assertStatus(403);
        }

        $this->assertSame(
            $original,
            DB::table('tenants')->where('id', $this->testTenantId)->value('features')
        );
    }

    public function test_super_admin_can_update_authentication_feature_switches(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        foreach (['two_factor_authentication', 'biometric_login'] as $feature) {
            $this->apiPut('/v2/admin/config/features', [
                'feature' => $feature,
                'enabled' => false,
                ...($feature === 'biometric_login' ? ['confirm_disable' => true] : []),
            ])->assertStatus(200);
        }

        $features = json_decode((string) DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->value('features'), true);
        $this->assertFalse($features['two_factor_authentication']);
        $this->assertFalse($features['biometric_login']);
    }

    public function test_super_admin_must_explicitly_confirm_disabling_passkey_authentication(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/config/features', [
            'feature' => 'biometric_login',
            'enabled' => false,
        ])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'PASSKEY_DISABLE_CONFIRMATION_REQUIRED');

        $features = json_decode((string) DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->value('features'), true);
        $this->assertNotFalse($features['biometric_login'] ?? true);
    }

    private function resetAuthenticationConfig(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', array_keys(AuthenticationConfigurationService::DEFAULTS))
            ->delete();
        AuthenticationConfigurationService::clearCache($this->testTenantId);
    }
}
