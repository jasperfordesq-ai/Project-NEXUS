<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GroupMatchingService — makes group matching REAL for members.
 *
 * Group matching used to be an on-demand keyword-Jaccard against the newest
 * groups (CrossModuleMatchingService::getGroupMatches), invisible to members.
 * This service is a thin orchestrator over the existing, much stronger
 * {@see GroupRecommendationEngine} (CF + content + location + activity fusion,
 * trend boost, MMR diversity):
 *
 *  - warmUpCache(): computes recommendations for active members and upserts
 *    them into group_match_cache (7-day TTL) in the same 30-min cron slot as
 *    the listing match cache. Re-warms preserve status, so a dismissal sticks.
 *  - getMatchesForUser(): serves cached matches (live-compute fallback) in the
 *    cross-module match shape consumed by /v2/matches/all.
 */
class GroupMatchingService
{
    private const CACHE_TTL_DAYS = 7;
    private const RECOMMENDATIONS_PER_USER = 10;
    private const ALGORITHM_VERSION = 'v2';

    private ?bool $cacheTableExists = null;

    public function __construct(
        private readonly GroupRecommendationEngine $recommendationEngine,
    ) {}

    /**
     * Warm group_match_cache for up to $limit active users of the current
     * tenant whose cache entries are missing or expired.
     *
     * @return array{processed: int, cached: int}
     */
    public function warmUpCache(int $limit = 20): array
    {
        $results = ['processed' => 0, 'cached' => 0];
        $tenantId = TenantContext::getId();
        if (!$tenantId || !$this->cacheTableExists()) {
            return $results;
        }

        try {
            // Active users without a fresh group cache, most recently active first.
            $users = DB::select(
                "SELECT DISTINCT u.id
                 FROM users u
                 LEFT JOIN group_match_cache gmc
                     ON u.id = gmc.user_id AND gmc.tenant_id = ?
                 WHERE u.tenant_id = ?
                   AND u.status = 'active'
                   AND (gmc.id IS NULL OR gmc.expires_at < NOW())
                 ORDER BY u.last_login_at DESC
                 LIMIT " . max(1, $limit),
                [$tenantId, $tenantId]
            );
        } catch (\Throwable $e) {
            Log::warning('[GroupMatchingService] warm user query failed', ['error' => $e->getMessage()]);
            return $results;
        }

        foreach ($users as $row) {
            $userId = (int) $row->id;
            $results['processed']++;

            try {
                $recommendations = $this->recommendationEngine->getRecommendations(
                    $userId,
                    self::RECOMMENDATIONS_PER_USER
                );
            } catch (\Throwable $e) {
                Log::warning('[GroupMatchingService] recommendations failed', [
                    'user_id' => $userId, 'error' => $e->getMessage(),
                ]);
                continue;
            }

            foreach ($recommendations as $group) {
                $groupId = (int) ($group['id'] ?? 0);
                if ($groupId <= 0) {
                    continue;
                }

                $score = round(max(0.0, min(1.0, (float) ($group['recommendation_score'] ?? 0))) * 100, 2);
                $reason = (string) ($group['recommendation_reason'] ?? '');
                $reasons = json_encode($reason !== '' ? [$reason] : [], JSON_UNESCAPED_UNICODE) ?: '[]';

                try {
                    // Status deliberately untouched on re-warm: a dismissal or
                    // join recorded by the member must survive cache refreshes.
                    DB::insert(
                        "INSERT INTO group_match_cache
                            (tenant_id, user_id, group_id, match_score, match_reasons, algorithm_version, status, created_at, expires_at)
                         VALUES (?, ?, ?, ?, ?, ?, 'new', NOW(), DATE_ADD(NOW(), INTERVAL " . self::CACHE_TTL_DAYS . " DAY))
                         ON DUPLICATE KEY UPDATE
                            match_score = VALUES(match_score),
                            match_reasons = VALUES(match_reasons),
                            algorithm_version = VALUES(algorithm_version),
                            expires_at = VALUES(expires_at)",
                        [$tenantId, $userId, $groupId, $score, $reasons, self::ALGORITHM_VERSION]
                    );
                    $results['cached']++;
                } catch (\Throwable $e) {
                    Log::warning('[GroupMatchingService] cache write failed', [
                        'user_id' => $userId, 'group_id' => $groupId, 'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        return $results;
    }

    /**
     * Group matches for a user in the cross-module shape used by
     * /v2/matches/all. Cache-first; live-computes (and does not cache) when
     * the cache is cold for this user.
     *
     * @return array<int, array>
     */
    public function getMatchesForUser(int $userId, int $minScore = 30, int $limit = 10): array
    {
        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return [];
        }

        if ($this->cacheTableExists()) {
            try {
                $rows = DB::select(
                    "SELECT gmc.group_id, gmc.match_score, gmc.match_reasons, gmc.created_at as matched_at,
                            g.name, g.description, g.image_url, g.image_alt, g.visibility,
                            (SELECT COUNT(*) FROM group_members gm
                              WHERE gm.group_id = g.id AND gm.status = 'active') as member_count
                     FROM group_match_cache gmc
                     JOIN `groups` g ON g.id = gmc.group_id AND g.tenant_id = gmc.tenant_id
                     WHERE gmc.tenant_id = ? AND gmc.user_id = ?
                       AND gmc.status NOT IN ('dismissed', 'joined')
                       AND gmc.expires_at > NOW()
                       AND gmc.match_score >= ?
                       AND g.status = 'active'
                       AND (g.visibility IS NULL OR g.visibility = 'public')
                       AND gmc.group_id NOT IN (
                           SELECT group_id FROM group_members WHERE user_id = ? AND tenant_id = ?
                       )
                     ORDER BY gmc.match_score DESC
                     LIMIT " . max(1, $limit),
                    [$tenantId, $userId, $minScore, $userId, $tenantId]
                );

                if (!empty($rows)) {
                    return array_map(fn ($row) => $this->toMatchShape((array) $row), $rows);
                }
            } catch (\Throwable $e) {
                Log::debug('[GroupMatchingService] cache read failed: ' . $e->getMessage());
            }
        }

        // Cold cache: live-compute via the recommendation engine.
        try {
            $recommendations = $this->recommendationEngine->getRecommendations($userId, $limit);
        } catch (\Throwable $e) {
            Log::warning('[GroupMatchingService] live recommendations failed', [
                'user_id' => $userId, 'error' => $e->getMessage(),
            ]);
            return [];
        }

        $matches = [];
        foreach ($recommendations as $group) {
            $score = round(max(0.0, min(1.0, (float) ($group['recommendation_score'] ?? 0))) * 100, 1);
            if ($score < $minScore) {
                continue;
            }
            $reason = (string) ($group['recommendation_reason'] ?? '');
            $matches[] = $this->toMatchShape([
                'group_id' => (int) ($group['id'] ?? 0),
                'match_score' => $score,
                'match_reasons' => json_encode($reason !== '' ? [$reason] : []),
                'matched_at' => $group['created_at'] ?? null,
                'name' => $group['name'] ?? '',
                'description' => $group['description'] ?? '',
                'image_url' => $group['image_url'] ?? null,
                'image_alt' => $group['image_alt'] ?? null,
                'visibility' => $group['visibility'] ?? 'public',
                'member_count' => (int) ($group['member_count'] ?? 0),
            ]);
        }

        return array_slice($matches, 0, $limit);
    }

    /** Mark a cached group match with a member interaction. */
    public function markStatus(int $userId, int $groupId, string $status): bool
    {
        if (!in_array($status, ['viewed', 'joined', 'dismissed'], true) || !$this->cacheTableExists()) {
            return false;
        }

        try {
            DB::update(
                "UPDATE group_match_cache SET status = ?
                 WHERE tenant_id = ? AND user_id = ? AND group_id = ?",
                [$status, TenantContext::getId(), $userId, $groupId]
            );
            return true;
        } catch (\Throwable $e) {
            Log::debug('[GroupMatchingService] markStatus failed: ' . $e->getMessage());
            return false;
        }
    }

    private function toMatchShape(array $row): array
    {
        $reasons = [];
        if (!empty($row['match_reasons'])) {
            $decoded = is_string($row['match_reasons'])
                ? json_decode($row['match_reasons'], true)
                : $row['match_reasons'];
            if (is_array($decoded)) {
                $reasons = array_values(array_filter($decoded, 'is_string'));
            }
        }

        return [
            'module' => 'group',
            'group_id' => (int) ($row['group_id'] ?? 0),
            'title' => (string) ($row['name'] ?? ''),
            'description' => mb_substr((string) ($row['description'] ?? ''), 0, 200),
            'image_url' => $row['image_url'] ?? null,
            'image_alt' => GroupService::cleanImageDescription($row['image_alt'] ?? null),
            'member_count' => (int) ($row['member_count'] ?? 0),
            'visibility' => (string) ($row['visibility'] ?? 'public'),
            'match_score' => (float) ($row['match_score'] ?? 0),
            'match_type' => 'group_recommendation',
            'match_reasons' => $reasons,
            'distance_km' => null,
            'is_remote' => false,
            'is_mutual' => false,
            'created_at' => $row['matched_at'] ?? null,
        ];
    }

    private function cacheTableExists(): bool
    {
        if ($this->cacheTableExists !== null) {
            return $this->cacheTableExists;
        }

        try {
            DB::selectOne("SELECT 1 FROM group_match_cache LIMIT 1");
            $this->cacheTableExists = true;
        } catch (\Throwable $e) {
            $this->cacheTableExists = false;
        }

        return $this->cacheTableExists;
    }
}
