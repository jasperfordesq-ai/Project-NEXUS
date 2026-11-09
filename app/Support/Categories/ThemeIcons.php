<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Categories;

/**
 * The pictures an administrator can give a theme (categories.icon; AWID
 * feedback, Nov 2026: "clear categories, attractive visuals").
 *
 * A fixed set of keys, never a free URL or markup: the website maps each key
 * to one of its own icons (react-frontend/src/lib/themeIcons.ts, whose test
 * checks it covers exactly this list). NULL in the column means "choose
 * automatically".
 */
final class ThemeIcons
{
    public const ALLOWED = [
        'garden',
        'transport',
        'repairs',
        'food',
        'learning',
        'care',
        'pets',
        'technology',
        'music',
        'arts',
        'clothes',
        'home',
        'fitness',
        'languages',
        'office',
        'beauty',
        'building',
        'photography',
        'cycling',
        'errands',
        'cleaning',
        'outdoors',
        'money',
        'company',
        'moving',
    ];

    public static function isAllowed(mixed $key): bool
    {
        return is_string($key) && in_array($key, self::ALLOWED, true);
    }
}
