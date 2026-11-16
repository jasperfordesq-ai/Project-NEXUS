<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Push notifications.
 *
 * Over the last N days (1 to 30, today included, server time = app timezone,
 * UTC), counts of `push_log` rows by `status` (see App\Models\PushLog::record):
 *
 *   accepted           `delivered`: the push service took it. 🔴 NOT "a phone
 *                      showed it" — the stored value is historical.
 *   partial            `partial`: some of the member's destinations took it,
 *                      some refused.
 *   failed             `failed`: every attempt was refused.
 *   nobody_to_send_to  `no_targets`: the member had no phone or browser
 *                      registered (per day only).
 *
 * `by_day` lists every day of the window, oldest first, zeros included, so a
 * quiet day is seen. `by_community` lists every community (zeros included,
 * plus any community id that has rows but no longer exists, with name null).
 * Rows with no community are `no_community`, so the per-community figures
 * plus that add up to the per-day figures.
 *
 * 🔴 Not every push is recorded: some senders (event reminders, emergency
 * alerts and others) do not write `push_log`. The figures are a floor; the
 * page says so.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, query builder only
 * (Eloquent models would scope to the caller's community). Correct only
 * because nothing below the platform team can call it. Counts only: `error`
 * (free text that may hold token fragments), `title`, `activity_type` and
 * `user_id` are never selected.
 *
 * The record is read as one unit. If it throws, the answer is
 * `available: false` and the reason is logged, not sent: an unreadable record
 * must never look like "nothing was sent".
 */
final class PushNotificationsService
{
    public const DEFAULT_DAYS = 14;
    public const MAX_DAYS = 30;

    /** push_log.status → the figure it counts towards. */
    private const STATUS_FIGURE = [
        'delivered' => 'accepted',
        'partial' => 'partial',
        'failed' => 'failed',
        'no_targets' => 'nobody_to_send_to',
    ];

    /** The number of days asked for, or null when it is not a whole number from 1 to 30. Empty means the default. */
    public static function parseDays(mixed $days): ?int
    {
        if ($days === null || $days === '') {
            return self::DEFAULT_DAYS;
        }
        if (is_int($days)) {
            $value = $days;
        } elseif (is_string($days) && preg_match('/^\d{1,2}$/', $days) === 1) {
            $value = (int) $days;
        } else {
            return null;
        }

        return $value >= 1 && $value <= self::MAX_DAYS ? $value : null;
    }

    /** @return array<string, mixed> */
    public function report(int $days): array
    {
        $result = $this->guarded(fn (): array => $this->read($days));

        if (!$result['available']) {
            return [
                'available' => false,
                'days' => $days,
                'by_day' => null,
                'by_community' => null,
                'no_community' => null,
            ];
        }

        return ['available' => true, 'days' => $days] + $result;
    }

    /**
     * Run the read. One that cannot be done answers `['available' => false]`
     * and nothing else: the reason goes to the log, never to the browser.
     *
     * @param callable(): array<string, mixed> $read
     * @return array<string, mixed>
     */
    public function guarded(callable $read): array
    {
        try {
            return ['available' => true] + $read();
        } catch (\Throwable $e) {
            Log::error('Platform team push notifications page: the record could not be read', [
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return ['available' => false];
        }
    }

    /** @return array{by_day: list<array<string, mixed>>, by_community: list<array<string, mixed>>, no_community: array{accepted: int, partial: int, failed: int}} */
    private function read(int $days): array
    {
        $from = now()->startOfDay()->subDays($days - 1);

        // 🔴 Cross-community on purpose (see the class comment). Counts only.
        $rows = DB::table('push_log')
            ->where('created_at', '>=', $from)
            ->whereIn('status', array_keys(self::STATUS_FIGURE))
            ->groupBy(DB::raw('DATE(created_at)'), 'tenant_id', 'status')
            ->get([DB::raw('DATE(created_at) as day'), 'tenant_id', 'status', DB::raw('COUNT(*) as n')]);

        $byDay = [];
        for ($i = 0; $i < $days; $i++) {
            $date = $from->copy()->addDays($i)->toDateString();
            $byDay[$date] = ['date' => $date, 'accepted' => 0, 'partial' => 0, 'failed' => 0, 'nobody_to_send_to' => 0];
        }
        $byCommunity = [];
        $noCommunity = self::noCounts();

        foreach ($rows as $row) {
            $figure = self::STATUS_FIGURE[(string) $row->status];
            $n = (int) $row->n;
            $date = Carbon::parse((string) $row->day)->toDateString();
            if (isset($byDay[$date])) {
                $byDay[$date][$figure] += $n;
            }
            if ($figure === 'nobody_to_send_to') {
                continue;
            }
            if ($row->tenant_id === null) {
                $noCommunity[$figure] += $n;
                continue;
            }
            $id = (int) $row->tenant_id;
            $byCommunity[$id] ??= self::noCounts();
            $byCommunity[$id][$figure] += $n;
        }

        $communities = [];
        $seen = [];
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name']) as $tenant) {
            $id = (int) $tenant->id;
            $seen[$id] = true;
            $communities[] = ['id' => $id, 'name' => (string) $tenant->name] + ($byCommunity[$id] ?? self::noCounts());
        }
        // Rows of a community that no longer exists: still listed, so the figures add up.
        $orphans = array_diff(array_keys($byCommunity), array_keys($seen));
        sort($orphans);
        foreach ($orphans as $id) {
            $communities[] = ['id' => (int) $id, 'name' => null] + $byCommunity[$id];
        }

        return [
            'by_day' => array_values($byDay),
            'by_community' => $communities,
            'no_community' => $noCommunity,
        ];
    }

    /** @return array{accepted: int, partial: int, failed: int} */
    private static function noCounts(): array
    {
        return ['accepted' => 0, 'partial' => 0, 'failed' => 0];
    }
}
