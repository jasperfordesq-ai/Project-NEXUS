<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | The React frontend runs on:
    |   - Production: https://app.project-nexus.ie
    |   - Development: http://localhost:5173
    |   - Expo web development: http://localhost:8082
    |
    | The API serves from:
    |   - Production: https://api.project-nexus.ie
    |   - Development: http://localhost:8090
    |
    | ALLOWED_ORIGINS env var is a comma-separated list of additional origins.
    |
    */

    'paths' => ['v2/*', 'api/*', 'sanctum/csrf-cookie', 'broadcasting/auth', 'up'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_unique(array_filter(array_merge(
        // Static production origins (always allowed regardless of env)
        [
            'https://project-nexus.ie',
            'https://www.project-nexus.ie',
            'https://app.project-nexus.ie',
            'https://api.project-nexus.ie',
            'https://hour-timebank.ie',
            'https://www.hour-timebank.ie',
            'https://nexuscivic.ie',
            'https://www.nexuscivic.ie',
            'https://timebank.global',
            'https://www.timebank.global',
            'http://localhost:5173',
            'http://localhost:5176',
            'http://localhost:4174',
            'http://localhost:4176',
            'http://localhost:8082',
            'http://localhost:8090',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5176',
            'http://127.0.0.1:4174',
            'http://127.0.0.1:4176',
            'http://127.0.0.1:8082',
        ],
        // Additional origins from environment (additive)
        array_map('trim', array_filter(
            explode(',', env('CORS_ALLOWED_ORIGINS', env('ALLOWED_ORIGINS', '')))
        ))
    )))),

    'allowed_origins_patterns' => [],

    // Accept-Language is a CORS-safelisted request header, so a browser would
    // send it regardless. It is listed anyway: the allow-list is where someone
    // looks to find out what the frontend sends, and a header that works only
    // because of a safelist rule is a header that looks accidental.
    // 🔴 Every custom request header the frontend sends MUST be listed here AND
    // in app/Http/Middleware/EnsureCorsHeaders.php. The app and the API are on
    // different origins in production, so a header missing from either list
    // fails the preflight and the whole feature dies with an opaque CORS error
    // — which is exactly how X-Event-Checkin-Contract and X-Event-Safety-Contract
    // took the check-in and safety pages down.
    'allowed_headers' => ['Accept', 'Accept-Language', 'Content-Type', 'Authorization', 'Idempotency-Key', 'X-Requested-With', 'X-XSRF-TOKEN', 'X-CSRF-TOKEN', 'X-Socket-Id', 'X-Timezone', 'X-Locale', 'X-Tenant-ID', 'X-Tenant-Slug', 'X-Trusted-Device', 'X-Request-Id', 'X-Events-Contract', 'X-Event-Checkin-Contract', 'X-Event-Safety-Contract', 'X-Message-View-Purpose', 'Cache-Control', 'Pragma'],

    'exposed_headers' => ['X-Request-Id', 'X-Build', 'X-Events-Contract'],

    // 1 hour — avoids a full CORS preflight before every single request while
    // staying well short of Firefox's 24h / Chromium's 2h browser caps.
    'max_age' => 3600,

    'supports_credentials' => true,

];
