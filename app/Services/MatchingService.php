<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * MatchingService — handles match suggestions, preferences, and interaction tracking.
 */
class MatchingService
{
    /** Default preference values */
    private const DEFAULT_PREFERENCES = [
        'max_distance_km'         => 25,
        'min_match_score'         => 50,
        'notification_frequency'  => 'monthly',
        'notify_hot_matches'      => true,
        'notify_mutual_matches'   => true,
        'categories'              => [],
    ];

    public function __construct()
    {
    }

    /**
     * Get match suggestions for a user.
     */
    public static function getSuggestionsForUser($userId, $limit = 5, array $options = [])
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();
            $userId = (int) $userId;
            $limit = max(1, min(100, (int) $limit));
            $candidateLimit = min(500, max($limit, $limit * 5));

            $candidates = DB::select(
                "SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.location, u.skills
                 FROM users u
                 WHERE u.tenant_id = ? AND u.id != ? AND u.status = 'active' AND u.is_approved = 1
                 ORDER BY RAND()
                 LIMIT ?",
                [$tenantId, $userId, $candidateLimit]
            );

            $policy = app(SafeguardingInteractionPolicy::class);
            $suggestions = [];
            foreach ($candidates as $candidate) {
                $candidateId = (int) ($candidate->id ?? 0);
                if ($candidateId <= 0) {
                    continue;
                }

                $requesterToCandidate = $policy->evaluateLocalContact(
                    $userId,
                    $candidateId,
                    $tenantId,
                    'legacy_match_suggestion',
                );
                $candidateToRequester = $policy->evaluateLocalContact(
                    $candidateId,
                    $userId,
                    $tenantId,
                    'legacy_match_suggestion',
                );
                if (! $requesterToCandidate->isAllowed() || ! $candidateToRequester->isAllowed()) {
                    continue;
                }

                $suggestions[] = $candidate;
                if (count($suggestions) >= $limit) {
                    break;
                }
            }

            return $suggestions;
        } catch (\Throwable $e) {
            Log::debug('[MatchingService] getSuggestionsForUser failed closed', [
                'exception' => $e::class,
            ]);
            return [];
        }
    }

    /**
     * Get hot matches for a user.
     */
    public static function getHotMatches($userId, $limit = 5)
    {
        return self::getSuggestionsForUser($userId, $limit) ?? [];
    }

    /**
     * Get mutual matches for a user.
     */
    public static function getMutualMatches($userId, $limit = 10)
    {
        return [];
    }

    /**
     * Get matches grouped by type.
     *
     * @return array{hot: array, good: array, mutual: array, all: array}
     */
    public static function getMatchesByType($userId)
    {
        $hot = self::getHotMatches($userId, 5);
        $mutual = self::getMutualMatches($userId, 5);

        return [
            'hot'    => is_array($hot) ? $hot : [],
            'good'   => [],
            'mutual' => is_array($mutual) ? $mutual : [],
            'all'    => is_array($hot) ? $hot : [],
        ];
    }

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

            if (!$row) {
                return self::DEFAULT_PREFERENCES;
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

            return [
                'max_distance_km'        => (int) ($row->max_distance_km ?? self::DEFAULT_PREFERENCES['max_distance_km']),
                'min_match_score'        => (int) ($row->min_match_score ?? self::DEFAULT_PREFERENCES['min_match_score']),
                'notification_frequency' => $row->notification_frequency ?? self::DEFAULT_PREFERENCES['notification_frequency'],
                'notify_hot_matches'     => (bool) ($row->notify_hot_matches ?? self::DEFAULT_PREFERENCES['notify_hot_matches']),
                'notify_mutual_matches'  => (bool) ($row->notify_mutual_matches ?? self::DEFAULT_PREFERENCES['notify_mutual_matches']),
                'matching_paused'        => (bool) ($row->matching_paused ?? false),
                'categories'             => $categories,
                'availability'           => $availability,
            ];
        } catch (\Throwable $e) {
            return self::DEFAULT_PREFERENCES;
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
                ->where('user_id', $userId)
                ->count();

            // match_cache stores these as match_score / distance_km, and marks a
            // reciprocal match with match_type = 'mutual' — there is no `score`,
            // `is_mutual` or `distance` column. Naming them threw on the second
            // query, and the catch below turned the whole method into zeroes.
            $hot = (int) DB::table('match_cache')
                ->where('user_id', $userId)
                ->where('match_score', '>=', 80)
                ->count();

            $mutual = (int) DB::table('match_cache')
                ->where('user_id', $userId)
                ->where('match_type', 'mutual')
                ->count();

            $avgScore = DB::table('match_cache')
                ->where('user_id', $userId)
                ->avg('match_score');

            $avgDistance = DB::table('match_cache')
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

    /**
     * Send notifications for new matches.
     *
     * @return int Number of notifications sent
     */
    public static function notifyNewMatches($userId): int
    {
        // Stub: notifications are handled elsewhere
        return 0;
    }
}
