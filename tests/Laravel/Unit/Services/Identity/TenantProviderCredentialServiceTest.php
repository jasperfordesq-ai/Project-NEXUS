<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Identity;

use Tests\Laravel\TestCase;
use App\Services\Identity\TenantProviderCredentialService;
use Illuminate\Support\Facades\DB;

class TenantProviderCredentialServiceTest extends TestCase
{
    public function test_get_returns_null_when_no_credentials(): void
    {
        DB::shouldReceive('statement')->andReturnSelf();
        DB::shouldReceive('fetch')->andReturn(false);

        $this->assertNull(TenantProviderCredentialService::get(2, 'stripe_identity'));
    }

    public function test_get_returns_null_on_error(): void
    {
        DB::shouldReceive('statement')->andThrow(new \Exception('table missing'));

        $this->assertNull(TenantProviderCredentialService::get(2, 'stripe_identity'));
    }

    public function test_save_returns_false_for_empty_credentials(): void
    {
        $this->assertFalse(TenantProviderCredentialService::save(2, 'stripe_identity', []));
    }

    public function test_save_returns_false_for_all_null_credentials(): void
    {
        $this->assertFalse(TenantProviderCredentialService::save(2, 'stripe_identity', ['api_key' => null, 'secret' => '']));
    }

    public function test_hasCredentials_returns_false_when_none(): void
    {
        DB::shouldReceive('statement')->andReturnSelf();
        DB::shouldReceive('fetch')->andReturn(false);

        $this->assertFalse(TenantProviderCredentialService::hasCredentials(2, 'veriff'));
    }

    public function test_hasCredentials_returns_false_on_error(): void
    {
        DB::shouldReceive('statement')->andThrow(new \Exception('fail'));

        $this->assertFalse(TenantProviderCredentialService::hasCredentials(2, 'veriff'));
    }

    public function test_listConfigured_returns_empty_on_error(): void
    {
        DB::shouldReceive('statement')->andThrow(new \Exception('fail'));

        $result = TenantProviderCredentialService::listConfigured(2);
        $this->assertEmpty($result);
    }

    public function test_getRequiredFields_returns_expected_for_stripe(): void
    {
        $fields = TenantProviderCredentialService::getRequiredFields('stripe_identity');
        $this->assertContains('api_key', $fields);
        $this->assertContains('webhook_secret', $fields);
    }

    public function test_getRequiredFields_returns_api_key_for_unknown(): void
    {
        $fields = TenantProviderCredentialService::getRequiredFields('unknown_provider');
        $this->assertEquals(['api_key'], $fields);
    }

    public function test_delete_returns_false_when_nothing_deleted(): void
    {
        // delete() uses DB::delete(), which returns the affected-row count.
        // (It used DB::statement()->rowCount() until 13 Nov 2026; statement()
        // returns a bool, so that call failed on every real request.)
        DB::shouldReceive('delete')
            ->once()
            ->with(\Mockery::type('string'), [2, 'stripe_identity'])
            ->andReturn(0);

        $this->assertFalse(TenantProviderCredentialService::delete(2, 'stripe_identity'));
    }

    public function test_delete_returns_true_when_a_row_is_deleted(): void
    {
        DB::shouldReceive('delete')
            ->once()
            ->with(\Mockery::type('string'), [2, 'stripe_identity'])
            ->andReturn(1);

        $this->assertTrue(TenantProviderCredentialService::delete(2, 'stripe_identity'));
    }
}
