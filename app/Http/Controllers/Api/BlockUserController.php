<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\BlockUserService;
use App\Services\FederationPartnershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * BlockUserController — block/unblock users and list blocked users.
 *
 * Endpoints:
 *   POST   /api/v2/users/{id}/block    — block a user
 *   DELETE /api/v2/users/{id}/block    — unblock a user
 *   GET    /api/v2/users/blocked       — list blocked users
 */
class BlockUserController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * POST /api/v2/users/{id}/block
     *
     * Block a user. Optionally provide a reason.
     * Body: { "reason"?: string }
     */
    public function block(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('block_user', 20, 60);

        if ($userId === $id) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.block_user.cannot_block_self'), null, 400);
        }

        // The target must be in this community, or (F-284, owner decision
        // 29 Sep 2026) a member internal federation can actually put in front
        // of this member: an ACTIVE partnership and a target who has opted in
        // (F-381 — any partnership row in any status used to be enough, which
        // let the block list name members who never joined federation).
        // Anyone else answers the same 404 as a missing id, so the endpoint is
        // not a "does this id exist" oracle.
        $tenantId = (int) TenantContext::getId();
        $targetTenantId = DB::table('users')->where('id', $id)->value('tenant_id');
        $targetIsReachable = $targetTenantId !== null && (
            (int) $targetTenantId === $tenantId
            || BlockUserService::isReachableAcrossCommunities($tenantId, $id)
        );
        if (!$targetIsReachable) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $reason = $this->input('reason');

        try {
            BlockUserService::block($userId, $id, $reason);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 400);
        }

        return $this->respondWithData([
            'success' => true,
            'message' => __('api_controllers_1.block_user.user_blocked'),
            'blocked_user_id' => $id,
        ]);
    }

    /**
     * DELETE /api/v2/users/{id}/block
     *
     * Unblock a user.
     */
    public function unblock(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('unblock_user', 20, 60);

        $success = BlockUserService::unblock($userId, $id);

        if (!$success) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_1.block_user.user_not_blocked'), null, 404);
        }

        return $this->respondWithData([
            'success' => true,
            'message' => __('api_controllers_1.block_user.user_unblocked'),
            'unblocked_user_id' => $id,
        ]);
    }

    /**
     * GET /api/v2/users/blocked
     *
     * List all users blocked by the current user.
     */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('blocked_list', 30, 60);

        $blockedUsers = BlockUserService::getBlockedUsers($userId);

        return $this->respondWithData($blockedUsers->all());
    }

    /**
     * GET /api/v2/users/{id}/block-status
     *
     * Check if a specific user is blocked.
     */
    public function status(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        return $this->respondWithData([
            'is_blocked' => BlockUserService::isBlocked($userId, $id),
            // F-388: deprecated and always false. It told a blocked member
            // exactly who had blocked them, while every interaction path
            // refuses a blocked pair direction-neutrally so that cannot be
            // learned. Kept in the shape only because existing clients read it.
            'is_blocked_by' => false,
        ]);
    }
}
