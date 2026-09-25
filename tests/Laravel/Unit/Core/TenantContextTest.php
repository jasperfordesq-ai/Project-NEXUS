<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use App\Core\TenantContext;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use App\Models\Tenant;

class TenantContextTest extends TestCase
{
    use DatabaseTransactions;

    public function test_custom_domain_api_can_select_only_its_active_descendants(): void
    {
        $domain = 'browser-api-' . bin2hex(random_bytes(5)) . '.example.test';
        $parent = Tenant::factory()->create(['domain' => $domain, 'is_active' => true]);
        $child = Tenant::factory()->create([
            'domain' => null, 'parent_id' => $parent->id, 'is_active' => true,
        ]);
        $grandchild = Tenant::factory()->create([
            'domain' => null, 'parent_id' => $child->id, 'is_active' => true,
        ]);
        $unrelated = Tenant::factory()->create(['domain' => null, 'is_active' => true]);
        $previous = [
            $_SERVER['HTTP_HOST'] ?? null,
            $_SERVER['REQUEST_URI'] ?? null,
            $_SERVER['HTTP_X_TENANT_ID'] ?? null,
        ];

        try {
            $_SERVER['HTTP_HOST'] = $domain;
            $_SERVER['REQUEST_URI'] = '/api/v2/tenant/bootstrap';
            $_SERVER['HTTP_X_TENANT_ID'] = (string) $child->id;
            TenantContext::reset();
            TenantContext::resolve();
            $this->assertSame((int) $child->id, TenantContext::getId());

            $_SERVER['HTTP_X_TENANT_ID'] = (string) $grandchild->id;
            TenantContext::reset();
            TenantContext::resolve();
            $this->assertSame((int) $grandchild->id, TenantContext::getId());

            $child->update(['is_active' => false]);
            TenantContext::reset();
            TenantContext::resolve();
            $this->assertSame((int) $parent->id, TenantContext::getId());

            $_SERVER['HTTP_X_TENANT_ID'] = (string) $unrelated->id;
            TenantContext::reset();
            TenantContext::resolve();
            $this->assertSame((int) $parent->id, TenantContext::getId());

            unset($_SERVER['HTTP_X_TENANT_ID']);
            TenantContext::reset();
            TenantContext::resolve();
            $this->assertSame((int) $parent->id, TenantContext::getId());
        } finally {
            foreach (['HTTP_HOST', 'REQUEST_URI', 'HTTP_X_TENANT_ID'] as $index => $key) {
                if ($previous[$index] === null) unset($_SERVER[$key]);
                else $_SERVER[$key] = $previous[$index];
            }
            TenantContext::reset();
        }
    }

    // -------------------------------------------------------
    // get() / getId()
    // -------------------------------------------------------

    public function test_get_returns_tenant_array(): void
    {
        $tenant = TenantContext::get();
        $this->assertIsArray($tenant);
        $this->assertArrayHasKey('id', $tenant);
    }

    public function test_getId_returns_integer(): void
    {
        $id = TenantContext::getId();
        $this->assertIsInt($id);
        $this->assertSame($this->testTenantId, $id);
    }

    // -------------------------------------------------------
    // setById()
    // -------------------------------------------------------

    public function test_setById_with_valid_tenant_returns_true(): void
    {
        $this->assertTrue(TenantContext::setById($this->testTenantId));
        $this->assertSame($this->testTenantId, TenantContext::getId());
    }

    public function test_setById_with_invalid_tenant_returns_false(): void
    {
        $this->assertFalse(TenantContext::setById(99999));
    }

    // -------------------------------------------------------
    // getBasePath()
    // -------------------------------------------------------

    public function test_getBasePath_returns_string(): void
    {
        $basePath = TenantContext::getBasePath();
        $this->assertIsString($basePath);
    }

    // -------------------------------------------------------
    // getSlugPrefix()
    // -------------------------------------------------------

    public function test_getSlugPrefix_returns_empty_for_custom_domain_tenant(): void
    {
        // A tenant (id > 1) WITH a custom domain is identified by its domain,
        // so it needs no slug prefix in URLs. Give tenant 2 a domain and assert ''.
        \Illuminate\Support\Facades\DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['domain' => 'custom-domain-test.example']);

        TenantContext::setById($this->testTenantId);
        $prefix = TenantContext::getSlugPrefix();
        $this->assertSame('', $prefix);
    }

    public function test_getSlugPrefix_returns_slug_with_slash_for_tenant_without_domain(): void
    {
        // A tenant WITHOUT a custom domain must carry its slug in URLs.
        // Ensure tenant 2 (slug hour-timebank) has no domain, then assert '/<slug>'.
        \Illuminate\Support\Facades\DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['domain' => null]);

        TenantContext::setById($this->testTenantId);
        $prefix = TenantContext::getSlugPrefix();
        $this->assertSame('/hour-timebank', $prefix);
    }

    // -------------------------------------------------------
    // getSetting()
    // -------------------------------------------------------

    public function test_getSetting_site_name_returns_tenant_name(): void
    {
        $name = TenantContext::getSetting('site_name');
        $this->assertSame('Hour Timebank', $name);
    }

    public function test_getSetting_returns_default_for_unknown_key(): void
    {
        $result = TenantContext::getSetting('totally_unknown_key', 'default_val');
        $this->assertSame('default_val', $result);
    }

    // -------------------------------------------------------
    // hasFeature()
    // -------------------------------------------------------

    public function test_hasFeature_returns_bool(): void
    {
        // With default features, most should be true
        $result = TenantContext::hasFeature('listings');
        $this->assertIsBool($result);
    }

    // -------------------------------------------------------
    // getFrontendUrl()
    // -------------------------------------------------------

    public function test_getFrontendUrl_returns_string(): void
    {
        $url = TenantContext::getFrontendUrl();
        $this->assertIsString($url);
        $this->assertNotEmpty($url);
    }

    // -------------------------------------------------------
    // getDomain()
    // -------------------------------------------------------

    public function test_getDomain_returns_string(): void
    {
        $domain = TenantContext::getDomain();
        $this->assertIsString($domain);
    }

    // -------------------------------------------------------
    // getHeaderTenantId() / getTokenTenantId()
    // -------------------------------------------------------

    public function test_getHeaderTenantId_returns_null_by_default(): void
    {
        // After setById, header tenant ID is not set
        $this->assertNull(TenantContext::getHeaderTenantId());
    }

    public function test_getTokenTenantId_returns_null_by_default(): void
    {
        $this->assertNull(TenantContext::getTokenTenantId());
    }
}
