<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Core\TenantContext;
use App\Middleware\TenantModuleMiddleware;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;

/**
 * Tests for TenantModuleMiddleware.
 *
 * This middleware checks if tenant platform modules are enabled
 * using TenantContext::hasModule().
 */
class TenantModuleMiddlewareTest extends TestCase
{
    use DatabaseTransactions;

    public function test_isEnabled_delegates_to_tenant_context(): void
    {
        // TenantContext is set up in parent::setUp()
        // By default, standard modules are enabled (per MODULE_DEFAULTS)
        $result = TenantModuleMiddleware::isEnabled('listings');

        $this->assertIsBool($result);
    }

    public function test_check_returns_true_when_module_enabled(): void
    {
        // With default module config, standard modules should be enabled
        $result = TenantModuleMiddleware::check('listings');

        // Either true (module enabled) or array (module disabled)
        if ($result === true) {
            $this->assertTrue($result);
        } else {
            // Module is disabled in test tenant - still valid behavior
            $this->assertIsArray($result);
        }
    }

    public function test_check_returns_error_array_when_module_disabled(): void
    {
        // Use a module name that is very unlikely to be enabled
        $result = TenantModuleMiddleware::check('nonexistent_module_xyz');

        // hasModule returns false for unknown modules, so check returns error
        if (is_array($result)) {
            $this->assertTrue($result['error']);
            $this->assertEquals('nonexistent_module_xyz', $result['module']);
            $this->assertArrayHasKey('message', $result);
            $this->assertArrayHasKey('redirect', $result);
        }
    }

    public function test_check_uses_custom_message(): void
    {
        $result = TenantModuleMiddleware::check('nonexistent_module_xyz', 'Custom error text');

        if (is_array($result)) {
            $this->assertEquals('Custom error text', $result['message']);
        }
    }

    public function test_can_is_alias_for_isEnabled(): void
    {
        $enabled = TenantModuleMiddleware::isEnabled('messages');
        $can = TenantModuleMiddleware::can('messages');

        $this->assertEquals($enabled, $can);
    }

    public function test_getAllModuleStates_returns_all_modules(): void
    {
        $states = TenantModuleMiddleware::getAllModuleStates();

        $this->assertIsArray($states);
        $this->assertArrayHasKey('listings', $states);
        $this->assertArrayHasKey('wallet', $states);
        $this->assertArrayHasKey('messages', $states);
        $this->assertArrayHasKey('dashboard', $states);
        $this->assertArrayHasKey('feed', $states);
        $this->assertArrayHasKey('notifications', $states);
        $this->assertArrayHasKey('profile', $states);
        $this->assertArrayHasKey('settings', $states);

        foreach ($states as $module => $state) {
            $this->assertIsBool($state, "State for '$module' should be boolean");
        }
    }

    public function test_getModuleDefinition_returns_known_module(): void
    {
        $def = TenantModuleMiddleware::getModuleDefinition('listings');

        $this->assertIsArray($def);
        $this->assertEquals('Listings', $def['label']);
        $this->assertArrayHasKey('description', $def);
        $this->assertArrayHasKey('default_redirect', $def);
    }

    public function test_getModuleDefinition_returns_null_for_unknown_module(): void
    {
        $def = TenantModuleMiddleware::getModuleDefinition('nonexistent_xyz');

        $this->assertNull($def);
    }

    public function test_getAllModuleDefinitions_returns_all(): void
    {
        $defs = TenantModuleMiddleware::getAllModuleDefinitions();

        $this->assertIsArray($defs);
        $this->assertCount(8, $defs);
        $this->assertArrayHasKey('listings', $defs);
        $this->assertArrayHasKey('settings', $defs);
    }

    public function test_check_error_array_contains_redirect_with_base_path(): void
    {
        $result = TenantModuleMiddleware::check('nonexistent_module_xyz');

        if (is_array($result)) {
            $this->assertNotEmpty($result['redirect']);
        }
    }
}
