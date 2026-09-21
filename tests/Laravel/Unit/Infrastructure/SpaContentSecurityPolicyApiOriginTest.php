<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Infrastructure;

use PHPUnit\Framework\TestCase;

/**
 * The canonical SPA Content-Security-Policy hardcoded `https://api.project-nexus.ie`
 * into `connect-src` with no substitution, while `${NEXUS_API_UPSTREAM}` a few lines
 * below it WAS substituted. Any deployment whose API is not on that exact hostname was
 * therefore refused permission BY THE BROWSER to reach its own API.
 *
 * The failure is silent in every place an operator would look. Found 21 September 2026
 * on the first staging deployment: the page loaded, assets returned 200, DNS resolved,
 * the certificate was valid, CORS preflight returned 204 with the correct
 * Access-Control-Allow-Origin, curl to the API worked, and navigating straight to the
 * API URL returned JSON — while the app showed "Unable to connect". CSP blocks the
 * request before one is made, so there is no CORS error and no failed request to find.
 *
 * `${NEXUS_CSP_EXTRA_ORIGINS}` is the fix: empty on production (so the policy is
 * byte-identical to its historical value) and set to the API origin elsewhere. It only
 * works if the WHOLE chain holds, so this test pins every link:
 *
 *   1. the placeholder is inside connect-src in both nginx configs
 *   2. both configs are installed as TEMPLATES, so nginx substitutes them
 *   3. both images DECLARE the variable, because envsubst only replaces defined
 *      variables — an undeclared one survives as a literal into the live header
 *   4. compose passes it through to the frontend service
 *
 * See docs/DEPLOYMENT-LESSONS.md.
 */
class SpaContentSecurityPolicyApiOriginTest extends TestCase
{
    private const PLACEHOLDER = '${NEXUS_CSP_EXTRA_ORIGINS}';

    /** @var array<string, string> nginx config => Dockerfile that installs it */
    private const CONFIG_TO_IMAGE = [
        'react-frontend/nginx.conf' => 'react-frontend/Dockerfile.prod',
        'react-frontend/nginx.bluegreen.conf' => 'react-frontend/Dockerfile.bluegreen',
    ];

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = dirname(__DIR__, 4);
    }

    private function read(string $relative): string
    {
        $path = $this->root . DIRECTORY_SEPARATOR . $relative;
        self::assertFileExists($path, "{$relative} is missing");

        return (string) file_get_contents($path);
    }

    private function canonicalPolicy(string $source, string $file): string
    {
        $matched = preg_match(
            '/map\s+\$host\s+\$nexus_spa_content_security_policy\s*\{\s*default\s+"([^"]+)";\s*\}/s',
            $source,
            $matches,
        );
        self::assertSame(1, $matched, "{$file} must define the canonical SPA CSP map");

        return $matches[1];
    }

    private function directive(string $policy, string $name, string $file): string
    {
        foreach (explode(';', $policy) as $segment) {
            $segment = trim($segment);
            if (str_starts_with($segment, $name . ' ')) {
                return $segment;
            }
        }

        self::fail("{$file} canonical policy has no {$name} directive");
    }

    /**
     * Every directive that lists the API as a SOURCE needs the placeholder, not just
     * connect-src. Adding it to connect-src alone was the first, incomplete fix: the app
     * could then reach its API for data, but `img-src` still refused images served from
     * the API origin, so default avatars failed with no useful error. `frame-src` has the
     * same exposure for anything embedded from the API.
     *
     * `report-uri` is deliberately excluded — it takes a single URI, not a source list.
     */
    public function test_every_api_source_directive_carries_the_placeholder(): void
    {
        foreach (array_keys(self::CONFIG_TO_IMAGE) as $file) {
            $policy = $this->canonicalPolicy($this->read($file), $file);

            foreach (['img-src', 'connect-src', 'frame-src'] as $directive) {
                $segment = $this->directive($policy, $directive, $file);

                self::assertStringContainsString(
                    self::PLACEHOLDER,
                    $segment,
                    "{$file} {$directive} must include " . self::PLACEHOLDER . ' so a deployment '
                    . 'whose API is not on https://api.project-nexus.ie can permit its own API '
                    . "origin. Without it the browser silently refuses that origin for {$directive}.",
                );

                // Production must keep working unchanged when the variable is empty.
                self::assertStringContainsString(
                    'https://api.project-nexus.ie',
                    $segment,
                    "{$file} {$directive} must still allow the production API literally, so an "
                    . 'empty placeholder leaves production behaviour untouched.',
                );
            }

            // A single-URI directive must NOT be given a source-list placeholder.
            self::assertStringNotContainsString(
                self::PLACEHOLDER,
                $this->directive($policy, 'report-uri', $file),
                "{$file} report-uri takes one URI, so the placeholder must not be added to it.",
            );
        }
    }

    public function test_both_images_install_the_config_as_a_template(): void
    {
        foreach (self::CONFIG_TO_IMAGE as $config => $dockerfile) {
            $source = $this->read($dockerfile);
            $basename = basename($config);

            self::assertMatchesRegularExpression(
                '/COPY\s+' . preg_quote($basename, '/') . '\s+\/etc\/nginx\/templates\//',
                $source,
                "{$dockerfile} must COPY {$basename} into /etc/nginx/templates/ so nginx "
                . 'substitutes ' . self::PLACEHOLDER . '. Copying it straight into conf.d leaves '
                . 'the placeholder as a literal string inside the live CSP header.',
            );
        }
    }

    public function test_both_images_declare_the_variable_so_envsubst_replaces_it(): void
    {
        foreach (array_values(self::CONFIG_TO_IMAGE) as $dockerfile) {
            self::assertMatchesRegularExpression(
                '/^ENV\s+NEXUS_CSP_EXTRA_ORIGINS=("")?\s*$/m',
                $this->read($dockerfile),
                "{$dockerfile} must declare ENV NEXUS_CSP_EXTRA_ORIGINS=\"\". The nginx image's "
                . 'envsubst step only replaces variables present in the environment, so an '
                . 'undeclared placeholder is emitted verbatim in the Content-Security-Policy.',
            );
        }
    }

    public function test_compose_passes_the_variable_to_the_frontend(): void
    {
        self::assertStringContainsString(
            'NEXUS_CSP_EXTRA_ORIGINS=${NEXUS_CSP_EXTRA_ORIGINS:-}',
            $this->read('compose.bluegreen.yml'),
            'compose.bluegreen.yml must pass NEXUS_CSP_EXTRA_ORIGINS to the frontend service, '
            . 'defaulting to empty so production is unaffected.',
        );
    }
}
