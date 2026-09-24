<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Services\Identity\IdentityProviderRegistry;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * E-035 O-059 — the mock identity provider (whose webhook signature check
 * always passes) must not be registered on a shared server such as staging
 * unless ALLOW_MOCK_IDENTITY_PROVIDER is explicitly true.
 */
final class MockIdentityProviderEnvironmentTest extends TestCase
{
    use DatabaseTransactions;

    private string $originalEnv;

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalEnv = (string) $this->app['env'];
    }

    protected function tearDown(): void
    {
        $this->app['env'] = $this->originalEnv;
        $this->setFlag(null);
        IdentityProviderRegistry::reset();
        parent::tearDown();
    }

    private function setFlag(?string $value): void
    {
        if ($value === null) {
            unset($_ENV['ALLOW_MOCK_IDENTITY_PROVIDER'], $_SERVER['ALLOW_MOCK_IDENTITY_PROVIDER']);
            putenv('ALLOW_MOCK_IDENTITY_PROVIDER');
            return;
        }
        $_ENV['ALLOW_MOCK_IDENTITY_PROVIDER'] = $value;
        $_SERVER['ALLOW_MOCK_IDENTITY_PROVIDER'] = $value;
        putenv('ALLOW_MOCK_IDENTITY_PROVIDER=' . $value);
    }

    private function inEnvironment(string $env): bool
    {
        $this->app['env'] = $env;
        IdentityProviderRegistry::reset();

        return IdentityProviderRegistry::mockProviderAllowed();
    }

    public function test_mock_is_not_registered_on_staging_without_the_flag(): void
    {
        $this->setFlag(null);

        $this->assertFalse($this->inEnvironment('staging'));
        $this->assertFalse(IdentityProviderRegistry::has('mock'));
    }

    public function test_flag_set_to_false_keeps_the_mock_off(): void
    {
        $this->setFlag('false');

        $this->assertFalse($this->inEnvironment('staging'));
    }

    public function test_flag_set_to_true_enables_the_mock_outside_production(): void
    {
        $this->setFlag('true');

        $this->assertTrue($this->inEnvironment('staging'));
    }

    public function test_production_never_gets_the_mock(): void
    {
        $this->setFlag('true');

        $this->assertFalse($this->inEnvironment('production'));
    }

    public function test_developer_and_test_environments_keep_the_mock(): void
    {
        $this->setFlag(null);

        $this->assertTrue($this->inEnvironment('testing'));
        $this->assertTrue($this->inEnvironment('local'));
        $this->assertTrue($this->inEnvironment('development'));
        $this->assertTrue(IdentityProviderRegistry::has('mock'));
    }
}
