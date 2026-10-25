<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\SafeguardingApprovedContactService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Coordinators approve which members may contact a member whose safeguarding
 * choice routes contact through a coordinator (e.g. a self-identified
 * vulnerable adult), and withdraw approvals. Broker-or-admin, own community
 * only; both members must belong to it.
 */
class AdminSafeguardingApprovedContactsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SafeguardingApprovedContactService $contacts,
    ) {}

    /** GET /v2/admin/safeguarding/members/{userId}/approved-contacts */
    public function index(int $userId): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        if (! $this->isMember($tenantId, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        return $this->respondWithData($this->contacts->listActive($tenantId, $userId));
    }

    /** POST /v2/admin/safeguarding/members/{userId}/approved-contacts */
    public function store(int $userId): JsonResponse
    {
        $actorUserId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $contactUserId = (int) $this->input('contact_user_id', 0);

        if (! $this->isMember($tenantId, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if ($contactUserId <= 0 || $contactUserId === $userId || ! $this->isMember($tenantId, $contactUserId)) {
            return $this->respondWithError('VALIDATION_ERROR', __('safeguarding.approved_contacts.invalid_contact'), 'contact_user_id', 422);
        }

        $result = $this->contacts->approve($tenantId, $userId, $contactUserId, $actorUserId);

        return $this->respondWithData(['id' => $result['id']], null, $result['created'] ? 201 : 200);
    }

    /** DELETE /v2/admin/safeguarding/members/{userId}/approved-contacts/{approvalId} */
    public function destroy(int $userId, int $approvalId): JsonResponse
    {
        $actorUserId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        if (! $this->contacts->revoke($tenantId, $userId, $approvalId, $actorUserId)) {
            return $this->respondWithError('NOT_FOUND', __('safeguarding.approved_contacts.not_found'), null, 404);
        }

        return $this->respondWithData(['revoked' => true]);
    }

    private function isMember(int $tenantId, int $userId): bool
    {
        return DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereNotIn('status', ['deleted', 'deactivated'])
            ->exists();
    }
}
