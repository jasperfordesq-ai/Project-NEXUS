<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Infrastructure;

use PHPUnit\Framework\TestCase;

class ProductionFrontendApiProxyTest extends TestCase
{
    public function test_every_react_nginx_config_serves_modern_image_formats_as_static_assets(): void
    {
        $root = dirname(__DIR__, 4);

        foreach (['nginx.conf', 'nginx.bluegreen.conf'] as $config) {
            $source = (string) file_get_contents($root . '/react-frontend/' . $config);

            self::assertMatchesRegularExpression(
                '/location ~\* [^\r\n]*\|webp\|avif\|[^\r\n]*\{/',
                $source,
                $config . ' must not route WebP or AVIF image requests to the SPA shell.',
            );
        }
    }

    public function test_every_react_nginx_config_proxies_same_origin_api_resources(): void
    {
        $root = dirname(__DIR__, 4);

        foreach (['nginx.conf', 'nginx.bluegreen.conf'] as $config) {
            $source = (string) file_get_contents($root . '/react-frontend/' . $config);

            self::assertStringContainsString('location = /api/v2/pwa/manifest {', $source, $config);
            self::assertStringContainsString('proxy_set_header Host $host;', $source, $config);
            self::assertStringContainsString('location ^~ /api/ {', $source, $config);
            self::assertStringContainsString('proxy_set_header Host api.project-nexus.ie;', $source, $config);
            self::assertStringContainsString('proxy_set_header X-Forwarded-Host $host;', $source, $config);
        }
    }

    /**
     * Since the browser session moved to same-origin requests (a9df1e55d), every
     * upload reaches Laravel through this nginx. Without an explicit limit nginx
     * applies its 1 MB default and answers 413 itself, so an ordinary phone photo
     * could not become an avatar on any community. The proxy must accept at least
     * what PHP accepts, or nginx — not the application — decides the upload limit.
     */
    public function test_every_react_nginx_api_proxy_accepts_uploads_as_large_as_php_does(): void
    {
        $root = dirname(__DIR__, 4);

        $dockerfile = (string) file_get_contents($root . '/Dockerfile.prod');
        self::assertMatchesRegularExpression('/post_max_size = (\d+)M/', $dockerfile);
        preg_match('/post_max_size = (\d+)M/', $dockerfile, $php);
        $phpLimitMb = (int) $php[1];

        foreach (['nginx.conf', 'nginx.bluegreen.conf'] as $config) {
            $source = (string) file_get_contents($root . '/react-frontend/' . $config);

            self::assertMatchesRegularExpression(
                '/location \^~ \/api\/ \{[^}]*client_max_body_size (\d+)m;/',
                $source,
                $config . ' /api/ proxy must set client_max_body_size, or nginx rejects every upload over 1 MB.',
            );
            preg_match('/location \^~ \/api\/ \{[^}]*client_max_body_size (\d+)m;/', $source, $nginx);

            self::assertGreaterThanOrEqual(
                $phpLimitMb,
                (int) $nginx[1],
                $config . ' /api/ proxy limit is below PHP post_max_size; nginx would refuse uploads PHP allows.',
            );
        }
    }
}
