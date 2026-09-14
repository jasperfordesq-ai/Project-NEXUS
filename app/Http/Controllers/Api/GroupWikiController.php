<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\GroupWikiService;
use Illuminate\Http\JsonResponse;

/**
 * Group wiki HTTP adapter. Policy and persistence live in GroupWikiService.
 */
final class GroupWikiController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GroupWikiService $wikiService,
    ) {}

    public function index(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }

        $pages = $this->wikiService->listPages($id, $userId);

        return $pages === null
            ? $this->wikiErrorResponse()
            : $this->successResponse($pages);
    }

    public function create(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }

        try {
            $page = $this->wikiService->createPage(
                $id,
                $userId,
                [
                    ...request()->only(['title', 'content', 'parent_id', 'sort_order', 'is_published']),
                    'idempotency_key' => request()->header('Idempotency-Key') ?? request()->input('idempotency_key'),
                ],
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($page === null) {
            return $this->wikiErrorResponse();
        }
        unset($page['_idempotent_replay']);
        return $this->successResponse($page, 201);
    }

    public function show(int $id, string $slug): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }

        $page = $this->wikiService->getPage($id, $slug, $userId);

        return $page === null
            ? $this->wikiErrorResponse()
            : $this->successResponse($page);
    }

    public function update(int $id, int $pageId): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }

        try {
            $page = $this->wikiService->updatePage(
                $id,
                $pageId,
                $userId,
                request()->only([
                    'title',
                    'content',
                    'parent_id',
                    'sort_order',
                    'is_published',
                    'change_summary',
                    'expected_updated_at',
                ]),
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $page === null
            ? $this->wikiErrorResponse()
            : $this->successResponse($page);
    }

    public function destroy(int $id, int $pageId): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }

        if (! $this->wikiService->deletePage($id, $pageId, $userId)) {
            return $this->wikiErrorResponse();
        }

        return $this->successResponse(['message' => __('api_controllers_3.group_wiki.wiki_page_deleted')]);
    }

    public function revisions(int $id, int $pageId): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }

        $revisions = $this->wikiService->listRevisions($id, $pageId, $userId);

        return $revisions === null
            ? $this->wikiErrorResponse()
            : $this->successResponse($revisions);
    }

    private function wikiErrorResponse(): JsonResponse
    {
        $errors = $this->wikiService->getErrors();
        $status = match ($errors[0]['code'] ?? '') {
            'NOT_FOUND' => 404,
            'FORBIDDEN' => 403,
            'CONFLICT', 'IDEMPOTENCY_CONFLICT' => 409,
            'VALIDATION', 'INVALID', 'IDEMPOTENCY_INVALID' => 422,
            default => 400,
        };

        return $this->errorResponse($errors[0]['message'] ?? __('api.generic_error'), $status);
    }
}
