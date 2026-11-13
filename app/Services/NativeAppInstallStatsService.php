<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\UserDisplayName;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Who has the phone app — the figures and the list on the admin "Phone app"
 * page.
 *
 * A member HAS THE APP when either record says so:
 *
 *  1. **A registered phone** (`fcm_device_tokens`). Written when the app signs
 *     in and the member allows notifications; removed when they sign out, when
 *     their sessions are ended, and when the push provider reports the phone
 *     gone. This is the only record that knows Android from iPhone.
 *  2. **A live sign-in made through the phone app**
 *     (`refresh_session_activity.from_phone_app`, recorded since 30 Oct 2026).
 *     It exists whether or not notifications were allowed. "Live" is the same
 *     test `TokenService` applies before honouring a token: a session of that
 *     family that is neither revoked nor past `family_expires_at`.
 *
 * Until 13 Nov 2026 only (1) was read, so a member who installed the app,
 * signed in and declined notifications was invisible, and the page listed just
 * the 25 most recent phones rather than every member.
 *
 * 🔴 These are NOT app-store download counts and must never be presented as
 * such. Someone who installs the app and never signs in is unknown to the
 * platform; store figures exist only in Play Console and App Store Connect.
 *
 * 🔴 Tenant scoping is the caller's contract. {@see tenantStats()} and
 * {@see tenantMembers()} are scoped to one community (the source rows by
 * `tenant_id`, and the member must belong to that same community);
 * {@see platformStats()} deliberately is NOT, and is reserved for god-mode
 * platform operators — see AdminConfigController::getNativeAppInstallStats().
 *
 * Queries here deliberately do not swallow exceptions. A missing column must
 * surface as an error rather than a plausible-looking zero; see the
 * `catch (\Throwable)` note in AGENTS.md.
 */
class NativeAppInstallStatsService
{
    /** Rows in the cross-community "newest members" list. */
    public const RECENT_LIMIT = 25;

    /** Largest page the member list will serve. */
    public const MAX_PER_PAGE = 100;

    /**
     * Figures for one community. Numbers only — the members themselves are
     * served, paged, by {@see tenantMembers()}.
     *
     * @return array{tenant_id:int, members_with_app:int, members_notifications_on:int, native_devices:int, devices_by_platform:array{android:int, ios:int}, last_joined_at:?string}
     */
    public function tenantStats(int $tenantId): array
    {
        return ['tenant_id' => $tenantId] + $this->summary($tenantId);
    }

    /**
     * One page of the members of a community who have the app, most recently
     * active first. Includes email: a community's admin already holds their
     * own members' contact details.
     *
     * @return array{items: list<array<string,mixed>>, total: int}
     */
    public function tenantMembers(int $tenantId, string $search = '', int $page = 1, int $perPage = self::RECENT_LIMIT): array
    {
        $page = max(1, $page);
        $perPage = max(1, min(self::MAX_PER_PAGE, $perPage));

        $members = $this->memberRows($tenantId, trim($search));

        $total = DB::query()->fromSub(clone $members, 'm')->count();

        $rows = $members
            ->orderByDesc('last_opened_at')
            ->orderByDesc('s.user_id')
            ->forPage($page, $perPage)
            ->get();

        return [
            'items' => $rows->map(fn (object $row): array => $this->memberRow($row, true))->all(),
            'total' => $total,
        ];
    }

    /**
     * Platform-wide figures across every community.
     *
     * 🔴 Cross-tenant by design. Only call this for a god-mode operator.
     *
     * Email is deliberately omitted from the cross-community list: a platform
     * operator needs to know WHO has the app, not to accumulate contact
     * details for members of communities they do not administer.
     *
     * @return array<string,mixed>
     */
    public function platformStats(int $recentLimit = self::RECENT_LIMIT): array
    {
        $byTenant = DB::query()
            ->fromSub($this->memberRows(null), 'm')
            ->leftJoin('tenants as t', 't.id', '=', 'm.tenant_id')
            ->groupBy('m.tenant_id', 't.name', 't.slug')
            ->orderByDesc('members_with_app')
            ->orderBy('m.tenant_id')
            ->get([
                'm.tenant_id',
                't.name as tenant_name',
                't.slug as tenant_slug',
                DB::raw('COUNT(*) AS members_with_app'),
                DB::raw('COALESCE(SUM(m.phone_count), 0) AS native_devices'),
                DB::raw('MAX(m.first_seen_at) AS last_joined_at'),
            ]);

        $recent = DB::query()
            ->fromSub($this->memberRows(null), 'm')
            ->leftJoin('tenants as t', 't.id', '=', 'm.tenant_id')
            ->orderByDesc('m.first_seen_at')
            ->orderByDesc('m.user_id')
            ->limit(max(1, $recentLimit))
            ->get(['m.*', 't.name as tenant_name']);

        return $this->summary(null) + [
            'tenants_with_app' => $byTenant->count(),
            'by_tenant' => $byTenant->map(fn (object $row): array => [
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name !== null ? (string) $row->tenant_name : null,
                'tenant_slug' => $row->tenant_slug !== null ? (string) $row->tenant_slug : null,
                'members_with_app' => (int) $row->members_with_app,
                'native_devices' => (int) $row->native_devices,
                'last_joined_at' => $this->isoOrNull($row->last_joined_at),
            ])->all(),
            'recent_members' => $recent->map(fn (object $row): array => $this->memberRow($row, false) + [
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name !== null ? (string) $row->tenant_name : null,
            ])->all(),
        ];
    }

    /**
     * @return array{members_with_app:int, members_notifications_on:int, native_devices:int, devices_by_platform:array{android:int, ios:int}, last_joined_at:?string}
     */
    private function summary(?int $tenantId): array
    {
        $row = DB::query()
            ->fromSub($this->memberRows($tenantId), 'm')
            ->selectRaw('COUNT(*) AS members_with_app')
            ->selectRaw('COALESCE(SUM(m.notifications_on), 0) AS members_notifications_on')
            ->selectRaw('COALESCE(SUM(m.phone_count), 0) AS native_devices')
            ->selectRaw('COALESCE(SUM(m.android_count), 0) AS android_count')
            ->selectRaw('COALESCE(SUM(m.ios_count), 0) AS ios_count')
            ->selectRaw('MAX(m.first_seen_at) AS last_joined_at')
            ->first();

        return [
            'members_with_app' => (int) ($row->members_with_app ?? 0),
            'members_notifications_on' => (int) ($row->members_notifications_on ?? 0),
            'native_devices' => (int) ($row->native_devices ?? 0),
            'devices_by_platform' => [
                'android' => (int) ($row->android_count ?? 0),
                'ios' => (int) ($row->ios_count ?? 0),
            ],
            'last_joined_at' => $this->isoOrNull($row->last_joined_at ?? null),
        ];
    }

    /**
     * One row per member who has the app.
     *
     * A member is listed when ANY of their source rows is live. Their dates are
     * taken over ALL their rows, ended sign-ins included: `first_seen_at` is the
     * earliest evidence of the app, `last_opened_at` the most recent use.
     *
     * The member must belong to the same community as the source row
     * (`u.tenant_id = s.tenant_id`), so a row can never surface an account from
     * another community.
     */
    private function memberRows(?int $tenantId, string $search = ''): Builder
    {
        $query = DB::query()
            ->fromSub($this->sourceRows($tenantId), 's')
            ->join('users as u', function (JoinClause $join): void {
                $join->on('u.id', '=', 's.user_id')->on('u.tenant_id', '=', 's.tenant_id');
            })
            ->groupBy(
                's.user_id',
                's.tenant_id',
                'u.name',
                'u.username',
                'u.first_name',
                'u.last_name',
                'u.profile_type',
                'u.organization_name',
                'u.email',
            )
            ->havingRaw('MAX(s.live) = 1')
            ->select([
                's.user_id',
                's.tenant_id',
                'u.name',
                'u.username',
                'u.first_name',
                'u.last_name',
                'u.profile_type',
                'u.organization_name',
                'u.email',
            ])
            ->selectRaw('MIN(s.first_at) AS first_seen_at')
            ->selectRaw('MAX(s.last_at) AS last_opened_at')
            ->selectRaw('MAX(s.has_phone) AS notifications_on')
            ->selectRaw('SUM(s.has_phone) AS phone_count')
            ->selectRaw("COALESCE(SUM(s.platform = 'android'), 0) AS android_count")
            ->selectRaw("COALESCE(SUM(s.platform = 'ios'), 0) AS ios_count")
            ->selectRaw("GROUP_CONCAT(DISTINCT s.platform ORDER BY s.platform SEPARATOR ',') AS phones");

        if ($search !== '') {
            // `%` and `_` are wildcards in LIKE; typed into a search box they
            // must match themselves.
            $like = '%' . addcslashes(mb_substr($search, 0, 100), '%_\\') . '%';

            $query->where(function (Builder $where) use ($like): void {
                $where->where('u.first_name', 'like', $like)
                    ->orWhere('u.last_name', 'like', $like)
                    ->orWhereRaw("CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) LIKE ?", [$like])
                    ->orWhere('u.organization_name', 'like', $like)
                    ->orWhere('u.username', 'like', $like)
                    ->orWhere('u.email', 'like', $like);
            });
        }

        return $query;
    }

    /**
     * Every record that is evidence of the app, in one shape:
     * `user_id, tenant_id, platform, first_at, last_at, has_phone, live`.
     *
     * A registered phone is always live — it is deleted, not flagged, when it
     * stops being one. A phone-app sign-in is live only while its session
     * family is; ended sign-ins stay in the set (not live) because they still
     * date the member's first and latest use of the app.
     */
    private function sourceRows(?int $tenantId): Builder
    {
        // Blank platforms are reported as android, matching the column default.
        $phones = DB::table('fcm_device_tokens as d')
            ->selectRaw(
                "d.user_id, d.tenant_id, COALESCE(NULLIF(LOWER(TRIM(d.platform)), ''), 'android') AS platform, "
                . 'd.created_at AS first_at, d.updated_at AS last_at, 1 AS has_phone, 1 AS live'
            );

        // Live = the member's OWN session: family, member and community must
        // all match, exactly as TokenService checks before honouring a token.
        $signIns = DB::table('refresh_session_activity as a')
            ->where('a.from_phone_app', 1)
            ->selectRaw(
                'a.user_id, a.tenant_id, NULL AS platform, a.created_at AS first_at, a.last_activity_at AS last_at, '
                . '0 AS has_phone, CASE WHEN EXISTS ('
                . 'SELECT 1 FROM refresh_token_sessions r WHERE r.family_hash = a.family_hash '
                . 'AND r.user_id = a.user_id AND r.tenant_id = a.tenant_id '
                . 'AND r.revoked_at IS NULL AND r.family_expires_at > ?'
                . ') THEN 1 ELSE 0 END AS live',
                [now()]
            );

        if ($tenantId !== null) {
            $phones->where('d.tenant_id', $tenantId);
            $signIns->where('a.tenant_id', $tenantId);
        }

        return $phones->unionAll($signIns);
    }

    /**
     * @return array<string,mixed>
     */
    private function memberRow(object $row, bool $withEmail): array
    {
        $member = [
            'user_id' => (int) $row->user_id,
            'display_name' => $this->displayName($row),
            'username' => $row->username !== null ? (string) $row->username : null,
        ];

        if ($withEmail) {
            $member['email'] = $row->email !== null ? (string) $row->email : null;
        }

        return $member + [
            // Empty when the member has not allowed notifications: only a
            // registered phone tells us Android from iPhone.
            'phones' => array_values(array_filter(
                explode(',', (string) ($row->phones ?? '')),
                static fn (string $phone): bool => $phone !== ''
            )),
            'notifications_on' => (int) $row->notifications_on === 1,
            'first_seen_at' => $this->isoOrNull($row->first_seen_at),
            'last_opened_at' => $this->isoOrNull($row->last_opened_at),
        ];
    }

    /**
     * Prefer a real name, fall back to username, never to a bare row id.
     *
     * Must go through {@see UserDisplayName}: an ORGANISATION account holds its
     * trading name in `organization_name` and a CONTACT PERSON in
     * first_name/last_name, so concatenating those two shows an admin the wrong
     * identity. The selects feeding this read `profile_type` and
     * `organization_name` for exactly that reason.
     */
    private function displayName(object $row): ?string
    {
        $resolved = trim(UserDisplayName::resolve($row, ''));
        if ($resolved !== '') {
            return $resolved;
        }

        $username = trim((string) ($row->username ?? ''));

        return $username !== '' ? $username : null;
    }

    private function isoOrNull(mixed $value): ?string
    {
        if ($value === null || $value === '' || $value === '0000-00-00 00:00:00') {
            return null;
        }

        return Carbon::parse((string) $value)->toIso8601String();
    }
}
