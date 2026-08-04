<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

/**
 * PHPUnit Bootstrap File
 *
 * Sets up the testing environment for all test suites.
 */

// Load Composer autoloader
require_once __DIR__ . '/../vendor/autoload.php';

// Load testing environment variables.
// Container test runs should prefer .env.docker because DB_HOST can resolve the
// Docker service name `db`. Host-side PHP test runs prefer .env.testing/.env,
// where DB_HOST points at the Compose-published localhost port.
$isContainer = file_exists('/.dockerenv') || getenv('RUNNING_IN_DOCKER') === '1';
$envFiles = $isContainer
    ? [
        __DIR__ . '/../.env.testing',
        __DIR__ . '/../.env.docker',
        __DIR__ . '/../.env',
    ]
    : [
        __DIR__ . '/../.env.testing',
        __DIR__ . '/../.env',
        __DIR__ . '/../.env.docker',
    ];

$loadEnvFile = function($filePath) {
    if (!file_exists($filePath)) {
        return false;
    }
    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        // Skip comments and empty lines
        $line = trim($line);
        if (empty($line) || strpos($line, '#') === 0) {
            continue;
        }
        // Remove Windows line endings
        $line = str_replace("\r", '', $line);
        if (strpos($line, '=') !== false) {
            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);
            // Remove quotes from value
            if (preg_match('/^["\'].*["\']$/', $value)) {
                $value = substr($value, 1, -1);
            }
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
    return true;
};

// Only load env file if not running in Docker (Docker injects env vars directly)
// Check if DB_HOST is already set to a Docker service name
$loaded = false;
$dockerDbHost = getenv('DB_HOST');
$isDocker = ($dockerDbHost && $dockerDbHost !== 'localhost' && $dockerDbHost !== '127.0.0.1');

if (!$isDocker) {
    foreach ($envFiles as $envFile) {
        if ($loadEnvFile($envFile)) {
            $loaded = true;
            break;
        }
    }
} else {
    // In Docker, ensure DB_DATABASE is set from DB_NAME for compatibility
    if (!getenv('DB_DATABASE') && getenv('DB_NAME')) {
        putenv('DB_DATABASE=' . getenv('DB_NAME'));
        $_ENV['DB_DATABASE'] = getenv('DB_NAME');
    }
    // Map DB_USER to DB_USERNAME and DB_PASS to DB_PASSWORD
    if (!getenv('DB_USERNAME') && getenv('DB_USER')) {
        putenv('DB_USERNAME=' . getenv('DB_USER'));
        $_ENV['DB_USERNAME'] = getenv('DB_USER');
    }
    if (!getenv('DB_PASSWORD') && getenv('DB_PASS')) {
        putenv('DB_PASSWORD=' . getenv('DB_PASS'));
        $_ENV['DB_PASSWORD'] = getenv('DB_PASS');
    }
}

// Set default testing environment variables.
//
// 🔴 APP_ENV must be written to $_SERVER and putenv(), not just $_ENV.
//
// Laravel resolves env() through Dotenv's repository, whose default adapters are
// consulted in order: ServerConstAdapter ($_SERVER) BEFORE EnvConstAdapter
// ($_ENV). The Docker dev container sets a real APP_ENV=development, which PHP
// CLI exposes in $_SERVER, so setting only $_ENV['APP_ENV'] here lost the race:
// app()->environment() returned 'development' for the entire local test suite.
// phpunit.xml's <env name="APP_ENV" value="testing"/> could not fix it either —
// PHPUnit's PhpHandler writes putenv() and $_ENV but never $_SERVER, so even
// force="true" leaves the container's $_SERVER value winning.
//
// This was not merely cosmetic. AppServiceProvider::loadCachedJsonTranslations()
// has a testing-only fast path that skips freshness-checking every locale JSON
// file on the bind mount, and a testing-only locale narrowing
// (app.test_translation_locales). Neither ever engaged locally, so every test
// paid ~1.1s of translation-cache work: measured 1,549 ms per test before this
// fix versus ~410 ms after, on tests whose bodies do nothing.
//
// CI was never affected — its workflow exports a real APP_ENV=testing — which is
// exactly why this stayed invisible: local was the slow, divergent one.
$_ENV['APP_ENV'] = 'testing';
$_SERVER['APP_ENV'] = 'testing';
putenv('APP_ENV=testing');
$_ENV['APP_DEBUG'] = 'true';

// Set timezone
date_default_timezone_set('UTC');

// Error reporting
error_reporting(E_ALL);
ini_set('display_errors', '1');

// Define testing constants
define('TESTING', true);
define('BASE_PATH', dirname(__DIR__));
define('TESTS_PATH', __DIR__);

// Initialize test database if needed
if (getenv('DB_DATABASE') === 'nexus_test') {
    // Database will be set up by DatabaseTestCase
}
