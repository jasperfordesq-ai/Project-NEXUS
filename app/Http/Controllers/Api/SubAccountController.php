<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
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

        $parents = $this->normalizeRelationships($this->subAccountService->getParentAccounts($userId));

        // Member-visible accountability: on rows where a supporter can view
        // this member's messages, say when they last looked (from the
        // immutable audit). Parents lists are tiny (≤ MAX_CHILDREN the other
        // way round, usually 0-2 rows), so per-row stats are fine here.
        $viewService = app(\App\Services\SupporterMessageViewService::class);
        foreach ($parents as &$parent) {
            if (($parent['message_access'] ?? 'none') === 'active') {
                $stats = $viewService->viewStatsForMember($userId, (int) $parent['relationship_id']);
                $parent['message_view_last_at'] = $stats['last_viewed_at'];
            }
        }
        unset($parent);

        return $this->respondWithData($parents);
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
        // 🔴 Filter against the ENFORCED keys, not DEFAULT_PERMISSIONS: the
        // latter still carries `can_view_messages` for historical-row parsing,
        // and filtering against it persisted the dead boolean verbatim on
        // create for years. Message access is consent-gated and tier-object
        // only — it can never be requested at creation time.
        $permissions = array_intersect_key(
            $permissions,
            array_flip(['can_view_activity', 'can_manage_listings', 'can_transact']),
        );

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

        // Boolean shorthand keys, plus the explicit `tiers` object from the
        // three-tier model. The service sanitises tier values; unknown keys of
        // either vocabulary are dropped here.
        $rawTiers = $permissions['tiers'] ?? ($data['tiers'] ?? null);
        $permissions = array_intersect_key($permissions, array_flip(array_keys(SubAccountService::DEFAULT_PERMISSIONS)));
        $tiers = SupportTiers::sanitizeTiers($rawTiers);
        if ($tiers !== []) {
            $permissions['tiers'] = $tiers;
        }

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

    /** PUT /api/v2/users/me/parent-accounts/{id}/permissions — supported member only. */
    public function updateMemberPermissions(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $data = $this->getAllInput();
        $tiers = SupportTiers::sanitizeTiers($data['tiers'] ?? ($data['permissions']['tiers'] ?? null));
        if ($tiers === []) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'tiers']), 'tiers', 400);
        }

        try {
            $success = $this->subAccountService->updatePermissionsByMember($userId, $id, $tiers);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (! $success) {
            return $this->respondWithErrors($this->subAccountService->getErrors(), 404);
        }

        return $this->respondWithData($this->normalizeRelationships($this->subAccountService->getParentAccounts($userId)));
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

    /**
     * POST /api/v2/users/me/parent-accounts/{id}/message-access/withdraw
     *
     * The SUPPORTED member withdraws a supporter's message access — any time,
     * effective immediately, no reason required. {id} is the relationship id
     * (this caller is the child_user_id side, so the sub-accounts/{childId}
     * convention does not fit).
     */
    public function withdrawMessageAccess($id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_msg_withdraw', 10, 60);

        $ok = $this->subAccountService->withdrawMessageAccess($userId, (int) $id);

        if (! $ok) {
            return $this->respondWithErrors($this->subAccountService->getErrors(), 404);
        }

        return $this->respondWithData(['message_access' => 'none']);
    }

    /**
     * GET /api/v2/users/me/sub-accounts/{childId}/wallet
     *
     * The supported member's balance, for a supporter who holds `can_transact`.
     * The prepare screen validates the amount against this the way the member's
     * own transfer dialog validates against theirs — without it the supporter
     * types blind and only learns the balance from a server refusal.
     */
    public function getChildWallet($childId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_wallet', 30, 60);

        $summary = $this->subAccountService->getChildWalletSummary($userId, (int) $childId);

        if ($summary === null) {
            $errors = $this->subAccountService->getErrors();
            $status = (($errors[0]['code'] ?? '') === 'FORBIDDEN') ? 403 : 404;
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($summary);
    }

    /**
     * POST /api/v2/users/me/sub-accounts/{childId}/listings/{listingId}/image
     *
     * Attach a photo to a listing a supporter just posted for someone.
     *
     * 🔴 Why this exists rather than reusing POST /v2/listings/{id}/image: that
     * route checks ListingService::canModify(), which admits the owner or an
     * admin and refuses a carer. Without this route the supporter could fill in
     * every field of the listing form except the photo, and the upload would
     * fail with a bare 403 after the listing had already been created.
     *
     * Authority is re-established here (active relationship + can_manage_listings
     * + the safeguarding contact policy, via the service) and the listing is
     * verified to belong to that supported member, so a valid relationship
     * cannot be used to attach an image to somebody else's listing.
     */
    public function uploadListingImageForChild($childId, $listingId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_listing_image', 10, 60);

        $imageUrl = $this->subAccountService->attachListingImageForChild(
            $userId,
            (int) $childId,
            (int) $listingId,
            request()->file('image'),
        );

        if ($imageUrl === null) {
            $errors = $this->subAccountService->getErrors();
            $code = $errors[0]['code'] ?? '';
            $status = match ($code) {
                'FORBIDDEN' => 403,
                'NOT_FOUND' => 404,
                'UPLOAD_FAILED' => 500,
                default => 422,
            };
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData(['image_url' => $imageUrl]);
    }

    /**
     * GET /api/v2/users/me/sub-accounts/{childId}/messages
     * GET /api/v2/users/me/sub-accounts/{childId}/messages/{partnerId}
     *
     * A supporter's READ-ONLY window onto the supported member's messages —
     * consent-gated (messages tier ≥ assist), safeguarding-rechecked per read,
     * federated threads excluded, nothing marked read, and every request
     * immutably audited with the ?purpose= the supporter must supply.
     */
    public function listChildMessages($childId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_msg_view', 30, 60);

        $service = app(\App\Services\SupporterMessageViewService::class);
        $result = $service->listConversations(
            $userId,
            (int) $childId,
            (string) request()->query('purpose', ''),
            array_filter([
                'archived' => request()->boolean('archived'),
                'cursor' => request()->query('cursor'),
                'limit' => request()->query('limit'),
            ], static fn ($value) => $value !== null),
        );

        if ($result === null) {
            return $this->respondWithErrors($service->getErrors(), $this->messageViewStatus($service));
        }

        return $this->respondWithData([
            'conversations' => $result['items'],
            'cursor' => $result['cursor'],
            'has_more' => $result['has_more'],
        ]);
    }

    public function showChildThread($childId, $partnerId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('sub_account_msg_view', 30, 60);

        $service = app(\App\Services\SupporterMessageViewService::class);
        $filters = array_filter([
            'cursor' => request()->query('cursor'),
            'direction' => request()->query('direction'),
            'limit' => request()->query('limit'),
        ], static fn ($v) => $v !== null);

        $result = $service->viewThread(
            $userId,
            (int) $childId,
            (int) $partnerId,
            (string) request()->query('purpose', ''),
            $filters,
        );

        if ($result === null) {
            return $this->respondWithErrors($service->getErrors(), $this->messageViewStatus($service));
        }

        return $this->respondWithData($result);
    }

    private function messageViewStatus(\App\Services\SupporterMessageViewService $service): int
    {
        return match ($service->getErrors()[0]['code'] ?? '') {
            'FORBIDDEN' => 403,
            'NOT_FOUND' => 404,
            default => 422,
        };
    }

    private function normalizeRelationships(array $relationships): array
    {
        // One query for every row's open message-access ask, not one per row.
        $pendingAskIds = \App\Services\SubAccountService::pendingMessageAskRelationshipIds(array_map(
            static fn ($r) => (int) ($r['relationship_id'] ?? 0),
            $relationships,
        ));

        foreach ($relationships as &$relationship) {
            if (is_string($relationship['permissions'] ?? null)) {
                $decoded = json_decode($relationship['permissions'], true);
                $relationship['permissions'] = is_array($decoded) ? $decoded : [];
            } elseif (!is_array($relationship['permissions'] ?? null)) {
                $relationship['permissions'] = [];
            }

            // The UI's three-state messages control: none | pending | active.
            // Derived server-side so both sides of the card agree with the
            // consent machinery rather than re-deriving it from raw tiers.
            $tiers = \App\Support\Safeguarding\SupportTiers::resolve($relationship['permissions']);
            $relationship['message_access'] = $tiers['messages'] !== \App\Support\Safeguarding\SupportTiers::NONE
                ? 'active'
                : (in_array((int) ($relationship['relationship_id'] ?? 0), $pendingAskIds, true) ? 'pending' : 'none');
            $relationship['message_access_granted_at'] = $relationship['message_access_granted_at'] ?? null;
        }
        unset($relationship);

        return $relationships;
    }
}
