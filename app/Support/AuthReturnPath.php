<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * A page on this site that a member should land on after an authentication
 * step — e.g. the emailed page a new member was trying to reach when they
 * signed up, carried through the verification email as `?next=`.
 *
 * Mirrors react-frontend/src/lib/safe-auth-return-path.ts: only a
 * root-relative local path is accepted, never another host, a protocol-
 * relative `//host`, a backslash trick, control characters or the encoded
 * slash/backslash/percent forms browsers normalise. The website re-checks the
 * value before following it; this keeps a crafted value out of our emails.
 */
final class AuthReturnPath
{
    private const MAX_LENGTH = 512;

    public static function safe(mixed $value): ?string
    {
        if (!is_string($value) || $value === '' || strlen($value) > self::MAX_LENGTH) {
            return null;
        }
        if ($value[0] !== '/' || str_starts_with($value, '//')) {
            return null;
        }
        // Spaces and control characters, backslashes, and encoded
        // %25 / %2F / %5C / %00-%1F.
        if (preg_match('/[\x00-\x20\x7F\\\\]/', $value) === 1
            || preg_match('/%(?:25|2f|5c|0[0-9a-f]|1[0-9a-f])/i', $value) === 1) {
            return null;
        }
        $parts = parse_url('https://auth-return.invalid' . $value);
        if ($parts === false || ($parts['host'] ?? '') !== 'auth-return.invalid' || isset($parts['user']) || isset($parts['port'])) {
            return null;
        }

        return $value;
    }
}
