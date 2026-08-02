<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\PartnerMemberPass;
use App\Models\PartnerVenue;
use App\Models\PartnerVenueVisit;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * PartnerVenueVisitService — member passes and the visit ledger.
 *
 * The flow deliberately mirrors the volunteering QR check-in that is already
 * proven in production: the member's pass QR encodes a FRONTEND URL, so venue
 * staff can scan it with any phone camera and land on a page that asks them to
 * confirm. Recording therefore always happens as an authenticated, authorised
 * staff action — a member cannot self-record by photographing their own pass.
 *
 * A visit records engagement only. No discount is calculated, applied or
 * settled here, and no money or time credit moves.
 */
class PartnerVenueVisitService
{
    public const ENGAGEMENT_ACTION = 'venue_visit';

    public function __construct(
        private readonly PartnerVenueService $venues,
    ) {}

    /**
     * Get (or lazily create) the caller's membership pass.
     *
     * @return array{token:string, qr_url:string, status:string, last_used_at:string|null}
     */
    public function getOrCreatePass(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $pass = PartnerMemberPass::query()->where('user_id', $userId)->first();

        if ($pass === null) {
            // Serialise check-then-insert; two concurrent calls would otherwise
            // both find nothing and race on the (tenant_id, user_id) unique key.
            $lock = Cache::lock(sprintf('partner_member_pass:%d:%d', $tenantId, $userId), 10);

            if ($lock->get()) {
                try {
                    $pass = PartnerMemberPass::query()->where('user_id', $userId)->first();

                    if ($pass === null) {
                        $pass = new PartnerMemberPass([
                            'user_id' => $userId,
                            'token' => bin2hex(random_bytes(32)),
                            'status' => 'active',
                        ]);
                        $pass->tenant_id = $tenantId;
                        $pass->save();
                    }
                } finally {
                    $lock->release();
                }
            } else {
                // Lost the lock race — the winner has written the row by now.
                $pass = PartnerMemberPass::query()->where('user_id', $userId)->firstOrFail();
            }
        }

        if ($pass->status !== 'active') {
            $pass->status = 'active';
            $pass->save();
        }

        return [
            'token' => (string) $pass->token,
            'qr_url' => $this->passUrl((string) $pass->token),
            'status' => (string) $pass->status,
            'last_used_at' => $pass->last_used_at?->toIso8601String(),
        ];
    }

    /**
     * Rotate the caller's pass token, invalidating the old QR.
     *
     * @return array{token:string, qr_url:string, status:string, last_used_at:string|null}
     */
    public function rotatePass(int $userId): array
    {
        $this->getOrCreatePass($userId);

        $pass = PartnerMemberPass::query()->where('user_id', $userId)->firstOrFail();
        $pass->token = bin2hex(random_bytes(32));
        $pass->status = 'active';
        $pass->save();

        return [
            'token' => (string) $pass->token,
            'qr_url' => $this->passUrl((string) $pass->token),
            'status' => (string) $pass->status,
            'last_used_at' => $pass->last_used_at?->toIso8601String(),
        ];
    }

    public function passUrl(string $token): string
    {
        return TenantContext::getFrontendUrl()
            . TenantContext::getSlugPrefix()
            . '/venues/checkin/' . $token;
    }

    /**
     * Record a visit from a scanned member pass.
     *
     * Result statuses:
     *  - recorded              a new visit row was written
     *  - already_recorded_today the member was already recorded at this venue today
     *  - needs_venue           the staff member covers several venues; pick one
     *  - invalid_pass          unknown, revoked or cross-tenant token
     *  - forbidden             the caller is not staff at any eligible venue
     *
     * @return array<string, mixed>
     */
    public function recordVisit(string $token, int $staffUserId, ?int $venueId = null): array
    {
        $tenantId = TenantContext::getId();

        $pass = PartnerMemberPass::query()
            ->where('token', $token)
            ->where('status', 'active')
            ->first();

        if ($pass === null) {
            return ['status' => 'invalid_pass'];
        }

        $memberId = (int) $pass->user_id;

        $eligible = $this->venues->venuesForStaff($staffUserId);

        if ($eligible === []) {
            return ['status' => 'forbidden'];
        }

        if ($venueId !== null) {
            if (! in_array($venueId, $eligible, true)) {
                return ['status' => 'forbidden'];
            }
        } elseif (count($eligible) === 1) {
            $venueId = $eligible[0];
        } else {
            return [
                'status' => 'needs_venue',
                'venues' => PartnerVenue::query()
                    ->whereIn('id', $eligible)
                    ->orderBy('name')
                    ->get(['id', 'name'])
                    ->map(static fn ($venue): array => [
                        'id' => (int) $venue->id,
                        'name' => (string) $venue->name,
                    ])
                    ->all(),
            ];
        }

        $venue = PartnerVenue::query()->find($venueId);

        if ($venue === null || $venue->status !== 'active') {
            return ['status' => 'forbidden'];
        }

        if ($memberId === $staffUserId) {
            // Staff recording their own visit would make the ledger
            // self-attested; the same posture as volunteering's
            // self-verification block.
            return ['status' => 'forbidden'];
        }

        $today = now()->toDateString();
        $created = true;

        try {
            $visit = new PartnerVenueVisit([
                'venue_id' => (int) $venue->id,
                'user_id' => $memberId,
                'recorded_by_user_id' => $staffUserId,
                'source' => 'member_pass',
                'visited_on' => $today,
                'visited_at' => now(),
            ]);
            $visit->tenant_id = $tenantId;
            $visit->save();
        } catch (UniqueConstraintViolationException) {
            // Same member, same venue, same day — the daily unique key makes a
            // rescan a no-op rather than an error.
            $created = false;
        }

        $pass->last_used_at = now();
        $pass->save();

        $engagement = ['xp_awarded' => 0, 'completed_challenges' => []];

        if ($created) {
            $engagement = EngagementService::record(
                $memberId,
                self::ENGAGEMENT_ACTION,
                'partner_venue:' . $venue->id . ':' . $today,
                __('api.partner_venue_visit_xp_description', ['venue' => $venue->name]),
            );
        }

        return [
            'status' => $created ? 'recorded' : 'already_recorded_today',
            'member' => $this->memberSummary($memberId),
            'venue' => [
                'id' => (int) $venue->id,
                'name' => (string) $venue->name,
            ],
            'visits_this_month' => $this->memberVisitCountThisMonth($memberId),
            'xp_awarded' => $engagement['xp_awarded'],
            'completed_challenges' => $engagement['completed_challenges'],
        ];
    }

    /**
     * The caller's own visit history.
     *
     * @return array<int, array<string, mixed>>
     */
    public function myVisits(int $userId, int $limit = 50): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('partner_venue_visits as v')
            ->join('partner_venues as pv', function ($join) use ($tenantId): void {
                $join->on('pv.id', '=', 'v.venue_id')
                    ->where('pv.tenant_id', '=', $tenantId);
            })
            ->where('v.tenant_id', $tenantId)
            ->where('v.user_id', $userId)
            ->orderByDesc('v.visited_at')
            ->limit(max(1, min($limit, 200)))
            ->get(['v.id', 'v.visited_on', 'v.visited_at', 'pv.id as venue_id', 'pv.name as venue_name', 'pv.category'])
            ->map(static fn ($row): array => [
                'id' => (int) $row->id,
                'venue_id' => (int) $row->venue_id,
                'venue_name' => (string) $row->venue_name,
                'category' => $row->category,
                'visited_on' => (string) $row->visited_on,
                'visited_at' => $row->visited_at,
            ])
            ->all();
    }

    /**
     * Per-venue engagement rollup for tenant admins.
     *
     * @return array<string, mixed>
     */
    /**
     * NOTE ON SCOPE: total_visits/unique_members are deliberately LIFETIME
     * figures (the admin card reads "Total visits recorded"); only
     * recent_visits honours $days. So the grouped scan covers the tenant's
     * whole visit history by design, served by the
     * (tenant_id, venue_id, visited_at) index. If a tenant ever exceeds
     * roughly a million visits this wants a nightly rollup rather than a
     * live GROUP BY — it is not a bug, it is a known scale ceiling.
     */
    public function summary(int $days = 30): array
    {
        $tenantId = TenantContext::getId();
        $since = now()->subDays(max(1, min($days, 365)))->startOfDay();

        $rows = DB::table('partner_venue_visits as v')
            ->join('partner_venues as pv', function ($join) use ($tenantId): void {
                $join->on('pv.id', '=', 'v.venue_id')
                    ->where('pv.tenant_id', '=', $tenantId);
            })
            ->where('v.tenant_id', $tenantId)
            ->groupBy('pv.id', 'pv.name')
            ->selectRaw('pv.id AS venue_id, pv.name AS venue_name, COUNT(*) AS total_visits, COUNT(DISTINCT v.user_id) AS unique_members')
            ->selectRaw('SUM(CASE WHEN v.visited_at >= ? THEN 1 ELSE 0 END) AS recent_visits', [$since])
            ->orderByDesc('total_visits')
            ->get();

        return [
            'window_days' => $days,
            'total_visits' => (int) $rows->sum('total_visits'),
            'venues' => $rows->map(static fn ($row): array => [
                'venue_id' => (int) $row->venue_id,
                'venue_name' => (string) $row->venue_name,
                'total_visits' => (int) $row->total_visits,
                'unique_members' => (int) $row->unique_members,
                'recent_visits' => (int) $row->recent_visits,
            ])->all(),
        ];
    }

    /**
     * Visit rows for admin reporting / CSV export.
     *
     * @return array<int, array<string, mixed>>
     */
    public function visitRows(?int $venueId = null, ?string $from = null, ?string $to = null, int $limit = 5000): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('partner_venue_visits as v')
            ->join('partner_venues as pv', function ($join) use ($tenantId): void {
                $join->on('pv.id', '=', 'v.venue_id')
                    ->where('pv.tenant_id', '=', $tenantId);
            })
            ->leftJoin('users as m', function ($join) use ($tenantId): void {
                $join->on('m.id', '=', 'v.user_id')
                    ->where('m.tenant_id', '=', $tenantId);
            })
            ->leftJoin('users as s', function ($join) use ($tenantId): void {
                $join->on('s.id', '=', 'v.recorded_by_user_id')
                    ->where('s.tenant_id', '=', $tenantId);
            })
            ->where('v.tenant_id', $tenantId)
            ->when($venueId !== null, fn ($query) => $query->where('v.venue_id', $venueId))
            ->when($from !== null, fn ($query) => $query->where('v.visited_on', '>=', $from))
            ->when($to !== null, fn ($query) => $query->where('v.visited_on', '<=', $to))
            ->orderByDesc('v.visited_at')
            ->limit(max(1, min($limit, 20000)))
            ->get([
                'v.id', 'v.visited_on', 'v.visited_at', 'v.source',
                'pv.name as venue_name',
                'v.user_id', 'm.first_name as member_first_name', 'm.last_name as member_last_name',
                's.first_name as staff_first_name', 's.last_name as staff_last_name',
            ])
            ->map(static fn ($row): array => [
                'id' => (int) $row->id,
                'visited_on' => (string) $row->visited_on,
                'visited_at' => $row->visited_at,
                'venue_name' => (string) $row->venue_name,
                'member_id' => (int) $row->user_id,
                'member_name' => trim(($row->member_first_name ?? '') . ' ' . ($row->member_last_name ?? '')),
                'recorded_by' => trim(($row->staff_first_name ?? '') . ' ' . ($row->staff_last_name ?? '')),
                'source' => (string) $row->source,
            ])
            ->all();
    }

    private function memberVisitCountThisMonth(int $userId): int
    {
        return PartnerVenueVisit::query()
            ->where('user_id', $userId)
            ->where('visited_on', '>=', now()->startOfMonth()->toDateString())
            ->count();
    }

    /**
     * @return array<string, mixed>
     */
    private function memberSummary(int $userId): array
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->first(['id', 'first_name', 'last_name', 'avatar_url']);

        return [
            'id' => $userId,
            'name' => $user !== null
                ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''))
                : '',
            'avatar_url' => $user->avatar_url ?? null,
        ];
    }
}
