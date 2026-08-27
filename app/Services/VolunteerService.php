<?php
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Events\VolLogStatusChanged;
use App\Events\VolunteerOpportunityCreated;
use App\Events\VolunteerOpportunityUpdated;
use App\I18n\LocaleContext;
use App\Models\VolApplication;
use App\Models\VolLog;
use App\Models\VolOpportunity;
use App\Models\VolOrganization;
use App\Models\VolShift;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * VolunteerService — Laravel DI-based service for volunteering operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class VolunteerService
{
    public const PUBLIC_OPPORTUNITY_STATUSES = ['open', 'active'];
    public const PUBLIC_ORGANIZATION_STATUSES = ['approved', 'active'];

    public function __construct(
        private readonly VolOpportunity $opportunity,
        private readonly VolApplication $application,
    ) {}

    /** In-process memo for the cached is_federated schema probe. */
    private static ?bool $isFederatedColumnMemo = null;

    /**
     * Whether vol_opportunities has the federation `is_federated` column.
     * Cached (in-process + 1h shared cache) because this sat on the hottest
     * read paths (getOpportunities / suggestOpportunities) and ran an
     * information_schema round-trip on every request.
     */
    public static function opportunitiesHaveFederatedColumn(): bool
    {
        if (self::$isFederatedColumnMemo !== null) {
            return self::$isFederatedColumnMemo;
        }

        self::$isFederatedColumnMemo = (bool) Cache::remember(
            'schema:vol_opportunities:is_federated',
            3600,
            static fn (): bool => Schema::hasColumn('vol_opportunities', 'is_federated')
        );

        return self::$isFederatedColumnMemo;
    }

    /**
     * Get active volunteer opportunities with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getOpportunities(array $filters = []): array
    {
        $tenantId = self::getTenantId();
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        $viewerId = !empty($filters['viewer_id']) ? (int) $filters['viewer_id'] : null;

        $federationColumnExists = self::opportunitiesHaveFederatedColumn();

        $query = VolOpportunity::query()
            ->with(['creator:id,first_name,last_name,profile_type,organization_name,avatar_url', 'organization:id,name,logo_url', 'category:id,name,color'])
            ->where('is_active', true)
            ->whereIn('status', self::PUBLIC_OPPORTUNITY_STATUSES)
            ->where(function (Builder $outer) use ($federationColumnExists) {
                $outer->whereHas('organization', function (Builder $q) {
                    $q->whereIn('status', self::PUBLIC_ORGANIZATION_STATUSES);
                });
                // Federated (imported) opportunities carry no local organisation
                // row — they were vetted at the partner and are gated by
                // is_federated — but whereHas(organization) would otherwise hide
                // them from the very listing they were mirrored in for.
                if ($federationColumnExists) {
                    $outer->orWhere('vol_opportunities.is_federated', 1);
                }
            });

        if (! empty($filters['organization_id'])) {
            $query->where('organization_id', (int) $filters['organization_id']);
        }

        if (! empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        if (!empty($filters['is_remote'])) {
            $query->where('is_remote', true);
        }

        if (! empty($filters['search'])) {
            // Escape LIKE wildcards so user input is matched literally.
            $term = '%' . addcslashes((string) $filters['search'], '%_\\') . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term)
                  ->orWhere('location', 'LIKE', $term)
                  ->orWhere('skills_needed', 'LIKE', $term)
                  ->orWhereHas('organization', function (Builder $orgQuery) use ($term) {
                      $orgQuery->where('name', 'LIKE', $term);
                  })
                  ->orWhereHas('category', function (Builder $categoryQuery) use ($term) {
                      $categoryQuery->where('name', 'LIKE', $term);
                  });
            });
        }

        // Proximity / radius filter using Haversine formula
        $nearLat = isset($filters['near_lat']) ? (float) $filters['near_lat'] : null;
        $nearLng = isset($filters['near_lng']) ? (float) $filters['near_lng'] : null;
        $radiusKm = isset($filters['radius_km']) ? (float) $filters['radius_km'] : null;
        $proximity = $nearLat !== null && $nearLng !== null && $radiusKm !== null;

        $decodedCursor = is_string($cursor) ? base64_decode($cursor, true) : false;

        if ($proximity) {
            $haversine = "(6371 * acos(LEAST(1.0, GREATEST(-1.0,
                cos(radians(?)) * cos(radians(vol_opportunities.latitude)) * cos(radians(vol_opportunities.longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(vol_opportunities.latitude))
            ))))";
            // distance_km is rounded to 6 decimal places (sub-metre precision)
            // in the SELECT itself so the ORDER BY, the HAVING radius filter,
            // and the keyset-cursor comparison below all share one exact value
            // — comparing a rounded cursor against the raw float expression
            // skipped/repeated rows at page boundaries.
            $query->whereNotNull('vol_opportunities.latitude')
                  ->whereNotNull('vol_opportunities.longitude')
                  ->selectRaw("vol_opportunities.*, ROUND({$haversine}, 6) AS distance_km", [$nearLat, $nearLng, $nearLat])
                  ->having('distance_km', '<=', $radiusKm)
                  ->orderBy('distance_km')
                  ->orderBy('id');

            // Distance ordering needs a (distance, id) keyset cursor — an
            // id-based one would skip/repeat items across pages. distance_km
            // is already ROUND(..., 6) in the SELECT, and the cursor encodes
            // the same rounded value, so this boundary comparison is exact.
            if ($decodedCursor !== false && str_starts_with($decodedCursor, 'D:') && str_contains($decodedCursor, '|')) {
                [$lastDistance, $lastId] = explode('|', substr($decodedCursor, 2), 2);
                $roundedLastDistance = round((float) $lastDistance, 6);
                $query->havingRaw(
                    '(distance_km > ?) OR (distance_km = ? AND vol_opportunities.id > ?)',
                    [$roundedLastDistance, $roundedLastDistance, (int) $lastId]
                );
            }
        } else {
            if ($decodedCursor !== false && is_numeric($decodedCursor)) {
                $query->where('id', '<', (int) $decodedCursor);
            }
            $query->orderByDesc('id');
        }

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $appliedOpportunityIds = [];
        if ($viewerId && $items->isNotEmpty()) {
            $appliedOpportunityIds = VolApplication::query()
                ->where('tenant_id', $tenantId)
                ->where('user_id', $viewerId)
                ->whereIn('status', ['pending', 'approved'])
                ->whereIn('opportunity_id', $items->pluck('id')->all())
                ->pluck('opportunity_id')
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        $results = $items->map(function ($opp) use ($appliedOpportunityIds) {
            $data = $opp->toArray();
            // Do not expose the creator's internal user id on the public/browse
            // list (mirrors the org directory's owner-id stripping); name + avatar
            // remain for display. The eager-load keeps `id` so Eloquent can hydrate
            // the belongsTo relation — it is stripped here, after serialization.
            if (isset($data['creator']) && is_array($data['creator'])) {
                unset($data['creator']['id']);
            }
            $data['is_remote'] = (bool) ($opp->is_remote ?? false);
            $data['has_applied'] = in_array((int) $opp->id, $appliedOpportunityIds, true);
            if (isset($opp->distance_km)) {
                $data['distance_km'] = round((float) $opp->distance_km, 2);
            }
            return $data;
        })->all();

        $nextCursor = null;
        if ($hasMore && $items->isNotEmpty()) {
            $last = $items->last();
            // Round to the same 6 decimal places the SQL boundary comparison
            // uses so page-boundary rows are neither skipped nor repeated.
            $nextCursor = $proximity
                ? base64_encode('D:' . round((float) $last->distance_km, 6) . '|' . $last->id)
                : base64_encode((string) $last->id);
        }

        return [
            'items'    => array_values($results),
            'cursor'   => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single opportunity by ID.
     */
    public static function getById(int $id): ?VolOpportunity
    {
        return VolOpportunity::query()
            ->with(['creator', 'organization', 'category', 'shifts', 'applications'])
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->first();
    }

    /**
     * Create a new volunteer opportunity.
     */
    public static function createOpportunity(int $userId, array $data): ?VolOpportunity
    {
        self::$errors = [];
        $tenantId = self::getTenantId();
        $organizationId = isset($data['organization_id']) ? (int) $data['organization_id'] : 0;

        if ($organizationId <= 0) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_organization_required'), 'field' => 'organization_id'];
            return null;
        }

        $organization = DB::selectOne(
            "SELECT id, user_id, status FROM vol_organizations WHERE id = ? AND tenant_id = ?",
            [$organizationId, $tenantId]
        );

        if (!$organization || !self::isApprovedOrganizationStatus($organization->status ?? null)) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.organization_not_found'), 'field' => 'organization_id'];
            return null;
        }

        if (!self::canManageOrganization((array) $organization, $userId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_org_manage_forbidden'), 'field' => 'organization_id'];
            return null;
        }

        $categoryId = !empty($data['category_id']) ? (int) $data['category_id'] : null;
        if ($categoryId !== null) {
            $categoryQuery = "SELECT id FROM categories WHERE id = ?";
            $categoryParams = [$categoryId];
            if (Schema::hasColumn('categories', 'tenant_id')) {
                $categoryQuery .= " AND (tenant_id = ? OR tenant_id IS NULL)";
                $categoryParams[] = $tenantId;
            }
            $categoryQuery .= " LIMIT 1";

            if (!DB::selectOne($categoryQuery, $categoryParams)) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.category_not_found'), 'field' => 'category_id'];
                return null;
            }
        }

        $opportunityData = [
            'created_by'      => $userId,
            'organization_id' => $organizationId,
            'title'           => trim($data['title'] ?? ''),
            'description'     => trim($data['description'] ?? ''),
            'location'        => trim($data['location'] ?? ''),
            'is_remote'       => !empty($data['is_remote']),
            'latitude'        => isset($data['latitude']) && is_numeric($data['latitude']) ? (float) $data['latitude'] : null,
            'longitude'       => isset($data['longitude']) && is_numeric($data['longitude']) ? (float) $data['longitude'] : null,
            'skills_needed'   => trim($data['skills_needed'] ?? ''),
            'start_date'      => $data['start_date'] ?? null,
            'end_date'        => $data['end_date'] ?? null,
            'category_id'     => $categoryId,
            'status'          => 'active',
            'is_active'       => true,
        ];

        if (Schema::hasColumn('vol_opportunities', 'federated_visibility')) {
            $opportunityData['federated_visibility'] = self::sanitizeFederatedVisibility($data['federated_visibility'] ?? null);
        }

        $opportunity = VolOpportunity::unguarded(
            fn () => VolOpportunity::create($opportunityData)
        );

        $opportunity->save();

        $fresh = $opportunity->fresh(['creator', 'organization', 'category']);

        try {
            TenantContext::runForTenant($tenantId, function () use ($fresh, $opportunity, $tenantId): void {
                VolunteerOpportunityCreated::dispatch($fresh ?? $opportunity, (int) $tenantId);
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to dispatch VolunteerOpportunityCreated', [
                'opportunity_id' => $opportunity->id ?? null,
                'error'          => $e->getMessage(),
            ]);
        }

        return $fresh ?? $opportunity;
    }

    /**
     * Apply to a volunteer opportunity.
     */
    /**
     * Whether the guardian-consent safeguarding gate BLOCKS this user from
     * taking part in the given opportunity. True only when the tenant requires
     * guardian consent, the user is a minor (by date_of_birth), and no active
     * consent exists. Centralised here so EVERY entry path — the React apply/
     * signup controllers, the accessible (GOV.UK) frontend, and group
     * reservations — enforces the same gate; previously it lived only in
     * VolunteerController and any direct service caller silently skipped it,
     * letting a minor take part without consent via the accessible frontend or
     * by being added to a group reservation.
     */
    public static function guardianConsentBlocks(int $userId, int $opportunityId): bool
    {
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED, false)) {
            return false;
        }

        return \App\Services\GuardianConsentService::isMinor($userId)
            && ! \App\Services\GuardianConsentService::checkConsent($userId, $opportunityId);
    }

    public static function apply(int $opportunityId, int $userId, array $data = []): VolApplication
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        // Verify opportunity exists and is active within the current tenant
        $opportunity = VolOpportunity::where('id', $opportunityId)
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->whereIn('status', ['open', 'active'])
            ->whereHas('organization', function (Builder $q) {
                $q->whereIn('status', ['approved', 'active']);
            })
            ->first();

        if (!$opportunity) {
            throw new \RuntimeException(__('api.volunteer_opportunity_not_active'), 404);
        }

        // Safeguarding: minors need an active guardian consent. Enforced in the
        // service so the accessible frontend (which calls apply() directly) and
        // any other caller cannot bypass the controller-level gate.
        if (self::guardianConsentBlocks($userId, $opportunityId)) {
            throw new \RuntimeException(__('api.guardian_consent_required'), 403);
        }

        // Creators cannot apply to their own opportunity
        if ((int) ($opportunity->created_by ?? 0) === $userId) {
            throw new \RuntimeException(__('api.volunteer_cannot_apply_own'), 422);
        }

        $organizerId = (int) ($opportunity->created_by ?? 0);
        if ($organizerId <= 0) {
            $organizerId = (int) DB::table('vol_organizations')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $opportunity->organization_id)
                ->value('user_id');
        }
        if ($organizerId > 0 && $organizerId !== $userId) {
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $userId,
                $organizerId,
                $tenantId,
                'volunteer_application',
            );
        }

        // Serialise the duplicate-check + insert under an atomic lock keyed on
        // the natural duplicate key (same pattern as logHours). vol_applications
        // has no unique key on (opportunity_id, user_id) — declined rows may
        // legitimately repeat — so without this lock two concurrent identical
        // submissions both pass the existence check and double-insert.
        $dupLock = Cache::lock(sprintf('vol_apply_dedupe:%d:%d:%d', $tenantId, $opportunityId, $userId), 10);
        if (! $dupLock->get()) {
            // A concurrent identical submission already holds the lock.
            throw new \RuntimeException(__('api.already_applied'), 409);
        }

        try {
            // Prevent duplicate applications
            $existing = VolApplication::where('opportunity_id', $opportunityId)
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['pending', 'approved'])
                ->exists();

            if ($existing) {
                throw new \RuntimeException(__('api.already_applied'), 409);
            }

            $initialStatus = VolunteeringConfigurationService::get(
                VolunteeringConfigurationService::CONFIG_AUTO_APPROVE_APPLICATIONS,
                false
            ) ? 'approved' : 'pending';

            $shiftId = !empty($data['shift_id']) ? (int) $data['shift_id'] : null;

            return DB::transaction(function () use ($shiftId, $opportunityId, $tenantId, $userId, $data, $initialStatus) {
                if ($shiftId !== null) {
                    $shift = self::getShiftContext($shiftId, $tenantId, true);

                    if (!$shift || (int) $shift->opportunity_id !== $opportunityId) {
                        throw new \RuntimeException(__('api.volunteer_shift_not_found'), 404);
                    }

                    if (! self::isPublicShiftContext($shift)) {
                        throw new \RuntimeException(__('api.volunteer_opportunity_not_active'), 404);
                    }

                    if (strtotime((string) $shift->start_time) < time()) {
                        throw new \RuntimeException(__('api.volunteer_shift_started'), 422);
                    }

                    $capacity = $shift->capacity !== null ? (int) $shift->capacity : null;
                    if (! VolunteerShiftCapacityService::hasAvailableSlot($shiftId, $tenantId, $capacity)) {
                        throw new \RuntimeException(__('api.volunteer_shift_at_capacity'), 422);
                    }
                }

                $application = VolApplication::create([
                    'opportunity_id' => $opportunityId,
                    'user_id'        => $userId,
                    'message'        => trim($data['message'] ?? ''),
                    'shift_id'       => $shiftId,
                ]);

                $application->forceFill(['status' => $initialStatus]);
                $application->save();

                return $application->fresh(['user', 'opportunity']);
            });
        } finally {
            $dupLock->release();
        }
    }

    /**
     * Get applications submitted by a user with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getMyApplications(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursorId = self::decodeCursor($filters['cursor'] ?? null);
        $tenantId = self::getTenantId();

        $query = DB::table('vol_applications as a')
            ->join('vol_opportunities as o', function ($join) {
                $join->on('a.opportunity_id', '=', 'o.id')
                    ->whereColumn('o.tenant_id', 'a.tenant_id');
            })
            ->leftJoin('vol_organizations as org', function ($join) {
                $join->on('o.organization_id', '=', 'org.id')
                    ->whereColumn('org.tenant_id', 'a.tenant_id');
            })
            ->leftJoin('vol_shifts as s', function ($join) {
                $join->on('a.shift_id', '=', 's.id')
                    ->whereColumn('s.tenant_id', 'a.tenant_id');
            })
            ->where('a.user_id', $userId)
            ->where('a.tenant_id', $tenantId)
            ->select([
                'a.id',
                'a.status',
                'a.message',
                'a.org_note',
                'a.shift_id',
                'a.created_at',
                'o.id as opportunity_id',
                'o.title as opportunity_title',
                'o.location as opportunity_location',
                'org.id as organization_id',
                'org.name as organization_name',
                'org.logo_url as organization_logo_url',
                's.start_time as shift_start_time',
                's.end_time as shift_end_time',
            ]);

        if (!empty($filters['status']) && in_array($filters['status'], ['pending', 'approved', 'declined', 'withdrawn'], true)) {
            $query->where('a.status', $filters['status']);
        }

        if ($cursorId) {
            $query->where('a.id', '<', $cursorId);
        }

        $query->orderByDesc('a.id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $results = $items->map(fn ($row) => [
            'id' => (int) $row->id,
            'status' => $row->status,
            'message' => $row->message ?? '',
            'org_note' => $row->org_note ?? null,
            'opportunity' => [
                'id' => (int) $row->opportunity_id,
                'title' => $row->opportunity_title,
                'location' => $row->opportunity_location ?? '',
            ],
            'organization' => [
                'id' => $row->organization_id ? (int) $row->organization_id : 0,
                'name' => $row->organization_name ?? '',
                'logo_url' => $row->organization_logo_url ?? null,
            ],
            'shift' => $row->shift_id ? [
                'id' => (int) $row->shift_id,
                'start_time' => $row->shift_start_time,
                'end_time' => $row->shift_end_time,
            ] : null,
            'created_at' => $row->created_at,
        ])->all();

        return [
            'items'    => array_values($results),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get shifts the user is signed up for with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getMyShifts(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        $tenantId = TenantContext::getId();

        $query = DB::table('vol_applications as a')
            ->join('vol_shifts as s', function ($join) {
                $join->on('a.shift_id', '=', 's.id')
                    ->on('a.tenant_id', '=', 's.tenant_id');
            })
            ->join('vol_opportunities as o', function ($join) {
                $join->on('s.opportunity_id', '=', 'o.id')
                    ->on('s.tenant_id', '=', 'o.tenant_id');
            })
            ->where('a.user_id', $userId)
            ->where('a.status', 'approved')
            ->where('a.tenant_id', $tenantId)
            ->whereNotNull('a.shift_id')
            // Exclude shifts of cancelled (soft-deleted) opportunities — a
            // cancelled opportunity keeps is_active=0 but its shifts survive.
            ->where('o.is_active', 1)
            ->select('s.*', 'o.title as opportunity_title', 'o.location', 'a.id as application_id');

        if (is_string($cursor) && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('s.id', '<', (int) $cid);
        }

        $query->orderByDesc('s.id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->map(fn ($i) => (array) $i)->all(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get logged hours for a user with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getMyHours(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        $query = VolLog::query()
            ->with(['organization:id,name', 'opportunity:id,title'])
            ->where('user_id', $userId);

        if (is_string($cursor) && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get hours summary/stats for a user.
     */
    public static function getHoursSummary(int $userId): array
    {
        $tenantId = self::getTenantId();

        $total = VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->sum('hours');

        $pending = VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->sum('hours');

        $declineStatus = self::getDeclineStatusValue();
        $declined = VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', $declineStatus)
            ->sum('hours');

        $totalLogs = VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->count();

        $thisMonth = VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->where('date_logged', '>=', now()->startOfMonth())
            ->sum('hours');

        $byOrg = VolLog::where('vol_logs.user_id', $userId)
            ->where('vol_logs.tenant_id', $tenantId)
            ->where('vol_logs.status', 'approved')
            ->join('vol_organizations', function ($join) {
                $join->on('vol_logs.organization_id', '=', 'vol_organizations.id')
                    ->on('vol_logs.tenant_id', '=', 'vol_organizations.tenant_id');
            })
            ->selectRaw('vol_organizations.name, SUM(vol_logs.hours) as hours')
            ->groupBy('vol_organizations.id', 'vol_organizations.name')
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'hours' => round((float) $r->hours, 2)])
            ->toArray();

        $byMonth = VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->selectRaw("DATE_FORMAT(date_logged, '%Y-%m') as month, SUM(hours) as hours")
            ->groupByRaw("DATE_FORMAT(date_logged, '%Y-%m')")
            ->orderBy('month')
            ->get()
            ->map(fn ($r) => ['month' => $r->month, 'hours' => round((float) $r->hours, 2)])
            ->toArray();

        return [
            'total_verified'       => round((float) $total, 2),
            'total_pending'        => round((float) $pending, 2),
            'total_declined'       => round((float) $declined, 2),
            'by_organization'      => $byOrg,
            'by_month'             => $byMonth,
            // Backward-compatible fields
            'total_approved_hours' => round((float) $total, 2),
            'pending_hours'        => round((float) $pending, 2),
            'this_month_hours'     => round((float) $thisMonth, 2),
            'total_entries'        => (int) $totalLogs,
        ];
    }

    /**
     * Get volunteer organisations with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getOrganisations(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        $query = VolOrganization::query()
            ->with('owner:id,first_name,last_name,profile_type,organization_name,avatar_url')
            // Orgs are created/admin-toggled with status 'active' but legacy rows
            // hold 'approved' — the directory must show both.
            ->whereIn('status', ['approved', 'active']);

        if (! empty($filters['search'])) {
            // Escape LIKE wildcards so user input is matched literally.
            $term = '%' . addcslashes((string) $filters['search'], '%_\\') . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('name', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term);
            });
        }

        if (is_string($cursor) && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        // Per-org stats via grouped aggregates over the page's org IDs —
        // a fixed number of queries regardless of page size.
        $orgIds = $items->pluck('id')->map(fn ($id) => (int) $id)->all();
        $oppCounts = [];
        $volCounts = [];
        $hourTotals = [];
        $avgRatings = [];
        $reviewCounts = [];
        if (! empty($orgIds)) {
            $tenantId = self::getTenantId();

            $oppCounts = DB::table('vol_opportunities')
                ->where('tenant_id', $tenantId)
                ->whereIn('organization_id', $orgIds)
                ->where('is_active', true)
                ->whereIn('status', ['open', 'active'])
                ->groupBy('organization_id')
                ->selectRaw('organization_id, COUNT(*) as cnt')
                ->pluck('cnt', 'organization_id')
                ->all();

            $volCounts = DB::table('vol_applications as a')
                ->join('vol_opportunities as o', function ($join) {
                    $join->on('a.opportunity_id', '=', 'o.id')
                        ->whereColumn('o.tenant_id', 'a.tenant_id');
                })
                ->where('a.tenant_id', $tenantId)
                ->where('a.status', 'approved')
                ->whereIn('o.organization_id', $orgIds)
                ->groupBy('o.organization_id')
                ->selectRaw('o.organization_id, COUNT(DISTINCT a.user_id) as cnt')
                ->pluck('cnt', 'organization_id')
                ->all();

            $hourTotals = DB::table('vol_logs')
                ->where('tenant_id', $tenantId)
                ->where('status', 'approved')
                ->whereIn('organization_id', $orgIds)
                ->groupBy('organization_id')
                ->selectRaw('organization_id, SUM(hours) as total')
                ->pluck('total', 'organization_id')
                ->all();

            $avgRatings = DB::table('vol_reviews')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'organization')
                ->whereIn('target_id', $orgIds)
                ->groupBy('target_id')
                ->selectRaw('target_id, AVG(rating) as avg_rating')
                ->pluck('avg_rating', 'target_id')
                ->all();

            $reviewCounts = DB::table('vol_reviews')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'organization')
                ->whereIn('target_id', $orgIds)
                ->groupBy('target_id')
                ->selectRaw('target_id, COUNT(*) as cnt')
                ->pluck('cnt', 'target_id')
                ->all();
        }

        $itemsArray = $items->map(function ($org) use ($oppCounts, $volCounts, $hourTotals, $avgRatings, $reviewCounts) {
            $data = $org->toArray();
            $id = (int) $org->id;
            $data['opportunity_count'] = (int) ($oppCounts[$id] ?? 0);
            $data['volunteer_count'] = (int) ($volCounts[$id] ?? 0);
            $data['total_hours'] = (float) ($hourTotals[$id] ?? 0);
            $data['average_rating'] = isset($avgRatings[$id]) ? round((float) $avgRatings[$id], 1) : 0.0;
            $data['review_count'] = (int) ($reviewCounts[$id] ?? 0);

            return $data;
        })->all();

        return [
            'items'    => $itemsArray,
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single organisation by ID with stats.
     */
    public static function getOrganisationById(int $id, bool $includeNonApproved = false): ?array
    {
        $org = VolOrganization::with('owner:id,first_name,last_name,profile_type,organization_name,avatar_url')
            ->find($id);

        if (! $org) {
            return null;
        }

        if (! $includeNonApproved && ! self::isApprovedOrganizationStatus($org->status ?? null)) {
            return null;
        }

        $data = $org->toArray();
        $tenantId = self::getTenantId();
        $data['opportunities_count'] = (int) VolOpportunity::where('organization_id', $id)
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->whereIn('status', ['open', 'active'])
            ->count();
        $data['total_volunteers'] = (int) DB::table('vol_applications')
            ->where('tenant_id', $tenantId)
            ->whereIn('opportunity_id', function ($q) use ($id, $tenantId) {
                $q->select('id')
                    ->from('vol_opportunities')
                    ->where('organization_id', $id)
                    ->where('tenant_id', $tenantId);
            })
            ->where('status', 'approved')
            ->distinct('user_id')
            ->count('user_id');

        $data['total_hours'] = (float) (DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $id)
            ->where('status', 'approved')
            ->sum('hours') ?? 0);

        $reviewStats = DB::table('vol_reviews')
            ->where('tenant_id', $tenantId)
            ->where('target_type', 'organization')
            ->where('target_id', $id)
            ->selectRaw('COUNT(*) as review_count, AVG(rating) as average_rating')
            ->first();

        // Aliases matching getOrganisations(); keep the old keys for back-compat.
        $data['opportunity_count'] = $data['opportunities_count'];
        $data['volunteer_count'] = $data['total_volunteers'];
        $data['review_count'] = (int) ($reviewStats->review_count ?? 0);
        $data['average_rating'] = $reviewStats && $reviewStats->average_rating !== null
            ? round((float) $reviewStats->average_rating, 1)
            : 0.0;

        return $data;
    }

    // ========================================
    // ERROR TRACKING
    // ========================================

    /** @var array Validation/business errors from the last operation */
    private static array $errors = [];

    /** Cached decline status value for vol_logs (declined vs rejected schema variants) */
    private static ?string $declineStatusValue = null;

    /** Status assigned by the last successful hour-log operation. */
    private static string $lastLogStatus = 'pending';

    /** Payment outcome of the last verifyHours() call: paid|no_whole_hours|already_paid|already_processed|null */
    private static ?string $lastPaymentOutcome = null;

    /**
     * Get errors from the last operation.
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Payment outcome of the most recent verifyHours() call.
     * Values: 'paid', 'no_whole_hours', 'already_paid', 'already_processed',
     * or null (declined). Approval always mints credits ('paid') unless the
     * log floors to zero whole hours ('no_whole_hours') or was already paid.
     */
    public static function getLastPaymentOutcome(): ?string
    {
        return self::$lastPaymentOutcome;
    }

    public static function getLastLogStatus(): string
    {
        return self::$lastLogStatus;
    }

    // ========================================
    // OPPORTUNITIES — update / delete / getById (legacy-compatible)
    // ========================================

    /**
     * Get single opportunity by ID (legacy-compatible format with shifts and viewer context).
     */
    public static function getOpportunityById(int $id, ?int $viewerId = null): ?array
    {
        $tenantId = self::getTenantId();

        $opp = DB::selectOne("
            SELECT opp.*, org.name as org_name, org.logo_url as org_logo,
                   org.status as org_status, org.user_id as org_owner_id,
                   cat.name as category_name
            FROM vol_opportunities opp
            JOIN vol_organizations org ON opp.organization_id = org.id
            LEFT JOIN categories cat ON opp.category_id = cat.id
            WHERE opp.id = ? AND opp.tenant_id = ? AND org.tenant_id = ?
        ", [$id, $tenantId, $tenantId]);

        if (!$opp) {
            return null;
        }

        $viewerCanManage = $viewerId ? self::canManageOpportunity((array) $opp, $viewerId) : false;
        if (!$viewerCanManage) {
            $isPublicStatus = ((int) ($opp->is_active ?? 0) === 1)
                && in_array((string) ($opp->status ?? ''), ['open', 'active'], true)
                && self::isApprovedOrganizationStatus($opp->org_status ?? null);

            if (!$isPublicStatus) {
                return null;
            }
        }

        $formatted = self::formatOpportunity((array) $opp);
        // Visibility already established above — skip the redundant gate.
        $formatted['shifts'] = self::getShiftsForOpportunity($id, null, true);

        if ($viewerId) {
            // Only pending/approved applications block re-applying — apply()
            // permits a fresh application after a decline/withdrawal, and the
            // UI hides the Apply button whenever has_applied is true.
            $formatted['has_applied'] = (bool) DB::selectOne(
                "SELECT 1 FROM vol_applications WHERE opportunity_id = ? AND user_id = ? AND tenant_id = ?
                 AND status IN ('pending', 'approved') LIMIT 1",
                [$id, $viewerId, $tenantId]
            );
            $userApp = DB::selectOne(
                "SELECT * FROM vol_applications WHERE opportunity_id = ? AND user_id = ? AND tenant_id = ?
                 ORDER BY id DESC LIMIT 1",
                [$id, $viewerId, $tenantId]
            );
            $formatted['application'] = $userApp ? [
                'id'         => (int) $userApp->id,
                'status'     => $userApp->status,
                'message'    => $userApp->message,
                'shift_id'   => $userApp->shift_id ? (int) $userApp->shift_id : null,
                'created_at' => $userApp->created_at,
            ] : null;
            // is_owner means CREATOR ONLY — the web/mobile UIs gate the owner
            // panel (Edit / Applications) on it, so org owners and tenant
            // admins must not see owner UI on other members' posts. Legacy
            // rows predate the created_by column (NULL) and fall back to the
            // organisation owner. Admin tooling should use can_manage, which
            // keeps the broader canManageOpportunity() grant.
            $createdBy = isset($opp->created_by) && $opp->created_by !== null
                ? (int) $opp->created_by
                : (int) ($opp->org_owner_id ?? 0);
            $formatted['is_owner'] = $createdBy > 0 && $createdBy === (int) $viewerId;
            $formatted['can_manage'] = $viewerCanManage;
        }

        return $formatted;
    }

    /**
     * Update an opportunity.
     */
    public static function updateOpportunity(int $id, int $userId, array $data): bool
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        $opp = DB::selectOne("
            SELECT opp.*, org.user_id as org_owner_id
            FROM vol_opportunities opp
            JOIN vol_organizations org ON opp.organization_id = org.id
            WHERE opp.id = ? AND opp.tenant_id = ? AND org.tenant_id = ?
        ", [$id, $tenantId, $tenantId]);

        if (!$opp) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.opportunity_not_found')];
            return false;
        }

        if (!self::canManageOpportunity((array) $opp, $userId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_opportunity_manage_forbidden')];
            return false;
        }

        if (array_key_exists('category_id', $data) && $data['category_id'] !== null) {
            $categoryQuery = "SELECT id FROM categories WHERE id = ?";
            $categoryParams = [(int) $data['category_id']];
            if (Schema::hasColumn('categories', 'tenant_id')) {
                $categoryQuery .= " AND (tenant_id = ? OR tenant_id IS NULL)";
                $categoryParams[] = $tenantId;
            }
            $categoryQuery .= " LIMIT 1";

            if (!DB::selectOne($categoryQuery, $categoryParams)) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.category_not_found'), 'field' => 'category_id'];
                return false;
            }
        }

        try {
            $fields = [];
            $params = [];
            foreach (['title', 'description', 'location', 'skills_needed', 'start_date', 'end_date', 'category_id', 'is_remote', 'latitude', 'longitude'] as $field) {
                if (array_key_exists($field, $data)) {
                    $fields[] = "{$field} = ?";
                    if ($field === 'is_remote') {
                        $params[] = !empty($data[$field]) ? 1 : 0;
                    } elseif (in_array($field, ['latitude', 'longitude'], true)) {
                        $params[] = $data[$field] !== null && $data[$field] !== '' ? (float) $data[$field] : null;
                    } else {
                        $params[] = $data[$field];
                    }
                }
            }

            if (array_key_exists('federated_visibility', $data)
                && Schema::hasColumn('vol_opportunities', 'federated_visibility')) {
                $fields[] = 'federated_visibility = ?';
                $params[] = self::sanitizeFederatedVisibility($data['federated_visibility']);
            }

            if (empty($fields)) {
                return true;
            }

            $params[] = $id;
            $params[] = $tenantId;
            DB::update("UPDATE vol_opportunities SET " . implode(', ', $fields) . " WHERE id = ? AND tenant_id = ?", $params);

            try {
                // Capture the pre-update share state so the federation push
                // listener can retract the opportunity when it is un-shared
                // (federated_visibility listed -> none).
                $previousVisibility = (string) ($opp->federated_visibility ?? 'none');
                $updated = VolOpportunity::query()->find($id);
                if ($updated) {
                    TenantContext::runForTenant($tenantId, function () use ($updated, $tenantId, $previousVisibility): void {
                        VolunteerOpportunityUpdated::dispatch($updated, (int) $tenantId, $previousVisibility);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('Failed to dispatch VolunteerOpportunityUpdated', [
                    'opportunity_id' => $id,
                    'error'          => $e->getMessage(),
                ]);
            }

            self::refreshPrerenderForOpportunity($tenantId, $id);

            return true;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::updateOpportunity error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_opportunity_update_failed')];
            return false;
        }
    }

    /**
     * Delete (deactivate) an opportunity.
     */
    public static function deleteOpportunity(int $id, int $userId): bool
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        $opp = DB::selectOne("
            SELECT opp.*, org.user_id as org_owner_id
            FROM vol_opportunities opp
            JOIN vol_organizations org ON opp.organization_id = org.id
            WHERE opp.id = ? AND opp.tenant_id = ? AND org.tenant_id = ?
        ", [$id, $tenantId, $tenantId]);

        if (!$opp) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.opportunity_not_found')];
            return false;
        }

        if (!self::canManageOpportunity((array) $opp, $userId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_opportunity_manage_forbidden')];
            return false;
        }

        try {
            DB::update("UPDATE vol_opportunities SET is_active = 0 WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            self::refreshPrerenderForOpportunity($tenantId, $id);

            // Federation retraction: a soft-deleted opportunity that was shared to
            // partners must be withdrawn from them, not left stale forever.
            // Dispatch the standard update event (now is_active=0) so the push
            // listener propagates a retraction. Only for LOCAL rows that opted in;
            // imported rows must never be re-exported.
            try {
                if ((string) ($opp->federated_visibility ?? 'none') === 'listed'
                    && empty($opp->is_federated)
                    && empty($opp->external_id)) {
                    $updated = VolOpportunity::query()->find($id);
                    if ($updated) {
                        TenantContext::runForTenant($tenantId, function () use ($updated, $tenantId): void {
                            \App\Events\VolunteerOpportunityUpdated::dispatch($updated, (int) $tenantId);
                        });
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Failed to dispatch federation retraction on delete', [
                    'opportunity_id' => $id,
                    'error'          => $e->getMessage(),
                ]);
            }

            // Notify volunteers with approved applications that the opportunity is cancelled
            try {
                $oppTitle = $opp->title ?? '';
                $signedUpUsers = DB::select(
                    "SELECT DISTINCT va.user_id, u.preferred_language
                     FROM vol_applications va
                     JOIN users u ON u.id = va.user_id AND u.tenant_id = va.tenant_id
                     WHERE va.opportunity_id = ? AND va.status = 'approved' AND va.tenant_id = ?",
                    [$id, $tenantId]
                );
                foreach ($signedUpUsers as $row) {
                    $recipientId = (int) $row->user_id;
                    LocaleContext::withLocale($row, function () use ($recipientId, $oppTitle) {
                        \App\Models\Notification::createNotification(
                            $recipientId,
                            __('api_controllers_3.volunteer.opportunity_cancelled', ['title' => $oppTitle]),
                            '/volunteering',
                            'volunteer_opportunity'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($recipientId), 'volunteer_opportunity', __('api_controllers_3.volunteer.opportunity_cancelled', ['title' => $oppTitle]), '/volunteering');
                    });
                }
            } catch (\Throwable $notifErr) {
                Log::warning('VolunteerService::deleteOpportunity notification failed', ['error' => $notifErr->getMessage()]);
            }

            return true;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::deleteOpportunity error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_opportunity_delete_failed')];
            return false;
        }
    }

    // ========================================
    // APPLICATIONS — getForOpportunity / handle / withdraw
    // ========================================

    /**
     * Get applications for an opportunity (org admin only).
     */
    public static function getApplicationsForOpportunity(int $opportunityId, int $adminUserId, array $filters = []): ?array
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        $opp = DB::selectOne("
            SELECT opp.*, org.user_id as org_owner_id
            FROM vol_opportunities opp
            JOIN vol_organizations org ON opp.organization_id = org.id
            WHERE opp.id = ? AND opp.tenant_id = ? AND org.tenant_id = ?
        ", [$opportunityId, $tenantId, $tenantId]);

        if (!$opp) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.opportunity_not_found')];
            return null;
        }

        if (!self::canManageOpportunity((array) $opp, $adminUserId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_opportunity_manage_forbidden')];
            return null;
        }

        $limit = min($filters['limit'] ?? 20, 50);
        $cursorId = self::decodeCursor($filters['cursor'] ?? null);

        $sql = "
            SELECT a.*, a.org_note, u.name as user_name, u.email as user_email, u.avatar_url as user_avatar,
                   s.start_time as shift_start, s.end_time as shift_end
            FROM vol_applications a
            JOIN users u ON a.user_id = u.id AND u.tenant_id = a.tenant_id
            LEFT JOIN vol_shifts s ON a.shift_id = s.id AND s.tenant_id = a.tenant_id
            WHERE a.opportunity_id = ? AND a.tenant_id = ?
        ";
        $params = [$opportunityId, $tenantId];

        if (!empty($filters['status'])) {
            $sql .= " AND a.status = ?";
            $params[] = $filters['status'];
        }

        if ($cursorId) {
            $sql .= " AND a.id < ?";
            $params[] = $cursorId;
        }

        $sql .= " ORDER BY a.created_at DESC, a.id DESC LIMIT " . ($limit + 1);

        $rows = DB::select($sql, $params);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }

        $items = [];
        $lastId = null;
        foreach ($rows as $row) {
            $lastId = $row->id;
            $items[] = [
                'id'      => (int) $row->id,
                'status'  => $row->status,
                'message' => $row->message,
                'org_note' => $row->org_note ?? null,
                'user'    => [
                    'id'         => (int) $row->user_id,
                    'name'       => $row->user_name,
                    'email'      => $row->user_email,
                    'avatar_url' => $row->user_avatar,
                ],
                'shift' => $row->shift_id ? [
                    'id'         => (int) $row->shift_id,
                    'start_time' => $row->shift_start,
                    'end_time'   => $row->shift_end,
                ] : null,
                'created_at' => $row->created_at,
            ];
        }

        return [
            'items'    => $items,
            'cursor'   => $hasMore && $lastId ? base64_encode((string) $lastId) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Handle application (approve/decline).
     */
    public static function handleApplication(int $applicationId, int $adminUserId, string $action, string $orgNote = ''): bool
    {
        self::$errors = [];

        if (!in_array($action, ['approve', 'decline'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.action_must_be_approve_or_decline')];
            return false;
        }

        $tenantId = self::getTenantId();

        $app = DB::selectOne("
            SELECT a.*, opp.title, opp.organization_id, org.user_id as org_owner_id
            FROM vol_applications a
            JOIN vol_opportunities opp ON a.opportunity_id = opp.id AND opp.tenant_id = a.tenant_id
            JOIN vol_organizations org ON opp.organization_id = org.id AND org.tenant_id = a.tenant_id
            WHERE a.id = ? AND a.tenant_id = ?
        ", [$applicationId, $tenantId]);

        if (!$app) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.job_application_not_found')];
            return false;
        }

        if (!self::canManageOpportunity((array) $app, $adminUserId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_opportunity_manage_forbidden')];
            return false;
        }

        $noteSuppressedBySafeguarding = false;
        if ($action === 'approve') {
            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                $adminUserId,
                (int) $app->user_id,
                $tenantId,
                'volunteer_application_approval',
            );
            $policy->assertLocalContactAllowed(
                (int) $app->user_id,
                $adminUserId,
                $tenantId,
                'volunteer_application_approval',
            );
        } elseif (trim($orgNote) !== '') {
            $decision = app(SafeguardingInteractionPolicy::class)->evaluateLocalContact(
                $adminUserId,
                (int) $app->user_id,
                $tenantId,
                'volunteer_application_decline_note',
            );
            if (! $decision->isAllowed()) {
                $orgNote = '';
                $noteSuppressedBySafeguarding = true;
            }
        }

        if ($action === 'decline'
            && trim($orgNote) === ''
            && ! $noteSuppressedBySafeguarding
            && VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_REQUIRE_ORG_NOTE_ON_DECLINE, false)
        ) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.missing_required_field', ['field' => 'org_note']), 'field' => 'org_note'];
            return false;
        }

        $status = $action === 'approve' ? 'approved' : 'declined';

        try {
            $alreadyDecided = false;

            DB::transaction(function () use ($status, $orgNote, $applicationId, $tenantId, $app, &$alreadyDecided) {
                if ($status === 'approved' && !self::shiftHasApprovalCapacity((int) ($app->shift_id ?? 0), $tenantId)) {
                    throw new \DomainException(__('api.volunteer_shift_at_capacity'));
                }

                // Conditional status guard: only a pending application can be
                // decided. A concurrent/retried decision finds 0 rows affected
                // and reports "already decided" instead of silently flipping an
                // existing decision (and re-firing decision notifications).
                $affected = DB::update(
                    "UPDATE vol_applications SET status = ?, org_note = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'pending'",
                    [$status, $orgNote !== '' ? $orgNote : null, $applicationId, $tenantId]
                );
                if ($affected === 0) {
                    $alreadyDecided = true;
                }
            });

            if ($alreadyDecided) {
                // ALREADY_EXISTS maps to a 409 conflict in the controller;
                // callers must NOT fire decision notifications for this outcome.
                self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.volunteer_application_already_decided')];
                return false;
            }

            return true;
        } catch (\DomainException $e) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => $e->getMessage(), 'field' => 'shift_id'];
            return false;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::handleApplication error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.job_application_update_failed')];
            return false;
        }
    }

    /**
     * Withdraw an application.
     */
    public static function withdrawApplication(int $applicationId, int $userId): bool
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        $app = DB::selectOne("
            SELECT a.*, opp.title, opp.id as opportunity_id, org.user_id as org_owner_id
            FROM vol_applications a
            JOIN vol_opportunities opp ON a.opportunity_id = opp.id
            JOIN vol_organizations org ON opp.organization_id = org.id
            WHERE a.id = ? AND a.tenant_id = ?
        ", [$applicationId, $tenantId]);

        if (!$app) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.job_application_not_found')];
            return false;
        }

        if ((int) $app->user_id !== $userId) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_application_not_yours')];
            return false;
        }

        if ($app->status === 'approved') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_application_withdraw_approved')];
            return false;
        }

        try {
            DB::delete("DELETE FROM vol_applications WHERE id = ? AND tenant_id = ?", [$applicationId, $tenantId]);
            return true;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::withdrawApplication error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_application_withdraw_failed')];
            return false;
        }
    }

    // ========================================
    // SHIFTS — list / signUp / cancel
    // ========================================

    /**
     * Get shifts for an opportunity.
     *
     * Applies the same public-visibility gate as getOpportunityById() (active
     * + public status + approved organisation) unless the viewer can manage
     * the opportunity, so shift details of cancelled/hidden opportunities are
     * not exposed. Returns null when the opportunity is not visible to the
     * caller (callers translate this to a 404). Internal callers that have
     * already established visibility may pass $skipVisibilityGate = true.
     *
     * @return array<int, array<string, mixed>>|null
     */
    public static function getShiftsForOpportunity(int $opportunityId, ?int $viewerId = null, bool $skipVisibilityGate = false): ?array
    {
        $tenantId = self::getTenantId();

        if (! $skipVisibilityGate) {
            $opp = DB::selectOne("
                SELECT opp.id, opp.is_active, opp.status, opp.organization_id,
                       org.status as org_status, org.user_id as org_owner_id
                FROM vol_opportunities opp
                JOIN vol_organizations org ON opp.organization_id = org.id AND org.tenant_id = opp.tenant_id
                WHERE opp.id = ? AND opp.tenant_id = ?
            ", [$opportunityId, $tenantId]);

            if (!$opp) {
                return null;
            }

            $viewerCanManage = $viewerId ? self::canManageOpportunity((array) $opp, $viewerId) : false;
            if (!$viewerCanManage) {
                $isPublicStatus = ((int) ($opp->is_active ?? 0) === 1)
                    && in_array((string) ($opp->status ?? ''), self::PUBLIC_OPPORTUNITY_STATUSES, true)
                    && self::isApprovedOrganizationStatus($opp->org_status ?? null);

                if (!$isPublicStatus) {
                    return null;
                }
            }
        }

        $shifts = DB::select(
            "SELECT * FROM vol_shifts WHERE opportunity_id = ? AND tenant_id = ? ORDER BY start_time ASC",
            [$opportunityId, $tenantId]
        );

        if ($shifts === []) {
            return [];
        }

        // Single grouped count instead of one COUNT query per shift (N+1)
        $shiftIds = array_map(static fn ($s) => (int) $s->id, $shifts);
        $placeholders = implode(',', array_fill(0, count($shiftIds), '?'));
        $countRows = DB::select(
            "SELECT shift_id, COUNT(*) as cnt FROM vol_applications
             WHERE shift_id IN ($placeholders) AND status = 'approved' AND tenant_id = ?
             GROUP BY shift_id",
            [...$shiftIds, $tenantId]
        );
        $counts = [];
        foreach ($countRows as $row) {
            $counts[(int) $row->shift_id] = (int) $row->cnt;
        }

        $reservationRows = DB::select(
            "SELECT shift_id, COALESCE(SUM(reserved_slots), 0) as cnt FROM vol_shift_group_reservations
             WHERE shift_id IN ($placeholders) AND status = 'active' AND tenant_id = ?
             GROUP BY shift_id",
            [...$shiftIds, $tenantId]
        );
        $reservationCounts = [];
        foreach ($reservationRows as $row) {
            $reservationCounts[(int) $row->shift_id] = (int) $row->cnt;
        }

        return array_map(function ($shift) use ($counts, $reservationCounts) {
            $signupCount = $counts[(int) $shift->id] ?? 0;
            $reservedCount = $reservationCounts[(int) $shift->id] ?? 0;

            return [
                'id'              => (int) $shift->id,
                'start_time'      => $shift->start_time,
                'end_time'        => $shift->end_time,
                'capacity'        => $shift->capacity ? (int) $shift->capacity : null,
                'signup_count'    => $signupCount,
                'reserved_count'  => $reservedCount,
                'spots_available' => $shift->capacity ? max(0, (int) $shift->capacity - $signupCount - $reservedCount) : null,
            ];
        }, $shifts);
    }

    /**
     * Sign up for a shift (requires approved application).
     */
    public static function signUpForShift(int $shiftId, int $userId): bool
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        // Check user has approved application for this opportunity (outside lock — read-only pre-check)
        $shift = self::getShiftContext($shiftId, $tenantId);
        if (!$shift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
            return false;
        }

        if (! self::isPublicShiftContext($shift)) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_opportunity_not_active')];
            return false;
        }

        $opportunityId = (int) $shift->opportunity_id;

        $organizerId = (int) ($shift->opportunity_created_by ?? $shift->organization_owner_id ?? 0);
        if ($organizerId > 0 && $organizerId !== $userId) {
            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                $userId,
                $organizerId,
                $tenantId,
                'volunteer_shift_signup',
            );
            $policy->assertLocalContactAllowed(
                $organizerId,
                $userId,
                $tenantId,
                'volunteer_shift_signup',
            );
        }

        // Safeguarding re-check: a minor's guardian consent may have expired or
        // been withdrawn between application approval and shift signup.
        if (self::guardianConsentBlocks($userId, $opportunityId)) {
            self::$errors[] = ['code' => 'GUARDIAN_CONSENT_REQUIRED', 'message' => __('api.guardian_consent_required')];
            return false;
        }

        $app = DB::selectOne(
            "SELECT id, shift_id FROM vol_applications WHERE opportunity_id = ? AND user_id = ? AND status = 'approved' AND tenant_id = ?",
            [$opportunityId, $userId, $tenantId]
        );

        if (!$app) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_shift_approved_application_required')];
            return false;
        }

        // If the application is already attached to a different shift in this
        // opportunity, signing up for a new one frees the old shift's slot — we
        // must offer it to that shift's waitlist after committing.
        $previousShiftId = $app->shift_id ? (int) $app->shift_id : null;

        // Check shift hasn't passed
        if (strtotime($shift->start_time) < time()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
            return false;
        }

        // Atomic capacity check + signup inside a transaction with row lock.
        // Notification data is captured inside the transaction and dispatched
        // AFTER commit (matching the verifyHours() convention) — the bell/push
        // fanout must not run while the shift FOR UPDATE lock is held.
        try {
            $confirmedShiftStart = null;

            $ok = DB::transaction(function () use ($shiftId, $tenantId, $app, $shift, &$confirmedShiftStart) {
                // Lock the shift row to prevent concurrent signups from exceeding capacity
                $lockedShift = self::getShiftContext($shiftId, $tenantId, true);

                if (!$lockedShift) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
                    return false;
                }

                if (! self::isPublicShiftContext($lockedShift)) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_opportunity_not_active')];
                    return false;
                }

                if (strtotime($lockedShift->start_time) < time()) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
                    return false;
                }

                $capacity = $lockedShift->capacity !== null ? (int) $lockedShift->capacity : null;
                if (! VolunteerShiftCapacityService::hasAvailableSlot($shiftId, $tenantId, $capacity)) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_at_capacity')];
                    return false;
                }

                DB::update(
                    "UPDATE vol_applications SET shift_id = ? WHERE id = ? AND tenant_id = ?",
                    [$shiftId, $app->id, $tenantId]
                );

                // Capture the raw confirmed shift start; it is formatted inside the
                // recipient's LocaleContext below so it renders in their language.
                $confirmedShiftStart = $lockedShift->start_time ?? ($shift->start_time ?? null);

                return true;
            });

            // Notify volunteer of confirmed shift signup — AFTER the commit so
            // the fanout never runs under the shift row lock.
            if ($ok) {
                try {
                    $shiftStart = $confirmedShiftStart ?? ($shift->start_time ?? null);
                    $recipient = DB::table('users')
                        ->where('id', $userId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();
                    LocaleContext::withLocale($recipient, function () use ($userId, $shiftStart) {
                        $shiftDate = $shiftStart
                            ? \Carbon\Carbon::parse($shiftStart)->locale((string) app()->getLocale())->isoFormat('lll')
                            : '';
                        \App\Models\Notification::createNotification(
                            $userId,
                            __('api_controllers_3.volunteer.shift_signup_confirmed', ['date' => $shiftDate]),
                            '/volunteering',
                            'volunteer_shift'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'volunteer_shift', __('api_controllers_3.volunteer.shift_signup_confirmed', ['date' => $shiftDate]), '/volunteering');
                    });
                } catch (\Throwable $notifErr) {
                    Log::warning('VolunteerService::signUpForShift notification failed', ['error' => $notifErr->getMessage()]);
                }
            }

            // The volunteer moved off $previousShiftId onto $shiftId — that old
            // shift now has a free slot, so offer it to its waitlist (the same
            // courtesy cancelShiftSignup/decline already provide).
            if ($ok && $previousShiftId && $previousShiftId !== $shiftId) {
                ShiftWaitlistService::notifyNext($previousShiftId, $tenantId);
            }

            return $ok;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::signUpForShift error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_shift_signup_failed')];
            return false;
        }
    }

    /**
     * Cancel shift signup.
     */
    public static function cancelShiftSignup(int $shiftId, int $userId): bool
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        $shift = DB::selectOne("SELECT * FROM vol_shifts WHERE id = ? AND tenant_id = ?", [$shiftId, $tenantId]);
        if (!$shift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
            return false;
        }

        if (strtotime($shift->start_time) < time()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_cancel_started')];
            return false;
        }

        // Advance-notice policy: admin-configurable (volunteering.cancellation_deadline_hours).
        // Defaults to 0 (no deadline = current behaviour) when unset, so existing
        // tenants are unchanged; a configured value blocks last-minute cancels.
        $cancellationDeadlineHours = (int) VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_CANCELLATION_DEADLINE_HOURS, 0);
        if ($cancellationDeadlineHours > 0 && (strtotime($shift->start_time) - time()) < $cancellationDeadlineHours * 3600) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_cancel_deadline', ['hours' => $cancellationDeadlineHours])];
            return false;
        }

        try {
            $affected = DB::update(
                "UPDATE vol_applications SET shift_id = NULL WHERE opportunity_id = ? AND user_id = ? AND shift_id = ? AND tenant_id = ?",
                [$shift->opportunity_id, $userId, $shiftId, $tenantId]
            );

            if ($affected === 0) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_signed_up')];
                return false;
            }

            // Notify volunteer of cancellation
            try {
                $recipient = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'preferred_language'])
                    ->first();
                LocaleContext::withLocale($recipient, function () use ($userId) {
                    \App\Models\Notification::createNotification(
                        $userId,
                        __('api_controllers_3.volunteer.shift_signup_cancelled'),
                        '/volunteering',
                        'volunteer_shift'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'volunteer_shift', __('api_controllers_3.volunteer.shift_signup_cancelled'), '/volunteering');
                });
            } catch (\Throwable $notifErr) {
                Log::warning('VolunteerService::cancelShiftSignup notification failed', ['error' => $notifErr->getMessage()]);
            }

            // Offer the freed spot to the next person on the waitlist
            ShiftWaitlistService::notifyNext($shiftId, $tenantId);

            return true;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::cancelShiftSignup error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_shift_cancel_failed')];
            return false;
        }
    }

    // ========================================
    // HOURS — log / pending / verify
    // ========================================

    /**
     * Log volunteering hours.
     */
    public static function logHours(int $userId, array $data): ?int
    {
        self::$errors = [];
        self::$lastLogStatus = 'pending';
        $tenantId = self::getTenantId();
        $policy = app(CaringCommunityWorkflowPolicyService::class)->get($tenantId);

        if (!$policy['allow_member_self_log'] && !self::canBypassCaringWorkflowPolicy($userId, $tenantId)) {
            self::$errors[] = [
                'code' => 'FORBIDDEN',
                'message' => __('api.caring_self_log_disabled'),
                'field' => 'hours',
            ];
            return null;
        }

        if (empty($data['organization_id'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_organization_required'), 'field' => 'organization_id'];
            return null;
        }

        if (empty($data['date'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_log_date_required'), 'field' => 'date'];
            return null;
        }

        if (empty($data['hours']) || $data['hours'] <= 0) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_log_hours_positive'), 'field' => 'hours'];
            return null;
        }

        // Per-entry hours ceiling: admin-configurable (volunteering.max_hours_per_shift),
        // defaulting to the legacy 24h cap when unset so existing tenants are
        // unchanged. 24h also remains an absolute sanity ceiling.
        $maxHours = (int) VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_MAX_HOURS_PER_SHIFT, 24);
        if ($maxHours <= 0 || $maxHours > 24) {
            $maxHours = 24;
        }
        if ($data['hours'] > $maxHours) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_log_hours_over_max', ['max' => $maxHours]), 'field' => 'hours'];
            return null;
        }

        if (strtotime($data['date']) > time()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_log_future_date'), 'field' => 'date'];
            return null;
        }

        $organizationId = (int) $data['organization_id'];
        $oppId = !empty($data['opportunity_id']) ? (int) $data['opportunity_id'] : null;

        // Verify organization exists and the user has a real volunteering relationship with it.
        $org = DB::selectOne("SELECT id, user_id, status, auto_pay_enabled FROM vol_organizations WHERE id = ? AND tenant_id = ?", [$organizationId, $tenantId]);
        if (!$org || !self::isApprovedOrganizationStatus($org->status ?? null)) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.organization_not_found'), 'field' => 'organization_id'];
            return null;
        }

        // If opportunity_id is provided, it must belong to the selected organization.
        if ($oppId !== null) {
            $opportunity = DB::selectOne(
                "SELECT id FROM vol_opportunities WHERE id = ? AND organization_id = ? AND tenant_id = ?",
                [$oppId, $organizationId, $tenantId]
            );

            if (!$opportunity) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.opportunity_not_found'), 'field' => 'opportunity_id'];
                return null;
            }

            $hasApp = DB::selectOne(
                "SELECT id FROM vol_applications WHERE opportunity_id = ? AND user_id = ? AND status = 'approved' AND tenant_id = ?",
                [$oppId, $userId, $tenantId]
            );
            if (!$hasApp) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_approved_application_required'), 'field' => 'opportunity_id'];
                return null;
            }
        } elseif (!self::userCanVolunteerForOrganization($tenantId, $userId, $organizationId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_org_relationship_required'), 'field' => 'organization_id'];
            return null;
        }

        // Serialise the duplicate-check + insert (+ optional auto-pay) under an
        // atomic lock keyed on the natural duplicate key. Without this, two
        // concurrent identical submissions can both pass the existence check and
        // double-insert — and, on the caring-workflow auto-approve path, double-pay.
        $dupLockKey = sprintf('vol_log_dedupe:%d:%d:%d:%s:%s', $tenantId, $userId, $organizationId, (string) $data['date'], $oppId ?? 'none');
        $dupLock = Cache::lock($dupLockKey, 10);
        if (! $dupLock->get()) {
            // A concurrent identical submission already holds the lock.
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.volunteer_log_duplicate')];
            return null;
        }

        try {
            // Prevent duplicate hour logging for the same org + date + opportunity
            if ($oppId !== null) {
                $duplicateCheck = DB::selectOne(
                    "SELECT id FROM vol_logs WHERE user_id = ? AND tenant_id = ? AND organization_id = ? AND date_logged = ? AND opportunity_id = ? AND status NOT IN ('declined', 'rejected')",
                    [$userId, $tenantId, $organizationId, $data['date'], $oppId]
                );
            } else {
                $duplicateCheck = DB::selectOne(
                    "SELECT id FROM vol_logs WHERE user_id = ? AND tenant_id = ? AND organization_id = ? AND date_logged = ? AND opportunity_id IS NULL AND status NOT IN ('declined', 'rejected')",
                    [$userId, $tenantId, $organizationId, $data['date']]
                );
            }
            if ($duplicateCheck) {
                self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.volunteer_log_duplicate')];
                return null;
            }

            $status = self::resolveCaringHourLogStatus($userId, $tenantId, $policy);
            $logId = null;

            DB::transaction(function () use ($tenantId, $userId, $data, $status, $org, $organizationId, $oppId, &$logId): void {
                DB::insert(
                    "INSERT INTO vol_logs (tenant_id, user_id, organization_id, opportunity_id, date_logged, hours, description, status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())",
                    [
                        $tenantId,
                        $userId,
                        $organizationId,
                        $oppId,
                        $data['date'],
                        (float) $data['hours'],
                        $data['description'] ?? '',
                        $status,
                    ]
                );

                $logId = (int) DB::getPdo()->lastInsertId();

                // Approval ALWAYS mints time credits — classic timebanking. Credits
                // are minted on confirmation of volunteered hours and are never
                // gated by the org's auto_pay flag or wallet balance, mirroring
                // verifyHours() and AdminVolunteerController::verifyHours().
                // Previously this was gated on auto_pay_enabled (schema default 0),
                // so auto-approved logs were committed 'approved' but never minted —
                // and verifyHours only reprocesses 'pending' logs, so those credits
                // were permanently lost.
                if ($status === 'approved') {
                    self::applyVolunteerAutoPayment(
                        $tenantId,
                        (int) $org->id,
                        (int) $org->user_id,
                        $userId,
                        $logId,
                        (float) $data['hours'],
                    );
                }
            });

            self::$lastLogStatus = $status;

            // Auto-approved logs (trusted reviewers / no-verification tenants) skip
            // the verify endpoint entirely. Dispatch the same status-change event the
            // verify path fires so XP, volunteering badges and feed activity are
            // awarded consistently across ALL approval paths (previously the
            // auto-approve path awarded none of them).
            if ($status === 'approved' && $logId !== null) {
                try {
                    VolLogStatusChanged::dispatch($tenantId, (int) $logId, 'pending', 'approved');
                } catch (\Throwable $eventEx) {
                    Log::warning('VolunteerService::logHours VolLogStatusChanged dispatch failed: ' . $eventEx->getMessage());
                }
            }

            return $logId;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::logHours error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_log_failed')];
            return null;
        } finally {
            $dupLock->release();
        }
    }

    /**
     * Get pending hours waiting for approval by an org owner.
     */
    public static function getPendingHoursForOrgOwner(int $userId, array $filters = []): array
    {
        $tenantId = self::getTenantId();
        $limit = min($filters['limit'] ?? 20, 50);
        $cursorId = self::decodeCursor($filters['cursor'] ?? null);

        $sql = "
            SELECT l.id, l.hours, l.date_logged, l.description, l.status, l.created_at,
                   u.id as user_id, u.name as user_name, u.avatar_url as user_avatar,
                   org.id as org_id, org.name as org_name, org.logo_url as org_logo,
                   opp.id as opp_id, opp.title as opp_title
            FROM vol_logs l
            JOIN vol_organizations org ON l.organization_id = org.id AND org.tenant_id = l.tenant_id
            JOIN users u ON l.user_id = u.id
            LEFT JOIN vol_opportunities opp ON l.opportunity_id = opp.id AND opp.tenant_id = l.tenant_id
            LEFT JOIN org_members om
                ON om.tenant_id = l.tenant_id
                AND om.organization_id = org.id
                AND om.org_type = 'volunteer'
                AND om.user_id = ?
                AND om.status = 'active'
                AND om.role IN ('owner', 'admin')
            WHERE (org.user_id = ? OR om.user_id IS NOT NULL) AND l.tenant_id = ? AND l.status = 'pending'
        ";
        $params = [$userId, $userId, $tenantId];

        if ($cursorId) {
            $sql .= " AND l.id < ?";
            $params[] = $cursorId;
        }

        $sql .= " ORDER BY l.created_at DESC, l.id DESC LIMIT " . ($limit + 1);

        $rows = DB::select($sql, $params);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }

        $items = [];
        $lastId = null;
        foreach ($rows as $row) {
            $lastId = $row->id;
            $items[] = [
                'id'           => (int) $row->id,
                'hours'        => (float) $row->hours,
                'date'         => $row->date_logged,
                'description'  => $row->description,
                'status'       => $row->status,
                'created_at'   => $row->created_at,
                'user'         => [
                    'id'         => (int) $row->user_id,
                    'name'       => $row->user_name,
                    'avatar_url' => $row->user_avatar,
                ],
                'organization' => [
                    'id'       => (int) $row->org_id,
                    'name'     => $row->org_name,
                    'logo_url' => $row->org_logo,
                ],
                'opportunity'  => $row->opp_id ? [
                    'id'    => (int) $row->opp_id,
                    'title' => $row->opp_title,
                ] : null,
            ];
        }

        return [
            'items'    => $items,
            'cursor'   => ($hasMore && $lastId) ? base64_encode((string) $lastId) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Verify hours (org admin).
     */
    public static function verifyHours(int $logId, int $adminUserId, string $action): bool
    {
        self::$errors = [];
        self::$lastPaymentOutcome = null;

        if (!in_array($action, ['approve', 'decline'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.action_must_be_approve_or_decline')];
            return false;
        }

        $tenantId = self::getTenantId();

        $log = DB::selectOne("SELECT * FROM vol_logs WHERE id = ? AND tenant_id = ?", [$logId, $tenantId]);
        if (!$log) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_log_not_found')];
            return false;
        }

        if ($log->status !== 'pending') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.only_pending_can_be_verified')];
            return false;
        }

        // Prevent users from approving their own hours
        if ((int) $log->user_id === $adminUserId) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_verify_own_hours_forbidden')];
            return false;
        }

        // Verify admin owns or is admin of the org
        $org = DB::selectOne("SELECT * FROM vol_organizations WHERE id = ? AND tenant_id = ?", [(int) $log->organization_id, $tenantId]);
        if (!$org) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_org_manage_forbidden')];
            return false;
        }

        $orgAdminRole = DB::selectOne(
            "SELECT role FROM org_members WHERE tenant_id = ? AND organization_id = ? AND org_type = 'volunteer' AND user_id = ? AND status = 'active'",
            [$tenantId, (int) $org->id, $adminUserId]
        );

        if ((int) $org->user_id !== $adminUserId && !in_array($orgAdminRole->role ?? '', ['owner', 'admin'], true)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_org_manage_forbidden')];
            return false;
        }

        // Hard-freeze: a suspended (non-approved) org cannot mint new time
        // credits. Declining pending hours stays allowed (no value movement) so
        // admins can still clear the queue during suspension.
        if ($action === 'approve' && !self::isApprovedOrganizationStatus($org->status ?? null)) {
            self::$errors[] = ['code' => 'ORG_NOT_ACTIVE', 'message' => __('api.volunteer_org_not_active')];
            return false;
        }

        $status = $action === 'approve' ? 'approved' : self::getDeclineStatusValue();

        try {
            $hours = (float) $log->hours;
            $volunteerId = (int) $log->user_id;
            $orgName = $org->name ?? __('emails.common.fallback_organization');
            $paymentResult = null;
            $transitioned = false;

            // DB transaction for data mutations only — notifications sent AFTER commit
            DB::transaction(function () use ($logId, $tenantId, $status, $action, $log, $org, $adminUserId, $hours, $volunteerId, &$paymentResult, &$transitioned) {
                // 1. Flip status — conditional on the log still being pending. This is
                //    the idempotency gate: a concurrent or retried approval finds 0 rows
                //    affected and aborts without paying again. The org-row lock below
                //    serialises payment, but the status guard is what prevents a second
                //    approval from re-entering the payout branch at all.
                $affected = DB::update(
                    "UPDATE vol_logs SET status = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'",
                    [$status, $logId, $tenantId]
                );
                if ($affected === 0) {
                    // Already verified by a concurrent/retried request — nothing to do.
                    $paymentResult = 'already_processed';
                    return;
                }
                $transitioned = true;

                // 2. Approval ALWAYS mints time credits — classic timebanking.
                //    Credits are minted on confirmation of volunteered hours; they
                //    are never gated by the org wallet balance or the auto_pay flag.
                //    The org wallet is a reconciliation figure (it may go negative),
                //    not a spending limit.
                if ($action === 'approve') {
                    $intHours = (int) floor($hours); // users.balance stores whole hours.
                    $orgDebit = (float) $intHours; // keep fractional remainders in the org wallet.
                    if ($intHours <= 0) {
                        $paymentResult = 'no_whole_hours';
                        return;
                    }

                    // Idempotency: never pay twice for the same log, even if a prior
                    // partial run or another code path already recorded a payment.
                    $existingPayment = DB::selectOne(
                        "SELECT id FROM vol_org_transactions WHERE tenant_id = ? AND vol_organization_id = ? AND vol_log_id = ? AND type = 'volunteer_payment' LIMIT 1",
                        [$tenantId, (int) $org->id, $logId]
                    );
                    if ($existingPayment) {
                        $paymentResult = 'already_paid';
                        return;
                    }

                    // Lock the volunteer's USER row FIRST, then the org row —
                    // VolOrgWalletService::depositFromUser() locks user -> org,
                    // so locking org -> user here is a lock-order inversion
                    // deadlock when a deposit and a payout race (the exact
                    // inversion documented in payVolunteer()).
                    DB::selectOne(
                        "SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                        [$volunteerId, $tenantId]
                    );

                    // Then lock the org row (serialises concurrent payouts).
                    $orgLocked = DB::selectOne(
                        "SELECT id, balance, user_id FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
                        [(int) $org->id, $tenantId]
                    );

                    // Debit the org wallet unconditionally — allow it to go NEGATIVE.
                    $startBalance = $orgLocked ? (float) $orgLocked->balance : 0.0;
                    DB::update(
                        "UPDATE vol_organizations SET balance = balance - ? WHERE id = ? AND tenant_id = ?",
                        [$orgDebit, (int) $org->id, $tenantId]
                    );
                    $newOrgBalance = $startBalance - $orgDebit; // may be negative

                    // Credit (mint) to volunteer (INT — use floor to match deduction)
                    DB::update(
                        "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                        [$intHours, $volunteerId, $tenantId]
                    );

                    // Record in vol_org_transactions (balance_after may be negative)
                    $description = __('api.volunteer_auto_payment_description', ['hours' => $intHours]);
                    DB::insert("
                        INSERT INTO vol_org_transactions (tenant_id, vol_organization_id, user_id, vol_log_id, type, amount, balance_after, description, created_at)
                        VALUES (?, ?, ?, ?, 'volunteer_payment', ?, ?, ?, NOW())
                    ", [$tenantId, (int) $org->id, $volunteerId, $logId, -$orgDebit, $newOrgBalance, $description]);

                    // Record in main transactions table
                    DB::insert("
                        INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, transaction_type, status, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, 'volunteer', 'completed', NOW(), NOW())
                    ", [$tenantId, (int) $org->user_id, $volunteerId, $intHours, $description]);

                    $paymentResult = 'paid';
                }
            });

            self::$lastPaymentOutcome = $paymentResult;

            // If a concurrent/retried request already verified this log, return
            // idempotently without re-dispatching events or re-sending notifications.
            if (! $transitioned) {
                return true;
            }

            // 3. Notify the regional-points cascade-revert listener.
            // For pending -> approved or pending -> declined transitions the
            // listener is a no-op, but we dispatch unconditionally so that
            // if a future code path flips an approved log to another status
            // (e.g. an admin "revert approval" action) the cascade fires
            // automatically.
            try {
                VolLogStatusChanged::dispatch(
                    $tenantId,
                    $logId,
                    (string) $log->status,
                    $status,
                );
            } catch (\Throwable $e) {
                // Event dispatch failure must not break the parent flow.
            }

            // 4. Send notifications AFTER transaction committed successfully
            try {
                // Fetch volunteer preferred_language so the dispatched bell/push/email
                // render in the volunteer's locale, not the reviewing admin's.
                $volunteerRow = DB::table('users')
                    ->where('id', $volunteerId)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'preferred_language'])
                    ->first();

                if ($action === 'approve' && $paymentResult === 'paid') {
                    LocaleContext::withLocale($volunteerRow, function () use ($volunteerId, $hours, $orgName) {
                        NotificationDispatcher::dispatch(
                            $volunteerId, 'global', 0, 'vol_hours_approved',
                            __('notifications.vol_hours_approved_paid_body', ['hours' => $hours]),
                            '/wallet',
                            NotificationDispatcher::buildVolHoursApprovedPaidEmail($hours, $orgName)
                        );
                    });
                } elseif ($action === 'approve' && $paymentResult === 'no_whole_hours') {
                    // Sub-whole-hour logs floor to 0 credits (users.balance stores
                    // whole hours), so tell the volunteer plainly that no credit was
                    // added rather than implying a successful credit — in the email
                    // channel too, not just bell/push (2026-07-09 audit P4).
                    LocaleContext::withLocale($volunteerRow, function () use ($volunteerId, $hours, $orgName) {
                        NotificationDispatcher::dispatch(
                            $volunteerId, 'global', 0, 'vol_hours_approved',
                            __('notifications.vol_hours_approved_no_credit_body', ['hours' => $hours]),
                            '/volunteering?tab=hours',
                            NotificationDispatcher::buildVolHoursApprovedEmail($hours, $orgName, creditAdded: false)
                        );
                    });
                } elseif ($action === 'approve') {
                    LocaleContext::withLocale($volunteerRow, function () use ($volunteerId, $hours, $orgName) {
                        NotificationDispatcher::dispatch(
                            $volunteerId, 'global', 0, 'vol_hours_approved',
                            __('notifications.vol_hours_approved_body', ['hours' => $hours]),
                            '/volunteering?tab=hours',
                            NotificationDispatcher::buildVolHoursApprovedEmail($hours, $orgName)
                        );
                    });
                } else {
                    LocaleContext::withLocale($volunteerRow, function () use ($volunteerId, $hours, $orgName) {
                        NotificationDispatcher::dispatch(
                            $volunteerId, 'global', 0, 'vol_hours_declined',
                            __('notifications.vol_hours_declined_body', ['hours' => $hours]),
                            '/volunteering?tab=hours',
                            NotificationDispatcher::buildVolHoursDeclinedEmail($hours, $orgName)
                        );
                    });
                }
            } catch (\Throwable $e) {
                // Notification failure must not affect the already-committed transaction
                Log::warning("VolunteerService::verifyHours notification error: " . $e->getMessage());
            }

            return true;
        } catch (\Exception $e) {
            Log::warning("VolunteerService::verifyHours error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_verify_hours_failed')];
            return false;
        }
    }

    // ========================================
    // ORGANIZATIONS — create / getById / getMyOrganizations
    // ========================================

    /**
     * Get organisations the current user owns or is admin of, with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getMyOrganizations(int $userId, array $filters = []): array
    {
        $tenantId = self::getTenantId();
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursorId = self::decodeCursor($filters['cursor'] ?? null);

        $sql = "
            SELECT vo.*,
                   COALESCE(om.role, CASE WHEN vo.user_id = ? THEN 'owner' ELSE 'member' END) as member_role
            FROM vol_organizations vo
            LEFT JOIN org_members om
                ON om.organization_id = vo.id
                AND om.org_type = 'volunteer'
                AND om.tenant_id = vo.tenant_id
                AND om.user_id = ?
                AND om.status = 'active'
            WHERE vo.tenant_id = ?
              AND (vo.user_id = ? OR om.user_id IS NOT NULL)
        ";
        $params = [$userId, $userId, $tenantId, $userId];

        if ($cursorId) {
            $sql .= " AND vo.id < ?";
            $params[] = $cursorId;
        }

        $sql .= " ORDER BY vo.id DESC LIMIT " . ($limit + 1);

        $rows = DB::select($sql, $params);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }

        $items = [];
        $lastId = null;
        foreach ($rows as $org) {
            $lastId = $org->id;
            $items[] = [
                'id'            => (int) $org->id,
                'name'          => $org->name,
                'description'   => $org->description ?? null,
                'status'        => $org->status ?? 'pending',
                'member_role'   => $org->member_role ?? 'member',
                'logo_url'      => $org->logo_url ?? null,
                'contact_email' => $org->contact_email ?? null,
                'website'       => $org->website ?? null,
                'created_at'    => $org->created_at ?? null,
            ];
        }

        return [
            'items'    => $items,
            'cursor'   => ($hasMore && $lastId) ? base64_encode((string) $lastId) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Register a new volunteer organisation (status='pending').
     */
    public static function createOrganization(int $userId, array $data): ?int
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        $name = trim($data['name'] ?? '');
        $description = trim($data['description'] ?? '');
        $contactEmail = trim($data['contact_email'] ?? '');
        $website = trim($data['website'] ?? '');

        if (empty($name)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_name_required'), 'field' => 'name'];
            return null;
        }

        if (mb_strlen($name) < 3) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_name_min_length'), 'field' => 'name'];
            return null;
        }

        if (mb_strlen($name) > 200) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_name_max_length'), 'field' => 'name'];
            return null;
        }

        if (empty($description)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.description_required'), 'field' => 'description'];
            return null;
        }

        if (mb_strlen($description) < 20) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_description_min_length'), 'field' => 'description'];
            return null;
        }

        if (empty($contactEmail)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_contact_email_required'), 'field' => 'contact_email'];
            return null;
        }

        if (!filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_contact_email_invalid'), 'field' => 'contact_email'];
            return null;
        }

        if (!empty($website)) {
            // Restrict to http/https. This service is the shared create sink for
            // the React member form, both GOV.UK register paths, and the admin
            // create endpoint. The website is rendered as an <a href> on the
            // PUBLIC org page, so javascript:/data: schemes are a link-injection
            // hole — and FILTER_VALIDATE_URL alone accepts them.
            $scheme = strtolower((string) parse_url((string) $website, PHP_URL_SCHEME));
            if (!filter_var($website, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_org_website_invalid'), 'field' => 'website'];
                return null;
            }
        }

        // Check for duplicate name
        $existing = DB::selectOne(
            "SELECT id FROM vol_organizations WHERE tenant_id = ? AND LOWER(name) = LOWER(?) AND status != 'declined'",
            [$tenantId, $name]
        );

        if ($existing) {
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.volunteer_org_name_exists'), 'field' => 'name'];
            return null;
        }

        // Wrap in transaction with retry to handle slug race conditions
        $maxRetries = 3;
        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                $orgId = DB::transaction(function () use ($tenantId, $userId, $name, $description, $contactEmail, $website) {
                    $slug = self::generateOrgSlug($name, $tenantId);

                    DB::insert(
                        "INSERT INTO vol_organizations (tenant_id, user_id, name, description, contact_email, website, slug, status, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())",
                        [$tenantId, $userId, $name, $description, $contactEmail, $website ?: null, $slug]
                    );

                    $orgId = (int) DB::getPdo()->lastInsertId();

                    // Initialize owner membership
                    DB::insert(
                        "INSERT INTO org_members (tenant_id, organization_id, org_type, user_id, role, status, created_at) VALUES (?, ?, 'volunteer', ?, 'owner', 'active', NOW())",
                        [$tenantId, $orgId, $userId]
                    );

                    return $orgId;
                });

                self::refreshPrerenderForOrganization($tenantId, $orgId);

                return $orgId;
            } catch (\Illuminate\Database\QueryException $e) {
                // Retry on duplicate slug (integrity constraint violation)
                if ($attempt >= $maxRetries || $e->getCode() !== '23000') {
                    Log::warning("VolunteerService::createOrganization error: " . $e->getMessage());
                    self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_org_register_failed')];
                    return null;
                }
                // Retry — generateOrgSlug will pick a new suffix on next attempt
            } catch (\Exception $e) {
                Log::warning("VolunteerService::createOrganization error: " . $e->getMessage());
                self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_org_register_failed')];
                return null;
            }
        }

        self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_org_register_failed')];
        return null;
    }

    /**
     * Get single organization by ID (legacy-compatible format).
     */
    public static function getOrganizationById(int $id, bool $includeNonApproved = false): ?array
    {
        $tenantId = self::getTenantId();

        $org = DB::selectOne("SELECT * FROM vol_organizations WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$org) {
            return null;
        }

        if (!$includeNonApproved && !self::isApprovedOrganizationStatus($org->status ?? null)) {
            return null;
        }

        $oppCount = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM vol_opportunities WHERE organization_id = ? AND is_active = 1 AND status IN ('open', 'active') AND tenant_id = ?",
            [$id, $tenantId]
        )->cnt;

        $volunteerCount = (int) DB::selectOne(
            "SELECT COUNT(DISTINCT a.user_id) as cnt
             FROM vol_applications a
             JOIN vol_opportunities o
               ON o.id = a.opportunity_id
              AND o.tenant_id = a.tenant_id
             WHERE o.organization_id = ?
               AND a.status = 'approved'
               AND a.tenant_id = ?",
            [$id, $tenantId]
        )->cnt;

        $totalHours = (float) (DB::selectOne(
            "SELECT SUM(hours) as total FROM vol_logs WHERE organization_id = ? AND status = 'approved' AND tenant_id = ?",
            [$id, $tenantId]
        )->total ?? 0);

        $reviews = DB::select(
            "SELECT * FROM vol_reviews WHERE target_type = 'organization' AND target_id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        $avgRating = 0;
        if (!empty($reviews)) {
            $avgRating = array_sum(array_map(fn ($r) => (int) $r->rating, $reviews)) / count($reviews);
        }

        return [
            'id'               => (int) $org->id,
            'name'             => $org->name,
            'description'      => $org->description,
            'logo_url'         => $org->logo_url ?? null,
            'website'          => $org->website,
            'contact_email'    => $org->contact_email,
            'location'         => $org->location ?? null,
            'created_at'       => $org->created_at ?? null,
            'status'           => $org->status,
            'opportunity_count' => $oppCount,
            'opportunities_count' => $oppCount,
            'total_hours'         => $totalHours,
            'volunteer_count'     => $volunteerCount,
            'total_volunteers'    => $volunteerCount,
            'review_count'        => count($reviews),
            'average_rating'      => round($avgRating, 1),
            'stats'            => [
                'opportunity_count'  => $oppCount,
                'volunteer_count'    => $volunteerCount,
                'total_hours_logged' => $totalHours,
                'total_hours'        => $totalHours,
                'review_count'       => count($reviews),
                'average_rating'     => round($avgRating, 1),
            ],
        ];
    }

    // ========================================
    // REVIEWS
    // ========================================

    /**
     * Create a volunteering review.
     */
    public static function createReview(int $reviewerId, string $targetType, int $targetId, int $rating, string $comment = ''): ?int
    {
        self::$errors = [];
        $tenantId = self::getTenantId();

        if (!in_array($targetType, ['organization', 'user'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_review_target_type_invalid')];
            return null;
        }

        if ($rating < 1 || $rating > 5) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_review_rating_range'), 'field' => 'rating'];
            return null;
        }

        // Prevent self-review
        if ($targetType === 'user' && $targetId === $reviewerId) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_review_self_forbidden')];
            return null;
        }

        // Prevent duplicate reviews
        $existingReview = DB::selectOne(
            "SELECT id FROM vol_reviews WHERE reviewer_id = ? AND target_type = ? AND target_id = ? AND tenant_id = ?",
            [$reviewerId, $targetType, $targetId, $tenantId]
        );
        if ($existingReview) {
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.volunteer_review_already_exists', ['target' => $targetType])];
            return null;
        }

        // Verify target exists and reviewer has history
        if ($targetType === 'organization') {
            $org = DB::selectOne("SELECT id, status FROM vol_organizations WHERE id = ? AND tenant_id = ?", [$targetId, $tenantId]);
            if (!$org || ! self::isApprovedOrganizationStatus($org->status ?? null)) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.organization_not_found')];
                return null;
            }
            $history = DB::selectOne("
                SELECT 1 FROM vol_logs WHERE user_id = ? AND organization_id = ? AND status = 'approved' AND tenant_id = ?
                UNION
                SELECT 1 FROM vol_applications a
                JOIN vol_opportunities opp ON a.opportunity_id = opp.id
                WHERE a.user_id = ? AND opp.organization_id = ? AND a.status = 'approved' AND a.tenant_id = ?
                LIMIT 1
            ", [$reviewerId, $targetId, $tenantId, $reviewerId, $targetId, $tenantId]);

            if (!$history) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_review_org_history_required')];
                return null;
            }
        } else {
            $user = DB::selectOne("SELECT id FROM users WHERE id = ? AND tenant_id = ?", [$targetId, $tenantId]);
            if (!$user) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.user_not_found')];
                return null;
            }
            $history = DB::selectOne("
                SELECT 1 FROM vol_applications a1
                JOIN vol_applications a2
                    ON a1.opportunity_id = a2.opportunity_id
                    AND a2.tenant_id = a1.tenant_id
                JOIN vol_opportunities opp
                    ON opp.id = a1.opportunity_id
                    AND opp.tenant_id = a1.tenant_id
                WHERE a1.user_id = ?
                    AND a2.user_id = ?
                    AND a1.status = 'approved'
                    AND a2.status = 'approved'
                    AND a1.tenant_id = ?
                    AND a2.tenant_id = ?
                LIMIT 1
            ", [$reviewerId, $targetId, $tenantId, $tenantId]);

            if (!$history) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_review_user_history_required')];
                return null;
            }

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $reviewerId,
                $targetId,
                $tenantId,
                'volunteer_member_review',
            );
        }

        try {
            DB::insert(
                "INSERT INTO vol_reviews (tenant_id, reviewer_id, target_type, target_id, rating, comment, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())",
                [$tenantId, $reviewerId, $targetType, $targetId, $rating, $comment]
            );

            return (int) DB::getPdo()->lastInsertId();
        } catch (\Exception $e) {
            Log::warning("VolunteerService::createReview error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.volunteer_review_create_failed')];
            return null;
        }
    }

    /**
     * Get reviews for a target.
     */
    public static function getReviews(string $targetType, int $targetId): array
    {
        $tenantId = self::getTenantId();

        if ($targetType === 'organization') {
            $org = DB::table('vol_organizations')
                ->where('tenant_id', $tenantId)
                ->where('id', $targetId)
                ->whereIn('status', ['approved', 'active'])
                ->exists();

            if (! $org) {
                return [];
            }
        }

        $rows = DB::select("
            SELECT r.*, u.first_name, u.last_name, u.avatar_url
            FROM vol_reviews r
            JOIN users u ON r.reviewer_id = u.id
            WHERE r.target_type = ? AND r.target_id = ? AND r.tenant_id = ?
            ORDER BY r.created_at DESC
        ", [$targetType, $targetId, $tenantId]);

        return array_map(function ($r) {
            return [
                'id'      => (int) $r->id,
                'rating'  => (int) $r->rating,
                'comment' => $r->comment,
                'author'  => [
                    'id'     => (int) ($r->user_id ?? $r->reviewer_id ?? 0),
                    'name'   => UserDisplayName::resolve($r),
                    'avatar' => $r->avatar_url ?? null,
                ],
                'reviewer' => [
                    'name'       => UserDisplayName::resolve($r),
                    'avatar_url' => $r->avatar_url ?? null,
                ],
                'created_at' => $r->created_at,
            ];
        }, $rows);
    }

    // ========================================
    // PRIVATE HELPERS
    // ========================================

    /**
     * Get the current tenant ID.
     */
    private static function getTenantId(): int
    {
        return \App\Core\TenantContext::getId();
    }

    /**
     * Decode a base64-encoded numeric cursor.
     */
    private static function decodeCursor(?string $cursor): ?int
    {
        if (!$cursor) {
            return null;
        }
        $decoded = base64_decode($cursor, true);
        if ($decoded && is_numeric($decoded)) {
            return (int) $decoded;
        }
        return null;
    }

    /**
     * Check if a user can manage an opportunity.
     */
    private static function canManageOpportunity(array $opp, int $userId): bool
    {
        if ((int) ($opp['org_owner_id'] ?? 0) === $userId) {
            return true;
        }

        $siteRole = DB::selectOne("SELECT role FROM users WHERE id = ? AND tenant_id = ?", [$userId, self::getTenantId()]);
        if ($siteRole && in_array($siteRole->role, ['super_admin', 'admin', 'tenant_admin'], true)) {
            return true;
        }

        $orgId = (int) ($opp['organization_id'] ?? 0);
        if ($orgId <= 0) {
            return false;
        }

        $orgRole = DB::selectOne(
            "SELECT role FROM org_members WHERE tenant_id = ? AND organization_id = ? AND org_type = 'volunteer' AND user_id = ? AND status = 'active'",
            [self::getTenantId(), $orgId, $userId]
        );

        return $orgRole && in_array($orgRole->role, ['owner', 'admin'], true);
    }

    /**
     * Public, tenant-scoped authorization gate: may $userId manage the given
     * opportunity (create/edit/delete its shifts and recurring patterns)?
     *
     * Grants to the opportunity creator, the owning organisation's owner, an
     * active owner/admin member of that organisation, or a site admin. Returns
     * false for a missing/cross-tenant opportunity. Used by RecurringShiftService
     * (which previously had NO permission check on any of its endpoints).
     */
    public static function userCanManageOpportunityById(int $opportunityId, int $userId): bool
    {
        $tenantId = self::getTenantId();

        $opp = DB::selectOne(
            "SELECT o.id, o.created_by, o.organization_id, org.user_id AS org_owner_id
             FROM vol_opportunities o
             LEFT JOIN vol_organizations org
                    ON org.id = o.organization_id AND org.tenant_id = o.tenant_id
             WHERE o.id = ? AND o.tenant_id = ?",
            [$opportunityId, $tenantId]
        );

        if (!$opp) {
            return false;
        }

        if ((int) ($opp->created_by ?? 0) === $userId) {
            return true;
        }

        return self::canManageOpportunity([
            'org_owner_id'    => (int) ($opp->org_owner_id ?? 0),
            'organization_id' => (int) ($opp->organization_id ?? 0),
        ], $userId);
    }

    private static function canManageOrganization(array $org, int $userId): bool
    {
        if ((int) ($org['user_id'] ?? 0) === $userId) {
            return true;
        }

        $tenantId = self::getTenantId();
        $siteRole = DB::selectOne("SELECT role FROM users WHERE id = ? AND tenant_id = ?", [$userId, $tenantId]);
        if ($siteRole && in_array($siteRole->role, ['super_admin', 'admin', 'tenant_admin'], true)) {
            return true;
        }

        $orgId = (int) ($org['id'] ?? 0);
        if ($orgId <= 0) {
            return false;
        }

        $orgRole = DB::selectOne(
            "SELECT role FROM org_members WHERE tenant_id = ? AND organization_id = ? AND org_type = 'volunteer' AND user_id = ? AND status = 'active'",
            [$tenantId, $orgId, $userId]
        );

        return $orgRole && in_array($orgRole->role, ['owner', 'admin'], true);
    }

    public static function isApprovedOrganizationStatus(?string $status): bool
    {
        return in_array($status, self::PUBLIC_ORGANIZATION_STATUSES, true);
    }

    public static function isPublicOpportunityStatus(?string $status): bool
    {
        return in_array($status, self::PUBLIC_OPPORTUNITY_STATUSES, true);
    }

    private static function refreshPrerenderForOpportunity(int $tenantId, int $opportunityId): void
    {
        app(PrerenderContentInvalidator::class)->refreshVolunteerOpportunity($tenantId, $opportunityId);
    }

    private static function refreshPrerenderForOrganization(int $tenantId, int $organizationId): void
    {
        app(PrerenderContentInvalidator::class)->refreshVolunteerOrganisation($tenantId, $organizationId);
    }

    private static function userCanVolunteerForOrganization(int $tenantId, int $userId, int $organizationId): bool
    {
        $hasApprovedApplication = DB::selectOne(
            "SELECT 1
             FROM vol_applications a
             JOIN vol_opportunities opp
               ON opp.id = a.opportunity_id
              AND opp.tenant_id = a.tenant_id
              AND opp.organization_id = ?
             WHERE a.user_id = ?
               AND a.status = 'approved'
               AND a.tenant_id = ?
             LIMIT 1",
            [$organizationId, $userId, $tenantId]
        );

        if ($hasApprovedApplication) {
            return true;
        }

        $orgRelationship = DB::selectOne(
            "SELECT 1
             FROM vol_organizations org
             LEFT JOIN org_members om
               ON om.organization_id = org.id
              AND om.org_type = 'volunteer'
              AND om.tenant_id = org.tenant_id
              AND om.user_id = ?
              AND om.status = 'active'
             WHERE org.id = ?
               AND org.tenant_id = ?
               AND (org.user_id = ? OR om.user_id IS NOT NULL)
             LIMIT 1",
            [$userId, $organizationId, $tenantId, $userId]
        );

        return (bool) $orgRelationship;
    }

    private static function resolveCaringHourLogStatus(int $userId, int $tenantId, array $policy): string
    {
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_HOURS_REQUIRE_VERIFICATION, true)) {
            return 'approved';
        }

        if (!$policy['approval_required']) {
            return 'approved';
        }

        if ($policy['auto_approve_trusted_reviewers'] && self::hasCaringWorkflowPermission($userId, $tenantId, 'volunteering.hours.review')) {
            return 'approved';
        }

        return 'pending';
    }

    private static function applyVolunteerAutoPayment(
        int $tenantId,
        int $organizationId,
        int $organizationOwnerId,
        int $volunteerId,
        int $logId,
        float $hours,
    ): string {
        $intHours = (int) floor($hours);
        $orgDebit = (float) $intHours;
        if ($intHours <= 0) {
            return 'no_payable_hours';
        }

        // Lock the volunteer's USER row FIRST, then the org row —
        // VolOrgWalletService::depositFromUser() locks user -> org, so locking
        // org -> user here is a lock-order inversion deadlock when a deposit
        // and a payout race (the exact inversion documented in payVolunteer()).
        DB::selectOne(
            "SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
            [$volunteerId, $tenantId]
        );

        $orgLocked = DB::selectOne(
            "SELECT id, balance FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
            [$organizationId, $tenantId]
        );

        if (!$orgLocked) {
            return 'no_org';
        }

        // Debit the org wallet UNCONDITIONALLY — allow it to go NEGATIVE. The org
        // wallet is a reconciliation figure, not a spending limit; approved hours
        // are always minted (classic timebanking), mirroring verifyHours() and
        // AdminVolunteerController::verifyHours(). Previously this path returned
        // 'insufficient_balance' and paid nothing, silently leaving the volunteer's
        // approved hours permanently unpaid (the log is committed 'approved' and
        // verifyHours only reprocesses 'pending' logs, so they were never paid).
        DB::update(
            "UPDATE vol_organizations SET balance = balance - ? WHERE id = ? AND tenant_id = ?",
            [$orgDebit, $organizationId, $tenantId]
        );
        $newOrgBalance = (float) $orgLocked->balance - $orgDebit;

        if ($intHours > 0) {
            DB::update(
                "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                [$intHours, $volunteerId, $tenantId]
            );
        }

        $description = __('api.volunteer_auto_payment_description', ['hours' => $intHours]);
        DB::insert("
            INSERT INTO vol_org_transactions (tenant_id, vol_organization_id, user_id, vol_log_id, type, amount, balance_after, description, created_at)
            VALUES (?, ?, ?, ?, 'volunteer_payment', ?, ?, ?, NOW())
        ", [$tenantId, $organizationId, $volunteerId, $logId, -$orgDebit, $newOrgBalance, $description]);

        DB::insert("
            INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, transaction_type, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'volunteer', 'completed', NOW(), NOW())
        ", [$tenantId, $organizationOwnerId, $volunteerId, $intHours, $description]);

        return 'paid';
    }

    private static function canBypassCaringWorkflowPolicy(int $userId, int $tenantId): bool
    {
        $user = DB::selectOne(
            'SELECT role, is_admin, is_super_admin, is_tenant_super_admin, is_god FROM users WHERE id = ? AND tenant_id = ?',
            [$userId, $tenantId]
        );

        if ($user && (
            in_array((string) $user->role, ['admin', 'tenant_admin', 'super_admin'], true)
            || (int) ($user->is_admin ?? 0) === 1
            || (int) ($user->is_super_admin ?? 0) === 1
            || (int) ($user->is_tenant_super_admin ?? 0) === 1
            || (int) ($user->is_god ?? 0) === 1
        )) {
            return true;
        }

        return self::hasCaringWorkflowPermission($userId, $tenantId, 'volunteering.hours.review');
    }

    private static function hasCaringWorkflowPermission(int $userId, int $tenantId, string $permission): bool
    {
        if (!Schema::hasTable('user_roles') || !Schema::hasTable('role_permissions') || !Schema::hasTable('permissions')) {
            return false;
        }

        $match = DB::selectOne(
            "SELECT 1
             FROM user_roles ur
             INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
             INNER JOIN permissions p ON p.id = rp.permission_id
             WHERE ur.user_id = ?
               AND p.name = ?
               AND (ur.tenant_id = ? OR ur.tenant_id IS NULL)
               AND (rp.tenant_id = ? OR rp.tenant_id IS NULL)
               AND (p.tenant_id = ? OR p.tenant_id IS NULL)
               AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
             LIMIT 1",
            [$userId, $permission, $tenantId, $tenantId, $tenantId]
        );

        return $match !== null;
    }

    /**
     * Format opportunity for API response.
     */
    /**
     * Normalise a requested federated_visibility value. Only 'none'|'listed'
     * are valid (MariaDB strict=false silently corrupts invalid enum writes
     * to ''), and tenants without the federation feature are always forced
     * to 'none'.
     */
    private static function sanitizeFederatedVisibility(mixed $value): string
    {
        if (! TenantContext::hasFeature('federation')) {
            return 'none';
        }

        return in_array($value, ['none', 'listed'], true) ? $value : 'none';
    }

    private static function formatOpportunity(array $opp): array
    {
        return [
            'id'            => (int) $opp['id'],
            'title'         => $opp['title'],
            'description'   => $opp['description'],
            'location'      => $opp['location'],
            'skills_needed' => $opp['skills_needed'],
            'start_date'    => $opp['start_date'],
            'end_date'      => $opp['end_date'],
            'is_active'     => (bool) ($opp['is_active'] ?? true),
            'is_remote'     => (bool) ($opp['is_remote'] ?? false),
            'latitude'      => isset($opp['latitude']) ? (float) $opp['latitude'] : null,
            'longitude'     => isset($opp['longitude']) ? (float) $opp['longitude'] : null,
            'category'      => $opp['category_name'] ?? null,
            'organization'  => [
                'id'       => (int) $opp['organization_id'],
                'name'     => $opp['org_name'],
                'logo_url' => $opp['org_logo'] ?? $opp['logo_url'] ?? null,
            ],
            'created_at' => $opp['created_at'],
            'status'     => $opp['status'] ?? null,
            'federated_visibility' => $opp['federated_visibility'] ?? 'none',
        ];
    }

    private static function shiftHasApprovalCapacity(int $shiftId, int $tenantId): bool
    {
        if ($shiftId <= 0) {
            return true;
        }

        $shift = DB::selectOne(
            "SELECT id, capacity FROM vol_shifts WHERE id = ? AND tenant_id = ? FOR UPDATE",
            [$shiftId, $tenantId]
        );

        if (!$shift) {
            return false;
        }

        if (empty($shift->capacity)) {
            return true;
        }

        return VolunteerShiftCapacityService::hasAvailableSlot($shiftId, $tenantId, (int) $shift->capacity);
    }

    private static function getShiftContext(int $shiftId, int $tenantId, bool $lock = false): ?object
    {
        $lockSql = $lock ? ' FOR UPDATE' : '';

        return DB::selectOne(
            "SELECT s.*, opp.status as opportunity_status, opp.is_active as opportunity_is_active,
                    opp.created_by as opportunity_created_by, org.user_id as organization_owner_id,
                    org.status as organization_status
             FROM vol_shifts s
             JOIN vol_opportunities opp ON s.opportunity_id = opp.id AND s.tenant_id = opp.tenant_id
             JOIN vol_organizations org ON opp.organization_id = org.id AND opp.tenant_id = org.tenant_id
             WHERE s.id = ? AND s.tenant_id = ?{$lockSql}",
            [$shiftId, $tenantId]
        );
    }

    private static function isPublicShiftContext(?object $shift): bool
    {
        if (!$shift) {
            return false;
        }

        return (int) ($shift->opportunity_is_active ?? 0) === 1
            && in_array((string) ($shift->opportunity_status ?? ''), ['open', 'active'], true)
            && in_array((string) ($shift->organization_status ?? ''), ['approved', 'active'], true);
    }

    /**
     * Generate a unique slug for an organisation within a tenant.
     */
    private static function generateOrgSlug(string $name, int $tenantId): string
    {
        $slug = mb_strtolower($name, 'UTF-8');
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
        $slug = trim($slug, '-');

        if (empty($slug)) {
            $slug = 'organisation';
        }

        $baseSlug = $slug;
        $suffix = 0;
        while (true) {
            $existing = DB::selectOne(
                "SELECT id FROM vol_organizations WHERE tenant_id = ? AND slug = ?",
                [$tenantId, $slug]
            );

            if (!$existing) {
                break;
            }

            $suffix++;
            $slug = $baseSlug . '-' . $suffix;
        }

        return $slug;
    }

    /**
     * Resolve the "declined" state value for vol_logs across schema variants.
     */
    private static function getDeclineStatusValue(): string
    {
        if (self::$declineStatusValue !== null) {
            return self::$declineStatusValue;
        }

        try {
            $row = DB::selectOne("
                SELECT COLUMN_TYPE
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'vol_logs'
                  AND COLUMN_NAME = 'status'
                LIMIT 1
            ");
            $columnType = strtolower((string) ($row->COLUMN_TYPE ?? ''));

            if (str_contains($columnType, "'declined'")) {
                self::$declineStatusValue = 'declined';
            } elseif (str_contains($columnType, "'rejected'")) {
                self::$declineStatusValue = 'rejected';
            }
        } catch (\Throwable $e) {
            // Fallback below
        }

        if (self::$declineStatusValue === null) {
            self::$declineStatusValue = 'declined';
        }

        return self::$declineStatusValue;
    }
}
