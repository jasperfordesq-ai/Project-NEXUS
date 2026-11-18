<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\MatchingService;

/**
 * MatchPreferencesController — Eloquent-powered match preference endpoints.
 *
 * Fully migrated from legacy delegation. Uses legacy static MatchingService
 * which handles its own tenant scoping via TenantContext.
 */
class MatchPreferencesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MatchingService $matchingService,
    ) {}

    /**
     * GET /api/v2/users/me/match-preferences
     *
     * Returns the authenticated user's match notification preferences.
     */
    public function show(): JsonResponse
    {
        $userId = $this->requireAuth();

        $preferences = $this->matchingService->getPreferences($userId);

        return $this->respondWithData($preferences);
    }

    /**
     * PUT /api/v2/users/me/match-preferences
     *
     * Update match preferences.
     *
     * Request body (JSON, all optional):
     * - notification_frequency: 'daily' | 'monthly' | 'fortnightly' | 'never'
     *   ('weekly' is accepted from old clients and stored as 'monthly')
     * - notify_hot_matches: bool
     * - notify_mutual_matches: bool
     * - matching_paused: bool
     * - max_distance_km: int (1..tenant max)
     * - min_match_score: int (0..100)
     * - categories: int[] (empty = all categories)
     * - availability: array (e.g. ["weekends", "weekday_evenings"])
     */
    public function update(): JsonResponse
    {
        $userId = $this->requireAuth();

        $current = $this->matchingService->getPreferences($userId);
        $updated = $current;

        // Only update fields that were provided
        $notificationFrequency = $this->input('notification_frequency');
        if ($notificationFrequency !== null) {
            $allowed = ['daily', 'weekly', 'monthly', 'fortnightly', 'never'];
            if (!in_array($notificationFrequency, $allowed, true)) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api_controllers_2.users.invalid_frequency'),
                    'notification_frequency'
                );
            }
            if ($notificationFrequency === 'weekly') {
                $notificationFrequency = 'monthly';
            }
            $updated['notification_frequency'] = $notificationFrequency;
        }

        $notifyHot = $this->input('notify_hot_matches');
        if ($notifyHot !== null) {
            $updated['notify_hot_matches'] = (bool) $notifyHot;
        }

        $notifyMutual = $this->input('notify_mutual_matches');
        if ($notifyMutual !== null) {
            $updated['notify_mutual_matches'] = (bool) $notifyMutual;
        }

        $paused = $this->input('matching_paused');
        if ($paused !== null) {
            $updated['matching_paused'] = (bool) $paused;
        }

        // Distance preference can tighten but never exceed the community's
        // ceiling, which getPreferences() reports as max_distance_limit_km.
        $maxDistance = $this->input('max_distance_km');
        if ($maxDistance !== null) {
            $tenantMax = max(1, (int) ($current['max_distance_limit_km'] ?? 50));
            $updated['max_distance_km'] = max(1, min($tenantMax, (int) $maxDistance));
        }

        $minScore = $this->input('min_match_score');
        if ($minScore !== null) {
            $updated['min_match_score'] = max(0, min(100, (int) $minScore));
        }

        $categories = $this->input('categories');
        if ($categories !== null && is_array($categories)) {
            $updated['categories'] = array_values(array_filter(array_map('intval', $categories)));
        }

        $availability = $this->input('availability');
        if ($availability !== null && is_array($availability)) {
            $updated['availability'] = array_values(array_filter(array_map(
                fn ($slot) => is_string($slot) ? mb_substr(trim($slot), 0, 50) : null
            , $availability)));
        }

        $success = $this->matchingService->savePreferences($userId, $updated);

        if (!$success) {
            return $this->respondWithError('SERVER_ERROR', __('api.failed_save_match_preferences'));
        }

        return $this->respondWithData($this->matchingService->getPreferences($userId));
    }
}
