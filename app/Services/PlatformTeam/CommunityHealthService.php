<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Services\SocialValueService;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Community health.
 *
 * One row of counts per community: members, active members, new members this
 * month, exchanges this month and last month, hours exchanged this month, new
 * listings this month, the most recent sign-in of any member, and whether the
 * community has gone quiet.
 *
 * The definitions are the community admin dashboard's
 * (App\Http\Controllers\Api\AdminDashboardController::stats() and
 * exchangeWhere()), copied rather than shared because they are private there.
 * CommunityHealthTest::test_it_agrees_with_the_community_admin_dashboard pins
 * the two to the same numbers for the same community, so one cannot change
 * alone. Two additions that the dashboard does not need:
 *   - a manager's stand-in (`status = 'delegate'`) is not a member here. The
 *     dashboard counts one in its own community's totals; a stand-in never
 *     signs in, so the difference is at most one per tenant super admin.
 *   - accounts with no community (`tenant_id IS NULL`) are not counted.
 *
 * "Quiet" (ruling, 16 Nov 2026): the community is active, and either no
 * member was active in the last 30 days, or there was no exchange this month
 * and none last month. A community that is switched off is not "quiet".
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the question
 * is "how is each community doing". Correct only because nothing below the
 * platform team can call it. Counts only: no member's name, address or id
 * leaves this class.
 *
 * One grouped query per figure across every community, never one per
 * community. A figure that cannot be read is null in every row and named in
 * `unavailable` (logged at error), never shown as zero.
 */
final class CommunityHealthService
{
    public const ACTIVE_WINDOW_DAYS = 30;

    /** As AdminDashboardController::NON_EXCHANGE_TYPES. */
    private const NON_EXCHANGE_TYPES = [
        ...SocialValueService::EXCLUDED_TRANSACTION_TYPES,
        'exchange_reversal',
        'marketplace_refund',
    ];

    /** The figures summed into `totals`, in the order the page shows them. */
    private const COUNTED = [
        'members', 'active_members', 'new_members_this_month',
        'exchanges_this_month', 'exchanges_last_month', 'new_listings_this_month',
    ];

    /**
     * @return array{
     *   active_window_days: int,
     *   unavailable: list<string>,
     *   totals: array<string, int|float|null>,
     *   communities: list<array<string, mixed>>
     * }
     */
    public function overview(): array
    {
        $monthStart = now()->startOfMonth();
        $lastMonthStart = $monthStart->copy()->subMonth();
        $activeSince = now()->subDays(self::ACTIVE_WINDOW_DAYS);

        $unavailable = [];
        $figure = static function (string $name, callable $read) use (&$unavailable): ?array {
            try {
                return $read();
            } catch (\Throwable $e) {
                Log::error('Platform team community health: a figure could not be read', [
                    'figure' => $name,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
                $unavailable[] = $name;

                return null;
            }
        };

        $members = $figure('members', fn (): array => $this->countByCommunity($this->members()));
        $active = $figure('active_members', fn (): array => $this->countByCommunity(
            $this->members()
                ->where(static function (Builder $q): void {
                    $q->whereNull('status')->orWhereNotIn('status', ['suspended', 'banned', 'rejected']);
                })
                ->where(static function (Builder $q) use ($activeSince): void {
                    $q->where('last_active_at', '>=', $activeSince)->orWhere('last_login_at', '>=', $activeSince);
                })
        ));
        $newMembers = $figure('new_members_this_month', fn (): array => $this->countByCommunity(
            $this->members()->where('created_at', '>=', $monthStart)
        ));
        $exchangesThisMonth = $figure('exchanges_this_month', fn (): array => $this->exchangesByCommunity(
            $this->exchanges()->where('created_at', '>=', $monthStart)
        ));
        $exchangesLastMonth = $figure('exchanges_last_month', fn (): array => $this->exchangesByCommunity(
            $this->exchanges()->where('created_at', '>=', $lastMonthStart)->where('created_at', '<', $monthStart)
        ));
        $newListings = $figure('new_listings_this_month', fn (): array => $this->countByCommunity(
            DB::table('listings')->where('created_at', '>=', $monthStart)
        ));
        $lastSignIn = $figure('last_sign_in_at', function (): array {
            $out = [];
            $rows = $this->members()
                ->whereNotNull('last_login_at')
                ->groupBy('tenant_id')
                ->get(['tenant_id', DB::raw('MAX(last_login_at) as latest')]);
            foreach ($rows as $row) {
                $out[(int) $row->tenant_id] = (string) $row->latest;
            }

            return $out;
        });

        $value = static fn (?array $byCommunity, int $id, mixed $none = 0): mixed => $byCommunity === null ? null : ($byCommunity[$id] ?? $none);

        $communities = [];
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name', 'slug', 'is_active']) as $tenant) {
            $id = (int) $tenant->id;
            $isActive = !empty($tenant->is_active);
            $thisMonth = $value($exchangesThisMonth, $id, ['count' => 0, 'hours' => 0.0]);
            $lastMonth = $value($exchangesLastMonth, $id, ['count' => 0, 'hours' => 0.0]);
            $activeMembers = $value($active, $id);
            $signIn = $value($lastSignIn, $id, null);

            $communities[] = [
                'id' => $id,
                'name' => (string) $tenant->name,
                'slug' => $tenant->slug !== null ? (string) $tenant->slug : null,
                'is_active' => $isActive,
                'members' => $value($members, $id),
                'active_members' => $activeMembers,
                'new_members_this_month' => $value($newMembers, $id),
                'exchanges_this_month' => $thisMonth === null ? null : $thisMonth['count'],
                'exchanges_last_month' => $lastMonth === null ? null : $lastMonth['count'],
                'hours_this_month' => $thisMonth === null ? null : round($thisMonth['hours'], 1),
                'new_listings_this_month' => $value($newListings, $id),
                'last_sign_in_at' => $signIn !== null ? Carbon::parse((string) $signIn)->toIso8601String() : null,
                'quiet' => self::quiet(
                    $isActive,
                    $activeMembers,
                    $thisMonth === null ? null : $thisMonth['count'],
                    $lastMonth === null ? null : $lastMonth['count'],
                ),
            ];
        }

        return [
            'active_window_days' => self::ACTIVE_WINDOW_DAYS,
            'unavailable' => $unavailable,
            'totals' => self::totals($communities, $unavailable),
            'communities' => $communities,
        ];
    }

    /**
     * Null when the answer depends on a figure that could not be read: "not
     * quiet" would then be a guess.
     */
    private static function quiet(bool $isActive, ?int $activeMembers, ?int $exchangesThisMonth, ?int $exchangesLastMonth): ?bool
    {
        if (!$isActive) {
            return false;
        }
        if ($activeMembers === 0) {
            return true;
        }
        if ($exchangesThisMonth === 0 && $exchangesLastMonth === 0) {
            return true;
        }
        if ($activeMembers === null || $exchangesThisMonth === null || $exchangesLastMonth === null) {
            return null;
        }

        return false;
    }

    /**
     * @param list<array<string, mixed>> $communities
     * @param list<string> $unavailable
     * @return array<string, int|float|null>
     */
    private static function totals(array $communities, array $unavailable): array
    {
        $totals = [
            'communities' => count($communities),
            'quiet' => count(array_filter($communities, static fn (array $row): bool => $row['quiet'] === true)),
        ];
        foreach (self::COUNTED as $key) {
            $totals[$key] = in_array($key, $unavailable, true)
                ? null
                : array_sum(array_map(static fn (array $row): int => (int) $row[$key], $communities));
        }
        $totals['hours_this_month'] = in_array('exchanges_this_month', $unavailable, true)
            ? null
            : round(array_sum(array_map(static fn (array $row): float => (float) $row['hours_this_month'], $communities)), 1);

        return $totals;
    }

    /**
     * A member, as the admin dashboard counts one (not deleted, not erased),
     * plus: not a manager's stand-in, and in a community. `status` may be
     * NULL, and NULL is not a stand-in.
     */
    private function members(): Builder
    {
        return DB::table('users')
            ->whereNotNull('tenant_id')
            ->whereNull('deleted_at')
            ->whereNull('anonymized_at')
            ->where(static function (Builder $q): void {
                $q->whereNull('status')->orWhere('status', '!=', 'delegate');
            });
    }

    /**
     * An exchange, as AdminDashboardController::exchangeWhere() defines one:
     * completed, of an exchange type, between two different real members.
     * Counted once, under the transaction's own community.
     */
    private function exchanges(): Builder
    {
        return DB::table('transactions')
            ->where('status', 'completed')
            ->whereNotIn('transaction_type', self::NON_EXCHANGE_TYPES)
            ->whereNotNull('sender_id')->where('sender_id', '<>', 0)
            ->whereNotNull('receiver_id')->where('receiver_id', '<>', 0)
            ->whereColumn('sender_id', '<>', 'receiver_id');
    }

    /** @return array<int, int> community id => count */
    private function countByCommunity(Builder $query): array
    {
        $out = [];
        foreach ($query->groupBy('tenant_id')->get(['tenant_id', DB::raw('COUNT(*) as cnt')]) as $row) {
            $out[(int) $row->tenant_id] = (int) $row->cnt;
        }

        return $out;
    }

    /** @return array<int, array{count: int, hours: float}> */
    private function exchangesByCommunity(Builder $query): array
    {
        $out = [];
        foreach ($query->groupBy('tenant_id')->get(['tenant_id', DB::raw('COUNT(*) as cnt'), DB::raw('COALESCE(SUM(amount), 0) as hours')]) as $row) {
            $out[(int) $row->tenant_id] = ['count' => (int) $row->cnt, 'hours' => (float) $row->hours];
        }

        return $out;
    }
}
