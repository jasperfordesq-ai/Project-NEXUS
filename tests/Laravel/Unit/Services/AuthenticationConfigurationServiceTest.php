<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\AuthenticationConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\Laravel\TestCase;

class AuthenticationConfigurationServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', array_keys(AuthenticationConfigurationService::DEFAULTS))
            ->delete();
        AuthenticationConfigurationService::clearCache($this->testTenantId);
    }

    protected function tearDown(): void
    {
        AuthenticationConfigurationService::clearCache($this->testTenantId);
        parent::tearDown();
    }

    public function test_defaults_are_lockout_safe_and_typed(): void
    {
        $this->assertSame([
            'two_factor.require_members' => false,
            'two_factor.allow_trusted_devices' => true,
            'two_factor.trusted_device_days' => 30,
            'two_factor.backup_code_count' => 10,
            'passkeys.conditional_autofill' => true,
            'passkeys.enrollment_enabled' => true,
            'passkeys.max_credentials_per_user' => 10,
        ], AuthenticationConfigurationService::DEFAULTS);

        $this->assertSame(
            AuthenticationConfigurationService::DEFAULTS,
            AuthenticationConfigurationService::getAll()
        );
    }

    public function test_set_persists_tenant_scoped_typed_values(): void
    {
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
            false
        );
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS,
            45
        );
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL,
            false
        );
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED,
            false
        );
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS,
            12
        );

        $config = AuthenticationConfigurationService::getAll();
        $this->assertFalse($config[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES]);
        $this->assertSame(45, $config[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS]);
        $this->assertFalse($config[AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL]);
        $this->assertFalse($config[AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED]);
        $this->assertSame(12, $config[AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS]);

        $rows = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', [
                AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
                AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS,
                AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL,
                AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED,
                AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS,
            ])
            ->pluck('setting_type', 'setting_key');

        $this->assertSame('boolean', $rows[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES]);
        $this->assertSame('integer', $rows[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS]);
        $this->assertSame('boolean', $rows[AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL]);
        $this->assertSame('boolean', $rows[AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED]);
        $this->assertSame('integer', $rows[AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS]);
    }

    public function test_set_rejects_unknown_keys(): void
    {
        $this->expectException(InvalidArgumentException::class);

        AuthenticationConfigurationService::set('authentication.unrecognized', true);
    }

    public function test_set_rejects_invalid_types_and_ranges(): void
    {
        $this->assertFalse(AuthenticationConfigurationService::isValidValue(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
            1
        ));
        $this->assertFalse(AuthenticationConfigurationService::isValidValue(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS,
            0
        ));
        $this->assertFalse(AuthenticationConfigurationService::isValidValue(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_BACKUP_CODE_COUNT,
            '10'
        ));
        $this->assertFalse(AuthenticationConfigurationService::isValidValue(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL,
            'true'
        ));
        $this->assertFalse(AuthenticationConfigurationService::isValidValue(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED,
            1
        ));
        $this->assertFalse(AuthenticationConfigurationService::isValidValue(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS,
            21
        ));
    }

    public function test_set_preserves_creation_metadata_and_records_the_latest_actor(): void
    {
        $key = AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL;
        AuthenticationConfigurationService::set($key, true, $this->testTenantId, 101);

        $createdAt = now()->subYear()->startOfSecond();
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', $key)
            ->update(['created_at' => $createdAt]);

        AuthenticationConfigurationService::set($key, false, $this->testTenantId, 202);

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', $key)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame($createdAt->format('Y-m-d H:i:s'), (string) $row->created_at);
        $this->assertSame(101, (int) $row->created_by);
        $this->assertSame(202, (int) $row->updated_by);
    }
}
