<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E086;

use PHPUnit\Framework\TestCase;

/**
 * F-552 (E-086, reported by Cyphere): the React container ran nginx 1.27.5 —
 * frozen there by the `nginx:alpine3.21` tag — and printed that version in the
 * body of every error page it generated itself (e.g. the 410 for /wp-login.php),
 * on production and on the pen-test server alike.
 *
 * Pins three things: the image follows a supported stable nginx line, both
 * production Dockerfiles and every nginx test script use that same image (so CI
 * tests what ships), and both configs switch version disclosure off.
 */
final class F552ReactNginxVersionDisclosureTest extends TestCase
{
    private const DOCKERFILES = [
        'react-frontend/Dockerfile.prod',
        'react-frontend/Dockerfile.bluegreen',
    ];

    private const CONFIGS = [
        'react-frontend/nginx.conf',
        'react-frontend/nginx.bluegreen.conf',
    ];

    /** Scripts that start the React nginx image to test its configuration. */
    private const TEST_SCRIPTS = [
        'scripts/test/test-react-nginx-config-syntax.sh',
        'scripts/test/test-prerender-nginx-runtime.sh',
        'scripts/test/test-prerender-acl-runtime.sh',
        'scripts/test/test-maintenance-prerender-contract.sh',
    ];

    /** Oldest nginx stable line accepted. 1.27.x is end of life. */
    private const MINIMUM_STABLE_MINOR = 30;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = dirname(__DIR__, 5);
    }

    public function test_production_images_track_a_supported_stable_nginx_line(): void
    {
        $images = [];
        foreach (self::DOCKERFILES as $file) {
            $source = $this->read($file);
            self::assertSame(
                1,
                preg_match('/^FROM\s+(nginx:\S+)\s+AS\s+production\s*$/mi', $source, $match),
                "{$file} must have exactly one nginx production stage"
            );
            $images[$file] = $match[1];
        }

        self::assertCount(1, array_unique($images), 'Both production Dockerfiles must ship the same nginx image');

        $image = reset($images);
        self::assertSame(
            1,
            preg_match('/^nginx:1\.(\d+)-alpine$/', $image, $version),
            "Pin a stable nginx line such as nginx:1.30-alpine, not a distro tag that freezes the nginx version (got {$image})"
        );
        $minor = (int) $version[1];
        self::assertSame(0, $minor % 2, "nginx 1.{$minor} is a mainline branch; production follows an even-numbered stable line");
        self::assertGreaterThanOrEqual(self::MINIMUM_STABLE_MINOR, $minor, "nginx 1.{$minor} is no longer supported");
    }

    public function test_nginx_test_scripts_use_the_image_that_ships(): void
    {
        preg_match('/^FROM\s+(nginx:\S+)\s+AS\s+production\s*$/mi', $this->read(self::DOCKERFILES[0]), $match);
        $shipped = $match[1];

        foreach (self::TEST_SCRIPTS as $script) {
            $source = $this->read($script);
            preg_match_all('/\bnginx:[A-Za-z0-9._-]+/', $source, $found);
            self::assertNotEmpty($found[0], "{$script} no longer names an nginx image; update this list");
            foreach ($found[0] as $image) {
                self::assertSame($shipped, $image, "{$script} tests {$image} but production ships {$shipped}");
            }
        }
    }

    public function test_both_configs_hide_the_nginx_version(): void
    {
        foreach (self::CONFIGS as $file) {
            self::assertMatchesRegularExpression(
                '/^server_tokens\s+off;/m',
                $this->read($file),
                "{$file} must set `server_tokens off;` at file level, which applies to every server block"
            );
        }
    }

    private function read(string $relative): string
    {
        $path = $this->root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }
}
