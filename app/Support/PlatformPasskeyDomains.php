<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * The registrable domains that platform-owned addresses (not a community's
 * own domain) may use as their passkey Relying Party ID.
 *
 * Normally one: WEBAUTHN_RP_ID (project-nexus.ie). While the shared app moves
 * from app.project-nexus.ie to app.project-nexus.net (decided 10 Nov 2026)
 * both are served, and a passkey belongs to exactly one registrable domain, so
 * WEBAUTHN_ADDITIONAL_RP_IDS adds the second. A domain listed here grants
 * nothing by itself: an origin still has to be explicitly allowed
 * (WEBAUTHN_ALLOWED_ORIGINS, FRONTEND_URL, ACCESSIBLE_FRONTEND_URL).
 */
final class PlatformPasskeyDomains
{
    /**
     * Primary first, then the additional ones; lower-cased, trailing dot
     * removed, duplicates and empties dropped.
     *
     * @return list<string>
     */
    public static function all(): array
    {
        $candidates = [config('webauthn.rp_id')];
        $additional = config('webauthn.additional_rp_ids', []);
        if (is_array($additional)) {
            $candidates = array_merge($candidates, $additional);
        }

        $domains = [];
        foreach ($candidates as $candidate) {
            if (!is_string($candidate)) {
                continue;
            }
            $domain = strtolower(rtrim(trim($candidate), '.'));
            if ($domain !== '' && !in_array($domain, $domains, true)) {
                $domains[] = $domain;
            }
        }

        return $domains;
    }

    /**
     * The platform domain a host belongs to (the host itself or a parent of
     * it), preferring the most specific match. Null when it belongs to none.
     */
    public static function forHost(string $host): ?string
    {
        $host = strtolower(rtrim(trim($host), '.'));
        $best = null;
        foreach (self::all() as $domain) {
            if (($host === $domain || str_ends_with($host, '.' . $domain))
                && ($best === null || strlen($domain) > strlen($best))) {
                $best = $domain;
            }
        }

        return $best;
    }
}
