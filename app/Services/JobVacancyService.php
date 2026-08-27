<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\JobAlert;
use App\Models\JobApplication;
use App\Models\JobApplicationHistory;
use App\Models\JobVacancy;
use App\Models\SavedJob;
use App\Models\User;
use App\Models\Notification;
use App\Services\JobModerationService;
use App\Services\JobSpamDetectionService;
use App\Services\RealtimeService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * JobVacancyService — Laravel DI-based service for job vacancy operations.
 *
 * Manages job vacancy CRUD, applications, saved jobs, alerts, analytics,
 * skills matching, featured jobs, and expiry/renewal.
 * All queries are tenant-scoped via HasTenantScope trait or explicit tenant_id.
 */
class JobVacancyService
{
    /** @var array Collected errors from the last operation */
    private array $errors = [];

    public function __construct(
        private readonly JobVacancy $vacancy,
    ) {}

    /**
     * Get collected errors.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    private function normalizeJsonList(mixed $value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_array($value)) {
            return array_values(array_filter($value, fn($item) => $item !== null && $item !== ''));
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                return array_values(array_filter($decoded, fn($item) => $item !== null && $item !== ''));
            }
        }

        return null;
    }

    /**
     * Accept skills as either a comma-separated string (web) or an array of
     * strings (mobile builds ≤ 2026-06-11 sent arrays). The column is text;
     * inserting a raw array fataled with "Array to string conversion".
     */
    private function normalizeSkillsInput($value): ?string
    {
        if (is_array($value)) {
            $value = implode(', ', array_filter(array_map(fn ($s) => trim((string) $s), $value)));
        }
        $value = trim((string) ($value ?? ''));
        return $value === '' ? null : $value;
    }

    private function normalizeCoordinate(mixed $value, float $min, float $max): ?float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }

        $coordinate = (float) $value;
        return $coordinate >= $min && $coordinate <= $max ? $coordinate : null;
    }

    private function configBool(string $key, bool $default): bool
    {
        $value = JobConfigurationService::get($key, $default);
        if (is_bool($value)) {
            return $value;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    private function inputBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
    }

    private function activeFeaturedRankExpression(): string
    {
        return '(CASE WHEN job_vacancies.is_featured = 1 AND (job_vacancies.featured_until IS NULL OR job_vacancies.featured_until > NOW()) THEN 0 ELSE 1 END)';
    }

    private function applyPublicVisibility(Builder $query): void
    {
        $query->where('job_vacancies.status', 'open')
            ->where(function (Builder $q) {
                $q->whereNull('job_vacancies.deadline')
                    ->orWhere('job_vacancies.deadline', '>=', now()->startOfDay());
            })
            ->where(function (Builder $q) {
                $q->whereNull('job_vacancies.moderation_status')
                    ->orWhere('job_vacancies.moderation_status', 'approved');
            });
    }

    private function decodeVacancyCursor(?string $cursor): ?array
    {
        if ($cursor === null || $cursor === '') {
            return null;
        }

        $decoded = base64_decode($cursor, true);
        if ($decoded === false) {
            return null;
        }

        $payload = json_decode($decoded, true);
        if (is_array($payload) && isset($payload['v'], $payload['id'])) {
            return $payload;
        }

        if (ctype_digit($decoded)) {
            return ['v' => 0, 'id' => (int) $decoded];
        }

        return null;
    }

    private function encodeVacancyCursor(array $data): string
    {
        return base64_encode(json_encode(array_merge(['v' => 1], $data), JSON_THROW_ON_ERROR));
    }

    private function sortableDate(mixed $value): ?string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }

        if ($value === null || $value === '') {
            return null;
        }

        return date('Y-m-d H:i:s', strtotime((string) $value));
    }

    private function activeFeaturedRank(mixed $item): int
    {
        $data = is_array($item) ? $item : $item->toArray();
        $isFeatured = (bool) ($data['is_featured'] ?? false);
        $featuredUntil = $data['featured_until'] ?? null;

        if (!$isFeatured) {
            return 1;
        }

        if ($featuredUntil === null || $featuredUntil === '') {
            return 0;
        }

        return strtotime((string) $featuredUntil) > time() ? 0 : 1;
    }

    private function encodeCursorForVacancy(mixed $item, string $sort): string
    {
        $data = is_array($item) ? $item : $item->toArray();
        $payload = [
            'sort' => $sort,
            'rank' => $this->activeFeaturedRank($data),
            'id' => (int) ($data['id'] ?? 0),
        ];

        if ($sort === 'deadline') {
            $deadline = $this->sortableDate($data['deadline'] ?? null);
            $payload['deadline_null'] = $deadline === null ? 1 : 0;
            $payload['deadline'] = $deadline;
        } elseif ($sort === 'salary_desc') {
            $salary = $data['salary_max'] ?? $data['salary_min'] ?? null;
            $payload['salary_null'] = $salary === null ? 1 : 0;
            $payload['salary'] = $salary === null ? null : (float) $salary;
        } else {
            $payload['created_at'] = $this->sortableDate($data['created_at'] ?? null);
        }

        return $this->encodeVacancyCursor($payload);
    }

    private function applyVacancyCursor(Builder $query, ?string $cursor, string $sort): void
    {
        $payload = $this->decodeVacancyCursor($cursor);
        if (!$payload) {
            return;
        }

        // Backward-compatible legacy cursor, valid only for the old newest-by-id path.
        if (($payload['v'] ?? null) === 0) {
            $query->where('job_vacancies.id', '<', (int) $payload['id']);
            return;
        }

        if (($payload['sort'] ?? 'newest') !== $sort) {
            return;
        }

        $rankExpr = $this->activeFeaturedRankExpression();
        $rank = (int) ($payload['rank'] ?? 1);
        $id = (int) ($payload['id'] ?? 0);

        $query->where(function (Builder $q) use ($sort, $payload, $rankExpr, $rank, $id) {
            $q->whereRaw("{$rankExpr} > ?", [$rank]);

            if ($sort === 'deadline') {
                $nullRank = (int) ($payload['deadline_null'] ?? 1);
                $deadline = $payload['deadline'] ?? null;
                $deadlineNullExpr = '(CASE WHEN job_vacancies.deadline IS NULL THEN 1 ELSE 0 END)';

                $q->orWhere(function (Builder $sameRank) use ($rankExpr, $rank, $deadlineNullExpr, $nullRank, $deadline, $id) {
                    $sameRank->whereRaw("{$rankExpr} = ?", [$rank])
                        ->where(function (Builder $after) use ($deadlineNullExpr, $nullRank, $deadline, $id) {
                            $after->whereRaw("{$deadlineNullExpr} > ?", [$nullRank])
                                ->orWhere(function (Builder $sameNullRank) use ($deadlineNullExpr, $nullRank, $deadline, $id) {
                                    $sameNullRank->whereRaw("{$deadlineNullExpr} = ?", [$nullRank])
                                        ->where(function (Builder $deadlineOrder) use ($deadline, $id) {
                                            if ($deadline !== null) {
                                                $deadlineOrder->where('job_vacancies.deadline', '>', $deadline)
                                                    ->orWhere(function (Builder $sameDeadline) use ($deadline, $id) {
                                                        $sameDeadline->where('job_vacancies.deadline', '=', $deadline)
                                                            ->where('job_vacancies.id', '<', $id);
                                                    });
                                            } else {
                                                $deadlineOrder->where('job_vacancies.id', '<', $id);
                                            }
                                        });
                                });
                        });
                });
                return;
            }

            if ($sort === 'salary_desc') {
                $nullRank = (int) ($payload['salary_null'] ?? 1);
                $salary = $payload['salary'] ?? null;
                $salaryNullExpr = '(CASE WHEN job_vacancies.salary_max IS NULL AND job_vacancies.salary_min IS NULL THEN 1 ELSE 0 END)';
                $salaryExpr = 'COALESCE(job_vacancies.salary_max, job_vacancies.salary_min, 0)';

                $q->orWhere(function (Builder $sameRank) use ($rankExpr, $rank, $salaryNullExpr, $nullRank, $salaryExpr, $salary, $id) {
                    $sameRank->whereRaw("{$rankExpr} = ?", [$rank])
                        ->where(function (Builder $after) use ($salaryNullExpr, $nullRank, $salaryExpr, $salary, $id) {
                            $after->whereRaw("{$salaryNullExpr} > ?", [$nullRank])
                                ->orWhere(function (Builder $sameNullRank) use ($salaryNullExpr, $nullRank, $salaryExpr, $salary, $id) {
                                    $sameNullRank->whereRaw("{$salaryNullExpr} = ?", [$nullRank])
                                        ->where(function (Builder $salaryOrder) use ($salaryExpr, $salary, $id) {
                                            if ($salary !== null) {
                                                $salaryOrder->whereRaw("{$salaryExpr} < ?", [(float) $salary])
                                                    ->orWhere(function (Builder $sameSalary) use ($salaryExpr, $salary, $id) {
                                                        $sameSalary->whereRaw("{$salaryExpr} = ?", [(float) $salary])
                                                            ->where('job_vacancies.id', '<', $id);
                                                    });
                                            } else {
                                                $salaryOrder->where('job_vacancies.id', '<', $id);
                                            }
                                        });
                                });
                        });
                });
                return;
            }

            $createdAt = $payload['created_at'] ?? null;
            $q->orWhere(function (Builder $sameRank) use ($rankExpr, $rank, $createdAt, $id) {
                $sameRank->whereRaw("{$rankExpr} = ?", [$rank])
                    ->where(function (Builder $newestOrder) use ($createdAt, $id) {
                        if ($createdAt !== null) {
                            $newestOrder->where('job_vacancies.created_at', '<', $createdAt)
                                ->orWhere(function (Builder $sameCreatedAt) use ($createdAt, $id) {
                                    $sameCreatedAt->where('job_vacancies.created_at', '=', $createdAt)
                                        ->where('job_vacancies.id', '<', $id);
                                });
                        } else {
                            $newestOrder->where('job_vacancies.id', '<', $id);
                        }
                    });
            });
        });
    }

    private function isAdminUser(int $userId): bool
    {
        $user = User::where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->first(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if (!$user) {
            return false;
        }

        $role = (string) ($user->role ?? '');
        return in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || (bool) ($user->is_admin ?? false)
            || (bool) ($user->is_super_admin ?? false)
            || (bool) ($user->is_tenant_super_admin ?? false)
            || (bool) ($user->is_god ?? false);
    }

    /**
     * Whether a user may manage a vacancy: the owner, an admin, or a hiring-team
     * manager. Mirrors JobInterviewSchedulingService::canManageSlots so application
     * management, analytics, exports and bulk actions share one authorization model.
     */
    private function canManageVacancy(int $vacancyId, int $vacancyOwnerId, int $userId): bool
    {
        if ($vacancyOwnerId === $userId || $this->isAdminUser($userId)) {
            return true;
        }

        return \App\Models\JobVacancyTeam::where('tenant_id', TenantContext::getId())
            ->where('vacancy_id', $vacancyId)
            ->where('user_id', $userId)
            ->where('role', 'manager')
            ->exists();
    }

    private function validateOrganizationForPosting(int $organizationId, int $userId, int $tenantId): bool
    {
        $exists = DB::table('organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $organizationId)
            ->exists();

        if (!$exists) {
            $this->errors[] = ['code' => 'VALIDATION_INVALID_ORGANIZATION', 'message' => __('api.job_organization_invalid')];
            return false;
        }

        if ($this->isAdminUser($userId)) {
            return true;
        }

        $canPost = DB::table('org_members')
            ->where('org_type', 'community')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->whereIn('role', ['owner', 'admin'])
            ->exists();

        if (!$canPost) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_organization_forbidden')];
        }

        return $canPost;
    }

    /**
     * Get all job vacancies with filtering and cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(array $filters = [], ?int $userId = null): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->vacancy->newQuery()
            ->with(['creator:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->leftJoin('organizations as o', 'job_vacancies.organization_id', '=', 'o.id')
            ->select('job_vacancies.*', 'o.name as organization_name', 'o.logo_url as organization_logo');

        if (!empty($filters['public_only'])) {
            $this->applyPublicVisibility($query);
        } elseif (!empty($filters['status'])) {
            $status = $filters['status'];
            if ($status === 'expired') {
                // Expired = deadline has passed and vacancy is still open
                $query->where('job_vacancies.status', 'open')
                      ->whereNotNull('job_vacancies.deadline')
                      ->where('job_vacancies.deadline', '<', now());
            } elseif ($status === 'pending_review') {
                // Pending review = awaiting moderation approval
                $query->where('job_vacancies.moderation_status', 'pending_review');
            } else {
                $query->where('job_vacancies.status', $status);
            }
        }
        if (!empty($filters['type'])) {
            $query->where('job_vacancies.type', $filters['type']);
        }
        if (!empty($filters['commitment'])) {
            $query->where('job_vacancies.commitment', $filters['commitment']);
        }
        if (!empty($filters['category'])) {
            $query->where('job_vacancies.category', $filters['category']);
        }
        if (!empty($filters['search'])) {
            $parsed = self::parseBooleanQuery($filters['search']);

            // Must terms (AND) — all must match title OR description OR skills_required
            foreach ($parsed['must'] as $term) {
                $query->where(function (Builder $inner) use ($term) {
                    $inner->where('job_vacancies.title', 'LIKE', "%{$term}%")
                          ->orWhere('job_vacancies.description', 'LIKE', "%{$term}%")
                          ->orWhere('job_vacancies.skills_required', 'LIKE', "%{$term}%");
                });
            }

            // Should terms (OR) — at least one must match
            if (!empty($parsed['should'])) {
                $query->where(function (Builder $inner) use ($parsed) {
                    foreach ($parsed['should'] as $term) {
                        $inner->orWhere(function (Builder $sub) use ($term) {
                            $sub->where('job_vacancies.title', 'LIKE', "%{$term}%")
                                ->orWhere('job_vacancies.description', 'LIKE', "%{$term}%");
                        });
                    }
                });
            }

            // Not terms — exclude
            foreach ($parsed['not'] as $term) {
                $query->where('job_vacancies.title', 'NOT LIKE', "%{$term}%")
                      ->where('job_vacancies.description', 'NOT LIKE', "%{$term}%");
            }
        }
        if (!empty($filters['user_id'])) {
            $query->where('job_vacancies.user_id', (int) $filters['user_id']);
        }
        if (!empty($filters['featured'])) {
            $query->where('job_vacancies.is_featured', true)
                ->where(function (Builder $q) {
                    $q->whereNull('job_vacancies.featured_until')
                      ->orWhere('job_vacancies.featured_until', '>', now());
                });
        }
        if (!empty($filters['is_remote'])) {
            $query->where('job_vacancies.is_remote', true);
        }
        if (!empty($filters['exclude'])) {
            $query->where('job_vacancies.id', '!=', (int) $filters['exclude']);
        }
        if (!empty($filters['organization_id'])) {
            $query->where('job_vacancies.organization_id', (int) $filters['organization_id']);
        }

        // Haversine geolocation radius filter
        $lat = isset($filters['latitude']) ? (float) $filters['latitude'] : null;
        $lng = isset($filters['longitude']) ? (float) $filters['longitude'] : null;
        $radiusKm = isset($filters['radius_km']) ? (float) $filters['radius_km'] : null;

        if ($lat !== null && $lng !== null && $radiusKm !== null && $radiusKm > 0) {
            $query->whereNotNull('job_vacancies.latitude')
                ->whereNotNull('job_vacancies.longitude')
                ->whereRaw(
                    '(6371 * acos(cos(radians(?)) * cos(radians(job_vacancies.latitude)) * cos(radians(job_vacancies.longitude) - radians(?)) + sin(radians(?)) * sin(radians(job_vacancies.latitude)))) <= ?',
                    [$lat, $lng, $lat, $radiusKm]
                );
        }

        // Featured jobs always first, then apply requested sort.
        $query->orderByRaw($this->activeFeaturedRankExpression() . ' ASC');

        $sort = $filters['sort'] ?? 'newest';
        switch ($sort) {
            case 'deadline':
                // Soonest deadlines first, nulls last
                $query->orderByRaw('CASE WHEN job_vacancies.deadline IS NULL THEN 1 ELSE 0 END ASC')
                      ->orderBy('job_vacancies.deadline', 'asc')
                      ->orderByDesc('job_vacancies.id');
                break;
            case 'salary_desc':
                // Highest salary first, nulls last
                $query->orderByRaw('CASE WHEN job_vacancies.salary_max IS NULL AND job_vacancies.salary_min IS NULL THEN 1 ELSE 0 END ASC')
                      ->orderByRaw('COALESCE(job_vacancies.salary_max, job_vacancies.salary_min, 0) DESC')
                      ->orderByDesc('job_vacancies.id');
                break;
            default: // 'newest'
                $query->orderByDesc('job_vacancies.created_at')
                      ->orderByDesc('job_vacancies.id');
                break;
        }

        // Offset-based pagination (used by admin panel, supports total count)
        if (array_key_exists('offset', $filters)) {
            $limit = min((int) ($filters['limit'] ?? 50), 200);
            $offset = max(0, (int) $filters['offset']);
            $total = (clone $query)->count();
            $items = $query->offset($offset)->limit($limit)->get();
            $enriched = $this->enrichVacancyBatch($items, $userId);
            return [
                'items' => $enriched,
                'cursor' => null,
                'has_more' => ($offset + $limit) < $total,
                'total' => $total,
            ];
        }

        // Total count for the unpaginated query (used by UI for pagination display)
        $total = (clone $query)->count();

        // Cursor-based pagination (default for all other callers). The cursor
        // captures the active sort keys, so changing sort/filter state cannot
        // reuse an incompatible position and alternate sorts do not skip rows.
        $this->applyVacancyCursor($query, $cursor, $sort);

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $enriched = $this->enrichVacancyBatch($items, $userId);

        return [
            'items' => $enriched,
            'cursor' => $hasMore && $items->isNotEmpty() ? $this->encodeCursorForVacancy($items->last(), $sort) : null,
            'has_more' => $hasMore,
            'total' => $total,
        ];
    }

    /**
     * Get a single job vacancy by ID.
     */
    public function getById(int $id): ?array
    {
        // 🔴 The creator join is load-bearing. `enrichVacancy()` builds
        // `creator.name` from `creator_first_name`/`creator_last_name`, so without it
        // every single-vacancy read returned `creator => ['name' => '']` and each
        // frontend drew a "Posted by" heading with nothing under it. Measured on a
        // device 2026-08-23; the list queries have always joined `users`, which is why
        // the cards were fine and only the detail screen was blank.
        $job = $this->vacancy->newQuery()
            ->leftJoin('users as u', 'job_vacancies.user_id', '=', 'u.id')
            ->leftJoin('organizations as o', 'job_vacancies.organization_id', '=', 'o.id')
            ->select(
                'job_vacancies.*',
                'u.first_name as creator_first_name',
                'u.last_name as creator_last_name', 'u.profile_type as creator_profile_type', 'u.organization_name as creator_organization_name',
                'u.avatar_url as creator_avatar',
                'o.name as organization_name',
                'o.logo_url as organization_logo'
            )
            ->where('job_vacancies.id', $id)
            ->first();

        if (!$job) {
            return null;
        }

        $data = $this->enrichVacancy($job);
        $data['applications_count'] = (int) JobApplication::where('tenant_id', TenantContext::getId())
            ->where('vacancy_id', $id)->count();

        return $data;
    }

    /**
     * Get a single job vacancy by ID with optional userId for has_applied/is_saved checks.
     */
    public function legacyGetById(int|string $id, ?int $userId = null): ?array
    {
        // 🔴 Same creator join as getById() above, and for the same reason: this is the
        // method the public `GET /v2/jobs/{id}` route actually calls.
        $job = $this->vacancy->newQuery()
            ->leftJoin('users as u', 'job_vacancies.user_id', '=', 'u.id')
            ->leftJoin('organizations as o', 'job_vacancies.organization_id', '=', 'o.id')
            ->select(
                'job_vacancies.*',
                'u.first_name as creator_first_name',
                'u.last_name as creator_last_name', 'u.profile_type as creator_profile_type', 'u.organization_name as creator_organization_name',
                'u.avatar_url as creator_avatar',
                'o.name as organization_name',
                'o.logo_url as organization_logo'
            )
            ->where('job_vacancies.id', $id)
            ->first();

        if (!$job) {
            return null;
        }

        return $this->enrichVacancy($job, $userId);
    }

    /**
     * Create a new job vacancy.
     */
    public function create(int $userId, array $data): int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $type = $data['type'] ?? 'volunteer';
        $validTypes = ['paid', 'volunteer', 'timebank'];
        if (!in_array($type, $validTypes, true)) {
            $this->errors[] = ['code' => 'VALIDATION_INVALID_VALUE', 'message' => __('api.job_type_invalid')];
            return 0;
        }

        $typeConfig = [
            'paid' => JobConfigurationService::CONFIG_ALLOW_PAID,
            'volunteer' => JobConfigurationService::CONFIG_ALLOW_VOLUNTEER,
            'timebank' => JobConfigurationService::CONFIG_ALLOW_TIMEBANK,
        ];
        if (!$this->configBool($typeConfig[$type], true)) {
            $this->errors[] = ['code' => 'FEATURE_DISABLED', 'message' => __('api.job_type_disabled')];
            return 0;
        }

        $maxPostings = (int) JobConfigurationService::get(JobConfigurationService::CONFIG_MAX_POSTINGS_PER_USER, 20);
        if ($maxPostings > 0) {
            $activePostings = $this->vacancy->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->whereIn('status', ['open', 'draft'])
                ->count();
            if ($activePostings >= $maxPostings) {
                $this->errors[] = ['code' => 'QUOTA_EXCEEDED', 'message' => __('api.job_posting_limit_reached', ['limit' => $maxPostings])];
                return 0;
            }
        }

        $requestedStatus = ($data['status'] ?? 'open') === 'draft' ? 'draft' : 'open';
        $deadline = $data['deadline'] ?? null;
        if ($deadline === '' || $deadline === null) {
            $defaultDeadlineDays = (int) JobConfigurationService::get(JobConfigurationService::CONFIG_DEFAULT_DEADLINE_DAYS, 30);
            $deadline = $defaultDeadlineDays > 0 ? now()->addDays($defaultDeadlineDays)->toDateString() : null;
        }

        $salaryMin = ($data['salary_min'] ?? '') === '' ? null : $data['salary_min'];
        $salaryMax = ($data['salary_max'] ?? '') === '' ? null : $data['salary_max'];

        // EU Pay Transparency Directive (June 2026) compliance — salary range required unless negotiable
        $salaryNegotiable = $this->inputBool($data['salary_negotiable'] ?? false);
        if (!$salaryNegotiable && $type === 'paid') {
            $hasSalaryMin = isset($data['salary_min']) && $data['salary_min'] !== null && $data['salary_min'] !== '';
            $hasSalaryMax = isset($data['salary_max']) && $data['salary_max'] !== null && $data['salary_max'] !== '';
            if (!$hasSalaryMin || !$hasSalaryMax) {
                $this->errors[] = ['code' => 'VALIDATION_SALARY_REQUIRED', 'message' => __('api.job_salary_required')];
                return 0;
            }
        }

        // Salary min cannot exceed max
        if ($salaryMin !== null && $salaryMax !== null && (float) $salaryMin > (float) $salaryMax) {
            $this->errors[] = ['code' => 'VALIDATION_SALARY_RANGE', 'message' => __('api.job_salary_range_invalid')];
            return 0;
        }

        $organizationId = ($data['organization_id'] ?? '') === '' ? null : (int) ($data['organization_id'] ?? 0);
        if ($organizationId !== null && !$this->validateOrganizationForPosting($organizationId, $userId, $tenantId)) {
            return 0;
        }

        $spamResult = ['score' => 0, 'flags' => [], 'action' => 'allow'];
        if ($this->configBool(JobConfigurationService::CONFIG_SPAM_DETECTION, true)) {
            $spamResult = JobSpamDetectionService::analyzeJob($data, $userId, $tenantId);
        }
        $spamScore = $spamResult['score'];
        $spamFlags = $spamResult['flags'];
        $spamAction = $spamResult['action'];

        // Determine initial status and moderation_status
        $status = $requestedStatus;
        $moderationStatus = null;

        if ($spamAction === 'block') {
            $status = 'closed';
            $moderationStatus = 'rejected';
        } elseif ($requestedStatus === 'open' && ($spamAction === 'flag' || JobModerationService::isModerationEnabled($tenantId))) {
            $status = 'draft';
            $moderationStatus = 'pending_review';
        }

        $brandingEnabled = $this->configBool(JobConfigurationService::CONFIG_ENABLE_EMPLOYER_BRANDING, true);
        $blindHiringEnabled = $this->configBool(JobConfigurationService::CONFIG_ENABLE_BLIND_HIRING, false);
        $salaryCurrency = trim((string) ($data['salary_currency'] ?? ''));
        if ($salaryCurrency === '') {
            $salaryCurrency = (string) JobConfigurationService::get(JobConfigurationService::CONFIG_DEFAULT_CURRENCY, 'EUR');
        }

        $vacancy = $this->vacancy->newQuery()->create(array_filter([
            'tenant_id'       => $tenantId,
            'title'          => trim($data['title']),
            'description'    => trim($data['description'] ?? ''),
            'type'           => $type,
            'commitment'     => $data['commitment'] ?? 'flexible',
            'location'       => $data['location'] ?? null,
            'latitude'       => $this->normalizeCoordinate($data['latitude'] ?? null, -90, 90),
            'longitude'      => $this->normalizeCoordinate($data['longitude'] ?? null, -180, 180),
            'is_remote'      => $this->inputBool($data['is_remote'] ?? false),
            'category'       => $data['category'] ?? null,
            'skills_required' => $this->normalizeSkillsInput($data['skills_required'] ?? null),
            'hours_per_week' => ($data['hours_per_week'] ?? '') === '' ? null : (float) $data['hours_per_week'],
            'time_credits'   => ($data['time_credits'] ?? '') === '' ? null : (float) $data['time_credits'],
            'contact_email'  => $data['contact_email'] ?? null,
            'contact_phone'  => $data['contact_phone'] ?? null,
            'deadline'       => $deadline,
            'salary_min'     => $salaryMin,
            'salary_max'     => $salaryMax,
            'salary_type'    => $data['salary_type'] ?? null,
            'salary_currency' => $salaryCurrency,
            'salary_negotiable' => $salaryNegotiable,
            'organization_id' => $organizationId,
            'status'         => $status,
            'user_id'        => $userId,
            'tagline'        => $brandingEnabled && isset($data['tagline']) ? trim((string) $data['tagline']) : null,
            'video_url'      => $brandingEnabled ? ($data['video_url'] ?? null) : null,
            'culture_photos' => $brandingEnabled ? $this->normalizeJsonList($data['culture_photos'] ?? null) : null,
            'company_size'   => $brandingEnabled ? ($data['company_size'] ?? null) : null,
            'benefits'       => $brandingEnabled ? $this->normalizeJsonList($data['benefits'] ?? null) : null,
            'blind_hiring'   => $blindHiringEnabled && $this->inputBool($data['blind_hiring'] ?? false),
            'moderation_status' => $moderationStatus,
            'spam_score'     => $spamScore,
            'spam_flags'     => !empty($spamFlags) ? $spamFlags : null,
        ], fn($v) => $v !== null));

        // Log spam detection results (Agent B)
        if ($spamAction === 'block') {
            Log::warning("Job #{$vacancy->id} auto-blocked by spam detection (score: {$spamScore})", [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'flags' => $spamFlags,
            ]);
        } elseif ($spamAction === 'flag') {
            Log::info("Job #{$vacancy->id} auto-flagged for moderation (score: {$spamScore})", [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'flags' => $spamFlags,
            ]);
        }

        // Alert moderators when spam detection flags/blocks a posting so it does
        // not sit silently in the queue. Only fires on an actual spam action —
        // normal moderation holds are not spam and are handled elsewhere.
        if ($spamAction === 'flag' || $spamAction === 'block') {
            try {
                \App\Services\NotificationDispatcher::notifyModerationAdmins(
                    'job_flagged_spam',
                    '/admin/jobs/moderation',
                    'svc_notifications_2.job_vacancy.spam_flag',
                    'emails_misc.moderation.job_subject',
                    'emails_misc.moderation.job_body',
                    [
                        'title'  => (string) $vacancy->title,
                        'job_id' => $vacancy->id,
                        'score'  => $spamScore,
                        'flags'  => is_array($spamFlags) ? implode(', ', $spamFlags) : (string) $spamFlags,
                    ]
                );
            } catch (\Throwable $notifyError) {
                Log::warning('Job spam-flag admin alert failed: ' . $notifyError->getMessage());
            }
        }

        // Dispatch webhook for vacancy creation
        try {
            \App\Services\WebhookDispatchService::dispatch('job.vacancy.created', [
                'vacancy_id' => $vacancy->id,
                'title'      => $vacancy->title,
                'type'       => $vacancy->type,
                'tenant_id'  => TenantContext::getId(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('JobVacancyService::create webhook dispatch failed: ' . $e->getMessage());
        }

        if ($vacancy->status === 'open') {
            // Fire event to notify job alert subscribers
            try {
                $creator = User::find($userId);
                if ($creator) {
                    event(new \App\Events\JobVacancyCreated($vacancy, $creator, TenantContext::getId()));
                }
            } catch (\Throwable $e) {
                Log::warning('JobVacancyService::create event dispatch failed: ' . $e->getMessage());
            }
        }

        return $vacancy->id;
    }

    /**
     * Update an existing job vacancy.
     */
    public function update(int $id, int $userId, array $data): bool
    {
        $this->errors = [];

        $vacancy = $this->vacancy->newQuery()->find($id);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return false;
        }

        // Check ownership or admin
        if ((int) $vacancy->user_id !== $userId && !$this->isAdminUser($userId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_edit_own_only')];
            return false;
        }

        // NOTE: organization_id is intentionally NOT in this list. Allowing it on
        // update lets a poster reassign a job to any organization, even one they
        // don't belong to (no membership check existed). Organization is a
        // create-time decision; reassigning requires a dedicated admin flow.
        $allowedFields = [
            'title', 'description', 'location', 'latitude', 'longitude', 'is_remote', 'type', 'commitment',
            'category', 'skills_required', 'hours_per_week', 'time_credits',
            'contact_email', 'contact_phone', 'deadline', 'status',
            'salary_min', 'salary_max', 'salary_type', 'salary_currency', 'salary_negotiable',
            'tagline', 'video_url', 'culture_photos', 'company_size', 'benefits',
            'blind_hiring',
        ];

        $updates = [];
        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }

        if (array_key_exists('skills_required', $updates)) {
            $updates['skills_required'] = $this->normalizeSkillsInput($updates['skills_required']);
        }

        if (empty($updates)) {
            return true;
        }

        if (array_key_exists('type', $updates)) {
            $validTypes = ['paid', 'volunteer', 'timebank'];
            if (!in_array($updates['type'], $validTypes, true)) {
                $this->errors[] = ['code' => 'VALIDATION_INVALID_VALUE', 'message' => __('api.job_type_invalid')];
                return false;
            }

            $typeConfig = [
                'paid' => JobConfigurationService::CONFIG_ALLOW_PAID,
                'volunteer' => JobConfigurationService::CONFIG_ALLOW_VOLUNTEER,
                'timebank' => JobConfigurationService::CONFIG_ALLOW_TIMEBANK,
            ];
            if (!$this->configBool($typeConfig[$updates['type']], true)) {
                $this->errors[] = ['code' => 'FEATURE_DISABLED', 'message' => __('api.job_type_disabled')];
                return false;
            }
        }

        if (array_key_exists('latitude', $updates)) {
            $updates['latitude'] = $this->normalizeCoordinate($updates['latitude'], -90, 90);
        }
        if (array_key_exists('longitude', $updates)) {
            $updates['longitude'] = $this->normalizeCoordinate($updates['longitude'], -180, 180);
        }
        if (array_key_exists('is_remote', $updates)) {
            $updates['is_remote'] = $this->inputBool($updates['is_remote']);
        }
        if (array_key_exists('culture_photos', $updates)) {
            $updates['culture_photos'] = $this->normalizeJsonList($updates['culture_photos']);
        }
        if (array_key_exists('benefits', $updates)) {
            $updates['benefits'] = $this->normalizeJsonList($updates['benefits']);
        }
        if (array_key_exists('blind_hiring', $updates)) {
            $updates['blind_hiring'] = $this->configBool(JobConfigurationService::CONFIG_ENABLE_BLIND_HIRING, false)
                && $this->inputBool($updates['blind_hiring']);
        }
        if (array_key_exists('salary_currency', $updates) && trim((string) $updates['salary_currency']) === '') {
            $updates['salary_currency'] = JobConfigurationService::get(JobConfigurationService::CONFIG_DEFAULT_CURRENCY, 'EUR');
        }
        foreach (['salary_min', 'salary_max', 'hours_per_week', 'time_credits'] as $numericField) {
            if (array_key_exists($numericField, $updates)) {
                $updates[$numericField] = ($updates[$numericField] === '' || $updates[$numericField] === null)
                    ? null
                    : (float) $updates[$numericField];
            }
        }
        if (array_key_exists('deadline', $updates) && $updates['deadline'] === '') {
            $updates['deadline'] = null;
        }
        if (array_key_exists('salary_negotiable', $updates)) {
            $updates['salary_negotiable'] = $this->inputBool($updates['salary_negotiable']);
        }
        if (array_key_exists('status', $updates) && !in_array($updates['status'], ['open', 'draft', 'closed', 'filled'], true)) {
            $this->errors[] = ['code' => 'VALIDATION_INVALID_VALUE', 'message' => __('api.job_status_invalid')];
            return false;
        }

        // EU Pay Transparency Directive (June 2026) compliance — salary range required unless negotiable
        // Only validate when salary fields or type are being touched in this update
        $salaryFieldsTouched = array_key_exists('salary_min', $updates) || array_key_exists('salary_max', $updates)
            || array_key_exists('salary_negotiable', $updates) || array_key_exists('type', $updates);
        $typeAfterUpdate = $updates['type'] ?? $vacancy->type ?? null;
        if ($salaryFieldsTouched && $typeAfterUpdate === 'paid') {
            $salaryNegotiable = array_key_exists('salary_negotiable', $updates)
                ? !empty($updates['salary_negotiable'])
                : !empty($vacancy->salary_negotiable);

            if (!$salaryNegotiable) {
                $salaryMin = array_key_exists('salary_min', $updates) ? $updates['salary_min'] : $vacancy->salary_min;
                $salaryMax = array_key_exists('salary_max', $updates) ? $updates['salary_max'] : $vacancy->salary_max;
                if (($salaryMin === null || $salaryMin === '') || ($salaryMax === null || $salaryMax === '')) {
                    $this->errors[] = ['code' => 'VALIDATION_SALARY_REQUIRED', 'message' => __('api.job_salary_required')];
                    return false;
                }
            }
        }

        // Salary min cannot exceed max
        $finalMin = array_key_exists('salary_min', $updates) ? $updates['salary_min'] : ($vacancy->salary_min ?? null);
        $finalMax = array_key_exists('salary_max', $updates) ? $updates['salary_max'] : ($vacancy->salary_max ?? null);
        if (!empty($finalMin) && !empty($finalMax) && (float)$finalMin > (float)$finalMax) {
            $this->errors[] = ['code' => 'VALIDATION_SALARY_RANGE', 'message' => __('api.job_salary_range_invalid')];
            return false;
        }

        // Re-analyze spam score on content changes (mirrors create() logic)
        $spamRelevantFields = ['title', 'description', 'tagline', 'location', 'contact_email', 'contact_phone'];
        $hasSpamRelevantChange = !empty(array_intersect(array_keys($updates), $spamRelevantFields));
        if ($hasSpamRelevantChange && $this->configBool(JobConfigurationService::CONFIG_SPAM_DETECTION, true)) {
            try {
                $tenantId = TenantContext::getId();
                $mergedData = array_merge($vacancy->toArray(), $updates);
                $spamResult = JobSpamDetectionService::analyzeJob($mergedData, $userId, $tenantId);

                $updates['spam_score'] = $spamResult['score'];
                $updates['spam_flags'] = !empty($spamResult['flags']) ? $spamResult['flags'] : null;

                // If spam action escalates to 'block', close the vacancy
                if ($spamResult['action'] === 'block') {
                    $updates['status'] = 'closed';
                    $updates['moderation_status'] = 'rejected';
                    Log::warning("Job #{$id} auto-blocked after update by spam detection (score: {$spamResult['score']})", [
                        'tenant_id' => $tenantId,
                        'user_id' => $userId,
                        'flags' => $spamResult['flags'],
                    ]);
                } elseif ($spamResult['action'] === 'flag') {
                    $updates['moderation_status'] = 'pending_review';
                    Log::info("Job #{$id} auto-flagged after update for moderation (score: {$spamResult['score']})", [
                        'tenant_id' => $tenantId,
                        'user_id' => $userId,
                        'flags' => $spamResult['flags'],
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('JobVacancyService::update spam re-analysis failed: ' . $e->getMessage());
                // Non-fatal — proceed with update without spam re-scoring
            }
        }

        try {
            $vacancy->update($updates);
            return true;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::update failed: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_INTERNAL_ERROR', 'message' => __('api.job_update_failed')];
            return false;
        }
    }

    /**
     * Delete a job vacancy.
     */
    public function delete(int $id, int $adminId): bool
    {
        $this->errors = [];

        $vacancy = $this->vacancy->newQuery()->find($id);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return false;
        }

        // Check ownership or admin
        if ((int) $vacancy->user_id !== $adminId) {
            if (!$this->isAdminUser($adminId)) {
                $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_edit_own_only')];
                return false;
            }
        }

        try {
            $tenantId = TenantContext::getId();

            // Remove all dependent records in one transaction. DB-level ON DELETE CASCADE
            // covers some of these once the FK-repair migration is applied, but several
            // job tables shipped without working foreign keys (BIGINT-vs-INT mismatch),
            // so we delete explicitly here to avoid orphaned interviews / offers /
            // scorecards / slots / referrals regardless of the DB's FK state.
            DB::transaction(function () use ($id, $tenantId, $vacancy) {
                \App\Models\JobInterview::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                \App\Models\JobOffer::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                \App\Models\JobScorecard::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                \App\Models\JobVacancyTeam::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                \App\Models\JobPipelineRule::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                \App\Models\JobReferral::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                \App\Models\JobInterviewSlot::where('tenant_id', $tenantId)->where('job_id', $id)->delete();
                \App\Models\SavedJob::where('tenant_id', $tenantId)->where('job_id', $id)->delete();
                // Applications last (cascades to job_application_history via its FK).
                JobApplication::where('tenant_id', $tenantId)->where('vacancy_id', $id)->delete();
                $vacancy->delete();
            });

            return true;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::delete failed: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_INTERNAL_ERROR', 'message' => __('api.delete_failed', ['resource' => 'job vacancy'])];
            return false;
        }
    }

    /**
     * Apply to a job vacancy.
     *
     * Accepts optional cv_path, cv_filename, cv_size for CV file upload support.
     *
     * @return int|null Application ID or null if already applied.
     */
    public function apply(int $jobId, int $userId, array $data = []): ?int
    {
        $this->errors = [];

        // Verify vacancy exists and is open
        $vacancy = $this->vacancy->newQuery()->find($jobId);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return null;
        }

        if ((int) $vacancy->user_id === $userId) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_cannot_apply_own')];
            return null;
        }
        if ($vacancy->status !== 'open' || ($vacancy->deadline && $vacancy->deadline->copy()->endOfDay()->isPast())) {
            $this->errors[] = ['code' => 'VACANCY_CLOSED', 'message' => __('api.job_vacancy_not_accepting_applications')];
            return null;
        }
        if ($vacancy->moderation_status && $vacancy->moderation_status !== 'approved') {
            $this->errors[] = ['code' => 'VACANCY_CLOSED', 'message' => __('api.job_vacancy_not_accepting_applications')];
            return null;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $userId,
            (int) $vacancy->user_id,
            TenantContext::getId(),
            'job_application',
        );

        // Use transaction + row lock to prevent duplicate applications from concurrent requests
        $application = null;
        try {
            $application = DB::transaction(function () use ($jobId, $userId, $data) {
                $exists = JobApplication::where('tenant_id', TenantContext::getId())
                    ->where('vacancy_id', $jobId)
                    ->where('user_id', $userId)
                    ->lockForUpdate()
                    ->exists();

                if ($exists) {
                    return false;
                }

                return JobApplication::create([
                    'tenant_id' => TenantContext::getId(),
                    'vacancy_id' => $jobId,
                    'user_id' => $userId,
                    'message' => $data['cover_letter'] ?? null,
                    'cv_path' => $data['cv_path'] ?? null,
                    'cv_filename' => $data['cv_filename'] ?? null,
                    'cv_size' => isset($data['cv_size']) ? (int) $data['cv_size'] : null,
                    'status' => 'pending',
                    'stage' => 'applied',
                ]);
            });
        } catch (\Throwable $e) {
            Log::error('Job application failed', ['error' => $e->getMessage(), 'vacancy_id' => $jobId, 'user_id' => $userId]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.create_failed', ['resource' => 'application'])];
            return null;
        }

        if ($application === false) {
            $this->errors[] = ['code' => 'RESOURCE_CONFLICT', 'message' => __('api.job_already_applied')];
            return null;
        }

        // Log initial application in history
        $this->logApplicationHistory($application->id, null, 'applied', $userId, __('api.job_application_submitted'));

        // Increment applications count
        $this->vacancy->newQuery()
            ->where('id', $jobId)
            ->increment('applications_count');

        // Dispatch webhook for new application
        try {
            \App\Services\WebhookDispatchService::dispatch('job.application.created', [
                'application_id' => $application->id,
                'vacancy_id'     => $jobId,
                'user_id'        => $userId,
                'tenant_id'      => TenantContext::getId(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('JobVacancyService::apply webhook dispatch failed: ' . $e->getMessage());
        }

        return $application->id;
    }

    /**
     * Apply with message string (legacy signature).
     */
    public function legacyApply(int $jobId, int $userId, ?string $message = null): ?int
    {
        return $this->apply($jobId, $userId, ['cover_letter' => $message]);
    }

    /**
     * Increment view count for a vacancy.
     */
    public function incrementViews(int $id, ?int $userId = null): void
    {
        $tenantId = TenantContext::getId();

        try {
            $this->vacancy->newQuery()
                ->where('id', $id)
                ->increment('views_count');

            // Log individual view for analytics
            DB::table('job_vacancy_views')->insert([
                'vacancy_id' => $id,
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'viewed_at' => now(),
                'ip_hash' => null,
            ]);
        } catch (\Throwable $e) {
            // Non-critical
            Log::warning('JobVacancyService::incrementViews failed: ' . $e->getMessage());
        }
    }

    /**
     * Feature a job vacancy (admin only).
     */
    public function featureJob(int $id, int $adminId, int $days = 7): bool
    {
        $this->errors = [];

        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_FEATURED, true)) {
            $this->errors[] = ['code' => 'FEATURE_DISABLED', 'message' => __('api.job_featured_disabled')];
            return false;
        }

        if ($days <= 0) {
            $days = (int) JobConfigurationService::get(JobConfigurationService::CONFIG_FEATURED_DURATION_DAYS, 7);
        }
        $days = max(1, min(90, $days));

        if (!$this->isAdminUser($adminId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_admin_feature_only')];
            return false;
        }

        $job = $this->vacancy->newQuery()->find($id);
        if (!$job) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return false;
        }

        try {
            $job->update([
                'is_featured' => true,
                'featured_until' => now()->addDays($days),
            ]);
            return true;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::featureJob failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Unfeature a job vacancy (admin only).
     */
    public function unfeatureJob(int $id, int $adminId): bool
    {
        $this->errors = [];

        if (!$this->isAdminUser($adminId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_admin_feature_only')];
            return false;
        }

        try {
            $this->vacancy->newQuery()
                ->where('id', $id)
                ->update(['is_featured' => false, 'featured_until' => null]);
            return true;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::unfeatureJob failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Cron: clear the `is_featured` flag on jobs whose paid feature window
     * has expired. Tenant-scoped via the current TenantContext; CronJobRunner
     * iterates tenants and calls this per-tenant.
     *
     * Returns the number of rows updated.
     */
    public function expireFeaturedJobs(): int
    {
        try {
            return (int) DB::table('job_vacancies')
                ->where('tenant_id', TenantContext::getId())
                ->where('is_featured', 1)
                ->whereNotNull('featured_until')
                ->where('featured_until', '<', now())
                ->update(['is_featured' => 0]);
        } catch (\Throwable $e) {
            Log::warning('JobVacancyService::expireFeaturedJobs failed: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Cron: close job vacancies that have been `open` for more than 180 days
     * with no recent activity (no applications or owner edits in the last 60
     * days). Conservative defaults — a stale job listing is worse than an
     * occasional false positive close. Tenant-scoped via TenantContext.
     *
     * `job_vacancies` has no explicit expires_at column, so we use a
     * recency heuristic instead.
     *
     * Returns the number of rows closed.
     */
    public function expireOverdueJobs(): int
    {
        try {
            $cutoffOpened    = now()->subDays(180);
            $cutoffNoEdit    = now()->subDays(60);

            return (int) DB::table('job_vacancies')
                ->where('tenant_id', TenantContext::getId())
                ->where('status', 'open')
                ->where('created_at', '<', $cutoffOpened)
                ->where(function ($q) use ($cutoffNoEdit) {
                    $q->whereNull('updated_at')
                      ->orWhere('updated_at', '<', $cutoffNoEdit);
                })
                ->update(['status' => 'closed', 'updated_at' => now()]);
        } catch (\Throwable $e) {
            Log::warning('JobVacancyService::expireOverdueJobs failed: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Get applications for a vacancy (owner/admin only).
     */
    public function getApplications(int $jobId, int $adminId): ?array
    {
        $this->errors = [];

        $vacancy = $this->vacancy->newQuery()->find($jobId);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return null;
        }

        // Owner, admin, or hiring-team manager
        if (!$this->canManageVacancy($jobId, (int) $vacancy->user_id, $adminId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_access_denied')];
            return null;
        }

        $isBlindHiring = (bool) ($vacancy->blind_hiring ?? false);

        $applications = JobApplication::with(['applicant:id,first_name,last_name,profile_type,organization_name,avatar_url,email'])
            ->where('tenant_id', TenantContext::getId())
            ->where('vacancy_id', $jobId)
            ->orderByDesc('created_at')
            ->get();

        $candidateNumber = 0;

        return $applications
            ->map(function ($app) use ($isBlindHiring, &$candidateNumber) {
                $data = $app->toArray();
                $candidateNumber++;

                if ($isBlindHiring) {
                    unset($data['user_id'], $data['message'], $data['cv_path'], $data['cv_filename'], $data['cv_size']);
                    $data['applicant'] = [
                        'id' => 0,
                        'name' => __('api.job_candidate_label', ['number' => $candidateNumber]),
                        'avatar_url' => null,
                        'email' => null,
                    ];
                } else {
                    $data['applicant'] = [
                        'id' => (int) $app->user_id,
                        'name' => $app->applicant ? UserDisplayName::resolve($app->applicant) : null,
                        'avatar_url' => $app->applicant->avatar_url ?? null,
                        'email' => $app->applicant->email ?? null,
                    ];
                }

                return $data;
            })
            ->all();
    }

    /**
     * Update an application status/stage.
     */
    public function updateApplicationStatus(int $applicationId, int $adminId, string $status, ?string $notes = null): bool
    {
        $this->errors = [];

        $validStatuses = ['applied', 'pending', 'screening', 'reviewed', 'shortlisted', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'];
        if (!in_array($status, $validStatuses)) {
            $this->errors[] = ['code' => 'VALIDATION_INVALID_VALUE', 'message' => __('api.job_status_invalid')];
            return false;
        }

        $application = JobApplication::with(['vacancy'])
            ->where('tenant_id', TenantContext::getId())
            ->find($applicationId);
        if (!$application) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_application_not_found')];
            return false;
        }

        // Must be tenant-scoped
        $tenantId = TenantContext::getId();
        if (!$application->vacancy || (int) $application->vacancy->tenant_id !== $tenantId) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_application_not_found')];
            return false;
        }

        $isApplicantWithdraw = $status === 'withdrawn' && (int) $application->user_id === $adminId;

        // Owner, admin, or hiring-team manager — or the applicant withdrawing their own application.
        if (!$isApplicantWithdraw && !$this->canManageVacancy((int) $application->vacancy_id, (int) $application->vacancy->user_id, $adminId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_access_denied')];
            return false;
        }

        $previousStatus = $application->stage ?? $application->status ?? 'applied';

        // Prevent backwards transitions from terminal states (accepted/rejected/withdrawn)
        $terminalStatuses = ['accepted', 'rejected', 'withdrawn'];
        if (in_array($previousStatus, $terminalStatuses, true) && $previousStatus !== $status) {
            $this->errors[] = [
                'code' => 'INVALID_TRANSITION',
                'message' => __('api.job_application_terminal_status', ['status' => $previousStatus]),
            ];
            return false;
        }

        if (! $isApplicantWithdraw) {
            $applicantId = (int) $application->user_id;
            $ownerId = (int) $application->vacancy->user_id;

            if ($status === 'rejected') {
                if ($notes !== null && trim($notes) !== '') {
                    $decision = app(SafeguardingInteractionPolicy::class)->evaluateLocalContact(
                        $adminId,
                        $applicantId,
                        $tenantId,
                        'job_application_rejection_note',
                    );
                    if (! $decision->isAllowed()) {
                        $notes = null;
                    }
                }
            } else {
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $adminId,
                    $applicantId,
                    $tenantId,
                    'job_application_status_progression',
                );

                if (in_array($status, ['accepted'], true) && $ownerId > 0 && $ownerId !== $applicantId) {
                    $policy = app(SafeguardingInteractionPolicy::class);
                    $policy->assertLocalContactAllowed(
                        $ownerId,
                        $applicantId,
                        $tenantId,
                        'job_application_acceptance',
                    );
                    $policy->assertLocalContactAllowed(
                        $applicantId,
                        $ownerId,
                        $tenantId,
                        'job_application_acceptance',
                    );
                }
            }
        }

        try {
            $updates = [
                'status' => $status,
                'stage' => $status,
            ];

            if (!$isApplicantWithdraw) {
                $updates['reviewer_notes'] = $notes ? trim($notes) : null;
                $updates['reviewed_by'] = $adminId;
                $updates['reviewed_at'] = now();
            }

            $application->update($updates);

            $this->logApplicationHistory($applicationId, $previousStatus, $status, $adminId, $notes);

            // Dispatch webhook for application status change
            try {
                \App\Services\WebhookDispatchService::dispatch('job.application.status_changed', [
                    'application_id' => $applicationId,
                    'vacancy_id'     => $application->vacancy_id,
                    'user_id'        => $application->user_id,
                    'from'           => $previousStatus,
                    'to'             => $status,
                    'tenant_id'      => TenantContext::getId(),
                ]);
            } catch (\Throwable $e) {
                Log::warning('JobVacancyService::updateApplicationStatus webhook dispatch failed: ' . $e->getMessage());
            }

            // Notify the applicant about their status change
            try {
                $applicantId = (int) $application->user_id;
                $applicant = DB::table('users')
                    ->where('id', $applicantId)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'preferred_language'])
                    ->first();

                LocaleContext::withLocale($applicant, function () use ($application, $applicationId, $applicantId, $status, $previousStatus) {
                    $jobTitle = $application->vacancy->title ?? __('emails.common.fallback_job');

                    $message = match ($status) {
                        'shortlisted' => __('svc_notifications.job_application.shortlisted', ['title' => $jobTitle]),
                        'rejected'    => __('svc_notifications.job_application.rejected', ['title' => $jobTitle]),
                        'hired', 'accepted' => __('svc_notifications.job_application.hired', ['title' => $jobTitle]),
                        default       => __('svc_notifications.job_application.status_updated', ['title' => $jobTitle, 'status' => $status]),
                    };

                    Notification::createNotification(
                        $applicantId,
                        $message,
                        "/jobs/{$application->vacancy_id}",
                        'job_application'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($applicantId), 'job_application', $message, "/jobs/{$application->vacancy_id}");

                    // Real-time broadcast to candidate
                    RealtimeService::broadcastAndPush($applicantId, $message, [
                        'type'        => 'job_application_status',
                        'job_id'      => (int) $application->vacancy_id,
                        'job_title'   => $jobTitle,
                        'application_id' => $applicationId,
                        'from_status' => $previousStatus,
                        'to_status'   => $status,
                        'message'     => $message,
                    ]);
                });
            } catch (\Throwable $e) {
                Log::warning('JobVacancyService::updateApplicationStatus notification failed', [
                    'application_id' => $applicationId,
                    'status' => $status,
                    'error' => $e->getMessage(),
                ]);
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::updateApplicationStatus failed: ' . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_INTERNAL_ERROR', 'message' => __('api.job_application_update_failed')];
            return false;
        }
    }

    // =========================================================================
    // SAVED JOBS
    // =========================================================================

    /**
     * Save (bookmark) a job.
     */
    public function saveJob(int $id, int $userId): bool
    {
        $this->errors = [];

        $job = $this->vacancy->newQuery()->find($id);
        if (!$job) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return false;
        }

        $existing = SavedJob::where('job_id', $id)->where('user_id', $userId)->exists();
        if ($existing) {
            return true; // Idempotent
        }

        try {
            SavedJob::create([
                'tenant_id' => TenantContext::getId(),
                'user_id'   => $userId,
                'job_id'    => $id,
                'saved_at'  => now(),
            ]);
            return true;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::saveJob failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Unsave (remove bookmark) a job.
     */
    public function unsaveJob(int $id, int $userId): void
    {
        SavedJob::where('job_id', $id)->where('user_id', $userId)->delete();
    }

    /**
     * Get saved jobs for a user.
     */
    public function getSavedJobs(int $userId, array $filters = []): array
    {
        $limit = (int) ($filters['limit'] ?? 20);
        $cursor = $filters['cursor'] ?? null;

        $query = SavedJob::where('saved_jobs.user_id', $userId)
            ->join('job_vacancies as jv', 'saved_jobs.job_id', '=', 'jv.id')
            ->leftJoin('users as u', 'jv.user_id', '=', 'u.id')
            ->leftJoin('organizations as o', 'jv.organization_id', '=', 'o.id')
            ->select(
                'jv.*',
                'u.first_name as creator_first_name',
                'u.last_name as creator_last_name', 'u.profile_type as creator_profile_type', 'u.organization_name as creator_organization_name',
                'u.avatar_url as creator_avatar',
                'o.name as organization_name',
                'o.logo_url as organization_logo',
                'saved_jobs.id as saved_id',
                'saved_jobs.saved_at'
            );

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('saved_jobs.id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('saved_jobs.saved_at')->orderByDesc('saved_jobs.id');

        $rows = $query->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        if ($hasMore) {
            $rows->pop();
        }

        $enriched = $rows->map(function ($row) use ($userId) {
            $data = $this->enrichVacancyArray((array) $row->getAttributes(), $userId);
            $data['saved_at'] = $row->saved_at;
            $data['is_saved'] = true;
            return $data;
        })->values()->all();

        return [
            'items' => $enriched,
            'cursor' => $hasMore && $rows->isNotEmpty() ? base64_encode((string) $rows->last()->saved_id) : null,
            'has_more' => $hasMore,
        ];
    }

    // =========================================================================
    // MY APPLICATIONS / MY POSTINGS
    // =========================================================================

    /**
     * Get user's own applications with vacancy info.
     */
    public function getMyApplications(int $userId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = (int) ($filters['limit'] ?? 20);
        $cursor = $filters['cursor'] ?? null;
        $status = $filters['status'] ?? null;

        $query = JobApplication::join('job_vacancies as jv', 'job_vacancy_applications.vacancy_id', '=', 'jv.id')
            ->where('job_vacancy_applications.user_id', $userId)
            ->where('job_vacancy_applications.tenant_id', $tenantId)
            ->where('jv.tenant_id', $tenantId)
            ->select(
                'job_vacancy_applications.*',
                'jv.title as vacancy_title',
                'jv.type as vacancy_type',
                'jv.commitment as vacancy_commitment',
                'jv.status as vacancy_status',
                'jv.location as vacancy_location',
                'jv.is_remote as vacancy_is_remote',
                'jv.deadline as vacancy_deadline'
            );

        if ($status && in_array($status, ['applied', 'pending', 'screening', 'reviewed', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'])) {
            $query->where('job_vacancy_applications.status', $status);
        }

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('job_vacancy_applications.id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('job_vacancy_applications.created_at')
            ->orderByDesc('job_vacancy_applications.id');

        $applications = $query->limit($limit + 1)->get();
        $hasMore = $applications->count() > $limit;
        if ($hasMore) {
            $applications->pop();
        }

        $items = $applications->map(function ($app) {
            $data = $app->toArray();
            $data['id'] = (int) $data['id'];
            $data['vacancy_id'] = (int) $data['vacancy_id'];
            $data['user_id'] = (int) $data['user_id'];
            $data['vacancy'] = [
                'id' => (int) $data['vacancy_id'],
                'title' => $data['vacancy_title'] ?? null,
                'type' => $data['vacancy_type'] ?? null,
                'commitment' => $data['vacancy_commitment'] ?? null,
                'status' => $data['vacancy_status'] ?? null,
                'location' => $data['vacancy_location'] ?? null,
                'is_remote' => (bool) ($data['vacancy_is_remote'] ?? false),
                'deadline' => $data['vacancy_deadline'] ?? null,
            ];
            unset($data['reviewer_notes'], $data['reviewed_by'], $data['reviewed_at'], $data['cv_path']);
            unset($data['vacancy_title'], $data['vacancy_type'], $data['vacancy_commitment'],
                  $data['vacancy_status'], $data['vacancy_location'], $data['vacancy_is_remote'],
                  $data['vacancy_deadline']);
            return $data;
        })->values()->all();

        return [
            'items' => $items,
            'cursor' => $hasMore && $applications->isNotEmpty() ? base64_encode((string) $applications->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get all job vacancies posted by a specific user.
     */
    public function getMyPostings(int $userId, int $_tenantId, array $params = []): array
    {
        $limit = min((int) ($params['limit'] ?? 20), 50);
        $cursor = $params['cursor'] ?? null;

        // $_tenantId kept for API compatibility; tenant scoping is via HasTenantScope
        $query = $this->vacancy->newQuery()
            ->leftJoin('organizations as o', 'job_vacancies.organization_id', '=', 'o.id')
            ->select('job_vacancies.*', 'o.name as organization_name', 'o.logo_url as organization_logo')
            ->where('job_vacancies.user_id', $userId);

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('job_vacancies.id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('job_vacancies.created_at')->orderByDesc('job_vacancies.id');

        $vacancies = $query->limit($limit + 1)->get();
        $hasMore = $vacancies->count() > $limit;
        if ($hasMore) {
            $vacancies->pop();
        }

        $enriched = $this->enrichVacancyBatch($vacancies, $userId);

        return [
            'items' => $enriched,
            'cursor' => $hasMore && $vacancies->isNotEmpty() ? base64_encode((string) $vacancies->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    // =========================================================================
    // ALERTS
    // =========================================================================

    /**
     * Get alerts for a user.
     */
    public function getAlerts(int $userId): array
    {
        return JobAlert::where('user_id', $userId)
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($alert) {
                $data = $alert->toArray();
                $data['id'] = (int) $data['id'];
                $data['user_id'] = (int) $data['user_id'];
                $data['is_active'] = (bool) $data['is_active'];
                $data['is_remote_only'] = (bool) $data['is_remote_only'];
                return $data;
            })
            ->all();
    }

    /**
     * Create a job alert subscription.
     */
    public function subscribeAlert(int $userId, array $data): ?int
    {
        $this->errors = [];

        try {
            $alert = JobAlert::create([
                'tenant_id' => TenantContext::getId(),
                'user_id' => $userId,
                'keywords' => isset($data['keywords']) ? (mb_substr(trim($data['keywords']), 0, 500) ?: null) : null,
                'categories' => isset($data['categories']) ? (mb_substr(trim($data['categories']), 0, 500) ?: null) : null,
                'type' => isset($data['type']) && in_array($data['type'], ['paid', 'volunteer', 'timebank']) ? $data['type'] : null,
                'commitment' => isset($data['commitment']) && in_array($data['commitment'], ['full_time', 'part_time', 'flexible', 'one_off']) ? $data['commitment'] : null,
                'location' => isset($data['location']) ? (mb_substr(trim($data['location']), 0, 500) ?: null) : null,
                'is_remote_only' => !empty($data['is_remote_only']),
                'is_active' => true,
                'created_at' => now(),
            ]);

            return $alert->id;
        } catch (\Throwable $e) {
            Log::error('JobVacancyService::subscribeAlert failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Delete a job alert permanently.
     */
    public function deleteAlert(int $id, int $userId): void
    {
        JobAlert::where('id', $id)->where('user_id', $userId)->delete();
    }

    /**
     * Unsubscribe (deactivate) a job alert.
     */
    public function unsubscribeAlert(int $id, int $userId): void
    {
        JobAlert::where('id', $id)->where('user_id', $userId)->update(['is_active' => false]);
    }

    /**
     * Resubscribe (reactivate) a paused job alert.
     */
    public function resubscribeAlert(int $id, int $userId): void
    {
        JobAlert::where('id', $id)->where('user_id', $userId)->update(['is_active' => true]);
    }

    // =========================================================================
    // SKILLS MATCHING
    // =========================================================================

    /**
     * Calculate match percentage between a user's skills and a job's required skills.
     */
    public function calculateMatchPercentage(int $userId, int $jobId): array
    {
        $user = User::find($userId, ['id', 'skills']);
        $userSkills = [];
        if ($user && !empty($user->skills)) {
            $userSkills = array_filter(array_map(fn ($s) => strtolower(trim($s)), explode(',', $user->skills)));
        }

        $job = $this->vacancy->newQuery()->find($jobId, ['id', 'skills_required']);
        $requiredSkills = [];
        if ($job && !empty($job->skills_required)) {
            $requiredSkills = array_filter(array_map(fn ($s) => strtolower(trim($s)), explode(',', $job->skills_required)));
        }

        if (empty($requiredSkills)) {
            return ['percentage' => 100, 'matched' => [], 'missing' => [], 'user_skills' => $userSkills, 'required_skills' => $requiredSkills];
        }
        if (empty($userSkills)) {
            return ['percentage' => 0, 'matched' => [], 'missing' => $requiredSkills, 'user_skills' => $userSkills, 'required_skills' => $requiredSkills];
        }

        $matched = [];
        $missing = [];

        foreach ($requiredSkills as $required) {
            $isMatched = false;
            foreach ($userSkills as $userSkill) {
                if ($required === $userSkill || str_contains($required, $userSkill) || str_contains($userSkill, $required)) {
                    $matched[] = $required;
                    $isMatched = true;
                    break;
                }
                similar_text($required, $userSkill, $pct);
                if ($pct >= 75) {
                    $matched[] = $required;
                    $isMatched = true;
                    break;
                }
            }
            if (!$isMatched) {
                $missing[] = $required;
            }
        }

        return [
            'percentage' => (int) round((count($matched) / count($requiredSkills)) * 100),
            'matched' => $matched,
            'missing' => $missing,
            'user_skills' => $userSkills,
            'required_skills' => $requiredSkills,
        ];
    }

    /**
     * Get qualification assessment for a user against a job.
     */
    public function getQualificationAssessment(int $userId, int $jobId): ?array
    {
        $this->errors = [];

        $vacancy = $this->legacyGetById($jobId, $userId);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return null;
        }

        $matchData = $this->calculateMatchPercentage($userId, $jobId);

        $breakdown = array_map(fn ($skill) => [
            'skill' => $skill,
            'matched' => in_array($skill, $matchData['matched']),
        ], $matchData['required_skills']);

        $level = 'low';
        if ($matchData['percentage'] >= 80) {
            $level = 'excellent';
        } elseif ($matchData['percentage'] >= 60) {
            $level = 'good';
        } elseif ($matchData['percentage'] >= 40) {
            $level = 'moderate';
        }

        // Commitment match
        $commitmentScore = in_array($vacancy['commitment'] ?? '', ['flexible', 'part_time']) ? 80 : 60;
        $commitmentNotes = ucfirst(str_replace('_', ' ', $vacancy['commitment'] ?? ''));

        // Remote match
        $isRemote = !empty($vacancy['is_remote']);

        // Location distance (Haversine)
        $locationDistanceKm = null;
        if (!empty($vacancy['latitude']) && !empty($vacancy['longitude'])) {
            $user = User::where('id', $userId)->first(['latitude', 'longitude']);
            if ($user && !empty($user->latitude) && !empty($user->longitude)) {
                $earthRadius = 6371;
                $latDiff = deg2rad((float) $vacancy['latitude'] - (float) $user->latitude);
                $lngDiff = deg2rad((float) $vacancy['longitude'] - (float) $user->longitude);
                $a = sin($latDiff / 2) ** 2
                    + cos(deg2rad((float) $user->latitude)) * cos(deg2rad((float) $vacancy['latitude'])) * sin($lngDiff / 2) ** 2;
                $locationDistanceKm = round($earthRadius * 2 * asin(sqrt($a)), 1);
            }
        }

        // Salary transparency
        $salaryDisclosed = !empty($vacancy['salary_min']) || !empty($vacancy['salary_negotiable']);

        return [
            'job_id' => $jobId,
            'job_title' => $vacancy['title'],
            'percentage' => $matchData['percentage'],
            'level' => $level,
            'total_required' => count($matchData['required_skills']),
            'total_matched' => count($matchData['matched']),
            'total_missing' => count($matchData['missing']),
            'breakdown' => $breakdown,
            'matched_skills' => $matchData['matched'],
            'missing_skills' => $matchData['missing'],
            'user_skills' => $matchData['user_skills'],
            'commitment_notes' => $commitmentNotes,
            'remote_available' => $isRemote,
            'location_distance_km' => $locationDistanceKm,
            'salary_disclosed' => $salaryDisclosed,
            'dimensions' => [
                ['label' => 'Skills Match',    'score' => $matchData['percentage'],   'detail' => count($matchData['matched']) . '/' . count($matchData['required_skills']) . ' skills matched'],
                ['label' => 'Remote Work',     'score' => $isRemote ? 100 : 50,       'detail' => $isRemote ? 'Remote position available' : 'On-site role'],
                ['label' => 'Commitment',      'score' => $commitmentScore,           'detail' => $commitmentNotes],
                ['label' => 'Pay Transparency','score' => $salaryDisclosed ? 100 : 50,'detail' => !empty($vacancy['salary_min']) ? 'Salary range disclosed' : 'Salary not specified'],
            ],
            'ai_summary' => self::generateMatchSummary($matchData['percentage'], $matchData['matched'], $matchData['missing'], $vacancy),
        ];
    }

    /**
     * Generate a concise human-readable match summary.
     */
    private static function generateMatchSummary(int $pct, array $matched, array $missing, array $vacancy): string
    {
        $lines = [];
        if ($pct >= 80) {
            $lines[] = "Strong match ({$pct}%).";
        } elseif ($pct >= 50) {
            $lines[] = "Partial match ({$pct}%).";
        } else {
            $lines[] = "Developing match ({$pct}%).";
        }
        if (!empty($matched)) {
            $lines[] = 'You have: ' . implode(', ', array_slice($matched, 0, 5)) . '.';
        }
        if (!empty($missing)) {
            $lines[] = 'To develop: ' . implode(', ', array_slice($missing, 0, 3)) . '.';
        }
        if ($vacancy['is_remote'] ?? false) {
            $lines[] = 'Remote-friendly role.';
        }
        return implode(' ', $lines);
    }

    // =========================================================================
    // APPLICATION HISTORY
    // =========================================================================

    /**
     * Get status history for an application.
     */
    public function getApplicationHistory(int $applicationId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $application = JobApplication::with(['vacancy'])
            ->where('tenant_id', $tenantId)
            ->find($applicationId);
        if (!$application || !$application->vacancy || (int) $application->vacancy->tenant_id !== $tenantId) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_application_not_found')];
            return null;
        }

        // Must be applicant, vacancy owner, hiring-team manager, or admin
        $isApplicant = (int) $application->user_id === $userId;

        if (!$isApplicant && !$this->canManageVacancy((int) $application->vacancy_id, (int) $application->vacancy->user_id, $userId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_access_denied')];
            return null;
        }

        return JobApplicationHistory::with(['changer:id,first_name,last_name,profile_type,organization_name'])
            ->where('application_id', $applicationId)
            ->orderBy('changed_at')
            ->get()
            ->map(function ($entry) use ($isApplicant) {
                $data = $entry->toArray();
                $data['id'] = (int) $data['id'];
                $data['application_id'] = (int) $data['application_id'];
                $data['changed_by_name'] = $entry->changer
                    ? UserDisplayName::resolve($entry->changer)
                    : null;
                if ($isApplicant) {
                    $data['notes'] = null;
                    $data['changed_by'] = null;
                    $data['changed_by_name'] = null;
                }
                unset($data['changer']);
                return $data;
            })
            ->all();
    }

    // =========================================================================
    // ANALYTICS
    // =========================================================================

    /**
     * Get analytics for a job vacancy.
     */
    public function getAnalytics(int $jobId, int $userId): ?array
    {
        $this->errors = [];

        $vacancy = $this->legacyGetById($jobId);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return null;
        }

        $tenantId = TenantContext::getId();

        // Owner, admin, or hiring-team manager
        if (!$this->canManageVacancy($jobId, (int) $vacancy['user_id'], $userId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_access_denied')];
            return null;
        }

        $viewsByDay = DB::table('job_vacancy_views')
            ->where('vacancy_id', $jobId)
            ->where('tenant_id', $tenantId)
            ->where('viewed_at', '>=', now()->subDays(30))
            ->selectRaw('DATE(viewed_at) as date, COUNT(*) as count')
            ->groupBy('date')
            ->orderBy('date')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();

        $uniqueViewers = (int) DB::table('job_vacancy_views')
            ->where('vacancy_id', $jobId)
            ->where('tenant_id', $tenantId)
            ->selectRaw('COUNT(DISTINCT COALESCE(user_id, ip_hash)) as count')
            ->value('count');

        $applicationsByStatus = DB::table('job_vacancy_applications as a')
            ->join('job_vacancies as jv', 'a.vacancy_id', '=', 'jv.id')
            ->where('jv.tenant_id', $tenantId)
            ->where('a.vacancy_id', $jobId)
            ->selectRaw('COALESCE(a.stage, a.status) as stage, COUNT(*) as count')
            ->groupByRaw('COALESCE(a.stage, a.status)')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();

        $totalViews = (int) $vacancy['views_count'];
        $totalApps = (int) $vacancy['applications_count'];
        $conversionRate = $totalViews > 0 ? round(($totalApps / $totalViews) * 100, 1) : 0;

        $avgTimeToApply = DB::table('job_vacancy_applications as a')
            ->join('job_vacancies as jv', 'a.vacancy_id', '=', 'jv.id')
            ->where('a.vacancy_id', $jobId)
            ->selectRaw('AVG(TIMESTAMPDIFF(HOUR, jv.created_at, a.created_at)) as avg_hours')
            ->value('avg_hours');

        $timeToFill = null;
        if ($vacancy['status'] === 'filled') {
            $acceptedAt = JobApplication::where('tenant_id', TenantContext::getId())
                ->where('vacancy_id', $jobId)
                ->where('status', 'accepted')
                ->min('reviewed_at');
            if ($acceptedAt) {
                $timeToFill = (int) ((strtotime($acceptedAt) - strtotime($vacancy['created_at'])) / 86400);
            }
        }

        return [
            'job_id' => $jobId,
            'total_views' => $totalViews,
            'unique_viewers' => $uniqueViewers,
            'total_applications' => $totalApps,
            'conversion_rate' => $conversionRate,
            'avg_time_to_apply_hours' => $avgTimeToApply ? round((float) $avgTimeToApply, 1) : null,
            'time_to_fill_days' => $timeToFill,
            'views_by_day' => $viewsByDay,
            'applications_by_stage' => $applicationsByStatus,
            'created_at' => $vacancy['created_at'],
            'status' => $vacancy['status'],
            'referral_stats' => self::getReferralStats((int) $jobId, $tenantId),
            'scorecard_avg'  => self::getScorecardAvg((int) $jobId, $tenantId),
            'weekly_trend'   => self::getWeeklyApplicationTrend((int) $jobId, $tenantId),
        ];
    }

    private static function getReferralStats(int $jobId, int $tenantId): array
    {
        try {
            $total   = DB::table('job_referrals')->where('tenant_id', $tenantId)->where('vacancy_id', $jobId)->count();
            $applied = DB::table('job_referrals')->where('tenant_id', $tenantId)->where('vacancy_id', $jobId)->where('applied', true)->count();
            return ['total_shares' => $total, 'referral_applications' => $applied, 'referral_conversion_pct' => $total > 0 ? round(($applied / $total) * 100, 1) : 0];
        } catch (\Throwable $e) {
            return ['total_shares' => 0, 'referral_applications' => 0, 'referral_conversion_pct' => 0];
        }
    }

    private static function getScorecardAvg(int $jobId, int $tenantId): ?float
    {
        try {
            $avg = DB::table('job_scorecards')
                ->where('tenant_id', $tenantId)
                ->where('vacancy_id', $jobId)
                ->avg(DB::raw('(total_score / max_score) * 100'));
            return $avg !== null ? round((float) $avg, 1) : null;
        } catch (\Throwable $e) {
            Log::debug('[JobVacancy] getScorecardAvg failed: ' . $e->getMessage());
            return null;
        }
    }

    private static function getWeeklyApplicationTrend(int $jobId, int $tenantId): array
    {
        try {
            return DB::table('job_vacancy_applications')
                ->where('vacancy_id', $jobId)
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', now()->subWeeks(8))
                ->selectRaw('YEARWEEK(created_at, 1) as week, COUNT(*) as count')
                ->groupBy('week')
                ->orderBy('week')
                ->get()
                ->map(fn($r) => (array) $r)
                ->all();
        } catch (\Throwable $e) {
            Log::debug('[JobVacancy] getWeeklyApplicationTrend failed: ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // JOB RENEWAL
    // =========================================================================

    /**
     * Renew a job vacancy (extend deadline).
     */
    public function renewJob(int $id, int $userId, int $days = 30): bool
    {
        $this->errors = [];

        $vacancy = $this->vacancy->newQuery()->find($id);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return false;
        }

        // Check ownership or admin
        if ((int) $vacancy->user_id !== $userId && !$this->isAdminUser($userId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_renew_not_owner')];
            return false;
        }

        try {
            $baseDate = ($vacancy->deadline && $vacancy->deadline->isFuture())
                ? $vacancy->deadline
                : now();
            $newDeadline = $baseDate->copy()->addDays($days);

            $vacancy->update([
                'deadline' => $newDeadline,
                'status' => 'open',
                'expired_at' => null,
                'renewed_at' => now(),
                'renewal_count' => ($vacancy->renewal_count ?? 0) + 1,
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::error("JobVacancyService::renewJob failed: " . $e->getMessage());
            return false;
        }
    }

    // =========================================================================
    // RECOMMENDED JOBS
    // =========================================================================

    /**
     * Get recommended job vacancies for a user based on skills matching.
     *
     * Recommends open jobs where skills_required overlaps with the user's skills.
     * Excludes jobs the user has already applied to, and jobs posted by the user.
     * Orders by match score descending, then by newest first.
     */
    public function getRecommended(int $userId, int $limit = 10): array
    {
        $tenantId = TenantContext::getId();
        $limit = max(1, min(20, $limit));

        // 1. Get the user's skills (comma-separated string on users.skills column)
        $user = User::find($userId, ['id', 'skills']);
        $userSkills = [];
        if ($user && !empty($user->skills)) {
            $userSkills = array_values(array_filter(array_map(fn ($s) => strtolower(trim($s)), explode(',', $user->skills))));
        }

        // 2. Get open vacancies in this tenant, excluding applied-to and own postings
        $appliedIds = JobApplication::where('tenant_id', TenantContext::getId())
            ->where('user_id', $userId)
            ->pluck('vacancy_id')
            ->toArray();

        $query = $this->vacancy->newQuery()
            ->leftJoin('organizations as o', 'job_vacancies.organization_id', '=', 'o.id')
            ->select('job_vacancies.*', 'o.name as organization_name', 'o.logo_url as organization_logo')
            ->where('job_vacancies.user_id', '!=', $userId);

        $this->applyPublicVisibility($query);

        if (!empty($appliedIds)) {
            $query->whereNotIn('job_vacancies.id', $appliedIds);
        }

        $vacancies = $query->orderByRaw(
            '(CASE WHEN job_vacancies.is_featured = 1 AND (job_vacancies.featured_until IS NULL OR job_vacancies.featured_until > NOW()) THEN 0 ELSE 1 END) ASC'
        )
            ->orderByDesc('job_vacancies.created_at')
            ->limit(200) // Fetch a wider set for scoring, then trim to $limit
            ->get();

        if ($vacancies->isEmpty()) {
            return [];
        }

        // 3. Batch-enrich all vacancies (2 queries instead of 2×N)
        $enrichedList = $this->enrichVacancyBatch($vacancies, $userId);

        // 4. Score each vacancy by skill overlap, using same fuzzy matching as calculateMatchPercentage()
        $scored = collect($enrichedList)->map(function (array $data) use ($userSkills) {
            $requiredSkills = $data['skills'] ?? [];
            $requiredSkills = array_map('strtolower', $requiredSkills);

            $score = 0;
            if (!empty($requiredSkills) && !empty($userSkills)) {
                $matched = 0;
                foreach ($requiredSkills as $required) {
                    foreach ($userSkills as $userSkill) {
                        if ($required === $userSkill || str_contains($required, $userSkill) || str_contains($userSkill, $required)) {
                            $matched++;
                            break;
                        }
                        similar_text($required, $userSkill, $pct);
                        if ($pct >= 75) {
                            $matched++;
                            break;
                        }
                    }
                }
                $score = (int) round(($matched / count($requiredSkills)) * 100);
            } elseif (empty($requiredSkills)) {
                // No required skills — neutral score so it can still appear
                $score = 50;
            }

            $data['match_score'] = $score;
            return $data;
        });

        // 5. Sort by match_score DESC (jobs with higher skill overlap first)
        $sorted = $scored->sortByDesc('match_score')->values()->take($limit)->all();

        return $sorted;
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Enrich a vacancy model/row with creator info, skills array, and application status.
     */
    private function enrichVacancy($vacancy, ?int $userId = null): array
    {
        $data = is_array($vacancy) ? $vacancy : $vacancy->toArray();
        return $this->enrichVacancyArray($data, $userId);
    }

    /**
     * Batch-enrich a collection of vacancies, pre-fetching applied/saved status in 2 queries instead of 2×N.
     *
     * @param \Illuminate\Support\Collection $items Collection of vacancy models/rows
     * @param int|null $userId Authenticated user ID (null = skip applied/saved checks)
     * @return array[] Enriched vacancy arrays
     */
    private function enrichVacancyBatch($items, ?int $userId = null): array
    {
        $ids = $items->pluck('id')->filter()->map(fn ($id) => (int) $id)->all();

        $appliedMap = [];
        $savedSet = [];

        if ($userId && !empty($ids)) {
            $tenantId = TenantContext::getId();

            // Batch: user's applications for these vacancies
            $applications = DB::table('job_vacancy_applications as jva')
                ->join('job_vacancies as jv', 'jva.vacancy_id', '=', 'jv.id')
                ->where('jv.tenant_id', $tenantId)
                ->whereIn('jva.vacancy_id', $ids)
                ->where('jva.user_id', $userId)
                ->select('jva.id', 'jva.vacancy_id', 'jva.status', 'jva.stage')
                ->get();

            foreach ($applications as $app) {
                $appliedMap[(int) $app->vacancy_id] = $app;
            }

            // Batch: user's saved jobs for these vacancies
            $savedSet = SavedJob::whereIn('job_id', $ids)
                ->where('user_id', $userId)
                ->pluck('job_id')
                ->map(fn ($id) => (int) $id)
                ->flip()
                ->all();
        }

        return $items->map(fn ($item) => $this->enrichVacancyArray(
            is_array($item) ? $item : $item->toArray(),
            $userId,
            $appliedMap,
            $savedSet,
        ))->values()->all();
    }

    /**
     * Enrich a vacancy array with formatted fields.
     *
     * @param array|null $appliedMap Pre-fetched applied status keyed by vacancy_id (null = query per row)
     * @param array|null $savedSet Pre-fetched saved job_ids as keys (null = query per row)
     */
    private function enrichVacancyArray(array $data, ?int $userId = null, ?array $appliedMap = null, ?array $savedSet = null): array
    {
        // Format creator info
        $data['creator'] = [
            'id' => (int) ($data['user_id'] ?? 0),
            // Two shapes reach here: flat `creator_*` join aliases, or a nested
            // `creator` array. Resolve the prefixed form first and fall back.
            'name' => UserDisplayName::resolvePrefixed($data, 'creator_')
                ?: UserDisplayName::resolve($data['creator'] ?? null),
            'avatar_url' => $data['creator_avatar'] ?? $data['creator']['avatar_url'] ?? null,
        ];

        // Format organization info
        if (!empty($data['organization_id'])) {
            $data['organization'] = [
                'id' => (int) $data['organization_id'],
                'name' => $data['organization_name'] ?? null,
                'logo_url' => $data['organization_logo'] ?? null,
            ];
        } else {
            $data['organization'] = null;
        }

        // Parse skills as array
        $data['skills'] = !empty($data['skills_required'])
            ? array_map('trim', explode(',', $data['skills_required']))
            : [];

        // Cast numeric fields
        $data['id'] = (int) ($data['id'] ?? 0);
        $data['tenant_id'] = (int) ($data['tenant_id'] ?? 0);
        $data['user_id'] = (int) ($data['user_id'] ?? 0);
        $data['views_count'] = (int) ($data['views_count'] ?? 0);
        $data['applications_count'] = (int) ($data['applications_count'] ?? 0);
        $data['is_remote'] = (bool) ($data['is_remote'] ?? false);
        $data['is_featured'] = (bool) ($data['is_featured'] ?? false);
        $data['salary_negotiable'] = (bool) ($data['salary_negotiable'] ?? false);
        $data['renewal_count'] = (int) ($data['renewal_count'] ?? 0);
        $data['blind_hiring'] = (bool) ($data['blind_hiring'] ?? false);

        // Auto-expire featured status
        if ($data['is_featured'] && !empty($data['featured_until']) && strtotime($data['featured_until']) < time()) {
            $data['is_featured'] = false;
        }

        // Check if user has applied / saved
        if ($userId) {
            if ($appliedMap !== null) {
                // Batch mode — use pre-fetched data (no extra queries)
                $application = $appliedMap[$data['id']] ?? null;
            } else {
                // Single-item mode — query per row (used by getById/legacyGetById)
                $application = DB::table('job_vacancy_applications as jva')
                    ->join('job_vacancies as jv', 'jva.vacancy_id', '=', 'jv.id')
                    ->where('jv.tenant_id', $data['tenant_id'])
                    ->where('jva.vacancy_id', $data['id'])
                    ->where('jva.user_id', $userId)
                    ->select('jva.id', 'jva.status', 'jva.stage')
                    ->first();
            }

            $data['has_applied'] = !empty($application);
            $data['application_id'] = $application ? (int) $application->id : null;
            $data['application_status'] = $application->status ?? null;
            $data['application_stage'] = $application->stage ?? $application->status ?? null;

            if ($savedSet !== null) {
                // Batch mode
                $data['is_saved'] = isset($savedSet[$data['id']]);
            } else {
                // Single-item mode
                $data['is_saved'] = SavedJob::where('job_id', $data['id'])
                    ->where('user_id', $userId)
                    ->exists();
            }
        } else {
            $data['has_applied'] = false;
            $data['application_status'] = null;
            $data['application_stage'] = null;
            $data['is_saved'] = false;
        }

        // Clean up redundant fields
        unset(
            $data['creator_first_name'],
            $data['creator_last_name'],
            $data['creator_avatar'],
            $data['organization_name'],
            $data['organization_logo'],
            $data['saved_id']
        );

        return $data;
    }

    /**
     * Log an application status change to history.
     */
    private function logApplicationHistory(int $applicationId, ?string $fromStatus, string $toStatus, int $changedBy, ?string $notes = null): void
    {
        try {
            JobApplicationHistory::create([
                'application_id' => $applicationId,
                'from_status' => $fromStatus,
                'to_status' => $toStatus,
                'changed_by' => $changedBy,
                'changed_at' => now(),
                'notes' => $notes ? trim($notes) : null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('JobVacancyService: Failed to log application history: ' . $e->getMessage());
        }
    }

    /**
     * Parse a boolean search query into LIKE clauses.
     * Supports AND (space / +), OR (|), NOT (-word).
     * Returns ['must' => [], 'should' => [], 'not' => []]
     */
    private static function parseBooleanQuery(string $query): array
    {
        $must   = [];
        $should = [];
        $not    = [];

        // Split on | for OR groups
        $orParts = array_map('trim', explode('|', $query));

        foreach ($orParts as $part) {
            // Split on spaces/+ for AND terms within this OR group
            $terms = preg_split('/[\s+]+/', trim($part), -1, PREG_SPLIT_NO_EMPTY);
            foreach ($terms as $term) {
                if (str_starts_with($term, '-') && strlen($term) > 1) {
                    $not[] = substr($term, 1);
                } elseif (count($orParts) > 1) {
                    $should[] = $term;
                } else {
                    $must[] = $term;
                }
            }
        }

        return ['must' => $must, 'should' => $should, 'not' => $not];
    }

    // =========================================================================
    // CSV EXPORT
    // =========================================================================

    /**
     * Export applications for a vacancy as CSV string.
     */
    public function exportApplicationsCsv(int $jobId, int $userId): ?string
    {
        $this->errors = [];
        $vacancy = $this->legacyGetById($jobId);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return null;
        }
        $tenantId = TenantContext::getId();
        if (!$this->canManageVacancy($jobId, (int) $vacancy['user_id'], $userId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_access_denied')];
            return null;
        }

        $apps = JobApplication::with(['applicant:id,first_name,last_name,profile_type,organization_name,email'])
            ->where('tenant_id', $tenantId)
            ->where('vacancy_id', $jobId)
            ->orderBy('created_at')
            ->get();

        // CSV injection prevention helper
        $sanitize = function (mixed $v): mixed {
            return is_string($v) && preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
        };

        $rows = [['ID', 'Name', 'Email', 'Status', 'Stage', 'Applied At', 'Updated At']];
        foreach ($apps as $app) {
            $rows[] = array_map($sanitize, [
                $app->id,
                UserDisplayName::resolve($app->applicant),
                $app->applicant->email ?? '',
                $app->status,
                $app->stage ?? $app->status,
                $app->created_at?->toDateTimeString() ?? '',
                $app->updated_at?->toDateTimeString() ?? '',
            ]);
        }

        $out = fopen('php://temp', 'r+');
        foreach ($rows as $row) {
            fputcsv($out, $row);
        }
        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);
        return $csv;
    }

    /**
     * Bulk update application statuses (employer only).
     *
     * @param int   $vacancyId
     * @param int   $userId       Must be the vacancy owner.
     * @param int[] $applicationIds
     * @param string $newStatus   e.g. 'rejected', 'screening', 'reviewed'
     * @return int  Number of records updated.
     */
    public function bulkUpdateApplicationStatus(int $vacancyId, int $userId, array $applicationIds, string $newStatus): int
    {
        $this->errors = [];
        $tenantId     = TenantContext::getId();

        $vacancy = $this->legacyGetById($vacancyId);
        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return 0;
        }
        if (!$this->canManageVacancy($vacancyId, (int) $vacancy['user_id'], $userId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_access_denied')];
            return 0;
        }

        $allowed = ['applied','pending','screening','reviewed','shortlisted','interview','offer','accepted','rejected','withdrawn'];
        if (!in_array($newStatus, $allowed, true)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.job_status_invalid')];
            return 0;
        }

        // Resolve the IDs that genuinely belong to this vacancy, then route each through
        // the single-update path so the terminal-state guard, status history, and
        // locale-aware applicant notifications all apply. Applications already in a
        // terminal state are skipped (not counted), matching the single-update contract.
        $validIds = JobApplication::where('tenant_id', $tenantId)
            ->where('vacancy_id', $vacancyId)
            ->whereIn('id', array_map('intval', $applicationIds))
            ->pluck('id')
            ->all();

        $updated = 0;
        foreach ($validIds as $appId) {
            if ($this->updateApplicationStatus((int) $appId, $userId, $newStatus)) {
                $updated++;
            }
        }

        // Per-application skips (e.g. terminal-state) are expected in bulk; don't surface
        // them as a hard error — the caller reports the number actually updated.
        $this->errors = [];

        // Fire one aggregate webhook for the bulk action.
        try {
            \App\Services\WebhookDispatchService::dispatch('job.application.bulk_status_changed', [
                'vacancy_id'      => $vacancyId,
                'application_ids' => $applicationIds,
                'new_status'      => $newStatus,
                'tenant_id'       => $tenantId,
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Bulk status webhook failed: ' . $e->getMessage());
        }

        return $updated;
    }

    // =====================================================================
    // DUPLICATE DETECTION (Agent A)
    // =====================================================================

    /**
     * Find similar job vacancies based on title word matching.
     *
     * Compares individual words from the input title against open/draft
     * job vacancy titles within the same tenant (and optionally organization).
     * Returns matches sorted by similarity score (descending).
     *
     * @return array<int, array{id: int, title: string, status: string, similarity: float, created_at: string}>
     */
    public function findSimilarJobs(string $title, ?int $orgId, int $tenantId): array
    {
        // Extract meaningful words (3+ chars, lowercased)
        $words = array_filter(
            array_map('strtolower', preg_split('/\s+/', trim($title))),
            fn (string $w) => strlen($w) >= 3
        );

        if (empty($words)) {
            return [];
        }

        // Build query for open/draft jobs in the same tenant
        $query = DB::table('job_vacancies')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['open', 'draft'])
            ->select(['id', 'title', 'status', 'created_at']);

        if ($orgId !== null) {
            $query->where('organization_id', $orgId);
        }

        // Filter to rows that match at least one word
        $query->where(function ($q) use ($words) {
            foreach ($words as $word) {
                $q->orWhere('title', 'LIKE', '%' . $word . '%');
            }
        });

        $candidates = $query->orderByDesc('created_at')->limit(20)->get();

        $results = [];
        $totalWords = count($words);

        foreach ($candidates as $row) {
            $candidateTitle = strtolower($row->title);
            $matchCount = 0;

            foreach ($words as $word) {
                if (str_contains($candidateTitle, $word)) {
                    $matchCount++;
                }
            }

            $similarity = round($matchCount / $totalWords, 2);

            // Only include results with >= 40% word overlap
            if ($similarity >= 0.4) {
                $results[] = [
                    'id' => $row->id,
                    'title' => $row->title,
                    'status' => $row->status,
                    'similarity' => $similarity,
                    'created_at' => $row->created_at,
                ];
            }
        }

        // Sort by similarity descending
        usort($results, fn ($a, $b) => $b['similarity'] <=> $a['similarity']);

        return array_slice($results, 0, 5);
    }
}
