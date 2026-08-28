<?php
// Copyright � 2024�2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 *
 * Provides dependency-injectable access to the legacy static service methods.
 */
class HashtagService
{
    public function __construct()
    {
    }

    /**
     * Legacy extractTags (alias for extractHashtags).
     */
    public static function extractTags(string $content): array
    {
        return self::extractHashtags($content);
    }

    /**
     * Extract hashtags from text content.
     *
     * Returns unique, lowercase tags (without the # prefix).
     * Ignores tags that are single characters, purely numeric, or longer than 50 chars.
     * Allows letters, digits, underscores, and hyphens.
     *
     * @return string[]
     */
    public static function extractHashtags(string $content): array
    {
        if (empty($content)) {
            return [];
        }

        // Match #tag where tag is 2+ chars, allows letters/digits/underscores/hyphens
        if (!preg_match_all('/#([a-zA-Z][a-zA-Z0-9_\-]{1,49})\b/', $content, $matches)) {
            return [];
        }

        $tags = [];
        foreach ($matches[1] as $tag) {
            $lower = strtolower($tag);
            if (!in_array($lower, $tags, true)) {
                $tags[] = $lower;
            }
        }

        return $tags;
    }

    /**
     * Get trending hashtags with usage counts over a period.
     *
     * @param int $limit Max tags to return
     * @param int $days  Lookback period in days
     * @return array
     */
    public static function getTrending(int $limit = 10, int $days = 7): array
    {
        $tenantId = \App\Core\TenantContext::getId();

        try {
            return array_map(
                fn ($row) => (array) $row,
                \Illuminate\Support\Facades\DB::select(
                    "SELECT h.tag, COUNT(*) as usage_count
                     FROM post_hashtags h
                     INNER JOIN feed_activity fa ON h.post_id = fa.id
                     WHERE fa.tenant_id = ? AND h.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                     GROUP BY h.tag
                     ORDER BY usage_count DESC
                     LIMIT ?",
                    [$tenantId, $days, $limit]
                )
            );
        } catch (\Throwable $e) {
            Log::debug('[Hashtag] getTrending failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get popular hashtags (all-time).
     *
     * @return array
     */
    public static function getPopular(int $limit = 20): array
    {
        $tenantId = \App\Core\TenantContext::getId();

        try {
            return array_map(
                fn ($row) => (array) $row,
                \Illuminate\Support\Facades\DB::select(
                    "SELECT h.tag, COUNT(*) as usage_count
                     FROM post_hashtags h
                     INNER JOIN feed_activity fa ON h.post_id = fa.id
                     WHERE fa.tenant_id = ?
                     GROUP BY h.tag
                     ORDER BY usage_count DESC
                     LIMIT ?",
                    [$tenantId, $limit]
                )
            );
        } catch (\Throwable $e) {
            Log::debug('[Hashtag] getPopular failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Search hashtags by prefix.
     *
     * @return array
     */
    public static function search(string $query, int $limit = 10): array
    {
        $tenantId = \App\Core\TenantContext::getId();
        $query = ltrim($query, '#');

        try {
            return array_map(
                fn ($row) => (array) $row,
                \Illuminate\Support\Facades\DB::select(
                    "SELECT h.tag, COUNT(*) as usage_count
                     FROM post_hashtags h
                     INNER JOIN feed_activity fa ON h.post_id = fa.id
                     WHERE fa.tenant_id = ? AND h.tag LIKE ?
                     GROUP BY h.tag
                     ORDER BY usage_count DESC
                     LIMIT ?",
                    [$tenantId, $query . '%', $limit]
                )
            );
        } catch (\Throwable $e) {
            Log::debug('[Hashtag] search failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get posts by hashtag with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool, tag: string}
     */
    public static function getPostsByHashtag(string $tag, int $limit = 20, ?string $cursor = null): array
    {
        $tenantId = \App\Core\TenantContext::getId();
        $tag = strtolower(ltrim($tag, '#'));

        try {
            $query = \Illuminate\Support\Facades\DB::table('post_hashtags as h')
                ->join('feed_activity as fa', 'h.post_id', '=', 'fa.id')
                ->where('fa.tenant_id', $tenantId)
                ->where('h.tag', $tag)
                ->select('fa.*')
                ->orderByDesc('fa.id');

            if ($cursor !== null) {
                $cursorId = base64_decode($cursor, true);
                if ($cursorId !== false) {
                    $query->where('fa.id', '<', (int) $cursorId);
                }
            }

            $items = $query->limit($limit + 1)->get();
            $hasMore = $items->count() > $limit;
            if ($hasMore) {
                $items->pop();
            }

            return [
                'items'    => $items->map(fn ($row) => (array) $row)->all(),
                'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
                'has_more' => $hasMore,
                'tag'      => $tag,
            ];
        } catch (\Throwable $e) {
            Log::debug('[Hashtag] getPostsByHashtag failed: ' . $e->getMessage());
            return ['items' => [], 'cursor' => null, 'has_more' => false, 'tag' => $tag];
        }
    }

    /**
     * Get hashtags for a specific post.
     *
     * @return string[]
     */
    public static function getPostHashtags(int $postId): array
    {
        try {
            return \Illuminate\Support\Facades\DB::table('post_hashtags')
                ->where('post_id', $postId)
                ->pluck('tag')
                ->all();
        } catch (\Throwable $e) {
            Log::debug('[Hashtag] getPostHashtags failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get hashtags for multiple posts in batch.
     *
     * @param int[] $postIds
     * @return array<int, string[]> Keyed by post_id
     */
    public static function getBatchPostHashtags(array $postIds): array
    {
        if (empty($postIds)) {
            return [];
        }

        try {
            $rows = \Illuminate\Support\Facades\DB::table('post_hashtags')
                ->whereIn('post_id', $postIds)
                ->get();

            $result = [];
            foreach ($rows as $row) {
                $result[(int) $row->post_id][] = $row->tag;
            }

            return $result;
        } catch (\Throwable $e) {
            Log::debug('[Hashtag] getBatchPostHashtags failed: ' . $e->getMessage());
            return [];
        }
    }
}
