<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\Poll;
use App\Models\User;
use App\Services\PollService;
use App\Services\PollRankingService;
use App\Services\PollExportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use App\Support\UserDisplayName;

/**
 * PollsController — Eloquent-powered community polls with voting support.
 *
 * Fully migrated from legacy delegation to Eloquent via PollService.
 */
class PollsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly PollService $pollService,
        private readonly PollRankingService $rankingService,
        private readonly PollExportService $exportService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/polls
    // -----------------------------------------------------------------

    public function index(): JsonResponse
    {
        $userId = $this->getUserId();

        $filters = [
            'status' => $this->query('status', 'open'),
            'limit'  => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('user_id')) {
            $filters['user_id'] = $this->queryInt('user_id');
        }
        if ($this->query('mine') === '1') {
            $filters['user_id'] = $userId;
        }
        if ($this->query('category')) {
            $filters['category'] = $this->query('category');
        }
        if ($this->query('event_id')) {
            $filters['event_id'] = $this->queryInt('event_id');
        }

        $result = $this->pollService->getAll($filters);

        // Enrich with has_voted
        $items = array_map(function (array $poll) use ($userId) {
            if (! isset($poll['has_voted'])) {
                $enriched = $this->pollService->getById((int) $poll['id'], $userId);
                return $enriched ?? $poll;
            }
            return $poll;
        }, $result['items']);

        return $this->respondWithCollection($items, $result['cursor'], $filters['limit'], $result['has_more']);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/polls/{id}
    // -----------------------------------------------------------------

    public function show(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $poll = $this->pollService->getById($id, $userId);

        if (! $poll) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found'), null, 404);
        }

        return $this->respondWithData($poll);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/polls
    // -----------------------------------------------------------------

    public function store(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('poll_create', 5, 60);

        $data = $this->getAllInput();

        if (empty(trim($data['question'] ?? ''))) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.social_question_required'), 'question', 400);
        }

        if (empty($data['options']) || ! is_array($data['options']) || count($data['options']) < 2) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.social_min_2_options'), 'options', 400);
        }

        if (count($data['options']) > 20) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.too_many_poll_options'), 'options', 422);
        }

        $poll = $this->pollService->create($userId, $data);
        $result = $this->pollService->getById($poll->id, $userId);

        // Record feed activity
        try {
            app(\App\Services\FeedActivityService::class)->recordActivity(
                \App\Core\TenantContext::getId(),
                $userId,
                'poll',
                $poll->id,
                [
                    'title'    => $data['question'] ?? null,
                    'group_id' => $data['group_id'] ?? null,
                ]
            );
        } catch (\Throwable $e) {
            \Log::warning('Feed activity recording failed', ['type' => 'poll', 'id' => $poll->id, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($result, null, 201);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/polls/{id}
    // -----------------------------------------------------------------

    public function update(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('poll_update', 10, 60);

        $poll = $this->pollService->update($id, $userId, $this->getAllInput());

        if (! $poll) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found_or_not_owned'), null, 404);
        }

        $result = $this->pollService->getById($id, $userId);

        return $this->respondWithData($result);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/polls/{id}
    // -----------------------------------------------------------------

    public function destroy(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('poll_delete', 5, 60);

        $deleted = $this->pollService->delete($id, $userId);

        if (! $deleted) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found_or_not_owned'), null, 404);
        }

        return $this->noContent();
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/polls/{id}/vote
    // -----------------------------------------------------------------

    public function vote(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('poll_vote', 20, 60);

        $optionId = $this->input('option_id');

        if (empty($optionId)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.social_option_id_required'), 'option_id', 400);
        }

        try {
            $success = $this->pollService->vote($id, (int) $optionId, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (! $success) {
            return $this->respondWithError('RESOURCE_CONFLICT', __('api.poll_already_voted'), null, 409);
        }

        // Award XP for voting on a poll
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['vote_poll'], 'vote_poll', 'Voted on a poll');
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'vote_poll', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        // Notify poll creator of the vote
        try {
            $pollModel = Poll::find($id);
            if (!$pollModel || (int) $pollModel->tenant_id !== TenantContext::getId()) {
                throw new \RuntimeException(__('api.tenant_mismatch_error'));
            }
            if ($pollModel && (int) $pollModel->user_id !== $userId) {
                $voter = User::find($userId);
                $recipient = User::find((int) $pollModel->user_id);
                LocaleContext::withLocale($recipient, function () use ($voter, $pollModel, $id) {
                    $voterName = $voter ? UserDisplayName::resolve($voter) : __('emails.common.fallback_someone');
                    $pollTitle = $pollModel->question ?? 'your poll';
                    $message = __('api_controllers_3.polls.vote_received', ['name' => $voterName, 'title' => $pollTitle]);
                    Notification::createNotification((int) $pollModel->user_id, $message, "/polls/{$id}", 'poll_vote');
                    \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $pollModel->user_id), 'poll_vote', $message, "/polls/{$id}");
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Poll vote notification failed', ['poll' => $id, 'voter' => $userId, 'error' => $e->getMessage()]);
        }

        $poll = $this->pollService->getById($id, $userId);

        return $this->respondWithData($poll);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/polls/{id}/rank
    // -----------------------------------------------------------------

    public function rank(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('poll_rank', 20, 60);

        $rankings = $this->input('rankings');

        if (empty($rankings) || ! is_array($rankings)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.poll_rankings_required'), 'rankings', 400);
        }

        try {
            $success = $this->rankingService->submitRanking($id, $userId, $rankings);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (! $success) {
            return $this->respondWithError('RESOURCE_CONFLICT', __('api.poll_already_ranked'), null, 409);
        }

        // Notify poll creator of ranking submission
        try {
            $pollModel = Poll::find($id);
            if ($pollModel && (int) $pollModel->user_id !== $userId) {
                $ranker = User::find($userId);
                $recipient = User::find((int) $pollModel->user_id);
                LocaleContext::withLocale($recipient, function () use ($ranker, $pollModel, $id) {
                    $rankerName = $ranker ? UserDisplayName::resolve($ranker) : __('emails.common.fallback_someone');
                    $pollTitle = $pollModel->question ?? 'your poll';
                    $message = __('api_controllers_3.polls.ranking_received', ['name' => $rankerName, 'title' => $pollTitle]);
                    Notification::createNotification((int) $pollModel->user_id, $message, "/polls/{$id}", 'poll_vote');
                    \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $pollModel->user_id), 'poll_vote', $message, "/polls/{$id}");
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Poll ranking notification failed', ['poll' => $id, 'ranker' => $userId, 'error' => $e->getMessage()]);
        }

        $results = $this->rankingService->calculateResults($id);
        $poll = $this->pollService->getById($id, $userId);

        return $this->respondWithData([
            'poll'           => $poll,
            'ranked_results' => $results,
        ]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/polls/{id}/ranked-results
    // -----------------------------------------------------------------

    public function rankedResults(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $poll = $this->pollService->getById($id, $userId);
        if (! $poll) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found'), null, 404);
        }

        if (($poll['poll_type'] ?? 'standard') !== 'ranked') {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.poll_not_ranked_choice'), null, 400);
        }

        $results = $this->rankingService->calculateResults($id);
        $userRankings = $this->rankingService->getUserRankings($id, $userId);

        return $this->respondWithData([
            'poll'           => $poll,
            'ranked_results' => $results,
            'my_rankings'    => $userRankings,
        ]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/polls/{id}/export
    // -----------------------------------------------------------------

    public function export(int $id): JsonResponse|Response
    {
        $userId = $this->getUserId();
        $this->rateLimit('poll_export', 10, 60);

        $csv = $this->exportService->exportToCsv($id, $userId);

        if ($csv === null) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found_or_unauthorized'), null, 404);
        }

        return response($csv, 200, [
            'Content-Type'        => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="poll-' . $id . '-export.csv"',
        ]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/polls/categories
    // -----------------------------------------------------------------

    public function categories(): JsonResponse
    {
        $this->getUserId();

        $categories = $this->pollService->getCategories();

        return $this->respondWithData($categories);
    }
}
