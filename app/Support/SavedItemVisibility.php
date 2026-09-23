<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\MarketplaceListing;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\GroupAccessService;
use App\Services\MarketplaceListingService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Can this viewer see the item they are saving or bookmarking?
 *
 * Bookmarks and saved collections store a (type, id) pair and later show the
 * item's title or content as a preview. Before F-066 both services checked
 * only that the row existed in the tenant, so saving the id of a private-group
 * post, a draft event or an unmoderated listing handed its text to anyone who
 * guessed the id. Every preview must be gated on the VIEWER, not the saver:
 * a public collection is read by other members.
 *
 * Each branch reuses the owning module's own read rule rather than inventing
 * one. Unknown types and lookup errors are refused.
 */
final class SavedItemVisibility
{
    public static function canView(string $type, int $id, int $viewerId): bool
    {
        if ($id <= 0 || $viewerId <= 0) {
            return false;
        }

        $tenantId = (int) TenantContext::getId();
        if ($tenantId <= 0) {
            return false;
        }

        try {
            return match ($type) {
                'post', 'discussion' => FeedItemTables::canView($type, $id, $viewerId),
                'listing' => self::canViewListing($id, $viewerId, $tenantId),
                'event' => self::canViewEvent($id, $viewerId, $tenantId),
                'job' => self::canViewJob($id, $viewerId, $tenantId),
                'blog', 'article' => self::canViewPage($id, $tenantId),
                'group' => GroupAccessService::canViewOverview($id, $viewerId),
                'marketplace_listing' => self::canViewMarketplaceListing($id, $viewerId, $tenantId),
                'resource' => self::canViewResource($id, $tenantId),
                default => false,
            };
        } catch (\Throwable $e) {
            Log::warning('[SavedItemVisibility] visibility check failed', [
                'type' => $type,
                'id' => $id,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /** Mirrors ListingService::getById(): non-active or unapproved listings are owner-only. */
    private static function canViewListing(int $id, int $viewerId, int $tenantId): bool
    {
        $listing = DB::table('listings')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first(['user_id', 'status', 'moderation_status']);

        if (!$listing || ($listing->status ?? null) === 'deleted') {
            return false;
        }
        if ((int) $listing->user_id === $viewerId) {
            return true;
        }

        return in_array($listing->status ?? null, [null, 'active'], true)
            && in_array($listing->moderation_status ?? null, [null, 'approved'], true);
    }

    private static function canViewEvent(int $id, int $viewerId, int $tenantId): bool
    {
        $event = Event::query()->where('tenant_id', $tenantId)->find($id);
        $viewer = User::query()->where('tenant_id', $tenantId)->find($viewerId);

        return $event instanceof Event
            && $viewer instanceof User
            && app(EventPolicy::class)->view($viewer, $event);
    }

    /** Drafts and unapproved vacancies are owner-only, as in the job listing queries. */
    private static function canViewJob(int $id, int $viewerId, int $tenantId): bool
    {
        $job = DB::table('job_vacancies')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first(['user_id', 'status', 'moderation_status']);

        if (!$job) {
            return false;
        }
        if ((int) $job->user_id === $viewerId) {
            return true;
        }

        return ($job->status ?? 'open') !== 'draft'
            && in_array($job->moderation_status ?? null, [null, 'approved'], true);
    }

    /** CMS pages: published, and not scheduled for later. */
    private static function canViewPage(int $id, int $tenantId): bool
    {
        return DB::table('pages')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('is_published', 1)
            ->where(function ($q) {
                $q->whereNull('publish_at')->orWhere('publish_at', '<=', now());
            })
            ->exists();
    }

    private static function canViewMarketplaceListing(int $id, int $viewerId, int $tenantId): bool
    {
        $ownerId = DB::table('marketplace_listings')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->value('user_id');

        if ($ownerId === null) {
            return false;
        }
        if ((int) $ownerId === $viewerId) {
            return true;
        }

        $query = MarketplaceListing::query()->where('tenant_id', $tenantId)->whereKey($id);
        MarketplaceListingService::applyPublicVisibility($query);

        return $query->exists();
    }

    /** Resources have no hidden or draft state: every resource in the community is readable. */
    private static function canViewResource(int $id, int $tenantId): bool
    {
        return DB::table('resources')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();
    }
}
