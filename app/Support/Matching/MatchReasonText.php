<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Matching;

/**
 * "Why you matched" reasons in the reader's language.
 *
 * The matching engines (SmartMatchingEngine, Matching\MatchScorer, the
 * cold-start and cross-module paths) build each reason as a fixed English
 * phrase and store it in match_cache. Every client showed that stored text,
 * so a Spanish-speaking member read "Same category: Gardening" (AWID pilot
 * feedback, Oct 2026: option lists and labels still in English).
 *
 * Translating when the reason is READ, not when it is written, covers rows
 * already in the cache and needs no storage change: each known phrase is
 * recognised and rendered with __() in the current locale, with its values
 * (category name, distance) carried across. A phrase it does not know —
 * a future engine's, or free text — is returned exactly as stored.
 */
final class MatchReasonText
{
    /** Exact phrases => translation key in lang/<locale>/match_reasons.json. */
    private const FIXED = [
        'Skills match both ways' => 'skills_both_ways',
        'Skills match your expertise' => 'skills_expertise',
        'Very similar to what you are looking for' => 'very_similar',
        'Can be done remotely' => 'remote',
        'Recently active member' => 'recently_active',
        'Highly rated member' => 'highly_rated',
        'Mutual exchange possible!' => 'mutual',
        'Posted recently' => 'posted_recently',
        'Similar to your listing' => 'similar_listing',
        'Remote-friendly listing you might like' => 'cold_remote',
        'Nearby listing that might interest you' => 'cold_nearby',
        'Recently posted in your community' => 'cold_recent',
        'Volunteering opportunity that matches your profile' => 'volunteering',
        'Upcoming event that matches your interests' => 'event',
        // Explore ("For you" listings and suggested people).
        'Popular with similar members' => 'popular_similar',
        'Recommended by AI' => 'recommended_ai',
        'Similar to what you like' => 'similar_to_liked',
        'Matches your skills' => 'matches_skills',
        'Recommended for you' => 'recommended_for_you',
        'Similar interests' => 'similar_interests',
        'Mutual connections' => 'mutual_connections',
    ];

    /**
     * @param mixed $reasons The stored list (array, JSON string or null).
     * @param array<string, string> $categoryNames Stored category name => name to show,
     *        so "Same category: X" names the category in the reader's language too.
     * @return array<int, string>
     */
    public static function localize(mixed $reasons, array $categoryNames = []): array
    {
        if (is_string($reasons)) {
            $decoded = json_decode($reasons, true);
            $reasons = is_array($decoded) ? $decoded : [$reasons];
        }
        if (!is_array($reasons)) {
            return [];
        }

        $out = [];
        foreach ($reasons as $reason) {
            if (!is_string($reason) || $reason === '') {
                continue;
            }
            $out[] = self::one($reason, $categoryNames);
        }

        return $out;
    }

    /** @param array<string, string> $categoryNames */
    private static function one(string $reason, array $categoryNames): string
    {
        if (isset(self::FIXED[$reason])) {
            return self::text(self::FIXED[$reason], [], $reason);
        }

        if (preg_match('/^(Same|Related) category: (.+)$/u', $reason, $m) === 1) {
            $category = $categoryNames[$m[2]] ?? $m[2];
            $key = $m[1] === 'Same' ? 'same_category' : 'related_category';

            return self::text($key, ['category' => $category], $reason);
        }

        if (preg_match('/^Matches your interest in (.+)$/u', $reason, $m) === 1) {
            return self::text('interest_in_category', ['category' => $categoryNames[$m[1]] ?? $m[1]], $reason);
        }

        if (preg_match('/^(Very close|Nearby): ([0-9]+(?:\.[0-9]+)?) km away$/', $reason, $m) === 1) {
            $key = $m[1] === 'Very close' ? 'very_close' : 'nearby';

            return self::text($key, ['distance' => self::distance((float) $m[2])], $reason);
        }

        return $reason;
    }

    /** @param array<string, string> $params */
    private static function text(string $key, array $params, string $fallback): string
    {
        $fullKey = 'match_reasons.' . $key;
        $translated = __($fullKey, $params);

        return is_string($translated) && $translated !== $fullKey ? $translated : $fallback;
    }

    /** One decimal place, with the reader's decimal separator. */
    private static function distance(float $km): string
    {
        $locale = (string) app()->getLocale();
        if (class_exists(\NumberFormatter::class)) {
            $formatter = new \NumberFormatter($locale !== '' ? $locale : 'en', \NumberFormatter::DECIMAL);
            $formatter->setAttribute(\NumberFormatter::MIN_FRACTION_DIGITS, 1);
            $formatter->setAttribute(\NumberFormatter::MAX_FRACTION_DIGITS, 1);
            $formatted = $formatter->format($km);
            if (is_string($formatted) && $formatted !== '') {
                return $formatted;
            }
        }

        return number_format($km, 1);
    }
}
