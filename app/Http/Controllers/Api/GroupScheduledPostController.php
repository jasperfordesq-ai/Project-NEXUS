<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use Illuminate\Auth\Access\AuthorizationException;
use App\Services\GroupAccessService;
use App\Services\GroupScheduledPostService;
use DomainException;
use InvalidArgumentException;

class GroupScheduledPostController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function index(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        if (!GroupAccessService::canIntegrate($id, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        }
        return $this->successResponse(GroupScheduledPostService::getScheduled($id));
    }

    public function store(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        if (!GroupAccessService::canIntegrate($id, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        }
        $data = request()->only(['post_type', 'title', 'content', 'scheduled_at', 'is_recurring', 'recurrence_pattern']);
        $data['idempotency_key'] = request()->header('Idempotency-Key') ?? request()->input('idempotency_key');
        if (empty($data['content']) || empty($data['scheduled_at'])) {
            return $this->errorResponse(__('api.group_scheduled_content_date_required'), 400);
        }
        try {
            $postId = GroupScheduledPostService::schedule($id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (AuthorizationException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        } catch (InvalidArgumentException $e) {
            if ($e->getMessage() === GroupScheduledPostService::ERROR_IDEMPOTENCY_INVALID) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('event_registration.idempotency_invalid'),
                    null,
                    422,
                );
            }
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (DomainException $e) {
            if ($e->getMessage() !== GroupScheduledPostService::ERROR_IDEMPOTENCY_CONFLICT) {
                throw $e;
            }
            return $this->respondWithError(
                'IDEMPOTENCY_CONFLICT',
                __('event_registration.idempotency_conflict'),
                null,
                409,
            );
        }
        return $this->successResponse(['id' => $postId], 201);
    }

    public function cancel(int $id, int $postId): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        if (!GroupAccessService::canIntegrate($id, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        }
        return GroupScheduledPostService::cancel($id, $postId, $userId)
            ? $this->successResponse(['message' => __('api_controllers_3.group_scheduled_post.cancelled')])
            : $this->errorResponse(__('api_controllers_3.group_scheduled_post.not_found_or_published'), 404);
    }
}
