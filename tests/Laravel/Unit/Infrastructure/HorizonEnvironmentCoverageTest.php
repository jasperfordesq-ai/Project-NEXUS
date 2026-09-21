<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Infrastructure;

use PHPUnit\Framework\TestCase;

/**
 * Horizon spawns workers for `config('horizon.environments')[app()->environment()]`.
 * When the running APP_ENV has NO entry, Horizon starts its master supervisor, logs
 * "Horizon started successfully", and spawns ZERO workers. Queued work then silently
 * never runs — including password-reset and notification mail — and the container's
 * healthcheck (which requires both an `artisan horizon` and a `horizon:work` process)
 * fails with nothing in the logs to explain it.
 *
 * That happened on the first staging deployment, 21 September 2026: `staging` was
 * missing, so the queue container sat unhealthy while reporting success. This test pins
 * every environment the platform is deployed under so the gap cannot reappear.
 *
 * Deliberately a plain TestCase that reads the config file: booting the framework to
 * check a static array would be slower and would hide the gap behind whatever APP_ENV
 * the test runner happens to use.
 */
class HorizonEnvironmentCoverageTest extends TestCase
{
    /**
     * Every APP_ENV the platform is deployed or developed under.
     *
     * `production` — the live platform.
     * `staging`    — the isolated staging/pen-test target (Azure, Sweden Central).
     * `local`      — developer Docker stack.
     * `testing`    — phpunit; runs jobs synchronously, but an entry keeps
     *                `horizon:status` and this test from needing a special case.
     *
     * @var list<string>
     */
    private const REQUIRED_ENVIRONMENTS = ['production', 'staging', 'local', 'testing'];

    /** @return array<string, mixed> */
    private function horizonConfig(): array
    {
        // config/horizon.php calls env(); provide a shim if the helper is absent so
        // this test does not depend on the framework being booted.
        if (! function_exists('env')) {
            require_once __DIR__ . '/../../../../vendor/autoload.php';
        }

        $path = dirname(__DIR__, 4) . '/config/horizon.php';
        self::assertFileExists($path, 'config/horizon.php is missing');

        /** @var array<string, mixed> $config */
        $config = require $path;

        return $config;
    }

    public function test_every_deployed_environment_has_a_worker_configuration(): void
    {
        $config = $this->horizonConfig();

        self::assertArrayHasKey('environments', $config, 'horizon config has no environments key');
        $environments = $config['environments'];
        self::assertIsArray($environments);

        foreach (self::REQUIRED_ENVIRONMENTS as $env) {
            self::assertArrayHasKey(
                $env,
                $environments,
                "config/horizon.php has no '{$env}' environment. Horizon would start with ZERO "
                . 'workers under that APP_ENV and queued jobs would silently never run.',
            );

            self::assertIsArray($environments[$env], "horizon.environments.{$env} must be an array");
            self::assertNotEmpty(
                $environments[$env],
                "horizon.environments.{$env} defines no supervisor, so no worker would start.",
            );
        }
    }

    public function test_every_supervisor_can_actually_run_a_process(): void
    {
        $environments = $this->horizonConfig()['environments'];
        self::assertIsArray($environments);

        foreach ($environments as $env => $supervisors) {
            self::assertIsArray($supervisors, "horizon.environments.{$env} must be an array");

            foreach ($supervisors as $name => $supervisor) {
                self::assertIsArray($supervisor, "{$env}.{$name} must be an array");
                self::assertArrayHasKey(
                    'maxProcesses',
                    $supervisor,
                    "{$env}.{$name} has no maxProcesses, so the process count is undefined.",
                );
                self::assertGreaterThanOrEqual(
                    1,
                    $supervisor['maxProcesses'],
                    "{$env}.{$name} allows fewer than one process, so no work would be consumed.",
                );
            }
        }
    }

    public function test_staging_mirrors_production_supervisor_shape(): void
    {
        $environments = $this->horizonConfig()['environments'];
        self::assertIsArray($environments);

        // A staging box exists to rehearse production. If the two grow different
        // supervisor names, a queue that works on staging can still fail on production.
        self::assertSame(
            array_keys($environments['production']),
            array_keys($environments['staging']),
            'staging and production must define the same supervisor names so staging '
            . 'genuinely rehearses production queue behaviour.',
        );
    }
}
