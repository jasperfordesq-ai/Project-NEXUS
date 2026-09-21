<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

if (class_exists(\Laravel\Horizon\Horizon::class)) {
    \Laravel\Horizon\Horizon::routeMailNotificationsTo(env('ADMIN_NOTIFICATION_EMAIL', 'funding@hour-timebank.ie'));
}

return [
    'domain' => null,
    'path' => 'horizon',
    'use' => 'default',
    'prefix' => env('HORIZON_PREFIX', 'horizon:'),
    'middleware' => ['web', 'auth'],
    'waits' => [
        'redis:default' => 60,
    ],
    'trim' => [
        'recent' => 60,
        'pending' => 60,
        'completed' => 60,
        'recent_failed' => 10080,
        'failed' => 10080,
        'monitored' => 10080,
    ],
    'silenced' => [],
    'metrics' => [
        'trim_snapshots' => [
            'job' => 24,
            'queue' => 24,
        ],
    ],
    'fast_termination' => false,
    'memory_limit' => 512,
    'defaults' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['federation-high', 'federation', 'default', 'search', 'webhooks', 'emails'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            // Six queues are listed above. Keep at least one available
            // process per queue so a busy default queue cannot starve
            // federation, search, or webhook work.
            'maxProcesses' => 6,
            'minProcesses' => 1,
            // Recycle hourly rather than every minute. The prior one-minute
            // lifetime caused needless process churn and inflated the steady
            // Horizon footprint.
            'maxTime' => 3600,
            'maxJobs' => 500,
            'memory' => 256,
            'tries' => 3,
            'timeout' => 55,
            'nice' => 0,
        ],
    ],
    // 🔴 Every environment the platform is ever deployed under needs an entry here.
    // Horizon looks up environments[app()->environment()]; when the running APP_ENV has
    // no entry it starts the master supervisor, logs "Horizon started successfully", and
    // spawns ZERO workers. Queued work — password-reset and notification mail included —
    // then silently never runs, and the container's healthcheck (which requires both an
    // `artisan horizon` and a `horizon:work` process) fails with no useful error.
    //
    // That is exactly what happened on the first staging deployment, 21 September 2026:
    // `staging` was missing, so the queue container sat unhealthy while claiming success.
    // `HorizonEnvironmentCoverageTest` now pins this list against config/app.php's
    // supported environments so the same gap cannot reappear.
    'environments' => [
        'production' => [
            'supervisor-1' => [
                'maxProcesses' => 5,
                'balanceMaxShift' => 1,
                'balanceCooldown' => 3,
            ],
        ],
        // Mirrors production's shape at a lower process count: a staging box exists to
        // rehearse production, so the queue topology should behave the same way.
        'staging' => [
            'supervisor-1' => [
                'maxProcesses' => 3,
                'balanceMaxShift' => 1,
                'balanceCooldown' => 3,
            ],
        ],
        'local' => [
            'supervisor-1' => [
                'maxProcesses' => 2,
            ],
        ],
        // `testing` runs jobs synchronously (phpunit.xml sets QUEUE_CONNECTION=sync), so
        // no worker is required — but an entry is kept so `horizon:status` and the
        // coverage test below behave consistently rather than special-casing it.
        'testing' => [
            'supervisor-1' => [
                'maxProcesses' => 1,
            ],
        ],
    ],
];
