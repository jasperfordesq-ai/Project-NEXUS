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
use App\Services\PollCreationReceiptService;
use App\Services\PollRankingService;
use App\Services\PollExportService;
use App\Support\FeedItemTables;
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
            // F-069: leave out polls posted into groups this member cannot see.
            'viewer_id' => $userId,
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

        // Enrich with has_voted. getById() applies the group visibility gate, so
        // a poll it refuses is dropped rather than returned un-enriched (F-069).
        $items = array_values(array_filter(array_map(function (array $poll) use ($userId) {
            if (! isset($poll['has_voted'])) {
                return $this->pollService->getById((int) $poll['id'], $userId);
            }
            return $poll;
        }, $result['items'])));

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
        $identity = $this->pollCreationIdentity($data);
        if ($identity === false) {
            return $this->respondWithError('VALIDATION_FAILED', __('api.invalid_input'), 'idempotency_key', 422);
        }

        if (empty(trim($data['question'] ?? ''))) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.social_question_required'), 'question', 400);
        }

        if (empty($data['options']) || ! is_array($data['options'])) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.social_min_2_options'), 'options', 400);
        }

        $data['options'] = array_values(array_map(static fn ($option): string => trim((string) $option), $data['options']));
        if (count($data['options']) < 2 || in_array('', $data['options'], true)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.social_min_2_options'), 'options', 400);
        }

        if (count($data['options']) > 20) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.too_many_poll_options'), 'options', 422);
        }

        $data['poll_type'] = $data['poll_type'] ?? 'standard';
        if (!in_array($data['poll_type'], ['standard', 'ranked'], true)) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.invalid_input'), 'poll_type', 422);
        }
        $data['is_anonymous'] = filter_var($data['is_anonymous'] ?? false, FILTER_VALIDATE_BOOL);

        // F-069: a poll may only be posted into a group the author can post in.
        // The group_id went straight onto the feed row, so a non-member could
        // drop a poll into a private group's feed.
        $groupId = ! empty($data['group_id']) ? (int) $data['group_id'] : null;
        if ($groupId !== null && ! FeedItemTables::canPostInGroup($groupId, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.social_group_membership_required'), 'group_id', 403);
        }

        try {
            $creation = $identity === null
                ? ['poll' => $this->pollService->create($userId, $data), 'replayed' => false]
                : PollCreationReceiptService::create($userId, $identity, fn () => $this->pollService->create($userId, $data));
            $poll = $creation['poll'];
        } catch (\InvalidArgumentException $e) {
            $field = str_contains($e->getMessage(), 'Idempotency') ? 'idempotency_key' : 'expires_at';
            $status = $field === 'idempotency_key' ? 409 : 422;
            return $this->respondWithError($status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION_INVALID_VALUE', __('api.invalid_input'), $field, $status);
        } catch (\DomainException) {
            return $this->respondWithError('IDEMPOTENCY_RESULT_GONE', __('api.invalid_input'), 'idempotency_key', 409);
        }
        $result = $this->pollService->getById($poll->id, $userId);

        // Record feed activity
        if (!$creation['replayed']) {
            try {
                app(\App\Services\FeedActivityService::class)->recordActivity(
                    \App\Core\TenantContext::getId(),
                    $userId,
                    'poll',
                    $poll->id,
                    [
                        'title'    => $data['question'] ?? null,
                        'group_id' => $groupId,
                    ]
                );
            } catch (\Throwable $e) {
                \Log::warning('Feed activity recording failed', ['type' => 'poll', 'id' => $poll->id, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData($result, null, $creation['replayed'] ? 200 : 201);
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

        // Resolve the poll inside this community before voting. PollService::vote()
        // is correctly scoped and throws RuntimeException('Poll not found') for a
        // poll belonging elsewhere, but only SafeguardingPolicyException is caught
        // here — so a foreign id produced a 500 instead of a not-found. Same shape
        // as the giving-days and event-RSVP fixes earlier today; found by the
        // valid-body pass of CrossCommunityAccessSweepTest, 2026-09-10.
        if ($this->pollService->getById($id, $userId) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Poll']), null, 404);
        }

        try {
            $success = $this->pollService->vote($id, (int) $optionId, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\InvalidArgumentException $e) {
            // The option is not one of THIS poll's options. The service throws;
            // uncaught, that was a 500 carrying the exception class and file path
            // under debug. Found by SameCommunityAccessSweepTest, 2026-09-11.
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.invalid_input'), 'option_id', 422);
        } catch (\App\Exceptions\PollClosedException $e) {
            // Same finding, second path: voting after the end date was a 500 too.
            return $this->respondWithError('RESOURCE_CONFLICT', __('api.invalid_input'), null, 409);
        }

        if (! $success) {
            $poll = $this->pollService->getById($id, $userId);
            if ((int) ($poll['user_vote_option_id'] ?? 0) !== (int) $optionId) {
                return $this->respondWithError('RESOURCE_CONFLICT', __('api.poll_already_voted'), null, 409);
            }
            $poll['idempotent_replay'] = true;
            return $this->respondWithData($poll);
        }

        // Notify poll creator of the vote
        try {
            $pollModel = Poll::find($id);
            if (!$pollModel || (int) $pollModel->tenant_id !== TenantContext::getId()) {
                throw new \RuntimeException(__('api.tenant_mismatch_error'));
            }
            if ($pollModel && !$pollModel->is_anonymous && (int) $pollModel->user_id !== $userId) {
                $voter = User::find($userId);
                $recipient = User::find((int) $pollModel->user_id);
                LocaleContext::withLocale($recipient, function () use ($voter, $pollModel, $id) {
                    $voterName = $voter ? UserDisplayName::resolve($voter) : __('emails.common.fallback_someone');
                    $pollTitle = (string) $pollModel->question;
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

        if ($this->pollService->getById($id, $userId) === null) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found'), null, 404);
        }

        try {
            // F-158: a ranked ballot notifies the poll's creator, so it obeys
            // the block rule as well as the safeguarding contact rule applied
            // inside the ranking service.
            $pollOwnerId = (int) \Illuminate\Support\Facades\DB::table('polls')
                ->where('id', $id)
                ->where('tenant_id', TenantContext::getId())
                ->value('user_id');
            if ($pollOwnerId > 0 && $pollOwnerId !== $userId) {
                \App\Services\BlockUserService::assertNoBlockBetween($userId, $pollOwnerId);
            }

            $submission = $this->rankingService->submitRankingWithResult($id, $userId, $rankings);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (! $submission['accepted']) {
            return $this->respondWithError('RESOURCE_CONFLICT', __('api.poll_already_ranked'), null, 409);
        }

        // Notify poll creator of ranking submission
        if (!$submission['replayed']) {
            try {
                $pollModel = Poll::find($id);
                if ($pollModel && !$pollModel->is_anonymous && (int) $pollModel->user_id !== $userId) {
                    $ranker = User::find($userId);
                    $recipient = User::find((int) $pollModel->user_id);
                    LocaleContext::withLocale($recipient, function () use ($ranker, $pollModel, $id) {
                        $rankerName = $ranker ? UserDisplayName::resolve($ranker) : __('emails.common.fallback_someone');
                        $pollTitle = (string) $pollModel->question;
                        $message = __('api_controllers_3.polls.ranking_received', ['name' => $rankerName, 'title' => $pollTitle]);
                        Notification::createNotification((int) $pollModel->user_id, $message, "/polls/{$id}", 'poll_vote');
                        \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $pollModel->user_id), 'poll_vote', $message, "/polls/{$id}");
                    });
                }
            } catch (\Throwable $e) {
                \Log::warning('Poll ranking notification failed', ['poll' => $id, 'ranker' => $userId, 'error' => $e->getMessage()]);
            }
        }

        $poll = $this->pollService->getById($id, $userId);
        $resultsVisible = (bool) ($poll['results_visible'] ?? false);
        $results = $resultsVisible ? $this->rankingService->calculateResults($id) : null;

        return $this->respondWithData([
            'poll'           => $poll,
            'ranked_results' => $results,
            'results_visible' => $resultsVisible,
            'idempotent_replay' => $submission['replayed'],
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

        $resultsVisible = (bool) ($poll['results_visible'] ?? false);
        $results = $resultsVisible ? $this->rankingService->calculateResults($id) : null;
        $userRankings = $this->rankingService->getUserRankings($id, $userId);

        return $this->respondWithData([
            'poll'           => $poll,
            'ranked_results' => $results,
            'my_rankings'    => $userRankings,
            'results_visible' => $resultsVisible,
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

    /** @return array{key_hash:string,request_hash:string}|null|false */
    private function pollCreationIdentity(array $intent): array|null|false
    {
        $header = request()->header('Idempotency-Key');
        $body = $intent['idempotency_key'] ?? request()->input('idempotency_key');
        if ($header !== null && $body !== null && !hash_equals(trim((string) $header), trim((string) $body))) {
            return false;
        }
        unset($intent['idempotency_key']);
        return PollCreationReceiptService::identity($header ?? $body, $intent);
    }
}
