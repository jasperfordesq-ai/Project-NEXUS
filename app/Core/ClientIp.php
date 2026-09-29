<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

/**
 * Centralized, secure client IP extraction.
 *
 * Handles the full proxy chain: Client -> Cloudflare -> Docker -> Apache -> PHP.
 *
 * Priority order:
 *   1. CF-Connecting-IP  (only after a Cloudflare hop is proven by the chain)
 *   2. X-Forwarded-For   (first untrusted hop, evaluated right-to-left)
 *   3. X-Real-IP         (single-IP header from reverse proxies)
 *   4. REMOTE_ADDR       (fallback)
 *
 * F-248: Cloudflare's published ranges are shared by every Cloudflare customer,
 * including their Workers, so an address in those ranges does not by itself
 * prove the request came through OUR zone. When `services.cloudflare.origin_secret`
 * (CLOUDFLARE_ORIGIN_SECRET) is set, a Cloudflare hop is trusted only if the
 * request carries a matching X-Nexus-Origin-Secret header, which our zone adds
 * with a Transform Rule. Otherwise the Cloudflare address itself is the client.
 * Unset = the previous behaviour, unchanged.
 *
 * 🔴 In production the API image's mod_remoteip (Dockerfile.bluegreen) rewrites
 * REMOTE_ADDR from X-Forwarded-For BEFORE PHP runs, trusting the same ranges.
 * This class cannot undo that; the host Apache vhost must drop forwarded headers
 * on requests without the secret. This check covers ClientIp's own branches
 * (CF-Connecting-IP, X-Real-IP, and chains that reach PHP unrewritten).
 */
class ClientIp
{
    /**
     * Trusted proxy CIDRs.
     */
    private const INTERNAL_PROXIES = [
        // Docker bridge networks
        '172.16.0.0/12',
        '10.0.0.0/8',
        '192.168.0.0/16',
        // Localhost
        '127.0.0.0/8',
        '::1',
    ];

    /** @var list<string> */
    private const CLOUDFLARE_PROXIES = [
        // Cloudflare IPv4 ranges
        '173.245.48.0/20',
        '103.21.244.0/22',
        '103.22.200.0/22',
        '103.31.4.0/22',
        '141.101.64.0/18',
        '108.162.192.0/18',
        '190.93.240.0/20',
        '188.114.96.0/20',
        '197.234.240.0/22',
        '198.41.128.0/17',
        '162.158.0.0/15',
        '104.16.0.0/13',
        '104.24.0.0/14',
        '172.64.0.0/13',
        '131.0.72.0/22',
        // Cloudflare IPv6 ranges
        '2400:cb00::/32',
        '2606:4700::/32',
        '2803:f800::/32',
        '2405:b500::/32',
        '2405:8100::/32',
        '2a06:98c0::/29',
        '2c0f:f248::/32',
    ];

    /** Request header (as a $_SERVER key) carrying the zone's origin secret. */
    public const ORIGIN_SECRET_SERVER_KEY = 'HTTP_X_NEXUS_ORIGIN_SECRET';

    /** Config key holding the expected origin secret (empty = check disabled). */
    public const ORIGIN_SECRET_CONFIG_KEY = 'services.cloudflare.origin_secret';

    /** Cached result for the current request */
    private static ?string $cachedIp = null;

    /**
     * Get the real client IP address.
     * Safe to call from anywhere -- result is cached per-request.
     */
    public static function get(): string
    {
        if (self::$cachedIp !== null) {
            return self::$cachedIp;
        }

        self::$cachedIp = self::resolve();
        return self::$cachedIp;
    }

    /**
     * Clear the cached IP (useful for testing).
     */
    public static function clearCache(): void
    {
        self::$cachedIp = null;
    }

    /**
     * Resolve the real client IP from request headers.
     */
    private static function resolve(): string
    {
        $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $trustCloudflare = self::cloudflareHopIsOurs();

        // If REMOTE_ADDR is NOT a trusted proxy, it IS the real client.
        if (!self::isTrustedProxy($remoteAddr, $trustCloudflare)) {
            return $remoteAddr;
        }

        $xff = self::getHeader('HTTP_X_FORWARDED_FOR');
        $hasVerifiedCloudflareHop = $trustCloudflare
            && self::hasVerifiedCloudflareHop($remoteAddr, $xff);

        // 1. CF-Connecting-IP. An internal/Docker hop alone is not proof that
        // Cloudflare supplied this header: direct-origin clients can choose it.
        $cfIp = self::getHeader('HTTP_CF_CONNECTING_IP');
        if ($hasVerifiedCloudflareHop && $cfIp !== null && filter_var($cfIp, FILTER_VALIDATE_IP)) {
            return $cfIp;
        }

        // 2. X-Forwarded-For
        if ($xff !== null) {
            $ips = array_map('trim', explode(',', $xff));
            for ($i = count($ips) - 1; $i >= 0; $i--) {
                $ip = $ips[$i];
                if (filter_var($ip, FILTER_VALIDATE_IP) && !self::isTrustedProxy($ip, $trustCloudflare)) {
                    return $ip;
                }
            }
            $leftMost = trim($ips[0]);
            if (filter_var($leftMost, FILTER_VALIDATE_IP)) {
                return $leftMost;
            }
        }

        // 3. X-Real-IP is accepted only across a verified Cloudflare edge.
        // A generic private/Docker peer can otherwise forward an attacker-
        // supplied value unchanged.
        $realIp = self::getHeader('HTTP_X_REAL_IP');
        if ($hasVerifiedCloudflareHop && $realIp !== null && filter_var($realIp, FILTER_VALIDATE_IP)) {
            return $realIp;
        }

        // 4. Fallback to REMOTE_ADDR
        return $remoteAddr;
    }

    /**
     * Check if an IP is within our trusted proxy ranges.
     */
    private static function isTrustedProxy(string $ip, bool $trustCloudflare = true): bool
    {
        return self::isInternalProxy($ip) || ($trustCloudflare && self::isCloudflareProxy($ip));
    }

    /**
     * F-248: may a Cloudflare hop on this request be treated as our own zone?
     * Always yes when no origin secret is configured (previous behaviour).
     * Otherwise only when X-Nexus-Origin-Secret matches, compared in constant time.
     */
    private static function cloudflareHopIsOurs(): bool
    {
        $expected = self::configuredOriginSecret();
        if ($expected === '') {
            return true;
        }

        $provided = $_SERVER[self::ORIGIN_SECRET_SERVER_KEY] ?? null;
        if (! is_string($provided) || $provided === '') {
            return false;
        }

        return hash_equals($expected, trim($provided));
    }

    /**
     * ClientIp is also used outside a booted Laravel application (plain PHPUnit
     * unit tests), so read config only when the container actually has it.
     */
    private static function configuredOriginSecret(): string
    {
        $container = \Illuminate\Container\Container::getInstance();
        if (! $container->bound('config')) {
            return '';
        }

        $value = $container->make('config')->get(self::ORIGIN_SECRET_CONFIG_KEY);

        return is_string($value) ? trim($value) : '';
    }

    private static function isInternalProxy(string $ip): bool
    {
        return self::ipInCidrs($ip, self::INTERNAL_PROXIES);
    }

    private static function isCloudflareProxy(string $ip): bool
    {
        return self::ipInCidrs($ip, self::CLOUDFLARE_PROXIES);
    }

    /** @param list<string> $cidrs */
    private static function ipInCidrs(string $ip, array $cidrs): bool
    {
        foreach ($cidrs as $cidr) {
            if (self::ipInCidr($ip, $cidr)) {
                return true;
            }
        }
        return false;
    }

    private static function hasVerifiedCloudflareHop(string $remoteAddr, ?string $xff): bool
    {
        if (self::isCloudflareProxy($remoteAddr)) {
            return true;
        }

        if (! self::isInternalProxy($remoteAddr) || $xff === null) {
            return false;
        }

        $ips = array_reverse(array_map('trim', explode(',', $xff)));
        foreach ($ips as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP)) {
                return false;
            }
            if (self::isInternalProxy($ip)) {
                continue;
            }

            // The first externally visible hop before our internal proxy must
            // be Cloudflare. A direct client is therefore never allowed to
            // authenticate its own CF-Connecting-IP header.
            return self::isCloudflareProxy($ip);
        }

        return false;
    }

    /**
     * Check if an IP address falls within a CIDR range.
     * Supports both IPv4 and IPv6.
     */
    private static function ipInCidr(string $ip, string $cidr): bool
    {
        if (strpos($cidr, '/') === false) {
            return $ip === $cidr;
        }

        [$subnet, $bits] = explode('/', $cidr, 2);
        $bits = (int) $bits;

        $ipBin = @inet_pton($ip);
        $subnetBin = @inet_pton($subnet);

        if ($ipBin === false || $subnetBin === false) {
            return false;
        }

        if (strlen($ipBin) !== strlen($subnetBin)) {
            return false;
        }

        $byteLen = strlen($ipBin);
        $mask = str_repeat("\xff", (int) ($bits / 8));
        if ($bits % 8 !== 0) {
            $mask .= chr(0xff << (8 - ($bits % 8)) & 0xff);
        }
        $mask = str_pad($mask, $byteLen, "\x00");

        return ($ipBin & $mask) === ($subnetBin & $mask);
    }

    /**
     * Get a $_SERVER header value, trimmed.
     */
    private static function getHeader(string $key): ?string
    {
        $value = $_SERVER[$key] ?? null;
        if ($value === null || $value === '') {
            return null;
        }
        return trim($value);
    }

    /**
     * Get all IP-related debug information for the current request.
     * Only call this from admin/debug endpoints -- never expose to public.
     */
    public static function debug(): array
    {
        return [
            'resolved_ip' => self::get(),
            'REMOTE_ADDR' => $_SERVER['REMOTE_ADDR'] ?? null,
            'HTTP_CF_CONNECTING_IP' => $_SERVER['HTTP_CF_CONNECTING_IP'] ?? null,
            'HTTP_X_FORWARDED_FOR' => $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null,
            'HTTP_X_REAL_IP' => $_SERVER['HTTP_X_REAL_IP'] ?? null,
            'HTTP_X_FORWARDED_PROTO' => $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? null,
            'HTTP_CF_RAY' => $_SERVER['HTTP_CF_RAY'] ?? null,
            'HTTP_CF_IPCOUNTRY' => $_SERVER['HTTP_CF_IPCOUNTRY'] ?? null,
            'remote_addr_is_trusted' => self::isTrustedProxy($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1', self::cloudflareHopIsOurs()),
            'origin_secret_configured' => self::configuredOriginSecret() !== '',
            'cloudflare_hop_is_ours' => self::cloudflareHopIsOurs(),
            'mod_remoteip_active' => isset($_SERVER['REMOTE_ADDR']) && !self::isTrustedProxy($_SERVER['REMOTE_ADDR']),
        ];
    }
}
