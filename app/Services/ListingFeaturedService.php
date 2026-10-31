<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * ListingFeaturedService — Featured/Boosted listing management.
 *
 * Manages the is_featured flag and featured_until datetime.
 */
class ListingFeaturedService
{
    private const DEFAULT_FEATURE_DAYS = 7;

    public function __construct()
    {
    }

    /**
     * Feature a listing.
     *
     * @return array ['success' => bool, 'error' => string|null, 'featured_until' => string|null]
     */
    public function featureListing(int $listingId, ?int $days = null): array
    {
        $tenantId = tenant_id();

        $listing = DB::selectOne(
            "SELECT id, status FROM listings WHERE id = ? AND tenant_id = ?",
            [$listingId, $tenantId]
        );

        if (!$listing) {
            return ['success' => false, 'error' => __('api.listing_not_found'), 'featured_until' => null];
        }

        $featuredUntil = null;
        if ($days !== null) {
            $featureDays = max(1, min(365, $days));
            $result = DB::selectOne(
                "SELECT DATE_ADD(NOW(), INTERVAL ? DAY) as date",
                [$featureDays]
            );
            $featuredUntil = $result->date;
        }

        DB::update(
            "UPDATE listings
             SET is_featured = 1, featured_until = ?, updated_at = NOW()
             WHERE id = ? AND tenant_id = ?",
            [$featuredUntil, $listingId, $tenantId]
        );

        return [
            'success' => true,
            'error' => null,
            'featured_until' => $featuredUntil,
        ];
    }

    /**
     * Unfeature a listing.
     */
    public function unfeatureListing(int $listingId): array
    {
        $tenantId = tenant_id();

        $listing = DB::selectOne(
            "SELECT id FROM listings WHERE id = ? AND tenant_id = ?",
            [$listingId, $tenantId]
        );

        if (!$listing) {
            return ['success' => false, 'error' => __('api.listing_not_found')];
        }

        DB::update(
            "UPDATE listings
             SET is_featured = 0, featured_until = NULL, updated_at = NOW()
             WHERE id = ? AND tenant_id = ?",
            [$listingId, $tenantId]
        );

        return ['success' => true, 'error' => null];
    }

    /**
     * Process expired featured listings (auto-unfeature).
     */
    public function processExpiredFeatured(): int
    {
        $tenantId = tenant_id();

        try {
            return DB::update(
                "UPDATE listings
                 SET is_featured = 0, featured_until = NULL, updated_at = NOW()
                 WHERE tenant_id = ?
                   AND is_featured = 1
                   AND featured_until IS NOT NULL
                   AND featured_until <= NOW()",
                [$tenantId]
            );
        } catch (\Exception $e) {
            \Log::error("[ListingFeaturedService] processExpiredFeatured error: " . $e->getMessage());
            return 0;
        }
    }

    /**
     * Get featured listings for the tenant.
     */
    public function getFeaturedListings(int $limit = 10): array
    {
        $tenantId = tenant_id();

        // Category names in the reader's language (TaxonomyNameLocalizer).
        return array_map(function ($r) {
            $row = (array) $r;
            $row['category_name'] = \App\Services\Translation\TaxonomyNameLocalizer::nameFor('categories', $row['category_id'] ?? null, $row['category_name'] ?? null);
            return $row;
        }, DB::select(
            "SELECT l.id, l.title, l.description, l.type, l.category_id, l.image_url,
                    l.location, l.status, l.is_featured, l.featured_until,
                    l.created_at, l.user_id, l.view_count,
                    CASE
                        WHEN u.profile_type = 'organisation' AND u.organization_name IS NOT NULL
                        THEN u.organization_name
                        ELSE CONCAT(u.first_name, ' ', u.last_name)
                    END as author_name,
                    u.avatar_url as author_avatar,
                    c.name as category_name, c.color as category_color
             FROM listings l
             JOIN users u ON l.user_id = u.id
             LEFT JOIN categories c ON l.category_id = c.id
             WHERE l.tenant_id = ?
               AND l.status = 'active'
               AND (l.moderation_status IS NULL OR l.moderation_status = 'approved')
               AND l.is_featured = 1
               AND (l.featured_until IS NULL OR l.featured_until > NOW())
             ORDER BY l.created_at DESC
             LIMIT ?",
            [$tenantId, $limit]
        ));
    }

    /**
     * Check if a listing is currently featured.
     */
    public function isFeatured(int $listingId): bool
    {
        $tenantId = tenant_id();

        $row = DB::selectOne(
            "SELECT is_featured, featured_until FROM listings
             WHERE id = ? AND tenant_id = ?",
            [$listingId, $tenantId]
        );

        if (!$row || !$row->is_featured) {
            return false;
        }

        if ($row->featured_until !== null) {
            return strtotime($row->featured_until) > time();
        }

        return true;
    }
}
