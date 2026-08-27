<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\PartnerVenue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Support\UserDisplayName;

/**
 * PartnerVenueService — tenant-managed directory of partner premises, plus the
 * staff roster that decides who may record a visit at one.
 *
 * Staff live in the shared, typed `org_members` pivot under
 * org_type='partner_venue'. The shared role enum is ('owner','admin','member')
 * and is not extended here: for a venue, ANY active pivot row grants the right
 * to record visits (till staff need it), while 'owner'/'admin' additionally
 * signal who the council should contact. Roster management stays with tenant
 * admins, so no privilege escalation rides on the role value itself.
 */
class PartnerVenueService
{
    public const ORG_TYPE = 'partner_venue';

    /** Venue statuses that appear in the member-facing directory. */
    public const PUBLIC_STATUSES = ['active'];

    public const ALLOWED_STATUSES = ['active', 'paused', 'archived'];

    public const ALLOWED_ROLES = ['owner', 'admin', 'member'];

    /**
     * Venues shown to members: active only, alphabetical.
     *
     * @return array<int, array<string, mixed>>
     */
    public function directory(): array
    {
        return PartnerVenue::query()
            ->whereIn('status', self::PUBLIC_STATUSES)
            ->orderBy('name')
            ->get()
            ->map(fn (PartnerVenue $venue): array => $this->toPublicArray($venue))
            ->all();
    }

    /**
     * Full venue list for tenant admins, including paused/archived.
     *
     * @return array<int, array<string, mixed>>
     */
    public function adminList(?string $status = null): array
    {
        $tenantId = TenantContext::getId();

        $venues = PartnerVenue::query()
            ->when(
                $status !== null && in_array($status, self::ALLOWED_STATUSES, true),
                fn ($query) => $query->where('status', $status),
            )
            ->orderBy('name')
            ->get();

        if ($venues->isEmpty()) {
            return [];
        }

        $venueIds = $venues->pluck('id')->all();

        // Visit totals per venue in one pass rather than N+1 counts.
        $totals = DB::table('partner_venue_visits')
            ->where('tenant_id', $tenantId)
            ->whereIn('venue_id', $venueIds)
            ->groupBy('venue_id')
            ->selectRaw('venue_id, COUNT(*) AS visit_count, COUNT(DISTINCT user_id) AS member_count')
            ->get()
            ->keyBy('venue_id');

        // Staff counts batched too — this was one query per venue, sitting
        // right beside the batched totals above.
        $staffCounts = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('org_type', self::ORG_TYPE)
            ->whereIn('organization_id', $venueIds)
            ->where('status', 'active')
            ->groupBy('organization_id')
            ->selectRaw('organization_id, COUNT(*) AS staff_count')
            ->pluck('staff_count', 'organization_id');

        return $venues
            ->map(function (PartnerVenue $venue) use ($totals, $staffCounts): array {
                $row = $this->toPublicArray($venue);
                $row['status'] = $venue->status;
                $row['contact_email'] = $venue->contact_email;
                $row['visit_count'] = (int) ($totals[$venue->id]->visit_count ?? 0);
                $row['member_count'] = (int) ($totals[$venue->id]->member_count ?? 0);
                $row['staff_count'] = (int) ($staffCounts[$venue->id] ?? 0);

                return $row;
            })
            ->all();
    }

    public function find(int $venueId): ?PartnerVenue
    {
        return PartnerVenue::query()->find($venueId);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data, int $actorId): PartnerVenue
    {
        $venue = new PartnerVenue($this->sanitize($data));
        $venue->tenant_id = TenantContext::getId();
        $venue->created_by = $actorId;
        $venue->slug = $this->uniqueSlug((string) ($data['name'] ?? ''), null);
        $venue->save();

        return $venue;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(PartnerVenue $venue, array $data): PartnerVenue
    {
        $venue->fill($this->sanitize($data));

        if (isset($data['name']) && $venue->isDirty('name')) {
            $venue->slug = $this->uniqueSlug((string) $data['name'], (int) $venue->id);
        }

        $venue->save();

        return $venue;
    }

    public function archive(PartnerVenue $venue): PartnerVenue
    {
        $venue->status = 'archived';
        $venue->save();

        return $venue;
    }

    /**
     * Is this user authorised to record visits at this venue?
     *
     * Mirrors VolunteerCheckInController::canManageShift — venue staff via the
     * typed org_members pivot, or a tenant administrator.
     */
    public function isStaffOf(int $venueId, int $userId): bool
    {
        $tenantId = TenantContext::getId();

        $isStaff = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('org_type', self::ORG_TYPE)
            ->where('organization_id', $venueId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->exists();

        if ($isStaff) {
            return true;
        }

        return $this->isTenantAdmin($userId);
    }

    public function isTenantAdmin(int $userId): bool
    {
        $role = (string) (DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->value('role') ?? '');

        return in_array($role, ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'], true);
    }

    /**
     * Active venues this user may record visits at.
     *
     * @return array<int, int> Venue IDs
     */
    public function venuesForStaff(int $userId): array
    {
        $tenantId = TenantContext::getId();

        if ($this->isTenantAdmin($userId)) {
            return PartnerVenue::query()
                ->whereIn('status', self::PUBLIC_STATUSES)
                ->pluck('id')
                ->map(static fn ($id): int => (int) $id)
                ->all();
        }

        return DB::table('org_members as om')
            ->join('partner_venues as pv', function ($join) use ($tenantId): void {
                $join->on('pv.id', '=', 'om.organization_id')
                    ->where('pv.tenant_id', '=', $tenantId);
            })
            ->where('om.tenant_id', $tenantId)
            ->where('om.org_type', self::ORG_TYPE)
            ->where('om.user_id', $userId)
            ->where('om.status', 'active')
            ->whereIn('pv.status', self::PUBLIC_STATUSES)
            ->pluck('pv.id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function staffList(int $venueId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('org_members as om')
            ->join('users as u', function ($join) use ($tenantId): void {
                $join->on('u.id', '=', 'om.user_id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('om.tenant_id', $tenantId)
            ->where('om.org_type', self::ORG_TYPE)
            ->where('om.organization_id', $venueId)
            ->orderBy('u.first_name')
            ->get(['om.id', 'om.user_id', 'om.role', 'om.status', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url'])
            ->map(static fn ($row): array => [
                'id' => (int) $row->id,
                'user_id' => (int) $row->user_id,
                'name' => UserDisplayName::resolve($row),
                'avatar_url' => $row->avatar_url ?? null,
                'role' => (string) $row->role,
                'status' => (string) $row->status,
            ])
            ->all();
    }

    /**
     * Add a member as venue staff. Idempotent — re-adding reactivates.
     */
    public function addStaff(int $venueId, int $userId, string $role = 'member'): bool
    {
        $tenantId = TenantContext::getId();

        if (! in_array($role, self::ALLOWED_ROLES, true)) {
            $role = 'member';
        }

        // The member must belong to this tenant.
        $exists = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            return false;
        }

        DB::table('org_members')->updateOrInsert(
            [
                'org_type' => self::ORG_TYPE,
                'organization_id' => $venueId,
                'user_id' => $userId,
            ],
            [
                'tenant_id' => $tenantId,
                'role' => $role,
                'status' => 'active',
                'updated_at' => now(),
            ],
        );

        return true;
    }

    public function removeStaff(int $venueId, int $userId): bool
    {
        return DB::table('org_members')
            ->where('tenant_id', TenantContext::getId())
            ->where('org_type', self::ORG_TYPE)
            ->where('organization_id', $venueId)
            ->where('user_id', $userId)
            ->delete() > 0;
    }

    private function staffCount(int $venueId): int
    {
        return DB::table('org_members')
            ->where('tenant_id', TenantContext::getId())
            ->where('org_type', self::ORG_TYPE)
            ->where('organization_id', $venueId)
            ->where('status', 'active')
            ->count();
    }

    /**
     * @return array<string, mixed>
     */
    public function toPublicArray(PartnerVenue $venue): array
    {
        return [
            'id' => (int) $venue->id,
            'name' => $venue->name,
            'slug' => $venue->slug,
            'description' => $venue->description,
            'category' => $venue->category,
            'offer_summary' => $venue->offer_summary,
            'address_line' => $venue->address_line,
            'city' => $venue->city,
            'postcode' => $venue->postcode,
            'latitude' => $venue->latitude,
            'longitude' => $venue->longitude,
            'website' => $venue->website,
            'logo_url' => $venue->logo_url,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function sanitize(array $data): array
    {
        $allowed = [
            'name', 'description', 'category', 'offer_summary', 'address_line',
            'city', 'postcode', 'latitude', 'longitude', 'website',
            'contact_email', 'logo_url', 'status',
        ];

        $clean = array_intersect_key($data, array_flip($allowed));

        if (isset($clean['status']) && ! in_array($clean['status'], self::ALLOWED_STATUSES, true)) {
            unset($clean['status']);
        }

        return $clean;
    }

    private function uniqueSlug(string $name, ?int $ignoreId): string
    {
        $base = Str::slug($name) ?: 'venue';
        $slug = $base;
        $suffix = 2;

        while (
            PartnerVenue::query()
                ->where('slug', $slug)
                ->when($ignoreId !== null, fn ($query) => $query->where('id', '!=', $ignoreId))
                ->exists()
        ) {
            $slug = $base . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }
}
