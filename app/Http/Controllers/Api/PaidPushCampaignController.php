<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\PaidPushCampaignService;
use App\Support\SecurityBounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * PaidPushCampaignController — AG57 Paid Push Campaign Management.
 *
 * Member/advertiser routes: /v2/me/push-campaigns/*
 * Admin routes:             /v2/admin/push-campaigns/*
 *
 * Feature gate: 'paid_push_campaigns' (or admin bypass).
 */
class PaidPushCampaignController extends BaseApiController
{
    protected bool $isV2Api = true;

    // =========================================================================
    // Member / advertiser endpoints
    // =========================================================================

    /**
     * GET /v2/me/push-campaigns
     * Returns all campaigns created by the authenticated user.
     */
    public function myCampaigns(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->featureAvailable()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $campaigns = PaidPushCampaignService::listCampaigns($tenantId);

        // Scope to own campaigns for non-admin users
        $campaigns = array_filter($campaigns, fn ($c) => (int) $c['created_by'] === $userId);

        return $this->respondWithData(array_values($campaigns));
    }

    /**
     * POST /v2/me/push-campaigns
     * Create a new campaign in draft status.
     *
     * Required: name, title (max 100), body (max 400)
     * Optional: advertiser_type, cta_url, audience_filter, scheduled_at, cost_per_send
     */
    public function createCampaign(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->featureAvailable()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $data = $this->getAllInput();

        // Validate required fields
        $errors = [];

        if (empty($data['name'])) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_campaign_name_required'), 'field' => 'name'];
        }

        if (empty($data['title'])) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_title_required'), 'field' => 'title'];
        } elseif (strlen($data['title']) > 100) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_title_max'), 'field' => 'title'];
        }

        if (empty($data['body'])) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_body_required'), 'field' => 'body'];
        } elseif (strlen($data['body']) > 400) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_body_max'), 'field' => 'body'];
        }

        $validAdvertiserTypes = ['sme', 'verein', 'gemeinde', 'private'];
        if (isset($data['advertiser_type']) && ! in_array($data['advertiser_type'], $validAdvertiserTypes, true)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_invalid_advertiser_type'), 'field' => 'advertiser_type'];
        }

        if (! empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }

        try {
            $campaign = PaidPushCampaignService::createCampaign($tenantId, $userId, $data);
            return $this->respondWithData($campaign, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] createCampaign error', ['error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    /**
     * POST /v2/me/push-campaigns/estimate-audience
     * Returns estimated recipient count for a given audience filter.
     *
     * Body: { audience_filter: {...} }
     */
    public function estimateAudience(): JsonResponse
    {
        $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->featureAvailable()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $data           = $this->getAllInput();
        $audienceFilter = isset($data['audience_filter']) && is_array($data['audience_filter'])
            ? $data['audience_filter']
            : [];

        try {
            $count = PaidPushCampaignService::estimateAudience($tenantId, $audienceFilter);
            return $this->respondWithData([
                'estimated_count' => SecurityBounds::bucketAudienceCount($count),
                'minimum_reached' => $count >= SecurityBounds::MIN_REPORTABLE_AUDIENCE_COUNT,
            ]);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] estimateAudience error', ['error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    /**
     * PUT /v2/me/push-campaigns/{id}
     * Update a draft or pending_review campaign owned by the authenticated user.
     */
    public function updateCampaign(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->featureAvailable()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $campaign = PaidPushCampaignService::getCampaignById($id, $tenantId);
        if ($campaign === null) {
            return $this->respondNotFound(__('api.paid_push_campaign_not_found'));
        }

        if ((int) $campaign['created_by'] !== $userId) {
            return $this->respondForbidden(__('api.paid_push_campaign_not_owned'));
        }

        $data   = $this->getAllInput();
        $errors = [];

        if (isset($data['title']) && strlen($data['title']) > 100) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_title_max'), 'field' => 'title'];
        }

        if (isset($data['body']) && strlen($data['body']) > 400) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.paid_push_body_max'), 'field' => 'body'];
        }

        if (! empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }

        try {
            $updated = PaidPushCampaignService::updateCampaign($id, $tenantId, $data);
            return $this->respondWithData($updated);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('CAMPAIGN_UPDATE_FAILED', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] updateCampaign error', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    /**
     * POST /v2/me/push-campaigns/{id}/submit
     * Submit a draft campaign for admin review.
     */
    public function submitForReview(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->featureAvailable()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $campaign = PaidPushCampaignService::getCampaignById($id, $tenantId);
        if ($campaign === null) {
            return $this->respondNotFound(__('api.paid_push_campaign_not_found'));
        }

        if ((int) $campaign['created_by'] !== $userId) {
            return $this->respondForbidden(__('api.paid_push_campaign_not_owned'));
        }

        if ($campaign['status'] !== 'draft') {
            return $this->respondWithError(
                'INVALID_STATUS',
                __('api.paid_push_submit_draft_only'),
                null,
                422
            );
        }

        // Require title and body before submission
        if (empty($campaign['title']) || empty($campaign['body'])) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.paid_push_submit_requires_title_body'),
                null,
                422
            );
        }

        try {
            PaidPushCampaignService::updateCampaign($id, $tenantId, ['status_override' => 'pending_review']);

            // Direct status update (updateCampaign guards writable fields, so we do this directly)
            \Illuminate\Support\Facades\DB::table('paid_push_campaigns')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status'     => 'pending_review',
                    'updated_at' => \Carbon\Carbon::now(),
                ]);

            $updated = PaidPushCampaignService::getCampaignById($id, $tenantId);
            return $this->respondWithData($updated);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] submitForReview error', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    /**
     * DELETE /v2/me/push-campaigns/{id}
     * Cancel (soft-delete) a draft or pending_review campaign.
     */
    public function cancelCampaign(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->featureAvailable()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $campaign = PaidPushCampaignService::getCampaignById($id, $tenantId);
        if ($campaign === null) {
            return $this->respondNotFound(__('api.paid_push_campaign_not_found'));
        }

        if ((int) $campaign['created_by'] !== $userId) {
            return $this->respondForbidden(__('api.paid_push_campaign_not_owned'));
        }

        if (! in_array($campaign['status'], ['draft', 'pending_review'], true)) {
            return $this->respondWithError(
                'INVALID_STATUS',
                __('api.paid_push_cancel_draft_or_pending_only'),
                null,
                422
            );
        }

        \Illuminate\Support\Facades\DB::table('paid_push_campaigns')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'     => 'cancelled',
                'updated_at' => \Carbon\Carbon::now(),
            ]);

        return $this->respondWithData(['cancelled' => true]);
    }

    /**
     * POST /v2/me/push-campaigns/{id}/open
     * Record an authenticated member's first tap of a delivered paid push.
     *
     * This endpoint deliberately remains available when the campaign feature is
     * later disabled: a notification that was already delivered must still open,
     * and the service only updates a send row belonging to this user and tenant.
     */
    public function recordOpen(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        PaidPushCampaignService::recordOpen($id, $userId, $tenantId);

        return $this->respondWithData(['recorded' => true]);
    }

    // =========================================================================
    // Admin endpoints
    // =========================================================================

    /**
     * GET /v2/admin/push-campaigns
     * List all campaigns for the tenant, optionally filtered by ?status=
     */
    public function adminListCampaigns(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (! PaidPushCampaignService::isAvailable()) {
            return $this->respondWithData([]);
        }

        $status    = $this->query('status');
        $campaigns = PaidPushCampaignService::listCampaigns($tenantId, $status ?: null);

        return $this->respondWithData($campaigns);
    }

    /**
     * GET /v2/admin/push-campaigns/stats
     * Overview stats for the admin dashboard.
     */
    public function adminOverviewStats(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (! PaidPushCampaignService::isAvailable()) {
            return $this->respondWithData([
                'total_campaigns'          => 0,
                'by_status'                => [],
                'sends_this_month'         => 0,
                'opens_this_month'         => 0,
                'revenue_cents_this_month' => 0,
            ]);
        }

        return $this->respondWithData(PaidPushCampaignService::getOverviewStats($tenantId));
    }

    /**
     * GET /v2/admin/push-campaigns/{id}
     * Full campaign detail including analytics.
     */
    public function adminGetCampaign(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $campaign = PaidPushCampaignService::getCampaignById($id, $tenantId);
        if ($campaign === null) {
            return $this->respondNotFound(__('api.paid_push_campaign_not_found'));
        }

        $analytics = PaidPushCampaignService::getCampaignAnalytics($id, $tenantId);

        return $this->respondWithData(array_merge($campaign, ['analytics' => $analytics]));
    }

    /**
     * POST /v2/admin/push-campaigns/{id}/approve
     * Approve a pending_review campaign.
     * Immediately dispatches if no scheduled_at or scheduled_at is in the past.
     */
    public function adminApproveCampaign(int $id): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        try {
            $campaign = PaidPushCampaignService::approveCampaign($id, $tenantId, $adminId);

            // If already set to 'sending', dispatch now
            if ($campaign['status'] === 'sending') {
                $dispatchResult = PaidPushCampaignService::dispatchCampaign($id, $tenantId);
                $campaign       = PaidPushCampaignService::getCampaignById($id, $tenantId) ?? $campaign;
                return $this->respondWithData(array_merge($campaign, ['dispatch_result' => $dispatchResult]));
            }

            return $this->respondWithData($campaign);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('APPROVAL_FAILED', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] adminApproveCampaign error', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    /**
     * POST /v2/admin/push-campaigns/{id}/reject
     * Reject a campaign with a mandatory reason.
     *
     * Body: { reason: string }
     */
    public function adminRejectCampaign(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $data   = $this->getAllInput();
        $reason = trim($data['reason'] ?? '');

        if ($reason === '') {
            return $this->respondWithError('VALIDATION_ERROR', 'Rejection reason is required.', 'reason', 422);
        }

        try {
            PaidPushCampaignService::rejectCampaign($id, $tenantId, $reason);
            return $this->respondWithData(['rejected' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('REJECTION_FAILED', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] adminRejectCampaign error', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    /**
     * POST /v2/admin/push-campaigns/{id}/dispatch
     * Manually trigger dispatch of a scheduled or approved campaign.
     */
    public function adminDispatchCampaign(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        try {
            $result = PaidPushCampaignService::dispatchCampaign($id, $tenantId);
            return $this->respondWithData($result);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DISPATCH_FAILED', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('[PaidPushCampaign] adminDispatchCampaign error', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondServerError(__('api.generic_error'));
        }
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    /**
     * Check that the feature is available — either the feature flag is enabled
     * for the tenant, or the caller is an admin.
     */
    private function featureAvailable(): bool
    {
        if (! PaidPushCampaignService::isAvailable()) {
            return false;
        }

        if (TenantContext::hasFeature('paid_push_campaigns')) {
            return true;
        }

        // Admins can always access even if the public feature flag is off
        try {
            $this->requireAdmin();
            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
