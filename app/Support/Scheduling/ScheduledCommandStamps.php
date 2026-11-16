<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Scheduling;

use Illuminate\Console\Application as ConsoleApplication;
use Illuminate\Console\Scheduling\CallbackEvent;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Support\Facades\Cache;

/**
 * The cache stamps that record when each scheduled artisan command last
 * finished: `schedule:<command>:last_ok_at` and `schedule:<command>:last_failed_at`,
 * each an ISO 8601 time, kept TTL_SECONDS.
 *
 * Written by `App\Listeners\StampScheduledCommandOutcome` for EVERY scheduled
 * artisan command; read by the Platform team's Clean-up jobs page. The cache
 * store is the default one (Redis in production, shared by the scheduler and
 * the app containers).
 */
final class ScheduledCommandStamps
{
    public const TTL_SECONDS = 400 * 86400;

    public static function okKey(string $command): string
    {
        return "schedule:{$command}:last_ok_at";
    }

    public static function failedKey(string $command): string
    {
        return "schedule:{$command}:last_failed_at";
    }

    /**
     * The artisan command name of a scheduled task (`performance:prune` for
     * `$schedule->command('performance:prune --limit=5')`), or null for a
     * closure, a job, or a shell command that is not an artisan command.
     */
    public static function commandName(Event $event): ?string
    {
        if ($event instanceof CallbackEvent || !is_string($event->command)) {
            return null;
        }

        // Schedule::command() builds "<php> <artisan> <command> [options]".
        $prefix = ConsoleApplication::formatCommandString('');
        if (!str_starts_with($event->command, $prefix)) {
            return null;
        }

        $name = strtok(ltrim(substr($event->command, strlen($prefix))), " \t");
        if (!is_string($name) || preg_match('/^[A-Za-z0-9][A-Za-z0-9:._-]{0,120}$/', $name) !== 1) {
            return null;
        }

        return $name;
    }

    public static function recordOk(string $command): void
    {
        Cache::put(self::okKey($command), now()->toIso8601String(), self::TTL_SECONDS);
    }

    public static function recordFailed(string $command): void
    {
        Cache::put(self::failedKey($command), now()->toIso8601String(), self::TTL_SECONDS);
    }

    /** The stamp as an ISO time, or null when there is none (or it is not a time). */
    public static function read(string $key): ?string
    {
        $value = Cache::get($key);
        if (!is_string($value) || $value === '' || strtotime($value) === false) {
            return null;
        }

        return $value;
    }
}
