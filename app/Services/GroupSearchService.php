<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Meilisearch\Client as MeilisearchClient;
use App\Support\UserDisplayName;

/**
 * GroupSearchService — indexes group discussions and posts into Meilisearch
 * for full-text search within group content.
 *
 * Uses a dedicated `group_content` index, separate from the `groups` index
 * used by SearchService (which indexes group metadata only).
 *
 * Document structure:
 *   - id: 'discussion_{id}' or 'post_{id}' (string, primary key)
 *   - tenant_id: int
 *   - group_id: int
 *   - content_type: 'discussion' | 'post'
 *   - title: string (discussion title, empty for posts)
 *   - content: string (post body, empty for discussions)
 *   - author_name: string
 *   - created_at: int (unix timestamp)
 */
class GroupSearchService
{
    private const INDEX_NAME = 'group_content';

    // =========================================================================
    // Meilisearch client (reuses SearchService pattern)
    // =========================================================================

    private static function client(): MeilisearchClient
    {
        return new MeilisearchClient(
            env('MEILISEARCH_HOST', 'http://meilisearch:7700'),
            env('MEILISEARCH_KEY') ?: null,
        );
    }

    // =========================================================================
    // Index configuration
    // =========================================================================

    /**
     * Create and configure the group_content index.
     *
     * Idempotent — safe to call repeatedly. Should be called once during
     * setup or sync operations.
     */
    public static function ensureIndex(): void
    {
        $client = static::client();

        try {
            $client->createIndex(self::INDEX_NAME, ['primaryKey' => 'id']);
        } catch (\Throwable) {
            // Index already exists — update settings only
        }

        $idx = $client->index(self::INDEX_NAME);
        $idx->updateSearchableAttributes(['title', 'content', 'author_name']);
        $idx->updateFilterableAttributes(['tenant_id', 'group_id', 'content_type']);
        $idx->updateSortableAttributes(['created_at']);
        $idx->updateRankingRules(['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']);

        try {
            $idx->updateTypoTolerance([
                'enabled'             => true,
                'minWordSizeForTypos' => [
                    'oneTypo'  => 5,
                    'twoTypos' => 8,
                ],
            ]);
        } catch (\Throwable) {
            // Typo tolerance config is non-critical
        }
    }

    // =========================================================================
    // Indexing
    // =========================================================================

    /**
     * Index all discussions + posts for a group into Meilisearch.
     *
     * Returns the number of documents indexed. Silently returns 0 if
     * Meilisearch is unavailable.
     */
    public static function indexGroupContent(int $groupId): int
    {
        if (!SearchService::isAvailable()) {
            return 0;
        }

        $tenantId = TenantContext::getId();
        if (! self::groupIsActive($groupId, (int) $tenantId)) {
            self::removeGroupContent($groupId);
            return 0;
        }
        $documents = [];

        // ── Discussions ──────────────────────────────────────────────────
        $discussions = DB::select(
            "SELECT gd.id, gd.tenant_id, gd.group_id, gd.title,
                    UNIX_TIMESTAMP(gd.created_at) as created_at,
                    " . UserDisplayName::sql('u', 'author_name') . "
             FROM group_discussions gd
             LEFT JOIN users u ON gd.user_id = u.id
             WHERE gd.group_id = ? AND gd.tenant_id = ?
             ORDER BY gd.id",
            [$groupId, $tenantId]
        );

        foreach ($discussions as $row) {
            $documents[] = [
                'id'           => 'discussion_' . $row->id,
                'tenant_id'    => (int) $row->tenant_id,
                'group_id'     => (int) $row->group_id,
                'content_type' => 'discussion',
                'title'        => $row->title ?? '',
                'content'      => '',
                'author_name'  => trim($row->author_name ?? ''),
                'created_at'   => (int) ($row->created_at ?? 0),
            ];
        }

        // ── Posts ────────────────────────────────────────────────────────
        $posts = DB::select(
            "SELECT gp.id, gp.tenant_id, gd.group_id, gp.content,
                    gd.title as discussion_title,
                    UNIX_TIMESTAMP(gp.created_at) as created_at,
                    " . UserDisplayName::sql('u', 'author_name') . "
             FROM group_posts gp
             INNER JOIN group_discussions gd ON gp.discussion_id = gd.id
             LEFT JOIN users u ON gp.user_id = u.id
             WHERE gd.group_id = ? AND gp.tenant_id = ?
             ORDER BY gp.id",
            [$groupId, $tenantId]
        );

        foreach ($posts as $row) {
            $documents[] = [
                'id'           => 'post_' . $row->id,
                'tenant_id'    => (int) $row->tenant_id,
                'group_id'     => (int) $row->group_id,
                'content_type' => 'post',
                'title'        => $row->discussion_title ?? '',
                'content'      => $row->content ?? '',
                'author_name'  => trim($row->author_name ?? ''),
                'created_at'   => (int) ($row->created_at ?? 0),
            ];
        }

        if (empty($documents)) {
            return 0;
        }

        // Index in batches of 100 (Meilisearch upserts are idempotent)
        try {
            $idx = static::client()->index(self::INDEX_NAME);
            foreach (array_chunk($documents, 100) as $batch) {
                $idx->addDocuments($batch);
            }
        } catch (\Throwable $e) {
            Log::error('GroupSearchService: failed to index group content', [
                'group_id' => $groupId,
                'error'    => $e->getMessage(),
            ]);
            return 0;
        }

        return count($documents);
    }

    // =========================================================================
    // Search
    // =========================================================================

    /**
     * Search within a specific group's discussions and posts.
     *
     * Returns an array of search results, each containing the document fields
     * plus Meilisearch highlighting. Returns empty array if Meilisearch is
     * unavailable.
     *
     * @return array<int, array{id: string, tenant_id: int, group_id: int, content_type: string, title: string, content: string, author_name: string, created_at: int}>
     */
    public static function searchGroupContent(int $groupId, string $query, int $limit = 20): array
    {
        if (!SearchService::isAvailable()) {
            return [];
        }

        $tenantId = TenantContext::getId();
        if (! self::groupIsActive($groupId, (int) $tenantId)) {
            return [];
        }

        try {
            $result = static::client()->index(self::INDEX_NAME)->search($query, [
                'filter' => "tenant_id = {$tenantId} AND group_id = {$groupId}",
                'limit'  => max(1, $limit),
                'sort'   => ['created_at:desc'],
            ]);

            return $result->getHits();
        } catch (\Throwable $e) {
            Log::warning('GroupSearchService: search failed', [
                'group_id' => $groupId,
                'query'    => $query,
                'error'    => $e->getMessage(),
            ]);
            return [];
        }
    }

    // =========================================================================
    // Removal
    // =========================================================================

    /**
     * Remove all indexed content for a group from Meilisearch.
     *
     * Used when a group is deleted or deactivated. Removes both discussions
     * and posts belonging to the group.
     */
    public static function removeGroupContent(int $groupId): void
    {
        if (!SearchService::isAvailable()) {
            return;
        }

        $tenantId = TenantContext::getId();

        try {
            static::client()->index(self::INDEX_NAME)->deleteDocuments([
                'filter' => "tenant_id = {$tenantId} AND group_id = {$groupId}",
            ]);
        } catch (\Throwable $e) {
            Log::error('GroupSearchService: failed to remove group content', [
                'group_id' => $groupId,
                'error'    => $e->getMessage(),
            ]);
        }
    }

    // =========================================================================
    // Bulk reindex
    // =========================================================================

    /**
     * Reindex all groups' content for a tenant.
     *
     * Returns the total number of documents indexed across all groups.
     * Useful for initial setup or recovery after data loss.
     */
    public static function reindexAll(int $tenantId): int
    {
        if (!SearchService::isAvailable()) {
            return 0;
        }

        // Ensure the index exists with correct settings
        static::ensureIndex();

        // First, clear all existing content for this tenant
        try {
            static::client()->index(self::INDEX_NAME)->deleteDocuments([
                'filter' => "tenant_id = {$tenantId}",
            ]);
        } catch (\Throwable $e) {
            Log::warning('GroupSearchService: failed to clear tenant content before reindex', [
                'tenant_id' => $tenantId,
                'error'     => $e->getMessage(),
            ]);
        }

        // Get all canonically active groups for the tenant.
        $groups = DB::select(
            "SELECT id FROM `groups` WHERE tenant_id = ? AND status = ? ORDER BY id",
            [$tenantId, GroupStatus::Active->value]
        );

        // Set tenant context so indexGroupContent queries are scoped correctly
        $previousTenantId = TenantContext::currentId();
        TenantContext::setById($tenantId);

        $totalIndexed = 0;

        foreach ($groups as $group) {
            $totalIndexed += static::indexGroupContent((int) $group->id);
        }

        // Restore previous tenant context if it was different
        if ($previousTenantId && $previousTenantId !== $tenantId) {
            TenantContext::setById($previousTenantId);
        }

        return $totalIndexed;
    }

    private static function groupIsActive(int $groupId, int $tenantId): bool
    {
        return DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', GroupStatus::Active->value)
            ->exists();
    }
}
