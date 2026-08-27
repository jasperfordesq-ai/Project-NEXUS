<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Http\Requests\Listings\ListListingsRequest;
use App\Http\Resources\PublicListingResource;
use App\Models\ListingImage;
use App\Models\Notification;
use App\Services\AiChatService;
use App\Services\ListingService;
use App\Services\ListingAnalyticsService;
use App\Services\ListingConfigurationService;
use App\Services\ListingExpiryService;
use App\Services\ListingRankingService;
use App\Services\ListingSkillTagService;
use App\Services\ListingFeaturedService;
use App\Services\PersonalisedFeedService;
use App\Models\ListingReport;
use App\Support\UserDisplayName;

/**
 * ListingsController - Listings CRUD, search, favorites, tags, analytics, renewal.
 *
 * Converted from delegation to direct static service calls.
 * All methods are now native Laravel — no legacy delegation remains.
 */
class ListingsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly AiChatService $aiService,
        private readonly ListingAnalyticsService $listingAnalyticsService,
        private readonly ListingExpiryService $listingExpiryService,
        private readonly ListingFeaturedService $listingFeaturedService,
        private readonly ListingRankingService $listingRankingService,
        private readonly ListingService $listingService,
        private readonly ListingSkillTagService $listingSkillTagService,
        private readonly PersonalisedFeedService $personalisedFeedService,
    ) {}

    private function listingConfigEnabled(string $key): bool
    {
        return filter_var(
            ListingConfigurationService::get($key, ListingConfigurationService::DEFAULTS[$key] ?? false),
            FILTER_VALIDATE_BOOLEAN
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings
    // -----------------------------------------------------------------

    public function index(ListListingsRequest $request): JsonResponse
    {
        $this->rateLimit('listings_index', 120, 60);
        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();

        $filters = [];

        // Type filter (supports comma-separated)
        $type = $this->query('type');
        if ($type) {
            $filters['type'] = str_contains($type, ',') ? explode(',', $type) : $type;
        }

        if ($this->query('category_id')) {
            $filters['category_id'] = $this->queryInt('category_id');
        } elseif ($this->query('category')) {
            $filters['category_slug'] = $this->query('category');
        }

        $search = $this->query('q') ?? $this->query('search');
        if ($search) {
            $filters['search'] = $search;
        }

        if ($this->query('user_id')) {
            $filters['user_id'] = $this->queryInt('user_id');
        }

        if ($this->query('skills')) {
            $filters['skills'] = $this->query('skills');
        }

        if ($this->queryBool('featured_first')) {
            $filters['featured_first'] = true;
        }

        if ($this->query('min_hours')) {
            $filters['min_hours'] = max(0, min(1000, (float) $this->query('min_hours')));
        }
        if ($this->query('max_hours')) {
            $filters['max_hours'] = max(0, min(2000, (float) $this->query('max_hours')));
        }
        if ($this->query('service_type')) {
            $allowed = ['physical_only', 'remote_only', 'hybrid', 'location_dependent'];
            $types = array_filter(explode(',', $this->query('service_type')), fn($t) => in_array(trim($t), $allowed, true));
            if (!empty($types)) {
                $filters['service_type'] = implode(',', $types);
            }
        }
        if ($this->query('posted_within')) {
            $filters['posted_within'] = max(1, min(365, (int) $this->query('posted_within')));
        }
        if ($this->queryBool('with_coordinates')) {
            $filters['with_coordinates'] = true;
        }

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $filters['limit'] = $this->queryInt('per_page', 20, 1, 100);

        if ($userId !== null) {
            $filters['current_user_id'] = $userId;
        }

        // Proximity / radius filter (near_lat, near_lng, radius_km)
        $nearLat = $this->query('near_lat');
        $nearLng = $this->query('near_lng');
        $radiusKm = $this->query('radius_km');
        if ($nearLat !== null && $nearLng !== null && $radiusKm !== null) {
            $lat = (float) $nearLat;
            $lng = (float) $nearLng;
            $km  = max(0.1, min(500, (float) $radiusKm));
            if ($lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180) {
                $filters['near_lat']  = $lat;
                $filters['near_lng']  = $lng;
                $filters['radius_km'] = $km;
            }
        }

        $result = $this->listingService->getAll($filters);

        // Count total matching listings (without cursor/limit)
        $totalCount = $this->listingService->countAll($filters);

        // AG35 — resolve personalised flag (explicit param > user pref > tenant setting > default true)
        $personalised = $this->resolveListingsPersonalisedFlag($userId);

        // Skip re-ranking when proximity is active — getNearby() already returns results sorted
        // by distance_km ASC and re-ranking would destroy that meaningful ordering.
        $hasProximity = !empty($filters['near_lat']);

        // Apply MatchRank unless the user has explicitly chosen newest-first sort.
        // featured listings get FEATURED_BOOST (5×) inside the ranker so they always pin to top.
        $sortNewest = $this->query('sort') === 'newest' || !$personalised;
        if ($this->listingRankingService->isEnabled() && !empty($result['items']) && !$sortNewest && !$hasProximity) {
            $result['items'] = $this->listingRankingService->rankListings(
                $result['items'],
                $userId,
                ['search' => $filters['search'] ?? null]
            );
            $result['items'] = array_map(static function (array $item): array {
                $reciprocity = $item['_score_breakdown']['reciprocity'] ?? 1.0;
                $item['reciprocity_match'] = $reciprocity >= 2.0 ? 'mutual' : ($reciprocity > 1.0 ? 'one_way' : null);
                unset($item['_match_rank'], $item['_score_breakdown']);
                return $item;
            }, $result['items']);
        }

        // AG35 — additional personalisation pass (interest/CF/social/proximity blend)
        if ($personalised && $userId && !empty($result['items']) && !$hasProximity) {
            $result['items'] = $this->personalisedFeedService->rank($userId, 'listings', $result['items']);
        }

        $result['items'] = array_map(
            static fn (array $item): array => PublicListingResource::augment($item),
            $result['items']
        );

        $page = $this->queryInt('page', 1, 1, PHP_INT_MAX) ?? 1;

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more'],
            [
                'cursor' => $result['cursor'],
                'page' => $page,
                'total' => $totalCount,
                'total_items' => $totalCount,
            ]
        );
    }

    /**
     * AG35 — resolve whether the listings index should be personalised.
     *
     * Precedence: explicit ?personalised=true|false → user pref → tenant setting (default true).
     */
    private function resolveListingsPersonalisedFlag(?int $userId): bool
    {
        if (!$userId) {
            return false;
        }
        $explicit = $this->query('personalised');
        if ($explicit !== null) {
            return filter_var($explicit, FILTER_VALIDATE_BOOLEAN);
        }
        try {
            $prefersChrono = (bool) DB::table('users')
                ->where('id', $userId)
                ->value('prefers_chronological_feed');
            if ($prefersChrono) {
                return false;
            }
        } catch (\Throwable $e) {
            // ignore
        }
        return (bool) TenantContext::getSetting('listings.personalisation.enabled', true);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/{id}
    // -----------------------------------------------------------------

    public function show(int $id): JsonResponse
    {
        $this->rateLimit('listings_show', 300, 60);
        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $listing = $this->listingService->getById($id, false, $userId);

        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        // Track view (skip if viewer is the listing owner)
        if ($userId === null || $userId !== (int) ($listing['user_id'] ?? 0)) {
            try {
                $ip = \App\Core\ClientIp::get();
                $this->listingAnalyticsService->recordView($id, $userId, $ip);
            } catch (\Throwable $e) {
                // Non-critical
            }
        }

        // Attach skill tags
        try {
            $listing['skill_tags'] = $this->listingSkillTagService->getTags($id);
        } catch (\Throwable $e) {
            $listing['skill_tags'] = [];
        }

        // Attach images
        try {
            $images = ListingImage::where('listing_id', $id)
                ->orderBy('sort_order')
                ->get();
            $listing['images'] = $images->map(fn($img) => [
                'id' => $img->id,
                'url' => $img->image_url,
                'sort_order' => $img->sort_order,
                'alt_text' => $img->alt_text,
            ])->values()->toArray();
        } catch (\Throwable $e) {
            $listing['images'] = [];
        }

        $listing['is_featured'] = (bool) ($listing['is_featured'] ?? false);

        // Reciprocity: load the listing owner's OTHER active listings (max 6)
        try {
            $ownerUserId = (int) ($listing['user_id'] ?? 0);
            $tenantId = TenantContext::getId();

            if ($ownerUserId > 0) {
                $otherListings = DB::table('listings')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $ownerUserId)
                    ->where('id', '!=', $id)
                    ->where(function ($q) {
                        $q->whereNull('status')->orWhere('status', 'active');
                    })
                    ->select(['id', 'title', 'type', 'hours_estimate'])
                    ->orderByDesc('created_at')
                    ->limit(6)
                    ->get();

                $listing['member_offers'] = $otherListings
                    ->filter(fn ($l) => $l->type === 'offer')
                    ->map(fn ($l) => [
                        'id' => $l->id,
                        'title' => $l->title,
                        'type' => $l->type,
                        'hours_estimate' => $l->hours_estimate,
                    ])
                    ->values()
                    ->all();

                $listing['member_requests'] = $otherListings
                    ->filter(fn ($l) => $l->type === 'request')
                    ->map(fn ($l) => [
                        'id' => $l->id,
                        'title' => $l->title,
                        'type' => $l->type,
                        'hours_estimate' => $l->hours_estimate,
                    ])
                    ->values()
                    ->all();
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to load reciprocity listings', ['listing_id' => $id, 'error' => $e->getMessage()]);
            $listing['member_offers'] = [];
            $listing['member_requests'] = [];
        }

        return $this->respondWithData(PublicListingResource::augment($listing));
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/listings
    // -----------------------------------------------------------------

    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('listing_create', 10, 60);

        $data = $this->getAllInput();
        // image_url must go through the dedicated uploadImage endpoint — strip from user input
        unset($data['image_url']);

        try {
            $listing = $this->listingService->create($userId, $data);
        } catch (\Illuminate\Validation\ValidationException $e) {
            $errors = [];
            foreach ($e->errors() as $field => $messages) {
                foreach ($messages as $message) {
                    $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => $message, 'field' => $field];
                }
            }
            return $this->respondWithErrors($errors, 422);
        }

        $result = $this->listingService->getById($listing->id, false, $userId);

        // Award XP for creating a listing
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['create_listing'], 'create_listing', __('api.listing_created_activity'));
            \App\Services\GamificationService::runAllBadgeChecks($userId);
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'create_listing', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        if (($listing->status ?? 'active') === 'active' && (($listing->moderation_status ?? 'approved') === 'approved')) {
            // Record feed activity
            try {
                app(\App\Services\FeedActivityService::class)->recordActivity(
                    \App\Core\TenantContext::getId(),
                    $userId,
                    'listing',
                    $listing->id,
                    [
                        'title'     => $data['title'] ?? null,
                        'content'   => $data['description'] ?? null,
                        'image_url' => $result['image_url'] ?? null,
                    ]
                );
            } catch (\Throwable $e) {
                \Log::warning('Feed activity recording failed', ['type' => 'listing', 'id' => $listing->id, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData($result, null, 201);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/listings/{id}
    // -----------------------------------------------------------------

    public function update(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('listing_update', 20, 60);

        // Verify ownership or admin
        $existing = $this->listingService->getById($id, false, $userId);
        if (!$existing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }
        if (!$this->listingService->canModify($existing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_edit_own_only'), null, 403);
        }

        $data = $this->getAllInput();
        // image_url must go through the dedicated uploadImage endpoint — strip from user input
        unset($data['image_url']);

        $isAdmin = $this->listingService->canModify($existing, $userId) && (int) ($existing['user_id'] ?? 0) !== $userId;

        try {
            $this->listingService->update($id, $data, $isAdmin);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        } catch (\Illuminate\Validation\ValidationException $e) {
            $errors = [];
            foreach ($e->errors() as $field => $messages) {
                foreach ($messages as $message) {
                    $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => $message, 'field' => $field];
                }
            }
            return $this->respondWithErrors($errors, 422);
        }

        $listing = $this->listingService->getById($id);

        return $this->respondWithData($listing);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/listings/{id}
    // -----------------------------------------------------------------

    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('listing_delete', 10, 60);

        // Verify ownership or admin
        $existing = $this->listingService->getById($id, false, $userId);
        if (!$existing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }
        if (!$this->listingService->canModify($existing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_delete_own_only'), null, 403);
        }

        $success = $this->listingService->delete($id);

        if (!$success) {
            return $this->respondWithError('DELETE_FAILED', __('api.listing_delete_failed'), null, 400);
        }

        // Clean up feed entry for deleted listing
        try {
            app(\App\Services\FeedActivityService::class)->removeActivity('listing', $id);
        } catch (\Throwable $e) {
            \Log::warning('Feed cleanup failed for deleted listing', ['listing_id' => $id, 'error' => $e->getMessage()]);
        }

        return $this->noContent();
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/nearby
    // -----------------------------------------------------------------

    public function nearby(): JsonResponse
    {
        $this->rateLimit('listings_nearby', 60, 60);
        $lat = $this->query('lat');
        $lon = $this->query('lon');

        if ($lat === null || $lon === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lat_lon_required'), null, 400);
        }

        $lat = (float) $lat;
        $lon = (float) $lon;

        if ($lat < -90 || $lat > 90) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lat_range'), 'lat', 400);
        }
        if ($lon < -180 || $lon > 180) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lon_range'), 'lon', 400);
        }

        $filters = [
            'radius_km' => max(0.1, min(500, (float) $this->query('radius_km', '25'))),
            'limit'     => $this->queryInt('per_page', 20, 1, 100),
        ];

        $type = $this->query('type');
        if ($type) {
            $filters['type'] = str_contains($type, ',') ? explode(',', $type) : $type;
        }

        if ($this->query('category_id')) {
            $filters['category_id'] = $this->queryInt('category_id');
        } elseif ($this->query('category')) {
            $filters['category_slug'] = $this->query('category');
        }

        $search = $this->query('q') ?? $this->query('search');
        if ($search) {
            $filters['search'] = $search;
        }

        if ($this->query('min_hours')) {
            $filters['min_hours'] = max(0, min(1000, (float) $this->query('min_hours')));
        }
        if ($this->query('max_hours')) {
            $filters['max_hours'] = max(0, min(2000, (float) $this->query('max_hours')));
        }
        if ($this->query('service_type')) {
            $allowed = ['physical_only', 'remote_only', 'hybrid', 'location_dependent'];
            $types = array_filter(explode(',', $this->query('service_type')), fn($t) => in_array(trim($t), $allowed, true));
            if (!empty($types)) {
                $filters['service_type'] = implode(',', $types);
            }
        }
        if ($this->query('posted_within')) {
            $filters['posted_within'] = max(1, min(365, (int) $this->query('posted_within')));
        }

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        if ($userId !== null) {
            $filters['current_user_id'] = $userId;
        }

        $result = $this->listingService->getNearby($lat, $lon, $filters);

        // Apply MatchRank on top of the distance-filtered set (same rules as index).
        // Proximity is already baked into the MatchRank geo score, so nearby listings
        // are still prioritised; engagement, quality, and reciprocity break ties.
        $sortNewest = $this->query('sort') === 'newest';
        if ($this->listingRankingService->isEnabled() && !empty($result['items']) && !$sortNewest) {
            $result['items'] = $this->listingRankingService->rankListings(
                $result['items'],
                $userId,
                ['search' => $filters['search'] ?? null]
            );
            $result['items'] = array_map(static function (array $item): array {
                $reciprocity = $item['_score_breakdown']['reciprocity'] ?? 1.0;
                $item['reciprocity_match'] = $reciprocity >= 2.0 ? 'mutual' : ($reciprocity > 1.0 ? 'one_way' : null);
                unset($item['_match_rank'], $item['_score_breakdown']);
                return $item;
            }, $result['items']);
        }

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'] ?? null,
            $filters['limit'],
            $result['has_more'] ?? false,
            [
                'search' => [
                    'type'      => 'nearby',
                    'lat'       => $lat,
                    'lon'       => $lon,
                    'radius_km' => $filters['radius_km'],
                ],
            ]
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/saved
    // -----------------------------------------------------------------

    public function getSavedListings(): JsonResponse
    {
        if (! $this->listingConfigEnabled(ListingConfigurationService::CONFIG_ENABLE_FAVOURITES)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.listing_favourites_disabled'), null, 403);
        }

        $userId = $this->requireAuth();

        $savedIds = $this->listingService->getSavedListingIds($userId);

        return $this->respondWithData($savedIds);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/featured
    // -----------------------------------------------------------------

    public function featured(): JsonResponse
    {
        $limit = $this->queryInt('per_page', 10, 1, 50);

        $items = $this->listingFeaturedService->getFeaturedListings($limit);

        return $this->respondWithData($items);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/listings/{id}/save
    // -----------------------------------------------------------------

    public function saveListing(int $id): JsonResponse
    {
        if (! $this->listingConfigEnabled(ListingConfigurationService::CONFIG_ENABLE_FAVOURITES)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.listing_favourites_disabled'), null, 403);
        }

        $userId = $this->requireAuth();

        $tenantId = TenantContext::getId();
        $alreadySaved = DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('listing_id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        $result = $this->listingService->saveListing($userId, $id);

        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        try {
            if (!$alreadySaved) {
                $this->listingAnalyticsService->updateSaveCount($id, true);
            }
        } catch (\Exception $e) {
            // Non-critical
        }

        // Notify listing owner that someone saved their listing (bell only, skip if saver === owner)
        try {
            $listing = $alreadySaved ? null : DB::table('listings')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->select(['user_id', 'title'])
                ->first();

            if ($listing && (int) $listing->user_id !== $userId) {
                $saver = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
                    ->first();

                $owner = DB::table('users')
                    ->where('id', (int) $listing->user_id)
                    ->where('tenant_id', $tenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($owner, function () use ($saver, $listing, $id) {
                    $saverName = __('emails.common.fallback_someone');
                    if ($saver) {
                        $saverName = UserDisplayName::resolve($saver);
                        if (empty($saverName)) {
                            $saverName = $saver->name ?? __('emails.common.fallback_someone');
                        }
                    }

                    $saverName = htmlspecialchars($saverName, ENT_QUOTES, 'UTF-8');
                    $title = htmlspecialchars($listing->title ?? '', ENT_QUOTES, 'UTF-8');

                    Notification::create([
                        'user_id' => (int) $listing->user_id,
                        'message' => __('api_controllers_3.listings.listing_saved_notification', ['saver_name' => $saverName, 'title' => $title]),
                        'link' => "/listings/{$id}",
                        'type' => 'listing_saved',
                        'created_at' => now(),
                    ]);
                });
            }
        } catch (\Exception $e) {
            Log::warning("[ListingsController] saveListing notification failed for listing #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['saved' => true, 'listing_id' => $id]);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/listings/{id}/save
    // -----------------------------------------------------------------

    public function unsaveListing(int $id): JsonResponse
    {
        if (! $this->listingConfigEnabled(ListingConfigurationService::CONFIG_ENABLE_FAVOURITES)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.listing_favourites_disabled'), null, 403);
        }

        $userId = $this->requireAuth();

        $wasSaved = DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('listing_id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->exists();

        $this->listingService->unsaveListing($userId, $id);

        try {
            if ($wasSaved) {
                $this->listingAnalyticsService->updateSaveCount($id, false);
            }
        } catch (\Exception $e) {
            // Non-critical
        }

        return $this->respondWithData(['saved' => false, 'listing_id' => $id]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/tags/popular
    // -----------------------------------------------------------------

    public function popularTags(): JsonResponse
    {
        $this->rateLimit('listing_tags_popular', 60, 60);
        $limit = $this->queryInt('limit', 20, 1, 50);

        $tags = $this->listingSkillTagService->getPopularTags($limit);

        return $this->respondWithData($tags);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/tags/autocomplete
    // -----------------------------------------------------------------

    public function autocompleteTags(): JsonResponse
    {
        $this->rateLimit('listing_tags_autocomplete', 60, 60);
        $prefix = trim($this->query('q', ''));
        if (strlen($prefix) < 2) {
            return $this->respondWithData([]);
        }

        $limit = $this->queryInt('limit', 10, 1, 20);
        $tags = $this->listingSkillTagService->autocompleteTags($prefix, $limit);

        return $this->respondWithData($tags);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/listings/{id}/image
    // -----------------------------------------------------------------

    public function deleteImage($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $listing = $this->listingService->getById($id);

        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_modify_forbidden'), null, 403);
        }

        $this->listingService->update($id, ['image_url' => null]);

        return $this->respondWithData(['image_url' => null]);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/listings/{id}/renew
    // -----------------------------------------------------------------

    public function renew($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('listing_renew', 10, 60);

        $result = $this->listingExpiryService->renewListing($id, $userId);

        if (!$result['success']) {
            $status = match ($result['error_code'] ?? null) {
                'not_found' => 404,
                'forbidden' => 403,
                default => 422,
            };
            return $this->respondWithError('RENEWAL_FAILED', $result['error'], null, $status);
        }

        return $this->respondWithData([
            'renewed'        => true,
            'listing_id'     => $id,
            'new_expires_at' => $result['new_expires_at'],
        ]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/listings/{id}/analytics
    // -----------------------------------------------------------------

    public function analytics($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('listing_analytics', 60, 60);

        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_analytics_forbidden'), null, 403);
        }

        $days = $this->queryInt('days', 30, 1, 90);
        $analytics = $this->listingAnalyticsService->getAnalytics($id, $days);

        return $this->respondWithData($analytics);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/listings/{id}/tags
    // -----------------------------------------------------------------

    public function setSkillTags($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('listing_tags', 30, 60);

        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_modify_forbidden'), null, 403);
        }

        $data = $this->getAllInput();
        $tags = $data['tags'] ?? [];

        if (!is_array($tags)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.listing_tags_must_be_array'), 'tags', 400);
        }

        $success = $this->listingSkillTagService->setTags($id, $tags);

        if (!$success) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        $updatedTags = $this->listingSkillTagService->getTags($id);

        return $this->respondWithData(['listing_id' => $id, 'tags' => $updatedTags]);
    }

    // -----------------------------------------------------------------
    //  IMAGE UPLOAD
    // -----------------------------------------------------------------

    /**
     * POST /api/v2/listings/{id}/image
     *
     * Upload an image for a listing. Uses request()->file() (Laravel native).
     * Field name: 'image'
     */
    public function uploadImage($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('listing_image_upload', 10, 60);

        // Verify listing exists and user can modify it
        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_modify_forbidden'), null, 403);
        }

        $file = request()->file('image');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.listing_no_image_uploaded'), 'image', 400);
        }

        $allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!in_array($file->getMimeType(), $allowedMimes)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.listing_image_invalid_type'), null, 422);
        }

        try {
            // Build a $_FILES-compatible array for ImageUploader::upload()
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            $imageUrl = \App\Core\ImageUploader::upload($fileArray);

            // Update listing with new image
            $this->listingService->update($id, ['image_url' => $imageUrl]);

            return $this->respondWithData(['image_url' => $imageUrl]);
        } catch (\Exception $e) {
            \Log::error('Listing image upload failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.listing_image_upload_failed'), 'image', 500);
        }
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/listings/{id}/report
    // -----------------------------------------------------------------

    /**
     * Report a listing for community moderation.
     *
     * Authenticated users can flag a listing as inappropriate. Each user
     * may only report a given listing once (409 on duplicates).
     * Rate-limited to 5 reports per hour per user.
     */
    public function report(int $id): JsonResponse
    {
        if (! $this->listingConfigEnabled(ListingConfigurationService::CONFIG_ENABLE_REPORTING)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.listing_reporting_disabled'), null, 403);
        }

        $userId = $this->requireAuth();
        $this->rateLimit('listing_report', 5, 3600);

        $tenantId = TenantContext::getId();

        // Validate the listing exists and is active
        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        // Cannot report your own listing
        if ((int) ($listing['user_id'] ?? 0) === $userId) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.listings.cannot_report_own'), null, 403);
        }

        // Validate input
        $data = $this->getAllInput();

        $validReasons = ['inappropriate', 'safety_concern', 'misleading', 'spam', 'not_timebank_service', 'other'];
        $reason = $data['reason'] ?? null;
        if (!$reason || !in_array($reason, $validReasons, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.listings.valid_reason_required'), 'reason', 422);
        }

        $details = isset($data['details']) ? trim((string) $data['details']) : null;
        if ($details !== null && mb_strlen($details) > 500) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.listings.details_max_500'), 'details', 422);
        }

        // Check for duplicate report
        $existing = ListingReport::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('listing_id', $id)
            ->where('reporter_id', $userId)
            ->first();

        if ($existing) {
            return $this->respondWithError('ALREADY_REPORTED', __('api_controllers_2.listings.already_reported'), null, 409);
        }

        // Create the report
        $report = ListingReport::create([
            'tenant_id'   => $tenantId,
            'listing_id'  => $id,
            'reporter_id' => $userId,
            'reason'      => $reason,
            'details'     => $details ?: null,
            'status'      => 'pending',
        ]);

        Log::info('Listing reported', [
            'listing_id'  => $id,
            'reporter_id' => $userId,
            'reason'      => $reason,
            'tenant_id'   => $tenantId,
        ]);

        // Alert moderators a new listing report awaits review (previously silent).
        try {
            $listingTitle = (string) (\Illuminate\Support\Facades\DB::table('listings')
                ->where('id', $id)->where('tenant_id', $tenantId)->value('title') ?? ('#' . $id));
            \App\Services\NotificationDispatcher::notifyModerationAdmins(
                'listing_report_created',
                '/admin/reports',
                'svc_notifications_2.listing_report.admin_alert',
                'emails_misc.moderation.listing_subject',
                'emails_misc.moderation.listing_body',
                ['listing_title' => $listingTitle, 'reason' => $reason, 'details' => (string) ($details ?? ''), 'report_id' => $report->id]
            );
        } catch (\Throwable $notifyError) {
            Log::warning('Listing report admin alert failed: ' . $notifyError->getMessage());
        }

        return $this->respondWithData([
            'reported' => true,
            'message'  => __('api_controllers_2.listings.report_thank_you'),
        ], null, 201);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/listings/{id}/images — Multi-image upload
    // -----------------------------------------------------------------

    /**
     * Upload up to 5 images for a listing (multipart form).
     * Field name: 'images[]'
     * Creates ListingImage records with incremental sort_order.
     * Sets the first image as listing.image_url for backward compatibility.
     */
    public function uploadImages(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('listing_images_upload', 10, 60);

        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_modify_forbidden'), null, 403);
        }

        $files = request()->file('images');
        if (!$files || !is_array($files) || count($files) === 0) {
            // Fall back to single file field name
            $singleFile = request()->file('image');
            if ($singleFile && $singleFile->isValid()) {
                $files = [$singleFile];
            } else {
                return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.listings.no_images_uploaded'), 'images', 400);
            }
        }

        // Check existing image count against configured limit
        $maxImages = (int) ListingConfigurationService::get(ListingConfigurationService::CONFIG_MAX_IMAGES, 5);
        $existingCount = ListingImage::where('listing_id', $id)->count();
        if ($existingCount + count($files) > $maxImages) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.listing_images_limit_exceeded', [
                    'max' => $maxImages,
                    'current' => $existingCount,
                    'attempted' => count($files),
                ]),
                'images',
                422
            );
        }

        $maxSortOrder = ListingImage::where('listing_id', $id)->max('sort_order') ?? -1;
        $tenantId = TenantContext::getId();
        $createdImages = [];

        foreach ($files as $file) {
            if (!$file->isValid()) {
                continue;
            }

            // Validate size and type
            if ($file->getSize() > 8 * 1024 * 1024) {
                continue; // skip oversized files
            }

            $allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            if (!in_array($file->getMimeType(), $allowedMimes)) {
                continue; // skip non-image files
            }

            try {
                $fileArray = [
                    'name'     => $file->getClientOriginalName(),
                    'type'     => $file->getMimeType(),
                    'tmp_name' => $file->getRealPath(),
                    'error'    => UPLOAD_ERR_OK,
                    'size'     => $file->getSize(),
                ];

                $imageUrl = \App\Core\ImageUploader::upload($fileArray);
                $maxSortOrder++;

                $listingImage = ListingImage::create([
                    'tenant_id'  => $tenantId,
                    'listing_id' => $id,
                    'image_url'  => $imageUrl,
                    'sort_order' => $maxSortOrder,
                    'alt_text'   => null,
                ]);

                $createdImages[] = [
                    'id'         => $listingImage->id,
                    'url'        => $listingImage->image_url,
                    'sort_order' => $listingImage->sort_order,
                    'alt_text'   => $listingImage->alt_text,
                ];
            } catch (\Exception $e) {
                \Log::warning('Multi-image upload: one file failed', ['error' => $e->getMessage()]);
            }
        }

        // Update listing.image_url to the first image (backward compat)
        $firstImage = ListingImage::where('listing_id', $id)
            ->orderBy('sort_order')
            ->first();

        if ($firstImage) {
            $this->listingService->update($id, ['image_url' => $firstImage->image_url]);
        }

        return $this->respondWithData($createdImages, null, 201);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/listings/{id}/images/{imageId}
    // -----------------------------------------------------------------

    /**
     * Delete a specific image from a listing.
     * If the deleted image was listing.image_url, updates to the next image or null.
     */
    public function deleteListingImage(int $id, int $imageId): JsonResponse
    {
        $userId = $this->requireAuth();

        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_modify_forbidden'), null, 403);
        }

        $image = ListingImage::where('listing_id', $id)
            ->where('id', $imageId)
            ->first();

        if (!$image) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.listings.image_not_found'), null, 404);
        }

        $deletedUrl = $image->image_url;
        $image->delete();

        // If the deleted image was the listing's primary image, update to next or null
        if (($listing['image_url'] ?? null) === $deletedUrl) {
            $nextImage = ListingImage::where('listing_id', $id)
                ->orderBy('sort_order')
                ->first();
            $this->listingService->update($id, [
                'image_url' => $nextImage ? $nextImage->image_url : null,
            ]);
        }

        // Return remaining images
        $remaining = ListingImage::where('listing_id', $id)
            ->orderBy('sort_order')
            ->get()
            ->map(fn($img) => [
                'id'         => $img->id,
                'url'        => $img->image_url,
                'sort_order' => $img->sort_order,
                'alt_text'   => $img->alt_text,
            ])->values()->toArray();

        return $this->respondWithData($remaining);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/listings/{id}/images/reorder
    // -----------------------------------------------------------------

    /**
     * Reorder images for a listing.
     * Accepts { "image_ids": [3, 1, 2] } — array of image IDs in desired order.
     */
    public function reorderImages(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $listing = $this->listingService->getById($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
        }

        if (!$this->listingService->canModify($listing, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.listing_modify_forbidden'), null, 403);
        }

        $data = $this->getAllInput();
        $imageIds = $data['image_ids'] ?? [];

        if (!is_array($imageIds) || empty($imageIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.listings.image_ids_non_empty'), 'image_ids', 400);
        }

        // Verify all IDs belong to this listing
        $existingIds = ListingImage::where('listing_id', $id)
            ->pluck('id')
            ->toArray();

        foreach ($imageIds as $imgId) {
            if (!in_array((int) $imgId, $existingIds)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.listing_image_id_not_belong', ['id' => $imgId]), 'image_ids', 422);
            }
        }

        // Update sort_order atomically
        DB::transaction(function () use ($imageIds, $id) {
            foreach ($imageIds as $index => $imgId) {
                ListingImage::where('id', (int) $imgId)
                    ->where('listing_id', $id)
                    ->update(['sort_order' => $index]);
            }
        });

        // Update listing.image_url to the first image
        $firstImage = ListingImage::where('listing_id', $id)
            ->orderBy('sort_order')
            ->first();

        if ($firstImage) {
            $this->listingService->update($id, ['image_url' => $firstImage->image_url]);
        }

        // Return reordered images
        $images = ListingImage::where('listing_id', $id)
            ->orderBy('sort_order')
            ->get()
            ->map(fn($img) => [
                'id'         => $img->id,
                'url'        => $img->image_url,
                'sort_order' => $img->sort_order,
                'alt_text'   => $img->alt_text,
            ])->values()->toArray();

        return $this->respondWithData($images);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/listings/generate-description
    // -----------------------------------------------------------------

    /**
     * Generate a listing description using AI.
     *
     * Body: title (required), category (optional), type (optional), notes (optional).
     * Rate limited to 5 per minute per user.
     */
    public function generateDescription(): JsonResponse
    {
        if (! $this->listingConfigEnabled(ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.listing_ai_descriptions_disabled'), null, 403);
        }

        $userId = $this->requireAuth();
        $this->rateLimit('listing_ai_generate', 5, 60);

        $title = trim($this->input('title') ?? '');
        $category = trim($this->input('category') ?? '');
        $type = $this->input('type', 'offer');
        $notes = trim($this->input('notes') ?? '');

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 422);
        }

        $typeLabel = $type === 'request'
            ? 'Service being requested'
            : 'Service being offered';

        $prompt = "You are helping a member of a community timebank write a listing description. "
            . "Timebanks are where community members exchange services for time credits (1 hour = 1 credit). "
            . "Write a friendly, clear description for this listing:\n\n"
            . "Type: {$typeLabel}\n"
            . "Title: {$title}\n"
            . ($category !== '' ? "Category: {$category}\n" : '')
            . ($notes !== '' ? "Additional context from the member: {$notes}\n" : '')
            . "\nWrite 2-3 short paragraphs. Be warm and community-focused. "
            . "Mention what the person will get from this exchange. Keep it under 200 words. "
            . "Do not use markdown formatting. Do not include a title heading — just the description body.";

        $result = $this->aiService->chat(0, $prompt, [
            'system_prompt' => 'You are a friendly community writing assistant for a timebanking platform. Write clear, inclusive, and welcoming listing descriptions.',
            'max_tokens' => 512,
            'model' => 'gpt-4o-mini',
        ]);

        if (!empty($result['error'])) {
            \Log::error('Listing AI description generation failed', ['error' => $result]);
            return $this->respondWithError('AI_SERVICE_ERROR', __('api.listing_ai_generate_failed'), null, 503);
        }

        return $this->respondWithData(['description' => $result['reply']]);
    }
}
