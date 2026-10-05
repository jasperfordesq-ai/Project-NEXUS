<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Logging;

use Illuminate\Log\Logger;
use Monolog\Logger as MonologLogger;

/**
 * Channel tap: a log handler that cannot write must not take the request down.
 *
 * Monolog rethrows a handler's exception from every `Log::*()` call unless the
 * logger has an exception handler. With a log file the web server cannot open
 * (a `laravel-YYYY-MM-DD.log` created by a root `docker exec` script, a full
 * disk, a bad mount) that turned every `catch (\Throwable) { Log::error(...) }`
 * in the codebase into a fresh exception, and ordinary requests into 500s —
 * seen 2026-10-05 when reporting a safeguarding incident. The failure is still
 * surfaced through PHP's own error log (stderr in the containers), once per
 * distinct message per process, so it cannot flood.
 */
final class IgnoreHandlerFailures
{
    /** @var array<string, true> */
    private static array $reported = [];

    public function __invoke(Logger $logger): void
    {
        $monolog = $logger->getLogger();
        if (!$monolog instanceof MonologLogger) {
            return;
        }

        $monolog->setExceptionHandler(static function (\Throwable $e): void {
            $key = $e->getMessage();
            if (isset(self::$reported[$key])) {
                return;
            }
            self::$reported[$key] = true;
            // Deliberately not Log::*(): that is the thing that just failed.
            error_log('[logging] handler failure ignored: ' . get_class($e) . ': ' . $key);
        });
    }
}
