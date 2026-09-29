<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Build version endpoint — returns git SHA, deploy timestamp, and container info.
 * Does NOT load the full application.
 *
 * Usage: curl https://api.project-nexus.ie/version.php
 *
 * The .build-version file is written by safe-deploy.sh after each successful deploy.
 * In development (no .build-version file), falls back to reading git directly.
 */

header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');

$deployDir = dirname(__DIR__);
// .build-version lives in httpdocs/ so it's visible inside the Docker container
// (httpdocs/ is bind-mounted, but the project root is not)
$versionFile = __DIR__ . '/.build-version';

// F-314: this endpoint is public and unauthenticated. It answers only what the
// deploy tooling and the security register read — the commit identifiers are
// load-bearing (bluegreen-deploy.sh candidate + cutover checks,
// candidate-journeys.sh, deploy-drift-watchdog.yml) — and no longer the PHP
// patch level (CVE matching) or the commit message (security fixes are titled
// with their finding id, so the message said which fix was live). Anything
// else .build-version carries is dropped by the allowlist below.
const VERSION_PUBLIC_KEYS = ['service', 'commit', 'commit_short', 'deployed_at', 'deploy_mode', 'environment'];

$version = [
    'service' => 'nexus-php-api',
    'commit' => 'unknown',
    'deployed_at' => '',
    'environment' => getenv('APP_ENV') ?: 'production',
];

// Try reading the build version file (written by safe-deploy.sh)
if (file_exists($versionFile)) {
    $data = json_decode(file_get_contents($versionFile), true);
    if ($data) {
        $version = array_merge($version, $data);
    }
} else {
    // Fallback: read git directly (development mode)
    $gitDir = $deployDir . '/.git';
    if (is_dir($gitDir)) {
        $commit = trim(shell_exec("cd \"$deployDir\" && git rev-parse HEAD 2>/dev/null") ?? '');
        if ($commit) {
            $version['commit'] = $commit;
            $version['commit_short'] = substr($commit, 0, 8);
            $version['deployed_at'] = 'development';
        }
    }
}

$version = array_intersect_key($version, array_flip(VERSION_PUBLIC_KEYS));

echo json_encode($version, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
