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

    /**
     * F-359. Every request a member makes reaches Laravel through this nginx,
     * and nginx buffers the whole request body before it opens the upstream
     * connection. Laravel's `throttle:` limiters therefore run only AFTER the
     * body has been read, so a client that dribbles a body up to the 105 MB cap
     * holds an nginx connection for as long as it likes and the application
     * never gets a say.
     *
     * The fix at this layer is a read timeout, not a rate limit. Both configs
     * must set `client_body_timeout` inside the /api/ location.
     */
    public function test_every_react_nginx_api_proxy_bounds_how_long_a_client_may_take_to_send_a_body(): void
    {
        $root = dirname(__DIR__, 4);

        foreach (['nginx.conf', 'nginx.bluegreen.conf'] as $config) {
            $source = (string) file_get_contents($root . '/react-frontend/' . $config);

            self::assertMatchesRegularExpression(
                '/location \^~ \/api\/ \{[^}]*client_body_timeout \d+s;/',
                $source,
                $config . ' /api/ proxy must bound how long a client may stall mid-body (F-359);'
                . ' without it a slow body holds an nginx connection indefinitely and Laravel'
                . ' never sees the request.',
            );
        }
    }

    /**
     * 🔴 The companion half of F-359, and the reason it is a timeout rather than
     * a rate limit.
     *
     * `limit_req` and `limit_conn` are keyed per client address. The accessible
     * frontend (`web-uk`) is a server-side application: every one of its members'
     * requests reaches this proxy from ONE address. A per-address ceiling on
     * /api/ would throttle the whole accessible frontend — every community on
     * accessible.project-nexus.ie and every per-community accessible domain —
     * on behalf of a single busy member.
     *
     * Keying on `X-Forwarded-For` instead is worse, not better: that is caller
     * input, so it hands the attacker the key.
     *
     * Rate limiting belongs in the application, where the caller is identified.
     * This test exists so that a future change adding a per-address limiter here
     * has to delete it, read this, and make the decision deliberately.
     */
    public function test_the_api_proxy_does_not_carry_a_per_address_rate_or_connection_limit(): void
    {
        $root = dirname(__DIR__, 4);

        foreach (['nginx.conf', 'nginx.bluegreen.conf'] as $config) {
            $source = (string) file_get_contents($root . '/react-frontend/' . $config);

            preg_match('/location \^~ \/api\/ \{[^}]*\}/', $source, $block);
            self::assertNotEmpty($block, $config . ' has no /api/ proxy block.');

            // Comment lines are stripped first: the block deliberately EXPLAINS
            // why there is no limiter, and naming the directives in prose must
            // not read as using them.
            $directives = preg_replace('/^\s*#.*$/m', '', $block[0]);

            self::assertDoesNotMatchRegularExpression(
                '/\blimit_(req|conn)\b/',
                (string) $directives,
                $config . ' /api/ proxy must not carry a per-address rate or connection limit:'
                . ' web-uk reaches it from a single address on behalf of every accessible-site'
                . ' member, so one busy member would throttle every community. See F-359.',
            );
        }
    }
}
