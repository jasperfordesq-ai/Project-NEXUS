<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use App\Services\IdeationChallengeService;
use App\Services\ChallengeTagService;
use App\Services\IdeaMediaService;
use App\Services\IdeaTeamConversionService;
use App\Services\TeamDocumentService;
use App\Services\ChallengeOutcomeService;
use App\Core\TenantContext;
use App\Core\ApiErrorCodes;
use App\Services\ChallengeCategoryService;
use App\Services\GroupChatroomService;
use App\Services\TeamTaskService;
use App\Services\CampaignService;
use App\Services\ChallengeTemplateService;

/**
 * IdeationChallengesController — Community ideation challenges and idea submissions.
 *
 * Core CRUD uses Eloquent via IdeationChallengeService.
 * All other methods call legacy static services directly (no ob_start delegation).
 * All methods are now fully native — no legacy delegation remaining.
 */
class IdeationChallengesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CampaignService $campaignService,
        private readonly ChallengeCategoryService $challengeCategoryService,
        private readonly ChallengeOutcomeService $challengeOutcomeService,
        private readonly IdeationChallengeService $challengeService,
        private readonly ChallengeTagService $challengeTagService,
        private readonly ChallengeTemplateService $challengeTemplateService,
        private readonly GroupChatroomService $groupChatroomService,
        private readonly IdeaMediaService $ideaMediaService,
        private readonly IdeaTeamConversionService $ideaTeamConversionService,
        private readonly TeamDocumentService $teamDocumentService,
        private readonly TeamTaskService $teamTaskService,
    ) {}

    /**
     * Ensure the ideation_challenges feature is enabled.
     */
    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('ideation_challenges')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.ideation_feature_disabled'), null, 403)
            );
        }
    }

    /**
     * Resolve HTTP status from error array.
     */
    private function resolveErrorStatus(array $errors): int
    {
        foreach ($errors as $error) {
            $code = $error['code'] ?? '';
            if ($code === ApiErrorCodes::RESOURCE_NOT_FOUND || $code === 'NOT_FOUND') {
                return 404;
            }
            if ($code === ApiErrorCodes::RESOURCE_FORBIDDEN || $code === 'FORBIDDEN') {
                return 403;
            }
            if ($code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
                return 503;
            }
            if (in_array($code, ['VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED'], true)) {
                return 403;
            }
            if ($code === ApiErrorCodes::RESOURCE_CONFLICT) {
                return 409;
            }
            if (in_array($code, ['GROUP_QUOTA_EXCEEDED', 'TENANT_QUOTA_EXCEEDED'], true)) {
                return 409;
            }
            if ($code === 'FILE_TOO_LARGE') {
                return 413;
            }
            if ($code === 'SERVER_ERROR') {
                return 500;
            }
        }
        return 422;
    }

    // ========================================
    // CHALLENGE ENDPOINTS (already native)
    // ========================================

    /** GET /api/v2/ideation-challenges — list challenges with filters + cursor pagination */
    public function index(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('ideation_list', 60, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
            'viewer_id' => $userId,
        ];

        if ($this->query('status')) {
            $filters['status'] = $this->query('status');
        }
        if ($this->query('category_id')) {
            $filters['category_id'] = (int) $this->query('category_id');
        }
        if ($this->query('search')) {
            $filters['search'] = $this->query('search');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->challengeService->getAll($filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /** GET /api/v2/ideation-challenges/{id} — single challenge detail */
    public function show(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('ideation_show', 120, 60);

        $challenge = $this->challengeService->getById($id, $userId);

        if (!$challenge) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.challenge_not_found'), null, 404);
        }

        return $this->respondWithData($challenge);
    }

    /** POST /api/v2/ideation-challenges — create a new challenge */
    public function store(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_create', 10, 60);

        $data = $this->getAllInput();
        try {
            $challengeId = $this->challengeService->create($userId, $data);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }

        $challenge = $this->challengeService->getById($challengeId, $userId);

        // Record feed activity
        try {
            app(\App\Services\FeedActivityService::class)->recordActivity(
                TenantContext::getId(),
                $userId,
                'challenge',
                $challengeId,
                [
                    'title'   => $data['title'] ?? null,
                    'content' => $data['description'] ?? null,
                ]
            );
        } catch (\Throwable $e) {
            \Log::warning('Feed activity recording failed', ['type' => 'challenge', 'id' => $challengeId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($challenge, null, 201);
    }

    /** GET /api/v2/ideation-challenges/{id}/ideas — list ideas for a challenge */
    public function ideas(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('ideation_ideas', 60, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
            'sort'  => $this->query('sort', 'votes'),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->challengeService->getIdeas($id, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /** POST /api/v2/ideation-challenges/{id}/ideas — submit idea to a challenge */
    public function submitIdea(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_submit_idea', 10, 60);

        // Submitting with no `title` used to reach IdeationChallengeService::submitIdea,
        // which does `trim($data['title'])` unguarded, and threw
        // "Undefined array key \"title\"" — a 500 for what is a plainly invalid
        // request. requireInput() is the house helper for this: it returns a 400
        // VALIDATION_REQUIRED_FIELD naming the field, the same shape the rest of the
        // API uses, instead of a stack trace.
        $this->requireInput('title');

        $data = $this->getAllInput();
        try {
            $ideaId = $this->challengeService->submitIdea($id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $this->respondWithData(['id' => $ideaId], null, 201);
    }

    // ========================================
    // CHALLENGE MANAGEMENT — now native
    // ========================================

    /** PUT /api/v2/ideation-challenges/{id} */
    public function update($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_update', 20, 60);

        $data = $this->getAllInput();
        $success = $this->challengeService->updateChallenge((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $challenge = $this->challengeService->getChallengeById((int) $id, $userId);
        return $this->respondWithData($challenge);
    }

    /** DELETE /api/v2/ideation-challenges/{id} */
    public function destroy($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_delete', 10, 60);

        $success = $this->challengeService->deleteChallenge((int) $id, $userId);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** PUT /api/v2/ideation-challenges/{id}/status */
    public function updateStatus($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_status', 20, 60);

        $newStatus = $this->input('status');

        if (empty($newStatus)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.status_required'), 'status', 400);
        }

        $success = $this->challengeService->updateChallengeStatus((int) $id, $userId, $newStatus);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $challenge = $this->challengeService->getChallengeById((int) $id, $userId);
        return $this->respondWithData($challenge);
    }

    /** POST /api/v2/ideation-challenges/{id}/favorite */
    public function toggleFavorite($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_favorite', 30, 60);

        try {
            $result = $this->challengeService->toggleFavorite((int) $id, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        $errors = $this->challengeService->getErrors();
        if (!empty($errors)) {
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($result);
    }

    /** POST /api/v2/ideation-challenges/{id}/duplicate */
    public function duplicate($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_duplicate', 10, 60);

        $newId = $this->challengeService->duplicateChallenge((int) $id, $userId);

        if ($newId === null) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $challenge = $this->challengeService->getChallengeById($newId, $userId);
        return $this->respondWithData($challenge, null, 201);
    }

    // ========================================
    // IDEA ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-ideas/{id} */
    public function showIdea($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();

        $idea = $this->challengeService->getIdeaById((int) $id, $userId);

        if (!$idea) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.idea_not_found'), null, 404);
        }

        return $this->respondWithData($idea);
    }

    /** PUT /api/v2/ideation-ideas/{id} */
    public function updateIdea($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_update_idea', 20, 60);

        $data = $this->getAllInput();
        $success = $this->challengeService->updateIdea((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $idea = $this->challengeService->getIdeaById((int) $id, $userId);
        return $this->respondWithData($idea);
    }

    /** PUT /api/v2/ideation-ideas/{id}/draft */
    public function updateDraft($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_update_draft', 20, 60);

        $data = $this->getAllInput();
        $success = $this->challengeService->updateDraftIdea((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData(['success' => true]);
    }

    /** DELETE /api/v2/ideation-ideas/{id} */
    public function deleteIdea($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_delete_idea', 10, 60);

        $success = $this->challengeService->deleteIdea((int) $id, $userId);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** POST /api/v2/ideation-ideas/{id}/vote */
    public function voteIdea($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_vote', 30, 60);

        try {
            $result = $this->challengeService->voteIdea((int) $id, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($result === null) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($result);
    }

    /** PUT /api/v2/ideation-ideas/{id}/status */
    public function updateIdeaStatus($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_idea_status', 20, 60);

        $newStatus = $this->input('status');

        if (empty($newStatus)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.status_required'), 'status', 400);
        }

        $success = $this->challengeService->updateIdeaStatus((int) $id, $userId, $newStatus);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $idea = $this->challengeService->getIdeaById((int) $id, $userId);
        return $this->respondWithData($idea);
    }

    /** GET /api/v2/ideation-challenges/{id}/ideas/drafts */
    public function ideaDrafts($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();

        $drafts = $this->challengeService->getUserDrafts((int) $id, $userId);
        return $this->respondWithData($drafts);
    }

    // ========================================
    // COMMENT ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-ideas/{id}/comments */
    public function comments($id): JsonResponse
    {
        $this->ensureFeature();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->challengeService->getComments((int) $id, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /** POST /api/v2/ideation-ideas/{id}/comments */
    public function addComment($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_comment', 20, 60);

        $body = $this->input('body', '');
        try {
            $commentId = $this->challengeService->addComment((int) $id, $userId, $body);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($commentId === null) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $comments = $this->challengeService->getComments((int) $id, ['limit' => 1]);
        $comment = !empty($comments['items']) ? $comments['items'][0] : ['id' => $commentId];

        return $this->respondWithData($comment, null, 201);
    }

    /** DELETE /api/v2/ideation-comments/{id} */
    public function deleteComment($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_delete_comment', 10, 60);

        $success = $this->challengeService->deleteComment((int) $id, $userId);

        if (!$success) {
            $errors = $this->challengeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // IDEA → GROUP CONVERSION — now native
    // ========================================

    /** POST /api/v2/ideation-ideas/{id}/convert-to-group */
    public function convertToGroup($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_convert_group', 5, 60);

        $options = $this->getAllInput();
        try {
            $result = $this->ideaTeamConversionService->convert((int) $id, $userId, $options);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$result) {
            $errors = $this->ideaTeamConversionService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($result, null, 201);
    }

    // ========================================
    // CATEGORY ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-categories */
    public function listCategories(): JsonResponse
    {
        $this->ensureFeature();
        $categories = $this->challengeCategoryService->getAll();
        return $this->respondWithData($categories);
    }

    /** POST /api/v2/ideation-categories */
    public function createCategory(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_category', 20, 60);

        $data = $this->getAllInput();
        $id = $this->challengeCategoryService->create($userId, $data);

        if ($id === null) {
            $errors = $this->challengeCategoryService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $category = $this->challengeCategoryService->getById($id);
        return $this->respondWithData($category, null, 201);
    }

    /** PUT /api/v2/ideation-categories/{id} */
    public function updateCategory($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_category', 20, 60);

        $data = $this->getAllInput();
        $success = $this->challengeCategoryService->update((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->challengeCategoryService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $category = $this->challengeCategoryService->getById((int) $id);
        return $this->respondWithData($category);
    }

    /** DELETE /api/v2/ideation-categories/{id} */
    public function deleteCategory($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_category', 10, 60);

        $success = $this->challengeCategoryService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->challengeCategoryService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // TAG ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-tags/popular */
    public function popularTags(): JsonResponse
    {
        $this->ensureFeature();
        $tags = $this->challengeService->getAllTags();
        return $this->respondWithData($tags);
    }

    /** GET /api/v2/ideation-tags */
    public function listTags(): JsonResponse
    {
        $this->ensureFeature();
        $tagType = $this->query('type');
        $tags = $this->challengeTagService->getAll($tagType);
        return $this->respondWithData($tags);
    }

    /** POST /api/v2/ideation-tags */
    public function createTag(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_tag', 30, 60);

        $data = $this->getAllInput();
        $id = $this->challengeTagService->create($userId, $data);

        if ($id === null) {
            $errors = $this->challengeTagService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $tag = $this->challengeTagService->getById($id);
        return $this->respondWithData($tag, null, 201);
    }

    /** DELETE /api/v2/ideation-tags/{id} */
    public function deleteTag($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_tag', 10, 60);

        $success = $this->challengeTagService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->challengeTagService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // IDEA MEDIA ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-ideas/{id}/media */
    public function listIdeaMedia($id): JsonResponse
    {
        $this->ensureFeature();
        $media = $this->ideaMediaService->getMediaForIdea((int) $id);
        return $this->respondWithData($media);
    }

    /** POST /api/v2/ideation-ideas/{id}/media */
    public function addIdeaMedia($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_media', 20, 60);

        $data = $this->getAllInput();
        $mediaId = $this->ideaMediaService->addMedia((int) $id, $userId, $data);

        if ($mediaId === null) {
            $errors = $this->ideaMediaService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData(['id' => $mediaId], null, 201);
    }

    /** DELETE /api/v2/ideation-media/{id} */
    public function deleteIdeaMedia($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_media', 10, 60);

        $success = $this->ideaMediaService->deleteMedia((int) $id, $userId);

        if (!$success) {
            $errors = $this->ideaMediaService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // CAMPAIGN ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-campaigns */
    public function listCampaigns(): JsonResponse
    {
        $this->ensureFeature();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('status')) {
            $filters['status'] = $this->query('status');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->campaignService->getAll($filters);
        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    /** GET /api/v2/ideation-campaigns/{id} */
    public function showCampaign($id): JsonResponse
    {
        $this->ensureFeature();
        $campaign = $this->campaignService->getById((int) $id);

        if (!$campaign) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.campaign_not_found'), null, 404);
        }

        return $this->respondWithData($campaign);
    }

    /** POST /api/v2/ideation-campaigns */
    public function createCampaign(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_campaign', 10, 60);

        $data = $this->getAllInput();
        $id = $this->campaignService->create($userId, $data);

        if ($id === null) {
            $errors = $this->campaignService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $campaign = $this->campaignService->getById($id);
        return $this->respondWithData($campaign, null, 201);
    }

    /** PUT /api/v2/ideation-campaigns/{id} */
    public function updateCampaign($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_campaign', 20, 60);

        $data = $this->getAllInput();
        $success = $this->campaignService->update((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->campaignService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $campaign = $this->campaignService->getById((int) $id);
        return $this->respondWithData($campaign);
    }

    /** DELETE /api/v2/ideation-campaigns/{id} */
    public function deleteCampaign($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_campaign', 10, 60);

        $success = $this->campaignService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->campaignService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** POST /api/v2/ideation-campaigns/{id}/challenges */
    public function linkChallengeToCampaign($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_campaign', 20, 60);

        $challengeId = $this->inputInt('challenge_id');
        $sortOrder = $this->inputInt('sort_order', 0);

        if (!$challengeId || $challengeId <= 0) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.missing_required_field', ['field' => 'challenge_id']), 'challenge_id', 400);
        }

        $success = $this->campaignService->linkChallenge((int) $id, $challengeId, $userId, $sortOrder);

        if (!$success) {
            $errors = $this->campaignService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData(['linked' => true], null, 201);
    }

    /** DELETE /api/v2/ideation-campaigns/{id}/challenges/{challengeId} */
    public function unlinkChallengeFromCampaign($id, $challengeId): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_campaign', 20, 60);

        $success = $this->campaignService->unlinkChallenge((int) $id, (int) $challengeId, $userId);

        if (!$success) {
            $errors = $this->campaignService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // TEMPLATE ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/ideation-templates */
    public function listTemplates(): JsonResponse
    {
        $this->ensureFeature();
        $templates = $this->challengeTemplateService->getAll();
        return $this->respondWithData($templates);
    }

    /** GET /api/v2/ideation-templates/{id} */
    public function showTemplate($id): JsonResponse
    {
        $this->ensureFeature();
        $template = $this->challengeTemplateService->getById((int) $id);

        if (!$template) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.template_not_found'), null, 404);
        }

        return $this->respondWithData($template);
    }

    /** POST /api/v2/ideation-templates */
    public function createTemplate(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_template', 10, 60);

        $data = $this->getAllInput();
        $id = $this->challengeTemplateService->create($userId, $data);

        if ($id === null) {
            $errors = $this->challengeTemplateService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $template = $this->challengeTemplateService->getById($id);
        return $this->respondWithData($template, null, 201);
    }

    /** PUT /api/v2/ideation-templates/{id} */
    public function updateTemplate($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_template', 20, 60);

        $data = $this->getAllInput();
        $success = $this->challengeTemplateService->update((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->challengeTemplateService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $template = $this->challengeTemplateService->getById((int) $id);
        return $this->respondWithData($template);
    }

    /** DELETE /api/v2/ideation-templates/{id} */
    public function deleteTemplate($id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_template', 10, 60);

        $success = $this->challengeTemplateService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->challengeTemplateService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** GET /api/v2/ideation-templates/{id}/data */
    public function getTemplateData($id): JsonResponse
    {
        $this->ensureFeature();
        $data = $this->challengeTemplateService->getTemplateData((int) $id);

        if ($data === null) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.template_not_found'), null, 404);
        }

        return $this->respondWithData($data);
    }

    // ========================================
    // OUTCOME / IMPACT TRACKING — now native
    // ========================================

    /** GET /api/v2/ideation-challenges/{id}/outcome */
    public function getOutcome($id): JsonResponse
    {
        $this->ensureFeature();
        $outcome = $this->challengeOutcomeService->getForChallenge((int) $id);
        return $this->respondWithData($outcome);
    }

    /** PUT /api/v2/ideation-challenges/{id}/outcome */
    public function upsertOutcome($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('ideation_outcome', 10, 60);

        $data = $this->getAllInput();
        $outcomeId = $this->challengeOutcomeService->upsert((int) $id, $userId, $data);

        if ($outcomeId === null) {
            $errors = $this->challengeOutcomeService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $outcome = $this->challengeOutcomeService->getForChallenge((int) $id);
        return $this->respondWithData($outcome);
    }

    /** GET /api/v2/ideation-outcomes/dashboard */
    public function outcomesDashboard(): JsonResponse
    {
        $this->ensureFeature();
        $dashboard = $this->challengeOutcomeService->getDashboard();
        return $this->respondWithData($dashboard);
    }

    // ========================================
    // TEAM LINKS — now native
    // ========================================

    /** GET /api/v2/ideation-challenges/{id}/team-links */
    public function getTeamLinks($id): JsonResponse
    {
        $this->ensureFeature();
        $links = $this->ideaTeamConversionService->getLinksForChallenge((int) $id, $this->getUserId());
        return $this->respondWithData($links);
    }

    // ========================================
    // GROUP CHATROOM ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/groups/{id}/chatrooms */
    public function listChatrooms($id): JsonResponse
    {
        $this->ensureFeature();
        $chatrooms = $this->groupChatroomService->getChatrooms((int) $id, null, $this->getUserId());
        if ($chatrooms === null) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($chatrooms);
    }

    /** POST /api/v2/groups/{id}/chatrooms */
    public function createChatroom($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('group_chatroom', 10, 60);

        $data = $this->getAllInput();
        $chatroomId = $this->groupChatroomService->create((int) $id, $userId, $data);

        if ($chatroomId === null) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $chatroom = $this->groupChatroomService->getById($chatroomId, $userId);
        if ($chatroom === null) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($chatroom, null, 201);
    }

    /** DELETE /api/v2/group-chatrooms/{id} */
    public function deleteChatroom($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('group_chatroom', 10, 60);

        $success = $this->groupChatroomService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** GET /api/v2/group-chatrooms/{id}/messages */
    public function chatroomMessages($id): JsonResponse
    {
        $this->ensureFeature();
        $filters = [
            'limit' => $this->queryInt('per_page', 50, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->groupChatroomService->getMessages((int) $id, $filters, $this->getUserId());
        if ($result === null) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    /** POST /api/v2/group-chatrooms/{id}/messages */
    public function postChatroomMessage($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('chatroom_message', 30, 60);

        $body = $this->input('body', '');
        $messageId = $this->groupChatroomService->postMessage((int) $id, $userId, $body);

        if ($messageId === null) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData(['id' => $messageId], null, 201);
    }

    /** DELETE /api/v2/group-chatroom-messages/{id} */
    public function deleteChatroomMessage($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('chatroom_message', 10, 60);

        $success = $this->groupChatroomService->deleteMessage((int) $id, $userId);

        if (!$success) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** POST /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId} */
    public function pinChatroomMessage($groupId, $chatroomId, $messageId): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('chatroom_pin', 20, 60);

        $success = $this->groupChatroomService->pinMessage((int) $groupId, (int) $chatroomId, (int) $messageId, $userId);

        if (!$success) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData(['pinned' => true], null, 201);
    }

    /** DELETE /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId} */
    public function unpinChatroomMessage($groupId, $chatroomId, $messageId): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('chatroom_pin', 20, 60);

        $success = $this->groupChatroomService->unpinMessage((int) $groupId, (int) $chatroomId, (int) $messageId, $userId);

        if (!$success) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** GET /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pinned */
    public function pinnedChatroomMessages($groupId, $chatroomId): JsonResponse
    {
        $this->ensureFeature();
        $pinned = $this->groupChatroomService->getPinnedMessages((int) $groupId, (int) $chatroomId, $this->getUserId());
        if ($pinned === null) {
            $errors = $this->groupChatroomService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($pinned);
    }

    // ========================================
    // TEAM TASK ENDPOINTS — now native
    // ========================================

    /** GET /api/v2/groups/{id}/tasks */
    public function listTasks($id): JsonResponse
    {
        $this->ensureFeature();
        $filters = [
            'limit' => $this->queryInt('per_page', 50, 1, 100),
        ];
        if ($this->query('status')) {
            $filters['status'] = $this->query('status');
        }
        if ($this->query('assigned_to')) {
            $filters['assigned_to'] = (int) $this->query('assigned_to');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->teamTaskService->getTasks((int) $id, $filters, $this->getUserId());
        if (!empty($this->teamTaskService->getErrors())) {
            $errors = $this->teamTaskService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    /** POST /api/v2/groups/{id}/tasks */
    public function createTask($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('team_task', 20, 60);

        $data = $this->getAllInput();
        try {
            $taskId = $this->teamTaskService->create((int) $id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($taskId === null) {
            $errors = $this->teamTaskService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $task = $this->teamTaskService->getById($taskId, $userId);
        return $this->respondWithData($task, null, 201);
    }

    /** GET /api/v2/team-tasks/{id} */
    public function showTask($id): JsonResponse
    {
        $this->ensureFeature();
        $task = $this->teamTaskService->getById((int) $id, $this->getUserId());

        if (!$task) {
            $errors = $this->teamTaskService->getErrors();
            if (!empty($errors)) {
                return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
            }
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.task_not_found'), null, 404);
        }

        return $this->respondWithData($task);
    }

    /** PUT /api/v2/team-tasks/{id} */
    public function updateTask($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('team_task', 30, 60);

        $data = $this->getAllInput();
        try {
            $success = $this->teamTaskService->update((int) $id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            $errors = $this->teamTaskService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $task = $this->teamTaskService->getById((int) $id, $userId);
        return $this->respondWithData($task);
    }

    /** DELETE /api/v2/team-tasks/{id} */
    public function deleteTask($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('team_task', 10, 60);

        $success = $this->teamTaskService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->teamTaskService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    /** GET /api/v2/groups/{id}/task-stats */
    public function taskStats($id): JsonResponse
    {
        $this->ensureFeature();
        $stats = $this->teamTaskService->getStats((int) $id, $this->getUserId());
        if (!empty($this->teamTaskService->getErrors())) {
            $errors = $this->teamTaskService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData($stats);
    }

    // ========================================
    // TEAM DOCUMENT ENDPOINTS — now native (except upload)
    // ========================================

    /** GET /api/v2/groups/{id}/documents */
    public function listDocuments($id): JsonResponse
    {
        $this->ensureFeature();
        $filters = [
            'limit' => $this->queryInt('per_page', 50, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->teamDocumentService->getDocuments((int) $id, $filters, $this->getUserId());
        if (!empty($this->teamDocumentService->getErrors())) {
            $errors = $this->teamDocumentService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    /**
     * POST /api/v2/groups/{id}/documents
     * Multipart upload with 'file' field.
     */
    public function uploadDocument($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('team_document', 10, 60);

        /** @var \Illuminate\Http\Request $request */
        $request = request();
        $file = $request->file('file');
        $title = $request->input('title');

        // Build the fileData array in the same shape TeamDocumentService::upload expects ($_FILES format)
        $fileData = [];
        if ($file) {
            $fileData = [
                'name' => $file->getClientOriginalName(),
                'type' => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error' => $file->getError(),
                'size' => $file->getSize(),
            ];
        }

        try {
            $docId = $this->teamDocumentService->upload((int) $id, $userId, $fileData, $title);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($docId === null) {
            $errors = $this->teamDocumentService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->respondWithData(['id' => $docId], null, 201);
    }

    /** DELETE /api/v2/team-documents/{id} */
    public function deleteDocument($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('team_document', 10, 60);

        $success = $this->teamDocumentService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->teamDocumentService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // Legacy vote endpoint (kept for backward compatibility)
    // ========================================

    /** POST /api/v2/ideation-challenges/{id}/vote */
    public function vote(int $id): JsonResponse
    {
        return $this->voteIdea($id);
    }

}
