<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Logging;

use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * A log file the web server cannot open must never turn a request into a 500.
 *
 * On 2026-10-05 a script run as root through `docker exec` created that day's
 * `laravel-YYYY-MM-DD.log`, so php-fpm (www-data) could not append to it. Every
 * code path that merely tried to LOG something — including the catch blocks
 * that exist to swallow errors — threw Monolog's UnexpectedValueException
 * instead, and reporting a safeguarding incident answered 500 after the row
 * had already been inserted. Production runs artisan the same way (`sudo
 * docker exec … php artisan migrate`), so the same trap exists there on the
 * first request of a new day after a deploy.
 *
 * Every file-backed channel is therefore tapped so a handler failure is
 * reported to PHP's own error log and otherwise ignored: a broken log sink
 * loses the log line, never the request. The dev `.env` uses `daily`
 * directly (not `stack`), so the protection has to live on the channel
 * itself, not only on the `stack` wrapper.
 */
class LoggingFailureDoesNotBreakRequestsTest extends TestCase
{
    /** @return array<string, array{0: string}> */
    public static function fileChannels(): array
    {
        return ['daily' => ['daily'], 'single' => ['single'], 'stack' => ['stack']];
    }

    /** @dataProvider fileChannels */
    public function test_logging_to_an_unwritable_file_does_not_throw(string $channel): void
    {
        // A path that cannot exist, whatever user the test runs as: Monolog
        // mkdir()s missing parents, and root can create anything under `/`,
        // but nothing can create a directory inside a character device.
        $unwritable = '/dev/null/' . uniqid() . '/laravel.log';
        config([
            'logging.default' => $channel,
            'logging.channels.stack.channels' => ['daily'],
            'logging.channels.daily.path' => $unwritable,
            'logging.channels.single.path' => $unwritable,
        ]);
        foreach (['stack', 'daily', 'single'] as $name) {
            Log::forgetChannel($name);
        }

        try {
            Log::error('SafeguardingService::reportIncident error: simulated');
            Log::critical('simulated critical', ['incident_id' => 1]);
        } catch (\Throwable $e) {
            $this->fail("Logging via '{$channel}' to an unwritable file must be swallowed, got " . get_class($e) . ': ' . $e->getMessage());
        } finally {
            foreach (['stack', 'daily', 'single'] as $name) {
                Log::forgetChannel($name);
            }
        }

        $this->assertTrue(true);
    }
}
