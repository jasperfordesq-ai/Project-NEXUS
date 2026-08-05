<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use App\Services\SubAccountService;

/**
 * SubAccountController -- Parent/child sub-account management.
 *
 * Converted from legacy delegation to direct static service calls.
 */
class SubAccountController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SubAccountService $subAccountService,
    ) {}

    /** GET /api/v2/users/me/sub-accounts */
    public function getChildAccounts(): JsonResponse
    {
        $userId = $this->requireAuth();

        $children = $this->subAccountService->getChildAccounts($userId);

        return $this->respondWithData($this->normalizeRelationships($children));
    }

    /** GET /api/v2/users/me/parent-accounts */
    public function getParentAccounts(): JsonResponse
    {
        $userId = $this->requireAuth();

        $parents = $this->subAccountService->getParentAccounts($userId);

        return $this->respondWithData($this->normalizeRelationships($parents));
    }

    /** POST /api/v2/users/me/sub-accounts */
    public function requestRelationship(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_request', 5, 60);

        $data = $this->getAllInput();
        $childUserId = (int) ($data['child_user_id'] ?? 0);
        $email = is_string($data['email'] ?? null)
            ? trim((string) $data['email'])
            : (is_string($data['child_email'] ?? null) ? trim((string) $data['child_email']) : '');
        $relationshipType = is_string($data['relationship_type'] ?? null) ? $data['relationship_type'] : 'family';
        $permissions = is_array($data['permissions'] ?? null) ? $data['permissions'] : [];
        $permissions = array_intersect_key($permissions, array_flip(array_keys(SubAccountService::DEFAULT_PERMISSIONS)));

        if ($childUserId <= 0) {
            if ($email === '') {
                return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'email']), 'email', 400);
            }

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_email'), 'email', 400);
            }

            $childUserId = (int) (User::query()
                ->where('tenant_id', TenantContext::getId())
                ->where('email', $email)
                ->value('id') ?? 0);

            if ($childUserId <= 0) {
                return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), 'email', 404);
            }
        }

        try {
            $relationshipId = $this->subAccountService->requestRelationship($userId, $childUserId, $relationshipType, $permissions);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($relationshipId === null) {
            return $this->respondWithErrors($this->subAccountService->getErrors(), 422);
        }

        $children = $this->subAccountService->getChildAccounts($userId);

        return $this->respondWithData($this->normalizeRelationships($children), null, 201);
    }

    /** PUT /api/v2/users/me/sub-accounts/{id}/approve */
    public function approveRelationship(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $success = $this->subAccountService->approveRelationship($userId, $id);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            return $this->respondWithErrors($this->subAccountService->getErrors(), 422);
        }

        $parents = $this->subAccountService->getParentAccounts($userId);

        return $this->respondWithData($this->normalizeRelationships($parents));
    }

    /** PUT /api/v2/users/me/sub-accounts/{id}/permissions */
    public function updatePermissions($id): JsonResponse
    {
        $userId = $this->requireAuth();

        $data = $this->getAllInput();
        $permissions = $data['permissions'] ?? [];
        if (!is_array($permissions)) {
            $permissions = [];
        }

        if (empty($permissions)) {
            $allowedKeys = array_keys(SubAccountService::DEFAULT_PERMISSIONS);
            $permissions = array_intersect_key($data, array_flip($allowedKeys));
        }

        $permissions = array_intersect_key($permissions, array_flip(array_keys(SubAccountService::DEFAULT_PERMISSIONS)));

        if (empty($permissions)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'permissions']), 'permissions', 400);
        }

        try {
            $success = $this->subAccountService->updatePermissions($userId, (int) $id, $permissions);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            return $this->respondWithErrors($this->subAccountService->getErrors(), 422);
        }

        $children = $this->subAccountService->getChildAccounts($userId);

        return $this->respondWithData($this->normalizeRelationships($children));
    }

    /** DELETE /api/v2/users/me/sub-accounts/{id} */
    public function revokeRelationship(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $this->subAccountService->revokeRelationship($userId, $id);

        return $this->respondWithData(['message' => __('api_controllers_2.sub_account.relationship_revoked')]);
    }

    /** GET /api/v2/users/me/sub-accounts/{childId}/activity */
    public function getChildActivity($childId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_activity', 10, 60);

        $activity = $this->subAccountService->getChildActivitySummary($userId, (int) $childId);

        if ($activity === null) {
            $errors = $this->subAccountService->getErrors();
            $status = 403;
            if (!empty($errors) && ($errors[0]['code'] ?? '') === 'FORBIDDEN') {
                $status = 403;
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($activity);
    }

    /**
     * POST /api/v2/users/me/sub-accounts/{childId}/listings
     *
     * Post a listing on a dependent's behalf. Requires an active linked-account
     * relationship carrying `can_manage_listings`.
     *
     * This and the transfer endpoint below are the first places those permissions
     * are actually enforced — see SubAccountService::createListingForChild() for
     * why that matters. The listing belongs to the dependent; the carer is recorded
     * as the acting user.
     */
    public function createListingForChild($childId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_create_listing', 10, 60);

        $listingId = $this->subAccountService->createListingForChild(
            $userId,
            (int) $childId,
            $this->getAllInput(),
        );

        if ($listingId === null) {
            $errors = $this->subAccountService->getErrors();
            $status = (($errors[0]['code'] ?? '') === 'FORBIDDEN') ? 403 : 422;
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData(['id' => $listingId], null, 201);
    }

    /**
     * POST /api/v2/users/me/sub-accounts/{childId}/transfer
     *
     * Send credits from a dependent's balance on their behalf. Requires an active
     * linked-account relationship carrying `can_transact`.
     *
     * Rate limited harder than the listing route: this one spends someone else's
     * money.
     */
    public function transferForChild($childId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_transfer', 5, 60);

        $txn = $this->subAccountService->transferForChild(
            $userId,
            (int) $childId,
            $this->getAllInput(),
        );

        if ($txn === null) {
            $errors = $this->subAccountService->getErrors();
            $status = (($errors[0]['code'] ?? '') === 'FORBIDDEN') ? 403 : 422;
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($txn);
    }

    private function normalizeRelationships(array $relationships): array
    {
        foreach ($relationships as &$relationship) {
            if (is_string($relationship['permissions'] ?? null)) {
                $decoded = json_decode($relationship['permissions'], true);
                $relationship['permissions'] = is_array($decoded) ? $decoded : [];
            } elseif (!is_array($relationship['permissions'] ?? null)) {
                $relationship['permissions'] = [];
            }
        }
        unset($relationship);

        return $relationships;
    }
}
