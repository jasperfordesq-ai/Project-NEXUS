<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\ClientIp;
use Tests\Laravel\TestCase;

/**
 * F-248 (E-055 A-3) — ClientIp trusted every published Cloudflare range, and
 * anyone's Cloudflare Worker egresses from those ranges. A Worker pointed at
 * this origin could therefore choose the address ClientIp reports (the key of
 * the login / reset / registration per-address limiter): evade the limit, or
 * lock a victim's address out.
 *
 * When `services.cloudflare.origin_secret` (CLOUDFLARE_ORIGIN_SECRET) is set, a
 * request only counts as having come through OUR Cloudflare zone if it carries
 * the matching X-Nexus-Origin-Secret header (added by a Transform Rule). Without
 * it the Cloudflare hop is not trusted and the Cloudflare address itself is
 * used. With the setting unset, behaviour is exactly as before.
 *
 * 🔴 Scope: this closes ClientIp's own header-trust branches. In production the
 * API image's mod_remoteip rewrites REMOTE_ADDR from X-Forwarded-For before PHP
 * runs; that path needs the host-Apache rule recorded against F-248.
 */
final class F248CloudflareOriginSecretTest extends TestCase
{
    private const SECRET = 'f248-test-origin-secret-0123456789abcdef';
    private const CF_EDGE = '162.158.10.20';
    private const DOCKER_PEER = '172.20.0.1';
    private const FORGED = '198.51.100.10';

    private const SERVER_KEYS = [
        'REMOTE_ADDR',
        'HTTP_CF_CONNECTING_IP',
        'HTTP_X_FORWARDED_FOR',
        'HTTP_X_REAL_IP',
        'HTTP_X_NEXUS_ORIGIN_SECRET',
    ];

    /** @var array<string, mixed> */
    private array $savedServer = [];

    protected function setUp(): void
    {
        parent::setUp();
        foreach (self::SERVER_KEYS as $key) {
            if (array_key_exists($key, $_SERVER)) {
                $this->savedServer[$key] = $_SERVER[$key];
            }
            unset($_SERVER[$key]);
        }
        ClientIp::clearCache();
    }

    protected function tearDown(): void
    {
        foreach (self::SERVER_KEYS as $key) {
            unset($_SERVER[$key]);
        }
        foreach ($this->savedServer as $key => $value) {
            $_SERVER[$key] = $value;
        }
        ClientIp::clearCache();
        parent::tearDown();
    }

    /** A Worker's request: Cloudflare egress hop, attacker-chosen client-IP headers. */
    private function forgedCloudflareChain(?string $secretHeader): void
    {
        $_SERVER['REMOTE_ADDR'] = self::DOCKER_PEER;
        $_SERVER['HTTP_X_FORWARDED_FOR'] = self::FORGED . ', ' . self::CF_EDGE;
        $_SERVER['HTTP_CF_CONNECTING_IP'] = self::FORGED;
        if ($secretHeader !== null) {
            $_SERVER['HTTP_X_NEXUS_ORIGIN_SECRET'] = $secretHeader;
        }
        ClientIp::clearCache();
    }

    public function test_secret_set_and_header_missing_the_forwarded_address_is_not_trusted(): void
    {
        config(['services.cloudflare.origin_secret' => self::SECRET]);
        $this->forgedCloudflareChain(null);

        $this->assertSame(self::CF_EDGE, ClientIp::get());
    }

    public function test_secret_set_and_header_wrong_the_forwarded_address_is_not_trusted(): void
    {
        config(['services.cloudflare.origin_secret' => self::SECRET]);
        $this->forgedCloudflareChain('not-the-secret');

        $this->assertSame(self::CF_EDGE, ClientIp::get());
    }

    public function test_secret_set_and_cloudflare_peer_cannot_steer_by_x_real_ip_or_cf_connecting_ip(): void
    {
        // The post-mod_remoteip shape: REMOTE_ADDR is a Cloudflare address and
        // the caller supplied X-Real-IP / CF-Connecting-IP.
        config(['services.cloudflare.origin_secret' => self::SECRET]);
        $_SERVER['REMOTE_ADDR'] = self::CF_EDGE;
        $_SERVER['HTTP_X_REAL_IP'] = self::FORGED;
        $_SERVER['HTTP_CF_CONNECTING_IP'] = self::FORGED;
        ClientIp::clearCache();

        $this->assertSame(self::CF_EDGE, ClientIp::get());
    }

    public function test_secret_set_and_header_right_the_visitor_behind_cloudflare_is_used(): void
    {
        config(['services.cloudflare.origin_secret' => self::SECRET]);
        $this->forgedCloudflareChain(self::SECRET);

        $this->assertSame(self::FORGED, ClientIp::get());
    }

    public function test_secret_set_does_not_change_a_direct_visitor_or_an_internal_caller(): void
    {
        config(['services.cloudflare.origin_secret' => self::SECRET]);

        // mod_remoteip already resolved the visitor (the normal production shape).
        $_SERVER['REMOTE_ADDR'] = '203.0.113.50';
        ClientIp::clearCache();
        $this->assertSame('203.0.113.50', ClientIp::get());

        // web-uk on the Docker network forwarding its visitor (F-110 path, no
        // Cloudflare hop and no secret header).
        $_SERVER['REMOTE_ADDR'] = self::DOCKER_PEER;
        $_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.60';
        ClientIp::clearCache();
        $this->assertSame('203.0.113.60', ClientIp::get());
    }

    public function test_control_secret_unset_behaves_exactly_as_before(): void
    {
        config(['services.cloudflare.origin_secret' => null]);
        $this->forgedCloudflareChain(null);
        $this->assertSame(self::FORGED, ClientIp::get());

        config(['services.cloudflare.origin_secret' => '']);
        $this->forgedCloudflareChain('anything');
        $this->assertSame(self::FORGED, ClientIp::get());
    }
}
