<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\SearchLogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\Notification;
use App\Services\ListingFeaturedService;
use App\Services\ListingModerationService;

/**
 * AdminListingsController -- Admin listing moderation (list, approve, reject, feature, search analytics).
 *
 * All methods require admin authentication.
 */
class AdminListingsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SearchLogService $searchLogService,
        private readonly ListingFeaturedService $listingFeaturedService,
        private readonly ListingModerationService $listingModerationService,
    ) {}

    // =========================================================================
    // Listings CRUD
    // =========================================================================

    /** GET /api/v2/admin/listings */
    public function index(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;
        $status = $this->query('status');
        $type = $this->query('type');
        $search = $this->query('search');
        $sort = $this->query('sort', 'created_at');
        $order = strtoupper($this->query('order', 'DESC')) === 'ASC' ? 'ASC' : 'DESC';

        $allowedSorts = ['title', 'type', 'status', 'created_at', 'user_name'];
        if (!in_array($sort, $allowedSorts, true)) {
            $sort = 'created_at';
        }

        $conditions = ['l.tenant_id = ?'];
        $params = [$tenantId];

        if ($status && $status !== 'all') {
            switch ($status) {
                case 'pending':
                    $conditions[] = "(l.moderation_status = 'pending_review' OR (l.moderation_status IS NULL AND l.status = 'pending'))";
                    break;
                case 'active':
                    $conditions[] = "l.status = 'active'";
                    break;
                case 'inactive':
                    $conditions[] = "l.status IN ('inactive', 'expired', 'closed')";
                    break;
            }
        }

        if ($type) {
            $conditions[] = 'l.type = ?';
            $params[] = $type;
        }

        if ($search) {
            $conditions[] = "(l.title LIKE ? OR l.description LIKE ?)";
            $searchTerm = '%' . $search . '%';
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        $where = implode(' AND ', $conditions);

        $sortColumnMap = [
            'title' => 'l.title',
            'type' => 'l.type',
            'status' => 'l.status',
            'created_at' => 'l.created_at',
            'user_name' => 'user_name',
        ];
        $sortColumn = $sortColumnMap[$sort] ?? 'l.created_at';

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings l WHERE {$where}",
            $params
        )->cnt;

        $items = DB::select(
            "SELECT l.id, l.title, l.description, l.type, l.status, l.created_at, l.updated_at,
                    l.user_id, l.category_id, l.price, l.tenant_id,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name,
                    u.email as user_email, u.avatar_url as user_avatar,
                    c.name as category_name,
                    t.name as tenant_name
             FROM listings l
             LEFT JOIN users u ON l.user_id = u.id
             LEFT JOIN categories c ON l.category_id = c.id
             LEFT JOIN tenants t ON l.tenant_id = t.id
             WHERE {$where}
             ORDER BY {$sortColumn} {$order}
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        $formatted = array_map(function ($row) {
            return [
                'id' => (int) $row->id,
                'title' => $row->title ?? '',
                'description' => $row->description ?? '',
                'type' => $row->type ?? 'listing',
                'status' => $row->status ?? 'active',
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name ?? 'Unknown',
                'user_id' => (int) ($row->user_id ?? 0),
                'user_name' => trim($row->user_name ?? ''),
                'user_email' => $row->user_email ?? '',
                'user_avatar' => $row->user_avatar ?? null,
                'category_id' => $row->category_id ? (int) $row->category_id : null,
                'category_name' => $row->category_name ?? null,
                'price' => $row->price ? (float) $row->price : null,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at ?? null,
            ];
        }, $items);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /** GET /api/v2/admin/listings/{id} */
    public function show($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $item = DB::selectOne(
            "SELECT l.*,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name,
                    u.email as user_email, u.avatar_url as user_avatar,
                    c.name as category_name,
                    t.name as tenant_name
             FROM listings l
             LEFT JOIN users u ON l.user_id = u.id
             LEFT JOIN categories c ON l.category_id = c.id
             LEFT JOIN tenants t ON l.tenant_id = t.id
             WHERE l.id = ? AND l.tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$item) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        return $this->respondWithData([
            'id' => (int) $item->id,
            'title' => $item->title ?? '',
            'description' => $item->description ?? '',
            'type' => $item->type ?? 'listing',
            'status' => $item->status ?? 'active',
            'tenant_id' => (int) $item->tenant_id,
            'tenant_name' => $item->tenant_name ?? 'Unknown',
            'user_id' => (int) ($item->user_id ?? 0),
            'user_name' => trim($item->user_name ?? ''),
            'user_email' => $item->user_email ?? '',
            'user_avatar' => $item->user_avatar ?? null,
            'category_id' => $item->category_id ? (int) $item->category_id : null,
            'category_name' => $item->category_name ?? null,
            'price' => $item->price ? (float) $item->price : null,
            'location' => $item->location ?? null,
            'created_at' => $item->created_at,
            'updated_at' => $item->updated_at ?? null,
        ]);
    }

    /** POST /api/v2/admin/listings/{id}/approve */
    public function approve(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $item = DB::selectOne(
            "SELECT id, title, status, user_id, tenant_id FROM listings WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$item) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        $approved = $this->listingModerationService->approve($tenantId, $id, $adminId);
        if (! $approved) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.listing_approve_failed'), null, 422);
        }

        // Load the owner once with preferred_language so the email renders under the owner's locale.
        $owner = DB::table('users')
            ->where('id', $item->user_id)
            ->where('tenant_id', $tenantId)
            ->select(['email', 'first_name', 'name', 'preferred_language'])
            ->first();

        // Send approval email to listing creator
        try {
            if ($owner && !empty($owner->email)) {
                LocaleContext::withLocale($owner, function () use ($owner, $item, $id, $tenantId) {
                    $firstName  = $owner->first_name ?? $owner->name ?? __('emails.common.fallback_name');
                    $safeTitle  = htmlspecialchars($item->title ?? '', ENT_QUOTES, 'UTF-8');
                    $listingUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . "/listings/{$id}";
                    $html = \App\Core\EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails_listings.listings.approved.email_title'))
                        ->greeting($firstName)
                        ->paragraph(__('emails_listings.listings.approved.email_body', ['title' => $safeTitle]))
                        ->button(__('emails_listings.listings.approved.email_cta'), $listingUrl)
                        ->render();
                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $owner->email,
                        __('emails_listings.listings.approved.email_subject', ['title' => $safeTitle]),
                        $html,
                        null,
                        null,
                        null,
                        'listing_moderation',
                        ['tenant_id' => $tenantId]
                    )) {
                        Log::warning("[AdminListingsController] approve email returned false for listing #{$id}");
                    }
                });
            }
        } catch (\Exception $e) {
            Log::warning("[AdminListingsController] approve email failed for listing #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['approved' => true, 'id' => $id]);
    }

    /** POST /api/v2/admin/listings/{id}/reject */
    public function reject(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $reason = $this->input('reason', '');

        $result = $this->listingModerationService->rejectListing($id, $adminId, $reason);

        if (!$result['success']) {
            $status = $result['error'] === __('api.listing_not_found') ? 404 : 422;
            return $this->respondWithError('REJECT_FAILED', $result['error'], null, $status);
        }

        return $this->respondWithData(['rejected' => true, 'id' => $id]);
    }

    /** DELETE /api/v2/admin/listings/{id} */
    public function destroy($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $item = DB::selectOne(
            "SELECT id, title, user_id, tenant_id FROM listings WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$item) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        // Notify listing owner BEFORE delete so the data still exists.
        // Load once with preferred_language so both the bell and the email render
        // under the owner's locale.
        try {
            $user = DB::table('users')
                ->where('id', $item->user_id)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'first_name', 'name', 'preferred_language'])
                ->first();

            LocaleContext::withLocale($user, function () use ($user, $item, $id, $tenantId) {
                $title = htmlspecialchars($item->title ?? '', ENT_QUOTES, 'UTF-8');
                Notification::create([
                    'user_id' => (int) $item->user_id,
                    'message' => __('emails_listings.listings.removed.notification', ['title' => $title]),
                    'link' => '/listings',
                    'type' => 'listing_removed',
                    'created_at' => now(),
                ]);
                // Email notification
                if ($user && !empty($user->email)) {
                    $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                    $fullUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/listings';
                    $html = \App\Core\EmailTemplateBuilder::make()
                        ->title(__('emails_listings.listings.removed.email_title'))
                        ->greeting($firstName)
                        ->paragraph(__('emails_listings.listings.removed.email_body', ['title' => $title]))
                        ->button(__('emails_listings.listings.removed.email_cta'), $fullUrl)
                        ->render();
                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $user->email,
                        __('emails_listings.listings.removed.email_subject', ['title' => $title]),
                        $html,
                        null,
                        null,
                        null,
                        'listing_moderation',
                        ['tenant_id' => $tenantId]
                    )) {
                        Log::warning("[AdminListingsController] destroy email returned false for listing #{$id}");
                    }
                }
            });
        } catch (\Exception $e) {
            Log::warning("[AdminListingsController] destroy notification failed for listing #{$id}: " . $e->getMessage());
        }

        // Clean up related records before hard delete to avoid orphans
        DB::table('listing_skill_tags')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();
        DB::table('user_saved_listings')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();
        DB::table('listing_views')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();
        DB::table('listing_contacts')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();

        // Remove from search index
        try {
            \App\Services\SearchService::removeListing((int) $id);
        } catch (\Throwable $e) {
            Log::warning("Failed to remove listing {$id} from search index during admin delete: " . $e->getMessage());
        }

        DB::delete("DELETE FROM listings WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        ActivityLog::log($adminId, 'admin_delete_listing', "Deleted listing #{$id}: {$item->title}");

        return $this->respondWithData(['deleted' => true, 'id' => (int) $id]);
    }

    // =========================================================================
    // Feature / Unfeature
    // =========================================================================

    /** POST /api/v2/admin/listings/{id}/feature */
    public function feature($id): JsonResponse
    {
        $this->requireAdmin();
        $days = $this->inputInt('days', null, 1, 365);

        $result = $this->listingFeaturedService->featureListing((int) $id, $days);

        if (!$result['success']) {
            return $this->respondWithError('FEATURE_FAILED', $result['error'], null, 404);
        }

        return $this->respondWithData([
            'featured' => true,
            'id' => (int) $id,
            'featured_until' => $result['featured_until'],
        ]);
    }

    /** DELETE /api/v2/admin/listings/{id}/feature */
    public function unfeature($id): JsonResponse
    {
        $this->requireAdmin();

        $result = $this->listingFeaturedService->unfeatureListing((int) $id);

        if (!$result['success']) {
            return $this->respondWithError('UNFEATURE_FAILED', $result['error'], null, 404);
        }

        return $this->respondWithData(['featured' => false, 'id' => (int) $id]);
    }

    // =========================================================================
    // Moderation
    // =========================================================================

    /** GET /api/v2/admin/listings/featured */
    public function featured(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $featured = DB::table('listings')
            ->where('listings.tenant_id', $tenantId)
            ->where('listings.is_featured', 1)
            ->select([
                'listings.id as listing_id',
                'listings.id',
                'listings.title',
                'listings.status',
                'listings.is_featured',
                'listings.featured_until',
                'listings.user_id',
            ])
            ->orderByDesc('listings.updated_at')
            ->get()
            ->toArray();

        return $this->respondWithData($featured);
    }

    /** GET /api/v2/admin/listings/pending */
    public function pending(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $offset = ($page - 1) * $perPage;

        $items = DB::select(
            "SELECT * FROM listings WHERE tenant_id = ? AND (moderation_status = 'pending_review' OR (moderation_status IS NULL AND status = 'pending')) ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [$tenantId, $perPage, $offset]
        );
        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND (moderation_status = 'pending_review' OR (moderation_status IS NULL AND status = 'pending'))",
            [$tenantId]
        )->cnt;

        return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
    }

    /** GET /api/v2/admin/listings/moderation-queue */
    public function moderationQueue(): JsonResponse
    {
        $this->requireAdmin();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $type = $this->query('type');

        $result = $this->listingModerationService->getReviewQueue($page, $limit, $type);

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $page,
            $limit
        );
    }

    /** GET /api/v2/admin/listings/moderation-stats */
    public function moderationStats(): JsonResponse
    {
        $this->requireAdmin();

        $stats = $this->listingModerationService->getStats();

        return $this->respondWithData($stats);
    }

    /** GET /api/v2/admin/listings/stats */
    public function stats(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $rows = DB::select(
            'SELECT status, COUNT(*) as count FROM listings WHERE tenant_id = ? GROUP BY status',
            [$tenantId]
        );

        $stats = [];
        foreach ($rows as $row) {
            $stats[$row->status] = (int) $row->count;
        }

        return $this->respondWithData($stats);
    }

    // =========================================================================
    // Search Analytics
    // =========================================================================

    /** GET /api/v2/admin/search/analytics */
    public function searchAnalytics(): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $days = $this->queryInt('days', 30, 1, 90);

        $analytics = $this->searchLogService->getAnalyticsSummary($days);

        return $this->respondWithData($analytics);
    }

    /** GET /api/v2/admin/search/trending */
    public function searchTrending(): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $days = $this->queryInt('days', 7, 1, 90);
        $limit = $this->queryInt('limit', 20, 1, 50);

        $trending = $this->searchLogService->getTrendingSearches($days, $limit);

        return $this->respondWithData($trending);
    }

    /** GET /api/v2/admin/search/zero-results */
    public function searchZeroResults(): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $days = $this->queryInt('days', 30, 1, 90);
        $limit = $this->queryInt('limit', 20, 1, 50);

        $zeroResults = $this->searchLogService->getZeroResultSearches($days, $limit);

        return $this->respondWithData($zeroResults);
    }
}
