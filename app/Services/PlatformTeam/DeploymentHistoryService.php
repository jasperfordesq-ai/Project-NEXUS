<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Deployments.
 *
 * Reads the tail of the deploy record, one JSON object per line, appended by
 * scripts/deploy/phases/record-deploy-metrics.sh at the end of every
 * deployment and rollback. The file is never rotated, so only the last
 * TAIL_BYTES are read: the first, partial line of that window is dropped, and
 * lines are walked newest first until LIMIT good ones are found.
 *
 * 🔴 An allowlist per line (see FIELDS). The record also holds the server's
 * name and the full and previous commit; those never leave the server.
 * Unknown `subcommand` / `status` values become `other` / `unknown` (shown,
 * not dropped). A value of the wrong type becomes null. A line that is not a
 * JSON object is skipped and counted in `skipped_lines`.
 *
 * 🔴 A missing or unreadable file is `available: false` ("this server keeps
 * no record"), never an empty list. The file exists only on the production
 * server; an empty file is `available: true` with nothing recorded.
 *
 * Nothing about a person or a community is in the record.
 */
final class DeploymentHistoryService
{
    public const LIMIT = 30;

    /** At most this much of the end of the file is read. */
    public const TAIL_BYTES = 256 * 1024;

    public const SUBJECT_MAX = 200;

    /** The only fields that leave the server. */
    public const FIELDS = ['timestamp', 'subcommand', 'status', 'commit_short', 'subject', 'color', 'duration_s', 'commit_distance'];

    private const SUBCOMMANDS = ['deploy', 'rollback'];

    private const STATUSES = ['success', 'failed'];

    private const COLORS = ['blue', 'green'];

    /** @return array{available: bool, deployments: list<array<string, mixed>>|null, skipped_lines: int|null, limit: int} */
    public function report(): array
    {
        $path = (string) config('platform_team.deploy_history_path');

        $unavailable = ['available' => false, 'deployments' => null, 'skipped_lines' => null, 'limit' => self::LIMIT];

        if ($path === '' || !is_file($path)) {
            // Expected on every machine but the production server: not an error.
            return $unavailable;
        }

        $lines = $this->tail($path);
        if ($lines === null) {
            return $unavailable;
        }

        $deployments = [];
        $skipped = 0;
        for ($i = count($lines) - 1; $i >= 0 && count($deployments) < self::LIMIT; $i--) {
            $line = trim($lines[$i]);
            if ($line === '') {
                continue;
            }
            $decoded = json_decode($line, true);
            if (!is_array($decoded) || array_is_list($decoded)) {
                $skipped++;
                continue;
            }
            $deployments[] = self::row($decoded);
        }

        return ['available' => true, 'deployments' => $deployments, 'skipped_lines' => $skipped, 'limit' => self::LIMIT];
    }

    /**
     * The whole lines in the last TAIL_BYTES of the file, oldest first, or
     * null when it cannot be read (the reason is logged, never sent).
     *
     * @return list<string>|null
     */
    private function tail(string $path): ?array
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            Log::error('Platform team deployments page: the deploy record could not be opened', ['path' => $path]);

            return null;
        }

        try {
            $size = filesize($path);
            if ($size === false) {
                Log::error('Platform team deployments page: the deploy record size could not be read', ['path' => $path]);

                return null;
            }
            $start = max(0, $size - self::TAIL_BYTES);
            if ($start > 0 && fseek($handle, $start) !== 0) {
                Log::error('Platform team deployments page: could not move to the end of the deploy record', ['path' => $path]);

                return null;
            }
            $chunk = stream_get_contents($handle, self::TAIL_BYTES);
            if ($chunk === false) {
                Log::error('Platform team deployments page: the deploy record could not be read', ['path' => $path]);

                return null;
            }
        } finally {
            fclose($handle);
        }

        $lines = explode("\n", $chunk);
        if ($start > 0) {
            // The window began part-way through a line: that piece is not a record.
            array_shift($lines);
        }

        return array_values($lines);
    }

    /**
     * @param array<array-key, mixed> $line
     * @return array<string, mixed>
     */
    private static function row(array $line): array
    {
        $subcommand = $line['subcommand'] ?? null;
        $status = $line['status'] ?? null;
        $color = $line['color'] ?? null;
        $commit = $line['commit_short'] ?? null;
        $subject = $line['subject'] ?? null;
        $timestamp = $line['timestamp'] ?? null;

        return [
            'timestamp' => is_string($timestamp) && strlen($timestamp) <= 40 && strtotime($timestamp) !== false ? $timestamp : null,
            'subcommand' => is_string($subcommand) && in_array($subcommand, self::SUBCOMMANDS, true) ? $subcommand : 'other',
            'status' => is_string($status) && in_array($status, self::STATUSES, true) ? $status : 'unknown',
            'commit_short' => is_string($commit) && preg_match('/^[0-9a-f]{4,12}$/', $commit) === 1 ? $commit : null,
            'subject' => is_string($subject) ? mb_substr($subject, 0, self::SUBJECT_MAX) : null,
            'color' => is_string($color) && in_array($color, self::COLORS, true) ? $color : null,
            'duration_s' => self::wholeNumber($line['duration_s'] ?? null),
            'commit_distance' => self::wholeNumber($line['commit_distance'] ?? null),
        ];
    }

    private static function wholeNumber(mixed $value): ?int
    {
        return is_int($value) ? $value : null;
    }
}
