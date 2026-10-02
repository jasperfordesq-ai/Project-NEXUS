<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AG35 — PersonalisedFeedService.
 *
 * Orchestrator that re-ranks an existing candidate set (feed activities or
 * listings) using a weighted blend of interest match, recency, collaborative
 * filtering, social graph, and proximity signals. Cold-start users (under
 * MIN_ENGAGEMENT_EVENTS) fall back to recency + popularity. Results are
 * cached per (user_id, content_type) for 10 minutes; engagement events bust
 * the cache via {@see invalidateForUser()}.
 *
 * Reuses {@see SmartMatchingEngine}, {@see CollaborativeFilteringService},
 * and {@see ListingRankingService} — does NOT reimplement them.
 */
class PersonalisedFeedService
{
    /** Cache TTL for scored candidate sets (seconds). */
    public const CACHE_TTL = 600; // 10 minutes

    /** Minimum engagement events before personalisation activates. */
    public const MIN_ENGAGEMENT_EVENTS = 5;

    /** Signal weights — sum to 1.0. */
    public const W_INTEREST    = 0.30;
    public const W_RECENCY     = 0.25;
    public const W_COLLAB      = 0.20;
    public const W_SOCIAL      = 0.15;
    public const W_PROXIMITY   = 0.10;

    public function __construct() {}

    /**
     * Rank a candidate set in-place for a given user and content type.
     *
     * @param int    $userId
     * @param string $contentType  feed|listings
     * @param array  $candidates   Array of items (each with at minimum 'id', 'created_at', and optionally 'user_id', 'category_id', 'lat', 'lng')
     * @return array Re-ordered candidates (highest score first)
     */
    public function rank(int $userId, string $contentType, array $candidates): array
    {
        if (empty($candidates) || $userId <= 0) {
            return $candidates;
        }

        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return $candidates;
        }

        // Cold-start: fall back to recency + popularity
        if (!$this->hasMinEngagement($userId, $tenantId)) {
            return $this->coldStartSort($candidates);
        }

        // Cache the *ordering* of the candidate set so identical pages don't recompute.
        $orderKey = $this->orderCacheKey($tenantId, $userId, $contentType, $candidates);
        $orderById = Cache::get($orderKey);
        if (is_array($orderById) && !empty($orderById)) {
            return $this->applyOrder($candidates, $orderById);
        }

        try {
            $scored = $this->scoreCandidates($userId, $tenantId, $contentType, $candidates);
            usort($scored, static fn ($a, $b) => ($b['_score'] ?? 0) <=> ($a['_score'] ?? 0));

            $orderById = [];
            foreach ($scored as $i => $item) {
                $orderById[(string) ($item['id'] ?? $item['source_id'] ?? $i)] = $i;
            }
            Cache::put($orderKey, $orderById, self::CACHE_TTL);

            // Strip internal score before returning to caller
            return array_map(static function ($item) {
                unset($item['_score'], $item['_score_breakdown']);
                return $item;
            }, $scored);
        } catch (\Throwable $e) {
            Log::warning('PersonalisedFeedService::rank failed; falling back to recency', [
                'user_id'      => $userId,
                'content_type' => $contentType,
                'error'        => $e->getMessage(),
            ]);
            return $candidates;
        }
    }

    /**
     * Bust the cached ordering for this user (call after any new engagement event).
     */
    public function invalidateForUser(int $userId): void
    {
        $tenantId = TenantContext::getId();
        if (!$tenantId || $userId <= 0) {
            return;
        }
        // Clear via tag-style key prefix (Laravel Cache::flush is too aggressive — we just bump a version key).
        $versionKey = "pfs:v:{$tenantId}:{$userId}";
        Cache::increment($versionKey);
    }

    /**
     * Whether the user has crossed the cold-start threshold.
     */
    public function hasMinEngagement(int $userId, int $tenantId): bool
    {
        $cacheKey = "pfs:engagement_count:{$tenantId}:{$userId}";
        return (bool) Cache::remember($cacheKey, 300, function () use ($userId, $tenantId) {
            $count = 0;
            try {
                // Likes live in the unified `likes` table (target_type='post')
                // — there is no `feed_post_likes` table. The previous reference
                // to it caused hasTable() to short-circuit to false, leaving
                // every user permanently in cold-start mode and AG35
                // personalisation effectively dead.
                if (\Illuminate\Support\Facades\Schema::hasTable('likes')) {
                    $count += (int) DB::table('likes')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->limit(self::MIN_ENGAGEMENT_EVENTS)
                        ->count();
                }
                if ($count < self::MIN_ENGAGEMENT_EVENTS && \Illuminate\Support\Facades\Schema::hasTable('reactions')) {
                    $count += (int) DB::table('reactions')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->limit(self::MIN_ENGAGEMENT_EVENTS)
                        ->count();
                }
                if ($count < self::MIN_ENGAGEMENT_EVENTS && \Illuminate\Support\Facades\Schema::hasTable('bookmarks')) {
                    $count += (int) DB::table('bookmarks')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->limit(self::MIN_ENGAGEMENT_EVENTS)
                        ->count();
                }
            } catch (\Throwable $e) {
                // If we can't check, assume cold-start (safer for new users)
                return false;
            }
            return $count >= self::MIN_ENGAGEMENT_EVENTS;
        });
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * Score a candidate set with weighted signals.
     */
    private function scoreCandidates(int $userId, int $tenantId, string $contentType, array $candidates): array
    {
        $userCtx = $this->loadUserContext($userId, $tenantId);
        $listingTerms = empty($userCtx['skills'])
            ? []
            : $this->loadListingTerms($tenantId, $contentType, $candidates);
        $similarUserIds = $this->loadSimilarUsers($userId, $tenantId);
        $connectedUserIds = $this->loadConnectedUsers($userId, $tenantId);
        $engagedAuthorIds = $this->loadEngagedAuthors($userId, $tenantId, $similarUserIds);

        $now = time();

        foreach ($candidates as &$item) {
            $interest = $this->signalInterestMatch($item, $userCtx, $listingTerms, $contentType);
            $recency  = $this->signalRecency($item, $now);
            $collab   = $this->signalCollab($item, $engagedAuthorIds);
            $social   = $this->signalSocial($item, $connectedUserIds);
            $proximity = $this->signalProximity($item, $userCtx);

            $score =
                self::W_INTEREST * $interest +
                self::W_RECENCY * $recency +
                self::W_COLLAB * $collab +
                self::W_SOCIAL * $social +
                self::W_PROXIMITY * $proximity;

            $item['_score'] = $score;
            $item['_score_breakdown'] = compact('interest', 'recency', 'collab', 'social', 'proximity');
        }
        unset($item);

        return $candidates;
    }

    private function coldStartSort(array $candidates): array
    {
        // Recency-first; tiebreak on popularity (likes/views) when present.
        $now = time();
        usort($candidates, function ($a, $b) use ($now) {
            $ra = $this->signalRecency($a, $now);
            $rb = $this->signalRecency($b, $now);
            if ($ra !== $rb) {
                return $rb <=> $ra;
            }
            $pa = (int) ($a['likes_count'] ?? $a['views'] ?? 0);
            $pb = (int) ($b['likes_count'] ?? $b['views'] ?? 0);
            return $pb <=> $pa;
        });
        return $candidates;
    }

    /**
     * Interest match: does the item's listing category name or one of its
     * skill tags equal one of the member's skill names?
     *
     * Compared by name, not id: user_skills.category_id references
     * skill_categories while listings.category_id references categories, so
     * the two ids are unrelated numbers.
     *
     * @param array<int, list<string>> $listingTerms listing id => lower-cased category name + skill tags
     */
    private function signalInterestMatch(array $item, array $ctx, array $listingTerms, string $contentType): float
    {
        $skills = $ctx['skills'] ?? [];
        if (empty($skills)) {
            return 0.5; // neutral
        }
        $listingId = $this->listingIdOf($item, $contentType);
        $terms = $listingId > 0 ? ($listingTerms[$listingId] ?? []) : [];
        if (empty($terms)) {
            return 0.4;
        }
        return array_intersect($terms, $skills) !== [] ? 1.0 : 0.2;
    }

    /** Listing id of a candidate, or 0 when the item is not a listing. */
    private function listingIdOf(array $item, string $contentType): int
    {
        if ($contentType === 'listings' || ($item['type'] ?? null) === 'listing') {
            return (int) ($item['id'] ?? 0);
        }
        return 0;
    }

    /**
     * Lower-cased category name and skill tags for every listing candidate,
     * all scoped to the tenant.
     *
     * @return array<int, list<string>>
     */
    private function loadListingTerms(int $tenantId, string $contentType, array $candidates): array
    {
        $ids = [];
        foreach ($candidates as $item) {
            $id = $this->listingIdOf($item, $contentType);
            if ($id > 0) {
                $ids[$id] = true;
            }
        }
        if ($ids === []) {
            return [];
        }
        $ids = array_keys($ids);

        $terms = [];
        $add = static function (int $listingId, ?string $term) use (&$terms): void {
            $term = mb_strtolower(trim((string) $term));
            if ($term !== '') {
                $terms[$listingId][$term] = true;
            }
        };

        DB::table('listings as l')
            ->join('categories as cat', function ($join) use ($tenantId) {
                $join->on('cat.id', '=', 'l.category_id')->where('cat.tenant_id', '=', $tenantId);
            })
            ->where('l.tenant_id', $tenantId)
            ->whereIn('l.id', $ids)
            ->get(['l.id', 'cat.name'])
            ->each(fn ($row) => $add((int) $row->id, $row->name));

        DB::table('listing_skill_tags')
            ->where('tenant_id', $tenantId)
            ->whereIn('listing_id', $ids)
            ->get(['listing_id', 'tag'])
            ->each(fn ($row) => $add((int) $row->listing_id, $row->tag));

        return array_map(static fn (array $set) => array_keys($set), $terms);
    }

    private function signalRecency(array $item, int $now): float
    {
        $createdAt = $item['created_at'] ?? null;
        if (!$createdAt) {
            return 0.0;
        }
        $ts = is_numeric($createdAt) ? (int) $createdAt : strtotime((string) $createdAt);
        if (!$ts) {
            return 0.0;
        }
        $ageHours = max(0, ($now - $ts) / 3600);
        // exp half-life: 48h half-life
        return (float) exp(-$ageHours / 70);
    }

    private function signalCollab(array $item, array $engagedAuthorIds): float
    {
        if (empty($engagedAuthorIds)) {
            return 0.5;
        }
        $authorId = (int) ($item['user_id'] ?? 0);
        return $authorId > 0 && isset($engagedAuthorIds[$authorId]) ? 1.0 : 0.3;
    }

    private function signalSocial(array $item, array $connectedUserIds): float
    {
        if (empty($connectedUserIds)) {
            return 0.5;
        }
        $authorId = (int) ($item['user_id'] ?? 0);
        return $authorId > 0 && isset($connectedUserIds[$authorId]) ? 1.0 : 0.3;
    }

    private function signalProximity(array $item, array $ctx): float
    {
        $userLat = $ctx['lat'] ?? null;
        $userLng = $ctx['lng'] ?? null;
        if ($userLat === null || $userLng === null) {
            return 0.5;
        }
        $itemLat = $item['lat'] ?? null;
        $itemLng = $item['lng'] ?? null;
        if ($itemLat === null || $itemLng === null) {
            return 0.4;
        }
        $km = $this->haversineKm((float) $userLat, (float) $userLng, (float) $itemLat, (float) $itemLng);
        if ($km <= 5)   return 1.0;
        if ($km <= 15)  return 0.85;
        if ($km <= 30)  return 0.65;
        if ($km <= 50)  return 0.45;
        if ($km <= 100) return 0.25;
        return 0.1;
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function loadUserContext(int $userId, int $tenantId): array
    {
        $cacheKey = "pfs:userctx:v2:{$tenantId}:{$userId}";
        return Cache::remember($cacheKey, 300, function () use ($userId, $tenantId) {
            $u = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'latitude', 'longitude'])
                ->first();

            // Skill names, lower-cased, matched against listing category
            // names and skill tags. user_skills.category_id is a
            // skill_categories id and is NULL for wizard-saved skills, so it
            // cannot be compared with a listing's category_id.
            $skills = [];
            try {
                if (\Illuminate\Support\Facades\Schema::hasTable('user_skills')) {
                    $skills = DB::table('user_skills')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->limit(50)
                        ->pluck('skill_name')
                        ->map(fn ($name) => mb_strtolower(trim((string) $name)))
                        ->filter(fn ($name) => $name !== '')
                        ->unique()
                        ->values()
                        ->all();
                }
            } catch (\Throwable $e) {
                $skills = [];
            }

            return [
                'lat'        => $u?->latitude,
                'lng'        => $u?->longitude,
                'skills'     => $skills,
            ];
        });
    }

    /**
     * Users similar to the current user (by listing co-engagement).
     * Returns up to 25 user IDs.
     */
    private function loadSimilarUsers(int $userId, int $tenantId): array
    {
        $cacheKey = "pfs:similar_users:{$tenantId}:{$userId}";
        return Cache::remember($cacheKey, 1800, function () use ($userId, $tenantId) {
            try {
                if (!\Illuminate\Support\Facades\Schema::hasTable('bookmarks')) {
                    return [];
                }
                $myBookmarked = DB::table('bookmarks')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->pluck('bookmarkable_id')
                    ->unique()
                    ->values()
                    ->all();
                if (empty($myBookmarked)) {
                    return [];
                }
                return DB::table('bookmarks')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('bookmarkable_id', $myBookmarked)
                    ->where('user_id', '!=', $userId)
                    ->groupBy('user_id')
                    ->orderByRaw('COUNT(*) DESC')
                    ->limit(25)
                    ->pluck('user_id')
                    ->map(fn ($v) => (int) $v)
                    ->all();
            } catch (\Throwable $e) {
                return [];
            }
        });
    }

    /**
     * Authors that the user's similar users have engaged with — flat ID lookup.
     *
     * @return array<int,bool> map keyed by user_id
     */
    private function loadEngagedAuthors(int $userId, int $tenantId, array $similarUserIds): array
    {
        if (empty($similarUserIds)) {
            return [];
        }
        $cacheKey = "pfs:engaged_authors:{$tenantId}:{$userId}";
        return Cache::remember($cacheKey, 900, function () use ($similarUserIds, $tenantId) {
            try {
                // Likes are in the polymorphic `likes` table (target_type='post').
                if (!\Illuminate\Support\Facades\Schema::hasTable('likes')) {
                    return [];
                }
                $rows = DB::table('likes as l')
                    ->join('feed_posts as fp', 'fp.id', '=', 'l.target_id')
                    ->where('l.tenant_id', $tenantId)
                    ->where('l.target_type', 'post')
                    ->whereIn('l.user_id', $similarUserIds)
                    ->limit(500)
                    ->pluck('fp.user_id')
                    ->all();
                $map = [];
                foreach ($rows as $r) {
                    $map[(int) $r] = true;
                }
                return $map;
            } catch (\Throwable $e) {
                return [];
            }
        });
    }

    /**
     * @return array<int,bool>
     */
    private function loadConnectedUsers(int $userId, int $tenantId): array
    {
        $cacheKey = "pfs:connections:{$tenantId}:{$userId}";
        return Cache::remember($cacheKey, 900, function () use ($userId, $tenantId) {
            try {
                if (!\Illuminate\Support\Facades\Schema::hasTable('connections')) {
                    return [];
                }
                $rows = DB::table('connections')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'accepted')
                    ->where(function ($q) use ($userId) {
                        $q->where('requester_id', $userId)->orWhere('receiver_id', $userId);
                    })
                    ->select(['requester_id', 'receiver_id'])
                    ->get();
                $map = [];
                foreach ($rows as $r) {
                    $other = ((int) $r->requester_id) === $userId ? (int) $r->receiver_id : (int) $r->requester_id;
                    $map[$other] = true;
                }
                return $map;
            } catch (\Throwable $e) {
                return [];
            }
        });
    }

    private function orderCacheKey(int $tenantId, int $userId, string $contentType, array $candidates): string
    {
        $version = (int) (Cache::get("pfs:v:{$tenantId}:{$userId}") ?? 0);
        $ids = [];
        foreach ($candidates as $c) {
            $ids[] = (int) ($c['id'] ?? $c['source_id'] ?? 0);
        }
        $hash = sha1(implode(',', $ids));
        return "pfs:order:{$tenantId}:{$userId}:{$contentType}:{$version}:{$hash}";
    }

    private function applyOrder(array $candidates, array $orderById): array
    {
        usort($candidates, static function ($a, $b) use ($orderById) {
            $ka = (string) ($a['id'] ?? $a['source_id'] ?? 0);
            $kb = (string) ($b['id'] ?? $b['source_id'] ?? 0);
            return ($orderById[$ka] ?? PHP_INT_MAX) <=> ($orderById[$kb] ?? PHP_INT_MAX);
        });
        return $candidates;
    }
}
