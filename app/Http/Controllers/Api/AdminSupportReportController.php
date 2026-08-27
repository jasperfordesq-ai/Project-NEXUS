<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use App\Support\UserDisplayName;

class AdminSupportReportController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const STATUSES = ['open', 'triaged', 'resolved', 'closed'];
    private const IMPACTS = ['blocked', 'major', 'minor', 'cosmetic'];

    public function index(): JsonResponse
    {
        $this->requireAdmin();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', $this->queryInt('per_page', 20, 1, 100), 1, 100);
        $offset = ($page - 1) * $limit;

        $query = $this->baseQuery();
        $this->applyTenantScope($query);
        $this->applyFilters($query);

        $total = (int) (clone $query)->count('sr.id');
        $reports = $query
            ->select($this->selectColumns())
            ->orderByDesc('sr.created_at')
            ->limit($limit)
            ->offset($offset)
            ->get()
            ->map(fn ($row): array => $this->formatReport($row, false))
            ->all();

        return $this->respondWithPaginatedCollection($reports, $total, $page, $limit);
    }

    public function stats(): JsonResponse
    {
        $this->requireAdmin();

        $query = DB::table('support_reports as sr');
        $this->applyTenantScope($query);

        $stats = $query->selectRaw(
            "COUNT(*) as total,
             SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
             SUM(CASE WHEN status = 'triaged' THEN 1 ELSE 0 END) as triaged,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
             SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
             SUM(CASE WHEN impact = 'blocked' THEN 1 ELSE 0 END) as blocked,
             SUM(CASE WHEN impact = 'major' THEN 1 ELSE 0 END) as major,
             SUM(CASE WHEN assigned_user_id IS NULL AND status IN ('open', 'triaged') THEN 1 ELSE 0 END) as unassigned"
        )->first();

        return $this->respondWithData([
            'total' => (int) ($stats->total ?? 0),
            'open' => (int) ($stats->open ?? 0),
            'triaged' => (int) ($stats->triaged ?? 0),
            'resolved' => (int) ($stats->resolved ?? 0),
            'closed' => (int) ($stats->closed ?? 0),
            'blocked' => (int) ($stats->blocked ?? 0),
            'major' => (int) ($stats->major ?? 0),
            'unassigned' => (int) ($stats->unassigned ?? 0),
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $this->requireAdmin();

        $report = $this->findReport($id);
        if (!$report) {
            return $this->respondNotFound(__('api.support_report_not_found'));
        }

        return $this->respondWithData($this->formatReport($report, true));
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->requireAdmin();

        $report = $this->findReport($id);
        if (!$report) {
            return $this->respondNotFound(__('api.support_report_not_found'));
        }

        $validator = Validator::make($request->all(), [
            'status' => ['sometimes', 'string', 'in:' . implode(',', self::STATUSES)],
            'assigned_user_id' => ['nullable', 'integer'],
            'triage_notes' => ['nullable', 'string', 'max:10000'],
            'sentry_event_id' => ['nullable', 'string', 'max:191'],
            'sentry_issue_url' => ['nullable', 'string', 'max:2048'],
        ], [
            'status.in' => __('api.support_reports_status_invalid'),
        ]);

        if ($validator->fails()) {
            return $this->validationErrors($validator->errors()->messages());
        }

        $validated = $validator->validated();
        $updates = $this->buildUpdates($validated, $report);

        if (array_key_exists('assigned_user_id', $validated)) {
            $assignedUserId = $validated['assigned_user_id'];
            if ($assignedUserId !== null && !$this->isAssignableAdmin((int) $assignedUserId, (int) $report->tenant_id)) {
                return $this->respondWithError(
                    'VALIDATION_FAILED',
                    __('api.support_reports_assignment_invalid'),
                    'assigned_user_id',
                    422,
                );
            }

            $updates['assigned_user_id'] = $assignedUserId !== null ? (int) $assignedUserId : null;
        }

        if (empty($updates)) {
            return $this->respondWithError('NO_CHANGES', __('api.support_reports_update_empty'), null, 422);
        }

        $updates['updated_at'] = now();

        DB::table('support_reports')
            ->where('id', $id)
            ->where('tenant_id', (int) $report->tenant_id)
            ->update($updates);

        $updated = $this->findReport($id);

        return $this->respondWithData($this->formatReport($updated, true));
    }

    public function assignees(): JsonResponse
    {
        $this->requireAdmin();

        $query = DB::table('users')
            ->where('status', 'active')
            ->where(function ($inner): void {
                $inner->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'god'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_super_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_god', 1);
            });

        $tenantId = $this->resolveEffectiveTenantId();
        if ($tenantId !== null) {
            $query->where('tenant_id', $tenantId);
        }

        $assignees = $query
            ->orderBy('name')
            ->get(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'email', 'avatar_url', 'role'])
            ->map(fn ($user): array => $this->formatUser($user))
            ->all();

        return $this->respondWithData(['assignees' => $assignees]);
    }

    private function baseQuery(): Builder
    {
        return DB::table('support_reports as sr')
            ->leftJoin('users as reporter', function ($join): void {
                $join->on('reporter.id', '=', 'sr.user_id')
                    ->on('reporter.tenant_id', '=', 'sr.tenant_id');
            })
            ->leftJoin('users as assignee', function ($join): void {
                $join->on('assignee.id', '=', 'sr.assigned_user_id')
                    ->on('assignee.tenant_id', '=', 'sr.tenant_id');
            })
            ->leftJoin('tenants as tenant', 'tenant.id', '=', 'sr.tenant_id');
    }

    private function findReport(int $id): ?object
    {
        $query = $this->baseQuery()->where('sr.id', $id);
        $this->applyTenantScope($query);

        return $query->select($this->selectColumns())->first();
    }

    /**
     * @return list<string>
     */
    private function selectColumns(): array
    {
        return [
            'sr.id',
            'sr.tenant_id',
            'sr.user_id',
            'sr.assigned_user_id',
            'sr.reference',
            'sr.source',
            'sr.summary',
            'sr.description',
            'sr.impact',
            'sr.status',
            'sr.module',
            'sr.route',
            'sr.page_url',
            'sr.sentry_event_id',
            'sr.sentry_issue_url',
            'sr.diagnostics',
            'sr.user_agent',
            'sr.triage_notes',
            'sr.triaged_at',
            'sr.resolved_at',
            'sr.closed_at',
            'sr.created_at',
            'sr.updated_at',
            'tenant.name as tenant_name',
            'reporter.name as reporter_name',
            'reporter.first_name as reporter_first_name',
            'reporter.last_name as reporter_last_name', 'reporter.profile_type as reporter_profile_type', 'reporter.organization_name as reporter_organization_name',
            'reporter.email as reporter_email',
            'reporter.avatar_url as reporter_avatar_url',
            'assignee.name as assignee_name',
            'assignee.first_name as assignee_first_name',
            'assignee.last_name as assignee_last_name', 'assignee.profile_type as assignee_profile_type', 'assignee.organization_name as assignee_organization_name',
            'assignee.email as assignee_email',
            'assignee.avatar_url as assignee_avatar_url',
        ];
    }

    private function applyTenantScope(Builder $query): void
    {
        $tenantId = $this->resolveEffectiveTenantId();
        if ($tenantId !== null) {
            $query->where('sr.tenant_id', $tenantId);
        }
    }

    private function resolveEffectiveTenantId(): ?int
    {
        return $this->resolveAdminTenantFilter($this->isSuperAdmin(), $this->getTenantId());
    }

    private function isSuperAdmin(): bool
    {
        // Platform-level super admin only — explicitly NOT is_tenant_super_admin,
        // which is scoped to a single tenant (see requirePlatformSuperAdmin).
        return $this->isPlatformSuperAdmin();
    }

    private function applyFilters(Builder $query): void
    {
        $status = (string) $this->query('status', '');
        if (in_array($status, self::STATUSES, true)) {
            $query->where('sr.status', $status);
        }

        $impact = (string) $this->query('impact', '');
        if (in_array($impact, self::IMPACTS, true)) {
            $query->where('sr.impact', $impact);
        }

        $search = trim((string) $this->query('search', ''));
        if ($search !== '') {
            $pattern = '%' . $search . '%';
            $query->where(function ($inner) use ($pattern): void {
                $inner->where('sr.reference', 'like', $pattern)
                    ->orWhere('sr.summary', 'like', $pattern)
                    ->orWhere('sr.description', 'like', $pattern)
                    ->orWhere('sr.route', 'like', $pattern)
                    ->orWhere('reporter.name', 'like', $pattern)
                    ->orWhere('reporter.email', 'like', $pattern);
            });
        }
    }

    /**
     * @param array<string,mixed> $validated
     * @param object $report
     * @return array<string,mixed>
     */
    private function buildUpdates(array $validated, object $report): array
    {
        $updates = [];

        foreach (['triage_notes', 'sentry_event_id', 'sentry_issue_url'] as $field) {
            if (array_key_exists($field, $validated)) {
                $updates[$field] = $this->nullableString($validated[$field] ?? null);
            }
        }

        if (array_key_exists('status', $validated)) {
            $status = (string) $validated['status'];
            $updates['status'] = $status;

            if ($status === 'triaged' && empty($report->triaged_at)) {
                $updates['triaged_at'] = now();
            }

            if ($status === 'resolved' && empty($report->resolved_at)) {
                $updates['resolved_at'] = now();
            }

            if ($status === 'closed' && empty($report->closed_at)) {
                $updates['closed_at'] = now();
            }
        }

        return $updates;
    }

    private function isAssignableAdmin(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($query): void {
                $query->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'god'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_super_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_god', 1);
            })
            ->exists();
    }

    private function formatReport(?object $report, bool $includeDiagnostics): array
    {
        if (!$report) {
            return [];
        }

        $formatted = [
            'id' => (int) $report->id,
            'tenant_id' => (int) $report->tenant_id,
            'tenant_name' => $report->tenant_name,
            'user_id' => $report->user_id !== null ? (int) $report->user_id : null,
            'assigned_user_id' => $report->assigned_user_id !== null ? (int) $report->assigned_user_id : null,
            'reference' => $report->reference,
            'source' => $report->source,
            'summary' => $report->summary,
            'description' => $report->description,
            'impact' => $report->impact,
            'status' => $report->status,
            'module' => $report->module,
            'route' => $report->route,
            'page_url' => $report->page_url,
            'sentry_event_id' => $report->sentry_event_id,
            'sentry_issue_url' => $report->sentry_issue_url,
            'user_agent' => $report->user_agent,
            'triage_notes' => $report->triage_notes,
            'triaged_at' => $report->triaged_at,
            'resolved_at' => $report->resolved_at,
            'closed_at' => $report->closed_at,
            'created_at' => $report->created_at,
            'updated_at' => $report->updated_at,
            'reporter' => $report->user_id !== null ? $this->formatRelatedUser($report, 'reporter') : null,
            'assignee' => $report->assigned_user_id !== null ? $this->formatRelatedUser($report, 'assignee') : null,
        ];

        if ($includeDiagnostics) {
            $formatted['diagnostics'] = $this->decodeDiagnostics($report->diagnostics ?? null);
        }

        return $formatted;
    }

    private function formatRelatedUser(object $row, string $prefix): array
    {
        $idField = $prefix === 'reporter' ? 'user_id' : 'assigned_user_id';
        $name = UserDisplayName::resolvePrefixed($row, $prefix . '_');

        return [
            'id' => (int) $row->{$idField},
            'name' => $name !== '' ? $name : __('api.unknown_user'),
            'email' => $row->{$prefix . '_email'} ?? null,
            'avatar_url' => $row->{$prefix . '_avatar_url'} ?? null,
        ];
    }

    private function formatUser(object $user): array
    {
        $name = UserDisplayName::resolve($user);

        return [
            'id' => (int) $user->id,
            'name' => $name !== '' ? $name : __('api.unknown_user'),
            'email' => $user->email,
            'avatar_url' => $user->avatar_url,
            'role' => $user->role,
        ];
    }

    private function decodeDiagnostics(mixed $value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value)) {
            return null;
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : null;
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    /**
     * @param array<string,list<string>> $messages
     */
    private function validationErrors(array $messages): JsonResponse
    {
        $errors = [];
        foreach ($messages as $field => $fieldMessages) {
            $errors[] = [
                'code' => 'VALIDATION_FAILED',
                'message' => (string) ($fieldMessages[0] ?? __('api.validation_failed')),
                'field' => $field,
            ];
        }

        return $this->respondWithErrors($errors, 422);
    }
}
