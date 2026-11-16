<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * Failed background jobs, for the Platform team panel.
 *
 * Laravel writes every job that failed to `failed_jobs`. Nothing read that
 * table until this class.
 *
 * 🔴 What leaves this class, and what never does. A failed job's `payload` is
 * the serialised job (recipients, names, message text) and its `exception` is
 * a full stack trace. Either can hold members' details from any community.
 * The list therefore gives only:
 *
 *   - the job's class name, read from the payload's `displayName`;
 *   - the queue and the time it failed;
 *   - ONE line of the reason: the exception's first line, with email addresses
 *     replaced by "[email]" and file paths removed, cut to 300 characters.
 *
 * The payload and the trace are never returned. If you need them, read the
 * table on the server; do not add them here.
 *
 * 🔴 Installation-wide: `failed_jobs` has no community column. The only caller
 * is platform-team only (FailedJobsController).
 */
final class FailedJobsService
{
    private const REASON_MAX = 300;

    /**
     * @return array{jobs: list<array{id: string, job: ?string, queue: string, failed_at: ?string, reason: ?string}>, total: int, page: int, per_page: int}
     */
    public function list(int $page = 1, int $perPage = 25): array
    {
        $page = max(1, $page);
        $perPage = min(100, max(1, $perPage));

        $total = (int) DB::table('failed_jobs')->count();
        $rows = DB::table('failed_jobs')
            ->orderByDesc('failed_at')
            ->orderByDesc('id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get(['uuid', 'queue', 'payload', 'exception', 'failed_at']);

        $jobs = [];
        foreach ($rows as $row) {
            $stamp = strtotime((string) $row->failed_at);
            $jobs[] = [
                'id' => (string) $row->uuid,
                'job' => self::jobName((string) $row->payload),
                'queue' => (string) $row->queue,
                'failed_at' => $stamp !== false ? date('c', $stamp) : null,
                'reason' => self::reason((string) $row->exception),
            ];
        }

        return ['jobs' => $jobs, 'total' => $total, 'page' => $page, 'per_page' => $perPage];
    }

    public function exists(string $uuid): bool
    {
        return DB::table('failed_jobs')->where('uuid', $uuid)->exists();
    }

    /** Put the job back on its queue. Laravel removes it from `failed_jobs` when it does. */
    public function retry(string $uuid): bool
    {
        return Artisan::call('queue:retry', ['id' => [$uuid]]) === 0;
    }

    /** Remove the record. The work it stood for is not done and will not be. */
    public function discard(string $uuid): bool
    {
        return DB::table('failed_jobs')->where('uuid', $uuid)->delete() > 0;
    }

    /** The job's class name without its namespace, or null when the payload cannot be read. */
    private static function jobName(string $payload): ?string
    {
        $data = json_decode($payload, true);
        $name = is_array($data) ? ($data['displayName'] ?? null) : null;
        if (!is_string($name) || $name === '') {
            return null;
        }

        $short = substr((string) strrchr('\\' . $name, '\\'), 1);

        // A class name only. Anything else in that field is not shown.
        return preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $short) === 1 ? $short : null;
    }

    /** One line, emails masked, no file paths, cut short. Null when there is nothing to show. */
    private static function reason(string $exception): ?string
    {
        $line = trim((string) strtok($exception, "\n"));
        if ($line === '') {
            return null;
        }

        $line = (string) preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $line);
        // " in /var/www/html/app/Jobs/X.php:42" says where, which the name already does.
        $line = (string) preg_replace('#\s+in\s+/\S+$#', '', $line);

        return mb_substr($line, 0, self::REASON_MAX);
    }
}
