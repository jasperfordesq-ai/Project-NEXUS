<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Sentry;

/**
 * Identifies how the PHP process that produced a Sentry event was started.
 *
 * 🔴 Why this exists. A fatal in production is reported to Sentry no matter how
 * the process began — including a `php -r '...'` one-liner typed into the
 * production container by a person or an agent inspecting the database. Those
 * are not product defects, but they are indistinguishable from real errors once
 * they arrive, and they have cost real time and real safety margin:
 *
 *  - Sentry issue NEXUS-PHP-41 has been triaged TWICE (2026-08-28 and
 *    2026-08-30) and both times the answer was the same: a hand-run query with
 *    a typo. It holds nine events across three bursts of three, every burst a
 *    single mistyped one-liner, and none of them a code path any member can
 *    reach. Two of the three bursts are not even the same fault — Sentry groups
 *    them together because every PDOException shares the same
 *    `Connection.php:420` stack shape.
 *  - Worse, they count against the post-deploy error watch. On 2026-08-30 a
 *    mistyped verification command spent 3 of the alarm budget of 10 inside the
 *    thirty-minute window whose entire job is to prove a deploy safe. A second
 *    typo would have alarmed a healthy deploy.
 *
 * 🔴 THIS MUST NEVER SUPPRESS A REAL CLI FAILURE. Queue workers, the scheduler
 * and `php artisan` commands are production, and their errors are exactly the
 * ones that go unnoticed. This matches ONLY code supplied inline — `php -r`,
 * `php -a`, or a script piped in on stdin — where `argv[0]` is PHP's own
 * placeholder rather than a script path. `artisan`, `vendor/bin/phpunit` and
 * every real script fail the check and report as normal.
 *
 * The event is TAGGED, never dropped. Dropping would destroy the evidence that
 * something was run by hand in production, which is itself worth knowing.
 */
final class SentryInvocation
{
    /**
     * PHP's own placeholders for "the code came from the command line or stdin,
     * not from a file". A real script always has a path here.
     *
     * - `Standard input code` — `php -r '...'` and `php -a`
     * - `Command line code`   — the same thing as it appears in a stack frame
     * - `-`                   — `echo '...' | php`
     */
    private const EVAL_ARGV_ZERO = [
        'Standard input code',
        'Command line code',
        '-',
    ];

    public const TAG_KEY = 'invocation';

    public const TAG_CLI_EVAL = 'cli-eval';

    /**
     * True when this process is inline code run on the command line, rather
     * than an HTTP request, an artisan command, a queue worker or any script.
     *
     * @param array<int|string, mixed> $argv Normally $_SERVER['argv'].
     * @param string $sapi Normally PHP_SAPI.
     */
    public static function isEvalInvocation(array $argv, string $sapi): bool
    {
        // Anything served over HTTP is a real request, whatever argv holds.
        if ($sapi !== 'cli' && $sapi !== 'phpdbg') {
            return false;
        }

        $entry = $argv[0] ?? null;

        if (!is_string($entry) || $entry === '') {
            return false;
        }

        return in_array($entry, self::EVAL_ARGV_ZERO, true);
    }
}
