<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Poll;
use Illuminate\Support\Facades\DB;
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
        $isClosed = !empty($poll->end_date) && strtotime((string) $poll->end_date) <= time();
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
                'SELECT id, user_id, end_date FROM polls WHERE id = ? AND tenant_id = ?',
                [$pollId, $tenantId]
            );
            if (!$poll) {
                throw new \RuntimeException('Poll not found');
            }

            // C5: Prevent voting on expired polls
            if (!empty($poll->end_date) && strtotime($poll->end_date) <= time()) {
                throw new \RuntimeException('This poll has closed');
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
}
