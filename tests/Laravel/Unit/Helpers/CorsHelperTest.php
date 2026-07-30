<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Helpers;

use App\Helpers\CorsHelper;
use PHPUnit\Framework\TestCase;

class CorsHelperTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $ref = new \ReflectionClass(CorsHelper::class);

        $prop = $ref->getProperty('allowedOrigins');
        $prop->setAccessible(true);
        $prop->setValue(null, null);

        $prop2 = $ref->getProperty('tenantDomainOrigins');
        $prop2->setAccessible(true);
        $prop2->setValue(null, null);

        unset($_SERVER['HTTP_ORIGIN']);
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_ORIGIN']);

        $ref = new \ReflectionClass(CorsHelper::class);
        $prop = $ref->getProperty('allowedOrigins');
        $prop->setAccessible(true);
        $prop->setValue(null, null);

        $prop2 = $ref->getProperty('tenantDomainOrigins');
        $prop2->setAccessible(true);
        $prop2->setValue(null, null);

        parent::tearDown();
    }

    // -------------------------------------------------------
    // isOriginAllowed()
    // -------------------------------------------------------

    public function test_isOriginAllowed_direct_match(): void
    {
        $this->assertTrue(CorsHelper::isOriginAllowed(
            'http://localhost:5173',
            ['http://localhost:5173', 'https://example.com']
        ));
    }

    public function test_isOriginAllowed_rejects_unknown(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'https://evil.com',
            ['https://project-nexus.ie']
        ));
    }

    /**
     * `app` is in the default CORS_ALLOWED_SUBDOMAINS list, so this still passes
     * after the 2026-07-30 hardening — it asserts an allowlisted label matches,
     * not that subdomain matching is unrestricted.
     */
    public function test_isOriginAllowed_subdomain_match(): void
    {
        $this->assertTrue(CorsHelper::isOriginAllowed(
            'https://app.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_isOriginAllowed_rejects_scheme_mismatch(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'http://app.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    /**
     * The regression this class actually shipped. The 2026-04-12 subdomain
     * hardening (9f2b2a00f) landed on App\Core\CorsHelper only, and THIS copy is
     * the one the outermost middleware calls on every API response — so until
     * 2026-07-30 production reflected any subdomain of an allowlisted host back
     * in Access-Control-Allow-Origin, alongside Allow-Credentials: true. Verified
     * against api.project-nexus.ie on 2026-07-30: `https://evil.project-nexus.ie`
     * and `https://a.b.project-nexus.ie` were both echoed.
     *
     * These two cases fail if the hardening is ever reverted or bypassed here.
     */
    public function test_isOriginAllowed_rejects_non_allowlisted_single_label(): void
    {
        $this->assertFalse(
            CorsHelper::isOriginAllowed(
                'https://evil.project-nexus.ie',
                ['https://project-nexus.ie']
            ),
            'A subdomain whose label is absent from CORS_ALLOWED_SUBDOMAINS must not match.'
        );
    }

    public function test_isOriginAllowed_rejects_nested_subdomain(): void
    {
        $this->assertFalse(
            CorsHelper::isOriginAllowed(
                'https://a.b.project-nexus.ie',
                ['https://project-nexus.ie']
            ),
            'Nested sub-subdomains must not match even when the trailing label is allowlisted.'
        );

        // The nastier shape: a nested host whose *leading* label is allowlisted.
        // Rejected because the matched prefix is the whole label set ("app.b"),
        // not just the first label.
        $this->assertFalse(
            CorsHelper::isOriginAllowed(
                'https://app.b.project-nexus.ie',
                ['https://project-nexus.ie']
            ),
            'A nested host starting with an allowlisted label must still be rejected.'
        );
    }

    /**
     * 🔴 The one live origin the hardening could have broken.
     *
     * Tenant 11 is served at uk.timebank.global, it runs the React app, and React
     * calls api.project-nexus.ie — so it genuinely needs a cross-origin grant.
     * Its `uk` label is NOT in CORS_ALLOWED_SUBDOMAINS, so before 2026-07-30 the
     * permissive wildcard was granting it; afterwards the ONLY thing that does is
     * the exact match against tenant custom domains. If that step ever stops
     * covering it, a whole tenant loses API access in the browser.
     *
     * The tenant-domain cache is seeded here with the exact rows production
     * returns (verified 2026-07-30 via `SELECT domain FROM tenants WHERE domain
     * IS NOT NULL AND domain != '' AND is_active = 1`), so the assertion holds
     * without a database and still reflects real data.
     */
    public function test_isOriginAllowed_allows_a_tenant_custom_domain_that_is_a_subdomain(): void
    {
        $this->seedTenantDomainOrigins([
            'https://project-nexus.ie',
            'https://www.project-nexus.ie',
            'https://hour-timebank.ie',
            'https://www.hour-timebank.ie',
            'https://timebank.global',
            'https://www.timebank.global',
            'https://timebanks.us',
            'https://www.timebanks.us',
            'https://uk.timebank.global',
            'https://www.uk.timebank.global',
            'https://pairc-goodman.com',
            'https://www.pairc-goodman.com',
        ]);

        $this->assertTrue(
            CorsHelper::isOriginAllowed('https://uk.timebank.global'),
            'Tenant 11 must keep CORS after the hardening — via the tenant custom '
            . 'domain exact match, since `uk` is not an allowlisted subdomain label.'
        );

        // Tenant domains that are NOT subdomains were already exact-match-only.
        $this->assertTrue(CorsHelper::isOriginAllowed('https://timebanks.us'));
        $this->assertTrue(CorsHelper::isOriginAllowed('https://pairc-goodman.com'));

        // The grant is for that exact host, never its children.
        $this->assertFalse(
            CorsHelper::isOriginAllowed('https://evil.uk.timebank.global'),
            'A tenant custom domain must not confer access to its own subdomains.'
        );
        $this->assertFalse(CorsHelper::isOriginAllowed('https://evil.timebanks.us'));
    }

    /**
     * The accessible (GOV.UK) frontends lose the wildcard grant they had before
     * 2026-07-30. That is intended and harmless: both are server-rendered by the
     * PHP app and their only fetch() targets a same-origin Laravel route
     * (accessible-frontend/views/wallet.blade.php passes route() as the
     * autocomplete source), so they never made a cross-origin API call. This pins
     * the intent — if an accessible host ever does need cross-origin access, it
     * must be granted explicitly (ALLOWED_ORIGINS or a tenant domain row), not by
     * reopening subdomain wildcards.
     */
    public function test_isOriginAllowed_rejects_accessible_frontend_hosts(): void
    {
        $this->seedTenantDomainOrigins([]);

        $this->assertFalse(CorsHelper::isOriginAllowed('https://accessible.project-nexus.ie'));
        $this->assertFalse(CorsHelper::isOriginAllowed('https://accessible-uk.timebank.global'));
    }

    /**
     * Seed the tenant-domain cache so isOriginAllowed() never reaches the
     * database or Redis from a unit test.
     *
     * @param list<string> $origins
     */
    private function seedTenantDomainOrigins(array $origins): void
    {
        $prop = (new \ReflectionClass(CorsHelper::class))->getProperty('tenantDomainOrigins');
        $prop->setAccessible(true);
        $prop->setValue(null, $origins);
    }

    public function test_isOriginAllowed_rejects_malformed_origin(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'not-a-valid-origin',
            ['https://project-nexus.ie']
        ));
    }

    // -------------------------------------------------------
    // addAllowedOrigin()
    // -------------------------------------------------------

    public function test_addAllowedOrigin_adds_new_origin(): void
    {
        CorsHelper::addAllowedOrigin('https://new-domain.com');
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('https://new-domain.com', $origins);
    }

    public function test_addAllowedOrigin_strips_trailing_slash(): void
    {
        CorsHelper::addAllowedOrigin('https://with-slash.com/');
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('https://with-slash.com', $origins);
    }

    public function test_addAllowedOrigin_ignores_empty(): void
    {
        $before = count(CorsHelper::getAllowedOrigins());
        CorsHelper::addAllowedOrigin('');
        $after = count(CorsHelper::getAllowedOrigins());
        $this->assertSame($before, $after);
    }

    // -------------------------------------------------------
    // getAllowedOrigins()
    // -------------------------------------------------------

    public function test_getAllowedOrigins_returns_non_empty_array(): void
    {
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertIsArray($origins);
        $this->assertNotEmpty($origins);
    }

    public function test_getAllowedOrigins_includes_localhost(): void
    {
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('http://localhost:5173', $origins);
    }

    public function test_getAllowedOrigins_includes_expo_web_dev_origin(): void
    {
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('http://localhost:8082', $origins);
        $this->assertContains('http://127.0.0.1:8082', $origins);
    }
}
