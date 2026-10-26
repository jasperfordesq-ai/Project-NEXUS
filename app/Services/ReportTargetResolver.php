<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * ReportTargetResolver — resolve polymorphic moderation-report targets into
 * display metadata (label, content preview, author) for the reports UI.
 *
 * A `reports` row stores only `target_type` + `target_id`. On its own that is
 * meaningless to a moderator, so this service batch-resolves a page of reports
 * into human-readable target details with a single query per distinct type
 * (no N+1). Queries are scoped to the tenant set present in the batch as
 * defence-in-depth for the cross-tenant super-admin view.
 */
class ReportTargetResolver
{
    /** Max characters of content preview returned to the client. */
    private const PREVIEW_LENGTH = 200;

    /** Target types this service knows how to resolve to a real row. */
    private const RESOLVABLE_TYPES = ['user', 'post', 'feed_post', 'comment', 'listing', 'event', 'review', 'message'];

    /**
     * Resolve a batch of report rows into target metadata.
     *
     * @param array<int,object> $reports Rows carrying ->target_type, ->target_id, ->tenant_id
     * @return array<string,array<string,mixed>> Keyed "{target_type}:{target_id}"
     */
    public static function resolveMany(array $reports): array
    {
        $idsByType = [];
        $tenantIds = [];

        foreach ($reports as $report) {
            $type = $report->target_type ?? null;
            $id = (int) ($report->target_id ?? 0);
            if (!is_string($type) || $type === '' || $id <= 0) {
                continue;
            }
            $idsByType[$type][$id] = $id;

            $tenantId = (int) ($report->tenant_id ?? 0);
            if ($tenantId > 0) {
                $tenantIds[$tenantId] = $tenantId;
            }
        }

        $tenantIds = array_values($tenantIds);
        $resolved = [];

        foreach ($idsByType as $type => $ids) {
            $ids = array_values($ids);

            foreach (self::resolveType($type, $ids, $tenantIds) as $id => $entry) {
                $resolved["{$type}:{$id}"] = $entry;
            }
        }

        // Fill any target that had no matching row (deleted content, or a type
        // we don't resolve) with a sensible fallback so callers can look up
        // every report unconditionally.
        foreach ($reports as $report) {
            $type = $report->target_type ?? null;
            $id = (int) ($report->target_id ?? 0);
            if (!is_string($type) || $type === '' || $id <= 0) {
                continue;
            }
            $key = "{$type}:{$id}";
            if (!isset($resolved[$key])) {
                $resolved[$key] = self::fallbackEntry($type, $id);
            }
        }

        return $resolved;
    }

    /**
     * Fallback metadata for a target with no resolved row.
     *
     * A resolvable type with no row = the content was deleted (target_exists
     * false → UI shows "removed"). An unresolved type just gets a generic
     * "{Type} #{id}" label and is assumed to still exist.
     *
     * @return array<string,mixed>
     */
    private static function fallbackEntry(string $type, int $id): array
    {
        $resolvable = in_array($type, self::RESOLVABLE_TYPES, true);

        return [
            'target_label' => $resolvable ? null : ucfirst($type) . ' #' . $id,
            'target_preview' => null,
            'target_avatar' => null,
            'target_author_id' => null,
            'target_author_name' => null,
            'target_exists' => !$resolvable,
        ];
    }

    /**
     * Resolve all ids of a single target type.
     *
     * @param array<int,int> $ids
     * @param array<int,int> $tenantIds
     * @return array<int,array<string,mixed>> Keyed by target id
     */
    private static function resolveType(string $type, array $ids, array $tenantIds): array
    {
        return match ($type) {
            'user' => self::resolveUsers($ids, $tenantIds),
            'post', 'feed_post' => self::resolveContent('feed_posts', $ids, $tenantIds, preview: 'content', hasSoftDelete: true),
            'comment' => self::resolveContent('comments', $ids, $tenantIds, preview: 'content', hasSoftDelete: true),
            'listing' => self::resolveContent('listings', $ids, $tenantIds, label: 'title', hasSoftDelete: true),
            'event' => self::resolveContent('events', $ids, $tenantIds, label: 'title', hasSoftDelete: false),
            'review' => self::resolveReviews($ids, $tenantIds),
            'message' => self::resolveMessages($ids, $tenantIds),
            default => [],
        };
    }

    /**
     * @param array<int,int> $ids
     * @param array<int,int> $tenantIds
     * @return array<int,array<string,mixed>>
     */
    private static function resolveUsers(array $ids, array $tenantIds): array
    {
        $query = DB::table('users')->whereIn('id', $ids);
        if (!empty($tenantIds)) {
            $query->where(function ($q) use ($tenantIds) {
                $q->whereIn('tenant_id', $tenantIds)->orWhereNull('tenant_id');
            });
        }
        $rows = $query->get(['id', 'name', 'avatar_url', 'deleted_at']);

        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row->id;
            $out[$id] = [
                'target_label' => $row->name ?: null,
                'target_preview' => null,
                'target_avatar' => $row->avatar_url ?: null,
                'target_author_id' => $id,
                'target_author_name' => $row->name ?: null,
                'target_exists' => $row->deleted_at === null,
            ];
        }

        return $out;
    }

    /**
     * Resolve content-owning target tables (feed_posts, comments, listings, events)
     * with a join to the author for name + avatar.
     *
     * @param array<int,int> $ids
     * @param array<int,int> $tenantIds
     * @return array<int,array<string,mixed>>
     */
    private static function resolveContent(
        string $table,
        array $ids,
        array $tenantIds,
        ?string $preview = null,
        ?string $label = null,
        bool $hasSoftDelete = false,
    ): array {
        $columns = ['c.id', 'c.user_id', 'u.name as author_name', 'u.avatar_url as author_avatar'];
        if ($preview !== null) {
            $columns[] = "c.{$preview} as preview";
        }
        if ($label !== null) {
            $columns[] = "c.{$label} as label";
        }
        if ($hasSoftDelete) {
            $columns[] = 'c.deleted_at';
        }

        $query = DB::table("{$table} as c")
            ->leftJoin('users as u', 'u.id', '=', 'c.user_id')
            ->whereIn('c.id', $ids);
        if (!empty($tenantIds)) {
            $query->whereIn('c.tenant_id', $tenantIds);
        }
        $rows = $query->get($columns);

        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row->id;
            $out[$id] = [
                'target_label' => isset($row->label) ? ($row->label ?: null) : null,
                'target_preview' => isset($row->preview) ? self::trimPreview($row->preview) : null,
                'target_avatar' => $row->author_avatar ?: null,
                'target_author_id' => $row->user_id !== null ? (int) $row->user_id : null,
                'target_author_name' => $row->author_name ?: null,
                'target_exists' => $hasSoftDelete ? ($row->deleted_at === null) : true,
            ];
        }

        return $out;
    }

    /**
     * Reviews are member-to-member: author is the reviewer, preview is the comment.
     *
     * @param array<int,int> $ids
     * @param array<int,int> $tenantIds
     * @return array<int,array<string,mixed>>
     */
    /**
     * A reported direct message. The author is the sender, so the sender is a
     * party to the report (ReportQueueVisibility). The preview here is the
     * message as it is now; AdminReportsController prefers the words captured
     * when it was reported (`reports.target_snapshot`).
     *
     * @param array<int,int> $ids
     * @param array<int,int> $tenantIds
     * @return array<int,array<string,mixed>>
     */
    private static function resolveMessages(array $ids, array $tenantIds): array
    {
        $query = DB::table('messages as m')
            ->leftJoin('users as u', 'u.id', '=', 'm.sender_id')
            ->whereIn('m.id', $ids);
        if (!empty($tenantIds)) {
            $query->whereIn('m.tenant_id', $tenantIds);
        }
        $rows = $query->get([
            'm.id',
            'm.sender_id',
            'm.body as preview',
            'u.name as author_name',
            'u.avatar_url as author_avatar',
        ]);

        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row->id;
            $out[$id] = [
                'target_label' => null,
                'target_preview' => self::trimPreview($row->preview),
                'target_avatar' => $row->author_avatar ?: null,
                'target_author_id' => (int) $row->sender_id,
                'target_author_name' => $row->author_name ?: null,
                'target_exists' => true,
            ];
        }

        return $out;
    }

    private static function resolveReviews(array $ids, array $tenantIds): array
    {
        $query = DB::table('reviews as c')
            ->leftJoin('users as u', 'u.id', '=', 'c.reviewer_id')
            ->whereIn('c.id', $ids);
        if (!empty($tenantIds)) {
            $query->whereIn('c.tenant_id', $tenantIds);
        }
        $rows = $query->get([
            'c.id',
            'c.reviewer_id',
            'c.comment as preview',
            'u.name as author_name',
            'u.avatar_url as author_avatar',
        ]);

        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row->id;
            $out[$id] = [
                'target_label' => null,
                'target_preview' => self::trimPreview($row->preview),
                'target_avatar' => $row->author_avatar ?: null,
                'target_author_id' => $row->reviewer_id !== null ? (int) $row->reviewer_id : null,
                'target_author_name' => $row->author_name ?: null,
                'target_exists' => true,
            ];
        }

        return $out;
    }

    /**
     * Collapse whitespace and truncate a content preview for safe display.
     */
    private static function trimPreview(?string $text): ?string
    {
        if ($text === null) {
            return null;
        }
        $normalized = trim((string) preg_replace('/\s+/u', ' ', $text));
        if ($normalized === '') {
            return null;
        }
        if (mb_strlen($normalized) > self::PREVIEW_LENGTH) {
            return mb_substr($normalized, 0, self::PREVIEW_LENGTH) . '…';
        }
        return $normalized;
    }
}
