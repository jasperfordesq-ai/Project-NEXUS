<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Rules about what a CMS page may contain.
 *
 * CMS pages are public editorial content. They must not become an alternate
 * anonymous member directory, so the public page endpoint hides any page that
 * links to member accounts. The admin editor uses the same check to refuse such
 * a page at save time, instead of letting it be saved and then quietly hidden.
 */
class PageContentPolicy
{
    /**
     * Detect structural references to member-account data without attempting
     * to infer identity from ordinary editorial names or testimonials.
     *
     * Reads `content`, `design_json`, `tenant_id` and (optionally) `id` from the
     * page. Without an `id` the stored page-block check is skipped, because a
     * page that is not stored yet (or whose blocks the editor cannot remove)
     * has none to look at.
     *
     * @param object|array<string, mixed> $page
     */
    public static function linksToMemberProfiles(object|array $page): bool
    {
        $page = (object) $page;

        $content = (string) ($page->content ?? '') . "\n" . (string) ($page->design_json ?? '');
        $content = html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $content = rawurldecode(str_replace(['\/', '\\"', "\'"], ['/', '"', "'"], $content));

        if (preg_match(
            '~/(?:users?|members?|profile)/(?:[0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,})(?=[/?#"\'\\s<]|$)~i',
            $content
        ) === 1) {
            return true;
        }

        if (preg_match(
            '~(?:\bmembers-grid\b|pb-member-(?:card|name|avatar|bio)|data-(?:user|member)-id)~i',
            $content
        ) === 1) {
            return true;
        }

        preg_match_all(
            '~(?:src|avatar(?:_url)?)["\']?\s*[:=]\s*["\']([^"\']{8,2048})["\']~i',
            $content,
            $embeddedImages
        );
        $imageUrls = array_values(array_unique(array_filter(
            array_map('trim', $embeddedImages[1] ?? []),
            static fn (string $url): bool => $url !== ''
        )));

        // Compare only the finite set of embedded image candidates. This keeps
        // the check fail-closed without running LOCATE over every user row.
        $containsAccountAvatar = $imageUrls !== [] && DB::table('users')
            ->where('tenant_id', (int) ($page->tenant_id ?? 0))
            ->whereIn('avatar_url', array_slice($imageUrls, 0, 100))
            ->exists();

        if ($containsAccountAvatar) {
            return true;
        }

        if (!isset($page->id)) {
            return false;
        }

        return DB::table('page_blocks')
            ->where('page_id', (int) $page->id)
            ->where('block_type', 'members-grid')
            ->exists();
    }
}
