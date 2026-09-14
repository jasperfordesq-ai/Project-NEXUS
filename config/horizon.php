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
    'environments' => [
        'production' => [
            'supervisor-1' => [
                'maxProcesses' => 5,
                'balanceMaxShift' => 1,
                'balanceCooldown' => 3,
            ],
        ],
        'local' => [
            'supervisor-1' => [
                'maxProcesses' => 2,
            ],
        ],
    ],
];
