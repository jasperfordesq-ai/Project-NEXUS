<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Recent errors.
 *
 * Three counts per part of the platform, asked of the error service (Sentry)
 * by the server: errors in the last 24 hours and 7 days (the events count
 * request, `dataset=errors`, as `scripts/postdeploy-watch.mjs` asks it) and
 * unresolved problems seen in the last 14 days (the issues request, one row,
 * total from the `X-Hits` header). The service sends no `X-Hits` at all when
 * a project has none: a successful answer with no header whose body is
 * exactly an empty list is a real 0. Anything else without a valid header is
 * "not available", never a count of rows.
 *
 * 🔴 Switched off until the platform's owner stores a read-only key on the
 * server. Without the key, the organisation or the server's project id, or
 * with any of them malformed, or an address that is not https, NO request is
 * made and the answer is `{connected: false}`.
 *
 * 🔴 Counts only. An issue's title can name a real member: nothing in the
 * issues body is read or kept. Its header gives the total; without the header
 * the body is only checked for being an empty list (no rows, so no title).
 * The events body is read for the one count and
 * nothing else, and nothing from either is passed on.
 *
 * 🔴 The key goes only in the Authorization header, of requests to the https
 * address in config, with redirects off. It is never returned, never logged,
 * never in an address, never in an exception message we write. A failed
 * project logs one line: the project key, the HTTP status, the exception
 * class. Never the address (it carries the organisation), never a body.
 *
 * Platform-wide: the error service's figures are the platform's, not any
 * community's. The answer is kept for five minutes under one key.
 */
final class RecentErrorsService
{
    public const CACHE_KEY = 'platform_team:recent_errors';

    public const CACHE_SECONDS = 300;

    private const TIMEOUT_SECONDS = 5;

    /** The parts of the platform, in the order the page shows them. */
    private const PROJECTS = ['php', 'react', 'webuk'];

    /**
     * Hand-run inline code typed into the production container is tagged so
     * (app/Support/Sentry/SentryInvocation.php); the deploy watch leaves it out,
     * and so does this page, so the two count the same thing.
     */
    private const EXCLUDE_HAND_RUN = '!invocation:cli-eval';

    /** Unresolved problems are those seen in this window. */
    private const UNRESOLVED_PERIOD = '14d';

    /**
     * The settings, checked; null when this page must not ask anyone.
     *
     * @return array{token: string, org: string, base: string, projects: array<string, string>}|null
     */
    public static function settings(): ?array
    {
        $token = config('services.sentry.api_token');
        $org = config('services.sentry.org');
        $base = config('services.sentry.api_base');
        $projects = config('services.sentry.projects');

        if (!is_string($token) || trim($token) === '') {
            return null;
        }
        if (!is_string($org) || preg_match('/^[A-Za-z0-9_-]{1,64}$/', $org) !== 1) {
            return null;
        }
        if (!is_string($base) || !self::isHttpsBase($base)) {
            return null;
        }
        if (!is_array($projects)) {
            return null;
        }

        $chosen = [];
        foreach (self::PROJECTS as $key) {
            $id = $projects[$key] ?? null;
            if ($id === null || (is_string($id) && trim($id) === '')) {
                continue;
            }
            // A value that is set but malformed switches the page off rather
            // than being quietly skipped: it would otherwise go into an address.
            if (!is_scalar($id) || preg_match('/^[0-9]{1,20}$/', (string) $id) !== 1) {
                return null;
            }
            $chosen[$key] = (string) $id;
        }
        if (!isset($chosen['php'])) {
            return null;
        }

        return ['token' => trim($token), 'org' => $org, 'base' => rtrim($base, '/'), 'projects' => $chosen];
    }

    public static function isConnected(): bool
    {
        return self::settings() !== null;
    }

    /**
     * @return array{connected: bool, checked_at: string|null, projects: list<array{key: string, available: bool, errors_24h: int|null, errors_7d: int|null, unresolved: int|null}>|null}
     */
    public function report(bool $refresh = false): array
    {
        $settings = self::settings();
        // Checked before the kept answer: taking the key away stops the page at once.
        if ($settings === null) {
            return ['connected' => false, 'checked_at' => null, 'projects' => null];
        }

        if (!$refresh) {
            $kept = Cache::get(self::CACHE_KEY);
            if (is_array($kept) && ($kept['connected'] ?? null) === true) {
                return $kept;
            }
        }

        $projects = [];
        foreach ($settings['projects'] as $key => $id) {
            $projects[] = $this->project($settings, $key, $id);
        }

        $report = ['connected' => true, 'checked_at' => now()->toIso8601String(), 'projects' => $projects];
        Cache::put(self::CACHE_KEY, $report, self::CACHE_SECONDS);

        return $report;
    }

    /**
     * @param array{token: string, org: string, base: string, projects: array<string, string>} $settings
     * @return array{key: string, available: bool, errors_24h: int|null, errors_7d: int|null, unresolved: int|null}
     */
    private function project(array $settings, string $key, string $id): array
    {
        $status = null;
        try {
            $errors24h = $this->countErrors($settings, $id, '24h', $status);
            $errors7d = $this->countErrors($settings, $id, '7d', $status);
            $unresolved = $this->countUnresolved($settings, $id, $status);
        } catch (\Throwable $e) {
            // 🔴 The class only: an exception's message can carry the address.
            Log::error('platform_team.recent_errors.project_unavailable', [
                'project' => $key,
                'status' => $status,
                'exception' => get_class($e),
            ]);

            return ['key' => $key, 'available' => false, 'errors_24h' => null, 'errors_7d' => null, 'unresolved' => null];
        }

        return ['key' => $key, 'available' => true, 'errors_24h' => $errors24h, 'errors_7d' => $errors7d, 'unresolved' => $unresolved];
    }

    /** @param array{token: string, org: string, base: string, projects: array<string, string>} $settings */
    private function countErrors(array $settings, string $projectId, string $period, ?int &$status): int
    {
        $status = null;
        $response = $this->client($settings)->get($this->url($settings, 'events'), [
            'field' => 'count()',
            'dataset' => 'errors',
            'query' => self::EXCLUDE_HAND_RUN,
            'project' => $projectId,
            'statsPeriod' => $period,
        ]);
        $status = $response->status();
        if (!$response->successful()) {
            throw new \UnexpectedValueException('unexpected answer');
        }

        // The one value read from the body. Anything else in it is ignored.
        $json = json_decode($response->body(), true);
        $count = is_array($json) ? ($json['data'][0]['count()'] ?? null) : null;
        if (!is_int($count) || $count < 0) {
            throw new \UnexpectedValueException('unexpected answer');
        }

        return $count;
    }

    /**
     * The total comes from the `X-Hits` header. No header (or an empty one)
     * with a body that is exactly an empty list: 0, as the service answers for
     * a project with no unresolved problems. Otherwise, no header or not a
     * whole number: the figure is not available, never guessed from the row
     * count. Nothing in a row (which holds the issue's title) is read.
     *
     * @param array{token: string, org: string, base: string, projects: array<string, string>} $settings
     */
    private function countUnresolved(array $settings, string $projectId, ?int &$status): ?int
    {
        $status = null;
        $response = $this->client($settings)->get($this->url($settings, 'issues'), [
            'query' => 'is:unresolved',
            'limit' => 1,
            'project' => $projectId,
            'statsPeriod' => self::UNRESOLVED_PERIOD,
        ]);
        $status = $response->status();
        if (!$response->successful()) {
            throw new \UnexpectedValueException('unexpected answer');
        }

        $hits = trim($response->header('X-Hits'));
        if ($hits === '') {
            // Only "is it an empty list?": an empty list has no row to read.
            // Decoded as objects, so `{}` (an object, not a list) is not [].
            return json_decode($response->body()) === [] ? 0 : null;
        }
        if (preg_match('/^[0-9]{1,12}$/', $hits) !== 1) {
            return null;
        }

        return (int) $hits;
    }

    /** @param array{token: string, org: string, base: string, projects: array<string, string>} $settings */
    private function client(array $settings): \Illuminate\Http\Client\PendingRequest
    {
        return Http::withToken($settings['token'])
            ->acceptJson()
            ->timeout(self::TIMEOUT_SECONDS)
            ->connectTimeout(self::TIMEOUT_SECONDS)
            // A redirect would carry the key to another address.
            ->withOptions(['allow_redirects' => false]);
    }

    /** @param array{token: string, org: string, base: string, projects: array<string, string>} $settings */
    private function url(array $settings, string $what): string
    {
        return "{$settings['base']}/organizations/{$settings['org']}/{$what}/";
    }

    private static function isHttpsBase(string $base): bool
    {
        $parts = parse_url(trim($base));
        if (!is_array($parts)) {
            return false;
        }

        return strtolower((string) ($parts['scheme'] ?? '')) === 'https'
            && ($parts['host'] ?? '') !== ''
            && !isset($parts['user'])
            && !isset($parts['pass'])
            && !isset($parts['query'])
            && !isset($parts['fragment']);
    }
}

