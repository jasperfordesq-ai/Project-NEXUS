<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * A shared community goal (warmth phase 6, D1).
 *
 * The community's admin sets ONE goal on "Make it yours" ("Let's share 500
 * hours by spring"): a title, what counts, a target and dates. Members see the
 * whole community's progress on their dashboard. Ending a goal, or its end
 * date passing, keeps it as "What we've done together".
 *
 * No schema of its own. Stored in tenants.configuration:
 *   community_goal       {id, title, metric, target, starts_on, ends_on}
 *   community_goals_done [{id, title, metric, target, final_count,
 *                          starts_on, ends_on, ended_on}], newest first, max 12
 *
 * Progress is counted from existing tables, for ONE community, between the
 * start date and now (or the end date): community totals only, never a figure
 * for one member. Nothing here writes on a member's read: a goal whose end date
 * has passed is shown as finished, and is filed with its final count the next
 * time the admin sets or ends a goal.
 */
final class CommunityGoalService
{
    /** What a goal can count. */
    public const METRICS = ['hours', 'exchanges', 'offers', 'events'];

    public const TITLE_MAX = 120;
    public const TARGET_MAX = 1000000;
    /** Two years, a leap day included. */
    public const MAX_SPAN_DAYS = 731;
    /** Finished goals kept in the configuration. */
    public const DONE_KEPT = 12;
    /** Finished goals members see. */
    public const DONE_SHOWN = 3;

    private const CACHE_SECONDS = 300;

    /** The hand-overs `hours_shared` adds up (FeedSidebarController::thisMonth). */
    private const HAND_OVERS = ['exchange', 'transfer'];

    /**
     * Check what the admin sent. Returns [goal, null] for a goal that may be
     * kept (id not yet given), or [null, field] naming the first bad field.
     *
     * @param array<string, mixed> $input
     * @return array{0: ?array{title: string, metric: string, target: int, starts_on: string, ends_on: string}, 1: ?string}
     */
    public static function validate(array $input, string $today): array
    {
        $title = self::cleanTitle($input['title'] ?? null);
        if ($title === null) {
            return [null, 'title'];
        }

        $metric = $input['metric'] ?? null;
        if (!is_string($metric) || !in_array($metric, self::METRICS, true)) {
            return [null, 'metric'];
        }

        $target = self::wholeNumber($input['target'] ?? null);
        if ($target === null || $target < 1 || $target > self::TARGET_MAX) {
            return [null, 'target'];
        }

        $startsOn = self::realDate($input['starts_on'] ?? null);
        if ($startsOn === null || $startsOn > $today) {
            return [null, 'starts_on'];
        }

        $endsOn = self::realDate($input['ends_on'] ?? null);
        if ($endsOn === null || $endsOn < $today || $endsOn <= $startsOn || self::daysBetween($startsOn, $endsOn) > self::MAX_SPAN_DAYS) {
            return [null, 'ends_on'];
        }

        return [[
            'title' => $title,
            'metric' => $metric,
            'target' => $target,
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
        ], null];
    }

    /**
     * Save the goal. Changing a goal that is still running keeps its id; a
     * goal whose end date has passed is filed as done (with its final count)
     * and the new one gets a new id. The row is locked so a colour or date
     * saved at the same moment is not lost.
     *
     * @param array{title: string, metric: string, target: int, starts_on: string, ends_on: string} $goal
     * @return array<string, mixed> the goal as the admin screen shows it
     */
    public static function set(int $tenantId, array $goal): array
    {
        $today = now()->toDateString();

        $saved = DB::transaction(function () use ($tenantId, $goal, $today): array {
            $config = self::lockedConfig($tenantId);
            $existing = self::storedGoal($config['community_goal'] ?? null);

            if ($existing !== null && $existing['ends_on'] < $today) {
                self::file($config, $tenantId, $existing, $existing['ends_on']);
                $existing = null;
            }

            $saved = ['id' => $existing['id'] ?? bin2hex(random_bytes(6))] + $goal;
            $config['community_goal'] = $saved;
            self::writeConfig($tenantId, $config);

            return $saved;
        });

        return self::adminView($tenantId, $saved);
    }

    /** End the goal now, keeping it as done with its final count. False when there was none. */
    public static function end(int $tenantId): bool
    {
        $today = now()->toDateString();

        return DB::transaction(function () use ($tenantId, $today): bool {
            $config = self::lockedConfig($tenantId);
            $existing = self::storedGoal($config['community_goal'] ?? null);
            unset($config['community_goal']);
            if ($existing === null) {
                return false;
            }

            self::file($config, $tenantId, $existing, min($today, $existing['ends_on']));
            self::writeConfig($tenantId, $config);

            return true;
        });
    }

    /**
     * The goal as the admin's "Make it yours" page shows it, or null.
     *
     * @param array<string, mixed>|null $goal a goal just saved; read from the configuration when null
     * @return array<string, mixed>|null
     */
    public static function adminView(int $tenantId, ?array $goal = null): ?array
    {
        $goal ??= self::storedGoal(self::config($tenantId)['community_goal'] ?? null);
        if ($goal === null) {
            return null;
        }
        $current = self::count($tenantId, $goal);

        return $goal + [
            'current' => $current,
            'reached' => $current >= $goal['target'],
            'finished' => $goal['ends_on'] < now()->toDateString(),
        ];
    }

    /**
     * What a member's dashboard shows: the running goal (or null) and up to
     * three finished goals the community did something towards.
     *
     * @return array{community_goal: ?array<string, mixed>, community_goals_done: list<array<string, mixed>>}
     */
    public static function memberView(int $tenantId): array
    {
        $today = now()->toDateString();
        $config = self::config($tenantId);
        $goal = self::storedGoal($config['community_goal'] ?? null);

        $done = [];
        $running = null;
        if ($goal !== null && $goal['ends_on'] < $today) {
            // Finished but not yet filed: shown as done, nothing is written.
            $done[] = self::doneEntry($goal, self::count($tenantId, $goal), $goal['ends_on']);
        } elseif ($goal !== null) {
            $current = self::count($tenantId, $goal);
            $running = [
                'id' => $goal['id'],
                'title' => $goal['title'],
                'metric' => $goal['metric'],
                'target' => $goal['target'],
                'current' => $current,
                'starts_on' => $goal['starts_on'],
                'ends_on' => $goal['ends_on'],
                'days_left' => self::daysBetween($today, $goal['ends_on']),
                'reached' => $current >= $goal['target'],
            ];
        }

        foreach (self::storedDone($config['community_goals_done'] ?? null) as $entry) {
            $done[] = $entry;
        }

        $shown = [];
        foreach ($done as $entry) {
            if ($entry['final_count'] <= 0) {
                continue; // nothing to celebrate
            }
            $shown[] = [
                'id' => $entry['id'],
                'title' => $entry['title'],
                'metric' => $entry['metric'],
                'target' => $entry['target'],
                'final_count' => $entry['final_count'],
                'reached' => $entry['final_count'] >= $entry['target'],
                'starts_on' => $entry['starts_on'],
                'ends_on' => $entry['ends_on'],
            ];
            if (count($shown) >= self::DONE_SHOWN) {
                break;
            }
        }

        return ['community_goal' => $running, 'community_goals_done' => $shown];
    }

    /**
     * The running goal for the signed-out front page (GET /v2/platform/stats):
     * its name, what it counts, the target and the community's total so far.
     * No id and no dates. Null when no goal is running.
     *
     * @return array{title: string, metric: string, target: int, current: float|int}|null
     */
    public static function publicView(int $tenantId): ?array
    {
        $goal = self::storedGoal(self::config($tenantId)['community_goal'] ?? null);
        if ($goal === null || $goal['ends_on'] < now()->toDateString()) {
            return null;
        }

        return [
            'title' => $goal['title'],
            'metric' => $goal['metric'],
            'target' => $goal['target'],
            'current' => self::count($tenantId, $goal),
        ];
    }

    /**
     * The community's progress towards a goal, between its start date and
     * now (or its end date). Hours keep two decimals; the rest are whole.
     * Cached briefly per goal; a changed metric or dates is a new cache key.
     *
     * @param array{id: string, metric: string, starts_on: string, ends_on: string} $goal
     */
    public static function count(int $tenantId, array $goal, bool $fresh = false): float|int
    {
        $key = "community_goal_count:{$tenantId}:{$goal['id']}:{$goal['metric']}:{$goal['starts_on']}:{$goal['ends_on']}";
        $compute = static fn (): float|int => self::countNow($tenantId, $goal);

        return $fresh ? $compute() : Cache::remember($key, self::CACHE_SECONDS, $compute);
    }

    /** @param array{metric: string, starts_on: string, ends_on: string} $goal */
    private static function countNow(int $tenantId, array $goal): float|int
    {
        $from = $goal['starts_on'] . ' 00:00:00';
        $endOfGoal = Carbon::parse($goal['ends_on'])->endOfDay();
        $until = now()->lessThan($endOfGoal) ? now()->toDateTimeString() : $endOfGoal->toDateTimeString();

        switch ($goal['metric']) {
            case 'hours':
                return round((float) self::handOvers($tenantId, $from, $until)->sum('amount'), 2);

            case 'exchanges':
                return (int) self::handOvers($tenantId, $from, $until)->count();

            case 'offers':
                // Offers and requests posted, as the month highlight counts them.
                return (int) DB::table('listings')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('status', ['active', 'completed'])
                    ->whereBetween('created_at', [$from, $until])
                    ->count();

            case 'events':
                // Events held: started by now, published, not cancelled,
                // postponed or a draft, and never a recurring template.
                return (int) DB::table('events')
                    ->where('tenant_id', $tenantId)
                    ->where(static fn ($q) => $q->whereNull('is_recurring_template')->orWhere('is_recurring_template', 0))
                    ->where(static fn ($q) => $q->whereNull('status')->orWhereIn('status', ['active', 'completed']))
                    ->where(static fn ($q) => $q->whereNull('publication_status')->orWhere('publication_status', 'published'))
                    ->where(static fn ($q) => $q->whereNull('operational_status')->orWhereIn('operational_status', ['scheduled', 'completed']))
                    ->whereBetween('start_time', [$from, $until])
                    ->count();
        }

        return 0;
    }

    /** Completed member-to-member hand-overs — the rows `hours_shared` adds up. */
    private static function handOvers(int $tenantId, string $from, string $until): \Illuminate\Database\Query\Builder
    {
        return DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->whereIn('transaction_type', self::HAND_OVERS)
            ->where('status', 'completed')
            ->whereBetween('created_at', [$from, $until]);
    }

    /**
     * Put a finished goal at the top of the done list, with its final count.
     *
     * @param array<string, mixed> $config
     * @param array{id: string, title: string, metric: string, target: int, starts_on: string, ends_on: string} $goal
     */
    private static function file(array &$config, int $tenantId, array $goal, string $endedOn): void
    {
        $done = self::storedDone($config['community_goals_done'] ?? null);
        array_unshift($done, self::doneEntry($goal, self::count($tenantId, $goal, true), $endedOn));
        $config['community_goals_done'] = array_slice($done, 0, self::DONE_KEPT);
    }

    /**
     * @param array{id: string, title: string, metric: string, target: int, starts_on: string, ends_on: string} $goal
     * @return array<string, mixed>
     */
    private static function doneEntry(array $goal, float|int $final, string $endedOn): array
    {
        return [
            'id' => $goal['id'],
            'title' => $goal['title'],
            'metric' => $goal['metric'],
            'target' => $goal['target'],
            'final_count' => $final,
            'starts_on' => $goal['starts_on'],
            'ends_on' => $goal['ends_on'],
            'ended_on' => $endedOn,
        ];
    }

    /**
     * A stored goal, checked again before use — never trusted as stored.
     *
     * @return array{id: string, title: string, metric: string, target: int, starts_on: string, ends_on: string}|null
     */
    private static function storedGoal(mixed $raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }
        $id = $raw['id'] ?? null;
        $title = self::cleanTitle($raw['title'] ?? null);
        $metric = $raw['metric'] ?? null;
        $target = self::wholeNumber($raw['target'] ?? null);
        $startsOn = self::realDate($raw['starts_on'] ?? null);
        $endsOn = self::realDate($raw['ends_on'] ?? null);
        if (!is_string($id) || preg_match('/^[a-f0-9]{12}$/', $id) !== 1 || $title === null
            || !in_array($metric, self::METRICS, true) || $target === null || $target < 1
            || $startsOn === null || $endsOn === null || $endsOn <= $startsOn) {
            return null;
        }

        return ['id' => $id, 'title' => $title, 'metric' => $metric, 'target' => $target, 'starts_on' => $startsOn, 'ends_on' => $endsOn];
    }

    /** @return list<array<string, mixed>> */
    private static function storedDone(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $done = [];
        foreach ($raw as $entry) {
            $goal = self::storedGoal($entry);
            $final = is_array($entry) ? ($entry['final_count'] ?? null) : null;
            $endedOn = is_array($entry) ? self::realDate($entry['ended_on'] ?? null) : null;
            if ($goal === null || !(is_int($final) || is_float($final)) || $final < 0) {
                continue;
            }
            $done[] = self::doneEntry($goal, $final, $endedOn ?? $goal['ends_on']);
        }

        return array_slice($done, 0, self::DONE_KEPT);
    }

    /** Plain text: control characters become spaces, runs of space one space. */
    private static function cleanTitle(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $clean = preg_replace('/[\p{Cc}\s]+/u', ' ', $value);
        if (!is_string($clean)) {
            return null; // not valid UTF-8
        }
        $clean = trim($clean);
        $length = mb_strlen($clean);

        return ($length >= 1 && $length <= self::TITLE_MAX) ? $clean : null;
    }

    private static function wholeNumber(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) <= self::TARGET_MAX * 10) {
            return (int) $value;
        }
        if (is_string($value) && preg_match('/^\d{1,8}$/', $value) === 1) {
            return (int) $value;
        }

        return null;
    }

    private static function realDate(mixed $value): ?string
    {
        if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            return null;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $value : null;
    }

    private static function daysBetween(string $from, string $to): int
    {
        return (int) round(Carbon::parse($from)->startOfDay()->diffInDays(Carbon::parse($to)->startOfDay(), false));
    }

    /** @return array<string, mixed> */
    private static function config(int $tenantId): array
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($config) ? $config : [];
    }

    /** @return array<string, mixed> */
    private static function lockedConfig(int $tenantId): array
    {
        $row = DB::selectOne('SELECT configuration FROM tenants WHERE id = ? FOR UPDATE', [$tenantId]);
        if (!$row || empty($row->configuration)) {
            return [];
        }
        $decoded = json_decode((string) $row->configuration, true);
        if (!is_array($decoded)) {
            // Never replace settings we could not read with a one-key object.
            throw new \RuntimeException('Community settings could not be read; the goal was not saved.');
        }

        return $decoded;
    }

    /** @param array<string, mixed> $config */
    private static function writeConfig(int $tenantId, array $config): void
    {
        DB::update('UPDATE tenants SET configuration = ? WHERE id = ?', [json_encode($config), $tenantId]);
    }
}
