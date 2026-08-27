<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Models\SupportPendingAction;
use App\Services\SupportPendingActionService;
use Illuminate\Http\JsonResponse;
use App\Support\UserDisplayName;

/**
 * SupportActionController — the co_decide confirm loop (guardian redesign,
 * phase 3).
 *
 * A supporter holding the co-decide tier PREPARES a listing or a transfer;
 * the supported member answers — in-app here, or through the public
 * single-use token endpoints (read-only GET, confirming POST, exactly the
 * event-guardian-consent split so a mail scanner cannot confirm anything).
 */
class SupportActionController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SupportPendingActionService $service,
    ) {}

    /** POST /api/v2/users/me/support-actions — supporter prepares an action. */
    public function prepare(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('support_action_prepare', 10, 60);

        $data = $this->getAllInput();
        $supportedUserId = (int) ($data['supported_user_id'] ?? 0);
        $actionType = is_string($data['action_type'] ?? null) ? $data['action_type'] : '';
        $payload = is_array($data['payload'] ?? null) ? $data['payload'] : [];

        if ($supportedUserId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'supported_user_id']), 'supported_user_id', 400);
        }
        if (! array_key_exists($actionType, SupportPendingAction::TYPE_CAPABILITIES)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.support_action_unknown_type'), 'action_type', 400);
        }
        if ($payload === []) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'payload']), 'payload', 400);
        }

        try {
            $result = $this->service->prepare($userId, $supportedUserId, $actionType, $payload);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($result === null) {
            return $this->respondWithErrors($this->service->getErrors(), 403);
        }

        // The raw token is deliberately NOT returned to the supporter — it is
        // the supported member's credential and travels only in their email.
        return $this->respondWithData([
            'id' => $result['id'],
            'status' => SupportPendingAction::STATUS_PENDING,
        ]);
    }

    /** GET /api/v2/users/me/support-actions?role=supported|supporter */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();

        $role = $this->query('role', 'supported');

        if ($role === 'supporter') {
            return $this->respondWithData([
                'actions' => $this->service->listForSupporter($userId),
            ]);
        }

        return $this->respondWithData([
            'actions' => $this->service->listForSupported($userId),
            'pending_count' => $this->service->pendingCountForSupported($userId),
        ]);
    }

    /** POST /api/v2/users/me/support-actions/{id}/confirm — supported member. */
    public function confirm(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('support_action_answer', 10, 60);

        $result = $this->service->confirmInApp($userId, $id);
        if ($result === null) {
            return $this->respondWithErrors($this->service->getErrors(), 422);
        }

        return $this->respondWithData([
            'status' => SupportPendingAction::STATUS_CONFIRMED,
            'result_id' => $result['result_id'],
        ]);
    }

    /** POST /api/v2/users/me/support-actions/{id}/decline — reason optional, never required. */
    public function decline(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('support_action_answer', 10, 60);

        $data = $this->getAllInput();
        $reason = is_string($data['reason'] ?? null) ? $data['reason'] : null;

        if (! $this->service->decline($userId, $id, $reason)) {
            return $this->respondWithErrors($this->service->getErrors(), 404);
        }

        return $this->respondWithData(['status' => SupportPendingAction::STATUS_DECLINED]);
    }

    /** DELETE /api/v2/users/me/support-actions/{id} — supporter withdraws their own. */
    public function cancel(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        if (! $this->service->cancel($userId, $id)) {
            return $this->respondWithErrors($this->service->getErrors(), 404);
        }

        return $this->respondWithData(['status' => SupportPendingAction::STATUS_CANCELLED]);
    }

    /**
     * GET /api/v2/support-actions/confirm/{token} — public, READ-ONLY lookup
     * for the email-link page. Deliberately separate from the confirming POST
     * so following the link changes nothing.
     */
    public function showByToken(string $token): JsonResponse
    {
        $action = $this->service->findByToken($token);

        if (! $action) {
            return $this->respondWithError('NOT_FOUND', __('api.support_action_not_found'), null, 404);
        }

        $expired = $action->status === SupportPendingAction::STATUS_PENDING
            && $action->expires_at !== null
            && $action->expires_at->isPast();

        return $this->respondWithData([
            'action_type' => $action->action_type,
            'status' => $expired ? SupportPendingAction::STATUS_EXPIRED : $action->status,
            'supporter_name' => $action->supporterUser
                ? UserDisplayName::resolve($action->supporterUser)
                : null,
            'expires_at' => $action->expires_at?->toIso8601String(),
        ]);
    }

    /** POST /api/v2/support-actions/confirm/{token} — public, the actual confirmation. */
    public function confirmByToken(string $token): JsonResponse
    {
        $result = $this->service->confirmByToken($token);

        if ($result === null) {
            return $this->respondWithErrors($this->service->getErrors(), 422);
        }

        return $this->respondWithData([
            'status' => SupportPendingAction::STATUS_CONFIRMED,
            'result_id' => $result['result_id'],
        ]);
    }
}
