<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\PartnerVenueService;
use App\Services\PartnerVenueVisitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PartnerVenueController — member-facing venue directory, membership pass, and
 * the staff-side endpoint that records a scanned visit.
 *
 * Engagement recording only: no discount is issued or applied here.
 */
class PartnerVenueController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly PartnerVenueService $venueService,
        private readonly PartnerVenueVisitService $visitService,
    ) {}

    private function ensureFeature(): void
    {
        if (! TenantContext::hasFeature('partner_venues')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.partner_venues_feature_disabled'), null, 403)
            );
        }
    }

    /** Member-facing directory of active partner venues. */
    public function index(): JsonResponse
    {
        $this->ensureFeature();
        $this->getUserId();
        $this->rateLimit('partner_venues_index', 60, 60);

        return $this->respondWithData(['venues' => $this->venueService->directory()]);
    }

    /** The caller's membership pass (created on first request). */
    public function pass(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('partner_venues_pass', 60, 60);

        return $this->respondWithData($this->visitService->getOrCreatePass($userId));
    }

    /** Rotate the caller's pass, invalidating the previous QR. */
    public function rotatePass(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('partner_venues_pass_rotate', 10, 300);

        return $this->respondWithData($this->visitService->rotatePass($userId));
    }

    /** The caller's own recorded visits. */
    public function myVisits(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('partner_venues_my_visits', 60, 60);

        return $this->respondWithData(['visits' => $this->visitService->myVisits($userId)]);
    }

    /**
     * Record a visit from a scanned member pass.
     *
     * Deliberately POST-only with no GET preview: member details are revealed
     * only after an authorised staff account has confirmed the scan.
     */
    public function recordVisit(Request $request, string $token): JsonResponse
    {
        $this->ensureFeature();
        $staffUserId = $this->getUserId();
        $this->rateLimit('partner_venues_record_visit', 30, 60);

        $venueId = $request->input('venue_id');
        $venueId = is_numeric($venueId) ? (int) $venueId : null;

        $result = $this->visitService->recordVisit($token, $staffUserId, $venueId);

        return match ($result['status']) {
            'invalid_pass' => $this->respondWithError('NOT_FOUND', __('api.partner_venue_pass_invalid'), null, 404),
            'forbidden' => $this->respondWithError('FORBIDDEN', __('api.partner_venue_record_forbidden'), null, 403),
            default => $this->respondWithData($result),
        };
    }
}
