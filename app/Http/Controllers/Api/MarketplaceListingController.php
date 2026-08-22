<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\TenantContext;
use App\Http\Resources\PublicMarketplaceListingResource;
use App\Models\MarketplaceCategoryTemplate;
use App\Models\MarketplaceListing;
use App\Services\AiChatService;
use App\Services\ImageUploadService;
use App\Services\MarketplaceConfigurationService;
use App\Services\MarketplaceListingService;
use App\Services\MarketplaceSellerService;
use App\Services\PrerenderContentInvalidator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

/**
 * MarketplaceListingController — Standalone marketplace listing endpoints.
 *
 * Handles listing CRUD, image management, search/browse, categories,
 * saved/favorites, analytics, and AI description generation.
 *
 * Completely separate from timebanking listings (ListingController).
 */
class MarketplaceListingController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ImageUploadService $imageUploadService,
        private readonly AiChatService $aiChatService,
    ) {}

    // =====================================================================
    //  Feature gate
    // =====================================================================

    /**
     * Ensure the marketplace feature is enabled for the current tenant.
     */
    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('marketplace')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api_controllers_2.marketplace_listing.feature_disabled'), null, 403)
            );
        }
    }

    // =====================================================================
    //  Ownership helper
    // =====================================================================

    /**
     * Verify that the authenticated user owns the given listing.
     *
     * @throws \Illuminate\Http\Exceptions\HttpResponseException
     */
    private function ensureOwner(MarketplaceListing $listing, int $userId): void
    {
        if ((int) $listing->user_id !== $userId) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FORBIDDEN', __('api_controllers_2.marketplace_listing.no_permission_modify'), null, 403)
            );
        }
    }

    /**
     * Find a listing by ID or throw a 404 error response.
     *
     * @throws \Illuminate\Http\Exceptions\HttpResponseException
     */
    private function findListingOrFail(int $id): MarketplaceListing
    {
        $listing = MarketplaceListing::find($id);

        if (!$listing) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.marketplace_listing.not_found'), null, 404)
            );
        }

        return $listing;
    }

    /** Refresh every public snapshot that can display this listing. */
    private function refreshListingSnapshots(MarketplaceListing $listing): void
    {
        try {
            $tenantId = (int) TenantContext::getId();
            $routes = ['/marketplace', '/marketplace/free', '/marketplace/' . $listing->getKey()];
            $categoryId = (int) ($listing->category_id ?? 0);
            if ($categoryId > 0) {
                $slug = DB::table('marketplace_categories')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $categoryId)
                    ->value('slug');
                if (is_string($slug) && $slug !== '') {
                    $routes[] = '/marketplace/category/' . $slug;
                }
            }
            app(PrerenderContentInvalidator::class)->refreshRoutes($tenantId, $routes);
        } catch (\Throwable $e) {
            Log::warning('Marketplace snapshot refresh failed', [
                'listing_id' => $listing->getKey(),
                'error' => $e->getMessage(),
            ]);
        }
    }

    // =====================================================================
    //  Browse / Search (authenticated)
    // =====================================================================

    /**
     * GET /v2/marketplace/listings — Browse/search marketplace listings.
     *
     * Supports filtering by category, price range, condition, seller type,
     * delivery method, posted date, and text search. Cursor-paginated.
     */
    public function index(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_browse', 60, 60);

        $limit = $this->queryInt('limit', 20, 1, 100);

        $filters = [
            'limit'           => $limit,
            'current_user_id' => $userId,
        ];

        if ($this->query('q')) {
            $filters['search'] = $this->query('q');
        }
        if ($this->query('category_id')) {
            $filters['category_id'] = $this->queryInt('category_id');
        }
        if ($this->query('category')) {
            $filters['category_slug'] = $this->query('category');
        }
        if ($this->query('price_min') !== null) {
            $filters['price_min'] = (float) $this->query('price_min');
        }
        if ($this->query('price_max') !== null) {
            $filters['price_max'] = (float) $this->query('price_max');
        }
        if ($this->query('price_type')) {
            $filters['price_type'] = $this->query('price_type');
        }
        if ($this->query('condition')) {
            $filters['condition'] = $this->query('condition');
        }
        if ($this->query('seller_type')) {
            $filters['seller_type'] = $this->query('seller_type');
        }
        if ($this->query('delivery_method')) {
            $filters['delivery_method'] = $this->query('delivery_method');
        }
        if ($this->query('posted_within')) {
            $filters['posted_within'] = $this->queryInt('posted_within');
        }
        if ($this->query('sort')) {
            $validSorts = ['newest', 'price_asc', 'price_desc', 'popular'];
            if (in_array($this->query('sort'), $validSorts, true)) {
                $filters['sort'] = $this->query('sort');
            }
        }
        if ($this->queryBool('featured_first')) {
            $filters['featured_first'] = true;
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('status')) {
            $filters['status'] = $this->query('status');
        }
        // Only allow user_id filter when it matches the authenticated user (own listings)
        if ($this->query('user_id') && $userId && (int) $this->query('user_id') === $userId) {
            $filters['user_id'] = $userId;
        }

        $result = MarketplaceListingService::getAll($filters);

        return $this->respondWithCollection(
            $this->augmentPublicMarketplaceListings($result['items']),
            $result['cursor'],
            $limit,
            $result['has_more']
        );
    }

    /**
     * GET /v2/marketplace/listings/{id} — Single listing detail.
     *
     * Authenticated endpoint. Increments view count. Returns full detail
     * including all images, seller info, and saved status.
     */
    public function show(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_show', 60, 60);

        $listing = MarketplaceListingService::getById($id, $userId);

        // 🔴 A seller must be able to open their own listing while it waits for a
        // moderator. Marketplace moderation is ON by default
        // (MarketplaceConfigurationService::moderationEnabled()), so every newly published
        // listing starts as `pending` and is correctly hidden from the public read — but
        // both frontends navigate the seller straight to this endpoint after publishing,
        // and so told them "Listing not found. This item may have been sold, removed, or
        // moved." about the item they had just created. Measured on a device 2026-08-22.
        // getByIdForOwner() already exists for exactly this audience and widens nothing
        // for anyone else.
        if (! $listing) {
            $listing = MarketplaceListingService::getByIdForOwner($id, $userId);
        }

        if (! $listing) {
            $offerId = $this->queryInt('offer_id', 0, 0);
            if ($offerId > 0) {
                $listing = MarketplaceListingService::getByIdForAcceptedOfferBuyer(
                    $id,
                    $userId,
                    $offerId,
                );
            }
        }

        if (!$listing) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.marketplace_listing.not_found'), null, 404);
        }

        // Record view asynchronously (best-effort)
        MarketplaceListingService::recordView($id);

        return $this->respondWithData(PublicMarketplaceListingResource::augment($listing));
    }

    // =====================================================================
    //  CRUD (authenticated)
    // =====================================================================

    /**
     * POST /v2/marketplace/listings — Create a new marketplace listing.
     *
     * Requires authentication. Auto-creates a seller profile if the user
     * doesn't have one. Returns the created listing with 201 status.
     */
    public function store(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_create', 10, 60);

        $data = request()->validate([
            'title'              => 'required|string|max:200',
            'description'        => 'required|string|max:10000',
            'tagline'            => 'nullable|string|max:300',
            'price'              => 'nullable|numeric|min:0',
            'price_currency'     => 'nullable|string|max:3',
            'price_type'         => 'nullable|string|in:fixed,negotiable,free,auction,contact',
            'time_credit_price'  => 'nullable|numeric|min:0',
            'category_id'        => ['nullable', 'integer', $this->availableCategoryRule()],
            'condition'          => 'nullable|string|in:new,like_new,good,fair,poor',
            'quantity'           => 'nullable|integer|min:1',
            'inventory_count'    => 'nullable|integer|min:0',
            'low_stock_threshold' => 'nullable|integer|min:0',
            'is_oversold_protected' => 'nullable|boolean',
            'location'           => 'nullable|string|max:255',
            'latitude'           => 'nullable|numeric|between:-90,90',
            'longitude'          => 'nullable|numeric|between:-180,180',
            'shipping_available' => 'nullable|boolean',
            'local_pickup'       => 'nullable|boolean',
            'delivery_method'    => 'nullable|string|in:pickup,shipping,both,community_delivery',
            'seller_type'        => 'nullable|string|in:private,business',
            'status'             => 'nullable|string|in:draft,active',
            'duration_days'      => 'nullable|integer|min:1|max:90',
            'template_data'      => 'nullable|array',
        ]);

        // Ensure the user has a seller profile
        MarketplaceSellerService::getOrCreateProfile($userId);

        try {
            $listing = MarketplaceListingService::create($userId, $data);
        } catch (\DomainException $e) {
            if ($e->getMessage() === 'SELLER_SUSPENDED') {
                return $this->respondWithError('SELLER_SUSPENDED', __('api_controllers_2.marketplace_listing.seller_suspended'), null, 403);
            }
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api_controllers_2.marketplace_listing.create_failed'), null, 500);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Marketplace listing creation failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api_controllers_2.marketplace_listing.create_failed'), null, 500);
        }

        $detail = MarketplaceListingService::getByIdForOwner($listing->id, $userId);

        $meta = null;
        if ($listing->moderation_status === 'pending') {
            $meta = ['notice' => __('emails_misc.marketplace.listing_pending_notice')];
        }

        return $this->respondWithData($detail, $meta, 201);
    }

    /**
     * PUT /v2/marketplace/listings/{id} — Update an existing listing.
     *
     * Owner-only. Validates ownership before applying changes.
     */
    public function update(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_update', 15, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        $data = request()->validate([
            'title'              => 'sometimes|string|max:200',
            'description'        => 'sometimes|string|max:10000',
            'tagline'            => 'nullable|string|max:300',
            'price'              => 'nullable|numeric|min:0',
            'price_currency'     => 'nullable|string|max:3',
            'price_type'         => 'nullable|string|in:fixed,negotiable,free,auction,contact',
            'time_credit_price'  => 'nullable|numeric|min:0',
            'category_id'        => ['nullable', 'integer', $this->availableCategoryRule()],
            'condition'          => 'nullable|string|in:new,like_new,good,fair,poor',
            'quantity'           => 'nullable|integer|min:1',
            'inventory_count'    => 'nullable|integer|min:0',
            'low_stock_threshold' => 'nullable|integer|min:0',
            'is_oversold_protected' => 'nullable|boolean',
            'location'           => 'nullable|string|max:255',
            'latitude'           => 'nullable|numeric|between:-90,90',
            'longitude'          => 'nullable|numeric|between:-180,180',
            'shipping_available' => 'nullable|boolean',
            'local_pickup'       => 'nullable|boolean',
            'delivery_method'    => 'nullable|string|in:pickup,shipping,both,community_delivery',
            'seller_type'        => 'nullable|string|in:private,business',
            'status'             => 'nullable|string|in:draft,active',
            'template_data'      => 'nullable|array',
        ]);

        try {
            MarketplaceListingService::update($listing, $data);
        } catch (\DomainException $e) {
            if ($e->getMessage() === 'SELLER_SUSPENDED') {
                return $this->respondWithError('SELLER_SUSPENDED', __('api_controllers_2.marketplace_listing.seller_suspended'), null, 403);
            }
            throw $e;
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Marketplace listing update failed', [
                'listing_id' => $id,
                'user_id'    => $userId,
                'error'      => $e->getMessage(),
            ]);
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api_controllers_2.marketplace_listing.update_failed'), null, 500);
        }

        $detail = MarketplaceListingService::getByIdForOwner($id, $userId);

        return $this->respondWithData($detail);
    }

    /**
     * DELETE /v2/marketplace/listings/{id} — Remove a listing.
     *
     * Owner-only. Soft-removes (sets status to 'removed').
     */
    public function destroy(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_delete', 10, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        MarketplaceListingService::remove($listing);

        return $this->noContent();
    }

    // =====================================================================
    //  Images (authenticated, owner-only)
    // =====================================================================

    /**
     * POST /v2/marketplace/listings/{id}/images — Upload images to a listing.
     *
     * Accepts multipart/form-data with images[] files. The per-listing limit is
     * tenant-configured. Uses ImageUploadService for upload handling.
     */
    public function uploadImages(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_image_upload', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        // Check existing image count against tenant config
        $maxImages = \App\Services\MarketplaceConfigurationService::maxImages();
        $existingCount = $listing->images()->count();
        if ($existingCount >= $maxImages) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api_controllers_2.marketplace_listing.max_images_reached', ['max' => $maxImages]),
                'images',
                422
            );
        }

        // Collect uploaded files
        $request = request();
        $files = [];

        if ($request->hasFile('images')) {
            $imageFiles = $request->file('images');
            if (is_array($imageFiles)) {
                $files = array_merge($files, $imageFiles);
            } else {
                $files[] = $imageFiles;
            }
        }

        // Also support numbered fields (image_0, image_1, etc.)
        for ($i = 0; $i < 20; $i++) {
            $key = "image_{$i}";
            if ($request->hasFile($key)) {
                $files[] = $request->file($key);
            }
        }

        // Fallback: single 'image' field
        if (empty($files) && $request->hasFile('image')) {
            $files[] = $request->file('image');
        }

        if (empty($files)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.marketplace_listing.no_image_files'), 'images', 422);
        }

        // Cap at remaining slots
        $remainingSlots = max(0, $maxImages - $existingCount);
        if (count($files) > $remainingSlots) {
            $files = array_slice($files, 0, $remainingSlots);
        }

        $uploadedImages = [];

        // Trusted MIME whitelist — verified via Symfony MIME detection, not client extension
        $allowedImageMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        $extMimeMap = [
            'jpg'  => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png'  => 'image/png',
            'webp' => 'image/webp',
            'gif'  => 'image/gif',
        ];

        foreach ($files as $file) {
            // Reject files whose detected MIME isn't whitelisted OR doesn't match extension
            $detectedMime = $file->getMimeType();
            $ext = strtolower($file->getClientOriginalExtension());
            if (!in_array($detectedMime, $allowedImageMimes, true)) {
                \Illuminate\Support\Facades\Log::warning('Marketplace image upload rejected (bad MIME)', [
                    'listing_id' => $id,
                    'mime'       => $detectedMime,
                    'ext'        => $ext,
                ]);
                continue;
            }
            if (!isset($extMimeMap[$ext]) || $extMimeMap[$ext] !== $detectedMime) {
                \Illuminate\Support\Facades\Log::warning('Marketplace image upload rejected (ext/MIME mismatch)', [
                    'listing_id' => $id,
                    'mime'       => $detectedMime,
                    'ext'        => $ext,
                ]);
                continue;
            }

            try {
                $result = $this->imageUploadService->upload($file, 'marketplace');

                $uploadedImages[] = [
                    'url'           => $result['url'],
                    'thumbnail_url' => $result['thumbnail_url'] ?? null,
                    'alt_text'      => $file->getClientOriginalName(),
                ];
            } catch (\InvalidArgumentException $e) {
                // Skip invalid files but continue with valid ones
                \Illuminate\Support\Facades\Log::warning('Marketplace image upload skipped', [
                    'listing_id' => $id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        if (empty($uploadedImages)) {
            return $this->respondWithError('UPLOAD_FAILED', __('api_controllers_2.marketplace_listing.no_valid_images'), null, 422);
        }

        MarketplaceListingService::addImages($listing, $uploadedImages);
        $this->refreshListingSnapshots($listing);

        // Reload images to return current state
        $listing->load(['images' => fn ($q) => $q->orderBy('sort_order')]);

        $images = $listing->images->map(fn ($img) => [
            'id'            => $img->id,
            'url'           => $img->image_url,
            'thumbnail_url' => $img->thumbnail_url,
            'alt_text'      => $img->alt_text,
            'is_primary'    => (bool) $img->is_primary,
            'sort_order'    => $img->sort_order,
        ])->all();

        return $this->respondWithData($images, null, 201);
    }

    /**
     * Restrict category references to active system categories or categories
     * owned by the current tenant. The plain exists rule accepts another
     * tenant's category because the foreign key is not tenant-composite.
     */
    private function availableCategoryRule(): \Illuminate\Validation\Rules\Exists
    {
        $tenantId = TenantContext::getId();

        return Rule::exists('marketplace_categories', 'id')
            ->where(static function ($query) use ($tenantId): void {
                $query->where('is_active', true)
                    ->where(static function ($tenantQuery) use ($tenantId): void {
                        $tenantQuery->where('tenant_id', $tenantId)
                            ->orWhereNull('tenant_id');
                    });
            });
    }

    /**
     * PUT /v2/marketplace/listings/{id}/images/reorder — Reorder listing images.
     *
     * Body: { "image_ids": [3, 1, 2] }
     */
    public function reorderImages(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        $data = request()->validate([
            'image_ids'   => 'required|array|min:1',
            'image_ids.*' => 'integer',
        ]);

        try {
            MarketplaceListingService::reorderImages($listing, $data['image_ids']);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'image_ids', 422);
        }
        $this->refreshListingSnapshots($listing);

        return $this->respondWithData(['reordered' => true]);
    }

    /**
     * DELETE /v2/marketplace/listings/{id}/images/{imageId} — Delete a listing image.
     */
    public function deleteImage(int $id, int $imageId): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        $deleted = MarketplaceListingService::deleteImage($listing, $imageId);

        if (!$deleted) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.marketplace_listing.image_not_found'), null, 404);
        }

        $this->refreshListingSnapshots($listing);

        return $this->noContent();
    }

    /**
     * POST /v2/marketplace/listings/{id}/video — Upload a video to a listing.
     *
     * Accepts multipart/form-data with a single 'video' file.
     * Maximum 50 MB, allowed types: MP4, WebM, QuickTime (MOV).
     * Stores the file and sets the listing's video_url column.
     */
    public function uploadVideo(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_image_upload', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        $request = request();
        if (!$request->hasFile('video')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.marketplace_listing.no_video_file'), 'video', 422);
        }

        $file = $request->file('video');
        $allowedMimes = ['video/mp4', 'video/webm', 'video/quicktime'];
        $maxSize = 50 * 1024 * 1024; // 50 MB

        $detectedMime = $file->getMimeType();
        if (!in_array($detectedMime, $allowedMimes, true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api_controllers_2.marketplace_listing.invalid_video_type'),
                'video',
                422
            );
        }

        if ($file->getSize() > $maxSize) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api_controllers_2.marketplace_listing.video_too_large'),
                'video',
                422
            );
        }

        // Derive extension from trusted MIME (never from guessExtension() which can return php/exe variants)
        $mimeToExt = [
            'video/mp4'        => 'mp4',
            'video/webm'       => 'webm',
            'video/quicktime'  => 'mov',
        ];
        $safeExt = $mimeToExt[$detectedMime] ?? 'mp4';

        $tenantId = TenantContext::getId();
        $dir = "uploads/marketplace/videos/{$tenantId}";
        $filename = time() . '_' . uniqid() . '.' . $safeExt;

        $path = $file->storeAs($dir, $filename, 'public');
        $url = '/storage/' . $path;

        $listing->update(['video_url' => $url]);
        MarketplaceListingService::markPendingForModeration($listing);

        return $this->respondWithData(['video_url' => $url], null, 201);
    }

    /**
     * DELETE /v2/marketplace/listings/{id}/video — Remove the listing video.
     */
    public function deleteVideo(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        if ($listing->video_url) {
            // Delete the file from storage if it's a local path
            $storagePath = str_replace('/storage/', '', $listing->video_url);
            \Illuminate\Support\Facades\Storage::disk('public')->delete($storagePath);
        }

        $listing->update(['video_url' => null]);
        MarketplaceListingService::markPendingForModeration($listing);

        return $this->noContent();
    }

    // =====================================================================
    //  Renew / Analytics (authenticated, owner-only)
    // =====================================================================

    /**
     * POST /v2/marketplace/listings/{id}/renew — Renew an expired listing.
     *
     * Owner-only. Resets the listing to active status with a new expiry.
     */
    public function renew(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        $days = $this->inputInt('duration_days', 30, 1, 90);

        try {
            $updated = MarketplaceListingService::renew($listing, $days);
        } catch (\DomainException $e) {
            if ($e->getMessage() === 'SELLER_SUSPENDED') {
                return $this->respondWithError('SELLER_SUSPENDED', __('api_controllers_2.marketplace_listing.seller_suspended'), null, 403);
            }
            throw $e;
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
        $detail = MarketplaceListingService::getByIdForOwner($updated->id, $userId);

        return $this->respondWithData($detail);
    }

    /**
     * GET /v2/marketplace/listings/{id}/analytics — Listing performance analytics.
     *
     * Owner-only. Returns views, saves, contacts, offers, and date info.
     */
    public function analytics(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        $listing = $this->findListingOrFail($id);
        $this->ensureOwner($listing, $userId);

        $analytics = MarketplaceListingService::getAnalytics($listing);

        return $this->respondWithData($analytics);
    }

    // =====================================================================
    //  AI Description Generation (authenticated)
    // =====================================================================

    /**
     * POST /v2/marketplace/listings/generate-description — AI description.
     *
     * Uses AiChatService to generate a marketplace listing description
     * from the provided title, category, and condition.
     */
    public function generateDescription(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_ai_generate', 5, 60);

        $data = request()->validate([
            'title'     => 'required|string|max:200',
            'category'  => 'nullable|string|max:100',
            'condition' => 'nullable|string|max:50',
        ]);

        $prompt = "Write a compelling marketplace listing description for the following item. "
            . "Keep it concise (2-3 paragraphs), honest, and appealing to buyers.\n\n"
            . "Title: {$data['title']}";

        if (!empty($data['category'])) {
            $prompt .= "\nCategory: {$data['category']}";
        }
        if (!empty($data['condition'])) {
            $prompt .= "\nCondition: {$data['condition']}";
        }

        $prompt .= "\n\nWrite only the description, no titles or headers.";

        $result = $this->aiChatService->chat($userId, $prompt, [
            'system_prompt' => 'You are a helpful assistant that writes marketplace listing descriptions. Be concise, honest, and appealing. Do not invent features or specs not implied by the title.',
            'max_tokens'    => 512,
        ]);

        if (!empty($result['error'])) {
            return $this->respondWithError('AI_GENERATION_FAILED', __('api_controllers_2.marketplace_listing.ai_description_failed'), null, 422);
        }

        return $this->respondWithData([
            'description' => $result['reply'],
        ]);
    }

    // =====================================================================
    //  Specialty Browse (authenticated)
    // =====================================================================

    /**
     * GET /v2/marketplace/listings/nearby — Geolocation-based listing search.
     *
     * Requires latitude and longitude query params. Optional radius (km, default 25).
     */
    public function nearby(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAuth();
        $this->rateLimit('marketplace_browse', 60, 60);

        $lat = $this->query('latitude');
        $lng = $this->query('longitude');

        if ($lat === null || $lng === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.marketplace_listing.lat_lng_required'), 'latitude', 422);
        }

        $lat = (float) $lat;
        $lng = (float) $lng;

        if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.marketplace_listing.invalid_coordinates'), 'latitude', 422);
        }

        $radius = (float) ($this->query('radius') ?? 25);
        $radius = max(1, min($radius, 200));

        $limit = $this->queryInt('limit', 20, 1, 100);

        $items = MarketplaceListingService::getNearby($lat, $lng, $radius, $limit, [
            'search' => trim((string) ($this->query('q') ?? '')),
            'category_id' => $this->query('category_id'),
        ]);

        return $this->respondWithData($this->augmentPublicMarketplaceListings($items));
    }

    /**
     * GET /v2/marketplace/listings/featured — Promoted/featured listings.
     *
     * Returns active listings that have an active promotion (promoted_until > now).
     */
    public function featured(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_browse', 60, 60);
        $limit = $this->queryInt('limit', 20, 1, 50);

        $result = MarketplaceListingService::getAll([
            'limit'           => $limit,
            'featured_first'  => true,
            'current_user_id' => $userId,
            'sort'            => 'newest',
        ]);

        // Filter to only promoted items
        $featured = array_filter($result['items'], fn ($item) => !empty($item['is_promoted']));

        return $this->respondWithData($this->augmentPublicMarketplaceListings(array_values($featured)));
    }

    /**
     * GET /v2/marketplace/listings/free — Free items only.
     *
     * Convenience endpoint that filters to price_type=free.
     */
    public function free(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_browse', 60, 60);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $cursor = $this->query('cursor');

        $result = MarketplaceListingService::getAll([
            'limit'           => $limit,
            'cursor'          => $cursor,
            'price_type'      => 'free',
            'current_user_id' => $userId,
        ]);

        return $this->respondWithCollection(
            $this->augmentPublicMarketplaceListings($result['items']),
            $result['cursor'],
            $limit,
            $result['has_more']
        );
    }

    /**
     * GET /v2/marketplace/categories/{slug}/listings — Listings for a category slug.
     *
     * Authenticated read-only browse endpoint.
     */
    public function categoryListings(string $slug): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_browse', 60, 60);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $cursor = $this->query('cursor');
        $categoryId = DB::table('marketplace_categories')
            ->where('slug', $slug)
            ->where('is_active', true)
            ->where(function ($query) {
                $query->where('tenant_id', TenantContext::getId())
                    ->orWhereNull('tenant_id');
            })
            ->orderByRaw('CASE WHEN tenant_id = ? THEN 0 ELSE 1 END', [TenantContext::getId()])
            ->value('id');

        if ($categoryId === null) {
            return $this->respondWithCollection([], null, $limit, false);
        }

        $result = MarketplaceListingService::getAll([
            'limit'           => $limit,
            'cursor'          => $cursor,
            'category_id'     => (int) $categoryId,
            'current_user_id' => $userId,
        ]);

        return $this->respondWithCollection(
            $this->augmentPublicMarketplaceListings($result['items']),
            $result['cursor'],
            $limit,
            $result['has_more']
        );
    }

    /**
     * @param array<int, mixed> $items
     * @return array<int, mixed>
     */
    private function augmentPublicMarketplaceListings(array $items): array
    {
        return PublicMarketplaceListingResource::augmentCollection($items);
    }

    // =====================================================================
    //  Saved / Favorites (authenticated)
    // =====================================================================

    /**
     * GET /v2/marketplace/listings/saved — User's saved/bookmarked listings.
     */
    public function savedListings(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        $limit = $this->queryInt('limit', 20, 1, 100);
        $cursor = $this->query('cursor');

        $result = MarketplaceListingService::getSavedListings($userId, $limit, $cursor);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $limit,
            $result['has_more']
        );
    }

    /**
     * POST /v2/marketplace/listings/{id}/save — Save/bookmark a listing.
     */
    public function save(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        // Verify the listing exists
        $this->findListingOrFail($id);

        MarketplaceListingService::saveListing($userId, $id);

        return $this->respondWithData(['saved' => true], null, 201);
    }

    /**
     * DELETE /v2/marketplace/listings/{id}/save — Unsave/unbookmark a listing.
     */
    public function unsave(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_action', 30, 60);

        // Verify the listing exists
        $this->findListingOrFail($id);

        MarketplaceListingService::unsaveListing($userId, $id);

        return $this->respondWithData(['saved' => false]);
    }

    // =====================================================================
    //  Categories (public)
    // =====================================================================

    /**
     * GET /v2/marketplace/categories — All marketplace categories with counts.
     */
    public function categories(): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('marketplace_browse', 60, 60);

        $categories = MarketplaceListingService::getCategories();

        return $this->withPublicCache($this->respondWithData($categories), 300, 60);
    }

    /**
     * GET /v2/marketplace/categories/{id}/template — Category template fields.
     *
     * Returns the template field definitions for a specific category,
     * used by the frontend to render dynamic form fields.
     */
    public function categoryTemplate(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('marketplace_browse', 60, 60);

        $template = MarketplaceCategoryTemplate::where('category_id', $id)->first();

        if (!$template) {
            return $this->withPublicCache($this->respondWithData([
                'category_id' => $id,
                'name'        => null,
                'fields'      => [],
            ]), 600, 300);
        }

        return $this->withPublicCache($this->respondWithData([
            'id'          => $template->id,
            'category_id' => $template->category_id,
            'name'        => $template->name,
            'fields'      => $template->fields ?? [],
        ]), 600, 300);
    }

    // =====================================================================
    //  Pro Seller Bulk Tools (Phase 4)
    // =====================================================================

    /**
     * POST /v2/marketplace/listings/bulk-action — Bulk action on own listings.
     *
     * Body: { listing_ids: [1,2,3], action: 'activate'|'deactivate'|'renew'|'remove' }
     * Owner-only: all listed IDs must belong to the authenticated user.
     */
    public function bulkAction(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_bulk', 10, 60);

        $validated = request()->validate([
            'listing_ids' => 'required|array|min:1|max:100',
            'listing_ids.*' => 'integer',
            'action' => 'required|string|in:activate,deactivate,renew,remove',
        ]);

        $listingIds = $validated['listing_ids'];
        $action = $validated['action'];

        if (in_array($action, ['activate', 'renew'], true)) {
            try {
                MarketplaceListingService::assertSellerCanPublish($userId);
            } catch (\DomainException $e) {
                return $this->respondWithError(
                    'SELLER_SUSPENDED',
                    __('api_controllers_2.marketplace_listing.seller_suspended'),
                    null,
                    403,
                );
            }
        }

        // Verify all listings belong to this user
        $listings = MarketplaceListing::whereIn('id', $listingIds)
            ->where('user_id', $userId)
            ->get();

        if ($listings->count() !== count($listingIds)) {
            return $this->respondWithError(
                'FORBIDDEN',
                    __('api.marketplace_bulk_listing_owner_required'),
                null,
                403
            );
        }

        $processed = 0;

        foreach ($listings as $listing) {
            switch ($action) {
                case 'activate':
                    if ($listing->status === 'draft') {
                        MarketplaceListingService::activate($listing);
                        $processed++;
                    }
                    break;

                case 'deactivate':
                    // marketplace_listings.status enum has no 'inactive' —
                    // unpublish back to 'draft' (the state 'activate' restores from)
                    if ($listing->status === 'active') {
                        $listing->status = 'draft';
                        $listing->save();
                        $processed++;
                    }
                    break;

                case 'renew':
                    if (in_array((string) $listing->status, ['active', 'draft', 'expired'], true)) {
                        $durationDays = MarketplaceConfigurationService::listingDurationDays();
                        MarketplaceListingService::renew($listing, $durationDays);
                        $processed++;
                    }
                    break;

                case 'remove':
                    MarketplaceListingService::remove($listing);
                    $processed++;
                    break;
            }
        }

        return $this->respondWithData([
            'action' => $action,
            'requested' => count($listingIds),
            'processed' => $processed,
        ]);
    }

    /**
     * GET /v2/marketplace/listings/export-csv — Export user's own listings as CSV.
     *
     * Returns a CSV file download of the authenticated user's marketplace listings.
     */
    public function exportCsv(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_export', 5, 60);

        $listings = MarketplaceListing::where('user_id', $userId)
            ->with('category:id,name,slug')
            ->orderBy('id', 'desc')
            ->get();

        $headers = [
            'id', 'title', 'description', 'tagline', 'price', 'price_currency',
            'price_type', 'time_credit_price', 'category', 'condition',
            'quantity', 'location', 'delivery_method', 'seller_type',
            'status', 'views_count', 'saves_count', 'created_at', 'expires_at',
        ];

        $rows = [];
        $rows[] = $headers;

        foreach ($listings as $listing) {
            $rows[] = [
                $listing->id,
                $listing->title,
                $listing->description,
                $listing->tagline,
                $listing->price,
                $listing->price_currency,
                $listing->price_type,
                $listing->time_credit_price,
                $listing->category?->name,
                $listing->condition,
                $listing->quantity,
                $listing->location,
                $listing->delivery_method,
                $listing->seller_type,
                $listing->status,
                $listing->views_count,
                $listing->saves_count,
                $listing->created_at?->toISOString(),
                $listing->expires_at?->toISOString(),
            ];
        }

        // Build CSV string
        $csv = '';
        foreach ($rows as $row) {
            $csv .= implode(',', array_map(function ($field) {
                $str = (string) ($field ?? '');
                // CSV injection protection: prefix cells starting with formula
                // characters with a single quote to prevent spreadsheet execution.
                if ($str !== '' && in_array($str[0], ['=', '+', '-', '@'], true)) {
                    $str = "'" . $str;
                }
                // Escape fields containing commas, quotes, or newlines
                if (str_contains($str, ',') || str_contains($str, '"') || str_contains($str, "\n")) {
                    return '"' . str_replace('"', '""', $str) . '"';
                }
                return $str;
            }, $row)) . "\n";
        }

        return response()->json([
            'success' => true,
            'data' => [
                'csv' => $csv,
                'filename' => 'marketplace-listings-' . date('Y-m-d') . '.csv',
                'count' => $listings->count(),
            ],
        ])->header('Content-Type', 'application/json');
    }

    /**
     * POST /v2/marketplace/listings/import-csv — Import listings from CSV.
     *
     * Accepts a CSV file and creates draft listings for each row.
     * Columns: title, description, price, price_currency, price_type,
     * category_id, condition, quantity, location, delivery_method.
     */
    public function importCsv(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_import', 3, 60);

        $request = request();
        $request->validate([
            'file' => 'required|file|mimes:csv,txt|max:2048',
        ]);

        $file = $request->file('file');
        $content = file_get_contents($file->getRealPath());

        if (!$content) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.marketplace_listing.csv_read_failed'), 'file', 422);
        }

        $lines = str_getcsv($content, "\n");
        if (count($lines) < 2) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.marketplace_listing.csv_header_required'), 'file', 422);
        }

        // Parse header
        $headerLine = array_shift($lines);
        $headers = str_getcsv($headerLine);
        $headers = array_map('trim', $headers);
        $headers = array_map('strtolower', $headers);

        $requiredColumns = ['title', 'description'];
        foreach ($requiredColumns as $col) {
            if (!in_array($col, $headers, true)) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api_controllers_2.marketplace_listing.csv_missing_column', ['col' => $col]),
                    'file',
                    422
                );
            }
        }

        // Ensure seller profile exists
        MarketplaceSellerService::getOrCreateProfile($userId);

        $created = 0;
        $errors = [];
        $maxImport = 50;

        foreach ($lines as $lineNum => $line) {
            if ($created >= $maxImport) {
                $errors[] = __('api.marketplace_listing_csv_import_limit', ['max' => $maxImport]);
                break;
            }

            $row = str_getcsv($line);
            if (count($row) !== count($headers)) {
                $errors[] = __('api.marketplace_listing_csv_column_mismatch', ['row' => $lineNum + 2]);
                continue;
            }

            $data = array_combine($headers, $row);

            // Validate required fields
            $title = trim($data['title'] ?? '');
            $description = trim($data['description'] ?? '');

            if (empty($title) || empty($description)) {
                $errors[] = __('api.marketplace_listing_csv_required_fields', ['row' => $lineNum + 2]);
                continue;
            }

            if (strlen($title) > 200 || strlen($description) > 10000) {
                $errors[] = __('api.marketplace_listing_csv_length_limit', ['row' => $lineNum + 2]);
                continue;
            }

            $listingData = [
                'title' => $title,
                'description' => $description,
                'status' => 'draft', // Always create as draft
            ];

            // Optional fields
            if (!empty($data['price'])) {
                $listingData['price'] = (float) $data['price'];
            }
            if (!empty($data['price_currency'])) {
                $listingData['price_currency'] = strtoupper(substr(trim($data['price_currency']), 0, 3));
            }
            if (!empty($data['price_type']) && in_array($data['price_type'], ['fixed', 'negotiable', 'free', 'auction', 'contact'], true)) {
                $listingData['price_type'] = $data['price_type'];
            }
            if (!empty($data['category_id'])) {
                $listingData['category_id'] = (int) $data['category_id'];
            }
            if (!empty($data['condition']) && in_array($data['condition'], ['new', 'like_new', 'good', 'fair', 'poor'], true)) {
                $listingData['condition'] = $data['condition'];
            }
            if (!empty($data['quantity'])) {
                $listingData['quantity'] = max(1, (int) $data['quantity']);
            }
            if (!empty($data['location'])) {
                $listingData['location'] = trim($data['location']);
            }
            if (!empty($data['delivery_method']) && in_array($data['delivery_method'], ['pickup', 'shipping', 'both', 'community_delivery'], true)) {
                $listingData['delivery_method'] = $data['delivery_method'];
            }
            if (!empty($data['tagline'])) {
                $listingData['tagline'] = substr(trim($data['tagline']), 0, 300);
            }

            try {
                MarketplaceListingService::create($userId, $listingData);
                $created++;
            } catch (\Throwable $e) {
                Log::warning('Marketplace CSV import: row failed', [
                    'row' => $lineNum + 2,
                    'error' => $e->getMessage(),
                ]);
                $errors[] = __('api.marketplace_csv_row_error', [
                    'row' => $lineNum + 2,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $this->respondWithData([
            'created' => $created,
            'errors' => $errors,
            'message' => __('api_controllers_2.marketplace_listing.imported_as_drafts', ['count' => $created]),
        ], null, 201);
    }
}
