<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Services\CrossModuleMatchingService;
use App\Services\GroupMatchingService;
use App\Services\Matching\CandidateRetriever;
use App\Services\MatchLearningService;

/**
 * MatchingController — Eloquent-powered smart matching engine endpoints.
 *
 * Fully migrated from legacy delegation. Uses DI-based App services
 * (CrossModuleMatchingService, MatchLearningService) which handle their
 * own tenant scoping via TenantContext.
 */
class MatchingController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CrossModuleMatchingService $crossModuleMatchingService,
        private readonly MatchLearningService $matchLearningService,
        private readonly GroupMatchingService $groupMatchingService,
    ) {}

    /**
     * GET /api/v2/matches/all
     *
     * Get all matches for the authenticated user across listings, jobs,
     * volunteering, and groups.
     *
     * Query Parameters:
     * - limit: int (default 20, max 100)
     * - min_score: int 0-100 (default: the member's saved minimum, else the community's)
     * - modules: string (comma-separated: 'listings,groups,volunteering,events')
     * - user_id: int (platform team only — view another member's matches)
     * - debug: 'true' (platform team only — include the scoring breakdown)
     *
     * 🔴 F-625: `user_id` and `debug` exist for the Match debug page, which is
     * the platform team's. Until E-128 they were open to any caller whose role
     * STRING was an admin one, and the requested member was never checked
     * against the caller's community, so an admin could run the matching
     * engine for a member of a different community. Pinned by
     * tests/Laravel/Feature/Security/MatchDebugUserOverrideTest.php.
     */
    public function allMatches(): JsonResponse
    {
        $userId = $this->requireAuth();
        $debug = false;

        $requestedUserId = $this->queryInt('user_id');
        if ($requestedUserId && $requestedUserId !== $userId) {
            // Another member's matches: refuse outright rather than quietly
            // answering with the caller's own, which read as "it worked".
            $this->requireGodPlatformAdmin();

            $inThisCommunity = DB::table('users')
                ->where('id', $requestedUserId)
                ->where('tenant_id', $this->getTenantId())
                ->where('status', 'active')
                ->exists();
            if (!$inThisCommunity) {
                return $this->respondWithError('NOT_FOUND', __('api.member_not_found'), 'user_id', 404);
            }

            $userId = $requestedUserId;
            $debug = $this->query('debug') === 'true';
        } elseif ($this->query('debug') === 'true') {
            // Asking for the breakdown of your own matches is ignored, not
            // refused, for everyone but the platform team.
            $debug = \App\Support\Authorization\PlatformTeam::includes($userId);
        }

        $options = [
            'limit' => min(100, max(1, $this->queryInt('limit', 20))),
            'debug' => $debug,
        ];

        // Only when the caller names one. Absent, the member's saved minimum
        // (else the community's) applies: a fixed 30 here overrode both.
        $requestedMinScore = $this->query('min_score');
        if ($requestedMinScore !== null && $requestedMinScore !== '' && is_numeric($requestedMinScore)) {
            $options['min_score'] = max(0, min(100, (int) $requestedMinScore));
        }

        $modulesParam = $this->query('modules');
        if ($modulesParam) {
            // The four sources the service really has. This list named
            // 'jobs' (which has no matcher) and left out 'events'.
            $allowed = ['listings', 'groups', 'volunteering', 'events'];
            $requested = array_map('trim', explode(',', $modulesParam));
            $options['modules'] = array_values(array_intersect($requested, $allowed));
        }

        $matches = $this->crossModuleMatchingService->getAllMatches($userId, $options);

        return $this->respondWithData($matches);
    }

    /** Dismiss reasons accepted by both dismiss endpoints (feed the learning loop). */
    private const DISMISS_REASONS = [
        'not_relevant', 'too_far', 'already_done', 'not_my_skills', 'not_interested', 'other',
    ];

    /**
     * POST /api/v2/matches/{id}/dismiss
     *
     * Dismiss a listing match — records a negative signal so the listing
     * is ranked lower in future match results for this user.
     *
     * Route parameter:
     * - id: int (listing_id)
     *
     * Request body (JSON, all optional):
     * - reason: string ('not_relevant' | 'too_far' | 'already_done' |
     *   'not_my_skills' | 'not_interested' | 'other')
     */
    public function dismiss(int $listingId): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $this->rateLimit('match_dismiss', 200, 60);

        if ($listingId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_id', ['resource' => 'listing']), 'id', 400);
        }

        $this->dismissListing($userId, $tenantId, $listingId, $this->normaliseReason($this->input('reason')));

        return $this->respondWithData(['dismissed' => true, 'listing_id' => $listingId]);
    }

    /**
     * POST /api/v2/matches/{sourceType}/{sourceId}/dismiss
     *
     * Typed dismissal for cross-module matches. Currently supported:
     * - listing: same behaviour as the legacy /matches/{id}/dismiss
     * - group: marks the group_match_cache row dismissed (suppressed on
     *   read and on re-warm)
     */
    public function dismissTyped(string $sourceType, int $sourceId): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $this->rateLimit('match_dismiss', 200, 60);

        if ($sourceId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_id', ['resource' => $sourceType]), 'sourceId', 400);
        }

        $reason = $this->normaliseReason($this->input('reason'));

        switch ($sourceType) {
            case 'listing':
                $this->dismissListing($userId, $tenantId, $sourceId, $reason);
                break;

            case 'group':
                if (!$this->groupMatchingService->dismiss($userId, $sourceId)) {
                    return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Group']), 'sourceId', 404);
                }
                break;

            default:
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_id', ['resource' => 'source type']), 'sourceType', 400);
        }

        return $this->respondWithData(['dismissed' => true, 'source_type' => $sourceType, 'source_id' => $sourceId]);
    }

    private function normaliseReason(mixed $reason): string
    {
        return in_array($reason, self::DISMISS_REASONS, true) ? $reason : 'other';
    }

    private function dismissListing(int $userId, int $tenantId, int $listingId, string $reason): void
    {
        try {
            // Upsert — ignore duplicate (user may re-dismiss)
            DB::statement(
                "INSERT IGNORE INTO match_dismissals (tenant_id, user_id, listing_id, reason) VALUES (?, ?, ?, ?)",
                [$tenantId, $userId, $listingId, $reason]
            );
        } catch (\Throwable $e) {
            // Table may not exist yet — degrade gracefully
            \Log::warning('MatchingController::dismiss DB error — ' . $e->getMessage());
        }

        // The cached copy of this match is what the admin figures count, so
        // it is marked too (nothing ever wrote a status other than 'new').
        DB::update(
            "UPDATE match_cache SET status = 'dismissed' WHERE tenant_id = ? AND user_id = ? AND listing_id = ?",
            [$tenantId, $userId, $listingId]
        );

        // A negative signal for the learning loop, unless the reason says
        // nothing about the listing itself. "Too far" and "already done"
        // used to count against the member who posted it and against the
        // whole category, exactly like "not relevant".
        if (!in_array($reason, CandidateRetriever::NEUTRAL_DISMISSAL_REASONS, true)) {
            $this->matchLearningService->recordInteraction($userId, $listingId, 'dismissed', []);
        }
    }
}
