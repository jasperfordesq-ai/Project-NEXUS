<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GroupMentionService — Handles @mention parsing, notification, and member
 * suggestions within the context of a group.
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class GroupMentionService
{
    /**
     * Extract @username mentions from content and resolve them to valid
     * tenant users.
     *
     * @param string $content Text that may contain @username mentions
     * @return array<int, array{username: string, user_id: int, preferred_language: string|null}> Resolved mentions
     */
    public static function parseMentions(string $content, ?int $groupId = null): array
    {
        preg_match_all('/@(\w+)/', $content, $matches);

        $usernames = array_unique($matches[1] ?? []);

        if (empty($usernames)) {
            return [];
        }

        $tenantId = TenantContext::getId();

        $query = DB::table('users as u')
            ->where('u.tenant_id', $tenantId)
            ->where('u.status', '!=', 'banned')
            ->whereIn('u.username', $usernames)
            ->select(['u.id', 'u.username', 'u.preferred_language']);

        if ($groupId !== null) {
            $query->join('group_members as gm', function ($join) use ($tenantId, $groupId) {
                $join->on('gm.user_id', '=', 'u.id')
                    ->where('gm.tenant_id', '=', $tenantId)
                    ->where('gm.group_id', '=', $groupId)
                    ->where('gm.status', '=', 'active');
            });
        }

        $users = $query->get();

        $results = [];
        foreach ($users as $user) {
            $results[] = [
                'username'           => $user->username,
                'user_id'            => (int) $user->id,
                'preferred_language' => $user->preferred_language ?? null,
            ];
        }

        return $results;
    }

    /**
     * Parse mentions from content and create a notification for each valid
     * mentioned user.
     *
     * @param int    $groupId     The group where the mention occurred
     * @param int    $authorId    The user who authored the content
     * @param string $content     Text that may contain @username mentions
     * @param string $contextType Context label (e.g. 'discussion', 'comment')
     * @param int    $contextId   ID of the contextual entity
     */
    public static function notifyMentioned(
        int $groupId,
        int $authorId,
        string $content,
        string $contextType,
        int $contextId
    ): void {
        $tenantId = TenantContext::getId();

        // Mentions are a child-content write. Do not resolve recipients or
        // emit notifications when the parent is foreign, non-writable, or the
        // author is no longer an active member/administrator.
        if (!GroupAccessService::canWriteContent($groupId, $authorId)) {
            return;
        }

        $mentions = self::parseMentions($content, $groupId);

        if (empty($mentions)) {
            return;
        }

        // Fetch group name for the notification message
        $group = DB::selectOne(
            "SELECT name FROM `groups` WHERE id = ? AND tenant_id = ?",
            [$groupId, $tenantId]
        );

        if (!$group) {
            return;
        }

        $groupName = (string) $group->name;
        $link = '/groups/' . $groupId;

        // F-387: a mention is a notification aimed at one named member, so a
        // block between the author and that member stops it — the same filter
        // feed and comment mentions apply (F-070, MentionService). This is not
        // the group broadcast F-336 deliberately leaves unfiltered.
        $blockedPairIds = array_map('intval', BlockUserService::getBlockedPairIds($authorId));

        foreach ($mentions as $mention) {
            // Don't notify the author about their own mention
            if ($mention['user_id'] === $authorId) {
                continue;
            }
            if (in_array((int) $mention['user_id'], $blockedPairIds, true)) {
                continue;
            }

            try {
                // Render bell in the mentioned user's preferred language.
                LocaleContext::withLocale($mention['preferred_language'] ?? null, function () use ($mention, $groupName, $link) {
                    Notification::createNotification(
                        $mention['user_id'],
                        __('svc_notifications.group_mention.mentioned_in_group', ['group' => $groupName]),
                        $link,
                        'group_mention'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($mention['user_id']), 'group_mention', __('svc_notifications.group_mention.mentioned_in_group', ['group' => $groupName]), $link);
                });
            } catch (\Exception $e) {
                Log::debug("GroupMentionService::notifyMentioned error: " . $e->getMessage());
            }
        }
    }

    /**
     * Search group members for @mention autocomplete.
     *
     * Returns members whose name or username matches the query string,
     * limited to a specific group.
     *
     * @param int    $groupId Group to search within
     * @param int    $viewerId Authorized viewer requesting suggestions
     * @param string $query   Search term to match against name/username
     * @param int    $limit   Maximum results to return
     * @return array<int, array{id: int, name: string, username: string|null, avatar_url: string|null}>
     */
    public static function getMemberSuggestions(int $groupId, int $viewerId, string $query, int $limit = 10): array
    {
        if (!GroupAccessService::canViewMemberContent($groupId, $viewerId)) {
            return [];
        }

        $tenantId = TenantContext::getId();
        $searchTerm = '%' . $query . '%';

        $results = DB::table('group_members as gm')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('gm.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('gm.tenant_id', $tenantId)
            ->where('gm.group_id', $groupId)
            ->where('gm.status', 'active')
            ->where('u.status', '!=', 'banned')
            ->where(function ($builder) use ($searchTerm) {
                $builder->where('u.name', 'LIKE', $searchTerm)
                    ->orWhere('u.first_name', 'LIKE', $searchTerm)
                    ->orWhere('u.last_name', 'LIKE', $searchTerm)
                    ->orWhere('u.username', 'LIKE', $searchTerm);
            })
            ->select([
                'u.id',
                'u.username',
                'u.avatar_url',
            ])
            ->selectRaw("COALESCE(u.name, CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) as name")
            ->orderBy('u.first_name')
            ->limit(max(1, min($limit, 50)))
            ->get()
            ->all();

        return array_map(function ($user) {
            return [
                'id'         => (int) $user->id,
                'name'       => $user->name ?? '',
                'username'   => $user->username,
                'avatar_url' => $user->avatar_url,
            ];
        }, $results);
    }
}
