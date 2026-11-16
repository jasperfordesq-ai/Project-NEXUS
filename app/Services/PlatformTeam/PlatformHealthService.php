<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Console\Commands\BackupVerify;
use App\Http\Middleware\SecurityHeaders;
use App\Services\EmailMonitorService;
use App\Services\PrerenderService;
use App\Services\RedisCache;
use App\Services\SearchService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Health at a glance for the Platform team panel's home page.
 *
 * One card per thing the whole installation runs on. Every figure comes from a
 * check that already existed somewhere (monitoring, the queue liveness verdict,
 * the prerender traffic light, the email monitor); this class only gathers
 * them, so the platform team has one place to look.
 *
 * 🔴 Four statuses, and the fourth is the point:
 *
 *   ok       the check ran and found nothing wrong
 *   warning  the check ran and found something to look at
 *   failing  the check ran and the thing is not working
 *   unknown  the check COULD NOT BE READ
 *
 * A check that throws is `unknown`. It is never `ok`, and it keeps the overall
 * verdict from being `ok`. (A health page that turns "I could not look" into
 * a green tick is worse than no health page.) The reason is logged at `error`
 * and is not sent to the browser.
 *
 * 🔴 Installation-wide on purpose. Several queries here have no `tenant_id`
 * filter (`cron_logs`, `failed_jobs`, the maintenance setting across all
 * communities). That is correct only because the one caller is platform-team
 * only: `PlatformHealthController::summary()`. Do not call this from anything
 * a community admin can reach.
 *
 * 🔴 Counts and times only. `failed_jobs.payload` and `.exception` can hold
 * members' details and are never read here.
 */
final class PlatformHealthService
{
    public const OK = 'ok';
    public const WARNING = 'warning';
    public const FAILING = 'failing';
    public const UNKNOWN = 'unknown';

    /** The queue verdict is re-written every few minutes; older than this says nothing about now. */
    private const QUEUE_VERDICT_STALE_SECONDS = 3600;

    /** backup:verify runs once a day; a verdict older than this says nothing about now. Also read by AssuranceFactsService. */
    public const BACKUP_VERDICT_STALE_SECONDS = 26 * 3600;

    public function __construct(
        private readonly EmailMonitorService $emailMonitor,
        private readonly PrerenderService $prerender,
    ) {
    }

    /**
     * @return array{generated_at: string, overall: string, cards: list<array{key: string, status: string, facts: list<array{key: string, value: mixed, type: string}>}>}
     */
    public function summary(): array
    {
        $cards = [
            $this->card('release', fn () => $this->release()),
            $this->card('database', fn () => $this->database()),
            $this->card('cache', fn () => $this->cache()),
            $this->card('disk', fn () => $this->disk()),
            $this->card('queue', fn () => $this->queue()),
            $this->card('failed_jobs', fn () => $this->failedJobs()),
            $this->card('cron', fn () => $this->cron()),
            $this->card('email', fn () => $this->email()),
            $this->card('search', fn () => $this->search()),
            $this->card('snapshots', fn () => $this->snapshots()),
            $this->card('maintenance', fn () => $this->maintenance()),
            $this->card('access_review', fn () => $this->accessReview()),
            $this->card('clean_up', fn () => $this->cleanUp()),
            $this->card('backup', fn () => $this->backup()),
            $this->card('agreements', fn () => $this->agreements()),
        ];

        return [
            'generated_at' => now()->toIso8601String(),
            'overall' => self::worst(array_column($cards, 'status')),
            'cards' => $cards,
        ];
    }

    /**
     * Failing beats warning beats unknown beats ok: an unread check never
     * leaves the verdict at ok, and never hides a real failure either.
     *
     * @param list<string> $statuses
     */
    public static function worst(array $statuses): string
    {
        foreach ([self::FAILING, self::WARNING, self::UNKNOWN] as $status) {
            if (in_array($status, $statuses, true)) {
                return $status;
            }
        }

        return self::OK;
    }

    /**
     * @param callable(): array{0: string, 1: list<array{key: string, value: mixed, type: string}>} $check
     * @return array{key: string, status: string, facts: list<array{key: string, value: mixed, type: string}>}
     */
    private function card(string $key, callable $check): array
    {
        try {
            [$status, $facts] = $check();
        } catch (\Throwable $e) {
            // Not a success-shaped value: the card says plainly that it could not be read.
            Log::error('[PlatformHealth] check could not be read', [
                'check' => $key,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return ['key' => $key, 'status' => self::UNKNOWN, 'facts' => []];
        }

        return ['key' => $key, 'status' => $status, 'facts' => $facts];
    }

    /** @return array{key: string, value: mixed, type: string} */
    private static function fact(string $key, mixed $value, string $type = 'text'): array
    {
        return ['key' => $key, 'value' => $value, 'type' => $type];
    }

    /**
     * Public so AssuranceFactsService can show the same release without a second reading of it.
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    public function release(): array
    {
        $commit = '';
        $deployedAt = null;

        // Written by the deploy; absent on a development machine.
        $file = base_path('httpdocs/.build-version');
        if (is_file($file)) {
            $data = json_decode((string) file_get_contents($file), true);
            if (is_array($data)) {
                $commit = (string) ($data['commit'] ?? '');
                $stamp = (string) ($data['deployed_at'] ?? '');
                $parsed = $stamp !== '' ? strtotime($stamp) : false;
                $deployedAt = $parsed !== false ? date('c', $parsed) : null;
            }
        }
        if ($commit === '' || $commit === 'unknown') {
            $commit = SecurityHeaders::buildCommit();
        }

        $known = $commit !== '' && $commit !== 'unknown';

        return [
            $known ? self::OK : self::UNKNOWN,
            [
                self::fact('version', (string) config('app.version')),
                self::fact('commit', $known ? substr($commit, 0, 12) : null),
                self::fact('deployed_at', $deployedAt, 'datetime'),
            ],
        ];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function database(): array
    {
        try {
            DB::select('SELECT 1');
        } catch (\Throwable $e) {
            Log::error('[PlatformHealth] database did not answer', ['message' => $e->getMessage()]);

            return [self::FAILING, [self::fact('connected', false, 'bool')]];
        }

        $row = DB::selectOne(
            'SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb FROM information_schema.tables WHERE table_schema = ?',
            [DB::getDatabaseName()]
        );
        $size = $row !== null && $row->mb !== null ? $row->mb . ' MB' : null;

        return [self::OK, [self::fact('connected', true, 'bool'), self::fact('size', $size)]];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function cache(): array
    {
        $stats = app(RedisCache::class)->getStats();
        if (empty($stats['enabled'])) {
            return [self::FAILING, [self::fact('connected', false, 'bool')]];
        }

        return [self::OK, [
            self::fact('connected', true, 'bool'),
            self::fact('memory_used', isset($stats['memory_used']) ? (string) $stats['memory_used'] : null),
        ]];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function disk(): array
    {
        $free = @disk_free_space(base_path());
        $total = @disk_total_space(base_path());
        if ($free === false || $total === false || $total <= 0) {
            throw new \RuntimeException('disk space could not be read');
        }

        $usedPercent = (int) round((1 - $free / $total) * 100);
        $status = $usedPercent >= 90 ? self::FAILING : ($usedPercent >= 80 ? self::WARNING : self::OK);

        return [$status, [
            self::fact('free', self::gigabytes($free)),
            self::fact('total', self::gigabytes($total)),
            self::fact('used_percent', $usedPercent, 'percent'),
        ]];
    }

    private static function gigabytes(float $bytes): string
    {
        return number_format($bytes / 1024 / 1024 / 1024, 1) . ' GB';
    }

    /**
     * The verdict `queue:verify-liveness` writes (VerifyQueueLiveness::STATUS_KEY).
     * Until this page, nothing read it.
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function queue(): array
    {
        $verdict = Cache::get('queue_heartbeat:status');
        if (!is_array($verdict) || !isset($verdict['state'], $verdict['checked_at'])) {
            return [self::UNKNOWN, []];
        }

        $checkedAt = (int) $verdict['checked_at'];
        $facts = [self::fact('checked_at', date('c', $checkedAt), 'datetime')];
        if (time() - $checkedAt > self::QUEUE_VERDICT_STALE_SECONDS) {
            return [self::UNKNOWN, $facts];
        }

        if (isset($verdict['lag_seconds'])) {
            $facts[] = self::fact('lag_seconds', (int) $verdict['lag_seconds'], 'count');
        }

        $status = match ((string) $verdict['state']) {
            'ok' => self::OK,
            'pending' => self::WARNING,
            'failed' => self::FAILING,
            default => self::UNKNOWN,
        };

        return [$status, $facts];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function failedJobs(): array
    {
        // Count and newest time only. Never the payload or the exception text.
        $count = (int) DB::table('failed_jobs')->count();
        $newest = $count > 0 ? DB::table('failed_jobs')->max('failed_at') : null;
        $newestAt = $newest !== null && strtotime((string) $newest) !== false ? date('c', strtotime((string) $newest)) : null;

        $facts = [self::fact('failed_count', $count, 'count')];
        if ($newestAt !== null) {
            // Left out when there is none: "most recent: not known" would read as a gap.
            $facts[] = self::fact('newest_failed_at', $newestAt, 'datetime');
        }

        return [$count > 0 ? self::WARNING : self::OK, $facts];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function cron(): array
    {
        // Every community's scheduled jobs: installation-wide (see the class note).
        $since = now()->subDay();
        $failed = (int) DB::table('cron_logs')->where('status', 'error')->where('executed_at', '>=', $since)->count();
        $last = DB::table('cron_logs')->where('status', 'error')->max('executed_at');
        $lastAt = $last !== null && strtotime((string) $last) !== false ? date('c', strtotime((string) $last)) : null;

        $facts = [self::fact('failed_24h', $failed, 'count')];
        if ($lastAt !== null) {
            $facts[] = self::fact('last_failure_at', $lastAt, 'datetime');
        }

        return [$failed > 0 ? self::WARNING : self::OK, $facts];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function email(): array
    {
        // null = every community.
        $warnings = $this->emailMonitor->getWarnings(null);
        $critical = 0;
        $other = 0;
        foreach ($warnings as $warning) {
            $severity = (string) ($warning['severity'] ?? '');
            if ($severity === 'critical') {
                $critical++;
            } elseif ($severity === 'warning') {
                $other++;
            }
        }

        $status = $critical > 0 ? self::FAILING : ($other > 0 ? self::WARNING : self::OK);

        return [$status, [
            self::fact('critical', $critical, 'count'),
            self::fact('warnings', $other, 'count'),
        ]];
    }

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function search(): array
    {
        $reachable = SearchService::isReachableNow();

        return [$reachable ? self::OK : self::FAILING, [self::fact('reachable', $reachable, 'bool')]];
    }

    /**
     * The prerender engine's own traffic light (pages saved for search engines).
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function snapshots(): array
    {
        $health = $this->prerender->health();
        $status = match ((string) ($health['status'] ?? '')) {
            'green' => self::OK,
            'yellow' => self::WARNING,
            'red' => self::FAILING,
            default => self::UNKNOWN,
        };

        $problems = 0;
        foreach ((array) ($health['checks'] ?? []) as $check) {
            if (($check['status'] ?? 'green') !== 'green') {
                $problems++;
            }
        }

        return [$status, [self::fact('problems', $problems, 'count')]];
    }

    /**
     * State only. There is deliberately no switch here: `scripts/maintenance.sh`
     * is the one way to change it, because it sets both layers together.
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function maintenance(): array
    {
        // Layer 1: the file httpdocs/index.php checks before the framework loads.
        $platformWide = file_exists(base_path('.maintenance'));
        // Layer 2: the per-community setting CheckMaintenanceMode reads, across all communities.
        $communities = (int) DB::table('tenant_settings')
            ->where('setting_key', 'general.maintenance_mode')
            ->whereIn('setting_value', ['true', '1'])
            ->count();

        return [$platformWide || $communities > 0 ? self::WARNING : self::OK, [
            self::fact('platform_wide', $platformWide, 'bool'),
            self::fact('communities', $communities, 'count'),
        ]];
    }

    /**
     * Whether a review of the senior accounts is due (none yet, or the newest
     * is more than AccessReviewService::DUE_AFTER_DAYS days old).
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function accessReview(): array
    {
        $state = app(AccessReviewService::class)->dueStatus();

        $facts = [self::fact('review_due', $state['due'], 'bool')];
        if ($state['last_review_at'] !== null) {
            // Left out when there is none: "most recent: not known" would read as a gap.
            $facts[] = self::fact('last_review_at', $state['last_review_at'], 'datetime');
        }

        return [$state['due'] ? self::WARNING : self::OK, $facts];
    }

    /**
     * The worst state on the Clean-up jobs page: late is something to look
     * at, failing is not working, and a job with no record yet keeps the card
     * from being fine. A record that could not be read makes the whole card
     * "could not be checked".
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function cleanUp(): array
    {
        $counts = [CleanUpJobsService::OK => 0, CleanUpJobsService::LATE => 0, CleanUpJobsService::FAILING => 0, CleanUpJobsService::UNKNOWN => 0];
        foreach ((new CleanUpJobsService())->report()['jobs'] as $job) {
            if (!$job['readable']) {
                throw new \RuntimeException("the record for clean-up job {$job['key']} could not be read");
            }
            $counts[$job['status']]++;
        }

        $status = self::worst(array_merge(
            $counts[CleanUpJobsService::FAILING] > 0 ? [self::FAILING] : [],
            $counts[CleanUpJobsService::LATE] > 0 ? [self::WARNING] : [],
            $counts[CleanUpJobsService::UNKNOWN] > 0 ? [self::UNKNOWN] : [],
        ));

        return [$status, [
            self::fact('jobs_ok', $counts[CleanUpJobsService::OK], 'count'),
            self::fact('jobs_late', $counts[CleanUpJobsService::LATE], 'count'),
            self::fact('jobs_failing', $counts[CleanUpJobsService::FAILING], 'count'),
            self::fact('jobs_no_record', $counts[CleanUpJobsService::UNKNOWN], 'count'),
        ]];
    }

    /**
     * The verdict `backup:verify` leaves every morning (BackupVerify::VERDICT_KEY).
     * Older than BACKUP_VERDICT_STALE_SECONDS, or none at all (a developer's
     * computer), says nothing about now: unknown.
     *
     * 🔴 It only knows about the newest backup on this server. Whether a copy is
     * kept off the server and when a restore was last tested are recorded
     * nowhere this can read: those two facts are always "not known".
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function backup(): array
    {
        $notKnown = [self::fact('off_server_copy', null), self::fact('restore_test', null)];

        $verdict = Cache::get(BackupVerify::VERDICT_KEY);
        $checkedAt = is_array($verdict) && isset($verdict['state'], $verdict['checked_at'])
            ? strtotime((string) $verdict['checked_at'])
            : false;
        if (!is_array($verdict) || $checkedAt === false) {
            return [self::UNKNOWN, $notKnown];
        }

        $newest = isset($verdict['newest_at']) ? strtotime((string) $verdict['newest_at']) : false;
        $size = isset($verdict['size_bytes']) && is_int($verdict['size_bytes']) ? $verdict['size_bytes'] : null;
        $facts = array_merge([
            self::fact('newest_backup_at', $newest !== false ? date('c', $newest) : null, 'datetime'),
            self::fact('size', $size !== null ? self::megabytes($size) : null),
            self::fact('checked_at', date('c', $checkedAt), 'datetime'),
        ], $notKnown);

        if (time() - $checkedAt > self::BACKUP_VERDICT_STALE_SECONDS) {
            return [self::UNKNOWN, $facts];
        }

        $status = match ((string) $verdict['state']) {
            'healthy' => self::OK,
            'stale', 'missing', 'empty', 'unreadable' => self::FAILING,
            default => self::UNKNOWN,
        };

        return [$status, $facts];
    }

    /**
     * The reminder for agreements (there is no reminder email): needs a look
     * when an agreement that has not ended renews within
     * PlatformAgreementService::RENEWAL_WARNING_DAYS days, or its renewal
     * date has passed. None entered at all is fine, and the fact says 0.
     *
     * @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>}
     */
    private function agreements(): array
    {
        $state = (new PlatformAgreementService())->renewalStatus();

        $facts = [self::fact('agreements_entered', $state['entered'], 'count')];
        if ($state['entered'] > 0) {
            $facts[] = self::fact('agreements_renewing_soon', $state['renewing_soon'], 'count');
        }

        return [$state['renewing_soon'] > 0 ? self::WARNING : self::OK, $facts];
    }

    private static function megabytes(int $bytes): string
    {
        if ($bytes >= 1024 ** 3) {
            return self::gigabytes((float) $bytes);
        }

        return number_format($bytes / 1024 / 1024, 1) . ' MB';
    }
}
