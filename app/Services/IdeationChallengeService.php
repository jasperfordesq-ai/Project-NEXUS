<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplate;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * IdeationChallengeService — Laravel DI-based service for ideation challenges.
 *
 * Manages challenge CRUD, idea submission, voting, comments, favorites, and drafts.
 */
class IdeationChallengeService
{
    private const MEMBER_VISIBLE_STATUSES = ['open', 'voting', 'evaluating', 'closed'];
    private const MANAGEABLE_STATUSES = ['draft', 'open', 'voting', 'evaluating', 'closed', 'archived'];

    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    // ================================================================
    // CHALLENGE METHODS
    // ================================================================

    /**
     * Get all challenges with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(array $filters = []): array
    {
        $limit  = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $tenantId = TenantContext::getId();
        $viewerId = !empty($filters['viewer_id']) ? (int) $filters['viewer_id'] : null;
        $canManage = $viewerId !== null && $this->isAdmin($viewerId, $tenantId);

        $query = DB::table('ideation_challenges as c')
            ->leftJoin('users as u', 'c.user_id', '=', 'u.id')
            ->where('c.tenant_id', $tenantId)
            ->select('c.*', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url');

        $requestedStatus = !empty($filters['status']) ? (string) $filters['status'] : null;
        if ($canManage) {
            if ($requestedStatus !== null && in_array($requestedStatus, self::MANAGEABLE_STATUSES, true)) {
                $query->where('c.status', $requestedStatus);
            } elseif ($requestedStatus !== null) {
                $query->whereRaw('1 = 0');
            }
        } else {
            $query->whereIn('c.status', self::MEMBER_VISIBLE_STATUSES);
            if ($requestedStatus !== null && in_array($requestedStatus, self::MEMBER_VISIBLE_STATUSES, true)) {
                $query->where('c.status', $requestedStatus);
            } elseif ($requestedStatus !== null) {
                $query->whereRaw('1 = 0');
            }
        }

        if ($cursor !== null) {
            $query->where('c.id', '<', (int) base64_decode($cursor));
        }

        $query->orderByDesc('c.id');
        $items   = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->map(function ($i) {
                $item = (array) $i;
                $item['tags'] = isset($item['tags']) ? (json_decode($item['tags'], true) ?? []) : [];
                return $item;
            })->values()->all(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get all challenges (legacy alias returning items array directly).
     */
    public function getAllChallenges(array $filters = []): array
    {
        return $this->getAll($filters)['items'];
    }

    /**
     * Get a single challenge by ID with idea count.
     */
    public function getById(int $id, ?int $viewerId = null): ?array
    {
        $challenge = DB::table('ideation_challenges')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $id)
            ->first();

        if (! $challenge) {
            return null;
        }

        if (!$this->canViewChallengeRecord($challenge, $viewerId)) {
            return null;
        }

        $data = (array) $challenge;
        $data['tags'] = isset($data['tags']) ? (json_decode($data['tags'], true) ?? []) : [];
        $data['ideas_count'] = (int) DB::table('challenge_ideas')->where('challenge_id', $id)->count();

        return $data;
    }

    /**
     * Get a challenge by ID with user context (legacy alias).
     */
    public function getChallengeById(int $id, ?int $userId = null): ?array
    {
        $tenantId = TenantContext::getId();

        $challenge = DB::table('ideation_challenges as c')
            ->leftJoin('users as u', 'c.user_id', '=', 'u.id')
            ->where('c.id', $id)
            ->where('c.tenant_id', $tenantId)
            ->select(
                'c.*',
                'u.first_name as creator_first_name',
                'u.last_name as creator_last_name', 'u.profile_type as creator_profile_type', 'u.organization_name as creator_organization_name',
                'u.avatar_url as creator_avatar'
            )
            ->first();

        if (! $challenge) {
            return null;
        }

        if (!$this->canViewChallengeRecord($challenge, $userId)) {
            return null;
        }

        $data = (array) $challenge;
        $data['tags'] = isset($data['tags']) ? (json_decode($data['tags'], true) ?? []) : [];
        $data['ideas_count'] = (int) DB::table('challenge_ideas')
            ->where('challenge_id', $id)
            ->whereNotIn('status', ['draft', 'withdrawn'])
            ->count();

        // User idea count
        if ($userId) {
            $data['user_idea_count'] = (int) DB::table('challenge_ideas')
                ->where('challenge_id', $id)
                ->where('user_id', $userId)
                ->whereNotIn('status', ['draft', 'withdrawn'])
                ->count();

            $data['is_favorited'] = DB::table('challenge_favorites')
                ->where('challenge_id', $id)
                ->where('user_id', $userId)
                ->exists();
        } else {
            $data['is_favorited'] = false;
        }

        // Format creator
        $data['creator'] = [
            'id'         => (int) ($data['user_id'] ?? 0),
            'name'       => UserDisplayName::resolvePrefixed($data, 'creator_'),
            'avatar_url' => $data['creator_avatar'] ?? null,
        ];

        unset($data['creator_first_name'], $data['creator_last_name'], $data['creator_avatar']);

        return $data;
    }

    /**
     * Create a new ideation challenge.
     */
    public function create(int $userId, array $data): int
    {
        $title = trim((string) ($data['title'] ?? ''));
        $description = trim((string) ($data['description'] ?? ''));
        $status = (string) ($data['status'] ?? 'open');
        $validStatuses = ['draft', 'open', 'voting', 'evaluating', 'closed', 'archived'];

        if ($title === '') {
            throw new \InvalidArgumentException(__('api.title_required'));
        }
        if ($description === '') {
            throw new \InvalidArgumentException(__('api.description_required'));
        }
        if (! in_array($status, $validStatuses, true)) {
            $status = 'open';
        }

        $tags = $data['tags'] ?? null;
        if (is_array($tags)) {
            $tags = json_encode(array_values(array_filter(array_map('trim', $tags))));
        }

        return DB::table('ideation_challenges')->insertGetId([
            'tenant_id'            => TenantContext::getId(),
            'user_id'              => $userId,
            'title'                => $title,
            'description'          => $description,
            'category'             => trim((string) ($data['category'] ?? '')) ?: null,
            'status'               => $status,
            'submission_deadline'  => $data['submission_deadline'] ?? null,
            'voting_deadline'      => $data['voting_deadline'] ?? null,
            'cover_image'          => trim((string) ($data['cover_image'] ?? '')) ?: null,
            'prize_description'    => trim((string) ($data['prize_description'] ?? '')) ?: null,
            'max_ideas_per_user'   => isset($data['max_ideas_per_user']) && $data['max_ideas_per_user'] !== ''
                ? (int) $data['max_ideas_per_user']
                : null,
            'tags'                 => $tags,
            'category_id'          => isset($data['category_id']) && $data['category_id'] !== ''
                ? (int) $data['category_id']
                : null,
            'evaluation_criteria'  => isset($data['evaluation_criteria']) && is_array($data['evaluation_criteria'])
                ? json_encode(array_values($data['evaluation_criteria']))
                : null,
            'created_at'           => now(),
            'updated_at'           => now(),
        ]);
    }

    /**
     * Update a challenge (admin only).
     */
    public function updateChallenge(int $id, int $userId, array $data): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (! $this->isAdmin($userId, $tenantId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.challenge_admin_only_update')];
            return false;
        }

        $challenge = DB::table('ideation_challenges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $challenge) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.challenge_not_found')];
            return false;
        }

        $updates = [];
        $updatableFields = ['title', 'description', 'category', 'submission_deadline', 'voting_deadline',
            'prize_description', 'max_ideas_per_user', 'cover_image', 'category_id', 'evaluation_criteria'];

        foreach ($updatableFields as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }

            $value = $data[$field];

            if ($field === 'title' && empty(trim((string) $value))) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.title_cannot_be_empty'), 'field' => 'title'];
                return false;
            }
            if ($field === 'description' && empty(trim((string) $value))) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.description_cannot_be_empty'), 'field' => 'description'];
                return false;
            }

            if (in_array($field, ['tags', 'evaluation_criteria']) && is_array($value)) {
                $value = json_encode($value);
            }
            if (in_array($field, ['max_ideas_per_user', 'category_id']) && $value !== null) {
                $value = (int) $value;
            }

            $updates[$field] = $value;
        }

        // Handle tags separately
        if (array_key_exists('tags', $data)) {
            $updates['tags'] = is_array($data['tags']) ? json_encode($data['tags']) : null;
        }

        if (empty($updates)) {
            return true;
        }

        DB::table('ideation_challenges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return true;
    }

    /**
     * Delete a challenge (admin only).
     */
    public function deleteChallenge(int $id, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (! $this->isAdmin($userId, $tenantId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.challenge_admin_only_delete')];
            return false;
        }

        $exists = DB::table('ideation_challenges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.challenge_not_found')];
            return false;
        }

        DB::table('ideation_challenges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        return true;
    }

    /**
     * Update challenge status (lifecycle transitions).
     */
    public function updateChallengeStatus(int $id, int $userId, string $status): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (! $this->isAdmin($userId, $tenantId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.challenge_admin_only_status')];
            return false;
        }

        $validStatuses = ['draft', 'open', 'voting', 'evaluating', 'closed', 'archived'];
        if (! in_array($status, $validStatuses)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_status_value'), 'field' => 'status'];
            return false;
        }

        $challenge = DB::table('ideation_challenges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $challenge) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.challenge_not_found')];
            return false;
        }

        // Validate status transitions
        $validTransitions = [
            'draft'      => ['open'],
            'open'       => ['voting', 'evaluating', 'closed'],
            'voting'     => ['evaluating', 'closed'],
            'evaluating' => ['closed'],
            'closed'     => ['open', 'archived'],
            'archived'   => ['closed'],
        ];

        if (! in_array($status, $validTransitions[$challenge->status] ?? [])) {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.challenge_invalid_transition', ['from' => $challenge->status, 'to' => $status])];
            return false;
        }

        DB::table('ideation_challenges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['status' => $status]);

        return true;
    }

    // ================================================================
    // IDEA METHODS
    // ================================================================

    /**
     * Submit an idea to a challenge.
     */
    public function submitIdea(int $challengeId, int $userId, array $data): int
    {
        $tenantId = TenantContext::getId();
        $challenge = DB::table('ideation_challenges')
            ->where('id', $challengeId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$challenge) {
            throw new \RuntimeException('Challenge not found');
        }

        if ((int) $challenge->user_id !== $userId) {
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $userId,
                (int) $challenge->user_id,
                (int) $tenantId,
                'ideation_idea_submission',
            );
        }

        $ideaId = DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id'      => $userId,
            'title'        => trim($data['title']),
            'description'  => trim($data['description'] ?? ''),
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        // Notify the challenge creator that a new idea was submitted
        $this->notifyIdeaSubmitted($challengeId, $ideaId, $userId, trim($data['title']));

        return $ideaId;
    }

    /**
     * Get ideas for a challenge with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getIdeas(int $challengeId, array $filters = []): array
    {
        $limit  = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;
        $sort   = $filters['sort'] ?? 'votes';

        $query = DB::table('challenge_ideas as i')
            ->leftJoin('users as u', 'i.user_id', '=', 'u.id')
            ->where('i.challenge_id', $challengeId)
            ->select('i.*', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url');

        // Add vote count subquery
        $query->selectSub(
            DB::table('challenge_idea_votes')->whereColumn('idea_id', 'i.id')->selectRaw('COUNT(*)'),
            'vote_count'
        );

        if ($cursor !== null) {
            $query->where('i.id', '<', (int) base64_decode($cursor));
        }

        if ($sort === 'votes') {
            $query->orderByDesc('vote_count')->orderByDesc('i.id');
        } else {
            $query->orderByDesc('i.id');
        }

        $items   = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->map(function ($i) {
                $item = (array) $i;
                $item['creator'] = [
                    'id'         => (int) ($item['user_id'] ?? 0),
                    'name'       => UserDisplayName::resolve($item),
                    'avatar_url' => $item['avatar_url'] ?? null,
                ];
                unset($item['first_name'], $item['last_name'], $item['avatar_url']);
                return $item;
            })->values()->all(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get an idea by ID.
     */
    public function getIdeaById(int $id, ?int $userId = null): ?array
    {
        $tenantId = TenantContext::getId();

        $idea = DB::table('challenge_ideas as i')
            ->leftJoin('users as u', 'i.user_id', '=', 'u.id')
            ->join('ideation_challenges as ic', 'i.challenge_id', '=', 'ic.id')
            ->where('i.id', $id)
            ->where('ic.tenant_id', $tenantId)
            ->select(
                'i.*',
                'u.first_name as creator_first_name',
                'u.last_name as creator_last_name', 'u.profile_type as creator_profile_type', 'u.organization_name as creator_organization_name',
                'u.avatar_url as creator_avatar'
            )
            ->first();

        if (! $idea) {
            return null;
        }

        $data = (array) $idea;
        $data['creator'] = [
            'id'         => (int) ($data['user_id'] ?? 0),
            'name'       => UserDisplayName::resolvePrefixed($data, 'creator_'),
            'avatar_url' => $data['creator_avatar'] ?? null,
        ];

        if ($userId) {
            $data['has_voted'] = DB::table('challenge_idea_votes')
                ->where('idea_id', $id)
                ->where('user_id', $userId)
                ->exists();
        } else {
            $data['has_voted'] = false;
        }

        unset($data['creator_first_name'], $data['creator_last_name'], $data['creator_avatar']);

        return $data;
    }

    /**
     * Update an idea (owner only, challenge must be open).
     */
    public function updateIdea(int $id, int $userId, array $data): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $idea = $this->getIdeaById($id);
        if (! $idea) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.idea_not_found')];
            return false;
        }

        if ((int) $idea['user_id'] !== $userId) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.idea_edit_own_only')];
            return false;
        }

        $challenge = DB::table('ideation_challenges')
            ->where('id', $idea['challenge_id'])
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $challenge || $challenge->status !== 'open') {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.challenge_closed_for_edits')];
            return false;
        }

        $updates = [];

        if (isset($data['title'])) {
            $title = trim($data['title']);
            if (empty($title)) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.title_cannot_be_empty'), 'field' => 'title'];
                return false;
            }
            $updates['title'] = $title;
        }

        if (isset($data['description'])) {
            $desc = trim($data['description']);
            if (empty($desc)) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.description_cannot_be_empty'), 'field' => 'description'];
                return false;
            }
            $updates['description'] = $desc;
        }

        if (empty($updates)) {
            return true;
        }

        DB::table('challenge_ideas')
            ->where('id', $id)
            ->whereIn('challenge_id', function ($q) use ($tenantId) {
                $q->select('id')->from('ideation_challenges')->where('tenant_id', $tenantId);
            })
            ->update($updates);

        return true;
    }

    /**
     * Update a draft idea (only drafts can be edited this way).
     */
    public function updateDraftIdea(int $ideaId, int $userId, array $data): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $idea = DB::table('challenge_ideas as ci')
            ->join('ideation_challenges as c', 'ci.challenge_id', '=', 'c.id')
            ->where('ci.id', $ideaId)
            ->where('c.tenant_id', $tenantId)
            ->where('ci.user_id', $userId)
            ->select('ci.*')
            ->first();

        if (! $idea) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.idea_not_found')];
            return false;
        }

        if ($idea->status !== 'draft') {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.idea_only_draft_editable')];
            return false;
        }

        $title       = trim($data['title'] ?? '');
        $description = trim($data['description'] ?? '');
        $publish     = ! empty($data['publish']);

        if (empty($title)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.title_required'), 'field' => 'title'];
            return false;
        }

        if ($publish && empty($description)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.description_required'), 'field' => 'description'];
            return false;
        }

        $newStatus = $publish ? 'submitted' : 'draft';

        try {
            return DB::transaction(function () use ($ideaId, $title, $description, $newStatus, $publish, $idea, $tenantId) {
                DB::table('challenge_ideas')
                    ->where('id', $ideaId)
                    ->update([
                        'title'       => $title,
                        'description' => $description,
                        'status'      => $newStatus,
                        'updated_at'  => now(),
                    ]);

                if ($publish) {
                    DB::table('ideation_challenges')
                        ->where('id', $idea->challenge_id)
                        ->where('tenant_id', $tenantId)
                        ->increment('ideas_count');
                }

                return true;
            });
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::updateDraftIdea error: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.idea_draft_update_failed')];
            return false;
        }
    }

    /**
     * Delete an idea (owner or admin).
     */
    public function deleteIdea(int $id, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $idea = $this->getIdeaById($id);
        if (! $idea) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.idea_not_found')];
            return false;
        }

        $isOwner = (int) $idea['user_id'] === $userId;
        $isAdmin = $this->isAdmin($userId, $tenantId);

        if (! $isOwner && ! $isAdmin) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.idea_delete_own_only')];
            return false;
        }

        try {
            return DB::transaction(function () use ($id, $idea, $tenantId) {
                DB::table('challenge_ideas')
                    ->where('id', $id)
                    ->whereIn('challenge_id', function ($q) use ($tenantId) {
                        $q->select('id')->from('ideation_challenges')->where('tenant_id', $tenantId);
                    })
                    ->delete();

                DB::table('ideation_challenges')
                    ->where('id', $idea['challenge_id'])
                    ->where('tenant_id', $tenantId)
                    ->update(['ideas_count' => DB::raw('GREATEST(0, ideas_count - 1)')]);

                return true;
            });
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::deleteIdea error: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.idea_delete_failed')];
            return false;
        }
    }

    /**
     * Vote on an idea (legacy alias with validation).
     */
    public function voteIdea(int $ideaId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $idea = $this->getIdeaById($ideaId, $userId);
        if (! $idea) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.idea_not_found')];
            return null;
        }

        // Cannot vote on withdrawn or draft ideas
        if (in_array($idea['status'] ?? '', ['withdrawn', 'draft'])) {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.idea_vote_withdrawn_or_draft')];
            return null;
        }

        // Check challenge is in open or voting status
        $challenge = DB::table('ideation_challenges')
            ->where('id', $idea['challenge_id'])
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $challenge || ! in_array($challenge->status, ['open', 'voting'])) {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.challenge_voting_not_allowed')];
            return null;
        }

        // Can't vote on your own idea
        if ((int) $idea['user_id'] === $userId) {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.idea_cannot_vote_own')];
            return null;
        }

        try {
            return DB::transaction(function () use ($ideaId, $idea, $userId, $tenantId) {
                $existingVote = DB::table('challenge_idea_votes')
                    ->where('idea_id', $ideaId)
                    ->where('user_id', $userId)
                    ->first();

                if ($existingVote) {
                    DB::table('challenge_idea_votes')
                        ->where('idea_id', $ideaId)
                        ->where('user_id', $userId)
                        ->delete();
                    DB::table('challenge_ideas')
                        ->where('id', $ideaId)
                        ->update(['votes_count' => DB::raw('GREATEST(0, votes_count - 1)')]);
                    $voted = false;
                } else {
                    app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                        $userId,
                        (int) $idea['user_id'],
                        (int) $tenantId,
                        'ideation_idea_vote',
                    );

                    DB::table('challenge_idea_votes')->insert([
                        'idea_id'    => $ideaId,
                        'user_id'    => $userId,
                        'created_at' => now(),
                    ]);
                    DB::table('challenge_ideas')
                        ->where('id', $ideaId)
                        ->increment('votes_count');
                    $voted = true;
                }

                $updated = DB::table('challenge_ideas')->where('id', $ideaId)->first();

                // Notify idea author on new vote (not on unvote)
                if ($voted && $updated) {
                    $this->notifyIdeaVoted($ideaId, (int) $updated->user_id, $userId, $updated->title ?? '');
                }

                return [
                    'voted'       => $voted,
                    'votes_count' => (int) ($updated->votes_count ?? 0),
                ];
            });
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::voteIdea error: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.idea_vote_toggle_failed')];
            return null;
        }
    }

    /**
     * Update idea status (admin only).
     */
    public function updateIdeaStatus(int $ideaId, int $userId, string $status): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (! $this->isAdmin($userId, $tenantId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.idea_admin_only_status')];
            return false;
        }

        $validStatuses = ['submitted', 'shortlisted', 'winner', 'withdrawn'];
        if (! in_array($status, $validStatuses)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_status_value'), 'field' => 'status'];
            return false;
        }

        $idea = $this->getIdeaById($ideaId);
        if (! $idea) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.idea_not_found')];
            return false;
        }

        DB::table('challenge_ideas')
            ->where('id', $ideaId)
            ->whereIn('challenge_id', function ($q) use ($tenantId) {
                $q->select('id')->from('ideation_challenges')->where('tenant_id', $tenantId);
            })
            ->update(['status' => $status]);

        // Notify the idea author about status change
        $this->notifyIdeaStatusChanged($ideaId, (int) $idea['user_id'], $status, $idea['title'] ?? '');

        return true;
    }

    /**
     * Get user's draft ideas for a challenge.
     */
    public function getUserDrafts(int $challengeId, int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('challenge_ideas as ci')
            ->join('ideation_challenges as c', 'ci.challenge_id', '=', 'c.id')
            ->where('ci.challenge_id', $challengeId)
            ->where('ci.user_id', $userId)
            ->where('ci.status', 'draft')
            ->where('c.tenant_id', $tenantId)
            ->orderByDesc('ci.updated_at')
            ->orderByDesc('ci.created_at')
            ->select('ci.id', 'ci.title', 'ci.description', 'ci.status', 'ci.created_at', 'ci.updated_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    // ================================================================
    // COMMENT METHODS
    // ================================================================

    /**
     * Get comments for an idea with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getComments(int $ideaId, array $filters = []): array
    {
        $limit  = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        // Verify idea exists in our tenant
        $idea = $this->getIdeaById($ideaId);
        if (! $idea) {
            return ['items' => [], 'cursor' => null, 'has_more' => false];
        }

        $query = DB::table('challenge_idea_comments as c')
            ->leftJoin('users as u', 'c.user_id', '=', 'u.id')
            ->where('c.idea_id', $ideaId)
            ->select(
                'c.*',
                'u.first_name as author_first_name',
                'u.last_name as author_last_name', 'u.profile_type as author_profile_type', 'u.organization_name as author_organization_name',
                'u.avatar_url as author_avatar'
            );

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor);
            if ($cursorId !== false) {
                $query->where('c.id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('c.created_at')->orderByDesc('c.id');

        $items   = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $formatted = $items->map(function ($item) {
            $data = (array) $item;
            $data['author'] = [
                'id'         => (int) $item->user_id,
                'name'       => UserDisplayName::resolvePrefixed($item, 'author_'),
                'avatar_url' => $item->author_avatar ?? null,
            ];
            unset($data['author_first_name'], $data['author_last_name'], $data['author_avatar']);
            return $data;
        })->all();

        return [
            'items'    => $formatted,
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Add a comment to an idea.
     */
    public function addComment(int $ideaId, int $userId, string $body): ?int
    {
        $this->errors = [];
        $body = trim($body);

        if (empty($body)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.comment_body_required'), 'field' => 'body'];
            return null;
        }

        $idea = $this->getIdeaById($ideaId);
        if (! $idea) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.idea_not_found')];
            return null;
        }

        if (in_array($idea['status'] ?? '', ['withdrawn', 'draft'])) {
            $this->errors[] = ['code' => 'CONFLICT', 'message' => __('api.idea_comment_withdrawn_or_draft')];
            return null;
        }

        try {
            $commentId = DB::transaction(function () use ($ideaId, $idea, $userId, $body) {
                $ideaAuthorId = (int) $idea['user_id'];
                if ($ideaAuthorId !== $userId) {
                    app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                        $userId,
                        $ideaAuthorId,
                        (int) TenantContext::getId(),
                        'idea_comment',
                    );
                }

                $commentId = DB::table('challenge_idea_comments')->insertGetId([
                    'idea_id'    => $ideaId,
                    'user_id'    => $userId,
                    'body'       => $body,
                    'created_at' => now(),
                ]);

                DB::table('challenge_ideas')
                    ->where('id', $ideaId)
                    ->increment('comments_count');

                return (int) $commentId;
            });

            // Notify idea author about the comment
            $this->notifyIdeaCommented($ideaId, (int) $idea['user_id'], $userId, $body);

            return $commentId;
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::addComment error: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.comment_add_failed')];
            return null;
        }
    }

    /**
     * Delete a comment (owner or admin).
     */
    public function deleteComment(int $commentId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $comment = DB::table('challenge_idea_comments as c')
            ->leftJoin('challenge_ideas as i', 'c.idea_id', '=', 'i.id')
            ->leftJoin('ideation_challenges as ic', 'i.challenge_id', '=', 'ic.id')
            ->where('c.id', $commentId)
            ->select('c.*', 'ic.tenant_id')
            ->first();

        if (! $comment || (int) ($comment->tenant_id ?? 0) !== $tenantId) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.comment_not_found')];
            return false;
        }

        $isOwner = (int) $comment->user_id === $userId;
        $isAdmin = $this->isAdmin($userId, $tenantId);

        if (! $isOwner && ! $isAdmin) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.comment_delete_own_only')];
            return false;
        }

        try {
            return DB::transaction(function () use ($commentId, $comment) {
                DB::table('challenge_idea_comments')->where('id', $commentId)->delete();

                DB::table('challenge_ideas')
                    ->where('id', $comment->idea_id)
                    ->update(['comments_count' => DB::raw('GREATEST(0, comments_count - 1)')]);

                return true;
            });
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::deleteComment error: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.comment_delete_failed')];
            return false;
        }
    }

    // ================================================================
    // FAVORITE METHODS
    // ================================================================

    /**
     * Toggle favorite on a challenge.
     *
     * @return array{favorited: bool, favorites_count?: int}
     */
    public function toggleFavorite(int $challengeId, int $userId): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $exists = DB::table('ideation_challenges')
            ->where('id', $challengeId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.challenge_not_found')];
            return ['favorited' => false];
        }

        try {
            return DB::transaction(function () use ($challengeId, $userId, $tenantId) {
                $existing = DB::table('challenge_favorites')
                    ->where('challenge_id', $challengeId)
                    ->where('user_id', $userId)
                    ->first();

                if ($existing) {
                    DB::table('challenge_favorites')
                        ->where('challenge_id', $challengeId)
                        ->where('user_id', $userId)
                        ->delete();
                    DB::table('ideation_challenges')
                        ->where('id', $challengeId)
                        ->where('tenant_id', $tenantId)
                        ->update(['favorites_count' => DB::raw('GREATEST(0, favorites_count - 1)')]);
                    $favorited = false;
                } else {
                    $challengeOwnerId = DB::table('ideation_challenges')
                        ->where('id', $challengeId)
                        ->where('tenant_id', $tenantId)
                        ->value('user_id');

                    if (! is_numeric($challengeOwnerId)) {
                        Log::error('Safeguarding recipient lookup failed.', [
                            'tenant_id' => $tenantId,
                            'channel' => 'ideation_challenge_favorite',
                            'challenge_id' => $challengeId,
                        ]);

                        throw new SafeguardingPolicyException(
                            'SAFEGUARDING_POLICY_UNAVAILABLE',
                            __('safeguarding.errors.policy_unavailable'),
                        );
                    }

                    $challengeOwnerId = (int) $challengeOwnerId;
                    if ($challengeOwnerId !== $userId) {
                        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                            $userId,
                            $challengeOwnerId,
                            $tenantId,
                            'ideation_challenge_favorite',
                        );
                    }

                    DB::table('challenge_favorites')->insert([
                        'challenge_id' => $challengeId,
                        'user_id'      => $userId,
                        'created_at'   => now(),
                    ]);
                    DB::table('ideation_challenges')
                        ->where('id', $challengeId)
                        ->where('tenant_id', $tenantId)
                        ->increment('favorites_count');
                    $favorited = true;
                }

                $updated = DB::table('ideation_challenges')
                    ->where('id', $challengeId)
                    ->where('tenant_id', $tenantId)
                    ->first();

                return [
                    'favorited'       => $favorited,
                    'favorites_count' => (int) ($updated->favorites_count ?? 0),
                ];
            });
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::toggleFavorite error: ' . $e->getMessage());
            return ['favorited' => false];
        }
    }

    /**
     * Duplicate a challenge as a draft copy (admin only).
     */
    public function duplicateChallenge(int $challengeId, int $userId): ?int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (! $this->isAdmin($userId, $tenantId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.challenge_admin_only_duplicate')];
            return null;
        }

        $original = DB::table('ideation_challenges')
            ->where('id', $challengeId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $original) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.challenge_not_found')];
            return null;
        }

        try {
            return DB::table('ideation_challenges')->insertGetId([
                'tenant_id'            => $tenantId,
                'user_id'              => $userId,
                'title'                => '[Copy] ' . ($original->title ?? 'Untitled'),
                'description'          => $original->description ?? '',
                'category'             => $original->category ?? null,
                'category_id'          => $original->category_id ?? null,
                'tags'                 => $original->tags ?? null,
                'cover_image'          => $original->cover_image ?? null,
                'prize_description'    => $original->prize_description ?? null,
                'max_ideas_per_user'   => $original->max_ideas_per_user ?? null,
                'evaluation_criteria'  => $original->evaluation_criteria ?? null,
                'status'               => 'draft',
                'ideas_count'          => 0,
                'favorites_count'      => 0,
                'views_count'          => 0,
                'is_featured'          => 0,
                'submission_deadline'  => null,
                'voting_deadline'      => null,
                'created_at'           => now(),
            ]);
        } catch (\Exception $e) {
            Log::error('IdeationChallengeService::duplicateChallenge error: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.challenge_duplicate_failed')];
            return null;
        }
    }

    /**
     * Get all tags used across challenges for this tenant.
     */
    public function getAllTags(): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('challenge_tag_links as ctl')
            ->join('challenge_tags as ct', 'ctl.tag_id', '=', 'ct.id')
            ->join('ideation_challenges as c', 'ctl.challenge_id', '=', 'c.id')
            ->where('c.tenant_id', $tenantId)
            ->groupBy('ct.name')
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->orderBy('ct.name')
            ->select('ct.name as tag', DB::raw('COUNT(*) as count'))
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    // ================================================================
    // HELPERS
    // ================================================================

    private function isAdmin(int $userId, int $tenantId): bool
    {
        $role = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('role');

        return in_array($role ?? '', ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin']);
    }

    private function canViewChallengeRecord(object $challenge, ?int $viewerId): bool
    {
        if (in_array((string) ($challenge->status ?? ''), self::MEMBER_VISIBLE_STATUSES, true)) {
            return true;
        }

        if ($viewerId === null) {
            return false;
        }

        if ((int) ($challenge->user_id ?? 0) === $viewerId) {
            return true;
        }

        return $this->isAdmin($viewerId, TenantContext::getId());
    }

    // ================================================================
    // NOTIFICATION HELPERS
    // ================================================================

    private function notifyIdeaSubmitted(int $challengeId, int $ideaId, int $submitterId, string $ideaTitle): void
    {
        try {
            $tenantId = TenantContext::getId();

            $challenge = DB::table('ideation_challenges')
                ->where('id', $challengeId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (! $challenge || (int) $challenge->user_id === $submitterId) {
                return;
            }

            $submitter = DB::table('users')
                ->where('id', $submitterId)
                ->where('tenant_id', $tenantId)
                ->select(['name', 'email'])
                ->first();

            $owner = DB::table('users')
                ->where('id', $challenge->user_id)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (! $owner) {
                return;
            }

            LocaleContext::withLocale($owner, function () use ($owner, $submitter, $challenge, $challengeId, $ideaId, $ideaTitle, $tenantId) {
                $submitterName = $submitter->name ?? __('emails.common.fallback_someone');

                $message = __('notifications.ideation_idea_submitted', [
                    'name' => $submitterName,
                    'title' => strlen($ideaTitle) > 50 ? substr($ideaTitle, 0, 50) . '...' : $ideaTitle,
                    'challenge' => $challenge->title ?? '',
                ]);
                $link = '/ideation/' . $challengeId;

                Notification::createNotification((int) $challenge->user_id, $message, $link, 'ideation_idea_submitted');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($challenge->user_id), 'ideation_idea_submitted', $message, $link);

                if ($owner->email) {
                    try {
                        $tenantName  = TenantContext::getSetting('site_name', __('emails.common.platform_name'));
                        $firstName   = $owner->first_name ?? $owner->name ?? __('emails.common.fallback_name');
                        $challengeTitle = $challenge->title ?? '';
                        $ideaUrl     = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/ideation/' . $challengeId . '/ideas/' . $ideaId;

                        $html = EmailTemplateBuilder::make()
                            ->theme('brand')
                            ->title(__('emails_ideation.new_idea.title'))
                            ->previewText(__('emails_ideation.new_idea.preview', ['submitter' => $submitterName, 'challenge' => $challengeTitle]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_ideation.new_idea.body', ['submitter' => $submitterName, 'challenge' => $challengeTitle]))
                            ->highlight($ideaTitle)
                            ->button(__('emails_ideation.new_idea.cta'), $ideaUrl)
                            ->render();

                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $owner->email,
                            __('emails_ideation.new_idea.subject', ['challenge' => $challengeTitle, 'community' => $tenantName]),
                            $html,
                            null,
                            null,
                            null,
                            'ideation',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[IdeationChallengeService] idea submitted email returned false', [
                                'idea_id' => $ideaId,
                                'owner_id' => $owner->id ?? null,
                            ]);
                        }
                    } catch (\Throwable $emailEx) {
                        Log::warning('[IdeationChallengeService] idea submitted email failed: ' . $emailEx->getMessage());
                    }
                }
            });
        } catch (\Throwable $e) {
            Log::warning("IdeationChallengeService::notifyIdeaSubmitted error: " . $e->getMessage());
        }
    }

    private function notifyIdeaVoted(int $ideaId, int $ideaAuthorId, int $voterId, string $ideaTitle): void
    {
        if ($ideaAuthorId === $voterId) {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $voter = DB::table('users')
                ->where('id', $voterId)
                ->where('tenant_id', $tenantId)
                ->select(['name'])
                ->first();

            $owner = DB::table('users')
                ->where('id', $ideaAuthorId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (! $owner) {
                return;
            }

            $idea = DB::table('challenge_ideas as i')
                ->join('ideation_challenges as c', 'c.id', '=', 'i.challenge_id')
                ->where('i.id', $ideaId)
                ->where('c.tenant_id', $tenantId)
                ->select('i.challenge_id')
                ->first();
            if (! $idea) {
                return;
            }
            $challengeId = $idea->challenge_id ?? 0;

            LocaleContext::withLocale($owner, function () use ($owner, $voter, $ideaAuthorId, $ideaTitle, $challengeId, $tenantId) {
                $voterName = $voter->name ?? __('emails.common.fallback_someone');

                $message = __('notifications.ideation_idea_voted', [
                    'name' => $voterName,
                    'title' => strlen($ideaTitle) > 50 ? substr($ideaTitle, 0, 50) . '...' : $ideaTitle,
                ]);
                $link = '/ideation/' . $challengeId;

                Notification::createNotification($ideaAuthorId, $message, $link, 'ideation_idea_voted');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($ideaAuthorId), 'ideation_idea_voted', $message, $link);

                if ($owner->email) {
                    $this->sendIdeationEmail(
                        $owner,
                        __('notifications.ideation_email_idea_voted_title'),
                        __('notifications.ideation_email_idea_voted_subtitle', ['name' => $voterName]),
                        '"' . htmlspecialchars($ideaTitle) . '"',
                        __('notifications.ideation_email_view_idea'),
                        $link,
                        $tenantId
                    );
                }
            });
        } catch (\Throwable $e) {
            Log::warning("IdeationChallengeService::notifyIdeaVoted error: " . $e->getMessage());
        }
    }

    private function notifyIdeaCommented(int $ideaId, int $ideaAuthorId, int $commenterId, string $commentText): void
    {
        if ($ideaAuthorId === $commenterId) {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $commenter = DB::table('users')
                ->where('id', $commenterId)
                ->where('tenant_id', $tenantId)
                ->select(['name'])
                ->first();

            $owner = DB::table('users')
                ->where('id', $ideaAuthorId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (! $owner) {
                return;
            }

            $idea = DB::table('challenge_ideas as i')
                ->join('ideation_challenges as c', 'c.id', '=', 'i.challenge_id')
                ->where('i.id', $ideaId)
                ->where('c.tenant_id', $tenantId)
                ->select('i.challenge_id', 'i.title')
                ->first();
            if (! $idea) {
                return;
            }
            $challengeId = $idea->challenge_id ?? 0;

            LocaleContext::withLocale($owner, function () use ($owner, $commenter, $idea, $ideaAuthorId, $commentText, $challengeId, $tenantId, $ideaId) {
                $commenterName = $commenter->name ?? __('emails.common.fallback_someone');

                $shortComment = strlen($commentText) > 50 ? substr($commentText, 0, 50) . '...' : $commentText;
                $message = __('notifications.ideation_idea_commented', [
                    'name' => $commenterName,
                    'comment' => $shortComment,
                ]);
                $link = '/ideation/' . $challengeId;

                Notification::createNotification($ideaAuthorId, $message, $link, 'ideation_idea_commented');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($ideaAuthorId), 'ideation_idea_commented', $message, $link);

                if ($owner->email) {
                    try {
                        $tenantName = TenantContext::getSetting('site_name', __('emails.common.platform_name'));
                        $firstName  = $owner->first_name ?? $owner->name ?? __('emails.common.fallback_name');
                        $ideaTitle  = $idea->title ?? '';
                        $commentUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

                        $html = EmailTemplateBuilder::make()
                            ->theme('brand')
                            ->title(__('emails_ideation.idea_commented.title'))
                            ->previewText(__('emails_ideation.idea_commented.preview', ['commenter' => $commenterName]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_ideation.idea_commented.body', ['commenter' => $commenterName, 'title' => $ideaTitle]))
                            ->highlight($shortComment)
                            ->button(__('emails_ideation.idea_commented.cta'), $commentUrl)
                            ->render();

                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $owner->email,
                            __('emails_ideation.idea_commented.subject', ['community' => $tenantName]),
                            $html,
                            null,
                            null,
                            null,
                            'ideation',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[IdeationChallengeService] idea commented email returned false', [
                                'idea_id' => $ideaId,
                                'owner_id' => $owner->id ?? null,
                            ]);
                        }
                    } catch (\Throwable $emailEx) {
                        Log::warning('[IdeationChallengeService] idea commented email failed: ' . $emailEx->getMessage());
                    }
                }
            });
        } catch (\Throwable $e) {
            Log::warning("IdeationChallengeService::notifyIdeaCommented error: " . $e->getMessage());
        }
    }

    private function notifyIdeaStatusChanged(int $ideaId, int $ideaAuthorId, string $newStatus, string $ideaTitle): void
    {
        try {
            $tenantId = TenantContext::getId();

            $owner = DB::table('users')
                ->where('id', $ideaAuthorId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (! $owner) {
                return;
            }

            $idea = DB::table('challenge_ideas as i')
                ->join('ideation_challenges as c', 'c.id', '=', 'i.challenge_id')
                ->where('i.id', $ideaId)
                ->where('c.tenant_id', $tenantId)
                ->select('i.challenge_id')
                ->first();
            if (! $idea) {
                return;
            }
            $challengeId = $idea->challenge_id ?? 0;

            LocaleContext::withLocale($owner, function () use ($owner, $ideaAuthorId, $newStatus, $ideaTitle, $challengeId, $tenantId) {
                $statusLabel = match ($newStatus) {
                    'shortlisted' => __('notifications.ideation_status_shortlisted'),
                    'winner' => __('notifications.ideation_status_winner'),
                    'withdrawn' => __('notifications.ideation_status_withdrawn'),
                    default => $newStatus,
                };

                $message = __('notifications.ideation_idea_status_changed', [
                    'title' => strlen($ideaTitle) > 50 ? substr($ideaTitle, 0, 50) . '...' : $ideaTitle,
                    'status' => $statusLabel,
                ]);
                $link = '/ideation/' . $challengeId;

                $type = $newStatus === 'winner' ? 'ideation_idea_won' : 'ideation_idea_status';
                Notification::createNotification($ideaAuthorId, $message, $link, $type);
                \App\Services\NotificationDispatcher::fanOutPush((int) ($ideaAuthorId), (string) $type, $message, $link);

                if ($owner->email) {
                    $emailTitle = $newStatus === 'winner'
                        ? __('notifications.ideation_email_idea_won_title')
                        : __('notifications.ideation_email_idea_status_title');

                    $this->sendIdeationEmail(
                        $owner,
                        $emailTitle,
                        __('notifications.ideation_email_idea_status_subtitle', ['status' => $statusLabel]),
                        '"' . htmlspecialchars($ideaTitle) . '"',
                        __('notifications.ideation_email_view_idea'),
                        $link,
                        $tenantId
                    );
                }
            });
        } catch (\Throwable $e) {
            Log::warning("IdeationChallengeService::notifyIdeaStatusChanged error: " . $e->getMessage());
        }
    }

    private function sendIdeationEmail(object $recipient, string $title, string $subtitle, string $body, string $ctaLabel, string $link, ?int $tenantId = null): void
    {
        try {
            $tenantId = (int) ($tenantId ?? $recipient->tenant_id ?? 0);
            if ($tenantId <= 0) {
                Log::warning('[IdeationChallengeService] missing recipient tenant for ideation email', [
                    'recipient_id' => $recipient->id ?? null,
                ]);
                return;
            }

            TenantContext::runForTenant($tenantId, function () use ($recipient, $title, $subtitle, $body, $ctaLabel, $link, $tenantId): void {
                $tenant = TenantContext::get();
                $tenantName = $tenant['name'] ?? __('emails.common.platform_name');
                $fullLink = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

                $html = \App\Core\EmailTemplateBuilder::make()
                    ->theme('brand')
                    ->title($title)
                    ->paragraph($subtitle)
                    ->paragraph($body)
                    ->button($ctaLabel, $fullLink)
                    ->render();

                $subject = __('notifications.email_subject_with_community', ['title' => $title, 'community' => $tenantName]);
                if (!EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'ideation', ['tenant_id' => $tenantId])) {
                    Log::warning('[IdeationChallengeService] ideation email returned false', [
                        'recipient_id' => $recipient->id ?? null,
                    ]);
                }
            });
        } catch (\Throwable $e) {
            Log::warning("IdeationChallengeService::sendIdeationEmail error: " . $e->getMessage());
        }
    }
}
