<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\PollClosedException;
use App\Models\Poll;
use Illuminate\Support\Facades\DB;
use App\Support\FeedItemTables;
use App\Support\UserDisplayName;

/**
 * PollService — Eloquent-based service for poll operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class PollService
{
    public function __construct(
        private readonly Poll $poll,
    ) {}

    /**
     * Get polls with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getAll(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = Poll::query()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url']);

        if (($filters['status'] ?? null) === 'open') {
            $query->where(function ($q) {
                $q->whereNull('end_date')->orWhere('end_date', '>', now());
            });
        } elseif (($filters['status'] ?? null) === 'closed') {
            $query->where('end_date', '<=', now());
        }

        if (! empty($filters['user_id'])) {
            $query->where('user_id', (int) $filters['user_id']);
        }

        if (! empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }

        if (! empty($filters['event_id'])) {
            $query->where('event_id', (int) $filters['event_id']);
        }

        // F-069: a poll posted into a group carries that group on its
        // feed_activity row (`polls` has no group_id). Leave out polls whose
        // group the viewer may not see. A caller that passes no viewer_id gets
        // community-wide polls only.
        $tenantId = (int) TenantContext::getId();
        $viewerId = ! empty($filters['viewer_id']) ? (int) $filters['viewer_id'] : null;
        $hiddenGroupIds = self::pollGroupIdsHiddenFrom($viewerId, $tenantId);
        if ($hiddenGroupIds !== []) {
            $query->whereNotExists(function ($q) use ($tenantId, $hiddenGroupIds) {
                $q->select(DB::raw(1))
                    ->from('feed_activity as fa')
                    ->whereColumn('fa.source_id', 'polls.id')
                    ->where('fa.tenant_id', $tenantId)
                    ->where('fa.source_type', 'poll')
                    ->whereIn('fa.group_id', $hiddenGroupIds);
            });
        }

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single poll by ID with vote counts and user-voted flag.
     */
    public static function getById(int $id, ?int $currentUserId = null): ?array
    {
        $poll = Poll::query()
            ->with(['user:id,first_name,last_name,organization_name,profile_type,avatar_url'])
            ->find($id);
        if (! $poll) {
            return null;
        }

        // Tenant scope is enforced via the Poll model's HasTenantScope global
        // scope. The poll_options/poll_votes tables also carry tenant_id and
        // are explicitly scoped below for defense in depth.
        $tenantId = \App\Core\TenantContext::getId();

        // F-069: a poll posted into a group is readable only by those who may
        // see that group's content. Every poll read, vote and ranking goes
        // through this loader, so the gate covers all of them.
        if (! self::viewerCanSeePollGroup((int) $poll->id, $currentUserId, (int) $tenantId)) {
            return null;
        }

        $data = $poll->toArray();

        // Replace eager-loaded user relation with safe public fields only
        $pollUser = $poll->user;
        if ($pollUser) {
            $data['user'] = [
                'id'         => $pollUser->id,
                'name'       => ($pollUser->profile_type === 'organisation' && $pollUser->organization_name)
                                    ? $pollUser->organization_name
                                    : UserDisplayName::resolve($pollUser),
                'avatar'     => $pollUser->avatar_url,
                'avatar_url' => $pollUser->avatar_url,
            ];
        }

        // Ballot integrity: hide per-option counts while the poll is still
        // open to anyone other than the creator. Seeing running totals mid-
        // vote lets early voters influence later voters and encourages
        // strategic (rather than sincere) voting. Totals become visible
        // once the poll's end_date has passed.
        $isClosed = ! $poll->is_active
            || (!empty($poll->end_date) && strtotime((string) $poll->end_date) <= time());
        $isCreator = $currentUserId !== null && (int) $poll->user_id === (int) $currentUserId;
        $canSeeCounts = $isClosed || $isCreator;

        $rawOptions = DB::table('poll_options')
            ->where('poll_id', $id)
            ->where('tenant_id', $tenantId)
            ->get();

        // Single GROUP BY query replaces 1-per-option count(): scoped to this poll's
        // option ids AND tenant_id so cross-tenant rows can't leak in.
        $voteCountByOption = [];
        if ($canSeeCounts && $rawOptions->isNotEmpty()) {
            $optionIds = $rawOptions->pluck('id')->all();
            $voteCountByOption = DB::table('poll_votes')
                ->where('tenant_id', $tenantId)
                ->where('poll_id', $id)
                ->whereIn('option_id', $optionIds)
                ->selectRaw('option_id, COUNT(*) as cnt')
                ->groupBy('option_id')
                ->pluck('cnt', 'option_id')
                ->all();
        }

        $optionRows = $rawOptions->map(fn ($o) => [
            'id'         => $o->id,
            'text'       => $o->label ?? $o->option_text ?? '',
            'label'      => $o->label ?? $o->option_text ?? '',
            'vote_count' => $canSeeCounts
                ? (int) ($voteCountByOption[$o->id] ?? 0)
                : null,
        ])->all();

        // total_votes is safe to expose (only reveals participation volume,
        // not the distribution) — but per-option numbers stay hidden.
        $totalVotes = $canSeeCounts
            ? array_sum(array_column($optionRows, 'vote_count'))
            : (int) DB::table('poll_votes')
                ->where('poll_id', $id)
                ->where('tenant_id', $tenantId)
                ->count();

        $data['options'] = array_map(function (array $opt) use ($totalVotes, $canSeeCounts) {
            if ($canSeeCounts) {
                $opt['percentage'] = $totalVotes > 0
                    ? round(($opt['vote_count'] / $totalVotes) * 100, 1)
                    : 0;
            } else {
                $opt['vote_count'] = null;
                $opt['percentage'] = null;
            }
            return $opt;
        }, $optionRows);

        $data['total_votes'] = $totalVotes;
        $data['results_visible'] = $canSeeCounts;
        // Expose ownership so frontends can show owner-only controls (e.g. delete).
        $data['is_creator'] = $isCreator;

        $data['has_voted'] = $currentUserId
            ? DB::table('poll_votes')
                ->where('poll_id', $id)
                ->where('tenant_id', $tenantId)
                ->where('user_id', $currentUserId)
                ->exists()
            : false;

        $votedOptionId = null;
        if ($currentUserId) {
            $vote = DB::table('poll_votes')
                ->where('poll_id', $id)
                ->where('tenant_id', $tenantId)
                ->where('user_id', $currentUserId)
                ->first();
            $votedOptionId = $vote ? (int) $vote->option_id : null;
        }
        $data['voted_option_id'] = $votedOptionId;
        $data['user_vote_option_id'] = $votedOptionId;

        $data['poll_type'] = $data['poll_type'] ?? 'standard';
        $data['user_rankings'] = $currentUserId && $data['poll_type'] === 'ranked'
            ? DB::table('poll_rankings')->where('tenant_id', $tenantId)->where('poll_id', $id)
                ->where('user_id', $currentUserId)->orderBy('rank')->get(['option_id', 'rank'])
                ->map(static fn ($ranking): array => [
                    'option_id' => (int) $ranking->option_id, 'rank' => (int) $ranking->rank,
                ])->all()
            : [];
        if ($data['poll_type'] === 'ranked') {
            $data['has_voted'] = $data['user_rankings'] !== [];
        }

        // Compute status for frontend
        $endDate = $poll->end_date ?? null;
        $data['status'] = ($poll->is_active && (! $endDate || now()->lt($endDate))) ? 'open' : 'closed';
        $data['expires_at'] = $endDate ? (string) $endDate : null;

        // Normalise creator field from loaded user relation
        $user = $poll->user;
        $data['creator'] = $user ? [
            'id'         => (int) $user->id,
            'name'       => UserDisplayName::resolve($user),
            'avatar_url' => $user->avatar_url ?? null,
        ] : ['id' => (int) $poll->user_id, 'name' => __('api.unknown_user'), 'avatar_url' => null];

        return $data;
    }

    /**
     * Create a new poll with options.
     */
    public static function create(int $userId, array $data): Poll
    {
        $endDate = $data['expires_at'] ?? $data['end_date'] ?? null;
        if (!empty($endDate)) {
            $endTimestamp = strtotime($endDate);
            if ($endTimestamp === false || $endTimestamp <= time()) {
                throw new \InvalidArgumentException(__('api.poll_end_date_future'));
            }
        }

        return DB::transaction(function () use ($userId, $data, $endDate) {
            $poll = new Poll([
                'user_id'     => $userId,
                'event_id'    => $data['event_id'] ?? null,
                'question'    => trim($data['question']),
                'description' => trim($data['description'] ?? ''),
                'end_date'    => $endDate,
                'is_active'   => true,
                'category'    => $data['category'] ?? null,
                'poll_type'   => $data['poll_type'] ?? 'standard',
                'is_anonymous' => (bool) ($data['is_anonymous'] ?? false),
            ]);
            $poll->save();

            if (! empty($data['options'])) {
                foreach ($data['options'] as $text) {
                    // C6: Only insert columns that exist in poll_options schema
                    // (id, poll_id, tenant_id, label, votes — no created_at)
                    DB::table('poll_options')->insert([
                        'poll_id'   => $poll->id,
                        'tenant_id' => TenantContext::getId(),
                        'label'     => trim($text),
                    ]);
                }
            }

            return $poll->fresh(['user']);
        });
    }

    /**
     * Update a poll (owner only, no votes yet).
     */
    public static function update(int $id, int $userId, array $data): ?Poll
    {
        $poll = Poll::query()->find($id);

        if (! $poll || (int) $poll->user_id !== $userId) {
            return null;
        }

        $allowed = ['question', 'description', 'end_date', 'expires_at', 'category'];
        $updates = collect($data)->only($allowed)->all();
        if (isset($updates['expires_at'])) {
            $updates['end_date'] = $updates['expires_at'];
            unset($updates['expires_at']);
        }
        $poll->fill($updates);
        $poll->save();

        return $poll->fresh(['user']);
    }

    /**
     * Delete a poll (owner only).
     */
    public static function delete(int $id, int $userId): bool
    {
        $poll = Poll::query()->find($id);

        if (! $poll || (int) $poll->user_id !== $userId) {
            return false;
        }

        return (bool) $poll->delete();
    }

    /**
     * Cast a vote on a poll option.
     *
     * M1: Wrapped in DB transaction to prevent TOCTOU race conditions.
     * C4: Validates option_id belongs to this poll and tenant.
     * C5: Prevents voting on expired polls.
     *
     * @return bool true if vote was cast, false if already voted
     */
    public static function vote(int $pollId, int $optionId, int $userId): bool
    {
        return DB::transaction(function () use ($pollId, $optionId, $userId) {
            $tenantId = TenantContext::getId();

            // C5: Fetch poll with end_date to enforce expiry check
            $poll = DB::selectOne(
                'SELECT id, user_id, end_date, poll_type FROM polls WHERE id = ? AND tenant_id = ?',
                [$pollId, $tenantId]
            );
            if (!$poll) {
                throw new \RuntimeException('Poll not found');
            }
            if (($poll->poll_type ?? 'standard') !== 'standard') {
                throw new \InvalidArgumentException('Ranked polls require a ranked ballot');
            }

            // C5: Prevent voting on expired polls
            if (!empty($poll->end_date) && strtotime($poll->end_date) <= time()) {
                // Typed so the controllers can answer 409 without catching
                // RuntimeException at large (QueryException is one too).
                throw new PollClosedException('This poll has closed');
            }

            // C4: Validate that the option belongs to this poll and tenant
            $option = DB::selectOne(
                'SELECT id FROM poll_options WHERE id = ? AND poll_id = ? AND tenant_id = ?',
                [$optionId, $pollId, $tenantId]
            );
            if (!$option) {
                throw new \InvalidArgumentException('Invalid poll option');
            }

            $existingVote = DB::selectOne(
                'SELECT id FROM poll_votes WHERE tenant_id = ? AND poll_id = ? AND user_id = ?',
                [$tenantId, $pollId, $userId]
            );
            if ($existingVote) {
                return false;
            }

            if ((int) $poll->user_id !== $userId) {
                // F-158: a vote notifies the poll's creator, so it obeys the
                // block rule as well as the safeguarding contact rule.
                BlockUserService::assertNoBlockBetween($userId, (int) $poll->user_id);
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    (int) $poll->user_id,
                    (int) $tenantId,
                    'poll_vote',
                );
            }

            // Use INSERT IGNORE to atomically prevent double-votes.
            // The idx_vote_unique (poll_id, user_id) constraint enforces uniqueness;
            // INSERT IGNORE silently skips if the row already exists.
            //
            // tenant_id MUST be set explicitly — column defaults to 0, and the
            // unique key is (tenant_id, poll_id, user_id). Without this every
            // tenant's votes would collide at tenant_id=0.
            $affected = DB::affectingStatement(
                'INSERT IGNORE INTO poll_votes (tenant_id, poll_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?, NOW())',
                [$tenantId, $pollId, $optionId, $userId]
            );

            if ($affected > 0) {
                $reference = 'poll:' . $pollId;
                GamificationService::awardXP(
                    $userId,
                    GamificationService::XP_VALUES['vote_poll'],
                    'vote_poll',
                    'Voted on a poll',
                    $reference,
                );
                $xpPersisted = DB::table('user_xp_log')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->where('action', 'vote_poll')
                    ->where('source_reference', $reference)
                    ->exists();
                if (! $xpPersisted) {
                    throw new \RuntimeException('Poll vote XP did not persist.');
                }
            }

            return $affected > 0;
        });
    }

    /**
     * Get validation errors.
     *
     * The legacy PollService used a static error collector; in Laravel,
     * validation is handled by Laravel's Validator, so this returns an
     * empty array for backward-compatibility with any callers.
     */
    public static function getErrors(): array
    {
        return [];
    }

    /**
     * Get distinct poll categories for the current tenant.
     */
    public static function getCategories(): array
    {
        return Poll::query()
            ->whereNotNull('category')
            ->where('category', '!=', '')
            ->distinct()
            ->pluck('category')
            ->sort()
            ->values()
            ->all();
    }

    /**
     * Can this viewer see the group (if any) the poll was posted into?
     * Uses the same group rule as every other feed item (FeedItemTables::canViewGroup).
     */
    private static function viewerCanSeePollGroup(int $pollId, ?int $viewerId, int $tenantId): bool
    {
        $groupId = DB::table('feed_activity')
            ->where('tenant_id', $tenantId)
            ->where('source_type', 'poll')
            ->where('source_id', $pollId)
            ->whereNotNull('group_id')
            ->value('group_id');

        return FeedItemTables::canViewGroup($groupId !== null ? (int) $groupId : null, $viewerId, $tenantId);
    }

    /**
     * Groups that have polls in them and whose content this viewer may not see.
     *
     * @return list<int>
     */
    private static function pollGroupIdsHiddenFrom(?int $viewerId, int $tenantId): array
    {
        $groupIds = DB::table('feed_activity')
            ->where('tenant_id', $tenantId)
            ->where('source_type', 'poll')
            ->whereNotNull('group_id')
            ->distinct()
            ->pluck('group_id');

        $hidden = [];
        foreach ($groupIds as $groupId) {
            if (! FeedItemTables::canViewGroup((int) $groupId, $viewerId, $tenantId)) {
                $hidden[] = (int) $groupId;
            }
        }

        return $hidden;
    }
}
