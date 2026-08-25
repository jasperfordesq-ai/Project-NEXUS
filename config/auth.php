<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'defaults' => [
        'guard' => 'web',
        'passwords' => 'users',
    ],
    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],
        'api' => [
            'driver' => 'sanctum',
            'provider' => 'users',
        ],
    ],
    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => App\Models\User::class,
        ],
    ],
    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
        ],
    ],

    // Number of previous password hashes retained per user for the reuse
    // check (PasswordHistoryService). 0 disables the history check; the
    // current password is always rejected regardless.
    'password_history_depth' => env('PASSWORD_HISTORY_DEPTH', 5),

    // Certification-only access-token lifetime, in seconds. It lets a single
    // bounded local run observe a genuinely expired bearer instead of waiting
    // out the real 15-minute lifetime. TokenService ignores it outside the
    // local/testing environments and outside the 1-60 second range, so it can
    // never widen a real credential's life.
    'test_access_token_expiry_seconds' => (int) env('NEXUS_TEST_ACCESS_TOKEN_EXPIRY_SECONDS', 0),

    // Applies equally to password and federated sign-in. Federated sessions
    // may satisfy it only with explicit validated upstream MFA assurance.
    'force_admin_2fa' => filter_var(env('FORCE_ADMIN_2FA', false), FILTER_VALIDATE_BOOLEAN),
];
