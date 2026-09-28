<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Support\OutboundUrlGuard;
use PHPUnit\Framework\TestCase;

/**
 * E-055 F-257 — the outbound URL guard must refuse the cloud platform's
 * internal service address and the non-public IPv4 ranges PHP's
 * NO_PRIV/NO_RES flags do not cover, including when embedded in IPv6.
 */
final class F257OutboundGuardNonPublicRangesTest extends TestCase
{
    /** @return array<string, array{string}> */
    public static function nonPublicUrls(): array
    {
        return [
            'Azure platform service' => ['http://168.63.129.16/?comp=versions'],
            'Azure host agent port' => ['http://168.63.129.16:32526/vmSettings'],
            'shared address space low' => ['http://100.64.0.1/'],
            'shared address space high' => ['http://100.127.255.254/'],
            'benchmarking range' => ['http://198.18.0.1/'],
            'benchmarking range high' => ['http://198.19.255.1/'],
            'IETF protocol assignments' => ['http://192.0.0.8/'],
            'multicast' => ['http://224.0.0.251/'],
            'mapped Azure platform service' => ['http://[::ffff:168.63.129.16]/'],
        ];
    }

    /** @dataProvider nonPublicUrls */
    public function test_non_public_addresses_are_refused(string $url): void
    {
        $this->assertFalse(OutboundUrlGuard::isSafeHttpUrl($url), "{$url} must not be treated as a public destination.");
    }

    public function test_control_public_addresses_are_still_allowed(): void
    {
        foreach ([
            'https://1.1.1.1/',
            'https://8.8.8.8/',
            'http://100.63.255.255/',   // just below 100.64.0.0/10
            'http://100.128.0.1/',      // just above it
            'http://168.63.129.17/',    // neighbour of the platform address
            'http://198.20.0.1/',       // just above 198.18.0.0/15
        ] as $url) {
            $this->assertTrue(OutboundUrlGuard::isSafeHttpUrl($url), "{$url} is public and must stay allowed.");
        }

        // Existing refusals hold.
        $this->assertFalse(OutboundUrlGuard::isSafeHttpUrl('http://169.254.169.254/metadata/instance'));
        $this->assertFalse(OutboundUrlGuard::isSafeHttpUrl('http://10.0.0.4/'));
        $this->assertFalse(OutboundUrlGuard::isSafeHttpUrl('http://127.0.0.1/'));
    }
}
