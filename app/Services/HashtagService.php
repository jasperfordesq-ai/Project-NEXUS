<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

/**
 * HashtagService — hashtag text parsing.
 *
 * QUERY METHODS REMOVED 2026-09-01. This class also carried getTrending(),
 * getPopular(), search(), getPostsByHashtag(), getPostHashtags() and
 * getBatchPostHashtags(). Every one of them selected `post_hashtags.tag` and
 * joined `feed_activity`, and both were wrong: `post_hashtags` holds
 * (post_id, hashtag_id, tenant_id) with the text living in `hashtags.tag`, and
 * its foreign key points at `feed_posts`, not `feed_activity`. So each method
 * threw, was swallowed by its own catch (\Throwable), and returned an empty
 * array — indistinguishable from "this post has no hashtags".
 *
 * Nothing called them: the working implementation is App\Services\FeedSocialService
 * (getTrendingHashtags() / getHashtagPosts()), which joins `hashtags` correctly.
 * They are deleted rather than repaired so there is one hashtag query path, not
 * two that can drift apart again. Same treatment as CronJobService::run() and
 * ::getHistory(), removed on 2026-08-28 for the same reason.
 *
 * The parsing helpers below touch no database and are correct; they are kept.
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
}
