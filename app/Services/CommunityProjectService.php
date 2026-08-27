<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * CommunityProjectService — Laravel DI-based service for community project proposals.
 *
 * Manages community-proposed volunteering projects with tenant scoping.
 */
class CommunityProjectService
{
    private array $errors = [];

    /** @var string[] Valid project statuses */
    private const VALID_STATUSES = [
        'proposed', 'under_review', 'approved', 'rejected', 'active', 'completed', 'cancelled',
    ];

    /** @var string[] Statuses an admin can set during review */
    private const REVIEW_STATUSES = ['approved', 'rejected', 'under_review'];

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Submit a new community project proposal.
     *
     * @return array Created project record (empty on validation failure)
     */
    public function propose(int $userId, array $data): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $title       = trim($data['title'] ?? '');
        $description = trim($data['description'] ?? '');

        if ($title === '') {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_project_title_required'), 'field' => 'title'];
            return [];
        }

        if ($description === '') {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_project_description_required'), 'field' => 'description'];
            return [];
        }

        $category         = isset($data['category']) ? trim($data['category']) : null;
        $location         = isset($data['location']) ? trim($data['location']) : null;
        $lat              = isset($data['lat']) ? (float) $data['lat'] : (isset($data['latitude']) ? (float) $data['latitude'] : null);
        $lng              = isset($data['lng']) ? (float) $data['lng'] : (isset($data['longitude']) ? (float) $data['longitude'] : null);
        $targetVolunteers = isset($data['target_volunteers']) ? (int) $data['target_volunteers'] : null;
        $proposedDate     = isset($data['proposed_date']) ? trim($data['proposed_date']) : null;
        $skillsNeeded     = isset($data['skills_needed'])
            ? (is_array($data['skills_needed']) ? json_encode($data['skills_needed']) : trim($data['skills_needed']))
            : null;
        $estimatedHours = isset($data['estimated_hours']) ? (float) $data['estimated_hours'] : null;

        // Validate proposed_date format if provided
        if ($proposedDate !== null && $proposedDate !== '') {
            $parsed = \DateTime::createFromFormat('Y-m-d', $proposedDate);
            if (! $parsed || $parsed->format('Y-m-d') !== $proposedDate) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_project_proposed_date_invalid'), 'field' => 'proposed_date'];
                return [];
            }
        } else {
            $proposedDate = null;
        }

        $projectId = DB::table('vol_community_projects')->insertGetId([
            'tenant_id'         => $tenantId,
            'proposed_by'       => $userId,
            'title'             => $title,
            'description'       => $description,
            'category'          => $category,
            'location'          => $location,
            'latitude'          => $lat,
            'longitude'         => $lng,
            'target_volunteers' => $targetVolunteers,
            'proposed_date'     => $proposedDate,
            'skills_needed'     => $skillsNeeded,
            'estimated_hours'   => $estimatedHours,
            'status'            => 'proposed',
            'supporter_count'   => 0,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        return $this->getProposal((int) $projectId) ?? [
            'id'        => (int) $projectId,
            'tenant_id' => $tenantId,
            'title'     => $title,
            'status'    => 'proposed',
        ];
    }

    /**
     * Get project proposals with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getProposals(array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit    = min((int) ($filters['limit'] ?? 20), 50);
        $cursor   = $filters['cursor'] ?? null;
        $sort     = $filters['sort'] ?? 'newest';

        $query = DB::table('vol_community_projects as p')
            ->leftJoin('users as u', function ($join) {
                $join->on('p.proposed_by', '=', 'u.id')
                     ->whereColumn('u.tenant_id', 'p.tenant_id');
            })
            ->where('p.tenant_id', $tenantId)
            ->select(
                'p.*',
                'u.first_name as proposer_first_name',
                'u.last_name as proposer_last_name', 'u.profile_type as proposer_profile_type', 'u.organization_name as proposer_organization_name',
                'u.avatar_url as proposer_avatar'
            );

        // Status filter
        $public = !empty($filters['public']);
        if ($public) {
            $publicStatuses = ['approved', 'active', 'completed'];
            $status = !empty($filters['status']) && in_array($filters['status'], $publicStatuses, true)
                ? $filters['status']
                : 'approved';
            $query->where('p.status', $status);
        } elseif (! empty($filters['status']) && in_array($filters['status'], self::VALID_STATUSES, true)) {
            $query->where('p.status', $filters['status']);
        }

        // Category filter
        if (! empty($filters['category'])) {
            $query->where('p.category', $filters['category']);
        }

        // Proposed by filter
        if (! empty($filters['proposed_by'])) {
            $query->where('p.proposed_by', (int) $filters['proposed_by']);
        }

        // Search filter
        if (! empty($filters['search'])) {
            $escaped = str_replace(['%', '_'], ['\\%', '\\_'], $filters['search']);
            $term    = '%' . $escaped . '%';
            $query->where(function ($q) use ($term) {
                $q->where('p.title', 'LIKE', $term)
                  ->orWhere('p.description', 'LIKE', $term);
            });
        }

        // Cursor pagination
        if ($cursor) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false && is_numeric($cursorId)) {
                $query->where('p.id', '<', (int) $cursorId);
            }
        }

        // Sort order
        if ($sort === 'most_supported') {
            $query->orderByDesc('p.supporter_count')->orderByDesc('p.id');
        } else {
            $query->orderByDesc('p.created_at')->orderByDesc('p.id');
        }

        $items   = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        // Resolve the viewer's supported set in one query so has_supported is real
        $supportedIds = [];
        $viewerId = isset($filters['user_id']) ? (int) $filters['user_id'] : 0;
        if ($viewerId > 0 && $items->isNotEmpty()) {
            $supportedIds = DB::table('vol_community_project_supporters')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $viewerId)
                ->whereIn('project_id', $items->pluck('id')->all())
                ->pluck('project_id')
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        $formatted = $items->map(
            fn ($row) => $this->formatProject($row, $public, in_array((int) $row->id, $supportedIds, true))
        )->all();

        return [
            'items'    => $formatted,
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get tenant-scoped proposal totals for admin dashboards.
     */
    public function getProposalStats(array $filters = []): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('vol_community_projects')
            ->where('tenant_id', $tenantId);

        if (! empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }

        if (! empty($filters['search'])) {
            $escaped = str_replace(['%', '_'], ['\\%', '\\_'], $filters['search']);
            $term    = '%' . $escaped . '%';
            $query->where(function ($q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term);
            });
        }

        $rows = $query
            ->selectRaw('COUNT(*) as total')
            ->selectRaw("SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved")
            ->selectRaw("SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active")
            ->selectRaw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed")
            ->selectRaw('COALESCE(SUM(supporter_count), 0) as total_supporters')
            ->first();

        return [
            'total'            => (int) ($rows->total ?? 0),
            'approved'         => (int) ($rows->approved ?? 0),
            'active'           => (int) ($rows->active ?? 0),
            'completed'        => (int) ($rows->completed ?? 0),
            'total_supporters' => (int) ($rows->total_supporters ?? 0),
        ];
    }

    /**
     * Get a single proposal with supporter count and proposer info.
     */
    public function getProposal(int $id, bool $public = false, ?int $viewerId = null): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('vol_community_projects as p')
            ->leftJoin('users as u', function ($join) {
                $join->on('p.proposed_by', '=', 'u.id')
                     ->whereColumn('u.tenant_id', 'p.tenant_id');
            })
            ->where('p.id', $id)
            ->where('p.tenant_id', $tenantId)
            ->select(
                'p.*',
                'u.first_name as proposer_first_name',
                'u.last_name as proposer_last_name', 'u.profile_type as proposer_profile_type', 'u.organization_name as proposer_organization_name',
                'u.avatar_url as proposer_avatar'
            )
            ->first();

        if (! $row) {
            return null;
        }

        if ($public && !in_array((string) $row->status, ['approved', 'active', 'completed'], true)) {
            return null;
        }

        $hasSupported = $viewerId !== null && $viewerId > 0 && DB::table('vol_community_project_supporters')
            ->where('tenant_id', $tenantId)
            ->where('project_id', $id)
            ->where('user_id', $viewerId)
            ->exists();

        return $this->formatProject($row, $public, $hasSupported);
    }

    /**
     * Update a project proposal (only by proposer or admin).
     */
    public function updateProposal(int $id, int $userId, array $data): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $existing = DB::table('vol_community_projects')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $existing) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.vol_project_not_found')];
            return false;
        }

        // Check permissions: must be proposer or admin
        if ((int) $existing->proposed_by !== $userId) {
            $userRole = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->value('role');
            if (! in_array($userRole, ['admin', 'super_admin'], true)) {
                $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.vol_project_update_forbidden')];
                return false;
            }
        }

        $updates = [];

        $allowedFields = [
            'title' => 'string', 'description' => 'string', 'category' => 'string',
            'location' => 'string', 'lat' => 'float', 'lng' => 'float',
            'latitude' => 'float', 'longitude' => 'float',
            'target_volunteers' => 'int', 'proposed_date' => 'date',
            'skills_needed' => 'string', 'estimated_hours' => 'float',
        ];

        foreach ($allowedFields as $field => $type) {
            if (! array_key_exists($field, $data)) {
                continue;
            }

            $column = $field;
            if ($field === 'lat') { $column = 'latitude'; }
            if ($field === 'lng') { $column = 'longitude'; }

            $value = $data[$field];

            switch ($type) {
                case 'string':
                    $value = $value !== null ? trim((string) $value) : null;
                    break;
                case 'float':
                    $value = $value !== null ? (float) $value : null;
                    break;
                case 'int':
                    $value = $value !== null ? (int) $value : null;
                    break;
                case 'date':
                    if ($value !== null && $value !== '') {
                        $parsed = \DateTime::createFromFormat('Y-m-d', trim($value));
                        if (! $parsed || $parsed->format('Y-m-d') !== trim($value)) {
                            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_project_field_date_invalid', ['field' => $field]), 'field' => $field];
                            return false;
                        }
                        $value = trim($value);
                    } else {
                        $value = null;
                    }
                    break;
            }

            $updates[$column] = $value;
        }

        if (empty($updates)) {
            return true;
        }

        // Validate required fields are not blanked
        if (array_key_exists('title', $data) && trim((string) $data['title']) === '') {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_project_title_required'), 'field' => 'title'];
            return false;
        }
        if (array_key_exists('description', $data) && trim((string) $data['description']) === '') {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_project_description_required'), 'field' => 'description'];
            return false;
        }

        $updates['updated_at'] = now();

        DB::table('vol_community_projects')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return true;
    }

    /**
     * Admin reviews a proposed project (approve, reject, or mark under_review).
     */
    public function review(int $proposalId, string $status, ?string $feedback, int $adminId, int $tenantId): bool
    {
        if (! in_array($status, self::REVIEW_STATUSES, true)) {
            return false;
        }

        $project = DB::table('vol_community_projects')
            ->where('id', $proposalId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $project) {
            return false;
        }

        $reviewableStatuses = ['proposed', 'pending', 'under_review'];
        if (! in_array($project->status, $reviewableStatuses, true)) {
            return false;
        }

        DB::table('vol_community_projects')
            ->where('id', $proposalId)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'       => $status,
                'reviewed_by'  => $adminId,
                'reviewed_at'  => now(),
                'review_notes' => $feedback,
                'updated_at'   => now(),
            ]);

        // Notify the proposer of the review decision
        try {
            $proposedBy = (int) $project->proposed_by;
            $user = DB::table('users')->where('id', $proposedBy)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();
            if ($user && !empty($user->email)) {
                LocaleContext::withLocale($user, function () use ($user, $project, $status, $feedback, $proposalId, $tenantId) {
                    $firstName  = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                    $safeTitle  = htmlspecialchars($project->title ?? '', ENT_QUOTES, 'UTF-8');
                    $prefix     = match ($status) {
                        'approved'     => 'approved',
                        'rejected'     => 'rejected',
                        default        => 'under_review',
                    };
                    $link    = '/volunteering/community-projects/' . $proposalId;
                    $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
                    $builder = EmailTemplateBuilder::make()
                        ->title(__("emails_misc.community_project.{$prefix}_title"))
                        ->greeting($firstName)
                        ->paragraph(__("emails_misc.community_project.{$prefix}_body", ['title' => $safeTitle]));
                    if ($status === 'rejected' && !empty($feedback)) {
                        $builder->paragraph('<strong>' . __('emails_misc.community_project.rejected_notes_label') . ':</strong> ' . htmlspecialchars($feedback, ENT_QUOTES, 'UTF-8'));
                    }
                    $html = $builder->button(__("emails_misc.community_project.{$prefix}_cta"), $fullUrl)->render();
                    if (!\App\Services\EmailDispatchService::sendRaw($user->email, __("emails_misc.community_project.{$prefix}_subject", ['title' => $safeTitle]), $html, null, null, null, 'community_project', ['tenant_id' => $tenantId])) {
                        Log::warning('[CommunityProjectService] review email failed', ['proposal_id' => $proposalId]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[CommunityProjectService] review email error: ' . $e->getMessage());
        }

        return true;
    }

    /**
     * Add a supporter to a community project proposal.
     */
    public function support(int $proposalId, int $userId, int $tenantId): bool
    {
        $exists = DB::table('vol_community_projects')
            ->where('id', $proposalId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            return false;
        }

        // Existing support is an idempotent no-op. Keep it policy-free so a
        // member can always reach the separate unsupport exit path.
        $alreadySupporting = DB::table('vol_community_project_supporters')
            ->where('tenant_id', $tenantId)
            ->where('project_id', $proposalId)
            ->where('user_id', $userId)
            ->exists();

        if ($alreadySupporting) {
            return true;
        }

        $proposerId = DB::table('vol_community_projects')
            ->where('id', $proposalId)
            ->where('tenant_id', $tenantId)
            ->value('proposed_by');

        if (! is_numeric($proposerId)) {
            Log::error('Safeguarding recipient lookup failed.', [
                'tenant_id' => $tenantId,
                'channel' => 'community_project_support',
                'project_id' => $proposalId,
            ]);

            throw new SafeguardingPolicyException(
                'SAFEGUARDING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.policy_unavailable'),
            );
        }

        $proposerId = (int) $proposerId;
        if ($proposerId !== $userId) {
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $userId,
                $proposerId,
                $tenantId,
                'community_project_support',
            );
        }

        // INSERT IGNORE handles the unique constraint on (project_id, user_id).
        // DB::statement() returns true even when 0 rows are inserted, so the
        // counter must only bump when affectingStatement reports a real insert
        // — otherwise repeat clicks inflate supporter_count indefinitely.
        $inserted = DB::affectingStatement(
            "INSERT IGNORE INTO vol_community_project_supporters (tenant_id, project_id, user_id, supported_at) VALUES (?, ?, ?, NOW())",
            [$tenantId, $proposalId, $userId]
        );

        if ($inserted > 0) {
            DB::table('vol_community_projects')
                ->where('id', $proposalId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'supporter_count' => DB::raw('supporter_count + 1'),
                    'updated_at'      => now(),
                ]);
        }

        // Already-a-supporter is an idempotent success, not a failure.
        return true;
    }

    /**
     * Remove support from a community project.
     */
    public function unsupport(int $proposalId, int $userId, int $tenantId): bool
    {
        $deleted = DB::table('vol_community_project_supporters')
            ->where('project_id', $proposalId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->delete();

        if ($deleted > 0) {
            DB::table('vol_community_projects')
                ->where('id', $proposalId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'supporter_count' => DB::raw('GREATEST(supporter_count - 1, 0)'),
                    'updated_at'      => now(),
                ]);
            return true;
        }

        return false;
    }

    /**
     * Format a raw project row for API response.
     */
    private function formatProject(object $row, bool $public = false, bool $hasSupported = false): array
    {
        $project = [
            'id'                => (int) $row->id,
            'tenant_id'         => (int) $row->tenant_id,
            'proposed_by'       => (int) $row->proposed_by,
            'title'             => $row->title,
            'description'       => $row->description,
            'category'          => $row->category ?? null,
            'location'          => $row->location ?? null,
            'latitude'          => isset($row->latitude) && $row->latitude !== null ? (float) $row->latitude : null,
            'longitude'         => isset($row->longitude) && $row->longitude !== null ? (float) $row->longitude : null,
            'target_volunteers' => isset($row->target_volunteers) && $row->target_volunteers !== null ? (int) $row->target_volunteers : null,
            'proposed_date'     => $row->proposed_date ?? null,
            'skills_needed'     => $row->skills_needed ?? null,
            'estimated_hours'   => isset($row->estimated_hours) && $row->estimated_hours !== null ? (float) $row->estimated_hours : null,
            'status'            => $row->status,
            'opportunity_id'    => isset($row->opportunity_id) && $row->opportunity_id !== null ? (int) $row->opportunity_id : null,
            'upvotes'           => (int) ($row->supporter_count ?? 0),
            'supporter_count'   => (int) ($row->supporter_count ?? 0),
            'supporters_count'  => (int) ($row->supporter_count ?? 0),
            // Frontend reads has_supported; user_has_supported kept for compat
            'has_supported'      => $hasSupported,
            'user_has_supported' => $hasSupported,
            'created_at'        => $row->created_at,
            'updated_at'        => $row->updated_at ?? null,
            'proposer'          => [
                'first_name' => $row->proposer_first_name ?? null,
                'last_name'  => $row->proposer_last_name ?? null,
                'avatar_url' => $row->proposer_avatar ?? null,
            ],
        ];

        if (!$public) {
            $project['reviewed_by'] = isset($row->reviewed_by) && $row->reviewed_by !== null ? (int) $row->reviewed_by : null;
            $project['reviewed_at'] = $row->reviewed_at ?? null;
            $project['review_notes'] = $row->review_notes ?? null;
        }

        return $project;
    }
}
