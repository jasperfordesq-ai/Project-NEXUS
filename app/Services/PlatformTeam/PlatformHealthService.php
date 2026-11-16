<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

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

    /** @return array{0: string, 1: list<array{key: string, value: mixed, type: string}>} */
    private function release(): array
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
}
