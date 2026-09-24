<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Project NEXUS — Laravel Entry Point
 *
 * All API traffic is handled by Laravel (routes/api.php).
 * Security headers, CORS, and tenant resolution are Laravel middleware.
 * The legacy PHP framework has been fully migrated.
 */

// ─── Pre-framework maintenance mode (fast, no autoloader needed) ───
if (file_exists(__DIR__ . '/../.maintenance')) {
    $allowedIPs = ['127.0.0.1', '::1'];
    if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', $allowedIPs)) {
        // CORS headers must be sent here — without them the browser blocks the
        // 503 response entirely (CORS violation) and the React frontend never
        // sees the status code, so the maintenance page is never shown.
        // SECURITY: Only reflect known origins, not arbitrary ones (open CORS reflection
        // with Allow-Credentials is a vulnerability even on a 503 page).
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowedOrigins = [
            'https://app.project-nexus.ie',
            'https://hour-timebank.ie',
            'https://www.hour-timebank.ie',
            'https://timebank.global',
            'https://www.timebank.global',
            'http://localhost:5173',
            'http://localhost:8082',
            'http://127.0.0.1:8082',
            'http://localhost:3000',
        ];
        if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
        }
        // Let OPTIONS preflight succeed so the real request can follow.
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, Authorization, Idempotency-Key, X-Tenant-ID, X-Tenant-Slug, Accept, X-CSRF-TOKEN, X-Trusted-Device, X-Timezone, X-Locale');
            header('Access-Control-Max-Age: 86400');
            http_response_code(204);
            exit;
        }
        http_response_code(503);
        header('Retry-After: 300');
        if (file_exists(__DIR__ . '/maintenance.html')) {
            include __DIR__ . '/maintenance.html';
        }
        exit;
    }
}

// ─── Boot Laravel ───
require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$response = $kernel->handle(
    $request = Illuminate\Http\Request::capture()
);

$response->send();

$kernel->terminate($request, $response);
