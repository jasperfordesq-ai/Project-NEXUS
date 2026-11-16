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
 * Platform team panel → Access review.
 *
 * Every so often the platform team goes through the senior accounts (as
 * SeniorAccountsService lists them) and records, for each one, "keep" or
 * "should be removed". One header row in `senior_access_reviews` and exactly
 * one line per account in `senior_access_review_items`, in one transaction.
 *
 * 🔴 A review is a RECORD. It changes nobody's access, and nothing should be
 * added here that does. Access is removed elsewhere (the super admin panel for
 * super admins; the database for the platform team); the next review shows
 * what was marked and is still there.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the senior
 * accounts of every community are reviewed together. Correct only because
 * nothing below the platform team can call it. Query builder, never a model.
 *
 * 🔴 Ids only in the record. Names are read from `users` when shown; an
 * erased account (or one whose row is gone) is shown without a name. The two
 * tables are append-only by database trigger.
 *
 * A review is due when there has never been one, or the newest is more than
 * DUE_AFTER_DAYS days old (Ruling, design brief 16 Nov 2026).
 */
final class AccessReviewService
{
    public const DUE_AFTER_DAYS = 90;

    public const HISTORY_LIMIT = 10;

    public const NOTE_MAX = 500;

    public const DECISIONS = ['keep', 'remove'];

    public const DONE = 'done';

    public const LIST_CHANGED = 'list_changed';

    public const FAILED = 'failed';

    public function __construct(private readonly SeniorAccountsService $senior = new SeniorAccountsService())
    {
    }

    /**
     * The decisions as user id => decision, or null when the input is not a
     * list of `{user_id, decision}` with whole-number ids, a known decision
     * and each account once.
     *
     * @return array<int, string>|null
     */
    public static function cleanDecisions(mixed $value): ?array
    {
        if (!is_array($value) || !array_is_list($value)) {
            return null;
        }

        $decisions = [];
        foreach ($value as $entry) {
            if (!is_array($entry)) {
                return null;
            }
            $id = $entry['user_id'] ?? null;
            if (is_string($id) && ctype_digit($id)) {
                $id = (int) $id;
            }
            $decision = $entry['decision'] ?? null;
            if (!is_int($id) || $id < 1 || !in_array($decision, self::DECISIONS, true) || isset($decisions[$id])) {
                return null;
            }
            $decisions[$id] = $decision;
        }

        return $decisions;
    }

    /**
     * The note, trimmed; null when there is none; false when it is not text or
     * is longer than NOTE_MAX characters.
     */
    public static function cleanNote(mixed $value): string|null|false
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value)) {
            return false;
        }
        $note = trim($value);
        if ($note === '') {
            return null;
        }

        return mb_strlen($note) <= self::NOTE_MAX ? $note : false;
    }

    /**
     * Everything the page shows.
     *
     * @return array{
     *   due: bool,
     *   days_since_last: int|null,
     *   last_review: array<string, mixed>|null,
     *   accounts: list<array<string, mixed>>,
     *   history: list<array<string, mixed>>,
     *   open_removals: list<array<string, mixed>>
     * }
     */
    public function overview(): array
    {
        $accounts = array_map(static fn (array $a): array => [
            'id' => $a['id'],
            'name' => $a['name'],
            'level' => $a['level'],
            'community' => $a['community'],
            'status' => $a['status'],
            'last_sign_in_at' => $a['last_sign_in_at'],
            'two_step_on' => $a['two_step_on'],
        ], $this->senior->list()['accounts']);

        $rows = DB::table('senior_access_reviews')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::HISTORY_LIMIT)
            ->get(['id', 'reviewed_by', 'account_count', 'remove_count', 'created_at']);

        $names = $this->namesNow($rows->pluck('reviewed_by')->map(static fn ($id): int => (int) $id)->all());

        $history = [];
        foreach ($rows as $row) {
            $history[] = [
                'id' => (int) $row->id,
                'at' => Carbon::parse((string) $row->created_at)->toIso8601String(),
                // Read now, never stored: an erased reviewer has no name to show.
                'by_name' => $names[(int) $row->reviewed_by] ?? null,
                'account_count' => (int) $row->account_count,
                'remove_count' => (int) $row->remove_count,
            ];
        }

        $last = $history[0] ?? null;
        $days = $last === null ? null : self::daysSince((string) $rows[0]->created_at);

        $openRemovals = [];
        if ($last !== null) {
            $marked = DB::table('senior_access_review_items')
                ->where('review_id', $last['id'])
                ->where('decision', 'remove')
                ->pluck('user_id')
                ->map(static fn ($id): int => (int) $id)
                ->flip();
            foreach ($accounts as $account) {
                if ($marked->has($account['id'])) {
                    $openRemovals[] = [
                        'id' => $account['id'],
                        'name' => $account['name'],
                        'level' => $account['level'],
                        'community' => $account['community'],
                    ];
                }
            }
        }

        return [
            'due' => $days === null || $days > self::DUE_AFTER_DAYS,
            'days_since_last' => $days,
            'last_review' => $last,
            'accounts' => $accounts,
            'history' => $history,
            'open_removals' => $openRemovals,
        ];
    }

    /**
     * Whether a review is due, for the home page card.
     *
     * @return array{due: bool, last_review_at: string|null}
     */
    public function dueStatus(): array
    {
        $newest = DB::table('senior_access_reviews')->max('created_at');
        if ($newest === null) {
            return ['due' => true, 'last_review_at' => null];
        }

        return [
            'due' => self::daysSince((string) $newest) > self::DUE_AFTER_DAYS,
            'last_review_at' => Carbon::parse((string) $newest)->toIso8601String(),
        ];
    }

    /**
     * Record one review. The senior list is read again here, and the review is
     * refused unless the decisions cover exactly that list.
     *
     * @param array<int, string> $decisions user id => 'keep' | 'remove'
     * @return self::DONE|self::LIST_CHANGED|self::FAILED
     */
    public function record(int $actorId, array $decisions, ?string $note): string
    {
        try {
            return DB::transaction(function () use ($actorId, $decisions, $note): string {
                $accounts = $this->senior->list()['accounts'];

                $current = array_map(static fn (array $a): int => (int) $a['id'], $accounts);
                $given = array_keys($decisions);
                sort($current);
                sort($given);
                if ($current !== $given) {
                    return self::LIST_CHANGED;
                }

                $now = now();
                $removeCount = count(array_filter($decisions, static fn (string $d): bool => $d === 'remove'));

                $reviewId = (int) DB::table('senior_access_reviews')->insertGetId([
                    'reviewed_by' => $actorId,
                    'note' => $note,
                    'account_count' => count($accounts),
                    'remove_count' => $removeCount,
                    'created_at' => $now,
                ]);

                $lines = [];
                foreach ($accounts as $account) {
                    $lines[] = [
                        'review_id' => $reviewId,
                        'user_id' => (int) $account['id'],
                        // From the server's own list, never from the browser.
                        'level' => (string) $account['level'],
                        'community_id' => $account['community']['id'] ?? null,
                        'decision' => $decisions[(int) $account['id']],
                        'created_at' => $now,
                    ];
                }
                foreach (array_chunk($lines, 200) as $chunk) {
                    DB::table('senior_access_review_items')->insert($chunk);
                }

                return self::DONE;
            });
        } catch (\Throwable $e) {
            // Rolled back: no review and no line was recorded.
            Log::error('Platform team: an access review could not be recorded', [
                'actor' => $actorId,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return self::FAILED;
        }
    }

    /** Whole days since a stored time, never negative. */
    private static function daysSince(string $at): int
    {
        return max(0, (int) floor(Carbon::parse($at)->diffInDays(now(), false)));
    }

    /**
     * Current full names of the accounts that still exist and are not erased.
     *
     * @param list<int> $ids
     * @return array<int, string>
     */
    private function namesNow(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $names = [];
        $rows = DB::table('users as u')
            ->whereIn('u.id', array_values(array_unique($ids)))
            ->whereNull('u.anonymized_at')
            ->get([
                'u.id', 'u.name',
                // Full, because only the platform team can reach this.
                DB::raw(UserDisplayName::sqlFull('u', 'display_name', NameReason::ADMIN_ROUTE)),
            ]);
        foreach ($rows as $row) {
            $name = trim((string) ($row->display_name ?? ''));
            if ($name === '') {
                $name = trim((string) ($row->name ?? ''));
            }
            if ($name !== '') {
                $names[(int) $row->id] = $name;
            }
        }

        return $names;
    }
}
