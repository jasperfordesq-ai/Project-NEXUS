<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\VolunteerOrgMemberService;
use Illuminate\Http\JsonResponse;

/**
 * Manage the team of a volunteer organisation (gap D7, 7 Oct 2026).
 *
 * The same four actions are routed twice, once for the organisation's own
 * dashboard and once under /v2/admin for the admin panel; who may do what is
 * decided by VolunteerOrgMemberService::access() in both cases.
 *
 *   GET    …/organisations/{id}/members              the team (owners and org admins can see it)
 *   POST   …/organisations/{id}/members              { user_id, role }   (owners, community admins)
 *   PUT    …/organisations/{id}/members/{userId}     { role }
 *   DELETE …/organisations/{id}/members/{userId}
 */
class VolunteerOrgMemberController extends BaseApiController
{
    public function __construct(private readonly VolunteerOrgMemberService $members)
    {
    }

    public function index(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $tenantId = $this->getTenantId();
        $access = $this->members->access($tenantId, $id, $userId);
        if ($denied = $this->denied($access, false)) {
            return $denied;
        }

        return $this->respondWithData([
            'items' => $this->members->list($tenantId, $id),
            'can_manage' => $access['can_manage'],
        ]);
    }

    public function store(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $this->rateLimit('vol_org_member_change', 60, 60);
        $tenantId = $this->getTenantId();
        if ($denied = $this->denied($this->members->access($tenantId, $id, $userId), true)) {
            return $denied;
        }

        $memberId = (int) $this->input('user_id', 0);
        if ($memberId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'user_id']), 'user_id', 422);
        }

        return $this->respond(
            $this->members->add($tenantId, $id, $userId, $memberId, (string) $this->input('role', 'member')),
            201
        );
    }

    public function update(int $id, int $memberId): JsonResponse
    {
        $userId = $this->requireAuth();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $this->rateLimit('vol_org_member_change', 60, 60);
        $tenantId = $this->getTenantId();
        if ($denied = $this->denied($this->members->access($tenantId, $id, $userId), true)) {
            return $denied;
        }

        return $this->respond(
            $this->members->changeRole($tenantId, $id, $userId, $memberId, (string) $this->input('role', '')),
            200
        );
    }

    public function destroy(int $id, int $memberId): JsonResponse
    {
        $userId = $this->requireAuth();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $this->rateLimit('vol_org_member_change', 60, 60);
        $tenantId = $this->getTenantId();
        if ($denied = $this->denied($this->members->access($tenantId, $id, $userId), true)) {
            return $denied;
        }

        return $this->respond($this->members->remove($tenantId, $id, $userId, $memberId), 200);
    }

    private function featureOff(): ?JsonResponse
    {
        return TenantContext::hasFeature('volunteering')
            ? null
            : $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
    }

    /**
     * @param array{exists: bool, can_view: bool, can_manage: bool} $access
     */
    private function denied(array $access, bool $toManage): ?JsonResponse
    {
        if (!$access['exists']) {
            return $this->respondWithError('NOT_FOUND', __('api.organization_not_found'), null, 404);
        }
        if (!($toManage ? $access['can_manage'] : $access['can_view'])) {
            return $this->respondWithError('FORBIDDEN', __('api.vol_org_members_forbidden'), null, 403);
        }

        return null;
    }

    /**
     * @param array{ok: bool, code?: string} $result
     */
    private function respond(array $result, int $successStatus): JsonResponse
    {
        if ($result['ok']) {
            return $this->respondWithData(['ok' => true], null, $successStatus);
        }

        $code = $result['code'] ?? 'ERROR';
        [$status, $key, $field] = match ($code) {
            'INVALID_ROLE' => [422, 'api.vol_org_member_invalid_role', 'role'],
            'USER_NOT_FOUND' => [422, 'api.vol_org_member_user_not_found', 'user_id'],
            'ALREADY_MEMBER' => [409, 'api.vol_org_member_already', 'user_id'],
            'NOT_MEMBER' => [404, 'api.vol_org_member_not_found', null],
            'SELF' => [422, 'api.vol_org_member_self', null],
            'CREATOR' => [422, 'api.vol_org_member_creator', null],
            'LAST_OWNER' => [422, 'api.vol_org_member_last_owner', null],
            default => [500, 'api.server_error', null],
        };

        return $this->respondWithError($code, __($key), $field, $status);
    }
}
