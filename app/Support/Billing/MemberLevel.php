<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

/**
 * Where a community's active members stand against its plan's member number.
 * The one place this is worked out.
 *
 * Each screen used to decide for itself. Billing control read the platform's
 * warning percent; Branch payments had 80 written into it; the daily check
 * had a third copy. With the setting at anything but 80 the two lists
 * coloured the same community differently, and a community exactly at its
 * number was counted "over their plan" on one page and not on the other.
 *
 *   ok    under the warning percent, or no member number at all
 *   near  from the warning percent (the daily check's "approaching")
 *   full  exactly at the number (the daily check's "reached")
 *   over  more than the number
 *
 * Only `over` is over: `full` is a community that has used all it pays for.
 */
final class MemberLevel
{
    public const OK = 'ok';
    public const NEAR = 'near';
    public const FULL = 'full';
    public const OVER = 'over';

    /**
     * @param ?int $max            the plan's member number; null or 0 = no limit
     * @param ?int $warningPercent the platform's setting when not given
     * @return 'ok'|'near'|'full'|'over'
     */
    public static function of(int $active, ?int $max, ?int $warningPercent = null): string
    {
        if ($max === null || $max <= 0) {
            return self::OK;
        }
        if ($active > $max) {
            return self::OVER;
        }
        if ($active === $max) {
            return self::FULL;
        }

        $warningPercent ??= (int) BillingSettings::get('limit_warning_percent');

        // Whole numbers on both sides: no rounding to disagree about.
        return $active * 100 >= $warningPercent * $max ? self::NEAR : self::OK;
    }

    /** The daily check's name for a level: null while there is nothing to tell anybody. */
    public static function stage(string $level): ?string
    {
        return match ($level) {
            self::NEAR => 'approaching',
            self::FULL => 'reached',
            self::OVER => 'over',
            default => null,
        };
    }
}
