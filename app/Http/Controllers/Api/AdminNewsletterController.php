<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\NewsletterService;
use App\Services\EmailDispatchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Core\TenantContext;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Admin Newsletter API Controller
 * Provides CRUD for newsletters, subscribers, segments, templates, and analytics.
 * Gracefully returns empty data if tables don't exist.
 */
class AdminNewsletterController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Hard cap on stored newsletter/template content — protects the render
     * pipeline (CSS inliner) from pathological pastes. ~512 KB is far beyond
     * any legitimate email body (Gmail clips at ~102 KB).
     */
    private const MAX_CONTENT_BYTES = 524288;

    /**
     * Authoring formats the render pipeline understands.
     */
    private const CONTENT_FORMATS = ['plaintext', 'richtext', 'html', 'builder'];

    /**
     * Allowed tables for existence checks — prevents SQL injection via table name.
     */
    private const ALLOWED_TABLES = [
        'newsletters',
        'newsletter_subscribers',
        'newsletter_segments',
        'newsletter_templates',
        'newsletter_queue',
        'newsletter_bounces',
        'newsletter_opens',
        'newsletter_clicks',
        'newsletter_suppression_list',
    ];

    private function tableExists(string $table): bool
    {
        if (!in_array($table, self::ALLOWED_TABLES, true)) {
            return false;
        }
        if (!TenantContext::hasFeature('newsletter')) {
            return false;
        }
        return Schema::hasTable($table);
    }

    private function normalizeJsonListInput(mixed $value, bool $integerValues = false): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                $value = $decoded;
            } else {
                $value = array_map('trim', explode(',', $value));
            }
        }

        if (!is_array($value)) {
            return null;
        }

        $items = [];
        foreach ($value as $item) {
            if ($integerValues) {
                $intValue = (int) $item;
                if ($intValue > 0) {
                    $items[] = $intValue;
                }
                continue;
            }

            $stringValue = trim((string) $item);
            if ($stringValue !== '') {
                $items[] = $stringValue;
            }
        }

        return $items === [] ? null : json_encode(array_values(array_unique($items)));
    }

    private function activeSuppressedEmailSet(int $tenantId): array
    {
        if (!$this->tableExists('newsletter_suppression_list')) {
            return [];
        }

        return DB::table('newsletter_suppression_list')
            ->where('tenant_id', $tenantId)
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->pluck('email')
            ->map(fn ($email) => strtolower((string) $email))
            ->flip()
            ->all();
    }

    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = 20;
        $offset = ($page - 1) * $perPage;
        $status = $this->query('status');

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }

        try {
            $where = 'WHERE tenant_id = ?';
            $params = [$tenantId];
            if ($status) {
                $where .= ' AND status = ?';
                $params[] = $status;
            }

            $countRow = DB::selectOne("SELECT COUNT(*) as cnt FROM newsletters {$where}", $params);
            $total = (int) ($countRow->cnt ?? 0);

            $params[] = $perPage;
            $params[] = $offset;
            $rows = DB::select(
                "SELECT * FROM newsletters {$where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                $params
            );
            $items = array_map(fn($r) => (array)$r, $rows);

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    public function show(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
        }

        try {
            $item = DB::selectOne(
                "SELECT * FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
            if (!$item) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }
            return $this->respondWithData((array)$item);
        } catch (\Exception $e) {
            return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
        }
    }

    public function store(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $subject = $this->input('subject', '');
        $name = $this->input('name') ?: $subject; // Fall back to subject if name not provided
        $previewText = $this->input('preview_text', '');
        $content = $this->input('content', '');
        $contentFormat = $this->input('content_format', 'richtext');
        $designJson = $this->input('design_json') ?: null;
        $status = $this->input('status', 'draft');
        $targetAudience = $this->input('target_audience', 'all_members');
        $segmentId = $this->inputInt('segment_id') ?: null;
        $scheduledAt = $this->input('scheduled_at') ?: null;
        $abTestEnabled = $this->input('ab_test_enabled') ? 1 : 0;
        $subjectB = $this->input('subject_b') ?: null;
        $templateId = $this->inputInt('template_id') ?: null;
        $abSplitPercentage = $this->inputInt('ab_split_percentage') ?: 50;
        $abWinnerMetric = $this->input('ab_winner_metric', 'opens');
        $abAutoSelectWinner = $this->input('ab_auto_select_winner') ? 1 : 0;
        $abAutoSelectAfterHours = $this->inputInt('ab_auto_select_after_hours') ?: null;
        $targetCounties = $this->normalizeJsonListInput($this->input('target_counties'));
        $targetTowns = $this->normalizeJsonListInput($this->input('target_towns'));
        $targetGroups = $this->normalizeJsonListInput($this->input('target_groups'), true);
        $isRecurring = $this->input('is_recurring') ? 1 : 0;
        $recurringFrequency = $this->input('recurring_frequency') ?: null;
        $recurringDayOfWeek = $this->inputInt('recurring_day_of_week') ?: ($this->inputInt('recurring_day') ?: null);
        $recurringDay = $recurringDayOfWeek !== null ? (string) $recurringDayOfWeek : null;
        $recurringDayOfMonth = $this->inputInt('recurring_day_of_month') ?: null;
        $recurringTime = $this->input('recurring_time') ?: null;
        $recurringEndDate = $this->input('recurring_end_date') ?: null;

        if (!$name && !$subject) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.subject_required'), 'subject');
        }

        if (!in_array($status, ['draft', 'scheduled'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status'), 'status');
        }

        if (!in_array($targetAudience, ['all_members', 'subscribers_only', 'both', 'segment'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_target'), 'target_audience');
        }

        if (!in_array($contentFormat, self::CONTENT_FORMATS, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format');
        }

        if (strlen((string) $content) > self::MAX_CONTENT_BYTES) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.newsletter_content_too_large'), 'content');
        }

        // Email-safe sanitization: strip executable vectors, preserve email markup
        // (tables/inline styles/<style>/MSO comments). Never the generic HtmlSanitizer.
        $content = \App\Services\EmailHtmlSanitizer::sanitizeForFormat((string) $content, $contentFormat);

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_not_configured'), null, 503);
        }

        try {
            DB::insert(
                "INSERT INTO newsletters (tenant_id, name, subject, preview_text, content, content_format, design_json, status,
                    target_audience, segment_id, scheduled_at, ab_test_enabled, subject_b, template_id,
                    ab_split_percentage, ab_winner_metric, ab_auto_select_winner, ab_auto_select_after_hours,
                    target_counties, target_towns, target_groups,
                    is_recurring, recurring_frequency, recurring_day, recurring_day_of_week, recurring_day_of_month,
                    recurring_time, recurring_end_date,
                    created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
                [$tenantId, $name, $subject, $previewText, $content, $contentFormat, $designJson, $status,
                 $targetAudience, $segmentId, $scheduledAt, $abTestEnabled, $subjectB, $templateId,
                 $abSplitPercentage, $abWinnerMetric, $abAutoSelectWinner, $abAutoSelectAfterHours,
                 $targetCounties, $targetTowns, $targetGroups,
                 $isRecurring, $recurringFrequency, $recurringDay, $recurringDayOfWeek, $recurringDayOfMonth,
                 $recurringTime, $recurringEndDate,
                 $userId]
            );
            $id = DB::getPdo()->lastInsertId();
            return $this->respondWithData(['id' => $id, 'name' => $name, 'status' => $status], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.create_failed', ['resource' => 'newsletter']));
        }
    }

    public function update(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_not_configured'), null, 503);
        }

        try {
            $fields = [];
            $params = [];

            $status = $this->input('status');
            if ($status !== null) {
                if (!in_array($status, ['draft', 'scheduled'], true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status'), 'status');
                }
                $fields[] = "status = ?";
                $params[] = $status;
            }

            $targetAudience = $this->input('target_audience');
            if ($targetAudience !== null) {
                if (!in_array($targetAudience, ['all_members', 'subscribers_only', 'both', 'segment'], true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_target'), 'target_audience');
                }
                $fields[] = "target_audience = ?";
                $params[] = $targetAudience;
            }

            $contentFormat = $this->input('content_format');
            if ($contentFormat !== null) {
                if (!in_array($contentFormat, self::CONTENT_FORMATS, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format');
                }
                $fields[] = "content_format = ?";
                $params[] = $contentFormat;
            }

            $content = $this->input('content');
            if ($content !== null) {
                if (strlen((string) $content) > self::MAX_CONTENT_BYTES) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.newsletter_content_too_large'), 'content');
                }
                // Sanitize against the incoming format, falling back to the stored one.
                $effectiveFormat = $contentFormat
                    ?? (string) (DB::table('newsletters')->where('id', $id)->where('tenant_id', $tenantId)->value('content_format') ?: 'richtext');
                $fields[] = "content = ?";
                $params[] = \App\Services\EmailHtmlSanitizer::sanitizeForFormat((string) $content, $effectiveFormat);
            }

            $designJson = $this->input('design_json');
            if ($designJson !== null) {
                $fields[] = "design_json = ?";
                $params[] = $designJson === '' ? null : $designJson;
            }

            $allowedFields = [
                'name', 'subject', 'preview_text',
                'scheduled_at', 'subject_b',
                'ab_winner_metric',
                'recurring_frequency', 'recurring_time', 'recurring_end_date',
            ];

            foreach ($allowedFields as $field) {
                $val = $this->input($field);
                if ($val !== null) {
                    $fields[] = "{$field} = ?";
                    $params[] = $val;
                }
            }

            foreach (['target_counties' => false, 'target_towns' => false, 'target_groups' => true] as $field => $integerValues) {
                $val = $this->input($field);
                if ($val !== null) {
                    $fields[] = "{$field} = ?";
                    $params[] = $this->normalizeJsonListInput($val, $integerValues);
                }
            }

            $recurringDayInput = $this->input('recurring_day_of_week') ?? $this->input('recurring_day');
            if ($recurringDayInput !== null) {
                $day = $recurringDayInput ? (int) $recurringDayInput : null;
                $fields[] = "recurring_day = ?";
                $params[] = $day !== null ? (string) $day : null;
                $fields[] = "recurring_day_of_week = ?";
                $params[] = $day;
            }

            // Handle nullable int fields
            foreach (['segment_id', 'template_id', 'ab_split_percentage', 'recurring_day_of_month', 'ab_auto_select_after_hours'] as $intField) {
                $val = $this->input($intField);
                if ($val !== null) {
                    $fields[] = "{$intField} = ?";
                    $params[] = $val ? (int)$val : null;
                }
            }

            // Handle boolean fields
            foreach (['ab_test_enabled', 'is_recurring', 'ab_auto_select_winner'] as $boolField) {
                $val = $this->input($boolField);
                if ($val !== null) {
                    $fields[] = "{$boolField} = ?";
                    $params[] = $val ? 1 : 0;
                }
            }

            if (empty($fields)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'));
            }
            $params[] = $id;
            $params[] = $tenantId;
            DB::update(
                "UPDATE newsletters SET " . implode(', ', $fields) . " WHERE id = ? AND tenant_id = ?",
                $params
            );
            return $this->respondWithData(['id' => $id, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'newsletter']));
        }
    }

    public function destroy(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_not_configured'), null, 503);
        }

        try {
            DB::delete("DELETE FROM newsletters WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $this->noContent();
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.delete_failed', ['resource' => 'newsletter']));
        }
    }

    public function subscribers(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $offset = ($page - 1) * $perPage;
        $status = $this->query('status');
        $search = $this->query('search');

        if (!$this->tableExists('newsletter_subscribers')) {
            // Fallback to users table if newsletter_subscribers doesn't exist
            try {
                $subscribers = DB::select(
                    "SELECT u.id, u.first_name, u.last_name, u.email, u.status, u.created_at,
                            'member' as source
                     FROM users u
                     WHERE u.tenant_id = ? AND u.newsletter_opt_in = 1
                     ORDER BY u.created_at DESC
                     LIMIT 100",
                    [$tenantId]
                );
                $subscribers = array_map(fn($r) => (array)$r, $subscribers);
                $total = count($subscribers);
                return $this->respondWithData([
                    'data' => $subscribers,
                    'meta' => [
                        'page' => 1,
                        'per_page' => 100,
                        'total' => $total,
                        'total_pages' => 1,
                        'has_more' => false,
                    ],
                    'stats' => [
                        'total' => $total,
                        'active' => $total,
                        'pending' => 0,
                        'unsubscribed' => 0,
                    ],
                ]);
            } catch (\Exception $e) {
                return $this->respondWithPaginatedCollection([], 0, 1, 20);
            }
        }

        try {
            // Get stats
            $stats = DB::selectOne(
                "SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) as unsubscribed
                 FROM newsletter_subscribers
                 WHERE tenant_id = ?",
                [$tenantId]
            );

            // Build filtered query
            $where = 'WHERE ns.tenant_id = ?';
            $params = [$tenantId];

            if ($status && in_array($status, ['active', 'pending', 'unsubscribed'])) {
                $where .= ' AND ns.status = ?';
                $params[] = $status;
            }

            if ($search) {
                $where .= ' AND (ns.email LIKE ? OR ns.first_name LIKE ? OR ns.last_name LIKE ?)';
                $searchTerm = '%' . $search . '%';
                $params[] = $searchTerm;
                $params[] = $searchTerm;
                $params[] = $searchTerm;
            }

            // Count filtered
            $countRow = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM newsletter_subscribers ns {$where}",
                $params
            );
            $total = (int) ($countRow->cnt ?? 0);

            // Fetch page
            $params[] = $perPage;
            $params[] = $offset;
            $subscribers = DB::select(
                "SELECT ns.id, ns.email, ns.first_name, ns.last_name, ns.status,
                        ns.source, ns.created_at, ns.confirmed_at, ns.user_id
                 FROM newsletter_subscribers ns
                 {$where}
                 ORDER BY ns.created_at DESC
                 LIMIT ? OFFSET ?",
                $params
            );
            $subscribers = array_map(fn($r) => (array)$r, $subscribers);

            $totalPages = $total > 0 ? (int) ceil($total / $perPage) : 0;

            return $this->respondWithData([
                'data' => $subscribers,
                'meta' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $total,
                    'total_pages' => $totalPages,
                    'has_more' => $page < $totalPages,
                ],
                'stats' => [
                    'total' => (int) ($stats->total ?? 0),
                    'active' => (int) ($stats->active ?? 0),
                    'pending' => (int) ($stats->pending ?? 0),
                    'unsubscribed' => (int) ($stats->unsubscribed ?? 0),
                ],
            ]);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Subscriber Management
    // ─────────────────────────────────────────────────────────────────────────────

    public function addSubscriber(): JsonResponse
    {
        $this->requireAdmin();

        $email = $this->input('email');
        $firstName = $this->input('first_name');
        $lastName = $this->input('last_name');

        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.valid_email_address_required'), 'email');
        }

        if (!$this->tableExists('newsletter_subscribers')) {
            return $this->respondWithError('TABLE_MISSING', __('api.subscriber_not_configured'), null, 503);
        }

        try {
            $tenantId = TenantContext::getId();
            $existing = \App\Models\NewsletterSubscriber::where('email', strtolower(trim($email)))
                ->where('tenant_id', $tenantId)
                ->first();
            if ($existing) {
                return $this->respondWithError('DUPLICATE', __('api.subscriber_already_exists'), 'email', 409);
            }

            $id = \App\Models\NewsletterSubscriber::createConfirmed($email, $firstName, $lastName, 'manual');
            return $this->respondWithData([
                'id' => $id,
                'email' => strtolower(trim($email)),
                'first_name' => $firstName,
                'last_name' => $lastName,
                'status' => 'active',
            ], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.create_failed', ['resource' => 'subscriber']));
        }
    }

    public function removeSubscriber(int $id): JsonResponse
    {
        $this->requireAdmin();

        if (!$this->tableExists('newsletter_subscribers')) {
            return $this->respondWithError('TABLE_MISSING', __('api.subscriber_not_configured'), null, 503);
        }

        try {
            $tenantId = TenantContext::getId();
            $subscriber = \App\Models\NewsletterSubscriber::where('id', $id)
                ->where('tenant_id', $tenantId)
                ->first();
            if (!$subscriber) {
                return $this->respondWithError('NOT_FOUND', __('api.subscriber_not_found'), null, 404);
            }

            $subscriber->delete();
            return $this->noContent();
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.delete_failed', ['resource' => 'subscriber']));
        }
    }

    public function importSubscribers(): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('admin_newsletter_import_subscribers', 5, 300);

        $rows = $this->input('rows');
        if (!is_array($rows) || empty($rows)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.rows_array_required'), 'rows');
        }

        if (!$this->tableExists('newsletter_subscribers')) {
            return $this->respondWithError('TABLE_MISSING', __('api.subscriber_not_configured'), null, 503);
        }

        try {
            $result = \App\Models\NewsletterSubscriber::import($rows);
            return $this->respondWithData([
                'imported' => $result['imported'],
                'skipped' => $result['skipped'],
                'total_rows' => count($rows),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('IMPORT_FAILED', __('api.create_failed', ['resource' => 'subscriber import']));
        }
    }

    public function exportSubscribers(): JsonResponse
    {
        $this->requireAdmin();

        if (!$this->tableExists('newsletter_subscribers')) {
            return $this->respondWithData([]);
        }

        try {
            $subscribers = \App\Models\NewsletterSubscriber::export();
            return $this->respondWithData($subscribers ?: []);
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    public function syncPlatformMembers(): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('admin_newsletter_sync_members', 3, 300);

        if (!$this->tableExists('newsletter_subscribers')) {
            return $this->respondWithError('TABLE_MISSING', __('api.subscriber_not_configured'), null, 503);
        }

        try {
            $result = \App\Models\NewsletterSubscriber::syncMembersWithStats();
            return $this->respondWithData([
                'synced' => $result['synced'],
                'total_users' => $result['total_users'],
                'already_subscribed' => $result['already_subscribed'],
                'eligible' => $result['eligible'],
                'pending_approval' => $result['pending_approval'] ?? 0,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('SYNC_FAILED', __('api.update_failed', ['resource' => 'member sync']));
        }
    }

    public function segments(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_segments')) {
            return $this->respondWithData([]);
        }

        try {
            $segments = DB::select(
                "SELECT * FROM newsletter_segments WHERE tenant_id = ? ORDER BY name ASC",
                [$tenantId]
            );
            return $this->respondWithData(array_map(fn($r) => (array)$r, $segments));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    public function templates(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithData([]);
        }

        try {
            $templates = DB::select(
                "SELECT * FROM newsletter_templates WHERE tenant_id = ? ORDER BY name ASC",
                [$tenantId]
            );
            return $this->respondWithData(array_map(fn($r) => (array)$r, $templates));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    public function analytics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $data = [
            'total_newsletters' => 0,
            'total_sent' => 0,
            'avg_open_rate' => 0,
            'avg_click_rate' => 0,
            'total_subscribers' => 0,
            'totals' => [
                'newsletters_sent' => 0,
                'total_sent' => 0,
                'total_failed' => 0,
                'total_opens' => 0,
                'unique_opens' => 0,
                'total_clicks' => 0,
                'unique_clicks' => 0,
            ],
            'monthly_breakdown' => [],
            'top_performers' => [],
        ];

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithData($data);
        }

        try {
            // Summary counts
            $row = DB::selectOne(
                "SELECT COUNT(*) as total, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
                        AVG(open_rate) as avg_open, AVG(click_rate) as avg_click
                 FROM newsletters WHERE tenant_id = ?",
                [$tenantId]
            );

            if ($row) {
                $data['total_newsletters'] = (int) ($row->total ?? 0);
                $data['total_sent'] = (int) ($row->sent ?? 0);
                $data['avg_open_rate'] = round((float) ($row->avg_open ?? 0), 1);
                $data['avg_click_rate'] = round((float) ($row->avg_click ?? 0), 1);
            }

            $subStmt = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            );
            $subRow = $subStmt;
            $data['total_subscribers'] = (int) ($subRow->cnt ?? 0);

            // Full analytics from sent newsletters (mirrors legacy PHP admin)
            $newsletters = \App\Models\Newsletter::where('status', 'sent')
                ->where('tenant_id', $tenantId)
                ->orderByDesc('sent_at')
                ->get()
                ->map(fn($n) => $n->toArray())
                ->all();

            $totals = &$data['totals'];
            $monthlyStats = [];
            $topPerformers = [];

            foreach ($newsletters as $newsletter) {
                $totals['newsletters_sent']++;
                $totals['total_sent'] += (int) ($newsletter['total_sent'] ?? 0);
                $totals['total_failed'] += (int) ($newsletter['total_failed'] ?? 0);
                $totals['total_opens'] += (int) ($newsletter['total_opens'] ?? 0);
                $totals['unique_opens'] += (int) ($newsletter['unique_opens'] ?? 0);
                $totals['total_clicks'] += (int) ($newsletter['total_clicks'] ?? 0);
                $totals['unique_clicks'] += (int) ($newsletter['unique_clicks'] ?? 0);

                // Group by month
                $sentAt = $newsletter['sent_at'] ?? null;
                if ($sentAt) {
                    $month = date('Y-m', strtotime($sentAt));
                    if (!isset($monthlyStats[$month])) {
                        $monthlyStats[$month] = [
                            'month' => $month,
                            'newsletters' => 0,
                            'sent' => 0,
                            'opens' => 0,
                            'clicks' => 0,
                        ];
                    }
                    $monthlyStats[$month]['newsletters']++;
                    $monthlyStats[$month]['sent'] += (int) ($newsletter['total_sent'] ?? 0);
                    $monthlyStats[$month]['opens'] += (int) ($newsletter['unique_opens'] ?? 0);
                    $monthlyStats[$month]['clicks'] += (int) ($newsletter['unique_clicks'] ?? 0);
                }

                // Top performers (min 10 recipients)
                $totalSent = (int) ($newsletter['total_sent'] ?? 0);
                if ($totalSent >= 10) {
                    $openRate = round(((int) ($newsletter['unique_opens'] ?? 0) / $totalSent) * 100, 1);
                    $clickRate = round(((int) ($newsletter['unique_clicks'] ?? 0) / $totalSent) * 100, 1);
                    $topPerformers[] = [
                        'id' => (int) $newsletter['id'],
                        'subject' => $newsletter['subject'] ?? '',
                        'sent_at' => $newsletter['sent_at'] ?? '',
                        'total_sent' => $totalSent,
                        'open_rate' => $openRate,
                        'click_rate' => $clickRate,
                    ];
                }
            }

            // Sort monthly by month ascending
            ksort($monthlyStats);
            $data['monthly_breakdown'] = array_values($monthlyStats);

            // Sort top performers by open rate descending, take top 10
            usort($topPerformers, function ($a, $b) {
                return $b['open_rate'] <=> $a['open_rate'];
            });
            $data['top_performers'] = array_slice($topPerformers, 0, 10);
        } catch (\Exception $e) {
            // Return defaults on error
        }

        return $this->respondWithData($data);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Segment CRUD
    // ─────────────────────────────────────────────────────────────────────────────

    public function showSegment(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_segments')) {
            return $this->respondWithError('NOT_FOUND', __('api.segment_not_found'), null, 404);
        }

        try {
            $segment = DB::selectOne(
                "SELECT * FROM newsletter_segments WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$segment) {
                return $this->respondWithError('NOT_FOUND', __('api.segment_not_found'), null, 404);
            }

            // Decode rules JSON if stored as string
            $segmentArr = (array)$segment;
            if (!empty($segmentArr['rules']) && is_string($segmentArr['rules'])) {
                $segmentArr['rules'] = json_decode($segmentArr['rules'], true) ?: [];
            }

            return $this->respondWithData($segmentArr);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api.fetch_failed', ['resource' => 'segment']));
        }
    }

    public function storeSegment(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $name = $this->input('name');
        $description = $this->input('description', '');
        $isActive = $this->inputBool('is_active', true);
        $matchType = $this->input('match_type', 'all');
        $rules = $this->input('rules');

        if (!$name) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name');
        }

        if (!in_array($matchType, ['all', 'any'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.match_type_must_be_all_or_any'), 'match_type');
        }

        if (!$this->tableExists('newsletter_segments')) {
            return $this->respondWithError('TABLE_MISSING', __('api.segment_not_configured'), null, 503);
        }

        try {
            $rulesJson = is_array($rules) ? json_encode($rules) : ($rules ?: '[]');

            // Count matching subscribers
            $subscriberCount = $this->countMatchingSubscribers($tenantId, $matchType, is_array($rules) ? $rules : (json_decode($rulesJson, true) ?: []));

            DB::insert(
                "INSERT INTO newsletter_segments (tenant_id, name, description, is_active, match_type, rules, subscriber_count, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                [$tenantId, $name, $description, $isActive ? 1 : 0, $matchType, $rulesJson, $subscriberCount]
            );

            $id = DB::getPdo()->lastInsertId();
            return $this->respondWithData([
                'id' => $id,
                'name' => $name,
                'is_active' => $isActive,
                'subscriber_count' => $subscriberCount,
            ], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.create_failed', ['resource' => 'segment']));
        }
    }

    public function updateSegment(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_segments')) {
            return $this->respondWithError('TABLE_MISSING', __('api.segment_not_configured'), null, 503);
        }

        try {
            // Check segment exists
            $existing = DB::selectOne(
                "SELECT id FROM newsletter_segments WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.segment_not_found'), null, 404);
            }

            $fields = [];
            $params = [];

            $name = $this->input('name');
            if ($name !== null) {
                $fields[] = "name = ?";
                $params[] = $name;
            }

            $description = $this->input('description');
            if ($description !== null) {
                $fields[] = "description = ?";
                $params[] = $description;
            }

            $isActive = $this->input('is_active');
            if ($isActive !== null) {
                $fields[] = "is_active = ?";
                $params[] = $isActive ? 1 : 0;
            }

            $matchType = $this->input('match_type');
            if ($matchType !== null) {
                if (!in_array($matchType, ['all', 'any'], true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.match_type_must_be_all_or_any'), 'match_type');
                }
                $fields[] = "match_type = ?";
                $params[] = $matchType;
            }

            $rules = $this->input('rules');
            if ($rules !== null) {
                $rulesJson = is_array($rules) ? json_encode($rules) : $rules;
                $fields[] = "rules = ?";
                $params[] = $rulesJson;
            }

            if (empty($fields)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'));
            }

            // Recalculate subscriber count if rules or match_type changed
            if ($rules !== null || $matchType !== null) {
                $finalMatchType = $matchType ?? 'all';
                $finalRules = is_array($rules) ? $rules : (json_decode($rules ?? '[]', true) ?: []);
                $subscriberCount = $this->countMatchingSubscribers($tenantId, $finalMatchType, $finalRules);
                $fields[] = "subscriber_count = ?";
                $params[] = $subscriberCount;
            }

            $fields[] = "updated_at = NOW()";
            $params[] = $id;
            $params[] = $tenantId;

            DB::update(
                "UPDATE newsletter_segments SET " . implode(', ', $fields) . " WHERE id = ? AND tenant_id = ?",
                $params
            );

            return $this->respondWithData(['id' => $id, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'segment']));
        }
    }

    public function destroySegment(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_segments')) {
            return $this->respondWithError('TABLE_MISSING', __('api.segment_not_configured'), null, 503);
        }

        try {
            $existing = DB::selectOne(
                "SELECT id FROM newsletter_segments WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.segment_not_found'), null, 404);
            }

            DB::delete(
                "DELETE FROM newsletter_segments WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
            return $this->noContent();
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.delete_failed', ['resource' => 'segment']));
        }
    }

    public function previewSegment(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $matchType = $this->input('match_type', 'all');
        $rules = $this->input('rules');

        if (!in_array($matchType, ['all', 'any'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.match_type_must_be_all_or_any'), 'match_type');
        }

        $rulesArray = is_array($rules) ? $rules : (json_decode($rules ?? '[]', true) ?: []);
        $count = $this->countMatchingSubscribers($tenantId, $matchType, $rulesArray);

        return $this->respondWithData([
            'matching_count' => $count,
            'match_type' => $matchType,
            'rules_count' => count($rulesArray),
        ]);
    }

    public function getSegmentSuggestions(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $suggestions = [];

        try {
            $suggestionDefinitions = [
                [
                    'name' => __('api.newsletter_segment_active_name'),
                    'description_key' => 'api.newsletter_segment_active_description',
                    'match_type' => 'all',
                    'rules' => [
                        ['field' => 'login_recency', 'operator' => 'newer_than_days', 'value' => '30'],
                    ],
                ],
                [
                    'name' => __('api.newsletter_segment_inactive_name'),
                    'description_key' => 'api.newsletter_segment_inactive_description',
                    'match_type' => 'any',
                    'rules' => [
                        ['field' => 'login_recency', 'operator' => 'older_than_days', 'value' => '60'],
                        ['field' => 'login_recency', 'operator' => 'equals', 'value' => 'never'],
                    ],
                ],
                [
                    'name' => __('api.newsletter_segment_listings_name'),
                    'description_key' => 'api.newsletter_segment_listings_description',
                    'match_type' => 'all',
                    'rules' => [
                        ['field' => 'has_listings', 'operator' => 'equals', 'value' => '1'],
                    ],
                ],
                [
                    'name' => __('api.newsletter_segment_new_name'),
                    'description_key' => 'api.newsletter_segment_new_description',
                    'match_type' => 'all',
                    'rules' => [
                        ['field' => 'member_since', 'operator' => 'after', 'value' => date('Y-m-d', strtotime('-30 days'))],
                    ],
                ],
                [
                    'name' => __('api.newsletter_segment_admins_name'),
                    'description_key' => 'api.newsletter_segment_admins_description',
                    'match_type' => 'any',
                    'rules' => [
                        ['field' => 'user_role', 'operator' => 'equals', 'value' => 'admin'],
                        ['field' => 'user_role', 'operator' => 'equals', 'value' => 'broker'],
                    ],
                ],
            ];

            foreach ($suggestionDefinitions as $definition) {
                try {
                    $count = $this->countMatchingSubscribers($tenantId, $definition['match_type'], $definition['rules']);
                } catch (\Throwable $e) {
                    $count = 0;
                }

                if ($count <= 0) {
                    continue;
                }

                $suggestions[] = [
                    'name' => $definition['name'],
                    'description' => __($definition['description_key'], ['count' => $count]),
                    'match_type' => $definition['match_type'],
                    'rules' => $definition['rules'],
                    'estimated_count' => $count,
                ];
            }
        } catch (\Exception $e) {
            // Return whatever suggestions we have
        }

        return $this->respondWithData($suggestions);
    }

    /**
     * Count subscribers matching the given segment rules.
     */
    private function countMatchingSubscribers(int $tenantId, string $matchType, array $rules): int
    {
        unset($tenantId);
        return NewsletterService::countRecipientsByRules($matchType, $rules);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Template CRUD
    // ─────────────────────────────────────────────────────────────────────────────

    public function showTemplate(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
        }

        try {
            $item = DB::selectOne(
                "SELECT t.*,
                        (SELECT COUNT(*) FROM newsletters n WHERE n.template_id = t.id AND n.tenant_id = ?) as usage_count
                 FROM newsletter_templates t
                 WHERE t.id = ? AND t.tenant_id = ?",
                [$tenantId, $id, $tenantId]
            );

            if (!$item) {
                return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
            }
            return $this->respondWithData((array)$item);
        } catch (\Exception $e) {
            return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
        }
    }

    public function storeTemplate(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $name = $this->input('name');
        if (!$name) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name');
        }

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithError('TABLE_MISSING', __('api.template_not_configured'), null, 503);
        }

        $description = $this->input('description', '');
        $category = $this->input('category', 'custom');
        $isActive = $this->input('is_active') !== null ? ($this->input('is_active') ? 1 : 0) : 1;
        $subject = $this->input('subject', '');
        $previewText = $this->input('preview_text', '');
        $content = $this->input('content', '');
        $contentFormat = $this->input('content_format', 'richtext');
        $designJson = $this->input('design_json') ?: null;

        if (!in_array($contentFormat, self::CONTENT_FORMATS, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format');
        }

        if (strlen((string) $content) > self::MAX_CONTENT_BYTES) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.newsletter_content_too_large'), 'content');
        }

        $content = \App\Services\EmailHtmlSanitizer::sanitizeForFormat((string) $content, $contentFormat);

        try {
            DB::insert(
                "INSERT INTO newsletter_templates
                    (tenant_id, name, description, category, is_active, subject, preview_text, content, content_format, design_json, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                [$tenantId, $name, $description, $category, $isActive, $subject, $previewText, $content, $contentFormat, $designJson, $userId]
            );
            $id = DB::getPdo()->lastInsertId();
            return $this->respondWithData(['id' => $id, 'name' => $name], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.create_failed', ['resource' => 'template']));
        }
    }

    public function updateTemplate(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithError('TABLE_MISSING', __('api.template_not_configured'), null, 503);
        }

        try {
            $fields = [];
            $params = [];

            $allowedFields = ['name', 'description', 'category', 'subject', 'preview_text'];

            foreach ($allowedFields as $field) {
                $val = $this->input($field);
                if ($val !== null) {
                    $fields[] = "{$field} = ?";
                    $params[] = $val;
                }
            }

            $contentFormat = $this->input('content_format');
            if ($contentFormat !== null) {
                if (!in_array($contentFormat, self::CONTENT_FORMATS, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format');
                }
                $fields[] = "content_format = ?";
                $params[] = $contentFormat;
            }

            $content = $this->input('content');
            if ($content !== null) {
                if (strlen((string) $content) > self::MAX_CONTENT_BYTES) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.newsletter_content_too_large'), 'content');
                }
                $effectiveFormat = $contentFormat
                    ?? (string) (DB::table('newsletter_templates')->where('id', $id)->where('tenant_id', $tenantId)->value('content_format') ?: 'richtext');
                $fields[] = "content = ?";
                $params[] = \App\Services\EmailHtmlSanitizer::sanitizeForFormat((string) $content, $effectiveFormat);
            }

            $designJson = $this->input('design_json');
            if ($designJson !== null) {
                $fields[] = "design_json = ?";
                $params[] = $designJson === '' ? null : $designJson;
            }

            // Handle boolean field
            $isActive = $this->input('is_active');
            if ($isActive !== null) {
                $fields[] = "is_active = ?";
                $params[] = $isActive ? 1 : 0;
            }

            if (empty($fields)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'));
            }

            $fields[] = "updated_at = NOW()";
            $params[] = $id;
            $params[] = $tenantId;

            DB::update(
                "UPDATE newsletter_templates SET " . implode(', ', $fields) . " WHERE id = ? AND tenant_id = ?",
                $params
            );
            return $this->respondWithData(['id' => $id, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'template']));
        }
    }

    public function destroyTemplate(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithError('TABLE_MISSING', __('api.template_not_configured'), null, 503);
        }

        try {
            DB::delete(
                "DELETE FROM newsletter_templates WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
            return $this->noContent();
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.delete_failed', ['resource' => 'template']));
        }
    }

    public function duplicateTemplate(int $id): JsonResponse
    {
        $userId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithError('TABLE_MISSING', __('api.template_not_configured'), null, 503);
        }

        try {
            $original = DB::selectOne(
                "SELECT * FROM newsletter_templates WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$original) {
                return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
            }

            $newName = $original->name . ' (Copy)';

            DB::insert(
                "INSERT INTO newsletter_templates
                    (tenant_id, name, description, category, is_active, subject, preview_text, content_format, design_json, content, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                [
                    $tenantId,
                    $newName,
                    $original->description ?? '',
                    $original->category ?? 'custom',
                    $original->is_active ?? 1,
                    $original->subject ?? '',
                    $original->preview_text ?? '',
                    $original->content_format ?? 'richtext',
                    $original->design_json ?? null,
                    $original->content ?? '',
                    $userId,
                ]
            );

            $newId = DB::getPdo()->lastInsertId();
            return $this->respondWithData(['id' => $newId, 'name' => $newName], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('DUPLICATE_FAILED', __('api.create_failed', ['resource' => 'template duplicate']));
        }
    }

    public function previewTemplate(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_templates')) {
            return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
        }

        try {
            $item = DB::selectOne(
                "SELECT content, subject, name FROM newsletter_templates WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$item) {
                return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
            }
            return $this->respondWithData([
                'html' => $item->content ?? '',
                'subject' => $item->subject ?? '',
                'name' => $item->name ?? '',
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('NOT_FOUND', __('api.template_not_found'), null, 404);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Per-Campaign Stats
    // ─────────────────────────────────────────────────────────────────────────────

    public function stats(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
        }

        try {
            // Get newsletter with author info
            $newsletter = DB::selectOne(
                "SELECT n.*, u.first_name as author_first_name, u.last_name as author_last_name,
 u.profile_type as author_profile_type,
 u.organization_name as author_organization_name
                 FROM newsletters n
                 LEFT JOIN users u ON n.created_by = u.id
                 WHERE n.id = ? AND n.tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            $authorName = UserDisplayName::resolvePrefixed($newsletter, 'author_');

            // ── Delivery stats ──
            $delivery = [
                'total_sent' => 0,
                'delivered' => 0,
                'failed' => 0,
                'bounced' => 0,
                'pending' => 0,
            ];

            if ($this->tableExists('newsletter_queue')) {
                try {
                    $qStmt = DB::select(
                        "SELECT status, COUNT(*) as cnt
                         FROM newsletter_queue
                         WHERE newsletter_id = ? AND tenant_id = ?
                         GROUP BY status",
                        [$id, $tenantId]
                    );
                    foreach ($qStmt as $row) {
                        $s = $row->status ?? '';
                        $c = (int) ($row->cnt ?? 0);
                        if ($s === 'sent') {
                            $delivery['delivered'] += $c;
                            $delivery['total_sent'] += $c;
                        } elseif ($s === 'failed') {
                            $delivery['failed'] += $c;
                            $delivery['total_sent'] += $c;
                        } elseif ($s === 'bounced') {
                            $delivery['bounced'] += $c;
                            $delivery['total_sent'] += $c;
                        } elseif ($s === 'pending' || $s === 'processing' || $s === 'sending') {
                            $delivery['pending'] += $c;
                        }
                    }
                } catch (\Exception $e) {
                    $delivery['total_sent'] = (int) ($newsletter->total_sent ?? 0);
                    $delivery['delivered'] = $delivery['total_sent'] - (int) ($newsletter->total_failed ?? 0);
                    $delivery['failed'] = (int) ($newsletter->total_failed ?? 0);
                }
            } else {
                $delivery['total_sent'] = (int) ($newsletter->total_sent ?? 0);
                $delivery['delivered'] = $delivery['total_sent'] - (int) ($newsletter->total_failed ?? 0);
                $delivery['failed'] = (int) ($newsletter->total_failed ?? 0);
            }

            if ($this->tableExists('newsletter_bounces')) {
                try {
                    $bStmt = DB::selectOne(
                        "SELECT COUNT(*) as cnt FROM newsletter_bounces
                         WHERE newsletter_id = ? AND tenant_id = ?",
                        [$id, $tenantId]
                    );
                    $delivery['bounced'] = (int) ($bStmt->cnt ?? 0);
                } catch (\Exception $e) {
                    // Keep default
                }
            }

            // ── Engagement stats ──
            $uniqueOpens = (int) ($newsletter->unique_opens ?? 0);
            $totalOpens = (int) ($newsletter->total_opens ?? 0);
            $uniqueClicks = (int) ($newsletter->unique_clicks ?? 0);
            $totalClicks = (int) ($newsletter->total_clicks ?? 0);

            if ($this->tableExists('newsletter_opens')) {
                try {
                    $oRow = DB::selectOne(
                        "SELECT COUNT(*) as total, COUNT(DISTINCT email) as uniq
                         FROM newsletter_opens
                         WHERE newsletter_id = ? AND tenant_id = ?",
                        [$id, $tenantId]
                    );
                    if ($oRow) {
                        $totalOpens = max($totalOpens, (int) $oRow->total);
                        $uniqueOpens = max($uniqueOpens, (int) $oRow->uniq);
                    }
                } catch (\Exception $e) {
                    // Keep newsletter-level data
                }
            }

            if ($this->tableExists('newsletter_clicks')) {
                try {
                    $cRow = DB::selectOne(
                        "SELECT COUNT(*) as total, COUNT(DISTINCT email) as uniq
                         FROM newsletter_clicks
                         WHERE newsletter_id = ? AND tenant_id = ?",
                        [$id, $tenantId]
                    );
                    if ($cRow) {
                        $totalClicks = max($totalClicks, (int) $cRow->total);
                        $uniqueClicks = max($uniqueClicks, (int) $cRow->uniq);
                    }
                } catch (\Exception $e) {
                    // Keep newsletter-level data
                }
            }

            $totalForRate = $delivery['delivered'] > 0 ? $delivery['delivered'] : $delivery['total_sent'];
            $totalAll = $delivery['total_sent'] + $delivery['failed'];
            $engagement = [
                'unique_opens' => $uniqueOpens,
                'total_opens' => $totalOpens,
                'unique_clicks' => $uniqueClicks,
                'total_clicks' => $totalClicks,
                'open_rate' => $totalForRate > 0 ? round(($uniqueOpens / $totalForRate) * 100, 1) : 0,
                'click_rate' => $totalForRate > 0 ? round(($uniqueClicks / $totalForRate) * 100, 1) : 0,
                'click_to_open_rate' => $uniqueOpens > 0 ? round(($uniqueClicks / $uniqueOpens) * 100, 1) : 0,
                'success_rate' => $totalAll > 0 ? round(($delivery['delivered'] / $totalAll) * 100, 1) : 0,
            ];

            // ── A/B test data ──
            $abTest = null;
            if (!empty($newsletter->ab_test_enabled) && !empty($newsletter->subject_b)) {
                $abTest = [
                    'subject_a' => $newsletter->subject ?? '',
                    'subject_b' => $newsletter->subject_b ?? '',
                    'subject_a_opens' => 0,
                    'subject_a_clicks' => 0,
                    'subject_b_opens' => 0,
                    'subject_b_clicks' => 0,
                    'winner' => $newsletter->ab_winner ?? null,
                    'winning_margin' => 0,
                ];

                if ($this->tableExists('newsletter_queue') && $this->tableExists('newsletter_opens')) {
                    try {
                        $aOpens = DB::selectOne(
                            "SELECT COUNT(DISTINCT o.email) as cnt
                             FROM newsletter_opens o
                             JOIN newsletter_queue q ON o.email = q.email AND o.newsletter_id = q.newsletter_id
                             WHERE o.newsletter_id = ? AND o.tenant_id = ?
                             AND (q.ab_variant = 'a' OR q.ab_variant IS NULL)",
                            [$id, $tenantId]
                        );
                        $abTest['subject_a_opens'] = (int) ($aOpens->cnt ?? 0);

                        $bOpens = DB::selectOne(
                            "SELECT COUNT(DISTINCT o.email) as cnt
                             FROM newsletter_opens o
                             JOIN newsletter_queue q ON o.email = q.email AND o.newsletter_id = q.newsletter_id
                             WHERE o.newsletter_id = ? AND o.tenant_id = ?
                             AND q.ab_variant = 'b'",
                            [$id, $tenantId]
                        );
                        $abTest['subject_b_opens'] = (int) ($bOpens->cnt ?? 0);
                    } catch (\Exception $e) {
                        $abTest['subject_a_opens'] = (int) ceil($uniqueOpens / 2);
                        $abTest['subject_b_opens'] = (int) floor($uniqueOpens / 2);
                    }
                }

                if ($this->tableExists('newsletter_queue') && $this->tableExists('newsletter_clicks')) {
                    try {
                        $aClicks = DB::selectOne(
                            "SELECT COUNT(DISTINCT c.email) as cnt
                             FROM newsletter_clicks c
                             JOIN newsletter_queue q ON c.email = q.email AND c.newsletter_id = q.newsletter_id
                             WHERE c.newsletter_id = ? AND c.tenant_id = ?
                             AND (q.ab_variant = 'a' OR q.ab_variant IS NULL)",
                            [$id, $tenantId]
                        );
                        $abTest['subject_a_clicks'] = (int) ($aClicks->cnt ?? 0);

                        $bClicks = DB::selectOne(
                            "SELECT COUNT(DISTINCT c.email) as cnt
                             FROM newsletter_clicks c
                             JOIN newsletter_queue q ON c.email = q.email AND c.newsletter_id = q.newsletter_id
                             WHERE c.newsletter_id = ? AND c.tenant_id = ?
                             AND q.ab_variant = 'b'",
                            [$id, $tenantId]
                        );
                        $abTest['subject_b_clicks'] = (int) ($bClicks->cnt ?? 0);
                    } catch (\Exception $e) {
                        $abTest['subject_a_clicks'] = (int) ceil($uniqueClicks / 2);
                        $abTest['subject_b_clicks'] = (int) floor($uniqueClicks / 2);
                    }
                }

                // Calculate winning margin
                $aRate = $abTest['subject_a_opens'];
                $bRate = $abTest['subject_b_opens'];
                if ($aRate > 0 || $bRate > 0) {
                    $maxRate = max($aRate, $bRate);
                    $minRate = min($aRate, $bRate);
                    $abTest['winning_margin'] = $minRate > 0
                        ? round((($maxRate - $minRate) / $minRate) * 100, 1)
                        : 100;
                }
            }

            // ── Timeline data (opens/clicks grouped by hour, first 48h) ──
            $timeline = [];
            $sentAt = $newsletter->sent_at ?? $newsletter->created_at;
            if ($sentAt && $this->tableExists('newsletter_opens')) {
                try {
                    $tStmt = DB::select(
                        "SELECT TIMESTAMPDIFF(HOUR, ?, opened_at) as hour_offset, COUNT(*) as opens
                         FROM newsletter_opens
                         WHERE newsletter_id = ? AND tenant_id = ?
                           AND opened_at >= ? AND opened_at <= DATE_ADD(?, INTERVAL 48 HOUR)
                         GROUP BY hour_offset
                         ORDER BY hour_offset",
                        [$sentAt, $id, $tenantId, $sentAt, $sentAt]
                    );
                    $opensMap = [];
                    foreach ($tStmt as $row) {
                        $h = (int) $row->hour_offset;
                        if ($h >= 0 && $h <= 48) {
                            $opensMap[$h] = (int) $row->opens;
                        }
                    }

                    $clicksMap = [];
                    if ($this->tableExists('newsletter_clicks')) {
                        try {
                            $tcStmt = DB::select(
                                "SELECT TIMESTAMPDIFF(HOUR, ?, clicked_at) as hour_offset, COUNT(*) as clicks
                                 FROM newsletter_clicks
                                 WHERE newsletter_id = ? AND tenant_id = ?
                                   AND clicked_at >= ? AND clicked_at <= DATE_ADD(?, INTERVAL 48 HOUR)
                                 GROUP BY hour_offset
                                 ORDER BY hour_offset",
                                [$sentAt, $id, $tenantId, $sentAt, $sentAt]
                            );
                            foreach ($tcStmt as $row) {
                                $h = (int) $row->hour_offset;
                                if ($h >= 0 && $h <= 48) {
                                    $clicksMap[$h] = (int) $row->clicks;
                                }
                            }
                        } catch (\Exception $e) {
                            // No click timeline data
                        }
                    }

                    for ($h = 0; $h <= 48; $h++) {
                        if (isset($opensMap[$h]) || isset($clicksMap[$h])) {
                            $timeline[] = [
                                'hour' => $h,
                                'opens' => $opensMap[$h] ?? 0,
                                'clicks' => $clicksMap[$h] ?? 0,
                            ];
                        }
                    }
                } catch (\Exception $e) {
                    // No timeline data
                }
            }

            // ── Top links clicked ──
            $topLinks = [];
            if ($this->tableExists('newsletter_clicks')) {
                try {
                    $lStmt = DB::select(
                        "SELECT url, COUNT(*) as clicks, COUNT(DISTINCT email) as unique_clicks
                         FROM newsletter_clicks
                         WHERE newsletter_id = ? AND tenant_id = ?
                         GROUP BY url
                         ORDER BY clicks DESC
                         LIMIT 10",
                        [$id, $tenantId]
                    );
                    $topLinks = array_map(function ($link) {
                        return [
                            'url' => $link->url ?? '',
                            'clicks' => (int) ($link->clicks ?? 0),
                            'unique_clicks' => (int) ($link->unique_clicks ?? 0),
                        ];
                    }, $lStmt);
                } catch (\Exception $e) {
                    // No link data
                }
            }

            // ── Device breakdown (from user agents) ──
            $deviceStats = ['desktop' => 0, 'mobile' => 0, 'tablet' => 0, 'unknown' => 0];
            if ($this->tableExists('newsletter_opens')) {
                try {
                    $uaRows = DB::select(
                        "SELECT user_agent FROM newsletter_opens
                         WHERE tenant_id = ? AND newsletter_id = ? AND user_agent IS NOT NULL",
                        [$tenantId, $id]
                    );
                    foreach ($uaRows as $uaRow) {
                        $ua = strtolower($uaRow->user_agent ?? '');
                        if (strpos($ua, 'mobile') !== false || strpos($ua, 'android') !== false || strpos($ua, 'iphone') !== false) {
                            $deviceStats['mobile']++;
                        } elseif (strpos($ua, 'tablet') !== false || strpos($ua, 'ipad') !== false) {
                            $deviceStats['tablet']++;
                        } elseif (strpos($ua, 'windows') !== false || strpos($ua, 'macintosh') !== false || strpos($ua, 'linux') !== false) {
                            $deviceStats['desktop']++;
                        } else {
                            $deviceStats['unknown']++;
                        }
                    }
                } catch (\Exception $e) {
                    // Keep defaults
                }
            }

            // ── Recent activity (last 20 opens+clicks) ──
            $recentActivity = [];
            try {
                $activityParts = [];
                if ($this->tableExists('newsletter_opens')) {
                    $activityParts[] = "(SELECT 'open' as action_type, email, opened_at as action_at, NULL as url
                                         FROM newsletter_opens WHERE tenant_id = ? AND newsletter_id = ?)";
                }
                if ($this->tableExists('newsletter_clicks')) {
                    $activityParts[] = "(SELECT 'click' as action_type, email, clicked_at as action_at, url
                                         FROM newsletter_clicks WHERE tenant_id = ? AND newsletter_id = ?)";
                }
                if (!empty($activityParts)) {
                    $params = [];
                    foreach ($activityParts as $p) {
                        $params[] = $tenantId;
                        $params[] = $id;
                    }
                    $activitySql = implode(' UNION ALL ', $activityParts) . ' ORDER BY action_at DESC LIMIT 20';
                    $recentActivity = DB::select($activitySql, $params);
                    $recentActivity = array_map(function ($row) {
                        return [
                            'action_type' => $row->action_type ?? 'open',
                            'email' => $row->email ?? '',
                            'action_at' => $row->action_at ?? '',
                            'url' => $row->url ?? null,
                        ];
                    }, $recentActivity);
                }
            } catch (\Exception $e) {
                // No activity data
            }

            // ── Peak engagement (max opens in one hour) ──
            $peakOpens = 0;
            $peakHour = null;
            if (!empty($timeline)) {
                foreach ($timeline as $point) {
                    if ($point['opens'] > $peakOpens) {
                        $peakOpens = $point['opens'];
                        $peakHour = $point['hour'];
                    }
                }
            }

            // ── Add A/B rates + split info ──
            if ($abTest !== null) {
                // Count sent per variant
                $aSent = 0;
                $bSent = 0;
                if ($this->tableExists('newsletter_queue')) {
                    try {
                        $variantCounts = DB::select(
                            "SELECT ab_variant, COUNT(*) as cnt
                             FROM newsletter_queue
                             WHERE newsletter_id = ? AND tenant_id = ? AND status IN ('sent', 'failed')
                             GROUP BY ab_variant",
                            [$id, $tenantId]
                        );
                        foreach ($variantCounts as $vc) {
                            $v = $vc->ab_variant ?? 'a';
                            $c = (int) ($vc->cnt ?? 0);
                            if ($v === 'b') {
                                $bSent = $c;
                            } else {
                                $aSent += $c;
                            }
                        }
                    } catch (\Exception $e) {
                        // Fallback: split total evenly
                        $splitPct = (int) ($newsletter->ab_split_percentage ?? 50);
                        $aSent = (int) round($delivery['total_sent'] * $splitPct / 100);
                        $bSent = $delivery['total_sent'] - $aSent;
                    }
                }
                $abTest['subject_a_sent'] = $aSent;
                $abTest['subject_b_sent'] = $bSent;
                $abTest['subject_a_open_rate'] = $aSent > 0 ? round(($abTest['subject_a_opens'] / $aSent) * 100, 1) : 0;
                $abTest['subject_b_open_rate'] = $bSent > 0 ? round(($abTest['subject_b_opens'] / $bSent) * 100, 1) : 0;
                $abTest['subject_a_click_rate'] = $aSent > 0 ? round(($abTest['subject_a_clicks'] / $aSent) * 100, 1) : 0;
                $abTest['subject_b_click_rate'] = $bSent > 0 ? round(($abTest['subject_b_clicks'] / $bSent) * 100, 1) : 0;
                $abTest['split_percentage'] = (int) ($newsletter->ab_split_percentage ?? 50);
                $abTest['winner_metric'] = $newsletter->ab_winner_metric ?? 'opens';
            }

            return $this->respondWithData([
                'newsletter' => [
                    'id' => (int) $newsletter->id,
                    'name' => $newsletter->name ?? '',
                    'subject' => $newsletter->subject ?? '',
                    'subject_b' => $newsletter->subject_b ?? null,
                    'status' => $newsletter->status ?? 'draft',
                    'ab_test_enabled' => !empty($newsletter->ab_test_enabled),
                    'ab_winner' => $newsletter->ab_winner ?? null,
                    'ab_winner_metric' => $newsletter->ab_winner_metric ?? 'opens',
                    'created_by' => (int) ($newsletter->created_by ?? 0),
                    'author_name' => $authorName ?: null,
                    'sent_at' => $newsletter->sent_at ?? null,
                    'created_at' => $newsletter->created_at ?? null,
                ],
                'delivery' => $delivery,
                'engagement' => $engagement,
                'ab_test' => $abTest,
                'timeline' => $timeline,
                'top_links' => $topLinks,
                'device_stats' => $deviceStats,
                'recent_activity' => $recentActivity,
                'peak_engagement' => [
                    'max_opens_per_hour' => $peakOpens,
                    'peak_hour' => $peakHour,
                ],
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api.fetch_failed', ['resource' => 'newsletter stats']));
        }
    }

    public function selectAbWinner(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $winner = $this->input('winner');
        if (!in_array($winner, ['a', 'b'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.ab_winner_must_be_a_or_b'), 'winner');
        }

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_not_configured'), null, 503);
        }

        try {
            $newsletter = DB::selectOne(
                "SELECT id, ab_test_enabled FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            if (empty($newsletter->ab_test_enabled)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_ab_testing'));
            }

            DB::update(
                "UPDATE newsletters SET ab_winner = ? WHERE id = ? AND tenant_id = ?",
                [$winner, $id, $tenantId]
            );

            return $this->respondWithData(['success' => true, 'winner' => $winner]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'A/B test winner']));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Bounce Management
    // ─────────────────────────────────────────────────────────────────────────────

    public function getBounces(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $limit = $this->queryInt('limit', 50, 1, 500);
        $offset = $this->queryInt('offset', 0, 0);
        $type = $this->query('type');
        $startDate = $this->query('startDate');
        $endDate = $this->query('endDate');

        if (!$this->tableExists('newsletter_bounces')) {
            return $this->respondWithData([]);
        }

        try {
            $where = 'WHERE b.tenant_id = ?';
            $params = [$tenantId];

            if ($type) {
                $where .= ' AND b.bounce_type = ?';
                $params[] = $type;
            }

            if ($startDate) {
                $where .= ' AND b.bounced_at >= ?';
                $params[] = $startDate;
            }

            if ($endDate) {
                $where .= ' AND b.bounced_at <= ?';
                $params[] = $endDate;
            }

            $bounces = DB::select(
                "SELECT b.*, n.subject as newsletter_subject
                 FROM newsletter_bounces b
                 LEFT JOIN newsletters n ON b.newsletter_id = n.id
                 {$where}
                 ORDER BY b.bounced_at DESC
                 LIMIT ? OFFSET ?",
                array_merge($params, [$limit, $offset])
            );

            return $this->respondWithData(array_map(fn($r) => (array)$r, $bounces));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    public function getSuppressionList(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_suppression_list')) {
            return $this->respondWithData([]);
        }

        try {
            $list = DB::select(
                "SELECT email, reason, suppressed_at, bounce_count
                 FROM newsletter_suppression_list
                 WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > NOW())
                 ORDER BY suppressed_at DESC",
                [$tenantId]
            );

            return $this->respondWithData(array_map(fn($r) => (array)$r, $list));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    public function unsuppress(string $email): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $email = strtolower(trim(rawurldecode($email)));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_email'), 'email');
        }

        if (!$this->tableExists('newsletter_suppression_list')) {
            return $this->respondWithError('TABLE_MISSING', __('api.suppression_list_not_available'), null, 503);
        }

        try {
            DB::delete(
                "DELETE FROM newsletter_suppression_list WHERE tenant_id = ? AND email = ?",
                [$tenantId, $email]
            );
            return $this->respondWithData(['success' => true, 'email' => $email]);
        } catch (\Exception $e) {
            return $this->respondWithError('UNSUPPRESS_FAILED', __('api.delete_failed', ['resource' => 'suppression entry']));
        }
    }

    public function suppress(string $email): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $email = strtolower(trim(rawurldecode($email)));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_email'), 'email');
        }

        if (!$this->tableExists('newsletter_suppression_list')) {
            return $this->respondWithError('TABLE_MISSING', __('api.suppression_list_not_available'), null, 503);
        }

        try {
            DB::insert(
                "INSERT INTO newsletter_suppression_list (tenant_id, email, reason, bounce_count)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE suppressed_at = NOW()",
                [$tenantId, $email, 'manual', 0]
            );
            return $this->respondWithData(['success' => true, 'email' => $email]);
        } catch (\Exception $e) {
            return $this->respondWithError('SUPPRESS_FAILED', __('api.create_failed', ['resource' => 'suppression entry']));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Resend Workflow
    // ─────────────────────────────────────────────────────────────────────────────

    public function getResendInfo(int $newsletterId): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters') || !$this->tableExists('newsletter_queue')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_tables_not_available'), null, 503);
        }

        try {
            // Get newsletter stats
            $newsletter = DB::selectOne(
                "SELECT id, total_sent, unique_opens, unique_clicks FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$newsletterId, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            // Count non-openers
            $nonOpenersRow = DB::selectOne(
                "SELECT COUNT(*) as cnt
                 FROM newsletter_queue q
                 INNER JOIN newsletters n ON n.id = q.newsletter_id AND n.tenant_id = ?
                 WHERE q.newsletter_id = ? AND q.status = 'sent'
                 AND q.email NOT IN (
                     SELECT DISTINCT email FROM newsletter_opens
                     WHERE newsletter_id = ? AND tenant_id = ?
                 )",
                [$tenantId, $newsletterId, $newsletterId, $tenantId]
            );
            $nonOpeners = (int) ($nonOpenersRow->cnt ?? 0);

            // Count non-clickers (opened but didn't click)
            $nonClickersRow = DB::selectOne(
                "SELECT COUNT(DISTINCT o.email) as cnt
                 FROM newsletter_opens o
                 WHERE o.newsletter_id = ? AND o.tenant_id = ?
                 AND o.email NOT IN (
                     SELECT DISTINCT email FROM newsletter_clicks
                     WHERE newsletter_id = ? AND tenant_id = ?
                 )",
                [$newsletterId, $tenantId, $newsletterId, $tenantId]
            );
            $nonClickers = (int) ($nonClickersRow->cnt ?? 0);

            return $this->respondWithData([
                'newsletter_id' => (int)$newsletter->id,
                'total_sent' => (int)($newsletter->total_sent ?? 0),
                'total_opened' => (int)($newsletter->unique_opens ?? 0),
                'total_clicked' => (int)($newsletter->unique_clicks ?? 0),
                'non_openers_count' => (int)$nonOpeners,
                'non_clickers_count' => (int)$nonClickers,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api.fetch_failed', ['resource' => 'resend info']));
        }
    }

    public function resend(int $newsletterId): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('admin_newsletter_resend', 3, 300);
        $tenantId = TenantContext::getId();
        $target = $this->input('target');
        $segmentId = $this->inputInt('segment_id');
        $subjectOverride = $this->input('subject_override');

        if (!in_array($target, ['non_openers', 'non_clickers', 'segment'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_target'), 'target');
        }

        if (!$this->tableExists('newsletters') || !$this->tableExists('newsletter_queue')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_tables_not_available'), null, 503);
        }

        try {
            // Get newsletter
            $newsletter = DB::selectOne(
                "SELECT * FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$newsletterId, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            // Get recipient list based on target
            $recipients = [];
            if ($target === 'non_openers') {
                $stmt = DB::select(
                    "SELECT q.email, q.user_id, q.name, q.first_name, q.last_name, q.unsubscribe_token
                     FROM newsletter_queue q
                     INNER JOIN newsletters n ON n.id = q.newsletter_id AND n.tenant_id = ?
                     WHERE q.newsletter_id = ? AND q.tenant_id = ? AND q.status = 'sent'
                     AND q.email NOT IN (
                         SELECT DISTINCT email FROM newsletter_opens
                         WHERE newsletter_id = ? AND tenant_id = ?
                     )",
                    [$tenantId, $newsletterId, $tenantId, $newsletterId, $tenantId]
                );
                $recipients = array_map(fn($row) => (array) $row, $stmt);
            } elseif ($target === 'non_clickers') {
                $stmt = DB::select(
                    "SELECT q.email, q.user_id, q.name, q.first_name, q.last_name, q.unsubscribe_token
                     FROM newsletter_opens o
                     INNER JOIN newsletter_queue q ON q.newsletter_id = o.newsletter_id AND q.email = o.email
                     WHERE o.newsletter_id = ? AND o.tenant_id = ? AND q.tenant_id = ? AND q.status = 'sent'
                     AND o.email NOT IN (
                         SELECT DISTINCT email FROM newsletter_clicks
                         WHERE newsletter_id = ? AND tenant_id = ?
                     )
                     GROUP BY q.email, q.user_id, q.name, q.first_name, q.last_name, q.unsubscribe_token",
                    [$newsletterId, $tenantId, $tenantId, $newsletterId, $tenantId]
                );
                $recipients = array_map(fn($row) => (array) $row, $stmt);
            } elseif ($target === 'segment' && $segmentId) {
                $sentEmails = DB::table('newsletter_queue')
                    ->where('tenant_id', $tenantId)
                    ->where('newsletter_id', $newsletterId)
                    ->where('status', 'sent')
                    ->pluck('email')
                    ->map(fn($email) => strtolower((string) $email))
                    ->flip()
                    ->all();

                $recipients = array_values(array_filter(
                    NewsletterService::getSegmentRecipients($segmentId),
                    fn($recipient) => isset($sentEmails[strtolower((string) ($recipient['email'] ?? ''))])
                ));
            }

            if (empty($recipients)) {
                return $this->respondWithError('NO_RECIPIENTS', __('api.no_recipients_for_resend'));
            }

            // Queue the resend
            $subject = $subjectOverride ?: $newsletter->subject;
            $queuedCount = 0;

            $queuedEmails = [];
            $suppressedEmails = $this->activeSuppressedEmailSet($tenantId);
            foreach ($recipients as $recipient) {
                $recipient = is_array($recipient) ? $recipient : ['email' => (string) $recipient];
                $email = strtolower(trim((string) ($recipient['email'] ?? '')));
                if ($email === '' || isset($queuedEmails[$email]) || isset($suppressedEmails[$email])) {
                    continue;
                }
                $queuedEmails[$email] = true;

                DB::insert(
                    "INSERT INTO newsletter_queue
                        (tenant_id, newsletter_id, email, user_id, name, first_name, last_name,
                         status, unsubscribe_token, tracking_token, subject_override, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NOW())",
                    [
                        $tenantId,
                        $newsletterId,
                        $email,
                        $recipient['user_id'] ?? null,
                        $recipient['name'] ?? '',
                        $recipient['first_name'] ?? '',
                        $recipient['last_name'] ?? '',
                        $recipient['unsubscribe_token'] ?? bin2hex(random_bytes(32)),
                        bin2hex(random_bytes(32)),
                        $subjectOverride ?: null,
                    ]
                );
                $queuedCount++;
            }

            // Mark the newsletter as sending again BEFORE the time-boxed drain below.
            // The cron drainer only claims newsletters whose status is 'sending', so
            // without this any resend rows left over when the budget expires would
            // never be delivered. processQueue() restores 'sent' + sent_at once the
            // queue empties.
            DB::update(
                "UPDATE newsletters SET status = 'sending', updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$newsletterId, $tenantId]
            );

            // Time-boxed for the same reason as sendNewsletter(): an unbounded drain
            // here outlives the frontend request timeout on any sizeable resend.
            // The every-minute cron drainer finishes the remainder.
            $processed = NewsletterService::processQueue($newsletterId, 5, 10);

            return $this->respondWithData([
                'success' => true,
                'queued_count' => $queuedCount,
                'processed' => $processed,
                'subject' => $subject,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('RESEND_FAILED', __('api.create_failed', ['resource' => 'resend queue']));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Send-Time Optimizer
    // ─────────────────────────────────────────────────────────────────────────────

    public function getSendTimeData(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $days = $this->queryInt('days', 30, 7, 365);

        if (!$this->tableExists('newsletter_opens')) {
            return $this->respondWithData([
                'heatmap' => [],
                'recommendations' => [],
                'insights' => __('api.newsletter_send_time_no_data'),
            ]);
        }

        try {
            // Get heatmap data (day of week × hour)
            $heatmapRaw = DB::select(
                "SELECT DAYOFWEEK(opened_at) as day_of_week, HOUR(opened_at) as hour,
                        COUNT(*) as opens, COUNT(DISTINCT email) as unique_opens
                 FROM newsletter_opens
                 WHERE tenant_id = ? AND opened_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY DAYOFWEEK(opened_at), HOUR(opened_at)
                 ORDER BY day_of_week, hour",
                [$tenantId, $days]
            );

            // Also get click data for the same period
            $clicksBySlot = [];
            if ($this->tableExists('newsletter_clicks')) {
                try {
                    $clickStmt = DB::select(
                        "SELECT DAYOFWEEK(clicked_at) as day_of_week, HOUR(clicked_at) as hour,
                                COUNT(*) as clicks
                         FROM newsletter_clicks
                         WHERE tenant_id = ? AND clicked_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                         GROUP BY DAYOFWEEK(clicked_at), HOUR(clicked_at)",
                        [$tenantId, $days]
                    );
                    foreach ($clickStmt as $cRow) {
                        $clicksBySlot[(int)$cRow->day_of_week . '_' . (int)$cRow->hour] = (int)$cRow->clicks;
                    }
                } catch (\Exception $e) {
                    // No click data
                }
            }

            $heatmap = [];
            foreach ($heatmapRaw as $row) {
                $key = (int)$row->day_of_week . '_' . (int)$row->hour;
                $clicks = $clicksBySlot[$key] ?? 0;
                $heatmap[] = [
                    'day_of_week' => (int)$row->day_of_week,
                    'hour' => (int)$row->hour,
                    'engagement_score' => (int)$row->opens + ($clicks * 2),
                    'opens' => (int)$row->opens,
                    'clicks' => $clicks,
                ];
            }

            // Generate recommendations (top 3 times)
            $scores = [];
            foreach ($heatmap as $cell) {
                $key = "{$cell['day_of_week']}_{$cell['hour']}";
                $scores[$key] = $cell['engagement_score'];
            }
            arsort($scores);
            $topTimes = array_slice($scores, 0, 3, true);

            $recommendations = [];
            $dayNames = [
                '',
                __('api.day_sunday'),
                __('api.day_monday'),
                __('api.day_tuesday'),
                __('api.day_wednesday'),
                __('api.day_thursday'),
                __('api.day_friday'),
                __('api.day_saturday'),
            ];
            foreach ($topTimes as $key => $score) {
                [$day, $hour] = explode('_', $key);
                $recommendations[] = [
                    'day_of_week' => (int)$day,
                    'hour' => (int)$hour,
                    'score' => $score,
                    'description' => __('api.newsletter_send_time_description', [
                        'day' => $dayNames[(int)$day],
                        'time' => date('g:i A', strtotime("{$hour}:00")),
                    ]),
                ];
            }

            $insights = count($heatmap) > 0
                ? __('api.newsletter_send_time_insights', ['days' => $days])
                : __('api.newsletter_send_time_empty');

            return $this->respondWithData([
                'heatmap' => $heatmap,
                'recommendations' => $recommendations,
                'insights' => $insights,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithData([
                'heatmap' => [],
                'recommendations' => [],
                'insights' => __('api.newsletter_send_time_data_error'),
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Send / Test / Duplicate / Activity
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Send a newsletter immediately
     */
    public function sendNewsletter(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('admin_newsletter_send', 2, 300);
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_tables_not_available'), null, 503);
        }

        try {
            $newsletter = DB::selectOne(
                "SELECT id, status, target_audience, segment_id, target_groups, target_counties, target_towns
                 FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            if ($newsletter->status === 'sent') {
                return $this->respondWithError('ALREADY_SENT', __('api.newsletter_already_sent'));
            }

            if ($newsletter->status === 'sending') {
                return $this->respondWithError('ALREADY_SENDING', __('api.newsletter_currently_sending'));
            }

            $targetAudience = $newsletter->target_audience ?? 'all_members';
            $segmentId = $newsletter->segment_id ?? null;

            // A 'segment' audience without a chosen segment must never fall through
            // to all_members (targeting fix, 2026-07-03).
            if ($targetAudience === 'segment' && !$segmentId) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.newsletter_segment_required'), 'segment_id');
            }

            // Pass stored group/geo targeting so it actually restricts recipients
            // (previously write-only — see NewsletterService::filterUserIdsByTargeting).
            $targeting = NewsletterService::extractTargeting($newsletter);

            $queued = NewsletterService::sendNow($id, $targetAudience, $segmentId, $targeting);

            // sendNow() sends only what fits in a short time budget and leaves the
            // rest to the every-minute cron drainer, so report the real state rather
            // than assuming the whole list went out during this request.
            $after = DB::selectOne(
                "SELECT status, total_sent FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
            $sent = (int) ($after->total_sent ?? 0);

            return $this->respondWithData([
                'queued' => $queued,
                'sent' => $sent,
                'remaining' => max(0, $queued - $sent),
                'status' => $after->status ?? 'sending',
                'message' => __('api_controllers_1.admin_newsletter.newsletter_queued', ['count' => $queued]),
            ]);
        } catch (\Exception $e) {
            Log::error('Newsletter send failed', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('SEND_FAILED', __('api.newsletter_send_failed'));
        }
    }

    /**
     * Send a test email to the current admin
     */
    public function sendTest(int $id): JsonResponse
    {
        $userId = $this->requireAdmin();
        $this->rateLimit('admin_newsletter_send_test', 10, 300);
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_tables_not_available'), null, 503);
        }

        try {
            $newsletter = DB::selectOne(
                "SELECT * FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            $admin = DB::selectOne(
                "SELECT email, first_name, last_name, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );

            if (!$admin || empty($admin->email)) {
                return $this->respondWithError('NO_EMAIL', __('api.admin_no_email'));
            }

            $tenantName = TenantContext::get()['name'] ?? 'Community';

            $sampleRecipient = [
                'email' => $admin->email,
                'first_name' => $admin->first_name ?? 'Admin',
                'last_name' => $admin->last_name ?? 'User',
                'name' => UserDisplayName::resolve($admin),
            ];

            // Test email is sent to the admin themselves — render in their preferred language.
            [$html, $textBody, $subject] = \App\I18n\LocaleContext::withLocale($admin, fn () => [
                NewsletterService::renderEmail(
                    (array)$newsletter,
                    $tenantName,
                    'test-unsubscribe-token',
                    $sampleRecipient
                ),
                NewsletterService::renderPlainTextPart(
                    (array)$newsletter,
                    $tenantName,
                    'test-unsubscribe-token',
                    $sampleRecipient
                ),
                __('emails.newsletter.test_prefix') . ' ' . ($newsletter->subject ?? __('emails.newsletter.no_subject')),
            ]);

            $sent = EmailDispatchService::sendRaw($admin->email, $subject, $html, null, null, null, 'newsletter_test', ['tenant_id' => $tenantId, 'textBody' => $textBody]);

            if ($sent) {
                return $this->respondWithData([
                    'sent_to' => $admin->email,
                    'message' => __('api_controllers_1.admin_newsletter.test_email_sent', ['email' => $admin->email]),
                ]);
            } else {
                return $this->respondWithError('SEND_FAILED', __('api.failed_send_test_email'));
            }
        } catch (\Exception $e) {
            return $this->respondWithError('SEND_FAILED', __('api.failed_send_test_email'));
        }
    }

    /**
     * Get estimated recipient count for targeting preview
     */
    public function recipientCount(): JsonResponse
    {
        $this->requireAdmin();

        try {
            $targetAudience = $this->input('target_audience', 'all_members');
            $segmentId = $this->inputInt('segment_id');

            // Apply the same group/geo targeting as the send path so the
            // previewed count always matches what would actually be queued.
            $targeting = NewsletterService::extractTargeting([
                'target_groups' => $this->normalizeJsonListInput($this->input('target_groups'), true),
                'target_counties' => $this->normalizeJsonListInput($this->input('target_counties')),
                'target_towns' => $this->normalizeJsonListInput($this->input('target_towns')),
            ]);

            if ($segmentId) {
                $count = NewsletterService::getSegmentRecipientCount($segmentId, $targeting);
            } else {
                $count = NewsletterService::getRecipientCount($targetAudience, $targeting);
            }

            return $this->respondWithData(['count' => $count]);
        } catch (\Exception $e) {
            return $this->respondWithData(['count' => 0]);
        }
    }

    /**
     * Render a live preview of unsaved draft content through the REAL send
     * pipeline, so the compose-screen preview matches exactly what recipients
     * receive. Accepts an unsaved body (works before the draft is persisted).
     */
    public function preview(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $this->rateLimit('admin_newsletter_preview', 30, 60);
        $tenantId = TenantContext::getId();

        $content = (string) $this->input('content', '');
        $contentFormat = $this->input('content_format', 'richtext');
        $subject = (string) $this->input('subject', '');
        $previewText = (string) $this->input('preview_text', '');

        if (!in_array($contentFormat, self::CONTENT_FORMATS, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format');
        }

        if (strlen($content) > self::MAX_CONTENT_BYTES) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.newsletter_content_too_large'), 'content');
        }

        // Sanitize with the SAME email-safe sanitizer as store(), so preview == send.
        $content = \App\Services\EmailHtmlSanitizer::sanitizeForFormat($content, $contentFormat);

        // Sample recipient defaults to the current admin (mirrors sendTest) so
        // {{first_name}} etc. resolve to something realistic.
        $admin = DB::selectOne(
            "SELECT email, first_name, last_name, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $sampleRecipient = [
            'email' => $admin->email ?? 'preview@example.com',
            'first_name' => $admin->first_name ?? 'there',
            'last_name' => $admin->last_name ?? '',
            'name' => UserDisplayName::resolve($admin) ?: 'Member',
        ];

        $tenantName = TenantContext::get()['name'] ?? 'Community';

        $newsletter = [
            'content' => $content,
            'content_format' => $contentFormat,
            'subject' => $subject,
            'preview_text' => $previewText,
        ];

        // trackingToken = null: preview must never write open/click analytics.
        // Render in the admin's own language for an accurate preview.
        [$html, $text] = \App\I18n\LocaleContext::withLocale($admin, fn () => [
            NewsletterService::renderEmail($newsletter, $tenantName, 'preview-token', $sampleRecipient, null),
            NewsletterService::renderPlainTextPart($newsletter, $tenantName, 'preview-token', $sampleRecipient),
        ]);

        return $this->respondWithData([
            'html' => $html,
            'text' => $text,
            'subject' => $subject,
        ]);
    }

    /**
     * Duplicate a newsletter as a new draft
     */
    public function duplicateNewsletter(int $id): JsonResponse
    {
        $userId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletters')) {
            return $this->respondWithError('TABLE_MISSING', __('api.newsletter_tables_not_available'), null, 503);
        }

        try {
            $newsletter = DB::selectOne(
                "SELECT name, subject, preview_text, content, content_format, design_json, target_audience, segment_id,
                        ab_test_enabled, subject_b, ab_split_percentage, ab_winner_metric,
                        ab_auto_select_winner, ab_auto_select_after_hours,
                        target_counties, target_towns, target_groups, template_id,
                        is_recurring, recurring_frequency, recurring_day, recurring_day_of_week, recurring_day_of_month,
                        recurring_time, recurring_end_date
                 FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }

            $newSubject = ($newsletter->subject ?? 'Newsletter') . ' (Copy)';
            $newName = ($newsletter->name ?? $newSubject) . ' (Copy)';

            DB::insert(
                "INSERT INTO newsletters (tenant_id, name, subject, preview_text, content, content_format, design_json, status,
                    target_audience, segment_id, ab_test_enabled, subject_b, ab_split_percentage,
                    ab_winner_metric, ab_auto_select_winner, ab_auto_select_after_hours,
                    target_counties, target_towns, target_groups, template_id,
                    is_recurring, recurring_frequency, recurring_day, recurring_day_of_week, recurring_day_of_month,
                    recurring_time, recurring_end_date, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
                [
                    $tenantId, $newName, $newSubject, $newsletter->preview_text, $newsletter->content,
                    $newsletter->content_format ?? 'richtext', $newsletter->design_json ?? null,
                    $newsletter->target_audience, $newsletter->segment_id,
                    $newsletter->ab_test_enabled, $newsletter->subject_b,
                    $newsletter->ab_split_percentage, $newsletter->ab_winner_metric,
                    $newsletter->ab_auto_select_winner, $newsletter->ab_auto_select_after_hours,
                    $newsletter->target_counties, $newsletter->target_towns,
                    $newsletter->target_groups, $newsletter->template_id,
                    $newsletter->is_recurring, $newsletter->recurring_frequency,
                    $newsletter->recurring_day, $newsletter->recurring_day_of_week, $newsletter->recurring_day_of_month,
                    $newsletter->recurring_time, $newsletter->recurring_end_date,
                    $userId,
                ]
            );

            $newId = DB::getPdo()->lastInsertId();

            return $this->respondWithData([
                'id' => (int) $newId,
                'message' => __('api.newsletter_duplicated'),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('DUPLICATE_FAILED', __('api.create_failed', ['resource' => 'newsletter duplicate']));
        }
    }

    /**
     * Get open/click activity log for a newsletter
     */
    public function activity(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 10, 200);
        $offset = ($page - 1) * $perPage;
        $type = $this->query('type', 'all');

        if ($this->tableExists('newsletters')) {
            $newsletter = DB::selectOne(
                "SELECT id FROM newsletters WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$newsletter) {
                return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
            }
        }

        $activities = [];

        try {
            if ($type === 'all' || $type === 'open') {
                if ($this->tableExists('newsletter_opens')) {
                    $opens = DB::select(
                        "SELECT o.id, o.email, 'open' as action_type, o.opened_at as action_at, o.user_agent, o.ip_address, NULL as url
                         FROM newsletter_opens o
                         INNER JOIN newsletters n ON n.id = o.newsletter_id AND n.tenant_id = ?
                         WHERE o.newsletter_id = ?
                         ORDER BY o.opened_at DESC",
                        [$tenantId, $id]
                    );
                    $activities = array_merge($activities, $opens ?: []);
                }
            }

            if ($type === 'all' || $type === 'click') {
                if ($this->tableExists('newsletter_clicks')) {
                    $clicks = DB::select(
                        "SELECT c.id, c.email, 'click' as action_type, c.clicked_at as action_at, c.user_agent, c.ip_address, c.url
                         FROM newsletter_clicks c
                         INNER JOIN newsletters n ON n.id = c.newsletter_id AND n.tenant_id = ?
                         WHERE c.newsletter_id = ?
                         ORDER BY c.clicked_at DESC",
                        [$tenantId, $id]
                    );
                    $activities = array_merge($activities, $clicks ?: []);
                }
            }

            // Convert objects to arrays for sorting and manipulation
            $activities = array_map(fn($r) => (array)$r, $activities);

            usort($activities, function ($a, $b) {
                return strtotime($b['action_at'] ?? '0') - strtotime($a['action_at'] ?? '0');
            });

            $totalCount = count($activities);
            $activities = array_slice($activities, $offset, $perPage);

            // Ensure each activity has a unique id (fallback if table lacks id column)
            foreach ($activities as $i => &$activity) {
                if (empty($activity['id'])) {
                    $activity['id'] = $offset + $i + 1;
                }
            }
            unset($activity);

            return $this->respondWithPaginatedCollection($activities, $totalCount, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Per-Subscriber Engagement Lists
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get list of subscribers who opened a newsletter (deduplicated by email)
     */
    public function openers(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 10, 200);
        $offset = ($page - 1) * $perPage;

        try {
            $total = 0;
            $items = [];

            if ($this->tableExists('newsletter_opens')) {
                $countRow = DB::selectOne(
                    "SELECT COUNT(DISTINCT email) as cnt FROM newsletter_opens WHERE newsletter_id = ? AND tenant_id = ?",
                    [$id, $tenantId]
                );
                $total = (int) ($countRow->cnt ?? 0);

                $items = DB::select(
                    "SELECT email, MIN(opened_at) as first_opened, COUNT(*) as open_count
                     FROM newsletter_opens
                     WHERE newsletter_id = ? AND tenant_id = ?
                     GROUP BY email
                     ORDER BY first_opened DESC
                     LIMIT ? OFFSET ?",
                    [$id, $tenantId, $perPage, $offset]
                );

                $items = array_map(function ($row) {
                    return [
                        // Deduplicated by email — email is the stable row key the admin
                        // UI's dynamic table needs (mirrors the id activity() guarantees).
                        'id' => $row->email ?? '',
                        'email' => $row->email ?? '',
                        'first_opened' => $row->first_opened ?? '',
                        'open_count' => (int) ($row->open_count ?? 0),
                    ];
                }, $items);
            }

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /**
     * Get list of subscribers who clicked a link in a newsletter (deduplicated by email)
     */
    public function clickers(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 10, 200);
        $offset = ($page - 1) * $perPage;

        try {
            $total = 0;
            $items = [];

            if ($this->tableExists('newsletter_clicks')) {
                $countRow = DB::selectOne(
                    "SELECT COUNT(DISTINCT email) as cnt FROM newsletter_clicks WHERE newsletter_id = ? AND tenant_id = ?",
                    [$id, $tenantId]
                );
                $total = (int) ($countRow->cnt ?? 0);

                $items = DB::select(
                    "SELECT email, MIN(clicked_at) as first_clicked, COUNT(*) as click_count, COUNT(DISTINCT url) as unique_links
                     FROM newsletter_clicks
                     WHERE newsletter_id = ? AND tenant_id = ?
                     GROUP BY email
                     ORDER BY first_clicked DESC
                     LIMIT ? OFFSET ?",
                    [$id, $tenantId, $perPage, $offset]
                );

                $items = array_map(function ($row) {
                    return [
                        // Deduplicated by email — email is the stable row key the admin
                        // UI's dynamic table needs (mirrors the id activity() guarantees).
                        'id' => $row->email ?? '',
                        'email' => $row->email ?? '',
                        'first_clicked' => $row->first_clicked ?? '',
                        'click_count' => (int) ($row->click_count ?? 0),
                        'unique_links' => (int) ($row->unique_links ?? 0),
                    ];
                }, $items);
            }

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /**
     * Get list of recipients who did NOT open a newsletter
     */
    public function nonOpeners(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 10, 200);
        $offset = ($page - 1) * $perPage;

        try {
            $total = 0;
            $items = [];

            if ($this->tableExists('newsletter_queue') && $this->tableExists('newsletter_opens')) {
                $countRow = DB::selectOne(
                    "SELECT COUNT(*) as cnt
                     FROM newsletter_queue q
                     WHERE q.newsletter_id = ? AND q.tenant_id = ? AND q.status = 'sent'
                     AND q.email NOT IN (
                         SELECT DISTINCT email FROM newsletter_opens
                         WHERE newsletter_id = ? AND tenant_id = ?
                     )",
                    [$id, $tenantId, $id, $tenantId]
                );
                $total = (int) ($countRow->cnt ?? 0);

                $items = DB::select(
                    "SELECT q.email, q.sent_at, u.first_name, u.last_name
                     FROM newsletter_queue q
                     LEFT JOIN users u ON q.user_id = u.id
                     WHERE q.newsletter_id = ? AND q.tenant_id = ? AND q.status = 'sent'
                     AND q.email NOT IN (
                         SELECT DISTINCT email FROM newsletter_opens
                         WHERE newsletter_id = ? AND tenant_id = ?
                     )
                     ORDER BY q.sent_at DESC
                     LIMIT ? OFFSET ?",
                    [$id, $tenantId, $id, $tenantId, $perPage, $offset]
                );

                $items = array_map(function ($row) {
                    $name = UserDisplayName::resolve($row);
                    return [
                        // Distinct sent emails — email is the stable row key the admin
                        // UI's dynamic table needs (mirrors the id activity() guarantees).
                        'id' => $row->email ?? '',
                        'email' => $row->email ?? '',
                        'name' => $name ?: null,
                        'sent_at' => $row->sent_at ?? '',
                    ];
                }, $items);
            }

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /**
     * Get list of subscribers who opened but didn't click
     */
    public function openersNoClick(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 10, 200);
        $offset = ($page - 1) * $perPage;

        try {
            $total = 0;
            $items = [];

            if ($this->tableExists('newsletter_opens') && $this->tableExists('newsletter_clicks')) {
                $countRow = DB::selectOne(
                    "SELECT COUNT(DISTINCT o.email) as cnt
                     FROM newsletter_opens o
                     WHERE o.newsletter_id = ? AND o.tenant_id = ?
                     AND o.email NOT IN (
                         SELECT DISTINCT email FROM newsletter_clicks
                         WHERE newsletter_id = ? AND tenant_id = ?
                     )",
                    [$id, $tenantId, $id, $tenantId]
                );
                $total = (int) ($countRow->cnt ?? 0);

                $items = DB::select(
                    "SELECT o.email, MIN(o.opened_at) as first_opened, COUNT(*) as open_count,
                            u.first_name, u.last_name
                     FROM newsletter_opens o
                     LEFT JOIN newsletter_queue q ON o.email = q.email AND q.newsletter_id = ?
                     LEFT JOIN users u ON q.user_id = u.id
                     WHERE o.newsletter_id = ? AND o.tenant_id = ?
                     AND o.email NOT IN (
                         SELECT DISTINCT email FROM newsletter_clicks
                         WHERE newsletter_id = ? AND tenant_id = ?
                     )
                     GROUP BY o.email, u.first_name, u.last_name
                     ORDER BY first_opened DESC
                     LIMIT ? OFFSET ?",
                    [$id, $id, $tenantId, $id, $tenantId, $perPage, $offset]
                );

                $items = array_map(function ($row) {
                    $name = UserDisplayName::resolve($row);
                    return [
                        // Deduplicated by email — email is the stable row key the admin
                        // UI's dynamic table needs (mirrors the id activity() guarantees).
                        'id' => $row->email ?? '',
                        'email' => $row->email ?? '',
                        'name' => $name ?: null,
                        'first_opened' => $row->first_opened ?? '',
                        'open_count' => (int) ($row->open_count ?? 0),
                    ];
                }, $items);
            }

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /**
     * Get email client breakdown for a newsletter
     */
    public function emailClients(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $clients = [];
        if ($this->tableExists('newsletter_opens')) {
            try {
                $opens = DB::select(
                    "SELECT user_agent FROM newsletter_opens
                     WHERE tenant_id = ? AND newsletter_id = ? AND user_agent IS NOT NULL",
                    [$tenantId, $id]
                );

                $counts = [];
                foreach ($opens as $open) {
                    $ua = strtolower($open->user_agent ?? '');
                    $client = 'Other';
                    if (strpos($ua, 'outlook') !== false) {
                        $client = 'Outlook';
                    } elseif (strpos($ua, 'gmail') !== false || strpos($ua, 'googleimageproxy') !== false) {
                        $client = 'Gmail';
                    } elseif ((strpos($ua, 'apple mail') !== false || strpos($ua, 'applewebkit') !== false) && strpos($ua, 'mobile') === false) {
                        $client = 'Apple Mail';
                    } elseif (strpos($ua, 'yahoo') !== false) {
                        $client = 'Yahoo Mail';
                    } elseif (strpos($ua, 'thunderbird') !== false) {
                        $client = 'Thunderbird';
                    }
                    $counts[$client] = ($counts[$client] ?? 0) + 1;
                }
                arsort($counts);
                foreach ($counts as $name => $count) {
                    $clients[] = ['client' => $name, 'count' => $count];
                }
            } catch (\Exception $e) {
                // No data
            }
        }

        return $this->respondWithData(['email_clients' => $clients]);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────────────────────────────────

    public function getDiagnostics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $diagnostics = [
            'queue_status' => [
                'total' => 0,
                'pending' => 0,
                'sending' => 0,
                'sent' => 0,
                'failed' => 0,
            ],
            'bounce_rate' => 0,
            'sender_score' => 100,
            'sender_score_breakdown' => [
                'bounce_penalty' => 0,
                'complaint_penalty' => 0,
                'failure_penalty' => 0,
                'suppression_penalty' => 0,
                'volume_bonus' => 0,
            ],
            'configuration' => [
                'smtp_configured' => !empty(getenv('SMTP_HOST')),
                'api_configured' => !empty(getenv('USE_GMAIL_API')) && getenv('USE_GMAIL_API') !== 'false',
                'tracking_enabled' => $this->tableExists('newsletter_opens'),
            ],
            'health_status' => 'healthy',
        ];

        $totalSent = 0;
        $totalBounces = 0;
        $totalComplaints = 0;
        $totalSuppressed = 0;

        // Queue status
        if ($this->tableExists('newsletter_queue')) {
            try {
                $queueStats = DB::select(
                    "SELECT status, COUNT(*) as cnt FROM newsletter_queue WHERE tenant_id = ? GROUP BY status",
                    [$tenantId]
                );

                foreach ($queueStats as $row) {
                    $status = $row->status ?? 'unknown';
                    if ($status === 'processing') {
                        $status = 'sending';
                    }
                    $count = (int)$row->cnt;
                    $diagnostics['queue_status']['total'] += $count;
                    if (isset($diagnostics['queue_status'][$status])) {
                        $diagnostics['queue_status'][$status] = $count;
                    }
                }

                $totalSent = $diagnostics['queue_status']['sent'];
            } catch (\Exception $e) {
                // Ignore
            }
        }

        // Bounce rate + complaint count
        if ($this->tableExists('newsletter_bounces')) {
            try {
                $bounceStats = DB::select(
                    "SELECT bounce_type, COUNT(*) as cnt FROM newsletter_bounces WHERE tenant_id = ? GROUP BY bounce_type",
                    [$tenantId]
                );

                foreach ($bounceStats as $row) {
                    $count = (int)$row->cnt;
                    $totalBounces += $count;
                    if (($row->bounce_type ?? '') === 'complaint') {
                        $totalComplaints += $count;
                    }
                }

                if ($totalSent > 0) {
                    $diagnostics['bounce_rate'] = round(($totalBounces / $totalSent) * 100, 2);
                }
            } catch (\Exception $e) {
                // Ignore
            }
        }

        // Suppression list size
        if ($this->tableExists('newsletter_suppression_list')) {
            try {
                $suppressedRow = DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM newsletter_suppression_list WHERE tenant_id = ?",
                    [$tenantId]
                );
                $totalSuppressed = (int)($suppressedRow->cnt ?? 0);
            } catch (\Exception $e) {
                // Ignore
            }
        }

        // Dynamic sender score calculation (0-100)
        // Start at 100, subtract penalties, add small bonuses
        $score = 100;
        $breakdown = &$diagnostics['sender_score_breakdown'];

        // Bounce rate penalty: -3 per percentage point (e.g. 5% bounce = -15)
        $bouncePenalty = round($diagnostics['bounce_rate'] * 3, 1);
        $bouncePenalty = min($bouncePenalty, 40); // cap at -40
        $breakdown['bounce_penalty'] = $bouncePenalty;
        $score -= $bouncePenalty;

        // Complaint penalty: -10 per percentage point of complaints (severe)
        if ($totalSent > 0) {
            $complaintRate = ($totalComplaints / $totalSent) * 100;
            $complaintPenalty = round($complaintRate * 10, 1);
            $complaintPenalty = min($complaintPenalty, 30); // cap at -30
            $breakdown['complaint_penalty'] = $complaintPenalty;
            $score -= $complaintPenalty;
        }

        // Failure rate penalty: -2 per percentage point of failed sends
        $totalAttempted = $diagnostics['queue_status']['total'];
        if ($totalAttempted > 0) {
            $failureRate = ($diagnostics['queue_status']['failed'] / $totalAttempted) * 100;
            $failurePenalty = round($failureRate * 2, 1);
            $failurePenalty = min($failurePenalty, 20); // cap at -20
            $breakdown['failure_penalty'] = $failurePenalty;
            $score -= $failurePenalty;
        }

        // Suppression ratio penalty: high suppression = poor list hygiene
        if ($totalSent > 0) {
            $suppressionRatio = ($totalSuppressed / $totalSent) * 100;
            $suppressionPenalty = round($suppressionRatio * 1.5, 1);
            $suppressionPenalty = min($suppressionPenalty, 15); // cap at -15
            $breakdown['suppression_penalty'] = $suppressionPenalty;
            $score -= $suppressionPenalty;
        }

        // Volume bonus: reward consistent sending (up to +5)
        if ($totalSent >= 1000) {
            $breakdown['volume_bonus'] = 5;
            $score += 5;
        } elseif ($totalSent >= 100) {
            $breakdown['volume_bonus'] = 2;
            $score += 2;
        }

        $diagnostics['sender_score'] = max(0, min(100, round($score)));

        // Determine health status based on sender score + bounce rate
        if ($diagnostics['bounce_rate'] > 10 || $diagnostics['sender_score'] < 50) {
            $diagnostics['health_status'] = 'critical';
        } elseif ($diagnostics['bounce_rate'] > 5 || $diagnostics['queue_status']['failed'] > 10 || $diagnostics['sender_score'] < 70) {
            $diagnostics['health_status'] = 'warning';
        }

        return $this->respondWithData($diagnostics);
    }

    /**
     * Bounce reason trend analysis — weekly breakdown by bounce type
     */
    public function getBounceTrends(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('newsletter_bounces')) {
            return $this->respondWithData(['trends' => [], 'summary' => []]);
        }

        $weeks = $this->queryInt('weeks', 12, 1, 52);

        try {
            // Weekly breakdown by bounce type (last N weeks)
            $trends = DB::select(
                "SELECT
                    DATE_FORMAT(bounced_at, '%x-W%v') as week_label,
                    MIN(DATE(bounced_at)) as week_start,
                    bounce_type,
                    COUNT(*) as count
                 FROM newsletter_bounces
                 WHERE tenant_id = ?
                   AND bounced_at >= DATE_SUB(NOW(), INTERVAL ? WEEK)
                 GROUP BY week_label, bounce_type
                 ORDER BY week_label ASC, bounce_type ASC",
                [$tenantId, $weeks]
            );

            // Top bounce reasons with counts
            $summary = DB::select(
                "SELECT
                    COALESCE(bounce_reason, 'Unknown') as reason,
                    bounce_type,
                    COUNT(*) as count
                 FROM newsletter_bounces
                 WHERE tenant_id = ?
                   AND bounced_at >= DATE_SUB(NOW(), INTERVAL ? WEEK)
                 GROUP BY bounce_reason, bounce_type
                 ORDER BY count DESC
                 LIMIT ?",
                [$tenantId, $weeks, 10]
            );

            return $this->respondWithData([
                'trends' => array_map(fn($r) => (array)$r, $trends),
                'summary' => array_map(fn($r) => (array)$r, $summary),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithData(['trends' => [], 'summary' => []]);
        }
    }
}
