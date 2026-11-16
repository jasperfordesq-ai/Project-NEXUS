<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Console\Commands\BackupVerify;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Assurance facts: facts the platform can measure about
 * itself today, for the platform team to read and check before quoting.
 *
 * Every fact is read through the service that already owns it (the home
 * page's release card, the senior accounts list, the access review, the
 * backup check's verdict, the data requests totals, the failed sign-in
 * record). Nothing here measures anything new.
 *
 * 🔴 Each fact is read inside its own guard: one that throws is
 * `available: false` for that fact only (logged at `error` with the fact's key
 * and the exception class), and the others still answer. "Could not be read"
 * is never a zero or a tick.
 *
 * 🔴 Counts, dates and states only. No member, email, community name or
 * account id leaves this class. No customer is named and nothing here makes a
 * claim: it says what was measured and when.
 *
 * 🔴 The date of the last independent security test is never in the code: it
 * comes only from `platform_team.last_independent_test_on`, which the owner
 * sets on the server. A malformed or future value is treated as not recorded.
 *
 * 🔴 Cross-community on purpose (the senior accounts list, the data requests
 * totals and the failed sign-in record span every community). The one caller
 * is platform-team only: AssuranceFactsController.
 */
final class AssuranceFactsService
{
    /** The seven facts, in the order the page shows them. */
    public const KEYS = ['release', 'two_step', 'access_review', 'backup', 'data_requests', 'failed_sign_ins', 'independent_test'];

    /** The value fields of each fact (besides `key` and `available`). */
    private const VALUES = [
        'release' => ['version', 'commit_short', 'deployed_at'],
        'two_step' => ['senior_accounts', 'with_two_step', 'truncated'],
        'access_review' => ['last_review_at', 'due'],
        'backup' => ['state', 'newest_at', 'checked_at'],
        'data_requests' => ['open', 'overdue'],
        'failed_sign_ins' => ['counted_since'],
        'independent_test' => ['date'],
    ];

    /** The verdict states BackupVerify writes; anything else is passed on as `other`. */
    private const BACKUP_STATES = ['healthy', 'stale', 'missing', 'empty', 'unreadable'];

    /** @var array<string, \Closure(): mixed> */
    private readonly array $sources;

    /**
     * @param array<string, \Closure(): mixed> $sources Only a test passes this, to
     *        replace one source (keys: release, senior_accounts, access_review,
     *        backup_verdict, data_request_totals, counted_since, independent_test_on).
     */
    public function __construct(array $sources = [])
    {
        $this->sources = $sources + [
            'release' => static fn (): array => app(PlatformHealthService::class)->release(),
            'senior_accounts' => static fn (): array => (new SeniorAccountsService())->list(),
            'access_review' => static fn (): array => app(AccessReviewService::class)->dueStatus(),
            'backup_verdict' => static fn (): mixed => Cache::get(BackupVerify::VERDICT_KEY),
            'data_request_totals' => static fn (): array => (new DataRequestsService())->overview()['totals'],
            // As SecurityOverviewService::failedSignIns() reads `counted_since`.
            'counted_since' => static fn (): mixed => DB::selectOne('SELECT MIN(hour_start) AS since FROM sign_in_failure_hours')->since ?? null,
            'independent_test_on' => static fn (): mixed => config('platform_team.last_independent_test_on'),
        ];
    }

    /**
     * @return array{generated_at: string, facts: list<array<string, mixed>>}
     */
    public function facts(): array
    {
        return [
            'generated_at' => Carbon::now()->toIso8601String(),
            'facts' => [
                $this->guarded('release', fn (): array => $this->release()),
                $this->guarded('two_step', fn (): array => $this->twoStep()),
                $this->guarded('access_review', fn (): array => $this->accessReview()),
                $this->guarded('backup', fn (): ?array => $this->backup()),
                $this->guarded('data_requests', fn (): array => $this->dataRequests()),
                $this->guarded('failed_sign_ins', fn (): array => $this->failedSignIns()),
                $this->guarded('independent_test', fn (): array => $this->independentTest()),
            ],
        ];
    }

    /**
     * @param \Closure(): (array<string, mixed>|null) $read null = not available, without an error
     * @return array<string, mixed>
     */
    private function guarded(string $key, \Closure $read): array
    {
        $empty = array_fill_keys(self::VALUES[$key], null);

        try {
            $values = $read();
        } catch (\Throwable $e) {
            // Not a success-shaped value: the fact says plainly that it could not be read.
            Log::error('[AssuranceFacts] a fact could not be read', [
                'fact' => $key,
                'exception' => $e::class,
            ]);

            return ['key' => $key, 'available' => false] + $empty;
        }

        if ($values === null) {
            return ['key' => $key, 'available' => false] + $empty;
        }

        // Only the fields this fact is allowed to send, in a fixed order.
        return ['key' => $key, 'available' => true] + array_intersect_key($values + $empty, $empty);
    }

    private function source(string $name): mixed
    {
        return ($this->sources[$name])();
    }

    /** @return array<string, mixed> */
    private function release(): array
    {
        [, $facts] = $this->source('release');
        $byKey = array_column($facts, 'value', 'key');

        return [
            'version' => isset($byKey['version']) && $byKey['version'] !== '' ? (string) $byKey['version'] : null,
            'commit_short' => $byKey['commit'] ?? null,
            'deployed_at' => $byKey['deployed_at'] ?? null,
        ];
    }

    /** @return array<string, mixed> */
    private function twoStep(): array
    {
        $list = $this->source('senior_accounts');
        $accounts = $list['accounts'];

        return [
            'senior_accounts' => count($accounts),
            'with_two_step' => count(array_filter($accounts, static fn (array $account): bool => !empty($account['two_step_on']))),
            'truncated' => (bool) $list['truncated'],
        ];
    }

    /** @return array<string, mixed> */
    private function accessReview(): array
    {
        $state = $this->source('access_review');

        return ['last_review_at' => $state['last_review_at'], 'due' => (bool) $state['due']];
    }

    /**
     * The verdict `backup:verify` leaves, under the home page's rule: none, or
     * older than PlatformHealthService::BACKUP_VERDICT_STALE_SECONDS, says
     * nothing about now and is not available.
     *
     * @return array<string, mixed>|null
     */
    private function backup(): ?array
    {
        $verdict = $this->source('backup_verdict');
        $checkedAt = is_array($verdict) && isset($verdict['state'], $verdict['checked_at'])
            ? strtotime((string) $verdict['checked_at'])
            : false;
        if (!is_array($verdict) || $checkedAt === false
            || time() - $checkedAt > PlatformHealthService::BACKUP_VERDICT_STALE_SECONDS) {
            return null;
        }

        $state = (string) $verdict['state'];
        $newest = isset($verdict['newest_at']) ? strtotime((string) $verdict['newest_at']) : false;

        return [
            'state' => in_array($state, self::BACKUP_STATES, true) ? $state : 'other',
            'newest_at' => $newest !== false ? date('c', $newest) : null,
            'checked_at' => date('c', $checkedAt),
        ];
    }

    /** @return array<string, mixed> */
    private function dataRequests(): array
    {
        $totals = $this->source('data_request_totals');
        if (!isset($totals['open'], $totals['overdue'])) {
            // DataRequestsService has logged which figure; here it is "could not be read", never 0.
            throw new \RuntimeException('a data requests total could not be read');
        }

        return ['open' => (int) $totals['open'], 'overdue' => (int) $totals['overdue']];
    }

    /** @return array<string, mixed> */
    private function failedSignIns(): array
    {
        $since = $this->source('counted_since');

        // Null = nothing has been counted yet: available, and the page says so.
        return ['counted_since' => $since !== null ? Carbon::parse((string) $since)->toIso8601String() : null];
    }

    /** @return array<string, mixed> */
    private function independentTest(): array
    {
        $value = $this->source('independent_test_on');
        if ($value === null || $value === '') {
            return ['date' => null];
        }

        $valid = is_string($value)
            && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1])
            && $value <= Carbon::today()->toDateString();

        if (!$valid) {
            // 🔴 Never the value itself: only that the setting could not be used.
            Log::warning('[AssuranceFacts] platform_team.last_independent_test_on is not a past YYYY-MM-DD date; shown as not recorded', [
                'type' => get_debug_type($value),
            ]);

            return ['date' => null];
        }

        return ['date' => $value];
    }
}
