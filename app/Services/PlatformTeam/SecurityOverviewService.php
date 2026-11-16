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
 *   access_changes   who was given or lost senior access. Every recorded way:
 *                    - super admin panel (`super_admin_audit_log`): the four
 *                      grant/revoke actions, AND `user_created` /
 *                      `user_updated` / `user_moved` rows whose before/after
 *                      values show a super admin flag changing;
 *                    - a community's admin panel (`org_audit_log`):
 *                      `grant_/revoke_tenant_super_admin`,
 *                      `grant_/revoke_global_super_admin`, and
 *                      `admin_role_changed` to or from a platform role.
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
 * 🔴 Not recorded as a change to a person, so not shown: changes to
 * `users.is_god` (the platform team flag; it is set in the database), and
 * tenant super admin taken from everyone in a community at once when it stops
 * being a hub (`hub_toggled` names the community, not the people). The page
 * says so.
 *
 * 🔴 Names are the account's name NOW, joined from `users`, never the copy
 * `super_admin_audit_log` keeps as text (`actor_name`, `target_name`).
 * Erasure anonymises the account but does not scrub those copies, so showing
 * them would bring an erased person's name back (review, 16 Nov 2026).
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

    /** Super admin panel actions that may carry a super admin flag in their before/after values. */
    private const SUPER_PANEL_FLAG_ACTIONS = ['user_created', 'user_updated', 'user_moved'];

    /** flag in old_values/new_values => the kind of access it is */
    private const FLAGS = [
        'is_super_admin' => 'global_super_admin',
        'is_tenant_super_admin' => 'tenant_super_admin',
    ];

    private const COMMUNITY_PANEL_CHANGES = [
        'grant_tenant_super_admin' => 'tenant_super_admin_granted',
        'revoke_tenant_super_admin' => 'tenant_super_admin_removed',
        'grant_global_super_admin' => 'global_super_admin_granted',
        'revoke_global_super_admin' => 'global_super_admin_removed',
    ];

    /** Role strings that mean platform-wide access (App\Core\SuperPanelAccess, CrossTenantEntry). */
    private const PLATFORM_ROLES = ['super_admin', 'god'];

    /** How many candidate rows of the busy action types are looked through. */
    private const SCAN_LIMIT = 500;

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
        $all = collect();

        // ---- The super admin panel's log.
        $superPanel = static fn () => DB::table('super_admin_audit_log as a')
            ->leftJoin('users as actor', 'actor.id', '=', 'a.actor_user_id')
            ->leftJoin('users as target', static function ($join): void {
                $join->on('target.id', '=', 'a.target_id')->where('a.target_type', '=', 'user');
            })
            ->leftJoin('tenants as t', 't.id', '=', 'a.target_tenant_id')
            ->where('a.created_at', '>=', $since)
            ->orderByDesc('a.created_at')
            ->orderByDesc('a.id');
        $superColumns = [
            'a.created_at', 'a.action_type', 'a.old_values', 'a.new_values',
            self::fullName('actor', 'actor_name'), self::fullName('target', 'target_name'), 't.name as community',
        ];

        foreach ($superPanel()->whereIn('a.action_type', array_keys(self::SUPER_PANEL_CHANGES))->limit(self::LIST_LIMIT + 1)->get($superColumns) as $row) {
            $all->push(self::change($row, self::SUPER_PANEL_CHANGES[$row->action_type]));
        }
        // Creating, changing or moving an account can give or take the flag too.
        foreach ($superPanel()->whereIn('a.action_type', self::SUPER_PANEL_FLAG_ACTIONS)->limit(self::SCAN_LIMIT)->get($superColumns) as $row) {
            foreach (self::flagChanges($row->old_values, $row->new_values) as $change) {
                $all->push(self::change($row, $change));
            }
        }

        // ---- A community's own admin panel.
        $communityPanel = static fn () => DB::table('org_audit_log as a')
            ->leftJoin('users as actor', 'actor.id', '=', 'a.user_id')
            ->leftJoin('users as target', 'target.id', '=', 'a.target_user_id')
            ->leftJoin('tenants as t', 't.id', '=', 'a.tenant_id')
            ->where('a.created_at', '>=', $since)
            ->orderByDesc('a.created_at')
            ->orderByDesc('a.id');
        $communityColumns = [
            'a.created_at', 'a.action', 'a.details',
            self::fullName('actor', 'actor_name'), self::fullName('target', 'target_name'), 't.name as community',
        ];

        foreach ($communityPanel()->whereIn('a.action', array_keys(self::COMMUNITY_PANEL_CHANGES))->limit(self::LIST_LIMIT + 1)->get($communityColumns) as $row) {
            $all->push(self::change($row, self::COMMUNITY_PANEL_CHANGES[$row->action]));
        }
        // A role change to or from a platform role is the same grant by another door.
        $roleChanges = $communityPanel()
            ->where('a.action', 'admin_role_changed')
            ->where(static function ($q): void {
                foreach (self::PLATFORM_ROLES as $role) {
                    $q->orWhere('a.details', 'like', '%"' . $role . '"%');
                }
            })
            ->limit(self::SCAN_LIMIT)
            ->get($communityColumns);
        foreach ($roleChanges as $row) {
            $details = self::decode($row->details);
            $was = in_array($details['old_role'] ?? null, self::PLATFORM_ROLES, true);
            $is = in_array($details['new_role'] ?? null, self::PLATFORM_ROLES, true);
            if ($was !== $is) {
                $all->push(self::change($row, $is ? 'global_super_admin_granted' : 'global_super_admin_removed'));
            }
        }

        $all = $all->sortByDesc('at')->values();

        return [
            'items' => $all->take(self::LIST_LIMIT)
                ->map(static fn (array $item): array => ['at' => self::iso($item['at'])] + $item)
                ->all(),
            'truncated' => $all->count() > self::LIST_LIMIT,
        ];
    }

    /** @return array{at: string, change: string, by: ?string, account: ?string, community: ?string} */
    private static function change(object $row, string $change): array
    {
        return [
            'at' => (string) $row->created_at,
            'change' => $change,
            'by' => self::nameOrNull($row->actor_name),
            'account' => self::nameOrNull($row->target_name),
            'community' => self::nameOrNull($row->community),
        ];
    }

    /**
     * The super admin flags that changed between an audit row's before and
     * after values. A flag missing from the after values says nothing, so it
     * is not read as "removed".
     *
     * @return list<string>
     */
    private static function flagChanges(mixed $oldJson, mixed $newJson): array
    {
        $old = self::decode($oldJson);
        $new = self::decode($newJson);
        $changes = [];
        foreach (self::FLAGS as $flag => $kind) {
            if (!array_key_exists($flag, $new)) {
                continue;
            }
            $was = !empty($old[$flag]);
            $is = !empty($new[$flag]);
            if ($was !== $is) {
                $changes[] = $kind . ($is ? '_granted' : '_removed');
            }
        }

        return $changes;
    }

    /** @return array<string, mixed> */
    private static function decode(mixed $json): array
    {
        if (!is_string($json) || $json === '') {
            return [];
        }
        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
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
     * Two things make these numbers a floor, not a total, and the page says
     * both: a successful sign-in deletes that account's failed `email` rows
     * AND that address's failed `ip` rows (App\Core\RateLimiter); and every
     * sign-in through the accessible site arrives from that site's one server
     * address, so "most from one address" is often that server.
     *
     * The windows use the database's NOW(), as RateLimiter does when it writes
     * `attempted_at`. The other sections compare against PHP's now(); both
     * are UTC on this platform (`app.timezone` and the database session).
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
