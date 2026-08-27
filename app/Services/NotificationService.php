<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Notification;
use App\Support\Events\EventNotificationType;
use Illuminate\Database\Eloquent\Builder;
use App\Support\UserDisplayName;

/**
 * NotificationService — Laravel DI-based service for notification operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class NotificationService
{
    /**
     * Notification type categories for grouping and filtering.
     */
    private const TYPE_CATEGORIES = [
        'messages'     => ['message', 'new_message', 'message_received', 'federation_message'],
        'connections'  => ['connection_request', 'connection_accepted', 'friend_request', 'friend_accepted', 'federation_connection_request', 'federation_connection_accepted'],
        'reviews'      => ['review', 'new_review', 'review_received'],
        'transactions' => ['transaction', 'payment', 'payment_received', 'credits_received', 'federation_transaction'],
        'social'       => ['like', 'comment', 'comment_reply', 'reaction', 'mention', 'post_like', 'post_comment'],
        'groups'       => [
            'group_invite', 'group_join', 'group_join_request', 'group_join_rejected',
            'group_post', 'new_topic', 'new_reply', 'federation_group_join',
        ],
        'listings'     => ['listing', 'listing_interest', 'listing_match', 'listing_expiry', 'hot_match', 'mutual_match'],
        'jobs'         => ['job_application', 'job_application_status'],
        'safeguarding' => ['safeguarding_flag', 'safeguarding_assignment', 'broker_review', 'safeguarding_incident'],
        'system'       => ['system', 'announcement', 'welcome', 'badge', 'achievement', 'level_up'],
        'ideation'     => ['ideation_idea_submitted', 'ideation_idea_voted', 'ideation_idea_commented', 'ideation_idea_status', 'ideation_idea_won'],
        'security'     => ['password_changed', 'email_changed', '2fa_enabled', '2fa_disabled', 'passkey_registered', 'passkey_removed', 'security'],
    ];

    public function __construct(
        private readonly Notification $notification,
    ) {}

    /**
     * Get notifications with cursor-based pagination.
     *
     * @param array{type?: string, unread_only?: bool, cursor?: string|null, limit?: int} $filters
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->notification->newQuery()
            ->where('user_id', $userId);

        if (! empty($filters['unread_only'])) {
            $query->unread();
        }

        if (! empty($filters['type'])) {
            $this->applyCategoryFilter($query, (string) $filters['type']);
        }

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
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
     * Like getAll() but collapses notifications that share a type + link into a
     * single "group" item (e.g. "Alice and 4 others liked your post"). Mirrors
     * NotificationsController::grouped but returns STRUCTURAL data only — the
     * grouped message is rendered by the caller from translatable strings, so it
     * works in every locale. Singles keep is_grouped=false. Tenant scope is
     * applied by the Notification model's global scope.
     *
     * @return array{items: array<int,array<string,mixed>>, cursor: ?string, has_more: bool}
     */
    public function getGroupedNotifications(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->notification->newQuery()->where('user_id', $userId);
        if (! empty($filters['unread_only'])) {
            $query->unread();
        }
        if (! empty($filters['type'])) {
            $this->applyCategoryFilter($query, (string) $filters['type']);
        }
        if ($cursor !== null) {
            $cursorId = base64_decode((string) $cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        // Pull a wider window so grouping has rows to collapse, then paginate the
        // grouped result down to $limit.
        $raw = $query->orderByDesc('id')->limit(200)->get();

        $groups = [];
        foreach ($raw as $n) {
            $key = ($n->type ?? 'system') . ':' . ($n->link ?? 'none');
            $groups[$key][] = $n;
        }

        // First pass: precompute each grouped notification's top-3 actor IDs and
        // collect their union, so every actor can be hydrated in ONE users query.
        // This previously ran a separate users lookup per group (N+1) — a busy
        // bell dropdown fired one query per collapsed group on every poll.
        $groupActorIds = [];
        $allActorIds = [];
        foreach ($groups as $key => $rows) {
            if (count($rows) === 1) {
                continue;
            }
            $ids = [];
            foreach ($rows as $r) {
                $aid = $r->actor_id ?? null;
                if ($aid && ! in_array((int) $aid, $ids, true)) {
                    $ids[] = (int) $aid;
                }
            }
            $top = array_slice($ids, 0, 3);
            $groupActorIds[$key] = $top;
            foreach ($top as $id) {
                $allActorIds[$id] = true;
            }
        }

        $userMap = [];
        if (! empty($allActorIds)) {
            $actorUsers = \Illuminate\Support\Facades\DB::table('users')
                ->where('tenant_id', \App\Core\TenantContext::getId())
                ->whereIn('id', array_keys($allActorIds))
                ->get(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url']);
            foreach ($actorUsers as $u) {
                $userMap[(int) $u->id] = $u;
            }
        }

        $result = [];
        foreach ($groups as $key => $rows) {
            $latest = $rows[0]; // already id DESC
            if (count($rows) === 1) {
                $item = $latest->toArray();
                $item['is_grouped'] = false;
                $result[] = $item;
                continue;
            }

            $allRead = true;
            foreach ($rows as $r) {
                if (! $r->is_read) {
                    $allRead = false;
                    break;
                }
            }

            // Hydrate actors from the prefetched map, preserving most-recent-first
            // order (rows are id DESC, so $groupActorIds already reflects that).
            $actors = [];
            foreach ($groupActorIds[$key] as $aid) {
                $u = $userMap[$aid] ?? null;
                if ($u) {
                    $actors[] = [
                        'id' => (int) $u->id,
                        'name' => $u->name ?: UserDisplayName::resolve($u),
                        'avatar_url' => $u->avatar_url,
                    ];
                }
            }

            $count = count($rows);
            $item = $latest->toArray();
            $item['is_grouped'] = true;
            $item['group_key'] = $key;
            $item['group_count'] = $count;
            $item['actors'] = $actors;
            $item['remaining_count'] = max(0, $count - count($actors));
            $item['all_read'] = $allRead;
            $item['is_read'] = $allRead;
            $item['read_at'] = $allRead
                ? ($latest->created_at?->toIso8601String() ?? now()->toIso8601String())
                : null;
            $item['latest_at'] = $latest->created_at?->toIso8601String();
            $item['notification_ids'] = array_map(static fn ($r) => (int) $r->id, $rows);
            $result[] = $item;
        }

        // Most-recent first by the latest id in each group.
        usort($result, static fn ($a, $b) => ($b['id'] ?? 0) <=> ($a['id'] ?? 0));

        $hasMore = count($result) > $limit;
        $paginated = array_slice($result, 0, $limit);
        $lastId = $paginated !== [] ? (int) ($paginated[count($paginated) - 1]['id'] ?? 0) : 0;

        return [
            'items'    => $paginated,
            'cursor'   => $hasMore && $lastId > 0 ? base64_encode((string) $lastId) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Mark every unread notification in a "type:link" group as read for this
     * user. Mirrors NotificationsController::markGroupRead. Returns the number of
     * rows updated. Tenant scope comes from the Notification model.
     */
    public function markGroupRead(int $userId, string $groupKey): int
    {
        $groupKey = trim(urldecode($groupKey));
        if ($groupKey === '') {
            return 0;
        }

        [$type, $linkPart] = array_pad(explode(':', $groupKey, 2), 2, '');
        $link = ($linkPart === '' || $linkPart === 'none') ? null : $linkPart;

        $query = $this->notification->newQuery()
            ->where('user_id', $userId)
            ->where('type', $type)
            ->where('is_read', false);

        if ($link !== null) {
            $query->where('link', $link);
        } else {
            $query->whereNull('link');
        }

        return (int) $query->update(['is_read' => true]);
    }

    /**
     * Get unread counts grouped by type category.
     *
     * @return array{total: int, categories: array<string, int>}
     */
    public function getCounts(int $userId): array
    {
        $unread = $this->notification->newQuery()
            ->where('user_id', $userId)
            ->unread()
            ->get(['type']);

        // Build flat counts matching legacy response shape:
        // { total, messages, connections, reviews, transactions, social, events, groups, listings, system, other }
        $counts = [
            'total' => 0,
            'messages' => 0,
            'connections' => 0,
            'reviews' => 0,
            'transactions' => 0,
            'social' => 0,
            'events' => 0,
            'groups' => 0,
            'listings' => 0,
            'jobs' => 0,
            'ideation' => 0,
            'safeguarding' => 0,
            'system' => 0,
            'security' => 0,
            'other' => 0,
        ];

        foreach ($unread as $notification) {
            $counts['total']++;
            $categorized = false;

            if (EventNotificationType::matches($notification->type)) {
                $counts['events']++;
                $categorized = true;
            }

            if (! $categorized) {
                foreach (self::TYPE_CATEGORIES as $category => $types) {
                    if (in_array($notification->type, $types, true)) {
                        $counts[$category]++;
                        $categorized = true;
                        break;
                    }
                }
            }

            if (!$categorized) {
                $counts['other']++;
            }
        }

        return $counts;
    }

    /**
     * Mark all notifications as read for a user.
     */
    public function markAllRead(int $userId): int
    {
        // Tenant-scope the bulk write explicitly (defence in depth) rather than
        // relying solely on the model's global scope.
        return $this->notification->newQuery()
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->where('user_id', $userId)
            ->where('is_read', false)
            ->update(['is_read' => true]);
    }

    /**
     * Get a single notification by ID for the given user.
     *
     * @return array|null Notification data or null if not found
     */
    public function getById(int $id, int $userId): ?array
    {
        $notification = $this->notification->newQuery()
            ->where('id', $id)
            ->where('user_id', $userId)
            ->first();

        return $notification?->toArray();
    }

    /**
     * Delete (soft-delete) a notification.
     */
    public function delete(int $id, int $userId): bool
    {
        $notification = $this->notification->newQuery()
            ->where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if ($notification === null) {
            return false;
        }

        return (bool) $notification->delete();
    }

    /**
     * Delete every notification in an optional supported category.
     *
     * Invalid categories are rejected by returning zero rather than falling
     * through to an unfiltered destructive query.
     */
    public function deleteAll(int $userId, ?string $category = null): int
    {
        $query = $this->notification->newQuery()
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->where('user_id', $userId);

        if ($category !== null && $category !== '') {
            if (! $this->applyCategoryFilter($query, $category)) {
                return 0;
            }
        }

        return (int) $query->delete();
    }

    public function supportsCategory(string $category): bool
    {
        return $category === 'events' || isset(self::TYPE_CATEGORIES[$category]);
    }

    /** @return list<string> */
    public function categoryNames(): array
    {
        return array_merge(array_keys(self::TYPE_CATEGORIES), ['events']);
    }

    private function applyCategoryFilter(Builder $query, string $category): bool
    {
        if ($category === 'events') {
            EventNotificationType::applyTo($query);

            return true;
        }

        $types = self::TYPE_CATEGORIES[$category] ?? null;
        if ($types === null) {
            return false;
        }

        $query->whereIn('type', $types);

        return true;
    }
}
