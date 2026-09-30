<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * MxRecordValidator — checks that an email domain is real enough to receive
 * mail. Looks up MX records first, falls back to A records per RFC 5321
 * §5.1 (host with no MX accepts mail via its A record).
 *
 * Catches three signups we don't want:
 *   1. Typos like `user@gmial.com` — improves UX as well as security.
 *   2. Freshly-registered burner domains used for spam-signup waves.
 *   3. Made-up domains that bots fall back to when blocklists trim them.
 *
 * Failure mode: DNS lookups fail open, and 🔴 as of F-375 that is true rather
 * than merely claimed. `checkdnsrr()` returns false both for "this domain has
 * no records" and for "DNS did not answer", and PHP does not distinguish them —
 * so when a lookup comes back empty this class asks a small set of SENTINEL
 * domains that certainly do resolve. If the sentinels answer, DNS is healthy and
 * the empty result is real; if they do not, DNS is broken and the verdict is
 * `unknown`, which every caller must treat as "allowed through".
 *
 * That distinction is load-bearing outside sign-up: `users:purge-undeliverable
 * --hard` DELETES accounts on an `undeliverable` verdict, and a DNS outage used
 * to produce one for every address it checked.
 *
 * Caching: results are cached for 24h (positive) / 1h (negative). An `unknown`
 * verdict is NEVER cached — remembering a DNS outage for an hour is exactly the
 * behaviour F-375 was about.
 */
class MxRecordValidator
{
    /** The domain has at least one MX or A record. */
    public const STATE_RESOLVABLE = 'resolvable';

    /** DNS is healthy and says this domain cannot receive mail. */
    public const STATE_UNDELIVERABLE = 'undeliverable';

    /** DNS did not answer. Callers must fail OPEN on this. */
    public const STATE_UNKNOWN = 'unknown';

    /** @var int Cache TTL in seconds (24h). */
    private const CACHE_TTL = 86400;

    /** @var int Cache TTL for negative results (1h) — lets attackers' burner
     *  domains stop being blocked sooner if they later add real records. */
    private const NEGATIVE_CACHE_TTL = 3600;

    /**
     * Long-lived, high-availability domains used only to answer "is DNS
     * answering at all?". Several, so that one of them being unreachable does
     * not on its own make the platform think DNS is down.
     *
     * @var list<string>
     */
    private const DNS_SENTINELS = ['cloudflare.com', 'google.com', 'microsoft.com'];

    /**
     * Returns true when the email's domain has at least one MX or A record.
     * Returns true when DNS could not be reached (fail-open).
     * Returns false only for an unambiguous "this domain cannot receive mail".
     *
     * Callers that act destructively on the answer should use resolveState()
     * instead, so they can tell "no" from "don't know".
     */
    public function isResolvable(string $email): bool
    {
        return $this->resolveState($email) !== self::STATE_UNDELIVERABLE;
    }

    /**
     * The three-way answer. F-375: this exists because collapsing "DNS did not
     * answer" into "false" let a DNS outage look like a platform full of
     * undeliverable addresses.
     *
     * @return self::STATE_*
     */
    public function resolveState(string $email): string
    {
        $atPos = strrpos($email, '@');
        if ($atPos === false || $atPos === strlen($email) - 1) {
            // Malformed email — let the email validator catch it, don't double-error.
            return self::STATE_RESOLVABLE;
        }
        $domain = strtolower(substr($email, $atPos + 1));
        if ($domain === '') {
            return self::STATE_RESOLVABLE;
        }

        $cacheKey = 'mx:' . $domain;
        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            // Entries written before F-375 are plain booleans.
            if (is_bool($cached)) {
                return $cached ? self::STATE_RESOLVABLE : self::STATE_UNDELIVERABLE;
            }
            if (is_string($cached) && $cached !== self::STATE_UNKNOWN) {
                return $cached;
            }
        }

        $state = $this->resolveLiveState($domain);

        // An outage is never remembered. Positive results cache longer than
        // negative — see the class-level note.
        if ($state !== self::STATE_UNKNOWN) {
            Cache::put(
                $cacheKey,
                $state,
                $state === self::STATE_RESOLVABLE ? self::CACHE_TTL : self::NEGATIVE_CACHE_TTL
            );
        }

        return $state;
    }

    /**
     * RFC 6761 + RFC 2606 reserved domains and TLDs that exist solely for
     * documentation / testing and must never receive real email. `.invalid`
     * is the one DNS itself refuses to resolve; the rest (example.com,
     * example.test, *.localhost, etc.) DO resolve at the DNS layer (some
     * even have MX records) but are guaranteed to be undeliverable, so we
     * reject them before the DNS check. A real cyber attack on 2026-05-14
     * → 2026-05-16 used `testing@example.com` precisely because example.com
     * passes naive MX/A checks; this list closes that hole.
     */
    private const RESERVED_DOMAINS = [
        'example.com',
        'example.net',
        'example.org',
        'localhost',
    ];

    private const RESERVED_TLDS = [
        '.test',
        '.example',
        '.invalid',
        '.localhost',
    ];

    /** @return self::STATE_* */
    private function resolveLiveState(string $domain): string
    {
        // Reject obvious junk before touching DNS. These verdicts are structural,
        // not DNS-derived, so they are never "unknown".
        if (!preg_match('/^[a-z0-9.-]+$/', $domain) || strlen($domain) > 253) {
            return self::STATE_UNDELIVERABLE;
        }
        if (in_array($domain, self::RESERVED_DOMAINS, true)) {
            return self::STATE_UNDELIVERABLE;
        }
        foreach (self::RESERVED_TLDS as $tld) {
            if (str_ends_with($domain, $tld)) {
                return self::STATE_UNDELIVERABLE;
            }
        }

        try {
            if ($this->checkDns($domain, 'MX')) {
                return self::STATE_RESOLVABLE;
            }
            // Fallback per RFC 5321 — domain with no MX still receives mail
            // via its A record.
            if ($this->checkDns($domain, 'A')) {
                return self::STATE_RESOLVABLE;
            }

            // 🔴 F-375. Both lookups came back empty, and checkdnsrr() cannot say
            // whether that means "no records" or "no answer". Ask domains that
            // certainly resolve: if none of them answers either, DNS is the
            // problem, not this domain.
            if (!$this->dnsIsAnswering()) {
                Log::warning('mx_validator.dns_unreachable', ['domain' => $domain]);
                return self::STATE_UNKNOWN;
            }

            return self::STATE_UNDELIVERABLE;
        } catch (\Throwable $e) {
            Log::info('mx_validator.lookup_failed', [
                'domain' => $domain,
                'error' => $e->getMessage(),
            ]);
            return self::STATE_UNKNOWN; // fail open
        }
    }

    /** True when at least one sentinel domain resolves, i.e. DNS is usable. */
    private function dnsIsAnswering(): bool
    {
        foreach (self::DNS_SENTINELS as $sentinel) {
            if ($this->checkDns($sentinel, 'A') || $this->checkDns($sentinel, 'MX')) {
                return true;
            }
        }

        return false;
    }

    /**
     * The single raw-DNS seam. Kept protected so a test can simulate a healthy
     * or a broken resolver and exercise the decision logic above it; nothing in
     * production overrides it.
     */
    protected function checkDns(string $domain, string $type): bool
    {
        return @checkdnsrr($domain, $type);
    }
}
