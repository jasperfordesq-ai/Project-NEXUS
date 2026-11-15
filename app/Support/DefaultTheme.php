<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * How a community's member website starts for someone who has not chosen for
 * themselves (Make it yours, Nov 2026).
 *
 * A community admin chooses on Admin → Make it yours:
 *  - light:  the default, and what every community had before this setting
 *            existed (the platform went light-first on 11 Aug 2026, after a
 *            coordinator's feedback that dark is hard on older eyes).
 *  - dark:   the dark theme.
 *  - system: whatever the visitor's own phone or computer is set to.
 *
 * It is only ever a starting point. A person's own choice (the picker in the
 * header, or their settings) is kept in their browser and always wins; the
 * member website applies that order (react-frontend/src/contexts/ThemeContext.tsx).
 * The accessible site has no dark theme and the phone app follows the phone,
 * so neither reads this.
 *
 * The server stores only the name, as configuration.default_theme, and only
 * when it is not "light" — light is the absence of a value, so nothing changes
 * for a community that never chose. The bootstrap publishes it the same way
 * (branding.default_theme, dark or system only).
 *
 * The name is checked against this list on the way in and on the way out, so
 * nothing else can reach the page's theme. The member website holds the same
 * three names (react-frontend/src/lib/communityLooks.ts); a test compares them.
 */
final class DefaultTheme
{
    public const LIGHT = 'light';
    public const DARK = 'dark';
    public const SYSTEM = 'system';

    /** @var list<string> */
    public const ALLOWED = [self::LIGHT, self::DARK, self::SYSTEM];

    /** The name when it is one of ours, else null (not a theme at all). */
    public static function normalize(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $theme = strtolower(trim($value));

        return in_array($theme, self::ALLOWED, true) ? $theme : null;
    }

    /** What a stored value means: light unless it says exactly dark or system. */
    public static function fromStored(mixed $value): string
    {
        return self::normalize($value) ?? self::LIGHT;
    }
}
