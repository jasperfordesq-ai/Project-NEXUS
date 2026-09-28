<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\Social\SavedCollectionService;
use Illuminate\Http\JsonResponse;
use App\Services\BlockUserService;
use App\Support\Members\MemberProfileVisibility;

/**
 * SOC10 — Bookmarks / Saved-collections HTTP controller.
 *
 * Endpoints (all auth-required, scoped via TenantContext in service):
 *   GET    /v2/me/collections
 *   POST   /v2/me/collections
 *   PATCH  /v2/me/collections/{id}
 *   DELETE /v2/me/collections/{id}
 *   GET    /v2/me/collections/{id}/items
 *   POST   /v2/me/saved-items
 *   DELETE /v2/me/saved-items/{id}
 *   GET    /v2/me/saved-items/check
 *   POST   /v2/me/saved-items/check-bulk
 *   GET    /v2/users/{userId}/public-collections
 */
class SavedCollectionsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly SavedCollectionService $service)
    {
    }

    public function listCollections(): JsonResponse
    {
        $userId = $this->requireAuth();
        $rows = $this->service->getUserCollections($userId, false);
        return $this->respondWithData($rows);
    }

    public function createCollection(): JsonResponse
    {
        $userId = $this->requireAuth();
        $name = (string) $this->input('name', '');
        if (trim($name) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'name']), 'name', 422);
        }
        try {
            $col = $this->service->createCollection(
                $userId,
                $name,
                $this->input('description'),
                $this->inputBool('is_public', false),
                (string) $this->input('color', '#6366f1'),
                (string) $this->input('icon', 'bookmark'),
            );
            return $this->respondWithData($col, null, 201);
        } catch (\Throwable $e) {
            return $this->respondServerError($e->getMessage());
        }
    }

    public function updateCollection(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        try {
            $col = $this->service->updateCollection($id, $userId, $this->getAllInput());
            return $this->respondWithData($col);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return $this->respondNotFound();
        }
    }

    public function deleteCollection(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        try {
            $this->service->deleteCollection($id, $userId);
            return $this->noContent();
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return $this->respondNotFound();
        }
    }

    public function listItems(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $page = $this->queryInt('page', 1, 1) ?? 1;
        $perPage = $this->queryInt('per_page', 20, 1, 100) ?? 20;
        try {
            $result = $this->service->getSavedItems($id, $userId, $page, $perPage);
            return $this->respondWithData([
                'items' => $result['data'],
                'collection' => $result['collection'],
            ], $result['meta']);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return $this->respondNotFound();
        }
    }

    public function saveItem(): JsonResponse
    {
        $userId = $this->requireAuth();
        $itemType = (string) $this->input('item_type', '');
        $itemId = $this->inputInt('item_id', 0, 1) ?? 0;
        $collectionId = $this->inputInt('collection_id');
        $note = $this->input('note');

        if ($itemType === '' || $itemId === 0) {
            return $this->respondWithError('VALIDATION_ERROR', 'item_type and item_id required', null, 422);
        }
        try {
            $item = $this->service->saveItem($userId, $collectionId, $itemType, $itemId, $note);
            return $this->respondWithData($item, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return $this->respondNotFound('Collection not found');
        }
    }

    public function unsaveItem(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $ok = $this->service->unsaveItem($id, $userId);
        return $ok ? $this->noContent() : $this->respondNotFound();
    }

    /**
     * DELETE /v2/me/saved-items?item_type=&item_id=  — remove by pair, idempotent.
     */
    public function unsaveByPair(): JsonResponse
    {
        $userId = $this->requireAuth();
        $itemType = (string) $this->query('item_type', '');
        $itemId = $this->queryInt('item_id', 0, 1) ?? 0;
        if ($itemType === '' || $itemId === 0) {
            return $this->respondWithError('VALIDATION_ERROR', 'item_type and item_id required', null, 422);
        }
        $this->service->unsaveByItem($userId, $itemType, $itemId);
        return $this->noContent();
    }

    public function checkSingle(): JsonResponse
    {
        $userId = $this->requireAuth();
        $itemType = (string) $this->query('item_type', '');
        $itemId = $this->queryInt('item_id', 0, 1) ?? 0;
        if ($itemType === '' || $itemId === 0) {
            return $this->respondWithError('VALIDATION_ERROR', 'item_type and item_id required', null, 422);
        }
        return $this->respondWithData(['saved' => $this->service->isSaved($userId, $itemType, $itemId)]);
    }

    public function checkBulk(): JsonResponse
    {
        $userId = $this->requireAuth();
        $items = (array) $this->input('items', []);
        $pairs = [];
        foreach ($items as $row) {
            if (!is_array($row)) continue;
            if (isset($row['item_type'], $row['item_id'])) {
                $pairs[] = [
                    'item_type' => (string) $row['item_type'],
                    'item_id' => (int) $row['item_id'],
                ];
            }
        }
        return $this->respondWithData($this->service->isSavedBulk($userId, $pairs));
    }

    public function publicCollections(int $userId): JsonResponse
    {
        if ($refusal = $this->refuseIfProfileHidden($userId)) {
            return $refusal;
        }
        $rows = $this->service->getUserCollections($userId, true);
        return $this->respondWithData($rows);
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
