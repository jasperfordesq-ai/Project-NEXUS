<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Facades\Cache;

/**
 * Keeps the figures of the platform team pages that count across every
 * community for five minutes, so opening one of them again does not count
 * every community again.
 *
 * Used by six read endpoints: community-health, usage (one answer per month),
 * community-setup, data-requests, legal-documents, push-notifications (one
 * answer per number of days). Every answer carries `generated_at`, the time
 * its figures were worked out. `$refresh` works them out again and replaces
 * the kept answer; the controller limits refreshes to
 * REFRESHES_PER_MINUTE per person.
 *
 * - A computation that throws is never kept: the error goes to the caller.
 * - An answer with any part not available (hasUnavailablePart()) is kept for
 *   PARTIAL_SECONDS only, so a passing fault does not stick for five minutes.
 *
 * The kept answers are counts about communities, the same for every member
 * of the platform team, so they are kept once, not per person.
 */
final class PlatformFiguresCache
{
    public const KEEP_SECONDS = 300;

    public const PARTIAL_SECONDS = 30;

    public const REFRESHES_PER_MINUTE = 6;

    private const PREFIX = 'platform_team_figures:';

    /** Did the request ask for fresh figures (`?refresh=1`)? */
    public static function wantsRefresh(mixed $value): bool
    {
        return in_array($value, [1, '1', true, 'true'], true);
    }

    /**
     * @param string                        $key     the page, plus its variant (month, days)
     * @param callable(): array<string, mixed> $compute
     * @return array<string, mixed> the answer with `generated_at`
     */
    public function remember(string $key, bool $refresh, callable $compute): array
    {
        $cacheKey = self::PREFIX . $key;

        if (!$refresh) {
            $kept = Cache::get($cacheKey);
            if (is_array($kept) && isset($kept['generated_at'])) {
                return $kept;
            }
        }

        $answer = $compute();
        $answer['generated_at'] = now()->toIso8601String();

        Cache::put(
            $cacheKey,
            $answer,
            now()->addSeconds(self::hasUnavailablePart($answer) ? self::PARTIAL_SECONDS : self::KEEP_SECONDS),
        );

        return $answer;
    }

    /**
     * The three ways these pages say a part could not be read: a non-empty
     * `unavailable` list, `available: false`, or a `sources` entry that is
     * false.
     *
     * @param array<string, mixed> $answer
     */
    public static function hasUnavailablePart(array $answer): bool
    {
        if (is_array($answer['unavailable'] ?? null) && $answer['unavailable'] !== []) {
            return true;
        }
        if (($answer['available'] ?? null) === false) {
            return true;
        }
        if (is_array($answer['sources'] ?? null) && in_array(false, $answer['sources'], true)) {
            return true;
        }

        return false;
    }
}
