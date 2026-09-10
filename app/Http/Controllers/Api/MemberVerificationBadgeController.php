<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Services\MemberVerificationBadgeService;

/**
 * MemberVerificationBadgeController -- Member verification badges.
 *
 * Native implementation using legacy MemberVerificationBadgeService static methods.
 *
 * Endpoints:
 *   GET    /api/v2/users/{id}/verification-badges   getUserBadges()
 *   POST   /api/v2/admin/users/{id}/badges          grantBadge()
 *   DELETE /api/v2/admin/users/{id}/badges/{type}    revokeBadge()
 *   GET    /api/v2/admin/users/{id}/badges           getAdminBadgeList()
 */
class MemberVerificationBadgeController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MemberVerificationBadgeService $memberVerificationBadgeService,
    ) {}

    /**
     * GET /api/v2/users/{id}/verification-badges
     *
     * Get a user's verification badges. Public endpoint (rate-limited).
     */
    public function getUserBadges(int $id): JsonResponse
    {
        $this->rateLimit('verification_badges', 30, 60);

        // Verify the target user belongs to the current tenant
        $tenantId = $this->getTenantId();
        $userExists = DB::table('users')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (!$userExists) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $badges = $this->memberVerificationBadgeService->getUserBadges($id);

        return $this->respondWithData($badges);
    }

    /**
     * POST /api/v2/admin/users/{id}/badges
     *
     * Grant a verification badge (admin only).
     *
     * Body:
     * {
     *   "badge_type": "id_verified",
     *   "note": "Government ID verified in person",
     *   "expires_at": "2027-03-01 00:00:00"  // optional
     * }
     */
    public function grantBadge(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $this->rateLimit('admin_badge_grant', 20, 60);

        $data = $this->getAllInput();
        $badgeType = $data['badge_type'] ?? '';
        $note = $data['note'] ?? null;
        $expiresAt = $data['expires_at'] ?? null;

        if (empty($badgeType)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'badge_type']), 'badge_type', 400);
        }

        $badgeId = $this->memberVerificationBadgeService->grantBadge($id, $badgeType, $adminId, $note, $expiresAt);

        if ($badgeId === null) {
            return $this->respondWithErrors($this->memberVerificationBadgeService->getErrors(), 422);
        }

        $badges = $this->memberVerificationBadgeService->getUserBadges($id);

        return $this->respondWithData($badges, null, 201);
    }

    /**
     * DELETE /api/v2/admin/users/{id}/badges/{type}
     *
     * Revoke a verification badge (admin only).
     */
    public function revokeBadge(int $id, string $type): JsonResponse
    {
        $adminId = $this->requireAdmin();

        $this->memberVerificationBadgeService->revokeBadge($id, $type, $adminId);

        $badges = $this->memberVerificationBadgeService->getUserBadges($id);

        return $this->respondWithData($badges);
    }

    /**
     * GET /api/v2/admin/users/{id}/badges
     *
     * Get all badges including revoked (admin view).
     */
    public function getAdminBadgeList(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('admin_badge_list', 30, 60);

        // A community admin asking about a member of ANOTHER community got the
        // empty badge list plus the platform-wide type vocabulary. Refuse the
        // id outright (CrossCommunityAccessSweepTest, 2026-09-10).
        if (! \App\Models\User::query()
            ->where('id', $id)
            ->where('tenant_id', $this->getTenantId())
            ->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $badges = $this->memberVerificationBadgeService->getAdminBadgeList($id);

        return $this->respondWithData([
            'badges' => $badges,
            'available_types' => MemberVerificationBadgeService::BADGE_TYPES,
            'labels' => MemberVerificationBadgeService::BADGE_LABELS,
        ]);
    }
}
