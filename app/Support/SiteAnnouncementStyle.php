<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * The colour styles a community announcement banner may use (Nov 2026).
 *
 * A community admin posts a one-line notice and picks one of these styles; the
 * member website decides what each one looks like. The server stores only the
 * style's name (site_announcements.style) and publishes it in the tenant
 * bootstrap as announcement.style.
 *
 * The name is checked against this list on the way in and on the way out, so
 * nothing else can reach the page's class names. Keep the member website's
 * list in step.
 */
final class SiteAnnouncementStyle
{
    /** @var list<string> */
    public const ALLOWED = ['info', 'celebration', 'important'];

    public const DEFAULT = 'info';

    /** The style's name when it is one of ours, else null (not a style). */
    public static function normalise(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $style = strtolower(trim($value));

        return in_array($style, self::ALLOWED, true) ? $style : null;
    }
}
