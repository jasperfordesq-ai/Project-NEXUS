<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\CsvExportSanitizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * GroupDataExportService — GDPR-compliant data export for groups.
 *
 * Exports all group data: members, discussions, files, settings, custom fields.
 * Supports JSON and CSV formats.
 */
class GroupDataExportService
{
    public const SCHEMA_NAME = 'nexus.group-export';
    public const SCHEMA_VERSION = 1;

    /** @var list<string> */
    public const MANIFEST_SECTIONS = [
        'group',
        'settings',
        'members',
        'feed_posts',
        'discussions',
        'announcements',
        'events',
        'files',
        'tags',
        'custom_fields',
        'qa',
        'wiki',
        'media',
        'invitations',
        'webhooks',
        'challenges',
        'chat',
        'tasks',
        'scheduled_posts',
        'notification_preferences',
        'moderation',
        'approval_requests',
        'audit_log',
    ];

    /**
     * Export all data for a group as a structured array.
     */
    public static function exportAll(int $groupId, int $actorUserId): ?array
    {
        $tenantId = TenantContext::getId();

        if (!GroupAccessService::canExport($groupId, $actorUserId)) {
            return null;
        }

        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$group) return null;

        $questions = self::exportRowsForGroup('group_questions', $groupId, $tenantId);
        $questionIds = array_column($questions, 'id');
        $answers = self::exportRowsForIds('group_answers', 'question_id', $questionIds, $tenantId);
        $answerIds = array_column($answers, 'id');

        $wikiPages = self::exportRowsForGroup('group_wiki_pages', $groupId, $tenantId);
        $wikiRevisions = self::exportRowsForIds(
            'group_wiki_revisions',
            'page_id',
            array_column($wikiPages, 'id'),
            $tenantId,
        );

        $challenges = self::exportRowsForGroup('group_challenges', $groupId, $tenantId);
        $challengeRewards = self::exportRowsForIds(
            'group_challenge_rewards',
            'challenge_id',
            array_column($challenges, 'id'),
            $tenantId,
        );

        $chatrooms = self::exportRowsForGroup('group_chatrooms', $groupId, $tenantId);
        $chatroomIds = array_column($chatrooms, 'id');
        $chatMessages = self::exportRowsForIds(
            'group_chatroom_messages',
            'chatroom_id',
            $chatroomIds,
            $tenantId,
        );
        $pinnedChatMessages = self::exportRowsForIds(
            'group_chatroom_pinned_messages',
            'chatroom_id',
            $chatroomIds,
            $tenantId,
        );

        $discussions = self::exportDiscussions($groupId, $tenantId);
        $discussionIds = array_column($discussions, 'id');
        $postIds = [];
        foreach ($discussions as $discussion) {
            foreach ($discussion['posts'] ?? [] as $post) {
                if (isset($post['id'])) {
                    $postIds[] = (int) $post['id'];
                }
            }
        }

        $moderation = self::exportModeration(
            $groupId,
            $tenantId,
            $discussionIds,
            $postIds,
        );

        return [
            'schema' => [
                'name' => self::SCHEMA_NAME,
                'version' => self::SCHEMA_VERSION,
                'sections' => self::MANIFEST_SECTIONS,
            ],
            'export_date' => now()->toIso8601String(),
            'group' => (array) $group,
            'members' => self::exportMembers($groupId, $tenantId),
            'feed_posts' => self::exportRowsForGroup('feed_posts', $groupId, $tenantId),
            'discussions' => $discussions,
            'announcements' => self::exportAnnouncements($groupId, $tenantId),
            'files' => self::exportFileMetadata($groupId, $tenantId),
            'events' => self::exportEvents($groupId, $tenantId),
            'tags' => GroupTagService::getForGroup($groupId),
            'custom_fields' => GroupCustomFieldService::getValues($groupId),
            'settings' => self::exportSettings($groupId, $tenantId),
            'qa' => [
                'questions' => $questions,
                'answers' => $answers,
                'votes' => array_merge(
                    self::exportRowsForTypedIds('group_qa_votes', 'question', $questionIds, $tenantId),
                    self::exportRowsForTypedIds('group_qa_votes', 'answer', $answerIds, $tenantId),
                ),
            ],
            'wiki' => [
                'pages' => $wikiPages,
                'revisions' => $wikiRevisions,
            ],
            'media' => self::exportRowsForGroup(
                'group_media',
                $groupId,
                $tenantId,
                ['file_path', 'thumbnail_path', 'url'],
            ),
            'invitations' => self::exportRowsForGroup(
                'group_invites',
                $groupId,
                $tenantId,
                ['token', 'token_hash'],
            ),
            'webhooks' => self::exportRowsForGroup(
                'group_webhooks',
                $groupId,
                $tenantId,
                ['secret', 'secret_hash', 'signing_secret'],
            ),
            'challenges' => [
                'items' => $challenges,
                'rewards' => $challengeRewards,
            ],
            'chat' => [
                'rooms' => $chatrooms,
                'messages' => $chatMessages,
                'pinned_messages' => $pinnedChatMessages,
            ],
            'tasks' => self::exportRowsForGroup('team_tasks', $groupId, $tenantId),
            'scheduled_posts' => self::exportRowsForGroup('group_scheduled_posts', $groupId, $tenantId),
            'notification_preferences' => self::exportRowsForGroup('group_notification_preferences', $groupId, $tenantId),
            'moderation' => $moderation,
            'approval_requests' => self::exportRowsForGroup('group_approval_requests', $groupId, $tenantId),
            'audit_log' => array_map(
                static fn (array $row): array => GroupAuditService::sanitizeRowForOutput($row),
                self::exportRowsForGroup('group_audit_log', $groupId, $tenantId),
            ),
        ];
    }

    private static function exportMembers(int $groupId, int $tenantId): array
    {
        return DB::table('group_members as gm')
            ->join('users as u', 'gm.user_id', '=', 'u.id')
            ->where('gm.group_id', $groupId)
            ->where('u.tenant_id', $tenantId)
            ->select('u.id', 'u.name', 'u.email', 'gm.role', 'gm.status', 'gm.created_at as joined_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    private static function exportDiscussions(int $groupId, int $tenantId): array
    {
        $discussions = DB::table('group_discussions as gd')
            ->join('users as u', 'gd.user_id', '=', 'u.id')
            ->where('gd.group_id', $groupId)
            ->where('gd.tenant_id', $tenantId)
            ->select('gd.id', 'gd.title', 'gd.is_pinned', 'gd.is_locked', 'u.name as author', 'gd.created_at', 'gd.updated_at')
            ->orderBy('gd.created_at')
            ->get()
            ->map(static fn (object $row): array => (array) $row)
            ->all();

        $discussionIds = array_column($discussions, 'id');
        $postsByDiscussion = [];
        if ($discussionIds !== []) {
            $postsByDiscussion = DB::table('group_posts as gp')
                ->join('users as u', 'gp.user_id', '=', 'u.id')
                ->whereIn('gp.discussion_id', $discussionIds)
                ->where('gp.tenant_id', $tenantId)
                ->where('u.tenant_id', $tenantId)
                ->select('gp.id', 'gp.discussion_id', 'gp.user_id', 'gp.content', 'u.name as author', 'gp.created_at')
                ->orderBy('gp.discussion_id')
                ->orderBy('gp.created_at')
                ->orderBy('gp.id')
                ->get()
                ->groupBy('discussion_id')
                ->map(static fn ($rows): array => $rows
                    ->map(static fn (object $row): array => (array) $row)
                    ->values()
                    ->all())
                ->all();
        }

        return array_map(static function (array $discussion) use ($postsByDiscussion): array {
            $discussion['posts'] = $postsByDiscussion[$discussion['id']] ?? [];

            return $discussion;
        }, $discussions);
    }

    private static function exportAnnouncements(int $groupId, int $tenantId): array
    {
        return DB::table('group_announcements as ga')
            ->leftJoin('users as u', 'ga.created_by', '=', 'u.id')
            ->where('ga.group_id', $groupId)
            ->where('ga.tenant_id', $tenantId)
            ->select('ga.title', 'ga.content', 'ga.is_pinned', 'ga.priority', 'u.name as author', 'ga.created_at', 'ga.expires_at')
            ->orderBy('ga.created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    private static function exportFileMetadata(int $groupId, int $tenantId): array
    {
        return DB::table('group_files as gf')
            ->leftJoin('users as u', 'gf.uploaded_by', '=', 'u.id')
            ->where('gf.group_id', $groupId)
            ->where('gf.tenant_id', $tenantId)
            ->select('gf.file_name', 'gf.file_type', 'gf.file_size', 'u.name as uploaded_by', 'gf.created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    private static function exportEvents(int $groupId, int $tenantId): array
    {
        return DB::table('events')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->select('id', 'title', 'description', 'start_time', 'end_time', 'location', 'created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    private static function exportSettings(int $groupId, int $tenantId): array
    {
        return DB::table('group_policies')
            ->where('tenant_id', $tenantId)
            ->whereIn('policy_key', GroupWelcomeService::policyKeysForGroup($groupId))
            ->select('policy_key', 'policy_value', 'category')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    /**
     * Generate CSV content from an array of rows.
     */
    public static function toCsv(array $rows): string
    {
        if (empty($rows)) return '';

        $output = fopen('php://temp', 'r+');
        \App\Support\CsvExportSanitizer::put($output, array_keys($rows[0]));

        foreach ($rows as $row) {
            \App\Support\CsvExportSanitizer::put($output, CsvExportSanitizer::row(array_values($row)));
        }

        rewind($output);
        $csv = stream_get_contents($output);
        fclose($output);

        return $csv;
    }

    /**
     * @param list<string> $excludedColumns
     * @return list<array<string, mixed>>
     */
    private static function exportRowsForGroup(
        string $table,
        int $groupId,
        int $tenantId,
        array $excludedColumns = [],
    ): array {
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'group_id')) {
            return [];
        }

        $query = DB::table($table)->where('group_id', $groupId);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        if (Schema::hasColumn($table, 'id')) {
            $query->orderBy('id');
        }

        return self::sanitizeRows($query->get()->all(), $excludedColumns);
    }

    /**
     * @param list<int|string> $ids
     * @param list<string> $excludedColumns
     * @return list<array<string, mixed>>
     */
    private static function exportRowsForIds(
        string $table,
        string $foreignKey,
        array $ids,
        int $tenantId,
        array $excludedColumns = [],
    ): array {
        if ($ids === [] || !Schema::hasTable($table) || !Schema::hasColumn($table, $foreignKey)) {
            return [];
        }

        $query = DB::table($table)->whereIn($foreignKey, $ids);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        if (Schema::hasColumn($table, 'id')) {
            $query->orderBy('id');
        }

        return self::sanitizeRows($query->get()->all(), $excludedColumns);
    }

    /**
     * @param list<int|string> $ids
     * @return list<array<string, mixed>>
     */
    private static function exportRowsForTypedIds(
        string $table,
        string $type,
        array $ids,
        int $tenantId,
    ): array {
        if ($ids === [] || !Schema::hasTable($table)) {
            return [];
        }

        $query = DB::table($table)
            ->where('votable_type', $type)
            ->whereIn('votable_id', $ids);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return self::sanitizeRows($query->orderBy('id')->get()->all());
    }

    /**
     * @param list<int|string> $discussionIds
     * @param list<int|string> $postIds
     * @return list<array<string, mixed>>
     */
    private static function exportModeration(
        int $groupId,
        int $tenantId,
        array $discussionIds,
        array $postIds,
    ): array {
        if (!Schema::hasTable('group_content_flags')) {
            return [];
        }

        return DB::table('group_content_flags')
            ->where('tenant_id', $tenantId)
            ->where(function ($query) use ($groupId, $discussionIds, $postIds): void {
                $query->where(function ($groupQuery) use ($groupId): void {
                    $groupQuery->where('content_type', 'group')->where('content_id', $groupId);
                });
                if ($discussionIds !== []) {
                    $query->orWhere(function ($discussionQuery) use ($discussionIds): void {
                        $discussionQuery->where('content_type', 'discussion')->whereIn('content_id', $discussionIds);
                    });
                }
                if ($postIds !== []) {
                    $query->orWhere(function ($postQuery) use ($postIds): void {
                        $postQuery->where('content_type', 'post')->whereIn('content_id', $postIds);
                    });
                }
            })
            ->orderBy('id')
            ->get()
            ->map(static fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * @param array<int, object|array<string, mixed>> $rows
     * @param list<string> $excludedColumns
     * @return list<array<string, mixed>>
     */
    private static function sanitizeRows(array $rows, array $excludedColumns = []): array
    {
        $excluded = array_fill_keys($excludedColumns, true);

        return array_map(
            static fn (object|array $row): array => array_diff_key((array) $row, $excluded),
            $rows,
        );
    }
}
