<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Members;

use App\Core\TenantContext;
use App\Models\User;
use App\Scopes\TenantScope;
use App\Support\Authorization\AdminTier;
use App\Support\UserDisplayName;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The member's own "who may see my profile" setting (`users.privacy_profile`)
 * applied to every surface that shows one member's profile-level information
 * to another, and the precision at which a member's location is shown.
 *
 * `privacy_profile` has three values:
 *   - `public`      — anyone (NULL predates the column and means the same);
 *   - `members`     — any signed-in member of the community;
 *   - `connections` — only people the member has an accepted connection with.
 *
 * `UserService::getPublicProfile()` has always enforced this for the profile
 * page itself. The member directory, nearby members, and the "listings by
 * member" / "reviews of member" lists did not, so a member who chose
 * connections-only was still listed, still had their offers and requests
 * browsable and still had their reviews readable by anyone (F-081, E-027).
 *
 * The owner and the community's administrators are always exempt — the
 * administrators because they already see every member through the admin
 * panel, and an admin who could not find a member in the directory would
 * simply use that instead.
 *
 * This class is deliberately separate from {@see MemberDirectoryVisibility}:
 * that one is the "list me in member search" switch plus the community's
 * listing requirements and applies only where members are DISCOVERED; this
 * one also applies where the viewer already holds the member's id (a link to
 * their listings, their reviews).
 */
final class MemberProfileVisibility
{
    /** Decimal places a member's coordinates are shown to other members at (about 1 km). */
    public const PUBLIC_COORDINATE_DECIMALS = 2;

    /** True when the viewer is a tenant or platform administrator. */
    public static function viewerIsAdmin(?int $viewerId): bool
    {
        if ($viewerId === null || $viewerId <= 0) {
            return false;
        }

        // Bypass the tenant scope so a platform super-admin acting on another
        // community is still recognised, as UserService::isViewerAdmin does.
        $viewer = User::withoutGlobalScope(TenantScope::class)
            ->select(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'])
            ->find($viewerId);

        return AdminTier::allows($viewer);
    }

    /** True when the two members have an accepted connection in the current community. */
    public static function areConnected(int $userId1, int $userId2): bool
    {
        return DB::table('connections')
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'accepted')
            ->where(function ($q) use ($userId1, $userId2) {
                $q->where(function ($q2) use ($userId1, $userId2) {
                    $q2->where('requester_id', $userId1)->where('receiver_id', $userId2);
                })->orWhere(function ($q2) use ($userId1, $userId2) {
                    $q2->where('requester_id', $userId2)->where('receiver_id', $userId1);
                });
            })
            ->exists();
    }

    /**
     * May this viewer see profile-level information (listings by, reviews of)
     * about this member? Same rule as UserService::getPublicProfile(), plus the
     * administrator exemption.
     */
    public static function canView(int $ownerId, ?int $viewerId): bool
    {
        if ($viewerId !== null && $viewerId === $ownerId) {
            return true;
        }

        $privacy = DB::table('users')
            ->where('id', $ownerId)
            ->where('tenant_id', TenantContext::getId())
            ->value('privacy_profile');

        $privacy = $privacy === null ? 'public' : (string) $privacy;

        if ($privacy === 'public') {
            return true;
        }

        if ($viewerId === null || $viewerId <= 0) {
            return false;
        }

        if ($privacy === 'members') {
            return true;
        }

        return self::viewerIsAdmin($viewerId) || self::areConnected($ownerId, $viewerId);
    }

    /**
     * Restrict a member query to the members whose profile this viewer may
     * see. `$viewerIsAdmin` may be passed when the caller already knows it.
     */
    public static function applyToQuery(
        QueryBuilder|EloquentBuilder $query,
        int $tenantId,
        ?int $viewerId,
        string $table = 'users',
        ?bool $viewerIsAdmin = null,
    ): QueryBuilder|EloquentBuilder {
        [$sql, $bindings] = self::sqlCondition($tenantId, $viewerId, $table, $viewerIsAdmin);
        if ($sql !== '') {
            $query->whereRaw('(' . $sql . ')', $bindings);
        }

        return $query;
    }

    /**
     * The same restriction as a raw SQL fragment for hand-written queries.
     * Returns ['', []] when nothing needs restricting (an administrator).
     *
     * @return array{0: string, 1: list<int>}
     */
    public static function sqlCondition(
        int $tenantId,
        ?int $viewerId,
        string $table = 'users',
        ?bool $viewerIsAdmin = null,
    ): array {
        $viewerId = ($viewerId !== null && $viewerId > 0) ? $viewerId : null;
        $viewerIsAdmin ??= self::viewerIsAdmin($viewerId);
        if ($viewerIsAdmin) {
            return ['', []];
        }

        // Only a fixed table/alias name reaches the SQL; no request value does.
        $t = preg_replace('/[^A-Za-z0-9_]/', '', $table) ?: 'users';
        $col = "{$t}.privacy_profile";

        if ($viewerId === null) {
            return ["{$col} IS NULL OR {$col} = 'public'", []];
        }

        $sql = "{$col} IS NULL OR {$col} IN ('public', 'members')"
            . " OR {$t}.id = ?"
            . " OR EXISTS (SELECT 1 FROM connections pv_c"
            . " WHERE pv_c.tenant_id = ? AND pv_c.status = 'accepted'"
            . " AND ((pv_c.requester_id = {$t}.id AND pv_c.receiver_id = ?)"
            . " OR (pv_c.receiver_id = {$t}.id AND pv_c.requester_id = ?)))";

        return [$sql, [$viewerId, $tenantId, $viewerId, $viewerId]];
    }

    /**
     * Apply the directory's surname rule to one member row: non-admin viewers
     * see a first name only (an organisation keeps its trading name). Mirrors
     * UsersController::index() and UserService::getPublicProfile().
     *
     * @param  array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function withoutSurname(array $row, string $nameKey = 'name'): array
    {
        unset($row['last_name']);

        $isOrganisation = ($row['profile_type'] ?? 'individual') === UserDisplayName::ORGANISATION
            && trim((string) ($row['organization_name'] ?? '')) !== '';

        if ($isOrganisation) {
            $row[$nameKey] = (string) $row['organization_name'];
        } elseif (array_key_exists('first_name', $row)) {
            $row[$nameKey] = trim((string) ($row['first_name'] ?? ''));
        }

        return $row;
    }

    /**
     * The names a non-admin member may see for a set of members, keyed by id:
     * the first name, or an organisation's trading name (the same rule as
     * {@see withoutSurname()}). For lists whose rows carry only a stored
     * `name` (F-084). Ids not found in the community are omitted.
     *
     * @param  list<int> $userIds
     * @return array<int, string>
     */
    public static function publicNames(array $userIds, int $tenantId): array
    {
        $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds), static fn (int $id): bool => $id > 0)));
        if ($userIds === []) {
            return [];
        }

        $names = [];
        $rows = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $userIds)
            ->get(['id', 'first_name', 'profile_type', 'organization_name']);
        foreach ($rows as $row) {
            $names[(int) $row->id] = (string) self::withoutSurname((array) $row)['name'];
        }

        return $names;
    }

    /** Round one coordinate to the precision shown to other members. */
    public static function publicCoordinate(mixed $value): ?float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }

        return round((float) $value, self::PUBLIC_COORDINATE_DECIMALS);
    }

    /**
     * Round the `latitude` / `longitude` keys of a response row unless the
     * viewer is allowed the exact values (the owner, or an administrator).
     * What is stored is never changed.
     *
     * @param  array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function coarsenCoordinates(array $row, bool $exact): array
    {
        if ($exact) {
            return $row;
        }

        foreach (['latitude', 'longitude'] as $key) {
            if (array_key_exists($key, $row)) {
                $row[$key] = self::publicCoordinate($row[$key]);
            }
        }

        return $row;
    }
}
