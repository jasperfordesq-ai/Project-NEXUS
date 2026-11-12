<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * How strongly a community wears its colour (warmth phase 5, Nov 2026).
 *
 * A community admin chooses on Admin → Settings → "Community colour":
 *  - soft:  the colour as tints. The default, and what every community had
 *           before this setting existed.
 *  - vivid: page openings, picture tiles and selected items filled with the
 *           colour, white text on them.
 *
 * The member website holds what each one looks like
 * (react-frontend/src/lib/communityLooks.ts); the server stores only the name,
 * as configuration.colour_strength, and only when it is "vivid" — soft is the
 * absence of a value, so nothing changes for a community that never chose.
 * The bootstrap publishes it the same way (branding.colour_strength, vivid only).
 *
 * The name is checked against this list on the way in and on the way out, so
 * nothing else can reach the page's theme. Keep both lists in step.
 */
final class ColourStrength
{
    public const SOFT = 'soft';
    public const VIVID = 'vivid';

    /** @var list<string> */
    public const ALLOWED = [self::SOFT, self::VIVID];

    /** The name when it is one of ours, else null (not a strength at all). */
    public static function normalize(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $strength = strtolower(trim($value));

        return in_array($strength, self::ALLOWED, true) ? $strength : null;
    }

    /** What a stored value means: vivid only when it says exactly that. */
    public static function fromStored(mixed $value): string
    {
        return self::normalize($value) === self::VIVID ? self::VIVID : self::SOFT;
    }
}
