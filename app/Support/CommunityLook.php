<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * A community's ready-made "look" (warmth plan Phase 4 D1, Nov 2026).
 *
 * A community admin can pick one of a few looks on Admin → Settings →
 * "Community colour". Each look is a community colour (saved separately, as
 * configuration.primary_color), a companion colour and a corner style; the
 * member website holds the details (react-frontend/src/lib/communityLooks.ts)
 * and the server stores only the look's name, as configuration.community_look,
 * and publishes it in the tenant bootstrap as branding.community_look.
 *
 * The name is checked against this list on the way in and on the way out, so
 * nothing else can reach the page's theme. Keep both lists in step.
 */
final class CommunityLook
{
    /** @var list<string> */
    public const ALLOWED = ['berry', 'poppy', 'hearth', 'honey', 'meadow', 'lagoon', 'harbour', 'dusk', 'heather', 'slate'];

    /** The look's name when it is one of ours, else null (no look). */
    public static function normalize(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $look = strtolower(trim($value));

        return in_array($look, self::ALLOWED, true) ? $look : null;
    }
}
