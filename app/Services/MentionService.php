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
use App\Support\UserDisplayName;

/**
 * MentionService — Handles @mention extraction, resolution, storage, and notifications.
 *
 * Supports mentions in posts, comments, and messages. All queries are
 * tenant-scoped via TenantContext::getId().
 */
class MentionService
{
    /**
     * Extract @mentions from text content.
     *
     * Matches @username patterns where username can contain letters, numbers,
     * underscores, dots, and hyphens.
     *
     * @return string[] Array of unique usernames (without the @ prefix)
     */
    public static function extractMentions(string $text): array
    {
        preg_match_all('/@([a-zA-Z0-9_.\-]+)/', $text, $matches);

        return array_unique($matches[1] ?? []);
    }

    /**
     * Resolve usernames to user IDs within the current tenant.
     *
     * Searches by username, first_name, name, and last_name to maximize
     * the chance of finding the right user (users may type display names).
     *
     * @param string[] $usernames Usernames to resolve
     * @return array<string, int> Map of username => user ID
     */
    public static function resolveMentions(array $usernames, int $tenantId): array
    {
        if (empty($usernames)) {
            return [];
        }

        // Batch query: fetch all potential matches in one query instead of N queries
        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', '!=', 'banned')
            ->whereNull('deleted_at')
            ->where(function ($q) use ($usernames) {
                $q->whereIn('username', $usernames)
                  ->orWhereIn('first_name', $usernames)
                  ->orWhereIn('name', $usernames)
                  ->orWhereIn('last_name', $usernames);
            })
            ->select(['id', 'username', 'first_name', 'name', 'last_name', 'profile_type', 'organization_name'])
            ->get();

        // Map each mentioned username to the best matching user
        $resolved = [];
        foreach ($usernames as $username) {
            $lowerUsername = strtolower($username);
            foreach ($users as $user) {
                if (
                    strtolower($user->username ?? '') === $lowerUsername
                    || strtolower($user->first_name ?? '') === $lowerUsername
                    || strtolower($user->name ?? '') === $lowerUsername
                    || strtolower($user->last_name ?? '') === $lowerUsername
                ) {
                    $resolved[$username] = (int) $user->id;
                    break;
                }
            }
        }

        return $resolved;
    }

    /**
     * Create mention records and send notifications.
     *
     * @param int    $entityId       The ID of the post/comment/message
     * @param string $entityType     One of: 'post', 'comment', 'message'
     * @param int    $mentionerId    The user who created the mention
     * @param int[]  $mentionedUserIds  Users who were mentioned
     * @param string $textPreview    Preview text for the notification (first 100 chars)
     */
    public static function createMentions(
        int $entityId,
        string $entityType,
        int $mentionerId,
        array $mentionedUserIds,
        string $textPreview = ''
    ): void {
        $tenantId = TenantContext::getId();

        // Get mentioner's name for notification message
        $mentioner = DB::table('users')
            ->where('id', $mentionerId)
            ->where('tenant_id', $tenantId)
            ->select(['name', 'first_name'])
            ->first();

        $mentionerName = $mentioner->name ?? $mentioner->first_name ?? __('emails.common.fallback_someone');

        // Batch-load preferred_language for every mentioned user so we can render
        // each recipient's bell text in their own locale.
        $recipientLocales = [];
        if (!empty($mentionedUserIds)) {
            $recipientRows = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $mentionedUserIds)
                ->select(['id', 'preferred_language'])
                ->get();
            foreach ($recipientRows as $row) {
                $recipientLocales[(int) $row->id] = $row->preferred_language ?? null;
            }
        }

        foreach ($mentionedUserIds as $mentionedUserId) {
            // Don't notify yourself
            if ($mentionedUserId === $mentionerId) {
                continue;
            }

            try {
                // For backward compatibility, set comment_id when entity_type is 'comment'
                $commentId = $entityType === 'comment' ? $entityId : null;

                DB::table('mentions')->insert([
                    'comment_id'        => $commentId,
                    'mentioned_user_id' => $mentionedUserId,
                    'mentioning_user_id' => $mentionerId,
                    'tenant_id'         => $tenantId,
                    'entity_type'       => $entityType,
                    'entity_id'         => $entityId,
                    'created_at'        => now(),
                ]);

                // Build notification — render under the mentioned user's preferred locale.
                $shortPreview = mb_strlen($textPreview) > 100
                    ? mb_substr($textPreview, 0, 100) . '...'
                    : $textPreview;

                $link = self::getEntityLink($entityType, $entityId);
                $recipientLocale = $recipientLocales[(int) $mentionedUserId] ?? null;

                LocaleContext::withLocale($recipientLocale, function () use ($entityType, $mentionerName, $shortPreview, $mentionedUserId, $link) {
                    $entityLabel = self::getEntityLabel($entityType);
                    if ($shortPreview) {
                        $message = __('svc_notifications.mention.mentioned_in_with_preview', ['name' => $mentionerName, 'entity' => $entityLabel, 'preview' => $shortPreview]);
                    } else {
                        $message = __('svc_notifications.mention.mentioned_in', ['name' => $mentionerName, 'entity' => $entityLabel]);
                    }

                    Notification::createNotification(
                        $mentionedUserId,
                        $message,
                        $link,
                        'mention'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($mentionedUserId), 'mention', $message, $link);
                });
            } catch (\Exception $e) {
                // Ignore duplicate mention errors, log others
                Log::debug("MentionService::createMentions error: " . $e->getMessage());
            }
        }
    }

    /**
     * Get all mentions for a specific entity.
     *
     * @return array[] Array of mention records with user info
     */
    public static function getMentionsForEntity(int $entityId, string $entityType): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('mentions as m')
            ->join('users as u', 'm.mentioned_user_id', '=', 'u.id')
            ->where('m.tenant_id', $tenantId)
            ->where('m.entity_type', $entityType)
            ->where('m.entity_id', $entityId)
            ->select([
                'm.id',
                'm.mentioned_user_id as user_id',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.name',
                'u.username',
                'u.avatar_url',
                'm.created_at',
            ])
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get all entities where a user was mentioned.
     *
     * @return array[] Array of mention records with mentioner info
     */
    public static function getMentionsForUser(int $userId, int $limit = 20, ?string $cursor = null): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('mentions as m')
            ->join('users as mu', 'm.mentioning_user_id', '=', 'mu.id')
            ->where('m.tenant_id', $tenantId)
            ->where('m.mentioned_user_id', $userId)
            ->select([
                'm.id',
                'm.entity_type',
                'm.entity_id',
                'm.mentioning_user_id as mentioner_id',
                DB::raw("COALESCE(mu.name, CONCAT(mu.first_name, ' ', mu.last_name)) as mentioner_name"),
                'mu.avatar_url as mentioner_avatar',
                'm.seen_at',
                'm.created_at',
            ])
            ->orderByDesc('m.created_at');

        if ($cursor !== null) {
            $decodedCursor = base64_decode($cursor, true);
            if ($decodedCursor !== false) {
                $query->where('m.id', '<', (int) $decodedCursor);
            }
        }

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $nextCursor = $hasMore && $items->isNotEmpty()
            ? base64_encode((string) $items->last()->id)
            : null;

        return [
            'items'    => $items->map(fn ($r) => (array) $r)->all(),
            'cursor'   => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Search users for @mention autocomplete.
     *
     * Searches by name, first_name, last_name, and username. Prioritizes
     * users who are connections of the searching user. Excludes banned
     * and blocked users.
     *
     * @return array[] Array of user records for autocomplete
     */
    public static function searchUsers(string $query, int $tenantId, int $currentUserId = 0, int $limit = 10): array
    {
        $searchTerm = '%' . $query . '%';

        // Build subquery for connection status (prioritize connections).
        // Binding order must match the SQL placeholder order:
        //   1. Connection subquery placeholders (if currentUserId > 0)
        //   2. WHERE clause placeholders (tenant_id, 4x search term)
        //   3. Exclude self (if currentUserId > 0)
        //   4. LIMIT
        $connectionSubquery = '';
        $bindings = [];

        if ($currentUserId > 0) {
            $connectionSubquery = ", (
                SELECT 1 FROM connections c
                WHERE c.tenant_id = u.tenant_id
                  AND c.status = 'accepted'
                  AND (
                    (c.requester_id = ? AND c.receiver_id = u.id)
                    OR (c.receiver_id = ? AND c.requester_id = u.id)
                  )
                LIMIT 1
            ) as is_connection";
            $bindings[] = $currentUserId;
            $bindings[] = $currentUserId;
        }

        $sql = "SELECT u.id, COALESCE(u.name, CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) as name,
                       u.username, u.avatar_url, u.first_name, u.last_name
                       {$connectionSubquery}
                FROM users u
                WHERE u.tenant_id = ?
                  AND u.status != 'banned'
                  AND u.deleted_at IS NULL
                  AND (u.name LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ?)";

        // WHERE bindings
        $bindings[] = $tenantId;
        $bindings[] = $searchTerm;
        $bindings[] = $searchTerm;
        $bindings[] = $searchTerm;
        $bindings[] = $searchTerm;

        // Exclude the current user from results
        if ($currentUserId > 0) {
            $sql .= " AND u.id != ?";
            $bindings[] = $currentUserId;
        }

        // Order: connections first, then alphabetical
        if ($currentUserId > 0) {
            $sql .= " ORDER BY is_connection DESC, u.first_name ASC";
        } else {
            $sql .= " ORDER BY u.first_name ASC";
        }

        $sql .= " LIMIT ?";
        $bindings[] = $limit;

        $results = DB::select($sql, $bindings);

        return array_map(function ($user) {
            return [
                'id'            => (int) $user->id,
                'name'          => $user->name ?? UserDisplayName::resolve($user),
                'username'      => $user->username,
                'avatar_url'    => $user->avatar_url,
                'is_connection' => (bool) ($user->is_connection ?? false),
            ];
        }, $results);
    }

    /**
     * Process mentions in a text body: extract, resolve, and create records.
     *
     * Convenience method that chains extractMentions → resolveMentions → createMentions.
     *
     * @return int Number of mentions created
     */
    public static function processText(
        string $text,
        int $entityId,
        string $entityType,
        int $mentionerId
    ): int {
        $tenantId = TenantContext::getId();
        $usernames = self::extractMentions($text);

        if (empty($usernames)) {
            return 0;
        }

        $resolved = self::resolveMentions($usernames, $tenantId);

        if (empty($resolved)) {
            return 0;
        }

        $preview = mb_substr(strip_tags($text), 0, 100);
        self::createMentions($entityId, $entityType, $mentionerId, array_values($resolved), $preview);

        return count($resolved);
    }

    /**
     * Delete all mentions for an entity (used when editing content).
     */
    public static function deleteMentionsForEntity(int $entityId, string $entityType): void
    {
        $tenantId = TenantContext::getId();

        DB::table('mentions')
            ->where('tenant_id', $tenantId)
            ->where('entity_type', $entityType)
            ->where('entity_id', $entityId)
            ->delete();
    }

    /**
     * Mark mentions as seen for a user.
     */
    public static function markAsSeen(int $userId, array $mentionIds): void
    {
        $tenantId = TenantContext::getId();

        DB::table('mentions')
            ->where('tenant_id', $tenantId)
            ->where('mentioned_user_id', $userId)
            ->whereIn('id', $mentionIds)
            ->whereNull('seen_at')
            ->update(['seen_at' => now()]);
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private static function getEntityLabel(string $entityType): string
    {
        return match ($entityType) {
            'post'    => 'post',
            'comment' => 'comment',
            'message' => 'message',
            default   => 'content',
        };
    }

    private static function getEntityLink(string $entityType, int $entityId): string
    {
        return match ($entityType) {
            'post'    => '/feed',
            'comment' => '/feed',
            'message' => '/messages',
            default   => '/',
        };
    }
}
