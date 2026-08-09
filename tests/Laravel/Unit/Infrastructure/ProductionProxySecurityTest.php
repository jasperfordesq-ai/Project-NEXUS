<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Infrastructure;

use PHPUnit\Framework\TestCase;

class ProductionProxySecurityTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = dirname(__DIR__, 4);
    }

    public function test_php_images_use_the_host_appended_forwarded_chain_and_one_csp_authority(): void
    {
        foreach (['Dockerfile.bluegreen', 'Dockerfile.prod'] as $file) {
            $source = (string) file_get_contents($this->root . DIRECTORY_SEPARATOR . $file);

            self::assertStringContainsString('RemoteIPHeader X-Forwarded-For', $source, $file);
            self::assertStringNotContainsString('RemoteIPHeader CF-Connecting-IP', $source, $file);
            self::assertStringNotContainsString('Header always set Content-Security-Policy', $source, $file);
        }
    }

    public function test_production_origin_ports_are_loopback_bound(): void
    {
        $blueGreen = (string) file_get_contents($this->root . DIRECTORY_SEPARATOR . 'compose.bluegreen.yml');
        self::assertStringContainsString('127.0.0.1:${NEXUS_API_PORT:-8190}:80', $blueGreen);
        self::assertStringContainsString('127.0.0.1:${NEXUS_FRONTEND_PORT:-3100}:80', $blueGreen);

        // Origin containers must never publish on a public interface — Apache
        // is the only thing allowed to face the internet.
        self::assertStringNotContainsString('0.0.0.0:', $blueGreen);
    }

    /**
     * compose.prod.yml described the legacy single-color `nexus-php-*` stack,
     * which stopped running in production in 2026-05 (verified via `docker ps`:
     * only the blue and green containers exist, and nexus-php-queue had exited
     * three months before this file was deleted on 2026-08-09). It was removed
     * along with the build/rollback phase scripts that copied it into place.
     *
     * This assertion exists because the file was NOT inert while it sat there:
     * a deploy-time validation step failed if it was missing, a fallback deploy
     * path copied it over compose.yml, and this very test read it. Bringing it
     * back would silently restore all three. If it ever needs to return, delete
     * this test deliberately rather than letting the file reappear unnoticed.
     */
    public function test_legacy_single_color_compose_file_stays_deleted(): void
    {
        self::assertFileDoesNotExist(
            $this->root . DIRECTORY_SEPARATOR . 'compose.prod.yml',
            'compose.prod.yml is the deleted legacy single-color stack — production is blue-green only.'
        );
    }
}
