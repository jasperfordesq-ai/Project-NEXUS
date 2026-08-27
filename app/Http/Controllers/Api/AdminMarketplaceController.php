<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Models\MarketplaceListing;
use App\Models\MarketplaceSellerProfile;
use App\Services\MarketplaceConfigurationService;
use App\Services\MarketplaceDisputeService;
use App\Services\MarketplaceReportService;
use App\Services\TenantSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * AdminMarketplaceController — Admin endpoints for marketplace management.
 *
 * All endpoints require admin auth and the marketplace feature to be enabled.
 */
class AdminMarketplaceController extends BaseApiController
{
    protected bool $isV2Api = true;

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('marketplace')) {
            abort(403, __('api_controllers_1.admin_marketplace.feature_not_enabled'));
        }
    }

    // -----------------------------------------------------------------
    //  Dashboard
    // -----------------------------------------------------------------

    /**
     * GET /v2/admin/marketplace/dashboard
     */
    public function dashboard(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_dashboard', 30, 60);

        $tenantId = TenantContext::getId();

        $totalListings = MarketplaceListing::where('tenant_id', $tenantId)->count();
        $activeListings = MarketplaceListing::where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('moderation_status', 'approved')
            ->count();
        $pendingModeration = MarketplaceListing::where('tenant_id', $tenantId)
            ->where('moderation_status', 'pending')->count();
        $totalSellers = MarketplaceSellerProfile::where('tenant_id', $tenantId)->count();

        $totalOrders = 0;
        $revenueByCurrency = [];
        if (DB::getSchemaBuilder()->hasTable('marketplace_orders')) {
            $totalOrders = DB::table('marketplace_orders')
                ->where('tenant_id', $tenantId)
                ->whereNotIn('status', ['cancelled', 'refunded'])
                ->count();
            $revenueByCurrency = DB::table('marketplace_orders')
                ->where('tenant_id', $tenantId)
                ->where('status', 'completed')
                ->where('total_price', '>', 0)
                ->groupByRaw('UPPER(currency)')
                ->orderByRaw('UPPER(currency)')
                ->selectRaw('UPPER(currency) AS currency, SUM(total_price) AS total')
                ->get()
                ->map(static fn (object $row): array => [
                    'currency' => (string) $row->currency,
                    'total' => (float) $row->total,
                ])
                ->all();
        }

        $hasSingleRevenueCurrency = count($revenueByCurrency) <= 1;
        $singleRevenue = $revenueByCurrency[0] ?? ['currency' => null, 'total' => 0.0];
        $defaultCurrency = (string) app(TenantSettingsService::class)->get(
            $tenantId,
            'general.default_currency',
            config('app.default_currency', 'USD')
        );

        return $this->respondWithData([
            'total_listings' => $totalListings,
            'active_listings' => $activeListings,
            'pending_moderation' => $pendingModeration,
            'total_sellers' => $totalSellers,
            'total_orders' => $totalOrders,
            'revenue' => $hasSingleRevenueCurrency ? $singleRevenue['total'] : null,
            'currency' => $hasSingleRevenueCurrency
                ? ($singleRevenue['currency'] ?? $defaultCurrency)
                : null,
            'revenue_by_currency' => $revenueByCurrency,
        ]);
    }

    // -----------------------------------------------------------------
    //  Listings Management
    // -----------------------------------------------------------------

    /**
     * GET /v2/admin/marketplace/listings
     */
    public function listings(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_listings', 30, 60);

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $moderationStatus = $this->query('moderation_status');
        $status = $this->query('status');
        $search = $this->query('q');

        $query = MarketplaceListing::with([
            'user:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'category:id,name,slug',
            'images' => fn ($q) => $q->where('is_primary', true)->limit(1),
        ]);

        if ($moderationStatus) {
            $query->where('moderation_status', $moderationStatus);
        }
        if ($status) {
            $query->where('status', $status);
        }
        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'LIKE', "%{$search}%")
                  ->orWhere('description', 'LIKE', "%{$search}%");
            });
        }

        $total = $query->count();
        $listings = $query->orderBy('id', 'desc')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        $items = $listings->map(fn ($l) => [
            'id' => $l->id,
            'title' => $l->title,
            'price' => $l->price !== null ? (float) $l->price : null,
            'price_currency' => $l->price_currency,
            'price_type' => $l->price_type,
            'status' => $l->status,
            'moderation_status' => $l->moderation_status,
            'moderation_notes' => $l->moderation_notes,
            'seller_type' => $l->seller_type,
            'views_count' => $l->views_count,
            'image' => $l->images->first() ? $l->images->first()->image_url : null,
            'category' => $l->category?->name,
            'user' => $l->user ? [
                'id' => $l->user->id,
                'name' => UserDisplayName::resolve($l->user),
            ] : null,
            'created_at' => $l->created_at?->toISOString(),
        ])->all();

        return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
    }

    /**
     * POST /v2/admin/marketplace/listings/{id}/approve
     */
    public function approveListing(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_moderate', 30, 60);

        $listing = MarketplaceListing::findOrFail($id);
        $listing->moderation_status = 'approved';
        $listing->moderated_by = auth()->id();
        $listing->moderated_at = now();
        $listing->moderation_notes = null;

        // Auto-activate if in draft
        if ($listing->status === 'draft') {
            $listing->status = 'active';
        }

        $listing->save();
        \App\Services\SearchService::indexMarketplaceListing($listing);

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.listing_approved')]);
    }

    /**
     * POST /v2/admin/marketplace/listings/{id}/reject
     */
    public function rejectListing(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_moderate', 30, 60);

        $data = request()->validate([
            'notes' => 'required|string|max:1000',
        ]);

        $listing = MarketplaceListing::findOrFail($id);
        $listing->moderation_status = 'rejected';
        $listing->moderated_by = auth()->id();
        $listing->moderated_at = now();
        $listing->moderation_notes = $data['notes'];
        $listing->status = 'removed';
        $listing->save();
        \App\Services\SearchService::removeMarketplaceListing($listing->id);

        // Tell the seller their listing was rejected — previously this admin
        // action was silent (no reason, no path to query). Direct action, so no
        // report-based appeal: the notice points to support.
        try {
            \App\Services\MarketplaceReportService::notifySellerEnforcement(
                (int) $listing->user_id,
                (int) (TenantContext::getId() ?? $listing->tenant_id),
                (int) $listing->id,
                (string) ($listing->title ?? ''),
                'action',
                'listing_rejected',
                $data['notes'],
                false
            );
        } catch (\Throwable $notifyError) {
            \Illuminate\Support\Facades\Log::warning('Admin listing-reject seller notice failed: ' . $notifyError->getMessage());
        }

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.listing_rejected')]);
    }

    /**
     * DELETE /v2/admin/marketplace/listings/{id}
     */
    public function destroyListing(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_moderate', 15, 60);

        $listing = MarketplaceListing::findOrFail($id);
        $listing->status = 'removed';
        $listing->moderation_status = 'rejected';
        $listing->moderated_by = auth()->id();
        $listing->moderated_at = now();
        $listing->save();
        \App\Services\SearchService::removeMarketplaceListing($listing->id);

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.listing_removed')]);
    }

    // -----------------------------------------------------------------
    //  Seller Management
    // -----------------------------------------------------------------

    /**
     * GET /v2/admin/marketplace/sellers
     */
    public function sellers(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_sellers', 30, 60);

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $sellerType = $this->query('seller_type');
        $verified = $this->query('verified');

        $query = MarketplaceSellerProfile::with('user:id,first_name,last_name,profile_type,organization_name,avatar_url,email');

        if ($sellerType) {
            $query->where('seller_type', $sellerType);
        }
        if ($verified === 'true') {
            $query->where('business_verified', true);
        } elseif ($verified === 'false') {
            $query->where('seller_type', 'business')->where('business_verified', false);
        }

        $total = $query->count();
        $sellers = $query->orderBy('id', 'desc')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        // Pre-fetch active listing counts to avoid N+1 queries
        $sellerUserIds = $sellers->pluck('user_id')->filter()->all();
        $listingCounts = [];
        if (!empty($sellerUserIds)) {
            $listingCounts = MarketplaceListing::whereIn('user_id', $sellerUserIds)
                ->where('status', 'active')
                ->groupBy('user_id')
                ->selectRaw('user_id, count(*) as cnt')
                ->pluck('cnt', 'user_id')
                ->all();
        }

        $items = $sellers->map(fn ($s) => [
            'id' => $s->id,
            'user_id' => $s->user_id,
            'display_name' => $s->display_name ?? UserDisplayName::resolve($s->user),
            'seller_type' => $s->seller_type,
            'business_name' => $s->business_name,
            'business_verified' => $s->business_verified,
            'is_community_endorsed' => $s->is_community_endorsed,
            'total_sales' => $s->total_sales,
            'avg_rating' => $s->avg_rating,
            'total_ratings' => $s->total_ratings,
            'active_listings' => $listingCounts[$s->user_id] ?? 0,
            'joined_marketplace_at' => $s->joined_marketplace_at?->toISOString(),
            'user' => $s->user ? [
                'id' => $s->user->id,
                'name' => UserDisplayName::resolve($s->user),
                'email' => $s->user->email,
                'avatar_url' => $s->user->avatar_url,
            ] : null,
        ])->all();

        return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
    }

    /**
     * POST /v2/admin/marketplace/sellers/{id}/verify
     */
    public function verifySeller(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_sellers', 15, 60);

        $seller = MarketplaceSellerProfile::findOrFail($id);

        if ($seller->seller_type !== 'business') {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_marketplace.only_business_sellers_verified'), null, 422);
        }

        $seller->business_verified = true;
        $seller->save();

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.seller_verified')]);
    }

    /**
     * POST /v2/admin/marketplace/sellers/{id}/suspend
     */
    public function suspendSeller(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_sellers', 15, 60);

        $seller = MarketplaceSellerProfile::findOrFail($id);

        $removedListingIds = DB::transaction(static function () use ($seller): array {
            // Persist the account-level suspension first so the seller cannot
            // immediately create another listing after this action completes.
            $seller->is_suspended = true;
            $seller->save();

            // Deactivate all their listings within this tenant.
            $activeListings = MarketplaceListing::where('tenant_id', TenantContext::getId())
                ->where('user_id', $seller->user_id)
                ->where('status', 'active');
            $listingIds = (clone $activeListings)->pluck('id')->map(
                static fn ($listingId): int => (int) $listingId
            )->all();
            $activeListings->update(['status' => 'removed', 'moderation_status' => 'rejected']);

            return $listingIds;
        });

        foreach ($removedListingIds as $listingId) {
            \App\Services\SearchService::removeMarketplaceListing($listingId);
        }

        app(\App\Services\PrerenderContentInvalidator::class)->refreshRoutes(
            (int) TenantContext::getId(),
            ['/marketplace', '/marketplace/free']
        );

        // Tell the seller their account was suspended — previously silent. This
        // is an account-level notice (no specific listing); points to support.
        try {
            \App\Services\MarketplaceReportService::notifySellerEnforcement(
                (int) $seller->user_id,
                (int) TenantContext::getId(),
                0,
                '',
                'suspended',
                'seller_suspended',
                null,
                false
            );
        } catch (\Throwable $notifyError) {
            \Illuminate\Support\Facades\Log::warning('Admin seller-suspend notice failed: ' . $notifyError->getMessage());
        }

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.seller_suspended')]);
    }

    // -----------------------------------------------------------------
    //  DSA Reports (Phase 4)
    // -----------------------------------------------------------------

    /**
     * GET /v2/admin/marketplace/reports — Pending reports queue (paginated).
     *
     * Supports ?status= filter and offset pagination.
     */
    public function reports(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_reports', 30, 60);

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $status = $this->query('status');

        $result = MarketplaceReportService::getPendingReports($perPage, $page, $status);

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page']
        );
    }

    /**
     * POST /v2/admin/marketplace/reports/{id}/acknowledge — Acknowledge a report.
     *
     * Sets acknowledged_at and moves status to under_review.
     * DSA requires acknowledgement within 24 hours.
     */
    public function acknowledgeReport(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_reports', 30, 60);

        $adminId = $this->requireAdmin();

        try {
            $report = MarketplaceReportService::acknowledgeReport($id, $adminId);
        } catch (\InvalidArgumentException $e) {
            \Illuminate\Support\Facades\Log::warning('AdminMarketplaceController error: ' . $e->getMessage());
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.report_acknowledged'), 'status' => $report->status]);
    }

    /**
     * PUT /v2/admin/marketplace/reports/{id}/resolve — Resolve a report.
     *
     * Body: { action_taken: 'none'|'warning'|'listing_removed'|'seller_suspended', resolution_reason: '...' }
     */
    public function resolveReport(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_reports', 30, 60);

        $adminId = $this->requireAdmin();

        $validated = request()->validate([
            'action_taken' => 'required|string|in:none,warning,listing_removed,seller_suspended',
            'resolution_reason' => 'required|string|max:5000',
        ]);

        try {
            $report = MarketplaceReportService::resolveReport($id, $adminId, $validated);
        } catch (\InvalidArgumentException $e) {
            \Illuminate\Support\Facades\Log::warning('AdminMarketplaceController error: ' . $e->getMessage());
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }

        return $this->respondWithData(['message' => __('api_controllers_1.admin_marketplace.report_resolved'), 'status' => $report->status, 'action_taken' => $report->action_taken]);
    }

    /** PUT /v2/admin/marketplace/reports/{id}/resolve-appeal. */
    public function resolveReportAppeal(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_reports', 30, 60);
        $adminId = $this->requireAdmin();
        $validated = request()->validate([
            'action_taken' => 'required|string|in:none,warning,listing_removed,seller_suspended',
            'resolution_reason' => 'required|string|max:5000',
        ]);

        try {
            $report = MarketplaceReportService::resolveAppeal($id, $adminId, $validated);
        } catch (\InvalidArgumentException $exception) {
            return $this->respondWithError('VALIDATION_ERROR', $exception->getMessage(), null, 422);
        }

        return $this->respondWithData([
            'message' => __('api_controllers_1.admin_marketplace.report_appeal_resolved'),
            'status' => $report->status,
            'action_taken' => $report->action_taken,
        ]);
    }

    /** GET /v2/admin/marketplace/disputes. */
    public function disputes(MarketplaceDisputeService $service): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_disputes', 30, 60);

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $status = $this->query('status');
        $result = $service->paginate($status, $page, $perPage);

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page'],
        );
    }

    /** PUT /v2/admin/marketplace/disputes/{id}/resolve. */
    public function resolveDispute(int $id, MarketplaceDisputeService $service): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_disputes', 20, 60);
        $adminId = $this->requireAdmin();
        $validated = request()->validate([
            'resolution' => 'required|string|in:buyer,seller,closed',
            'resolution_notes' => 'required|string|max:5000',
            'refund_amount' => 'nullable|numeric|min:0.01',
        ]);

        try {
            $dispute = $service->resolve($id, $adminId, $validated);
        } catch (\InvalidArgumentException $exception) {
            return $this->respondWithError('VALIDATION_ERROR', $exception->getMessage(), null, 422);
        } catch (\RuntimeException $exception) {
            \Illuminate\Support\Facades\Log::error('Marketplace dispute resolution failed', [
                'dispute_id' => $id,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError('RESOLUTION_FAILED', __('api.marketplace_dispute_resolution_failed'), null, 409);
        }

        return $this->respondWithData([
            'message' => __('api_controllers_1.admin_marketplace.dispute_resolved'),
            'status' => $dispute->status,
        ]);
    }

    /**
     * GET /v2/admin/marketplace/transparency — DSA transparency stats.
     *
     * Returns aggregate data required for DSA transparency reporting.
     */
    public function transparencyStats(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_transparency', 30, 60);

        $stats = MarketplaceReportService::getTransparencyStats();

        return $this->respondWithData($stats);
    }

    // -----------------------------------------------------------------
    //  Bulk Actions (TD11)
    // -----------------------------------------------------------------

    private const BULK_MAX = 100;

    /**
     * POST /v2/admin/marketplace/bulk-reject
     * Body: { listing_ids: int[], reason: string }
     */
    public function bulkReject(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_bulk', 10, 60);

        $tenantId = TenantContext::getId();

        $data = request()->validate([
            'listing_ids' => 'required|array|min:1|max:' . self::BULK_MAX,
            'listing_ids.*' => 'integer|min:1',
            'reason' => 'required|string|max:1000',
        ]);

        $ids = array_values(array_unique(array_map('intval', $data['listing_ids'])));
        $reason = trim((string) $data['reason']);

        // Tenant-scope eligibility — MarketplaceListing uses HasTenantScope global scope,
        // but belt-and-braces: filter by tenant_id directly.
        $eligible = MarketplaceListing::whereIn('id', $ids)
            ->where('tenant_id', $tenantId)
            ->get();

        $eligibleIds = $eligible->pluck('id')->map(fn ($id) => (int) $id)->all();
        $skippedIds = array_values(array_diff($ids, $eligibleIds));

        $success = 0;
        $failed = count($skippedIds);
        $touchedIds = [];

        foreach ($eligible as $listing) {
            try {
                $listing->moderation_status = 'rejected';
                $listing->moderated_by = $adminId;
                $listing->moderated_at = now();
                $listing->moderation_notes = $reason;
                $listing->status = 'removed';
                $listing->save();
                \App\Services\SearchService::removeMarketplaceListing($listing->id);
                $touchedIds[] = (int) $listing->id;
                $success++;

                // Tell the seller their listing was rejected (reason + support).
                try {
                    \App\Services\MarketplaceReportService::notifySellerEnforcement(
                        (int) $listing->user_id,
                        (int) $tenantId,
                        (int) $listing->id,
                        (string) ($listing->title ?? ''),
                        'action',
                        'listing_rejected',
                        $reason,
                        false
                    );
                } catch (\Throwable $notifyError) {
                    \Illuminate\Support\Facades\Log::warning('Admin bulk-reject seller notice failed: ' . $notifyError->getMessage());
                }
            } catch (\Throwable $e) {
                $failed++;
                $skippedIds[] = (int) $listing->id;
            }
        }

        app(\App\Services\AuditLogService::class)->log(
            'admin_bulk_reject_marketplace_listings',
            null,
            $adminId,
            [
                'listing_ids' => $touchedIds,
                'skipped_ids' => $skippedIds,
                'success' => $success,
                'failed' => $failed,
                'reason' => $reason,
            ]
        );

        return $this->respondWithData([
            'success' => $success,
            'failed' => $failed,
            'skipped_ids' => $skippedIds,
        ]);
    }
}
