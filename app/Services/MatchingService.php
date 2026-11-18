<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * MatchingService — a member's matching preferences and their cached match figures.
 */
class MatchingService
{
    /**
     * Fallbacks used only when the community's matching settings cannot be
     * read. The real defaults come from those settings: see defaults().
     */
    private const DEFAULT_PREFERENCES = [
        'max_distance_km'         => 50,
        'min_match_score'         => 40,
        'notification_frequency'  => 'monthly',
        'notify_hot_matches'      => true,
        'notify_mutual_matches'   => true,
        'matching_paused'         => false,
        'categories'              => [],
        'availability'            => [],
    ];

    /**
     * What applies to a member who has saved nothing, plus the community's
     * distance ceiling.
     *
     * The settings page used to show 25 km and 50% to such a member while
     * the engine was really using the community's own figures (50 km and 40%
     * by default). Worse, saving ANY one setting then wrote 25/50 as if the
     * member had chosen them. The defaults shown are now the ones applied.
     *
     * @return array<string, mixed>
     */
    private static function defaults(): array
    {
        $defaults = self::DEFAULT_PREFERENCES;
        try {
            $config = app(SmartMatchingEngine::class)->getConfig();
            $defaults['max_distance_km'] = max(1, (int) ($config['max_distance_km'] ?? $defaults['max_distance_km']));
            $defaults['min_match_score'] = max(0, min(100, (int) ($config['min_match_score'] ?? $defaults['min_match_score'])));
        } catch (\Throwable $e) {
            Log::warning('[MatchingService] community matching settings unreadable; using fallbacks', [
                'exception' => $e::class,
            ]);
        }
        $defaults['max_distance_limit_km'] = $defaults['max_distance_km'];

        return $defaults;
    }

    public function __construct()
    {
    }

    // NOTE: getSuggestionsForUser(), getHotMatches(), getMutualMatches() and
    // getMatchesByType() used to live here. They returned RANDOM active
    // members (ORDER BY RAND()), not matches, and existed only to feed the
    // match digest, which they crashed. Matches come from
    // SmartMatchingEngine::findMatchesForUser(); notifications from
    // Matching\MatchNotificationService.

    /**
     * Save matching preferences for a user.
     */
    public static function savePreferences($userId, array $preferences)
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $data = [
                'user_id'    => $userId,
                'tenant_id'  => $tenantId,
                'updated_at' => now(),
            ];

            if (isset($preferences['max_distance_km'])) {
                $data['max_distance_km'] = (int) $preferences['max_distance_km'];
            }
            if (isset($preferences['min_match_score'])) {
                $data['min_match_score'] = (int) $preferences['min_match_score'];
            }
            if (isset($preferences['notification_frequency'])) {
                $data['notification_frequency'] = $preferences['notification_frequency'];
            }
            if (isset($preferences['notify_hot_matches'])) {
                $data['notify_hot_matches'] = $preferences['notify_hot_matches'] ? 1 : 0;
            }
            if (isset($preferences['notify_mutual_matches'])) {
                $data['notify_mutual_matches'] = $preferences['notify_mutual_matches'] ? 1 : 0;
            }
            if (isset($preferences['matching_paused'])) {
                $data['matching_paused'] = $preferences['matching_paused'] ? 1 : 0;
            }
            if (isset($preferences['availability']) && is_array($preferences['availability'])) {
                $data['availability'] = json_encode(array_values($preferences['availability']), JSON_UNESCAPED_UNICODE);
            }

            $categories = $preferences['categories'] ?? null;

            // `match_preferences.categories` is the ONLY store for category
            // choices and the column the matching engine reads. There is no
            // side table: a `match_preference_categories` sync used to sit
            // below this write against a table that has never existed in any
            // schema, silently swallowing its own failure at debug level.
            if (is_array($categories)) {
                $data['categories'] = count($categories) > 0
                    ? json_encode(array_values(array_map('intval', $categories)))
                    : null;
            }

            DB::table('match_preferences')->updateOrInsert(
                ['user_id' => $userId, 'tenant_id' => $tenantId],
                $data
            );

            return true;
        } catch (\Throwable $e) {
            Log::warning('Failed to save match preferences', ['user_id' => $userId, 'error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get matching preferences for a user (returns defaults if none saved).
     */
    public static function getPreferences($userId)
    {
        try {
            $row = DB::table('match_preferences')
                ->where('user_id', $userId)
                ->where('tenant_id', \App\Core\TenantContext::getId())
                ->first();

            $defaults = self::defaults();

            if (!$row) {
                return $defaults;
            }

            // The `categories` JSON column is the only source — see the note in
            // savePreferences() about the phantom side table that used to be
            // consulted here as a "fallback".
            $categories = [];
            if (!empty($row->categories)) {
                $decoded = json_decode((string) $row->categories, true);
                if (is_array($decoded)) {
                    $categories = array_values(array_map('intval', $decoded));
                }
            }

            $availability = [];
            if (!empty($row->availability)) {
                $decoded = json_decode((string) $row->availability, true);
                if (is_array($decoded)) {
                    $availability = array_values(array_filter($decoded, 'is_string'));
                }
            }

            // A saved distance can never exceed the community's ceiling (the
            // engine applies the same cap), so show the figure really used.
            $limit = (int) $defaults['max_distance_limit_km'];
            $distance = (int) ($row->max_distance_km ?? $defaults['max_distance_km']);

            return [
                'max_distance_km'        => max(1, min($limit, $distance)),
                'min_match_score'        => (int) ($row->min_match_score ?? $defaults['min_match_score']),
                'notification_frequency' => $row->notification_frequency ?? $defaults['notification_frequency'],
                'notify_hot_matches'     => (bool) ($row->notify_hot_matches ?? $defaults['notify_hot_matches']),
                'notify_mutual_matches'  => (bool) ($row->notify_mutual_matches ?? $defaults['notify_mutual_matches']),
                'matching_paused'        => (bool) ($row->matching_paused ?? false),
                'categories'             => $categories,
                'availability'           => $availability,
                'max_distance_limit_km'  => $limit,
            ];
        } catch (\Throwable $e) {
            Log::error('[MatchingService] getPreferences failed', ['user_id' => $userId, 'exception' => $e::class]);

            return self::DEFAULT_PREFERENCES + ['max_distance_limit_km' => self::DEFAULT_PREFERENCES['max_distance_km']];
        }
    }

    // NOTE: there is deliberately no recordInteraction() here. One used to
    // exist, writing match_history.score / .distance — columns that do not
    // exist (the real ones are match_score / distance_km) — and omitting
    // tenant_id entirely. It had no callers: every live interaction goes
    // through MatchLearningService::recordInteraction(), which uses the
    // correct columns and scopes by tenant. Use that.

    /**
     * Get matching statistics for a user.
     *
     * @return array{total_matches: int, hot_matches: int, mutual_matches: int, avg_score: float|int, avg_distance: float|int}
     */
    public static function getStats($userId): array
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $total = (int) DB::table('match_cache')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->count();

            // match_cache stores these as match_score / distance_km, and marks a
            // reciprocal match with match_type = 'mutual' — there is no `score`,
            // `is_mutual` or `distance` column. Naming them threw on the second
            // query, and the catch below turned the whole method into zeroes.
            $hot = (int) DB::table('match_cache')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('match_score', '>=', 80)
                ->count();

            $mutual = (int) DB::table('match_cache')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('match_type', 'mutual')
                ->count();

            $avgScore = DB::table('match_cache')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->avg('match_score');

            $avgDistance = DB::table('match_cache')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->avg('distance_km');

            return [
                'total_matches'  => $total,
                'hot_matches'    => $hot,
                'mutual_matches' => $mutual,
                'avg_score'      => $avgScore !== null ? round((float) $avgScore, 1) : 0,
                'avg_distance'   => $avgDistance !== null ? round((float) $avgDistance, 1) : 0,
            ];
        } catch (\Throwable $e) {
            return [
                'total_matches'  => 0,
                'hot_matches'    => 0,
                'mutual_matches' => 0,
                'avg_score'      => 0,
                'avg_distance'   => 0,
            ];
        }
    }
}
