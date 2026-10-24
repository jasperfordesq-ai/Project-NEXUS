<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Looks for a Google Search Console verification record in a community's DNS.
 *
 * The SEO page used to report "not configured" whenever its verification box
 * was empty, but most communities verify through a DNS TXT record instead
 * (the only method for a Domain property, and what Cloudflare adds in one
 * click). This lets the page recognise that.
 *
 * A record proves someone verified the domain with Google, not which account
 * or that the verification is current; only the account owner can ask Google
 * that. Callers must word the result accordingly.
 *
 * Bing is deliberately not checked: its DNS method is a CNAME whose name is the
 * account's own code, which cannot be looked up without knowing it.
 */
class SearchVerificationDns
{
    private const GOOGLE_PREFIX = 'google-site-verification=';

    /** A found record is stable; a missing one may be added any minute. */
    private const FOUND_TTL_SECONDS = 21600;
    private const MISSING_TTL_SECONDS = 600;

    /** @var callable(string): list<string> */
    private $txtLookup;

    /**
     * @param (callable(string): list<string>)|null $txtLookup TXT strings for a host; tests pass a fake
     */
    public function __construct(?callable $txtLookup = null)
    {
        $this->txtLookup = $txtLookup ?? [self::class, 'systemTxtLookup'];
    }

    /**
     * @return array{applicable: bool, google_found: bool, google_found_on: ?string}
     */
    public function forTenant(int $tenantId): array
    {
        $target = SitemapService::targetFor($tenantId);

        // A community served under a path on a shared host (<app host>/<slug>)
        // does not own that host's DNS: a record there is the platform's.
        if ($target === null || $target['prefix'] !== '' || self::candidateHosts((string) $target['host']) === []) {
            return ['applicable' => false, 'google_found' => false, 'google_found_on' => null];
        }

        $host = (string) $target['host'];
        $cacheKey = 'seo:verification-dns:' . $host;
        $cached = Cache::get($cacheKey);
        if (is_array($cached)) {
            /** @var array{applicable: bool, google_found: bool, google_found_on: ?string} $cached */
            return $cached;
        }

        $foundOn = $this->findGoogleRecord($host);
        $result = ['applicable' => true, 'google_found' => $foundOn !== null, 'google_found_on' => $foundOn];
        Cache::put($cacheKey, $result, $foundOn !== null ? self::FOUND_TTL_SECONDS : self::MISSING_TTL_SECONDS);

        return $result;
    }

    /**
     * The host and each parent domain down to two labels. A Domain property's
     * record sits on the bare domain and covers every subdomain, so a record on
     * example.ie counts for www.example.ie. Anything that is not a plain
     * hostname (localhost, an IP address, junk) gives no candidates.
     *
     * @return list<string>
     */
    public static function candidateHosts(string $host): array
    {
        $host = rtrim(strtolower(trim($host)), '.');
        if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [];
        }
        if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/', $host)) {
            return [];
        }

        $labels = explode('.', $host);
        $hosts = [];
        for ($i = 0; count($labels) - $i >= 2; $i++) {
            $hosts[] = implode('.', array_slice($labels, $i));
        }
        return $hosts;
    }

    private function findGoogleRecord(string $host): ?string
    {
        foreach (self::candidateHosts($host) as $candidate) {
            try {
                $strings = ($this->txtLookup)($candidate);
            } catch (\Throwable $e) {
                // A resolver failure is not an answer: report "not found" (the
                // page then shows its neutral note) and say why in the log.
                Log::warning('SearchVerificationDns: TXT lookup failed', ['host' => $candidate, 'error' => $e->getMessage()]);
                return null;
            }
            foreach ($strings as $txt) {
                if (str_starts_with(trim($txt), self::GOOGLE_PREFIX)) {
                    return $candidate;
                }
            }
        }
        return null;
    }

    /**
     * @return list<string>
     */
    private static function systemTxtLookup(string $host): array
    {
        $records = @dns_get_record($host, DNS_TXT);
        if ($records === false) {
            throw new \RuntimeException('dns_get_record failed for ' . $host);
        }
        $strings = [];
        foreach ($records as $record) {
            // A long TXT value arrives split into 255-byte chunks in 'entries'.
            $strings[] = isset($record['entries']) && is_array($record['entries'])
                ? implode('', $record['entries'])
                : (string) ($record['txt'] ?? '');
        }
        return $strings;
    }
}
