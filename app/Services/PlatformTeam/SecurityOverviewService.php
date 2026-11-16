<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Security.
 *
 * Four things the platform already recorded and no page put side by side:
 *
 *   access_changes   who was given or lost senior access
 *                    (`super_admin_audit_log` from the super admin panel, and
 *                    `org_audit_log` rows `grant_/revoke_tenant_super_admin`
 *                    from a community's admin panel)
 *   impersonations   who signed in as another member
 *                    (`org_audit_log` rows `admin_user_impersonated`)
 *   failed_sign_ins  failed sign-in attempts, counted (`login_attempts`)
 *   two_step         senior accounts without two-step (SeniorAccountsService)
 *
 * 🔴 Read-only, and cross-community on purpose: no `tenant_id` filter. Correct
 * only because nothing below the platform team can call it.
 *
 * 🔴 What never leaves the server. The records read here hold email
 * addresses, IP addresses, browser details, before/after values and free
 * text. The page needs none of them, so none is selected into the response:
 * a person is a name, a place is a community's name, and an address is only
 * ever counted. `login_attempts` holds a digest of each email, never the
 * email; the digest is not sent either.
 *
 * 🔴 Not recorded anywhere, so not shown: changes to `users.is_god` (the
 * platform team flag). It is set in the database. The page says so.
 *
 * 🔴 `login_attempts` deletes an account's failed rows when that account next
 * signs in successfully (App\Core\RateLimiter). So the counts are "failed
 * attempts not yet followed by a successful sign-in", and the page says that
 * too rather than presenting them as every failure.
 *
 * Each section is read on its own. One that throws is reported as
 * `available: false` and its reason is logged, not sent: an unreadable record
 * must never look like "nothing happened".
 */
final class SecurityOverviewService
{
    /** How far back the two lists go. */
    public const WINDOW_DAYS = 90;

    /** Newest rows kept per list. */
    public const LIST_LIMIT = 50;

    private const SUPER_PANEL_CHANGES = [
        'super_admin_granted' => 'tenant_super_admin_granted',
        'super_admin_revoked' => 'tenant_super_admin_removed',
        'global_super_admin_granted' => 'global_super_admin_granted',
        'global_super_admin_revoked' => 'global_super_admin_removed',
    ];

    private const COMMUNITY_PANEL_CHANGES = [
        'grant_tenant_super_admin' => 'tenant_super_admin_granted',
        'revoke_tenant_super_admin' => 'tenant_super_admin_removed',
    ];

    /** @return array<string, mixed> */
    public function overview(): array
    {
        return [
            'generated_at' => now()->toIso8601String(),
            'window_days' => self::WINDOW_DAYS,
            'access_changes' => $this->guarded('access_changes', fn (): array => $this->accessChanges()),
            'impersonations' => $this->guarded('impersonations', fn (): array => $this->impersonations()),
            'failed_sign_ins' => $this->guarded('failed_sign_ins', fn (): array => $this->failedSignIns()),
            'two_step' => $this->guarded('two_step', fn (): array => $this->twoStep()),
        ];
    }

    /**
     * Run one section. A section that cannot be read answers
     * `['available' => false]` and nothing else: the reason can hold an
     * address or a query, so it goes to the log, never to the browser.
     *
     * @param callable(): array<string, mixed> $read
     * @return array<string, mixed>
     */
    public function guarded(string $section, callable $read): array
    {
        try {
            return ['available' => true] + $read();
        } catch (\Throwable $e) {
            Log::error('Platform team security page: a section could not be read', [
                'section' => $section,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return ['available' => false];
        }
    }

    /** @return array{items: array<int, array<string, mixed>>, truncated: bool} */
    private function accessChanges(): array
    {
        $since = now()->subDays(self::WINDOW_DAYS);

        $fromSuperPanel = DB::table('super_admin_audit_log as a')
            ->leftJoin('tenants as t', 't.id', '=', 'a.target_tenant_id')
            ->whereIn('a.action_type', array_keys(self::SUPER_PANEL_CHANGES))
            ->where('a.created_at', '>=', $since)
            ->orderByDesc('a.created_at')
            ->orderByDesc('a.id')
            ->limit(self::LIST_LIMIT + 1)
            ->get(['a.created_at', 'a.action_type', 'a.actor_name', 'a.target_name', 't.name as community'])
            ->map(static fn (object $row): array => [
                'at' => (string) $row->created_at,
                'change' => self::SUPER_PANEL_CHANGES[$row->action_type],
                'by' => self::nameOrNull($row->actor_name),
                'account' => self::nameOrNull($row->target_name),
                'community' => self::nameOrNull($row->community),
            ]);

        $fromCommunityPanel = DB::table('org_audit_log as a')
            ->leftJoin('users as actor', 'actor.id', '=', 'a.user_id')
            ->leftJoin('users as target', 'target.id', '=', 'a.target_user_id')
            ->leftJoin('tenants as t', 't.id', '=', 'a.tenant_id')
            ->whereIn('a.action', array_keys(self::COMMUNITY_PANEL_CHANGES))
            ->where('a.created_at', '>=', $since)
            ->orderByDesc('a.created_at')
            ->orderByDesc('a.id')
            ->limit(self::LIST_LIMIT + 1)
            ->get(['a.created_at', 'a.action', self::fullName('actor', 'actor_name'), self::fullName('target', 'target_name'), 't.name as community'])
            ->map(static fn (object $row): array => [
                'at' => (string) $row->created_at,
                'change' => self::COMMUNITY_PANEL_CHANGES[$row->action],
                'by' => self::nameOrNull($row->actor_name),
                'account' => self::nameOrNull($row->target_name),
                'community' => self::nameOrNull($row->community),
            ]);

        $all = $fromSuperPanel->concat($fromCommunityPanel)->sortByDesc('at')->values();

        return [
            'items' => $all->take(self::LIST_LIMIT)
                ->map(static fn (array $item): array => ['at' => self::iso($item['at'])] + $item)
                ->all(),
            'truncated' => $all->count() > self::LIST_LIMIT,
        ];
    }

    /** @return array{items: array<int, array<string, mixed>>, truncated: bool} */
    private function impersonations(): array
    {
        $rows = DB::table('org_audit_log as a')
            ->leftJoin('users as actor', 'actor.id', '=', 'a.user_id')
            ->leftJoin('users as target', 'target.id', '=', 'a.target_user_id')
            ->leftJoin('tenants as t', 't.id', '=', 'a.tenant_id')
            ->where('a.action', 'admin_user_impersonated')
            ->where('a.created_at', '>=', now()->subDays(self::WINDOW_DAYS))
            ->orderByDesc('a.created_at')
            ->orderByDesc('a.id')
            ->limit(self::LIST_LIMIT + 1)
            ->get(['a.created_at', self::fullName('actor', 'actor_name'), self::fullName('target', 'target_name'), 't.name as community']);

        return [
            'items' => $rows->take(self::LIST_LIMIT)
                ->map(static fn (object $row): array => [
                    'at' => self::iso((string) $row->created_at),
                    'by' => self::nameOrNull($row->actor_name),
                    'member' => self::nameOrNull($row->target_name),
                    'community' => self::nameOrNull($row->community),
                ])
                ->all(),
            'truncated' => $rows->count() > self::LIST_LIMIT,
        ];
    }

    /**
     * Counts only. Every failed sign-in writes one `email` row (identifier
     * `tenant:<id>:email:<digest>`) and one `ip` row, so attempts are counted
     * on the `email` rows and addresses on the `ip` rows, never both.
     *
     * @return array<string, mixed>
     */
    private function failedSignIns(): array
    {
        $totals = DB::selectOne(
            "SELECT
                COALESCE(SUM(attempted_at > (NOW() - INTERVAL 1 HOUR)), 0) AS last_hour,
                COUNT(*) AS last_24h
             FROM login_attempts
             WHERE type = 'email' AND success = 0 AND attempted_at > (NOW() - INTERVAL 24 HOUR)"
        );

        $addresses = DB::selectOne(
            "SELECT COUNT(*) AS addresses, COALESCE(MAX(c), 0) AS most
             FROM (
                SELECT COUNT(*) AS c
                FROM login_attempts
                WHERE type = 'ip' AND success = 0 AND attempted_at > (NOW() - INTERVAL 24 HOUR)
                GROUP BY identifier
             ) per_address"
        );

        $byCommunity = DB::select(
            "SELECT tenant_id, SUM(c) AS failed, COUNT(*) AS accounts_tried, MAX(c) AS most_on_one_account, MAX(last_at) AS last_at
             FROM (
                SELECT
                    CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(identifier, ':', 2), ':', -1) AS UNSIGNED) AS tenant_id,
                    COUNT(*) AS c,
                    MAX(attempted_at) AS last_at
                FROM login_attempts
                WHERE type = 'email' AND success = 0 AND attempted_at > (NOW() - INTERVAL 24 HOUR)
                  AND identifier LIKE 'tenant:%'
                GROUP BY identifier
             ) per_account
             GROUP BY tenant_id
             ORDER BY failed DESC, tenant_id ASC
             LIMIT 100"
        );

        $names = DB::table('tenants')
            ->whereIn('id', array_map(static fn (object $row): int => (int) $row->tenant_id, $byCommunity) ?: [0])
            ->pluck('name', 'id');

        return [
            'last_hour' => (int) ($totals->last_hour ?? 0),
            'last_24h' => (int) ($totals->last_24h ?? 0),
            'addresses_24h' => (int) ($addresses->addresses ?? 0),
            'most_from_one_address_24h' => (int) ($addresses->most ?? 0),
            'by_community' => array_map(static function (object $row) use ($names): array {
                $tenantId = (int) $row->tenant_id;

                return [
                    // Tenant 0 is the scheme's "no community" bucket.
                    'community' => $tenantId > 0
                        ? ['id' => $tenantId, 'name' => self::nameOrNull($names[$tenantId] ?? null)]
                        : null,
                    'failed' => (int) $row->failed,
                    'accounts_tried' => (int) $row->accounts_tried,
                    'most_on_one_account' => (int) $row->most_on_one_account,
                    'last_at' => $row->last_at !== null ? self::iso((string) $row->last_at) : null,
                ];
            }, $byCommunity),
        ];
    }

    /** @return array{senior_total: int, without_two_step: int} */
    private function twoStep(): array
    {
        $accounts = (new SeniorAccountsService())->list()['accounts'];

        return [
            'senior_total' => count($accounts),
            'without_two_step' => count(array_filter(
                $accounts,
                static fn (array $account): bool => empty($account['two_step_on']),
            )),
        ];
    }

    /**
     * A person's full name, by the platform's one display-name rule. Full,
     * because only the platform team can reach this (the strictest admin gate).
     */
    private static function fullName(string $alias, string $as): \Illuminate\Contracts\Database\Query\Expression
    {
        return DB::raw(UserDisplayName::sqlFull($alias, $as, NameReason::ADMIN_ROUTE));
    }

    private static function nameOrNull(mixed $value): ?string
    {
        $name = trim((string) ($value ?? ''));

        return $name !== '' ? $name : null;
    }

    private static function iso(string $databaseTime): string
    {
        return Carbon::parse($databaseTime)->toIso8601String();
    }
}
