<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    // Platform incident-response kill switch. Tenant policy is evaluated too.
    'authentication_enabled' => filter_var(
        env('WEBAUTHN_AUTHENTICATION_ENABLED', true),
        FILTER_VALIDATE_BOOL
    ),

    /*
     * Relying Party ID for passkeys. Must be a registrable suffix of (or equal
     * to) the browser origin's domain: project-nexus.ie in production,
     * localhost for local dev. Read via config so it survives config:cache —
     * reading $_ENV directly breaks once the config is cached and .env is no
     * longer parsed. Production must set this explicitly; ceremonies fail
     * closed when no exact tenant or configured platform origin matches.
     */
    'rp_id' => env('WEBAUTHN_RP_ID'),

    /*
     * Further platform domains that may each be an RP ID, comma-separated —
     * e.g. project-nexus.net while the app is served on both
     * app.project-nexus.ie and app.project-nexus.net (move decided
     * 10 Nov 2026). Each still needs an explicitly allowed origin under it.
     * See App\Support\PlatformPasskeyDomains.
     */
    'additional_rp_ids' => array_values(array_filter(array_map(
        static fn (string $domain): string => trim($domain),
        explode(',', (string) env('WEBAUTHN_ADDITIONAL_RP_IDS', ''))
    ))),

    /*
     * Exact platform origins permitted to initiate a ceremony. Tenant custom
     * and accessible domains are added dynamically by WebAuthnController.
     */
    'allowed_origins' => array_values(array_filter(array_map(
        static fn (string $origin): string => trim($origin),
        explode(',', (string) env('WEBAUTHN_ALLOWED_ORIGINS', ''))
    ))),

    /*
     * WebAuthn challenges must use one explicit, shared backend for their full
     * lifetime. Production defaults to Laravel's configured Redis connection;
     * the file driver is intended only for tests or deliberately single-node
     * installations and is never selected as a runtime Redis fallback.
     */
    'challenge_store' => [
        'driver' => env(
            'WEBAUTHN_CHALLENGE_STORE',
            env('APP_ENV') === 'testing' ? 'file' : 'redis'
        ),
        'redis_connection' => env('WEBAUTHN_CHALLENGE_REDIS_CONNECTION', 'default'),
        'file_path' => env(
            'WEBAUTHN_CHALLENGE_FILE_PATH',
            storage_path('framework/cache/webauthn_challenges')
        ),
        // Amortized cleanup prevents deliberate single-node file stores from
        // accumulating expired public-login challenges indefinitely.
        'file_cleanup_every' => max(1, (int) env('WEBAUTHN_CHALLENGE_FILE_CLEANUP_EVERY', 100)),
    ],
];
