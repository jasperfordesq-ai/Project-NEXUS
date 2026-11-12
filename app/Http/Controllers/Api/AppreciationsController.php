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
 * Every route carries `feature:appreciations` (routes/api.php): a community
 * that has switched thank-you notes off answers 403 FEATURE_DISABLED.
 *
 *   POST   /v2/appreciations
 *   PUT    /v2/appreciations/{id}/visibility   (the receiver only)
 *   DELETE /v2/appreciations/{id}              (the receiver or the sender)
 *   GET    /v2/users/{userId}/appreciations
 *   GET    /v2/me/appreciations?tab=received|sent|all
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
        $contextType = $this->input('context_type');
        try {
            // `is_public` in the body is ignored on purpose: a note is private
            // until its receiver chooses to show it (see visibility()).
            $appreciation = $this->service->send(
                $senderId,
                $receiverId,
                $message,
                is_string($contextType) && $contextType !== '' ? $contextType : null,
                $this->inputInt('context_id'),
            );
            $this->service->decorate([$appreciation], $senderId);

            return $this->respondWithData($appreciation, null, 201);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\DomainException $e) {
            $code = $e->getMessage();

            return $this->respondWithError(strtoupper($code), $code, null, 422);
        }
    }

    /**
     * The receiver shows a note on their profile, or hides it again. For
     * anyone else — the sender and administrators included — it is a 404.
     */
    public function visibility(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $raw = $this->input('is_public');
        $isPublic = is_bool($raw) ? $raw : (
            is_scalar($raw) ? filter_var($raw, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) : null
        );
        if ($isPublic === null) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.missing_required_field', ['field' => 'is_public']),
                'is_public',
                422,
            );
        }

        try {
            return $this->respondWithData($this->service->setVisibility($id, $userId, $isPublic));
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return $this->respondNotFound();
        }
    }

    /** The receiver or the sender removes a note. For anyone else it is a 404. */
    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        return $this->service->delete($id, $userId) ? $this->noContent() : $this->respondNotFound();
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

        $result = match ($tab) {
            'all' => $this->service->getMyAppreciations($userId, $page, $perPage),
            'sent' => $this->service->getSentAppreciations($userId, $page, $perPage),
            // received (the default): private ones included, since it is the receiver asking
            default => $this->service->getReceivedAppreciations($userId, $page, $perPage, false, $userId),
        };

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
