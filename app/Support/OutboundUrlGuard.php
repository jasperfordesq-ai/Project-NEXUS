<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

final class OutboundUrlGuard
{
    /**
     * Validate an outbound HTTP(S) URL before server-side fetch/callback use.
     */
    public static function isSafeHttpUrl(string $url, bool $requireHttps = false): bool
    {
        $parts = parse_url(trim($url));
        if (!is_array($parts)) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = self::normalizeHost((string) ($parts['host'] ?? ''));

        if ($host === '' || !in_array($scheme, ['http', 'https'], true)) {
            return false;
        }

        if ($requireHttps && $scheme !== 'https') {
            return false;
        }

        if (self::isBlockedLocalName($host)) {
            return false;
        }

        $ips = self::resolveHost($host);
        if ($ips === []) {
            return false;
        }

        foreach ($ips as $ip) {
            if (!self::isPublicIp($ip)) {
                return false;
            }
        }

        return true;
    }

    public static function assertSafeHttpUrl(string $url, bool $requireHttps = false, string $message = 'Unsafe outbound URL.'): void
    {
        if (!self::isSafeHttpUrl($url, $requireHttps)) {
            throw new \InvalidArgumentException($message);
        }
    }

    /**
     * Validate a user-visible/browser navigation URL.
     *
     * Unlike server-side callbacks, this does not resolve DNS; it only enforces
     * a navigable HTTP(S) scheme and rejects obvious local targets.
     */
    public static function isSafeBrowserUrl(string $url): bool
    {
        $url = trim($url);
        if ($url === '' || str_starts_with($url, '//')) {
            return false;
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = self::normalizeHost((string) ($parts['host'] ?? ''));

        if ($host === '' || !in_array($scheme, ['http', 'https'], true)) {
            return false;
        }

        if (self::isBlockedLocalName($host)) {
            return false;
        }

        if (filter_var($host, FILTER_VALIDATE_IP) && !self::isPublicIp($host)) {
            return false;
        }

        return true;
    }

    /**
     * @return array<int,mixed>
     */
    public static function curlOptionsForUrl(string $url, bool $requireHttps = false): array
    {
        self::assertSafeHttpUrl($url, $requireHttps);

        $options = [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ];

        $parts = parse_url(trim($url));
        $host = is_array($parts)
            ? self::normalizeHost((string) ($parts['host'] ?? ''))
            : '';
        if ($host !== '' && !filter_var($host, FILTER_VALIDATE_IP)) {
            // The initial validation and the cURL pin require separate DNS
            // reads. If the second read no longer yields a public target,
            // never fall back to cURL's live resolver (DNS-rebinding/TOCTOU).
            $resolve = self::curlResolveEntries($url);
            if ($resolve === []) {
                throw new \InvalidArgumentException('Unsafe outbound URL.');
            }
            $options[CURLOPT_RESOLVE] = $resolve;
        }

        return $options;
    }

    /**
     * @return array<string,mixed>
     */
    public static function httpClientOptions(string $url, bool $requireHttps = false): array
    {
        return [
            'allow_redirects' => false,
            'curl' => self::curlOptionsForUrl($url, $requireHttps),
        ];
    }

    /**
     * Resolve a bare host name (no scheme/port) for a non-HTTP outbound
     * connection such as SMTP. Returns every resolved address when ALL of them
     * are public; returns [] (refuse) for local names, unresolvable hosts, or
     * when any address is private, loopback, link-local or reserved. Callers
     * should connect to one of the returned IPs rather than re-resolving, so a
     * DNS answer cannot change between this check and the connection.
     *
     * @return list<string>
     */
    public static function publicAddressesForHost(string $host): array
    {
        $host = self::normalizeHost($host);
        if ($host === '') {
            return [];
        }
        // A host name, not a URL: reject anything carrying a scheme, port,
        // path or credentials (an IPv6 literal legitimately contains ":").
        if (!filter_var($host, FILTER_VALIDATE_IP) && preg_match('/[\s\/\\\\@:?#]/', $host) === 1) {
            return [];
        }
        if (self::isBlockedLocalName($host)) {
            return [];
        }

        $ips = self::resolveHost($host);
        if ($ips === []) {
            return [];
        }
        foreach ($ips as $ip) {
            if (!self::isPublicIp($ip)) {
                return [];
            }
        }

        return $ips;
    }

    /**
     * Returns true for private, reserved, loopback, link-local, or invalid IPs.
     */
    public static function isBlockedIp(string $ip): bool
    {
        return !self::isPublicIp($ip);
    }

    private static function normalizeHost(string $host): string
    {
        $host = strtolower(trim($host));
        return trim($host, '[]');
    }

    private static function isBlockedLocalName(string $host): bool
    {
        return $host === 'localhost'
            || str_ends_with($host, '.localhost')
            || str_ends_with($host, '.local')
            || str_ends_with($host, '.internal');
    }

    /**
     * @return list<string>
     */
    private static function resolveHost(string $host): array
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return [$host];
        }

        $ips = [];
        $records = @dns_get_record($host, DNS_A + DNS_AAAA) ?: [];
        foreach ($records as $record) {
            if (!empty($record['ip'])) {
                $ips[] = (string) $record['ip'];
            }
            if (!empty($record['ipv6'])) {
                $ips[] = (string) $record['ipv6'];
            }
        }

        return array_values(array_unique($ips));
    }

    /**
     * @return list<string>
     */
    private static function curlResolveEntries(string $url): array
    {
        $parts = parse_url(trim($url));
        if (!is_array($parts)) {
            return [];
        }

        $host = self::normalizeHost((string) ($parts['host'] ?? ''));
        if ($host === '' || filter_var($host, FILTER_VALIDATE_IP)) {
            return [];
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $port = (int) ($parts['port'] ?? ($scheme === 'http' ? 80 : 443));
        $entries = [];
        foreach (self::resolveHost($host) as $ip) {
            if (self::isPublicIp($ip)) {
                $entries[] = "{$host}:{$port}:{$ip}";
            }
        }

        return array_values(array_unique($entries));
    }

    private static function isPublicIp(string $ip): bool
    {
        // An IPv6 literal can embed an IPv4 address — IPv4-mapped
        // (::ffff:127.0.0.1 / ::ffff:7f00:1), IPv4-compatible (::127.0.0.1) or
        // NAT64 (64:ff9b::7f00:1). filter_var does not decode these, so a mapped
        // loopback/private/metadata address would otherwise read as a public
        // IPv6 address (SSRF). Re-validate the embedded IPv4 as the effective
        // target and refuse when it is not itself public.
        if (str_contains($ip, ':')) {
            $embedded = self::embeddedIpv4($ip);
            if ($embedded !== null && !self::isPublicIp($embedded)) {
                return false;
            }
        }

        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) !== false;
    }

    /**
     * Extract the embedded IPv4 address from an IPv4-mapped, IPv4-compatible or
     * NAT64 well-known-prefix IPv6 literal. Returns null for any other IPv6
     * address (a genuine global address is never in ::/96 or 64:ff9b::/96).
     */
    private static function embeddedIpv4(string $ip): ?string
    {
        // Drop any zone identifier (e.g. fe80::1%eth0) before decoding.
        $zone = strpos($ip, '%');
        $bare = $zone === false ? $ip : substr($ip, 0, $zone);

        $packed = @inet_pton($bare);
        if ($packed === false || strlen($packed) !== 16) {
            return null;
        }

        /** @var array<int,int> $bytes */
        $bytes = array_values(unpack('C16', $packed) ?: []);
        if (count($bytes) !== 16) {
            return null;
        }

        $highBytesZero = static function (int $count) use ($bytes): bool {
            for ($i = 0; $i < $count; $i++) {
                if ($bytes[$i] !== 0) {
                    return false;
                }
            }

            return true;
        };

        // ::ffff:a.b.c.d — IPv4-mapped.
        $isMapped = $highBytesZero(10) && $bytes[10] === 0xff && $bytes[11] === 0xff;
        // ::a.b.c.d — IPv4-compatible (deprecated); also covers ::/96 low addresses.
        $isCompatible = $highBytesZero(12);
        // 64:ff9b::a.b.c.d — NAT64 well-known prefix (RFC 6052).
        $isNat64 = $bytes[0] === 0x00 && $bytes[1] === 0x64
            && $bytes[2] === 0xff && $bytes[3] === 0x9b
            && $bytes[4] === 0 && $bytes[5] === 0 && $bytes[6] === 0 && $bytes[7] === 0
            && $bytes[8] === 0 && $bytes[9] === 0 && $bytes[10] === 0 && $bytes[11] === 0;

        if ($isMapped || $isCompatible || $isNat64) {
            return sprintf('%d.%d.%d.%d', $bytes[12], $bytes[13], $bytes[14], $bytes[15]);
        }

        return null;
    }
}
