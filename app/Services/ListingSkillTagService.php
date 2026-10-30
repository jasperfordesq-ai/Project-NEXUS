<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\ListingSkillTag;
use Illuminate\Support\Facades\DB;

/**
 * ListingSkillTagService — skill tag management for listings.
 *
 * Provides adding/removing skill tags, filtering listings by tags,
 * tag autocomplete/suggestions, and popular tags for the tenant.
 */
class ListingSkillTagService
{
    private const MAX_TAGS_PER_LISTING = 10;

    /**
     * Set skill tags for a listing (replaces existing tags).
     */
    public function setTags(int $listingId, array $tags): bool
    {
        $tenantId = TenantContext::getId();

        // Validate listing belongs to tenant
        $exists = DB::table('listings')
            ->where('id', $listingId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (!$exists) {
            return false;
        }

        // Normalize and deduplicate tags
        $normalizedTags = [];
        foreach ($tags as $tag) {
            $normalized = $this->normalizeTag($tag);
            if ($normalized !== '' && !in_array($normalized, $normalizedTags, true)) {
                $normalizedTags[] = $normalized;
            }
        }

        $normalizedTags = array_slice($normalizedTags, 0, self::MAX_TAGS_PER_LISTING);

        // Remove existing tags
        ListingSkillTag::where('listing_id', $listingId)
            ->where('tenant_id', $tenantId)
            ->delete();

        // Insert new tags
        foreach ($normalizedTags as $tag) {
            DB::statement(
                "INSERT IGNORE INTO listing_skill_tags (tenant_id, listing_id, tag) VALUES (?, ?, ?)",
                [$tenantId, $listingId, $tag]
            );
        }

        return true;
    }

    /**
     * Get tags for a listing.
     *
     * @return string[]
     */
    public function getTags(int $listingId): array
    {
        $tenantId = TenantContext::getId();

        return ListingSkillTag::where('listing_id', $listingId)
            ->where('tenant_id', $tenantId)
            ->orderBy('tag')
            ->pluck('tag')
            ->all();
    }

    /**
     * Add a single tag to a listing.
     */
    public function addTag(int $listingId, string $tag): bool
    {
        $tenantId = TenantContext::getId();
        $normalized = $this->normalizeTag($tag);
        if ($normalized === '') {
            return false;
        }

        $count = ListingSkillTag::where('listing_id', $listingId)
            ->where('tenant_id', $tenantId)
            ->count();

        if ($count >= self::MAX_TAGS_PER_LISTING) {
            return false;
        }

        DB::statement(
            "INSERT IGNORE INTO listing_skill_tags (tenant_id, listing_id, tag) VALUES (?, ?, ?)",
            [$tenantId, $listingId, $normalized]
        );

        return true;
    }

    /**
     * Remove a single tag from a listing.
     */
    public function removeTag(int $listingId, string $tag): void
    {
        $tenantId = TenantContext::getId();
        $normalized = $this->normalizeTag($tag);

        ListingSkillTag::where('listing_id', $listingId)
            ->where('tenant_id', $tenantId)
            ->where('tag', $normalized)
            ->delete();
    }

    /**
     * Find listing IDs that match ANY of the given skill tags.
     *
     * @return int[]
     */
    public function findListingsByTags(array $tags, int $limit = 100): array
    {
        $tenantId = TenantContext::getId();

        if (empty($tags)) {
            return [];
        }

        $normalizedTags = array_filter(array_map([$this, 'normalizeTag'], $tags), fn ($t) => $t !== '');
        if (empty($normalizedTags)) {
            return [];
        }

        return DB::table('listing_skill_tags as lst')
            ->join('listings as l', function ($join) {
                $join->on('lst.listing_id', '=', 'l.id')
                     ->where('l.status', '=', 'active')
                     ->where(function ($q) {
                         $q->whereNull('l.moderation_status')->orWhere('l.moderation_status', 'approved');
                     });
            })
            ->where('lst.tenant_id', $tenantId)
            ->whereIn('lst.tag', $normalizedTags)
            ->distinct()
            ->orderByDesc('lst.listing_id')
            ->limit($limit)
            ->pluck('lst.listing_id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    /**
     * Get popular tags for the tenant.
     *
     * @return array<array{tag: string, count: int}>
     */
    public function getPopularTags(int $limit = 20): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('listing_skill_tags as lst')
            ->join('listings as l', function ($join) {
                $join->on('lst.listing_id', '=', 'l.id')
                     ->where('l.status', '=', 'active')
                     ->where(function ($q) {
                         $q->whereNull('l.moderation_status')->orWhere('l.moderation_status', 'approved');
                     });
            })
            ->where('lst.tenant_id', $tenantId)
            ->selectRaw('lst.tag, COUNT(*) as count')
            ->groupBy('lst.tag')
            ->orderByDesc('count')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => ['tag' => $r->tag, 'count' => (int) $r->count])
            ->all();
    }

    /**
     * Autocomplete tags based on a prefix.
     *
     * @return string[]
     */
    public function autocompleteTags(string $prefix, int $limit = 10): array
    {
        $tenantId = TenantContext::getId();
        $normalized = $this->normalizeTag($prefix);

        if (strlen($normalized) < 2) {
            return [];
        }

        return DB::table('listing_skill_tags as lst')
            ->join('listings as l', function ($join) {
                $join->on('lst.listing_id', '=', 'l.id')
                    ->where('l.status', '=', 'active')
                    ->where(function ($q) {
                        $q->whereNull('l.moderation_status')->orWhere('l.moderation_status', 'approved');
                    });
            })
            ->where('lst.tenant_id', $tenantId)
            ->where('lst.tag', 'LIKE', $normalized . '%')
            ->distinct()
            ->orderBy('lst.tag')
            ->limit($limit)
            ->pluck('lst.tag')
            ->all();
    }

    /**
     * Normalize a tag string.
     */
    private function normalizeTag(string $tag): string
    {
        // Unicode-aware: keep letters and digits in every script ("cercanía", "niño").
        $tag = mb_strtolower(trim($tag), 'UTF-8');
        $tag = preg_replace('/[^\p{L}\p{M}\p{N}\- ]/u', '', $tag) ?? '';
        $tag = preg_replace('/\s+/u', ' ', $tag) ?? '';
        return mb_substr(trim($tag), 0, 100, 'UTF-8');
    }
}
