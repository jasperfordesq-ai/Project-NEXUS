<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\GroupNotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\UploadedFile;
use App\Services\GroupService;
use App\Services\GroupAnnouncementService;

/**
 * GroupsController - Groups CRUD, members, discussions, announcements.
 *
 * Converted from delegation to direct static service calls.
 * All methods are now native Laravel — no legacy delegation remains.
 */
class GroupsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GroupAnnouncementService $groupAnnouncementService,
        private readonly GroupNotificationService $groupNotificationService,
        private readonly GroupService $groupService,
    ) {}

    // ================================================================
    // LIST / SHOW
    // ================================================================

    /**
     * GET /api/v2/groups
     */
    public function index(): JsonResponse
    {
        $userId = $this->resolveSanctumUserOptionally();
        $limitParam = $this->query('per_page') !== null ? 'per_page' : 'limit';

        $filters = [
            'limit' => $this->queryInt($limitParam, 20, 1, 100),
            'viewer_user_id' => $userId,
        ];

        if ($this->query('type')) {
            $filters['type'] = $this->query('type');
        }
        if ($this->query('type_id')) {
            $filters['type_id'] = $this->queryInt('type_id');
        }
        if ($this->query('visibility')) {
            $filters['visibility'] = $this->query('visibility');
        }
        if ($this->query('user_id')) {
            $filters['user_id'] = $this->queryInt('user_id');
        }
        if ($this->query('member') === 'me' && $userId) {
            $filters['user_id'] = $userId;
        }
        if ($this->query('q')) {
            $filters['search'] = $this->query('q');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->groupService->getAll($filters);
        if ($result === null) {
            $errors = $this->groupService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        // Batch-load viewer memberships (single query instead of N+1)
        if ($userId && !empty($result['items'])) {
            $groupIds = array_column($result['items'], 'id');
            $membershipMap = $this->groupService->getViewerMembershipsBatch($groupIds, $userId);
            foreach ($result['items'] as &$group) {
                $group['viewer_membership'] = $membershipMap[(int) $group['id']] ?? null;
            }
        }

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * GET /api/v2/groups/{id}
     */
    public function show(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $group = $this->groupService->getById($id, $userId, true);

        if (!$group) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        return $this->respondWithData($group);
    }

    /** GET /api/v2/groups/form-capabilities */
    public function formCapabilities(): JsonResponse
    {
        $userId = $this->requireAuth();

        return $this->respondWithData($this->groupService->getFormCapabilities($userId));
    }

    // ================================================================
    // CREATE / UPDATE / DELETE
    // ================================================================

    /**
     * POST /api/v2/groups
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('groups_create', 10, 60);

        $data = $this->getAllInput();
        // Image paths only ever come from files this request uploads; a client
        // supplied path could point at another group's file (F-094).
        unset($data['image_url'], $data['cover_image_url']);
        $stagedImages = [];
        foreach (['avatar' => 'image_url', 'cover' => 'cover_image_url'] as $input => $field) {
            $file = request()->file($input);
            if (! $file instanceof UploadedFile) {
                continue;
            }
            $stored = $this->storeGroupImageFile($file, $input === 'cover' ? 'cover' : 'avatar');
            if ($stored instanceof JsonResponse) {
                $this->cleanupStagedGroupImages($stagedImages);
                return $stored;
            }
            $stagedImages[] = $stored;
            $data[$field] = $stored;
        }

        try {
            $createdGroup = $this->groupService->create($userId, $data);
        } catch (\Throwable $exception) {
            $this->cleanupStagedGroupImages($stagedImages);
            throw $exception;
        }

        if ($createdGroup === null) {
            $this->cleanupStagedGroupImages($stagedImages);
            $errors = $this->groupService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        // create() returns a Group model — use its ID to fetch the full response
        $groupId = $createdGroup instanceof \App\Models\Group ? $createdGroup->id : (int) $createdGroup;
        $group = $this->groupService->getById($groupId, $userId);

        // Pending-review groups have not completed creation for economy purposes.
        if ($createdGroup->status === \App\Enums\GroupStatus::Active) {
            try {
                \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['create_group'], 'create_group', __('api.group_created'));
            } catch (\Throwable $e) {
                \Log::warning('Gamification XP award failed', ['action' => 'create_group', 'user' => $userId, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData($group, null, 201);
    }

    /**
     * POST /api/v2/groups/{id}/settings
     *
     * Multipart form commit for fields plus staged keep/replace/remove image
     * operations. New bytes are compensated if the database transaction fails;
     * replaced bytes are removed only after the new record commits.
     */
    public function updateForm($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_settings_update', 20, 60);

        $existing = $this->groupService->getById($id, $userId);
        if ($existing === null) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }
        if (! $this->groupService->canModify($id, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_edit_forbidden'), null, 403);
        }

        $data = $this->getAllInput();
        // Image paths only ever come from the staged uploads below (F-094).
        unset($data['image_url'], $data['cover_image_url']);
        $operations = [
            'avatar' => (string) ($data['avatar_action'] ?? 'keep'),
            'cover' => (string) ($data['cover_action'] ?? 'keep'),
        ];
        foreach ($operations as $operation) {
            if (! in_array($operation, ['keep', 'replace', 'remove'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_action_invalid'), 'image', 422);
            }
        }

        $stagedImages = [];
        foreach ($operations as $type => $operation) {
            $field = $type === 'avatar' ? 'image_url' : 'cover_image_url';
            if ($operation === 'remove') {
                $data[$field] = null;
                continue;
            }
            if ($operation !== 'replace') {
                continue;
            }

            $file = request()->file($type);
            if (! $file instanceof UploadedFile) {
                $this->cleanupStagedGroupImages($stagedImages);
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_image_uploaded'), $type, 422);
            }
            $stored = $this->storeGroupImageFile($file, $type);
            if ($stored instanceof JsonResponse) {
                $this->cleanupStagedGroupImages($stagedImages);
                return $stored;
            }
            $stagedImages[] = $stored;
            $data[$field] = $stored;
        }
        unset($data['avatar_action'], $data['cover_action']);

        try {
            $success = $this->groupService->update($id, $userId, $data, true);
        } catch (\Throwable $exception) {
            $this->cleanupStagedGroupImages($stagedImages);
            throw $exception;
        }
        if (! $success) {
            $this->cleanupStagedGroupImages($stagedImages);
            $errors = $this->groupService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        foreach ($operations as $type => $operation) {
            if ($operation === 'keep') {
                continue;
            }
            $oldUrl = $type === 'avatar'
                ? ($existing['image_url'] ?? null)
                : ($existing['cover_image_url'] ?? null);
            if (is_string($oldUrl) && $oldUrl !== '' && ! in_array($oldUrl, $stagedImages, true)
                && ! $this->deleteReplacedGroupImage($oldUrl)) {
                \Log::warning('Group settings committed but previous image cleanup was not possible', [
                    'group_id' => $id,
                    'type' => $type,
                    'previous_url' => $oldUrl,
                ]);
            }
        }

        return $this->respondWithData($this->groupService->getById($id, $userId));
    }

    /**
     * PUT /api/v2/groups/{id}
     */
    public function update($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_update', 20, 60);

        $data = $this->getAllInput();

        $success = $this->groupService->update($id, $userId, $data);

        if (!$success) {
            $errors = $this->groupService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        $group = $this->groupService->getById($id, $userId);

        return $this->respondWithData($group);
    }

    /**
     * DELETE /api/v2/groups/{id}
     */
    public function destroy($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_delete', 10, 60);

        $success = $this->groupService->delete($id, $userId);

        if (!$success) {
            $errors = $this->groupService->getErrors();
            $status = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->noContent();
    }

    // ================================================================
    // JOIN / LEAVE
    // ================================================================

    /**
     * POST /api/v2/groups/{id}/join
     */
    public function join(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('groups_join', 30, 60);

        try {
            $result = $this->groupService->join($id, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!($result['success'] ?? false)) {
            $error = $result['error'] ?? __('api.group_join_failed');
            $errorCode = (string) ($result['code'] ?? 'JOIN_FAILED');
            $httpStatus = match ($errorCode) {
                'NOT_FOUND' => 404,
                'BANNED', 'FORBIDDEN' => 403,
                'ALREADY_MEMBER' => 409,
                'CAPACITY_FULL', 'MEMBERSHIP_LIMIT_REACHED', 'GROUP_UNAVAILABLE' => 409,
                default => 422,
            };
            return $this->respondWithError($errorCode, $error, null, $httpStatus);
        }

        $joinStatus = $result['status'] ?? 'active';
        $joinAction = $result['action'] ?? ($joinStatus === 'active' ? 'joined' : 'requested');

        // Notify based on join result
        try {
            if ($joinAction === 'joined') {
                $this->groupNotificationService->notifyJoined($id, $userId);
            } elseif ($joinAction === 'requested') {
                $this->groupNotificationService->notifyJoinRequest($id, $userId);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Group join notification error: " . $e->getMessage());
        }

        // Award XP when user actually joins (not just pending request)
        if ($joinAction === 'joined') {
            try {
                \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['join_group'], 'join_group', __('api.group_joined'));
            } catch (\Throwable $e) {
                \Log::warning('Gamification XP award failed', ['action' => 'join_group', 'user' => $userId, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData([
            'status' => $joinStatus,
            'action' => $joinAction,
            'membership' => [
                'status' => $joinStatus,
                'role' => 'member',
            ],
            'message' => $joinStatus === 'active' ? __('api.group_joined') : __('api.group_join_requested'),
        ]);
    }

    /**
     * DELETE /api/v2/groups/{id}/membership
     */
    public function leave(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('groups_leave', 30, 60);

        $result = $this->groupService->leave($id, $userId);

        if (!($result['success'] ?? false)) {
            $errors = $this->groupService->getErrors();
            $httpStatus = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $httpStatus = 404;
                    break;
                }
                if ($error['code'] === 'NOT_MEMBER') {
                    $httpStatus = 409;
                    break;
                }
                if (in_array($error['code'], ['SOLE_ADMIN', 'OWNER_CANNOT_LEAVE'], true)) {
                    $httpStatus = 409;
                    break;
                }
                if ($error['code'] === 'BANNED') {
                    $httpStatus = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $httpStatus);
        }

        return $this->respondWithData([
            'status' => 'none',
            'action' => $result['action'],
        ]);
    }

    // ================================================================
    // MEMBERS
    // ================================================================

    /**
     * GET /api/v2/groups/{id}/members
     */
    public function members($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $group = $this->groupService->getById($id, $userId, true);
        if (!$group) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        // A group roster reveals a membership relationship. Login alone is not
        // enough: only an active member, the group owner, or an admin may list it.
        $canViewRoster = (int) ($group['owner_id'] ?? 0) === $userId
            || $this->groupService->isActiveMember($id, $userId)
            || $this->callerIsAdminTier();
        if (!$canViewRoster) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
            'viewer_user_id' => $userId,
        ];

        if ($this->query('role')) {
            $filters['role'] = $this->query('role');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('q') !== null) {
            $filters['q'] = $this->query('q');
        }

        $result = $this->groupService->getMembers($id, $filters);
        if ($result === null) {
            return $this->respondWithErrors($this->groupService->getErrors(), 422);
        }

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * PUT /api/v2/groups/{id}/members/{userId}
     */
    public function updateMember($id, $targetUserId): JsonResponse
    {
        $id = (int) $id;
        $targetUserId = (int) $targetUserId;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_member_update', 30, 60);

        $role = $this->input('role');

        if (empty($role)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.role_required'), 'role', 400);
        }

        $success = $this->groupService->updateMemberRole($id, $targetUserId, $userId, $role);

        if (!$success) {
            $errors = $this->groupService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_MEMBER') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData([
            'user_id' => $targetUserId,
            'role'    => $role,
        ]);
    }

    /**
     * DELETE /api/v2/groups/{id}/members/{userId}
     */
    public function removeMember($id, $targetUserId): JsonResponse
    {
        $id = (int) $id;
        $targetUserId = (int) $targetUserId;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_member_remove', 20, 60);

        $success = $this->groupService->removeMember($id, $targetUserId, $userId);

        if (!$success) {
            $errors = $this->groupService->getErrors();
            $status = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
                if ($error['code'] === 'NOT_MEMBER') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'VALIDATION_ERROR') {
                    $status = 409;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->noContent();
    }

    // ================================================================
    // JOIN REQUESTS
    // ================================================================

    /**
     * GET /api/v2/groups/{id}/requests
     */
    public function pendingRequests($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $requests = $this->groupService->getPendingRequests($id, $userId);

        if ($requests === null) {
            $errors = $this->groupService->getErrors();
            $status = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($requests);
    }

    /**
     * POST /api/v2/groups/{id}/requests/{userId}
     */
    public function handleRequest($id, $requesterId): JsonResponse
    {
        $id = (int) $id;
        $requesterId = (int) $requesterId;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_handle_request', 30, 60);

        $action = $this->input('action');

        if (empty($action)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.action_required'), 'action', 400);
        }

        try {
            $success = $this->groupService->handleJoinRequest($id, $requesterId, $userId, $action);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            $errors = $this->groupService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
                if (in_array($error['code'], ['CAPACITY_FULL', 'MEMBERSHIP_LIMIT_REACHED', 'GROUP_UNAVAILABLE'], true)) {
                    $status = 409;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        // Notify requester
        try {
            if ($action === 'accept') {
                $this->groupNotificationService->notifyJoined($id, $requesterId);
            } else {
                $this->groupNotificationService->notifyJoinRejected($id, $requesterId);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Group request notification error: " . $e->getMessage());
        }

        // Award XP to the requester when their join request is accepted
        if ($action === 'accept') {
            try {
                \App\Services\GamificationService::awardXP($requesterId, \App\Services\GamificationService::XP_VALUES['join_group'], 'join_group', __('api.group_joined'));
            } catch (\Throwable $e) {
                \Log::warning('Gamification XP award failed', ['action' => 'join_group', 'user' => $requesterId, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData([
            'user_id' => $requesterId,
            'action'  => $action,
            'result'  => $action === 'accept' ? 'approved' : 'rejected',
        ]);
    }

    // ================================================================
    // DISCUSSIONS
    // ================================================================

    /**
     * GET /api/v2/groups/{id}/discussions
     */
    public function discussions($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->groupService->getDiscussions($id, $userId, $filters);

        if ($result === null) {
            return $this->discussionErrorResponse(400);
        }

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * POST /api/v2/groups/{id}/discussions
     */
    public function createDiscussion($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit("groups_create_discussion_{$id}", 10, 60);

        $data = $this->getAllInput();
        $data['idempotency_key'] = request()->header('Idempotency-Key') ?? ($data['idempotency_key'] ?? null);

        try {
            $discussion = $this->groupService->createDiscussion($id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($discussion === null) {
            return $this->discussionErrorResponse(422);
        }

        $replayed = (bool) ($discussion['_idempotent_replay'] ?? false);
        unset($discussion['_idempotent_replay']);
        if (! $replayed) {
            // Notify group members only for the committed creation, never for a replay.
            try {
                $discussionTitle = $discussion['title'] ?? $data['title'] ?? __('api.group_new_discussion_fallback');
                $discussionId = $discussion['id'] ?? 0;
                $this->groupNotificationService->notifyNewDiscussion($id, $discussionId, $userId, $discussionTitle);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("Group discussion notification error: " . $e->getMessage());
            }
        }

        return $this->respondWithData($discussion, null, 201);
    }

    /**
     * GET /api/v2/groups/{id}/discussions/{discussionId}
     */
    public function discussionMessages($id, $discussionId): JsonResponse
    {
        $id = (int) $id;
        $discussionId = (int) $discussionId;
        $userId = $this->requireAuth();

        $filters = [
            'limit' => $this->queryInt('per_page', 50, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->groupService->getDiscussionMessages($id, $discussionId, $userId, $filters);

        if ($result === null) {
            return $this->discussionErrorResponse(400);
        }

        return $this->respondWithData([
            'discussion' => $result['discussion'],
            'messages'   => $result['items'],
        ], [
            'cursor'   => $result['cursor'],
            'per_page' => $filters['limit'],
            'has_more' => $result['has_more'],
        ]);
    }

    /**
     * POST /api/v2/groups/{id}/discussions/{discussionId}/messages
     */
    public function postToDiscussion($id, $discussionId): JsonResponse
    {
        $id = (int) $id;
        $discussionId = (int) $discussionId;
        $userId = $this->requireAuth();
        $this->rateLimit("groups_post_to_discussion_{$id}", 30, 60);

        $data = $this->getAllInput();

        try {
            $message = $this->groupService->postToDiscussion($id, $discussionId, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($message === null) {
            return $this->discussionErrorResponse(422);
        }

        return $this->respondWithData($message, null, 201);
    }

    private function discussionErrorResponse(int $fallbackStatus): JsonResponse
    {
        $errors = $this->groupService->getErrors();
        $status = match ($errors[0]['code'] ?? '') {
            'NOT_FOUND' => 404,
            'FORBIDDEN' => 403,
            'DISCUSSION_LOCKED' => 409,
            'IDEMPOTENCY_CONFLICT' => 409,
            'INVALID_CURSOR', 'VALIDATION_ERROR', 'IDEMPOTENCY_INVALID' => 422,
            default => $fallbackStatus,
        };

        return $this->respondWithErrors($errors, $status);
    }

    // ================================================================
    // ANNOUNCEMENTS
    // ================================================================

    /**
     * GET /api/v2/groups/{id}/announcements
     */
    public function announcements($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $filters = [
            'cursor'          => $this->query('cursor'),
            'limit'           => $this->queryInt('limit', 20, 1, 100),
            'include_expired' => $this->queryBool('include_expired'),
            'pinned'          => $this->queryBool('pinned'),
        ];

        $result = $this->groupAnnouncementService->list($id, $userId, $filters);

        if ($result === null) {
            $errors = $this->groupAnnouncementService->getErrors();
            $status = $this->resolveErrorStatus($errors);
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($result);
    }

    /**
     * POST /api/v2/groups/{id}/announcements
     */
    public function createAnnouncement($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $data = $this->getAllInput();
        $data['idempotency_key'] = request()->header('Idempotency-Key') ?? ($data['idempotency_key'] ?? null);

        try {
            $result = $this->groupAnnouncementService->create($id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($result === null) {
            $errors = $this->groupAnnouncementService->getErrors();
            $status = $this->resolveErrorStatus($errors);
            return $this->respondWithErrors($errors, $status);
        }

        $replayed = (bool) ($result['_idempotent_replay'] ?? false);
        unset($result['_idempotent_replay']);
        if (! $replayed) {
            // Notify group members only for the committed creation, never for a replay.
            try {
                $announcementTitle = $result['title'] ?? $data['title'] ?? __('api.group_new_announcement_fallback');
                $this->groupNotificationService->notifyNewAnnouncement($id, $userId, $announcementTitle);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("Group announcement notification error: " . $e->getMessage());
            }
        }

        return $this->respondWithData($result, null, 201);
    }

    /**
     * PUT /api/v2/groups/{id}/announcements/{announcementId}
     */
    public function updateAnnouncement($id, $announcementId): JsonResponse
    {
        $id = (int) $id;
        $announcementId = (int) $announcementId;
        $userId = $this->requireAuth();
        $data = $this->getAllInput();

        try {
            $result = $this->groupAnnouncementService->update($id, $announcementId, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($result === null) {
            $errors = $this->groupAnnouncementService->getErrors();
            $status = $this->resolveErrorStatus($errors);
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($result);
    }

    /**
     * DELETE /api/v2/groups/{id}/announcements/{announcementId}
     */
    public function deleteAnnouncement($id, $announcementId): JsonResponse
    {
        $id = (int) $id;
        $announcementId = (int) $announcementId;
        $userId = $this->requireAuth();

        $success = $this->groupAnnouncementService->delete($id, $announcementId, $userId);

        if (!$success) {
            $errors = $this->groupAnnouncementService->getErrors();
            $status = $this->resolveErrorStatus($errors);
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData(['deleted' => true]);
    }

    // ================================================================
    // IMAGE UPLOAD
    // ================================================================

    /**
     * POST /api/v2/groups/{id}/image
     *
     * Upload an image for a group (avatar or cover). Uses request()->file() (Laravel native).
     * Field name: 'image'. Query param 'type' = 'avatar' (default) or 'cover'.
     */
    public function uploadImage($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_image_upload', 10, 60);

        if (! $this->groupService->getById($id, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }
        if (! $this->groupService->canModify($id, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_modify_forbidden'), null, 403);
        }

        $file = request()->file('image');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_image_uploaded'), 'image', 400);
        }

        $imageType = $this->query('type', 'avatar');
        if (!in_array($imageType, ['avatar', 'cover'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_type_invalid'), 'type', 422);
        }

        $extension = strtolower($file->getClientOriginalExtension());
        $mime = (string) $file->getMimeType();
        $allowed = [
            'image/jpeg' => ['jpg', 'jpeg'],
            'image/png' => ['png'],
            'image/gif' => ['gif'],
            'image/webp' => ['webp'],
        ];
        $realPath = $file->getRealPath();
        $dimensions = is_string($realPath) ? @getimagesize($realPath) : false;
        $pixelCount = $dimensions === false ? 0 : (int) $dimensions[0] * (int) $dimensions[1];
        if (! isset($allowed[$mime]) || ! in_array($extension, $allowed[$mime], true) || $dimensions === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_invalid'), 'image', 422);
        }
        if ((int) $file->getSize() < 1 || (int) $file->getSize() > 8 * 1024 * 1024) {
            return $this->respondWithError('FILE_TOO_LARGE', __('api.group_image_size_exceeded'), 'image', 413);
        }
        if ($pixelCount < 1 || $pixelCount > 25_000_000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_dimensions_invalid'), 'image', 422);
        }

        $imageUrl = null;
        try {
            // Build a $_FILES-compatible array for ImageUploader::upload()
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            $imageUrl = \App\Core\ImageUploader::upload($fileArray, 'groups');
            if ($imageUrl === null) {
                return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'image', 500);
            }

            $replacement = $this->groupService->replaceImage($id, $userId, $imageUrl, $imageType);

            if ($replacement === null) {
                \App\Core\ImageUploader::deleteTenantUpload($imageUrl, 'groups');
                $errors = $this->groupService->getErrors();
                $status = 400;
                foreach ($errors as $error) {
                    if ($error['code'] === 'NOT_FOUND') {
                        $status = 404;
                        break;
                    }
                    if ($error['code'] === 'FORBIDDEN') {
                        $status = 403;
                        break;
                    }
                }
                return $this->respondWithErrors($errors, $status);
            }

            $previousUrl = $replacement['previous_url'];
            if ($previousUrl !== null && $previousUrl !== $imageUrl
                && ! $this->deleteReplacedGroupImage($previousUrl)) {
                \Log::warning('Group image replacement committed but legacy file cleanup was not possible', [
                    'group_id' => $id,
                    'type' => $imageType,
                    'previous_url' => $previousUrl,
                ]);
            }

            return $this->respondWithData(['image_url' => $imageUrl, 'type' => $imageType]);
        } catch (\Exception $e) {
            if (is_string($imageUrl)) {
                \App\Core\ImageUploader::deleteTenantUpload($imageUrl, 'groups');
            }
            \Log::error('Group image upload failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'image', 500);
        }
    }

    /** DELETE /api/v2/groups/{id}/image?type=avatar|cover */
    public function removeImage($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('groups_image_remove', 10, 60);
        $imageType = $this->query('type', 'avatar');
        if (! in_array($imageType, ['avatar', 'cover'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_type_invalid'), 'type', 422);
        }

        $replacement = $this->groupService->replaceImage($id, $userId, null, $imageType);
        if ($replacement === null) {
            $errors = $this->groupService->getErrors();
            return $this->respondWithErrors($errors, $this->resolveErrorStatus($errors));
        }

        $previousUrl = $replacement['previous_url'];
        if ($previousUrl !== null && ! $this->deleteReplacedGroupImage($previousUrl)) {
            \Log::warning('Group image removal committed but legacy file cleanup was not possible', [
                'group_id' => $id,
                'type' => $imageType,
                'previous_url' => $previousUrl,
            ]);
        }

        return $this->respondWithData(['image_url' => null, 'type' => $imageType]);
    }

    // ================================================================
    // HELPERS
    // ================================================================

    private function storeGroupImageFile(UploadedFile $file, string $type): string|JsonResponse
    {
        if (! $file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_image_uploaded'), $type, 422);
        }

        $extension = strtolower($file->getClientOriginalExtension());
        $mime = (string) $file->getMimeType();
        $allowed = [
            'image/jpeg' => ['jpg', 'jpeg'],
            'image/png' => ['png'],
            'image/gif' => ['gif'],
            'image/webp' => ['webp'],
        ];
        if ((int) $file->getSize() < 1 || (int) $file->getSize() > 8 * 1024 * 1024) {
            return $this->respondWithError('FILE_TOO_LARGE', __('api.group_image_size_exceeded'), $type, 413);
        }
        $realPath = $file->getRealPath();
        $dimensions = is_string($realPath) ? @getimagesize($realPath) : false;
        $pixelCount = $dimensions === false ? 0 : (int) $dimensions[0] * (int) $dimensions[1];
        if (! isset($allowed[$mime]) || ! in_array($extension, $allowed[$mime], true) || $dimensions === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_invalid'), $type, 422);
        }
        if ($pixelCount < 1 || $pixelCount > 25_000_000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_image_dimensions_invalid'), $type, 422);
        }

        try {
            $fileArray = [
                'name' => $file->getClientOriginalName(),
                'type' => $mime,
                'tmp_name' => $realPath,
                'error' => UPLOAD_ERR_OK,
                'size' => $file->getSize(),
            ];
            $url = \App\Core\ImageUploader::upload($fileArray, 'groups');
            return is_string($url) && $url !== ''
                ? $url
                : $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), $type, 500);
        } catch (\Throwable $exception) {
            \Log::error('Staged group image upload failed', [
                'type' => $type,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), $type, 500);
        }
    }

    /** @param list<string> $urls */
    /**
     * Delete a group image that a committed change replaced or removed, unless
     * another group row (or the other slot of this group) still references the
     * same path. Legacy rows may share a path that was once client-supplied,
     * so unlinking it blindly would delete another group's picture (F-094).
     */
    private function deleteReplacedGroupImage(string $url): bool
    {
        $stillReferenced = \App\Models\Group::query()
            ->where(static function ($query) use ($url): void {
                $query->where('image_url', $url)->orWhere('cover_image_url', $url);
            })
            ->exists();
        if ($stillReferenced) {
            return true;
        }

        return \App\Core\ImageUploader::deleteTenantUpload($url, 'groups');
    }

    private function cleanupStagedGroupImages(array $urls): void
    {
        foreach ($urls as $url) {
            if (! \App\Core\ImageUploader::deleteTenantUpload($url, 'groups')) {
                \Log::warning('Failed to compensate staged group image', ['url' => $url]);
            }
        }
    }

    private function resolveErrorStatus(array $errors): int
    {
        foreach ($errors as $error) {
            $status = match ($error['code'] ?? '') {
                'NOT_FOUND' => 404,
                'FORBIDDEN' => 403,
                'IDEMPOTENCY_CONFLICT' => 409,
                'INVALID_CURSOR', 'VALIDATION', 'VALIDATION_ERROR', 'IDEMPOTENCY_INVALID' => 422,
                default => null,
            };

            if ($status !== null) {
                return $status;
            }
        }
        return 400;
    }
}
