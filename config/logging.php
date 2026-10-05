<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Monolog\Handler\NullHandler;
use Monolog\Handler\StreamHandler;
use Monolog\Handler\SyslogUdpHandler;
use Monolog\Processor\PsrLogMessageProcessor;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Log Channel
    |--------------------------------------------------------------------------
    |
    | The "stack" channel combines daily file logging with stderr output.
    | Sentry integration is available for error tracking in production.
    |
    */

    'default' => env('LOG_CHANNEL', 'stack'),

    'deprecations' => [
        'channel' => env('LOG_DEPRECATIONS_CHANNEL', 'null'),
        'trace' => env('LOG_DEPRECATIONS_TRACE', false),
    ],

    'channels' => [

        // A log sink that cannot be written must lose the log line, never the
        // request. Monolog rethrows a handler failure from every Log::*() call
        // unless told otherwise, which turned a root-owned
        // `laravel-YYYY-MM-DD.log` (created by a `docker exec` script) into a
        // 500 on any code path that logged — including the catch blocks meant
        // to swallow errors (safeguarding incident report, 2026-10-05). The
        // `stack` driver has its own switch; the file channels get the same
        // guarantee through the tap, because the dev `.env` points LOG_CHANNEL
        // straight at `daily`. Pinned by
        // tests/Laravel/Feature/Logging/LoggingFailureDoesNotBreakRequestsTest.
        'stack' => [
            'driver' => 'stack',
            'channels' => explode(',', env('LOG_STACK', 'daily,stderr')),
            'ignore_exceptions' => true,
        ],

        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'warning'),
            'replace_placeholders' => true,
            'tap' => [App\Logging\IgnoreHandlerFailures::class],
        ],

        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'warning'),
            'days' => env('LOG_DAILY_DAYS', 14),
            'replace_placeholders' => true,
            'tap' => [App\Logging\IgnoreHandlerFailures::class],
            // No explicit 'permission' — setting it makes Monolog chmod() the
            // file on every write, which throws "Operation not permitted" when
            // the existing log file is owned by a different user (e.g. left
            // behind on a mounted volume from a prior container run).
        ],

        'stderr' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'warning'),
            'handler' => StreamHandler::class,
            'formatter' => env('LOG_STDERR_FORMATTER'),
            'with' => [
                'stream' => 'php://stderr',
            ],
            'processors' => [PsrLogMessageProcessor::class],
        ],

        'syslog' => [
            'driver' => 'syslog',
            'level' => env('LOG_LEVEL', 'warning'),
            'facility' => env('LOG_SYSLOG_FACILITY', LOG_USER),
            'replace_placeholders' => true,
        ],

        'errorlog' => [
            'driver' => 'errorlog',
            'level' => env('LOG_LEVEL', 'warning'),
            'replace_placeholders' => true,
        ],

        'null' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
        ],

        'emergency' => [
            'path' => storage_path('logs/laravel.log'),
        ],

        /*
        |----------------------------------------------------------------------
        | Sentry Channel
        |----------------------------------------------------------------------
        |
        | Sends errors and exceptions to Sentry for production monitoring.
        | Requires sentry/sentry-laravel package. The DSN is configured in
        | config/services.php and via SENTRY_DSN_PHP / SENTRY_LARAVEL_DSN.
        |
        */

        'sentry' => [
            'driver' => 'sentry',
            'level' => env('LOG_LEVEL', 'error'),
            'bubble' => true,
        ],

    ],

];
