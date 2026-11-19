<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * TenantMatchingContext — one batched load of everything MatchScorer needs
 * about a searcher and a set of candidate owners.
 *
 * The v1 engine fired one reciprocity query PER CANDIDATE plus per-category
 * lookups (N+1 over up to 800 candidates). This loader replaces that with a
 * fixed handful of IN() queries per findMatchesForUser() call:
 *
 *   categories map · directional user_skills · owner meta (activity/trust/
 *   fallback skills) · review aggregates · completed-transaction counts ·
 *   live listings per owner (their categories, and their words: whether two
 *   members can help EACH OTHER is judged on what their listings say)
 *
 * Every query degrades to an empty map on failure — the scorer's deflated
 * unknown-signal defaults handle missing data.
 */
final class TenantMatchingContext
{
    /** Listings read per member and kind for the two-way check, newest first. */
    private const LISTINGS_PER_MEMBER = 8;

    /** Proficiency multipliers for directional skill weights. */
    private const PROFICIENCY_WEIGHTS = [
        'beginner' => 0.7,
        'intermediate' => 1.0,
        'advanced' => 1.2,
        'expert' => 1.4,
    ];

    private function __construct(
        /** Searcher profile in MatchScorer shape (give/want keywords, category sets, availability). */
        public readonly array $searcher,
        /** @var array<int, array> ownerId => owner profile in MatchScorer shape */
        public readonly array $owners,
        /** @var array<int, array{name: string, parent_id: ?int}> */
        public readonly array $categories,
    ) {}

    /**
     * @param int[] $ownerIds Candidate listing owners
     * @param array $searcherListings The searcher's own active listings (already loaded by the engine)
     * @param array|null $preferences The searcher's match_preferences row (already loaded by the engine)
     * @param array|null $searcherUserData The searcher's users row (for the legacy skills-text fallback)
     */
    public static function load(
        int $tenantId,
        int $searcherId,
        array $ownerIds,
        array $searcherListings = [],
        ?array $preferences = null,
        ?array $searcherUserData = null
    ): self {
        $ownerIds = array_values(array_unique(array_filter(array_map('intval', $ownerIds))));

        $categories = self::loadCategories($tenantId);
        $skillsByUser = self::loadDirectionalSkills($tenantId, array_merge($ownerIds, [$searcherId]));
        $ownerMeta = self::loadOwnerMeta($tenantId, $ownerIds);
        $reviewAgg = self::loadReviewAggregates($tenantId, $ownerIds);
        $txCounts = self::loadCompletedTxCounts($tenantId, $ownerIds);
        $listingsByOwner = self::loadOwnerListings($tenantId, $ownerIds);

        // ── Searcher profile ──
        $searcherSkills = $skillsByUser[$searcherId] ?? ['give' => [], 'want' => []];
        if (empty($searcherSkills['give']) && empty($searcherSkills['want'])) {
            $searcherSkills['give'] = self::keywordsFromText((string) ($searcherUserData['skills'] ?? ''));
        }

        $searcher = [
            'give_keywords' => $searcherSkills['give'],
            'want_keywords' => $searcherSkills['want'],
            'offer_category_ids' => self::categoryIdsOfType($searcherListings, 'offer'),
            'request_category_ids' => self::categoryIdsOfType($searcherListings, 'request'),
            'offers' => self::listingWords($searcherListings, 'offer'),
            'requests' => self::listingWords($searcherListings, 'request'),
            'availability' => $preferences['availability'] ?? null,
        ];

        // ── Owner profiles ──
        $owners = [];
        foreach ($ownerIds as $ownerId) {
            $skills = $skillsByUser[$ownerId] ?? ['give' => [], 'want' => []];
            $meta = $ownerMeta[$ownerId] ?? [];

            if (empty($skills['give']) && empty($skills['want'])) {
                $skills['give'] = self::keywordsFromText((string) ($meta['skills'] ?? ''));
            }

            $lastActiveDays = null;
            if (!empty($meta['last_active_at'])) {
                $ts = strtotime((string) $meta['last_active_at']);
                if ($ts !== false) {
                    $lastActiveDays = max(0.0, (time() - $ts) / 86400);
                }
            }

            $ownerListings = $listingsByOwner[$ownerId] ?? [];

            $owners[$ownerId] = [
                'give_keywords' => $skills['give'],
                'want_keywords' => $skills['want'],
                'offer_category_ids' => $ownerListings['offer'] ?? [],
                'request_category_ids' => $ownerListings['request'] ?? [],
                'offers' => $ownerListings['offers'] ?? [],
                'requests' => $ownerListings['requests'] ?? [],
                'has_active_listings' => !empty($ownerListings['offers']) || !empty($ownerListings['requests']),
                'last_active_days' => $lastActiveDays,
                'trust_tier' => isset($meta['trust_tier']) && is_numeric($meta['trust_tier'])
                    ? (float) $meta['trust_tier'] : null,
                'rating_avg' => isset($reviewAgg[$ownerId]) ? (float) $reviewAgg[$ownerId]['avg'] : null,
                'rating_count' => isset($reviewAgg[$ownerId]) ? (int) $reviewAgg[$ownerId]['count'] : 0,
                'completed_tx' => (int) ($txCounts[$ownerId] ?? 0),
            ];
        }

        return new self($searcher, $owners, $categories);
    }

    /** Owner profile for the scorer; a safe empty profile when unknown. */
    public function owner(int $ownerId): array
    {
        return $this->owners[$ownerId] ?? [
            'give_keywords' => [], 'want_keywords' => [],
            'offer_category_ids' => [], 'request_category_ids' => [],
            'offers' => [], 'requests' => [],
            'has_active_listings' => false,
            'last_active_days' => null, 'trust_tier' => null,
            'rating_avg' => null, 'rating_count' => 0, 'completed_tx' => 0,
        ];
    }

    // ═════════════════════════════════════════════════════════════════════
    // LOADERS (each degrades to empty on failure)
    // ═════════════════════════════════════════════════════════════════════

    private static function loadCategories(int $tenantId): array
    {
        try {
            $rows = DB::select(
                "SELECT id, name, parent_id FROM categories WHERE tenant_id = ?",
                [$tenantId]
            );
            $map = [];
            foreach ($rows as $row) {
                $map[(int) $row->id] = [
                    'name' => (string) $row->name,
                    'parent_id' => isset($row->parent_id) ? (int) $row->parent_id : null,
                ];
            }
            return $map;
        } catch (\Throwable $e) {
            Log::debug('[TenantMatchingContext] categories load failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Directional weighted skill keywords per user from user_skills.
     * is_offering → give, is_requesting → want, unflagged → give (legacy rows).
     *
     * @return array<int, array{give: array<string,float>, want: array<string,float>}>
     */
    private static function loadDirectionalSkills(int $tenantId, array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds))));
        if (empty($userIds)) {
            return [];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($userIds), '?'));
            $rows = DB::select(
                "SELECT user_id, skill_name, proficiency, is_offering, is_requesting
                 FROM user_skills
                 WHERE tenant_id = ? AND user_id IN ($placeholders)",
                array_merge([$tenantId], $userIds)
            );

            $map = [];
            foreach ($rows as $row) {
                $userId = (int) $row->user_id;
                $weight = self::PROFICIENCY_WEIGHTS[strtolower((string) ($row->proficiency ?? ''))] ?? 1.0;
                $terms = KeywordExtractor::extract((string) $row->skill_name);
                if (empty($terms)) {
                    continue;
                }

                $map[$userId] ??= ['give' => [], 'want' => []];
                $isOffering = !empty($row->is_offering);
                $isRequesting = !empty($row->is_requesting);
                if (!$isOffering && !$isRequesting) {
                    $isOffering = true; // legacy rows without direction flags
                }

                foreach ($terms as $term) {
                    if ($isOffering) {
                        $map[$userId]['give'][$term] = max($map[$userId]['give'][$term] ?? 0.0, $weight);
                    }
                    if ($isRequesting) {
                        $map[$userId]['want'][$term] = max($map[$userId]['want'][$term] ?? 0.0, $weight);
                    }
                }
            }
            return $map;
        } catch (\Throwable $e) {
            Log::debug('[TenantMatchingContext] user_skills load failed: ' . $e->getMessage());
            return [];
        }
    }

    /** @return array<int, array> ownerId => users row slice */
    private static function loadOwnerMeta(int $tenantId, array $ownerIds): array
    {
        if (empty($ownerIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
        $params = array_merge([$tenantId], $ownerIds);

        try {
            $rows = DB::select(
                "SELECT id, last_active_at, trust_tier, skills
                 FROM users WHERE tenant_id = ? AND id IN ($placeholders)",
                $params
            );
        } catch (\Throwable $e) {
            // trust_tier may not exist on older schemas — retry without it.
            try {
                $rows = DB::select(
                    "SELECT id, last_active_at, skills
                     FROM users WHERE tenant_id = ? AND id IN ($placeholders)",
                    $params
                );
            } catch (\Throwable $e2) {
                Log::debug('[TenantMatchingContext] owner meta load failed: ' . $e2->getMessage());
                return [];
            }
        }

        $map = [];
        foreach ($rows as $row) {
            $map[(int) $row->id] = (array) $row;
        }
        return $map;
    }

    /**
     * Published reviews only, the rule the profile pages use (ReviewService).
     * Reviews waiting for a moderator, and ones a moderator rejected, used to
     * count towards the trust score and the "highly rated" reason.
     *
     * @return array<int, array{avg: float, count: int}>
     */
    private static function loadReviewAggregates(int $tenantId, array $ownerIds): array
    {
        if (empty($ownerIds)) {
            return [];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            $rows = DB::select(
                "SELECT receiver_id, AVG(rating) as avg_rating, COUNT(*) as cnt
                 FROM reviews
                 WHERE tenant_id = ? AND receiver_id IN ($placeholders)
                   AND (status IS NULL OR status = 'approved')
                 GROUP BY receiver_id",
                array_merge([$tenantId], $ownerIds)
            );

            $map = [];
            foreach ($rows as $row) {
                $map[(int) $row->receiver_id] = [
                    'avg' => (float) $row->avg_rating,
                    'count' => (int) $row->cnt,
                ];
            }
            return $map;
        } catch (\Throwable $e) {
            Log::debug('[TenantMatchingContext] review aggregates load failed: ' . $e->getMessage());
            return [];
        }
    }

    /** @return array<int, int> ownerId => completed transaction count */
    private static function loadCompletedTxCounts(int $tenantId, array $ownerIds): array
    {
        if (empty($ownerIds)) {
            return [];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            $rows = DB::select(
                "SELECT u_id, COUNT(*) as cnt FROM (
                    SELECT sender_id as u_id FROM transactions
                     WHERE tenant_id = ? AND status = 'completed' AND sender_id IN ($placeholders)
                    UNION ALL
                    SELECT receiver_id as u_id FROM transactions
                     WHERE tenant_id = ? AND status = 'completed' AND receiver_id IN ($placeholders)
                 ) t GROUP BY u_id",
                array_merge([$tenantId], $ownerIds, [$tenantId], $ownerIds)
            );

            $map = [];
            foreach ($rows as $row) {
                $map[(int) $row->u_id] = (int) $row->cnt;
            }
            return $map;
        } catch (\Throwable $e) {
            Log::debug('[TenantMatchingContext] tx counts load failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Each owner's live listings: the category ids per kind ('offer' /
     * 'request'), and the title and words of the newest few per kind
     * ('offers' / 'requests'). Only listings a member could be shown count:
     * approved and not past their expiry, the same rule as CandidateRetriever.
     *
     * @return array<int, array{offer: int[], request: int[], offers: array<int, array{title: string, keywords: string[]}>, requests: array<int, array{title: string, keywords: string[]}>}>
     */
    private static function loadOwnerListings(int $tenantId, array $ownerIds): array
    {
        if (empty($ownerIds)) {
            return [];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            $rows = DB::select(
                "SELECT user_id, type, category_id, title, description FROM listings
                 WHERE tenant_id = ? AND status = 'active' AND user_id IN ($placeholders)
                   AND (moderation_status IS NULL OR moderation_status = 'approved')
                   AND (expires_at IS NULL OR expires_at > NOW())
                 ORDER BY created_at DESC",
                array_merge([$tenantId], $ownerIds)
            );

            $map = [];
            foreach ($rows as $row) {
                $ownerId = (int) $row->user_id;
                $type = ((string) $row->type) === 'offer' ? 'offer' : 'request';
                $map[$ownerId] ??= ['offer' => [], 'request' => [], 'offers' => [], 'requests' => []];
                if (!empty($row->category_id)) {
                    $map[$ownerId][$type][] = (int) $row->category_id;
                }
                if (count($map[$ownerId][$type . 's']) < self::LISTINGS_PER_MEMBER) {
                    $map[$ownerId][$type . 's'][] = self::words((string) ($row->title ?? ''), (string) ($row->description ?? ''));
                }
            }
            return $map;
        } catch (\Throwable $e) {
            // Without it no two-way match can be found from listings, which
            // is worth knowing about, so this one is not logged at debug.
            Log::warning('[TenantMatchingContext] owner listings load failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * The searcher's own listings of one kind, in the same shape.
     *
     * @return array<int, array{title: string, keywords: string[]}>
     */
    private static function listingWords(array $listings, string $type): array
    {
        $out = [];
        foreach ($listings as $listing) {
            if (($listing['type'] ?? '') !== $type) {
                continue;
            }
            $out[] = self::words((string) ($listing['title'] ?? ''), (string) ($listing['description'] ?? ''));
            if (count($out) >= self::LISTINGS_PER_MEMBER) {
                break;
            }
        }
        return $out;
    }

    /** @return array{title: string, keywords: string[]} */
    private static function words(string $title, string $description): array
    {
        return [
            'title' => $title,
            'keywords' => KeywordExtractor::extract($title . ' ' . strip_tags($description)),
        ];
    }

    // ═════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═════════════════════════════════════════════════════════════════════

    /** @return array<string, float> */
    private static function keywordsFromText(string $text): array
    {
        $out = [];
        foreach (KeywordExtractor::extract($text) as $term) {
            $out[$term] = 1.0;
        }
        return $out;
    }

    /** @return int[] */
    private static function categoryIdsOfType(array $listings, string $type): array
    {
        $ids = [];
        foreach ($listings as $listing) {
            if (($listing['type'] ?? '') === $type && !empty($listing['category_id'])) {
                $ids[] = (int) $listing['category_id'];
            }
        }
        return array_values(array_unique($ids));
    }
}
