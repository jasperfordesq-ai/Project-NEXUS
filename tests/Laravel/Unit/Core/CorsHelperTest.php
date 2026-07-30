<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use App\Core\CorsHelper;
use PHPUnit\Framework\TestCase;

class CorsHelperTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Reset static caches via reflection
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

        // Reset static caches
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

    public function test_isOriginAllowed_with_default_origin_returns_true(): void
    {
        $this->assertTrue(CorsHelper::isOriginAllowed(
            'http://localhost:5173',
            ['http://localhost:5173']
        ));
    }

    public function test_isOriginAllowed_with_unknown_origin_returns_false(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'https://evil.example.com',
            ['https://project-nexus.ie']
        ));
    }

    /** `app` is an allowlisted CORS_ALLOWED_SUBDOMAINS label. */
    public function test_isOriginAllowed_with_subdomain_match_returns_true(): void
    {
        $this->assertTrue(CorsHelper::isOriginAllowed(
            'https://app.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    /**
     * This copy was hardened on 2026-04-12 (9f2b2a00f) but the hardening was
     * never asserted, which is part of why nobody noticed it had not reached
     * App\Helpers\CorsHelper — the copy on the live request path — for 3.5
     * months. Both copies now delegate to App\Support\CorsOriginMatcher, and both
     * test classes assert the behaviour.
     */
    public function test_isOriginAllowed_rejects_non_allowlisted_single_label(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'https://evil.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_isOriginAllowed_rejects_nested_subdomain(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'https://a.b.project-nexus.ie',
            ['https://project-nexus.ie']
        ));

        $this->assertFalse(CorsHelper::isOriginAllowed(
            'https://app.b.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_isOriginAllowed_rejects_scheme_mismatch(): void
    {
        // http subdomain of https allowed origin
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'http://app.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_isOriginAllowed_rejects_null_host(): void
    {
        $this->assertFalse(CorsHelper::isOriginAllowed(
            'not-a-valid-origin',
            ['https://project-nexus.ie']
        ));
    }

    // -------------------------------------------------------
    // addAllowedOrigin()
    // -------------------------------------------------------

    public function test_addAllowedOrigin_adds_to_list(): void
    {
        CorsHelper::addAllowedOrigin('https://custom-domain.com');
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('https://custom-domain.com', $origins);
    }

    public function test_addAllowedOrigin_strips_trailing_slash(): void
    {
        CorsHelper::addAllowedOrigin('https://trailing-slash.com/');
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('https://trailing-slash.com', $origins);
    }

    public function test_addAllowedOrigin_does_not_add_empty(): void
    {
        $before = count(CorsHelper::getAllowedOrigins());
        CorsHelper::addAllowedOrigin('');
        $after = count(CorsHelper::getAllowedOrigins());
        $this->assertSame($before, $after);
    }

    public function test_addAllowedOrigin_does_not_duplicate(): void
    {
        CorsHelper::addAllowedOrigin('http://localhost:5173');
        $origins = CorsHelper::getAllowedOrigins();
        $count = array_count_values($origins)['http://localhost:5173'] ?? 0;
        $this->assertSame(1, $count);
    }

    // -------------------------------------------------------
    // getAllowedOrigins()
    // -------------------------------------------------------

    public function test_getAllowedOrigins_returns_array(): void
    {
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertIsArray($origins);
        $this->assertNotEmpty($origins);
    }

    public function test_getAllowedOrigins_includes_expo_web_dev_origin(): void
    {
        $origins = CorsHelper::getAllowedOrigins();
        $this->assertContains('http://localhost:8082', $origins);
        $this->assertContains('http://127.0.0.1:8082', $origins);
    }
}
