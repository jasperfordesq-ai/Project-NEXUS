<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Support\OutboundUrlGuard;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * F-151 — IPv4-mapped / IPv4-compatible / NAT64 IPv6 literals must not slip past
 * the outbound SSRF guard as "public" addresses.
 *
 * Only loopback embedded targets are exercised here (never a non-loopback
 * internal address), matching the frozen repro
 * .local-docs-archive/security-log/E-035/evidence/e035-vB/LinkPreviewMappedV6ReproTest.php.
 */
class OutboundUrlGuardMappedIpv6Test extends TestCase
{
    use DatabaseTransactions;

    /**
     * @return array<string,array{0:string}>
     */
    public static function embeddedLoopbackLiterals(): array
    {
        return [
            'IPv4-mapped dotted'      => ['http://[::ffff:127.0.0.1]/'],
            'IPv4-mapped hex'         => ['http://[::ffff:7f00:1]/'],
            'IPv4-compatible dotted'  => ['http://[::127.0.0.1]/'],
            'NAT64 well-known prefix' => ['http://[64:ff9b::7f00:1]/'],
        ];
    }

    /**
     * @dataProvider embeddedLoopbackLiterals
     */
    public function testMappedIpv6LoopbackLiteralsAreRefused(string $url): void
    {
        $this->assertFalse(
            OutboundUrlGuard::isSafeHttpUrl($url),
            "Guard accepted an embedded-loopback IPv6 literal: {$url}",
        );
        $this->assertFalse(
            OutboundUrlGuard::isSafeBrowserUrl($url),
            "Browser guard accepted an embedded-loopback IPv6 literal: {$url}",
        );
    }

    /**
     * @dataProvider embeddedLoopbackLiterals
     */
    public function testCurlOptionsRefuseMappedIpv6LiteralsSoTheResolvePinCannotBeBypassed(string $url): void
    {
        $this->expectException(\InvalidArgumentException::class);
        OutboundUrlGuard::curlOptionsForUrl($url);
    }

    public function testGenuinePublicHostStillPasses(): void
    {
        // Public literal (no DNS needed) — the guard must not over-block.
        $this->assertTrue(
            OutboundUrlGuard::isSafeHttpUrl('https://93.184.216.34/webhook', requireHttps: true),
        );
        $this->assertTrue(
            OutboundUrlGuard::isSafeBrowserUrl('https://93.184.216.34/webhook'),
        );
    }

    public function testPlainLoopbackControlsRemainRefused(): void
    {
        $this->assertFalse(OutboundUrlGuard::isSafeHttpUrl('http://127.0.0.1/'));
        $this->assertFalse(OutboundUrlGuard::isSafeHttpUrl('http://[::1]/'));
    }
}
