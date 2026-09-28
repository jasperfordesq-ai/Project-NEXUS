<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\Social\AppreciationService;
use Illuminate\Http\JsonResponse;
use App\Services\BlockUserService;
use App\Support\Members\MemberProfileVisibility;

/**
 * SOC14 — Appreciations / thank-you HTTP controller.
 *
 *   POST   /v2/appreciations
 *   GET    /v2/users/{userId}/appreciations
 *   GET    /v2/me/appreciations
 *   POST   /v2/appreciations/{id}/react
 *   DELETE /v2/appreciations/{id}/react
 *   GET    /v2/appreciations/most-appreciated
 */
class AppreciationsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly AppreciationService $service)
    {
    }

    public function send(): JsonResponse
    {
        $senderId = $this->requireAuth();
        $receiverId = $this->inputInt('receiver_id', 0, 1) ?? 0;
        $message = trim((string) $this->input('message', ''));
        if ($receiverId === 0 || $message === '') {
            return $this->respondWithError('VALIDATION_ERROR', 'receiver_id and message required', null, 422);
        }
        try {
            $appreciation = $this->service->send(
                $senderId,
                $receiverId,
                $message,
                $this->input('context_type'),
                $this->inputInt('context_id'),
                $this->inputBool('is_public', true),
            );
            return $this->respondWithData($appreciation, null, 201);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\DomainException $e) {
            $code = $e->getMessage();
            $status = $code === 'rate_limit_exceeded' ? 422 : 422;
            return $this->respondWithError(strtoupper($code), $code, null, $status);
        }
    }

    public function publicForUser(int $userId): JsonResponse
    {
        if ($refusal = $this->refuseIfProfileHidden($userId)) {
            return $refusal;
        }
        $viewerId = $this->getOptionalUserId();
        $page = $this->queryInt('page', 1, 1) ?? 1;
        $perPage = $this->queryInt('per_page', 20, 1, 100) ?? 20;
        $result = $this->service->getReceivedAppreciations($userId, $page, $perPage, true, $viewerId);
        return $this->respondWithData($result['data'], $result['meta']);
    }

    public function mine(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tab = (string) $this->query('tab', 'received');
        $page = $this->queryInt('page', 1, 1) ?? 1;
        $perPage = $this->queryInt('per_page', 20, 1, 100) ?? 20;

        if ($tab === 'all') {
            $result = $this->service->getMyAppreciations($userId, $page, $perPage);
        } else {
            // received tab: include private since it's the receiver
            $result = $this->service->getReceivedAppreciations($userId, $page, $perPage, false, $userId);
        }
        return $this->respondWithData($result['data'], $result['meta']);
    }

    public function react(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $type = (string) $this->input('reaction_type', '');
        try {
            $result = $this->service->react($id, $userId, $type);
            return $this->respondWithData($result);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\DomainException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return $this->respondNotFound();
        }
    }

    public function removeReaction(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $ok = $this->service->removeReaction($id, $userId);
        return $ok ? $this->noContent() : $this->respondNotFound();
    }

    public function mostAppreciated(): JsonResponse
    {
        $this->getOptionalUserId();
        $period = (string) $this->query('period', 'last_30d');
        $limit = $this->queryInt('limit', 10, 1, 50) ?? 10;
        return $this->respondWithData($this->service->getMostAppreciatedMembers(null, $period, $limit));
    }

    /**
     * F-246 (E-055): this is part of the member's profile, so the profile
     * route's gate (GET /v2/users/{id}) applies — a block in either direction
     * is refused with 403, and the member's privacy_profile choice with the
     * same 404 PROFILE_PRIVATE. The owner is never refused.
     */
    private function refuseIfProfileHidden(int $ownerId): ?JsonResponse
    {
        $viewerId = $this->getOptionalUserId();
        if ($viewerId !== null && $viewerId === $ownerId) {
            return null;
        }
        if ($viewerId !== null && BlockUserService::isBlockedEither($viewerId, $ownerId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }
        if (! MemberProfileVisibility::canView($ownerId, $viewerId)) {
            return $this->respondWithError('PROFILE_PRIVATE', __('api.user_profile_private'), null, 404);
        }

        return null;
    }
}
