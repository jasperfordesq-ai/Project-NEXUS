<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Support\CursorSigner;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Tenant- and lifecycle-safe Q&A collaboration for groups.
 */
final class GroupQAService
{
    /** @var list<array{code: string, message: string}> */
    private array $errors = [];

    /** @return list<array{code: string, message: string}> */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * @param array{limit?: int, sort?: string, cursor?: mixed, search?: string|null} $filters
     * @return array{items: list<array<string, mixed>>, cursor: string|null, has_more: bool}|null
     */
    public function listQuestions(int $groupId, int $userId, array $filters = []): ?array
    {
        $this->errors = [];
        if (! $this->requireMemberContent($groupId, $userId)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $sort = match ((string) ($filters['sort'] ?? 'newest')) {
            'votes', 'most_voted' => 'most_voted',
            'unanswered' => 'unanswered',
            default => 'newest',
        };

        $query = DB::table('group_questions as gq')
            ->leftJoin('users as u', static function ($join) use ($tenantId): void {
                $join->on('gq.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->leftJoin('group_qa_votes as viewer_vote', static function ($join) use ($tenantId, $userId): void {
                $join->on('viewer_vote.votable_id', '=', 'gq.id')
                    ->where('viewer_vote.tenant_id', '=', $tenantId)
                    ->where('viewer_vote.user_id', '=', $userId)
                    ->where('viewer_vote.votable_type', '=', 'question');
            })
            ->where('gq.group_id', $groupId)
            ->where('gq.tenant_id', $tenantId)
            ->select(
                'gq.id',
                'gq.group_id',
                'gq.title',
                'gq.body',
                'gq.accepted_answer_id',
                'gq.is_closed',
                'gq.view_count',
                'gq.vote_count',
                'gq.answer_count',
                'gq.created_at',
                'gq.updated_at',
                'u.id as author_id',
                'u.name as author_name',
                'u.avatar_url as author_avatar',
                DB::raw('COALESCE(viewer_vote.vote, 0) as user_vote'),
            );

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $escaped = addcslashes($search, '\\%_');
            $query->where('gq.title', 'LIKE', '%' . $escaped . '%');
        }

        if ($sort === 'unanswered') {
            $query->where('gq.answer_count', 0);
        }

        $rawCursor = $filters['cursor'] ?? null;
        $cursor = $this->decodeCursor($rawCursor, $sort, $groupId);
        if ($rawCursor !== null && $rawCursor !== '' && $cursor === null) {
            $this->errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
            return null;
        }
        $this->applyCursor($query, $sort, $cursor);
        $this->applyOrdering($query, $sort);

        $questions = $query->limit($limit + 1)->get()->all();
        $hasMore = count($questions) > $limit;
        if ($hasMore) {
            array_pop($questions);
        }

        $nextCursor = null;
        if ($hasMore && $questions !== []) {
            $nextCursor = $this->encodeCursor($sort, $groupId, $questions[array_key_last($questions)]);
        }

        return [
            'items' => array_values(array_map(self::formatQuestion(...), $questions)),
            'cursor' => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /** @return array<string, mixed>|null */
    public function getQuestion(int $groupId, int $questionId, int $userId): ?array
    {
        $this->errors = [];
        if (! $this->requireMemberContent($groupId, $userId)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $question = DB::table('group_questions as gq')
            ->leftJoin('users as u', static function ($join) use ($tenantId): void {
                $join->on('gq.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->leftJoin('group_qa_votes as viewer_vote', static function ($join) use ($tenantId, $userId): void {
                $join->on('viewer_vote.votable_id', '=', 'gq.id')
                    ->where('viewer_vote.tenant_id', '=', $tenantId)
                    ->where('viewer_vote.user_id', '=', $userId)
                    ->where('viewer_vote.votable_type', '=', 'question');
            })
            ->where('gq.id', $questionId)
            ->where('gq.group_id', $groupId)
            ->where('gq.tenant_id', $tenantId)
            ->select(
                'gq.*',
                'u.id as author_id',
                'u.name as author_name',
                'u.avatar_url as author_avatar',
                DB::raw('COALESCE(viewer_vote.vote, 0) as user_vote'),
            )
            ->first();

        if ($question === null) {
            $this->addError('NOT_FOUND', __('api.group_qa_question_not_found'));
            return null;
        }

        DB::table('group_questions')
            ->where('id', $questionId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->increment('view_count');

        $answers = DB::table('group_answers as ga')
            ->leftJoin('users as u', static function ($join) use ($tenantId): void {
                $join->on('ga.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->leftJoin('group_qa_votes as viewer_vote', static function ($join) use ($tenantId, $userId): void {
                $join->on('viewer_vote.votable_id', '=', 'ga.id')
                    ->where('viewer_vote.tenant_id', '=', $tenantId)
                    ->where('viewer_vote.user_id', '=', $userId)
                    ->where('viewer_vote.votable_type', '=', 'answer');
            })
            ->where('ga.question_id', $questionId)
            ->where('ga.tenant_id', $tenantId)
            ->select(
                'ga.*',
                'u.id as author_id',
                'u.name as author_name',
                'u.avatar_url as author_avatar',
                DB::raw('COALESCE(viewer_vote.vote, 0) as user_vote'),
            )
            ->orderByDesc('ga.is_accepted')
            ->orderByDesc('ga.vote_count')
            ->orderBy('ga.created_at')
            ->orderBy('ga.id')
            ->get()
            ->map(self::formatAnswer(...))
            ->values()
            ->all();

        $result = self::formatQuestion($question);
        $result['view_count'] = ((int) $result['view_count']) + 1;
        $result['answers'] = $answers;

        return $result;
    }

    /** @return array{id: int, title: string, _idempotent_replay?: bool}|null */
    public function askQuestion(int $groupId, int $userId, string $title, ?string $body = null, ?string $idempotencyKey = null): ?array
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return null;
        }

        $title = trim($title);
        $body = trim((string) $body);
        if (! $this->validateQuestion($title, $body)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $identity = GroupContentCreationReceiptService::identity($idempotencyKey, [
            'body' => $body,
            'group_id' => $groupId,
            'title' => $title,
        ]);
        if ($identity === false) {
            $this->addError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'));
            return null;
        }

        return DB::transaction(function () use ($groupId, $userId, $tenantId, $title, $body, $identity): ?array {
            if ($identity !== null) {
                GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                $receipt = GroupContentCreationReceiptService::find($tenantId, $userId, 'question', $identity['key_hash']);
                if ($receipt !== null) {
                    if (! GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])) {
                        $this->addError('IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'));
                        return null;
                    }
                    $payload = GroupContentCreationReceiptService::payload($receipt);
                    if ($payload === null) {
                        $this->addError('SERVER_ERROR', __('api.generic_error'));
                        return null;
                    }
                    $payload['_idempotent_replay'] = true;
                    return $payload;
                }
            }

            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return null;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_question_create',
                $title . ' ' . $body,
            );

            $id = (int) DB::table('group_questions')->insertGetId([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'user_id' => $userId,
                'title' => $title,
                'body' => $body,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $result = ['id' => $id, 'title' => $title];
            if ($identity !== null) {
                GroupContentCreationReceiptService::store(
                    $tenantId,
                    $userId,
                    $groupId,
                    'question',
                    $identity,
                    $id,
                    $result,
                );
            }
            return $result;
        }, 3);
    }

    /** @return array{id: int, question_id: int, _idempotent_replay?: bool}|null */
    public function postAnswer(int $groupId, int $questionId, int $userId, string $body, ?string $idempotencyKey = null): ?array
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return null;
        }

        $body = trim($body);
        if (! $this->validateBody($body)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $identity = GroupContentCreationReceiptService::identity($idempotencyKey, [
            'body' => $body,
            'group_id' => $groupId,
            'question_id' => $questionId,
        ]);
        if ($identity === false) {
            $this->addError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'));
            return null;
        }

        return DB::transaction(function () use ($groupId, $questionId, $userId, $body, $tenantId, $identity): ?array {
            if ($identity !== null) {
                GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                $receipt = GroupContentCreationReceiptService::find($tenantId, $userId, 'answer', $identity['key_hash']);
                if ($receipt !== null) {
                    if (! GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])) {
                        $this->addError('IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'));
                        return null;
                    }
                    $payload = GroupContentCreationReceiptService::payload($receipt);
                    if ($payload === null) {
                        $this->addError('SERVER_ERROR', __('api.generic_error'));
                        return null;
                    }
                    $payload['_idempotent_replay'] = true;
                    return $payload;
                }
            }

            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return null;
            }

            $question = DB::table('group_questions')
                ->where('id', $questionId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($question === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_question_not_found'));
                return null;
            }
            if ((bool) $question->is_closed) {
                $this->addError('CLOSED', __('api.group_qa_question_closed'));
                return null;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_answer_create',
                $body,
                [(int) $question->user_id],
            );

            $answerId = (int) DB::table('group_answers')->insertGetId([
                'tenant_id' => $tenantId,
                'question_id' => $questionId,
                'user_id' => $userId,
                'body' => $body,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('group_questions')
                ->where('id', $questionId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->increment('answer_count');

            $result = ['id' => $answerId, 'question_id' => $questionId];
            if ($identity !== null) {
                GroupContentCreationReceiptService::store(
                    $tenantId,
                    $userId,
                    $groupId,
                    'answer',
                    $identity,
                    $answerId,
                    $result,
                );
            }
            return $result;
        }, 3);
    }

    /** @return array{id: int, title: string, body: string}|null */
    public function updateQuestion(
        int $groupId,
        int $questionId,
        int $userId,
        string $title,
        string $body,
    ): ?array {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return null;
        }

        $title = trim($title);
        $body = trim($body);
        if (! $this->validateQuestion($title, $body)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $questionId, $userId, $title, $body, $tenantId): ?array {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return null;
            }

            $question = DB::table('group_questions')
                ->where('id', $questionId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($question === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_question_not_found'));
                return null;
            }
            if (! $this->canModifyAuthoredContent($groupId, $userId, (int) $question->user_id)) {
                $this->addError('FORBIDDEN', __('api.forbidden'));
                return null;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_question_update',
                $title . ' ' . $body,
            );

            DB::table('group_questions')
                ->where('id', $questionId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'title' => $title,
                    'body' => $body,
                    'updated_at' => now(),
                ]);

            return ['id' => $questionId, 'title' => $title, 'body' => $body];
        });
    }

    public function deleteQuestion(int $groupId, int $questionId, int $userId): bool
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return false;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $questionId, $userId, $tenantId): bool {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return false;
            }

            $question = DB::table('group_questions')
                ->where('id', $questionId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($question === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_question_not_found'));
                return false;
            }
            if (! $this->canModifyAuthoredContent($groupId, $userId, (int) $question->user_id)) {
                $this->addError('FORBIDDEN', __('api.forbidden'));
                return false;
            }

            $answerIds = DB::table('group_answers')
                ->where('question_id', $questionId)
                ->where('tenant_id', $tenantId)
                ->pluck('id')
                ->map(static fn ($id): int => (int) $id)
                ->all();

            if ($answerIds !== []) {
                DB::table('group_qa_votes')
                    ->where('tenant_id', $tenantId)
                    ->where('votable_type', 'answer')
                    ->whereIn('votable_id', $answerIds)
                    ->delete();
            }
            DB::table('group_qa_votes')
                ->where('tenant_id', $tenantId)
                ->where('votable_type', 'question')
                ->where('votable_id', $questionId)
                ->delete();
            DB::table('group_answers')
                ->where('tenant_id', $tenantId)
                ->where('question_id', $questionId)
                ->delete();

            $deleted = DB::table('group_questions')
                ->where('id', $questionId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted !== 1) {
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_QA_QUESTION_DELETED,
                $groupId,
                $userId,
                [
                    'question_id' => $questionId,
                    'title' => (string) $question->title,
                    'target_user_id' => (int) $question->user_id,
                    'deleted_answer_count' => count($answerIds),
                ],
            );

            return true;
        });
    }

    /** @return array{id: int, question_id: int, body: string}|null */
    public function updateAnswer(
        int $groupId,
        int $answerId,
        int $userId,
        string $body,
    ): ?array {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return null;
        }

        $body = trim($body);
        if (! $this->validateBody($body)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $answerId, $userId, $body, $tenantId): ?array {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return null;
            }

            $identity = $this->findAnswerInGroup($groupId, $answerId, $tenantId);
            $answer = $identity === null
                ? null
                : $this->lockAnswer($answerId, (int) $identity->question_id, $tenantId);

            if ($answer === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_answer_not_found'));
                return null;
            }
            if (! $this->canModifyAuthoredContent($groupId, $userId, (int) $answer->user_id)) {
                $this->addError('FORBIDDEN', __('api.forbidden'));
                return null;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_answer_update',
                $body,
                [(int) $identity->question_user_id],
            );

            DB::table('group_answers')
                ->where('id', $answerId)
                ->where('tenant_id', $tenantId)
                ->where('question_id', (int) $answer->question_id)
                ->update(['body' => $body, 'updated_at' => now()]);

            return [
                'id' => $answerId,
                'question_id' => (int) $answer->question_id,
                'body' => $body,
            ];
        });
    }

    public function deleteAnswer(int $groupId, int $answerId, int $userId): bool
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return false;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $answerId, $userId, $tenantId): bool {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return false;
            }

            $identity = $this->findAnswerInGroup($groupId, $answerId, $tenantId);
            if ($identity === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_answer_not_found'));
                return false;
            }

            $question = DB::table('group_questions')
                ->where('id', (int) $identity->question_id)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            $answer = $question === null
                ? null
                : $this->lockAnswer($answerId, (int) $identity->question_id, $tenantId);

            if ($answer === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_answer_not_found'));
                return false;
            }
            if (! $this->canModifyAuthoredContent($groupId, $userId, (int) $answer->user_id)) {
                $this->addError('FORBIDDEN', __('api.forbidden'));
                return false;
            }

            DB::table('group_qa_votes')
                ->where('tenant_id', $tenantId)
                ->where('votable_type', 'answer')
                ->where('votable_id', $answerId)
                ->delete();
            $deleted = DB::table('group_answers')
                ->where('id', $answerId)
                ->where('tenant_id', $tenantId)
                ->where('question_id', (int) $answer->question_id)
                ->delete();
            if ($deleted !== 1) {
                return false;
            }
            DB::table('group_questions')
                ->where('id', (int) $answer->question_id)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'answer_count' => DB::raw('GREATEST(answer_count - 1, 0)'),
                    'accepted_answer_id' => (int) $question->accepted_answer_id === $answerId
                        ? null
                        : $question->accepted_answer_id,
                    'updated_at' => now(),
                ]);

            GroupAuditService::log(
                GroupAuditService::ACTION_QA_ANSWER_DELETED,
                $groupId,
                $userId,
                [
                    'question_id' => (int) $answer->question_id,
                    'answer_id' => $answerId,
                    'target_user_id' => (int) $answer->user_id,
                    'was_accepted' => (bool) $answer->is_accepted,
                ],
            );

            return true;
        });
    }

    public function acceptAnswer(int $groupId, int $answerId, int $userId): bool
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return false;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $answerId, $userId, $tenantId): bool {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return false;
            }

            $identity = $this->findAnswerInGroup($groupId, $answerId, $tenantId);
            if ($identity === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_answer_not_found'));
                return false;
            }

            $question = DB::table('group_questions')
                ->where('id', (int) $identity->question_id)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($question === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_question_not_found'));
                return false;
            }

            $answer = $this->lockAnswer($answerId, (int) $identity->question_id, $tenantId);
            if ($answer === null) {
                $this->addError('NOT_FOUND', __('api.group_qa_answer_not_found'));
                return false;
            }

            $isQuestionAuthor = (int) $question->user_id === $userId;
            if (! $isQuestionAuthor && ! GroupAccessService::canManage($groupId, $userId)) {
                $this->addError('FORBIDDEN', __('api.group_qa_accept_forbidden'));
                return false;
            }

            if ((int) $question->accepted_answer_id === $answerId && (bool) $answer->is_accepted) {
                return true;
            }

            $affectedAuthorIds = [(int) $answer->user_id];
            $previousAcceptedAuthorId = DB::table('group_answers')
                ->where('question_id', (int) $answer->question_id)
                ->where('tenant_id', $tenantId)
                ->where('is_accepted', true)
                ->where('id', '!=', $answerId)
                ->value('user_id');
            if ($previousAcceptedAuthorId !== null) {
                $affectedAuthorIds[] = (int) $previousAcceptedAuthorId;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_answer_accept',
                null,
                array_values(array_unique($affectedAuthorIds)),
            );

            DB::table('group_answers')
                ->where('question_id', (int) $answer->question_id)
                ->where('tenant_id', $tenantId)
                ->where('is_accepted', true)
                ->update(['is_accepted' => false, 'updated_at' => now()]);
            DB::table('group_answers')
                ->where('id', $answerId)
                ->where('question_id', (int) $answer->question_id)
                ->where('tenant_id', $tenantId)
                ->update(['is_accepted' => true, 'updated_at' => now()]);
            DB::table('group_questions')
                ->where('id', (int) $answer->question_id)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->update(['accepted_answer_id' => $answerId, 'updated_at' => now()]);

            GroupAuditService::log(
                GroupAuditService::ACTION_QA_ANSWER_ACCEPTED,
                $groupId,
                $userId,
                [
                    'question_id' => (int) $answer->question_id,
                    'answer_id' => $answerId,
                    'previous_answer_id' => (int) ($question->accepted_answer_id ?? 0) ?: null,
                    'target_user_id' => (int) $answer->user_id,
                ],
            );

            return true;
        });
    }

    public function vote(int $groupId, int $userId, string $type, int $targetId, int $vote): bool
    {
        $this->errors = [];
        if (! in_array($type, ['question', 'answer'], true)) {
            $this->addError('INVALID', __('api.group_qa_invalid_type'));
            return false;
        }
        if (! in_array($vote, [1, -1], true)) {
            $this->addError('INVALID', __('api.group_qa_invalid_vote'));
            return false;
        }
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return false;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $userId, $type, $targetId, $vote, $tenantId): bool {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return false;
            }

            if ($type === 'question') {
                $target = DB::table('group_questions')
                    ->where('id', $targetId)
                    ->where('group_id', $groupId)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'user_id'])
                    ->lockForUpdate()
                    ->first();
            } else {
                $identity = $this->findAnswerInGroup($groupId, $targetId, $tenantId);
                $target = $identity === null
                    ? null
                    : $this->lockAnswer($targetId, (int) $identity->question_id, $tenantId);
            }

            if ($target === null) {
                $this->addError(
                    'NOT_FOUND',
                    $type === 'question'
                        ? __('api.group_qa_question_not_found')
                        : __('api.group_qa_answer_not_found'),
                );
                return false;
            }

            $existing = DB::table('group_qa_votes')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('votable_type', $type)
                ->where('votable_id', $targetId)
                ->lockForUpdate()
                ->first();

            $oldVote = $existing === null ? 0 : (int) $existing->vote;
            $newVote = $oldVote === $vote ? 0 : $vote;
            $delta = $newVote - $oldVote;

            if ($newVote !== 0) {
                GroupService::assertSafeguardingBroadcastAllowed(
                    $groupId,
                    $userId,
                    $tenantId,
                    'group_qa_vote',
                    null,
                    [(int) $target->user_id],
                );
            }

            if ($newVote === 0 && $existing !== null) {
                DB::table('group_qa_votes')
                    ->where('id', (int) $existing->id)
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->delete();
            } elseif ($existing !== null) {
                DB::table('group_qa_votes')
                    ->where('id', (int) $existing->id)
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->update(['vote' => $newVote]);
            } else {
                DB::table('group_qa_votes')->insert([
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'votable_type' => $type,
                    'votable_id' => $targetId,
                    'vote' => $newVote,
                    'created_at' => now(),
                ]);
            }

            if ($delta !== 0) {
                DB::table($type === 'question' ? 'group_questions' : 'group_answers')
                    ->where('id', $targetId)
                    ->where('tenant_id', $tenantId)
                    ->increment('vote_count', $delta);
            }

            return true;
        });
    }

    private function requireMemberContent(int $groupId, int $userId): bool
    {
        if (! $this->groupExistsInTenant($groupId)) {
            $this->addError('NOT_FOUND', __('api.group_not_found'));
            return false;
        }
        if (! GroupAccessService::canViewMemberContent($groupId, $userId)) {
            $this->addError('FORBIDDEN', __('api.group_qa_member_required'));
            return false;
        }

        return true;
    }

    private function requireWriteAccess(int $groupId, int $userId): bool
    {
        if (! $this->groupExistsInTenant($groupId)) {
            $this->addError('NOT_FOUND', __('api.group_not_found'));
            return false;
        }
        if (! GroupAccessService::canWriteContent($groupId, $userId)) {
            $this->addError('FORBIDDEN', __('api.group_qa_member_required'));
            return false;
        }

        return true;
    }

    private function groupExistsInTenant(int $groupId): bool
    {
        return DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', (int) TenantContext::getId())
            ->exists();
    }

    private function lockWritableGroup(int $groupId, int $tenantId): bool
    {
        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->select(['status'])
            ->sharedLock()
            ->first();

        if ($group === null) {
            $this->addError('NOT_FOUND', __('api.group_not_found'));
            return false;
        }

        $status = GroupStatus::tryFrom((string) $group->status);
        if ($status === null || ! $status->isWritable()) {
            $this->addError('FORBIDDEN', __('api.group_qa_member_required'));
            return false;
        }

        return true;
    }

    private function canModifyAuthoredContent(int $groupId, int $userId, int $authorId): bool
    {
        return $userId === $authorId || GroupAccessService::canManage($groupId, $userId);
    }

    private function validateQuestion(string $title, string $body): bool
    {
        if (mb_strlen($title) < 5 || mb_strlen($title) > 500) {
            $this->addError('VALIDATION', __('api.group_qa_title_min'));
            return false;
        }

        return $this->validateBody($body);
    }

    private function validateBody(string $body): bool
    {
        if ($body === '' || mb_strlen($body) > 50000) {
            $this->addError('VALIDATION', __('api_controllers_3.group_qa.body_required'));
            return false;
        }

        return true;
    }

    private function findAnswerInGroup(int $groupId, int $answerId, int $tenantId): ?object
    {
        return DB::table('group_answers as ga')
            ->join('group_questions as gq', static function ($join) use ($groupId, $tenantId): void {
                $join->on('gq.id', '=', 'ga.question_id')
                    ->where('gq.group_id', '=', $groupId)
                    ->where('gq.tenant_id', '=', $tenantId);
            })
            ->where('ga.id', $answerId)
            ->where('ga.tenant_id', $tenantId)
            ->select([
                'ga.*',
                'gq.user_id as question_user_id',
                'gq.accepted_answer_id',
            ])
            ->first();
    }

    private function lockAnswer(int $answerId, int $questionId, int $tenantId): ?object
    {
        return DB::table('group_answers')
            ->where('id', $answerId)
            ->where('question_id', $questionId)
            ->where('tenant_id', $tenantId)
            ->lockForUpdate()
            ->first();
    }

    /** @param array{score?: int, created_at?: string, id: int}|null $cursor */
    private function applyCursor(Builder $query, string $sort, ?array $cursor): void
    {
        if ($cursor === null) {
            return;
        }

        if ($sort === 'most_voted' && isset($cursor['score'])) {
            $query->where(static function (Builder $after) use ($cursor): void {
                $after->where('gq.vote_count', '<', (int) $cursor['score'])
                    ->orWhere(static function (Builder $tie) use ($cursor): void {
                        $tie->where('gq.vote_count', '=', (int) $cursor['score'])
                            ->where('gq.id', '<', (int) $cursor['id']);
                    });
            });
            return;
        }

        if (isset($cursor['created_at'])) {
            $query->where(static function (Builder $after) use ($cursor): void {
                $after->where('gq.created_at', '<', (string) $cursor['created_at'])
                    ->orWhere(static function (Builder $tie) use ($cursor): void {
                        $tie->where('gq.created_at', '=', (string) $cursor['created_at'])
                            ->where('gq.id', '<', (int) $cursor['id']);
                    });
            });
        }
    }

    private function applyOrdering(Builder $query, string $sort): void
    {
        if ($sort === 'most_voted') {
            $query->orderByDesc('gq.vote_count')->orderByDesc('gq.id');
            return;
        }

        $query->orderByDesc('gq.created_at')->orderByDesc('gq.id');
    }

    /** @return array{score?: int, created_at?: string, id: int}|null */
    private function decodeCursor(mixed $cursor, string $sort, int $groupId): ?array
    {
        if (! is_string($cursor) || $cursor === '') {
            return null;
        }

        $payload = CursorSigner::decode($cursor);
        if (
            ! is_array($payload)
            || ($payload['v'] ?? null) !== 1
            || ($payload['kind'] ?? null) !== 'group_questions'
            || (int) ($payload['tenant_id'] ?? 0) !== (int) TenantContext::getId()
            || (int) ($payload['group_id'] ?? 0) !== $groupId
            || ($payload['sort'] ?? null) !== $sort
            || ! isset($payload['id'])
            || ! is_int($payload['id'])
            || $payload['id'] <= 0
        ) {
            return null;
        }

        if ($sort === 'most_voted' && isset($payload['score']) && is_int($payload['score'])) {
            return ['score' => $payload['score'], 'id' => $payload['id']];
        }
        if (isset($payload['created_at']) && is_string($payload['created_at'])) {
            $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $payload['created_at']);
            if ($parsed !== false && $parsed->format('Y-m-d H:i:s') === $payload['created_at']) {
                return ['created_at' => $payload['created_at'], 'id' => $payload['id']];
            }
        }

        return null;
    }

    private function encodeCursor(string $sort, int $groupId, object $last): string
    {
        $payload = $sort === 'most_voted'
            ? ['sort' => $sort, 'score' => (int) $last->vote_count, 'id' => (int) $last->id]
            : ['sort' => $sort, 'created_at' => (string) $last->created_at, 'id' => (int) $last->id];

        return CursorSigner::encode([
            'v' => 1,
            'kind' => 'group_questions',
            'tenant_id' => (int) TenantContext::getId(),
            'group_id' => $groupId,
            ...$payload,
        ]);
    }

    /** @return array<string, mixed> */
    private static function formatQuestion(object|array $question): array
    {
        $row = (array) $question;
        $row['id'] = (int) ($row['id'] ?? 0);
        $row['group_id'] = (int) ($row['group_id'] ?? 0);
        $row['body'] = (string) ($row['body'] ?? '');
        $row['vote_count'] = (int) ($row['vote_count'] ?? 0);
        $row['user_vote'] = (int) ($row['user_vote'] ?? 0);
        $row['answer_count'] = (int) ($row['answer_count'] ?? 0);
        $row['view_count'] = (int) ($row['view_count'] ?? 0);
        $row['is_closed'] = (bool) ($row['is_closed'] ?? false);
        $row['has_accepted_answer'] = ! empty($row['accepted_answer_id']);
        $row['author'] = [
            'id' => (int) ($row['author_id'] ?? 0),
            'name' => $row['author_name'] ?? __('api.unknown_user'),
            'avatar' => $row['author_avatar'] ?? null,
        ];
        unset($row['author_id'], $row['author_name'], $row['author_avatar']);

        return $row;
    }

    /** @return array<string, mixed> */
    private static function formatAnswer(object|array $answer): array
    {
        $row = (array) $answer;
        $row['id'] = (int) ($row['id'] ?? 0);
        $row['question_id'] = (int) ($row['question_id'] ?? 0);
        $row['body'] = (string) ($row['body'] ?? '');
        $row['vote_count'] = (int) ($row['vote_count'] ?? 0);
        $row['user_vote'] = (int) ($row['user_vote'] ?? 0);
        $row['is_accepted'] = (bool) ($row['is_accepted'] ?? false);
        $row['author'] = [
            'id' => (int) ($row['author_id'] ?? 0),
            'name' => $row['author_name'] ?? __('api.unknown_user'),
            'avatar' => $row['author_avatar'] ?? null,
        ];
        unset($row['author_id'], $row['author_name'], $row['author_avatar']);

        return $row;
    }

    private function addError(string $code, string $message): void
    {
        $this->errors[] = ['code' => $code, 'message' => $message];
    }
}
