<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Native app install statistics — who has the mobile app installed and
 * registered for push.
 *
 * Restores the numbers the decommissioned legacy admin page
 * (`views/modern/admin/native-app.php`, deleted in 745673e0a) used to show and
 * which the React rewrite dropped: native device count, distinct users, web
 * push subscriptions, and a recent-registration list.
 *
 * 🔴 These counts are NOT app-store installs and must never be presented as
 * such. A row in `fcm_device_tokens` means a member installed the app, signed
 * in, AND granted notification permission. Someone who installs and declines
 * the prompt is invisible here. Google Play install figures exist only in Play
 * Console and cannot be derived from this data.
 *
 * 🔴 Tenant scoping is the caller's contract. {@see tenantStats()} is scoped by
 * `tenant_id`; {@see platformStats()} deliberately is NOT, and is reserved for
 * god-mode platform operators — see
 * AdminConfigController::getNativeAppInstallStats().
 *
 * Queries here deliberately do not swallow exceptions. A missing column must
 * surface as an error rather than a plausible-looking zero; see the
 * `catch (\Throwable)` note in AGENTS.md.
 */
class NativeAppInstallStatsService
{
    /** Maximum rows returned in any recent-registration list. */
    public const RECENT_LIMIT = 25;

    /**
     * Install/push statistics for a single tenant.
     *
     * Includes member email in the recent list because a tenant admin already
     * has access to their own members' contact details.
     *
     * @return array<string,mixed>
     */
    public function tenantStats(int $tenantId, int $recentLimit = self::RECENT_LIMIT): array
    {
        $native = DB::table('fcm_device_tokens')
            ->where('tenant_id', $tenantId)
            ->selectRaw('COUNT(*) AS devices')
            ->selectRaw('COUNT(DISTINCT user_id) AS users')
            ->selectRaw('MIN(created_at) AS first_registered_at')
            ->selectRaw('MAX(created_at) AS last_registered_at')
            ->first();

        $byPlatform = DB::table('fcm_device_tokens')
            ->where('tenant_id', $tenantId)
            ->groupBy('platform')
            ->pluck(DB::raw('COUNT(*)'), 'platform');

        $web = DB::table('push_subscriptions')
            ->where('tenant_id', $tenantId)
            ->selectRaw('COUNT(*) AS subscriptions')
            ->selectRaw('COUNT(DISTINCT user_id) AS users')
            ->first();

        $recent = DB::table('fcm_device_tokens as d')
            ->leftJoin('users as u', 'u.id', '=', 'd.user_id')
            ->where('d.tenant_id', $tenantId)
            ->orderByDesc('d.created_at')
            ->limit($recentLimit)
            ->get([
                'd.user_id',
                'd.platform',
                'd.created_at',
                'd.updated_at',
                'u.name',
                'u.username',
                'u.first_name',
                'u.last_name',
                'u.email',
            ]);

        return [
            'tenant_id' => $tenantId,
            'native_devices' => (int) ($native->devices ?? 0),
            'native_users' => (int) ($native->users ?? 0),
            'web_subscriptions' => (int) ($web->subscriptions ?? 0),
            'web_users' => (int) ($web->users ?? 0),
            'push_enabled_users' => $this->distinctPushUsers($tenantId),
            'devices_by_platform' => $this->normalisePlatformCounts($byPlatform->all()),
            'first_registered_at' => $this->isoOrNull($native->first_registered_at ?? null),
            'last_registered_at' => $this->isoOrNull($native->last_registered_at ?? null),
            'recent_devices' => $recent->map(fn ($row) => [
                'user_id' => (int) $row->user_id,
                'display_name' => $this->displayName($row),
                'username' => $row->username !== null ? (string) $row->username : null,
                'email' => $row->email !== null ? (string) $row->email : null,
                'platform' => $this->normalisePlatform($row->platform ?? null),
                'registered_at' => $this->isoOrNull($row->created_at),
                'last_seen_at' => $this->isoOrNull($row->updated_at),
            ])->all(),
        ];
    }

    /**
     * Platform-wide statistics across every tenant.
     *
     * 🔴 Cross-tenant by design. Only call this for a god-mode operator.
     *
     * Email is deliberately omitted from the cross-tenant recent list: a
     * platform operator needs to know WHO has the app, not to accumulate
     * contact details for members of communities they do not administer.
     *
     * @return array<string,mixed>
     */
    public function platformStats(int $recentLimit = self::RECENT_LIMIT): array
    {
        $native = DB::table('fcm_device_tokens')
            ->selectRaw('COUNT(*) AS devices')
            ->selectRaw('COUNT(DISTINCT user_id) AS users')
            ->selectRaw('MIN(created_at) AS first_registered_at')
            ->selectRaw('MAX(created_at) AS last_registered_at')
            ->first();

        $byPlatform = DB::table('fcm_device_tokens')
            ->groupBy('platform')
            ->pluck(DB::raw('COUNT(*)'), 'platform');

        $web = DB::table('push_subscriptions')
            ->selectRaw('COUNT(*) AS subscriptions')
            ->selectRaw('COUNT(DISTINCT user_id) AS users')
            ->first();

        $byTenant = DB::table('fcm_device_tokens as d')
            ->leftJoin('tenants as t', 't.id', '=', 'd.tenant_id')
            ->groupBy('d.tenant_id', 't.name', 't.slug')
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->get([
                'd.tenant_id',
                't.name as tenant_name',
                't.slug as tenant_slug',
                DB::raw('COUNT(*) AS devices'),
                DB::raw('COUNT(DISTINCT d.user_id) AS users'),
                DB::raw('MAX(d.created_at) AS last_registered_at'),
            ]);

        $recent = DB::table('fcm_device_tokens as d')
            ->leftJoin('users as u', 'u.id', '=', 'd.user_id')
            ->leftJoin('tenants as t', 't.id', '=', 'd.tenant_id')
            ->orderByDesc('d.created_at')
            ->limit($recentLimit)
            ->get([
                'd.user_id',
                'd.tenant_id',
                'd.platform',
                'd.created_at',
                'd.updated_at',
                'u.name',
                'u.username',
                'u.first_name',
                'u.last_name',
                't.name as tenant_name',
            ]);

        return [
            'native_devices' => (int) ($native->devices ?? 0),
            'native_users' => (int) ($native->users ?? 0),
            'web_subscriptions' => (int) ($web->subscriptions ?? 0),
            'web_users' => (int) ($web->users ?? 0),
            'push_enabled_users' => $this->distinctPushUsers(null),
            'devices_by_platform' => $this->normalisePlatformCounts($byPlatform->all()),
            'first_registered_at' => $this->isoOrNull($native->first_registered_at ?? null),
            'last_registered_at' => $this->isoOrNull($native->last_registered_at ?? null),
            'tenants_with_installs' => $byTenant->count(),
            'by_tenant' => $byTenant->map(fn ($row) => [
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name !== null ? (string) $row->tenant_name : null,
                'tenant_slug' => $row->tenant_slug !== null ? (string) $row->tenant_slug : null,
                'native_devices' => (int) $row->devices,
                'native_users' => (int) $row->users,
                'last_registered_at' => $this->isoOrNull($row->last_registered_at),
            ])->all(),
            'recent_devices' => $recent->map(fn ($row) => [
                'user_id' => (int) $row->user_id,
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name !== null ? (string) $row->tenant_name : null,
                'display_name' => $this->displayName($row),
                'username' => $row->username !== null ? (string) $row->username : null,
                'platform' => $this->normalisePlatform($row->platform ?? null),
                'registered_at' => $this->isoOrNull($row->created_at),
                'last_seen_at' => $this->isoOrNull($row->updated_at),
            ])->all(),
        ];
    }

    /**
     * Distinct members reachable by push over either channel.
     *
     * A member with both a phone and a browser subscription counts once, which
     * is why this cannot be derived by adding the two user counts together.
     */
    private function distinctPushUsers(?int $tenantId): int
    {
        $native = DB::table('fcm_device_tokens')->select('user_id');
        $web = DB::table('push_subscriptions')->select('user_id');

        if ($tenantId !== null) {
            $native->where('tenant_id', $tenantId);
            $web->where('tenant_id', $tenantId);
        }

        return DB::query()
            ->fromSub($native->union($web), 'push_users')
            ->count();
    }

    /**
     * @param  array<array-key,mixed>  $counts
     * @return array<string,int>
     */
    private function normalisePlatformCounts(array $counts): array
    {
        $out = ['android' => 0, 'ios' => 0];

        foreach ($counts as $platform => $count) {
            $key = $this->normalisePlatform($platform);
            $out[$key] = ($out[$key] ?? 0) + (int) $count;
        }

        return $out;
    }

    /** Unknown/blank platforms are reported as android, matching the column default. */
    private function normalisePlatform(mixed $platform): string
    {
        $key = strtolower(trim((string) $platform));

        return $key !== '' ? $key : 'android';
    }

    /** Prefer a real name, fall back to username, never to a bare row id. */
    private function displayName(object $row): ?string
    {
        $full = trim(((string) ($row->first_name ?? '')) . ' ' . ((string) ($row->last_name ?? '')));
        if ($full !== '') {
            return $full;
        }

        $name = trim((string) ($row->name ?? ''));
        if ($name !== '') {
            return $name;
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
