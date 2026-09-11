<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Support\CsvExportSanitizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * MunicipalityFeedbackService — AG92 two-way feedback inbox.
 *
 * Lightweight resident-to-municipality channel for questions, ideas,
 * issue reports, and sentiment tags. Tenant-scoped, optionally
 * sub-region-scoped (AG77), with status tracking and CSV export.
 *
 * Status lifecycle: new -> triaging -> in_progress -> resolved | closed
 *
 * Privacy: when is_anonymous is true, the submitter_user_id is still
 * stored for abuse prevention but is redacted out of every member-context
 * payload. Admin-context responses include it.
 */
class MunicipalityFeedbackService
{
    public const TABLE = 'caring_municipality_feedback';

    public const CATEGORIES = ['question', 'idea', 'issue_report', 'sentiment'];

    public const SENTIMENT_TAGS = ['positive', 'neutral', 'negative', 'concerned'];

    public const STATUSES = ['new', 'triaging', 'in_progress', 'resolved', 'closed'];

    public const OPEN_STATUSES = ['new', 'triaging', 'in_progress'];

    private const MAX_SUBJECT = 200;
    private const MAX_BODY = 5000;

    /**
     * Submit a new piece of feedback.
     *
     * @return array{errors?: array<int, array{code: string, message: string, field?: string}>, feedback?: array<string, mixed>}
     */
    public function submit(int $tenantId, ?int $userId, array $payload): array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return ['errors' => [['code' => 'TABLE_NOT_FOUND', 'message' => __('caring_community.feedback.table_not_found')]]];
        }

        $errors = [];

        $category = is_string($payload['category'] ?? null) ? $payload['category'] : '';
        if (!in_array($category, self::CATEGORIES, true)) {
            $errors[] = ['code' => 'INVALID_CATEGORY', 'message' => __('caring_community.feedback.invalid_category'), 'field' => 'category'];
        }

        $subject = trim((string) ($payload['subject'] ?? ''));
        if ($subject === '') {
            $errors[] = ['code' => 'SUBJECT_REQUIRED', 'message' => __('caring_community.feedback.subject_required'), 'field' => 'subject'];
        } elseif (mb_strlen($subject) > self::MAX_SUBJECT) {
            $errors[] = ['code' => 'SUBJECT_TOO_LONG', 'message' => __('caring_community.feedback.subject_too_long'), 'field' => 'subject'];
        }

        $body = trim((string) ($payload['body'] ?? ''));
        if ($body === '') {
            $errors[] = ['code' => 'BODY_REQUIRED', 'message' => __('caring_community.feedback.body_required'), 'field' => 'body'];
        } elseif (mb_strlen($body) > self::MAX_BODY) {
            $errors[] = ['code' => 'BODY_TOO_LONG', 'message' => __('caring_community.feedback.body_too_long'), 'field' => 'body'];
        }

        $sentiment = $payload['sentiment_tag'] ?? null;
        if ($sentiment !== null && $sentiment !== '' && !in_array($sentiment, self::SENTIMENT_TAGS, true)) {
            $errors[] = ['code' => 'INVALID_SENTIMENT', 'message' => __('caring_community.feedback.invalid_sentiment'), 'field' => 'sentiment_tag'];
        }

        $subRegionId = null;
        if (isset($payload['sub_region_id']) && $payload['sub_region_id'] !== '' && $payload['sub_region_id'] !== null) {
            if (!is_numeric($payload['sub_region_id'])) {
                $errors[] = ['code' => 'INVALID_SUB_REGION', 'message' => __('caring_community.feedback.invalid_sub_region'), 'field' => 'sub_region_id'];
            } else {
                $subRegionId = (int) $payload['sub_region_id'];
            }
        }

        if (!empty($errors)) {
            return ['errors' => $errors];
        }

        $isAnonymous = filter_var($payload['is_anonymous'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $isPublic = filter_var($payload['is_public'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $now = now();
        $id = (int) DB::table(self::TABLE)->insertGetId([
            'tenant_id'         => $tenantId,
            'submitter_user_id' => $userId,
            'sub_region_id'     => $subRegionId,
            'category'          => $category,
            'subject'           => $subject,
            'body'              => $body,
            'sentiment_tag'     => ($sentiment !== null && $sentiment !== '') ? $sentiment : null,
            'status'            => 'new',
            'is_anonymous'      => $isAnonymous ? 1 : 0,
            'is_public'         => $isPublic ? 1 : 0,
            'created_at'        => $now,
            'updated_at'        => $now,
        ]);

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        return ['feedback' => $row ? $this->formatRow((array) $row, false) : ['id' => $id]];
    }

    /**
     * Member-side: list this user's submissions (most recent first).
     *
     * @return array<int, array<string, mixed>>
     */
    public function listForMember(int $tenantId, int $userId, int $limit = 50): array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return [];
        }

        $limit = max(1, min(200, $limit));

        $rows = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('submitter_user_id', $userId)
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();

        return $rows->map(fn ($r) => $this->formatRow((array) $r, false, true))->all();
    }

    /**
     * Admin-side: paginated list with filters.
     *
     * @return array{items: array<int, array<string, mixed>>, total: int, page: int, per_page: int}
     */
    public function listForAdmin(
        int $tenantId,
        ?string $statusFilter = null,
        ?string $categoryFilter = null,
        ?string $subRegionId = null,
        int $page = 1,
        int $perPage = 25
    ): array {
        if (!Schema::hasTable(self::TABLE)) {
            return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }

        $perPage = max(1, min(200, $perPage));
        $page = max(1, $page);

        $query = DB::table(self::TABLE)->where('tenant_id', $tenantId);

        if ($statusFilter !== null && $statusFilter !== '' && in_array($statusFilter, self::STATUSES, true)) {
            $query->where('status', $statusFilter);
        }
        if ($categoryFilter !== null && $categoryFilter !== '' && in_array($categoryFilter, self::CATEGORIES, true)) {
            $query->where('category', $categoryFilter);
        }
        if ($subRegionId !== null && $subRegionId !== '' && is_numeric($subRegionId)) {
            $query->where('sub_region_id', (int) $subRegionId);
        }

        $total = (int) (clone $query)->count();

        $rows = $query
            ->orderByDesc('created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        $items = $rows->map(fn ($r) => $this->formatRow((array) $r, true))->all();

        return [
            'items'    => $items,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ];
    }

    /**
     * Show a single feedback row.
     *
     * @return array<string, mixed>|null
     */
    public function show(int $tenantId, int $id, bool $adminContext): ?array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return null;
        }

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        if (!$row) {
            return null;
        }

        return $this->formatRow((array) $row, $adminContext);
    }

    /**
     * Admin: triage a submission (status / assigned_user_id / assigned_role / triage_notes).
     *
     * @return array{errors?: array<int, array<string, mixed>>, feedback?: array<string, mixed>}
     */
    public function triage(int $tenantId, int $id, array $payload): array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return ['errors' => [['code' => 'TABLE_NOT_FOUND', 'message' => __('caring_community.feedback.table_not_found')]]];
        }

        $existing = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (!$existing) {
            return ['errors' => [['code' => 'NOT_FOUND', 'message' => __('caring_community.feedback.not_found')]]];
        }

        $update = ['updated_at' => now()];

        if (array_key_exists('status', $payload)) {
            $status = (string) $payload['status'];
            if (!in_array($status, self::STATUSES, true)) {
                return ['errors' => [['code' => 'INVALID_STATUS', 'message' => __('caring_community.feedback.invalid_status'), 'field' => 'status']]];
            }
            $update['status'] = $status;
        }

        if (array_key_exists('assigned_user_id', $payload)) {
            $aid = $payload['assigned_user_id'];
            if ($aid === '' || $aid === null) {
                $update['assigned_user_id'] = null;
            } elseif (is_numeric($aid)) {
                $update['assigned_user_id'] = (int) $aid;
            } else {
                return ['errors' => [['code' => 'INVALID_ASSIGNEE', 'message' => __('caring_community.feedback.invalid_assignee'), 'field' => 'assigned_user_id']]];
            }
        }

        if (array_key_exists('assigned_role', $payload)) {
            $role = $payload['assigned_role'];
            if ($role === '' || $role === null) {
                $update['assigned_role'] = null;
            } else {
                $update['assigned_role'] = mb_substr((string) $role, 0, 64);
            }
        }

        if (array_key_exists('triage_notes', $payload)) {
            $notes = $payload['triage_notes'];
            $update['triage_notes'] = ($notes === null || $notes === '') ? null : (string) $notes;
        }

        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update($update);

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        return ['feedback' => $row ? $this->formatRow((array) $row, true) : null];
    }

    /**
     * Admin: mark a submission resolved with notes.
     *
     * @return array{errors?: array<int, array<string, mixed>>, feedback?: array<string, mixed>}
     */
    public function resolve(int $tenantId, int $id, string $resolutionNotes): array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return ['errors' => [['code' => 'TABLE_NOT_FOUND', 'message' => __('caring_community.feedback.table_not_found')]]];
        }

        $existing = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (!$existing) {
            return ['errors' => [['code' => 'NOT_FOUND', 'message' => __('caring_community.feedback.not_found')]]];
        }

        $notes = trim($resolutionNotes);
        if ($notes === '') {
            return ['errors' => [['code' => 'NOTES_REQUIRED', 'message' => __('caring_community.feedback.resolution_notes_required'), 'field' => 'resolution_notes']]];
        }

        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update([
                'status'           => 'resolved',
                'resolution_notes' => $notes,
                'updated_at'       => now(),
            ]);

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        return ['feedback' => $row ? $this->formatRow((array) $row, true) : null];
    }

    /**
     * Admin: close a submission without resolving (e.g. duplicate, off-topic).
     *
     * @return array{errors?: array<int, array<string, mixed>>, feedback?: array<string, mixed>}
     */
    public function close(int $tenantId, int $id): array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return ['errors' => [['code' => 'TABLE_NOT_FOUND', 'message' => __('caring_community.feedback.table_not_found')]]];
        }

        $existing = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (!$existing) {
            return ['errors' => [['code' => 'NOT_FOUND', 'message' => __('caring_community.feedback.not_found')]]];
        }

        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update([
                'status'     => 'closed',
                'updated_at' => now(),
            ]);

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        return ['feedback' => $row ? $this->formatRow((array) $row, true) : null];
    }

    /**
     * Admin dashboard stats.
     *
     * @return array<string, mixed>
     */
    public function dashboardStats(int $tenantId): array
    {
        if (!Schema::hasTable(self::TABLE)) {
            return [
                'total_open'             => 0,
                'by_status'              => [],
                'by_category'            => [],
                'by_sub_region'          => [],
                'recent_count_7d'        => 0,
                'sentiment_distribution' => [],
            ];
        }

        $byStatus = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->selectRaw('status, COUNT(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status')
            ->toArray();

        $totalOpen = 0;
        foreach (self::OPEN_STATUSES as $s) {
            $totalOpen += (int) ($byStatus[$s] ?? 0);
        }

        $byCategory = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->selectRaw('category, COUNT(*) as c')
            ->groupBy('category')
            ->pluck('c', 'category')
            ->toArray();

        $bySubRegion = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('sub_region_id')
            ->selectRaw('sub_region_id, COUNT(*) as c')
            ->groupBy('sub_region_id')
            ->pluck('c', 'sub_region_id')
            ->toArray();

        $recent7d = (int) DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', now()->subDays(7))
            ->count();

        $sentiment = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('sentiment_tag')
            ->selectRaw('sentiment_tag, COUNT(*) as c')
            ->groupBy('sentiment_tag')
            ->pluck('c', 'sentiment_tag')
            ->toArray();

        return [
            'total_open'             => $totalOpen,
            'by_status'              => array_map('intval', $byStatus),
            'by_category'            => array_map('intval', $byCategory),
            'by_sub_region'          => array_map('intval', $bySubRegion),
            'recent_count_7d'        => $recent7d,
            'sentiment_distribution' => array_map('intval', $sentiment),
        ];
    }

    /**
     * Admin: CSV export (privacy-safe — anonymous rows show "(anonymous)" for submitter).
     */
    public function exportCsv(int $tenantId, ?string $statusFilter = null, ?string $categoryFilter = null): string
    {
        if (!Schema::hasTable(self::TABLE)) {
            return "id,created_at,category,status,subject,sentiment,sub_region_id,submitter,is_anonymous,is_public\n";
        }

        $query = DB::table(self::TABLE)->where('tenant_id', $tenantId);

        if ($statusFilter !== null && $statusFilter !== '' && in_array($statusFilter, self::STATUSES, true)) {
            $query->where('status', $statusFilter);
        }
        if ($categoryFilter !== null && $categoryFilter !== '' && in_array($categoryFilter, self::CATEGORIES, true)) {
            $query->where('category', $categoryFilter);
        }

        $rows = $query->orderByDesc('created_at')->limit(10000)->get();

        $fh = fopen('php://temp', 'r+');
        if ($fh === false) {
            return '';
        }

        // UTF-8 BOM for Excel compatibility
        fwrite($fh, "\xEF\xBB\xBF");
        \App\Support\CsvExportSanitizer::put($fh, [
            'id', 'created_at', 'category', 'status', 'subject', 'sentiment_tag',
            'sub_region_id', 'submitter', 'is_anonymous', 'is_public',
            'assigned_role', 'triage_notes', 'resolution_notes', 'body',
        ]);

        foreach ($rows as $row) {
            $r = (array) $row;
            $isAnonymous = (bool) ($r['is_anonymous'] ?? false);
            $submitter = $isAnonymous
                ? '(anonymous)'
                : (string) ($r['submitter_user_id'] ?? '');

            \App\Support\CsvExportSanitizer::put($fh, CsvExportSanitizer::row([
                (int) ($r['id'] ?? 0),
                (string) ($r['created_at'] ?? ''),
                (string) ($r['category'] ?? ''),
                (string) ($r['status'] ?? ''),
                (string) ($r['subject'] ?? ''),
                (string) ($r['sentiment_tag'] ?? ''),
                $r['sub_region_id'] !== null ? (string) $r['sub_region_id'] : '',
                $submitter,
                $isAnonymous ? '1' : '0',
                ((bool) ($r['is_public'] ?? false)) ? '1' : '0',
                (string) ($r['assigned_role'] ?? ''),
                (string) ($r['triage_notes'] ?? ''),
                (string) ($r['resolution_notes'] ?? ''),
                (string) ($r['body'] ?? ''),
            ]));
        }

        rewind($fh);
        $csv = stream_get_contents($fh) ?: '';
        fclose($fh);

        return $csv;
    }

    /**
     * Format a single DB row for response.
     *
     * @param array<string, mixed> $row
     * @param bool $adminContext  When true, include submitter_user_id even on anonymous rows
     * @param bool $memberOwnView When true, the requester is the submitter — show their own anonymous IDs
     * @return array<string, mixed>
     */
    private function formatRow(array $row, bool $adminContext, bool $memberOwnView = false): array
    {
        $isAnonymous = (bool) ($row['is_anonymous'] ?? false);
        $submitterId = $row['submitter_user_id'] !== null ? (int) $row['submitter_user_id'] : null;

        // Privacy: redact submitter_user_id in non-admin, non-self contexts when anonymous.
        $exposeSubmitter = $adminContext || $memberOwnView || !$isAnonymous;

        return [
            'id'                => (int) ($row['id'] ?? 0),
            'tenant_id'         => (int) ($row['tenant_id'] ?? 0),
            'submitter_user_id' => $exposeSubmitter ? $submitterId : null,
            'sub_region_id'     => $row['sub_region_id'] !== null ? (int) $row['sub_region_id'] : null,
            'category'          => (string) ($row['category'] ?? ''),
            'subject'           => (string) ($row['subject'] ?? ''),
            'body'              => (string) ($row['body'] ?? ''),
            'sentiment_tag'     => $row['sentiment_tag'] !== null ? (string) $row['sentiment_tag'] : null,
            'status'            => (string) ($row['status'] ?? 'new'),
            'assigned_user_id'  => $row['assigned_user_id'] !== null ? (int) $row['assigned_user_id'] : null,
            'assigned_role'     => $row['assigned_role'] !== null ? (string) $row['assigned_role'] : null,
            'triage_notes'      => $row['triage_notes'] !== null ? (string) $row['triage_notes'] : null,
            'resolution_notes'  => $row['resolution_notes'] !== null ? (string) $row['resolution_notes'] : null,
            'is_anonymous'      => $isAnonymous,
            'is_public'         => (bool) ($row['is_public'] ?? false),
            'created_at'        => (string) ($row['created_at'] ?? ''),
            'updated_at'        => (string) ($row['updated_at'] ?? ''),
        ];
    }
}
