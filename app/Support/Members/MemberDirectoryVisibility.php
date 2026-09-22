<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Members;

use App\Services\OnboardingConfigService;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * Canonical visibility boundary for every surface that DISCOVERS members —
 * that is, any query that can hand one member a list of other members they
 * did not already name.
 *
 * Two rules, and they are the member's and the community's respectively:
 *
 *  1. `users.privacy_search` is the member's own "do not list me in member
 *     search" switch. NULL predates the column and means listed, so the
 *     predicate must be `= 1 OR IS NULL` — a bare `= 1` would silently hide
 *     every legacy member.
 *  2. `OnboardingConfigService::getVisibilitySqlConditions()` is the
 *     community's admin-configurable directory gating (a member may be
 *     required to have completed onboarding, or to have an avatar or a bio,
 *     before they are listed at all).
 *
 * Both rules already lived, spelled out by hand, in `UsersController`'s
 * directory listing and again in its counts — where a comment asks the second
 * copy to mirror the first "in the same order". This class exists so the next
 * surface does not become a third hand-written copy that drifts. The AI
 * assistant's two member-returning tools were exactly that: they enforced
 * tenant and `status` but neither of these rules, so a member who had opted
 * out of member search was still returned to anyone who asked the assistant
 * "who can help with X".
 *
 * Callers that must NOT use this: anything that looks a member up by an
 * identifier the caller already holds (their own profile, a conversation
 * partner, an event organiser). Opting out of the directory is not
 * pseudonymity, and applying a discovery filter there would break ordinary
 * pages.
 */
final class MemberDirectoryVisibility
{
    /** Apply member-directory visibility to a query-builder query. */
    public static function applyToQuery(
        QueryBuilder $query,
        int $tenantId,
        string $table = 'users',
    ): QueryBuilder {
        self::apply($query, $tenantId, $table);

        return $query;
    }

    /** Apply member-directory visibility to an Eloquent query. */
    public static function applyToEloquent(
        EloquentBuilder $query,
        int $tenantId,
        string $table = 'users',
    ): EloquentBuilder {
        self::apply($query, $tenantId, $table);

        return $query;
    }

    /**
     * Narrow a list of candidate member ids to those the directory would list.
     *
     * This is the revalidation step for any search index. A Meilisearch hit is
     * a snapshot of a document, not of the member's current settings, and the
     * users index does not carry `privacy_search` at all — so filtering in the
     * engine is not available without a schema change and a full reindex.
     * Re-checking the ids against the database is the same thing the events and
     * groups branches of SearchService already do, needs no reindex, and cannot
     * go stale.
     *
     * Order is NOT preserved: callers keep the engine's relevance order by
     * iterating their own hit list and testing membership of the returned set.
     *
     * @param  array<int|string> $ids
     * @return list<int>
     */
    public static function visibleIds(array $ids, int $tenantId): array
    {
        $ids = array_values(array_unique(array_filter(
            array_map('intval', $ids),
            static fn (int $id): bool => $id > 0,
        )));

        if ($ids === []) {
            return [];
        }

        $query = \Illuminate\Support\Facades\DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ids);

        self::applyToQuery($query, $tenantId);

        return array_map('intval', $query->pluck('id')->all());
    }

    private static function apply(
        EloquentBuilder|QueryBuilder $query,
        int $tenantId,
        string $table,
    ): void {
        $privacySearch = self::column($table, 'privacy_search');

        $query->where(static function ($builder) use ($privacySearch): void {
            $builder->where($privacySearch, 1)->orWhereNull($privacySearch);
        });

        // These fragments are assembled by OnboardingConfigService from its own
        // constant column names and the alias passed here; no request value
        // reaches them, which is why whereRaw is correct rather than risky.
        foreach (OnboardingConfigService::getVisibilitySqlConditions($tenantId, $table) as $condition) {
            $query->whereRaw('(' . $condition . ')');
        }
    }

    private static function column(string $table, string $column): string
    {
        $table = trim($table);

        return $table === '' ? $column : $table . '.' . $column;
    }
}
