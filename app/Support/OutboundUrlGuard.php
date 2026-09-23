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
        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) !== false;
    }
}
