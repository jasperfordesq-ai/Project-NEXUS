<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\CaringCommunity\EmergencyAlertService;
use App\Support\Authorization\AdminTier;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * AG70 — Emergency/Safety Alert Tier controller.
 *
 * Endpoints:
 *   GET    /v2/caring-community/emergency-alerts          → activeAlerts()   (members, polled by banner)
 *   POST   /v2/caring-community/emergency-alerts/{id}/dismiss → dismiss()   (members)
 *   GET    /v2/admin/caring-community/emergency-alerts    → adminList()      (admin)
 *   POST   /v2/admin/caring-community/emergency-alerts    → store()          (admin + municipality_announcer)
 *   DELETE /v2/admin/caring-community/emergency-alerts/{id} → deactivate()  (admin + municipality_announcer)
 */
class EmergencyAlertController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EmergencyAlertService $service,
    ) {
    }

    // -------------------------------------------------------------------------
    // Member-facing
    // -------------------------------------------------------------------------

    /**
     * Return all currently active alerts for the tenant.
     * Polled every 5 minutes by the EmergencyAlertBanner component.
     */
    public function activeAlerts(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        try {
            $alerts = EmergencyAlertService::getActiveAlerts($tenantId, $userId);
            return $this->respondWithData($alerts);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_DISABLED', $e->getMessage(), null, 503);
        }
    }

    /**
     * Record a banner dismissal for analytics (does NOT deactivate the alert).
     */
    public function dismiss(int $id): JsonResponse
    {
        $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        EmergencyAlertService::recordDismissal($id, $tenantId);

        return $this->respondWithData(['ok' => true]);
    }

    // -------------------------------------------------------------------------
    // Admin-facing
    // -------------------------------------------------------------------------

    /**
     * List all alerts (any status) for the admin management page.
     */
    public function adminList(): JsonResponse
    {
        $this->requireAuth();
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        try {
            $alerts = EmergencyAlertService::getAllAlerts($tenantId);
            return $this->respondWithData($alerts);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_DISABLED', $e->getMessage(), null, 503);
        }
    }

    /**
     * Create and immediately broadcast a new emergency alert.
     * Requires admin role OR municipality_announcer role.
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        // Authorisation: admin OR municipality_announcer
        if (!$this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        $input = request()->all();

        $validator = Validator::make($input, [
            'title'      => 'required|string|max:255',
            'body'       => 'required|string|max:2000',
            'severity'   => 'nullable|in:info,warning,danger',
            'expires_at' => 'nullable|date',
            'target_user_ids' => 'nullable|array',
            'target_user_ids.*' => 'integer|min:1',
        ]);

        if ($validator->fails()) {
            // F-372: an array was passed as the ?string $field, which is a TypeError
            // under strict_types and answered invalid input with HTTP 500.
            return $this->respondWithValidationErrors($validator);
        }

        try {
            $alert = EmergencyAlertService::createAndBroadcast($tenantId, $input, $userId);
            return $this->respondWithData($alert, null, 201);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 503);
        }
    }

    /**
     * Deactivate (soft-delete) an alert so it no longer shows on the banner.
     * Requires admin role OR municipality_announcer role.
     */
    public function deactivate(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        if (!$this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        try {
            // F-482: the service's result was discarded, so an alert belonging
            // to another community was reported deactivated. Zero rows is not a
            // deactivation.
            if (! EmergencyAlertService::deactivate($id, $tenantId)) {
                return $this->respondNotFound();
            }
            return $this->respondWithData(['ok' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 503);
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Returns true if the user is an admin OR has the municipality_announcer role
     * for the current tenant.
     */
    private function hasAnnouncerAccess(int $userId, int $tenantId): bool
    {
        // F-466: admin authority is the four boolean flags as well as the role
        // string — a network administrator is granted the flag alone — so
        // AdminTier is the only safe predicate. These routes sit inside the
        // EnsureIsAdmin group, which already uses AdminTier, so without this the
        // account passed the gate at the door and was refused here. AdminTier
        // still fails closed for broker and coordinator.
        $account = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($account !== null && AdminTier::allows((array) $account)) {
            return true;
        }

        return (bool) DB::table('user_roles')
            ->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $userId)
            ->where('user_roles.tenant_id', $tenantId)
            ->whereIn('roles.name', ['admin', 'municipality_announcer'])
            ->exists();
    }
}
