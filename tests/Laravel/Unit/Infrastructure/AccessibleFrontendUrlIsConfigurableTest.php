<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Infrastructure;

use PHPUnit\Framework\TestCase;

/**
 * The "Accessible version" link in the navbar and mobile drawer is built by
 * `src/lib/accessible-frontend.ts`, which reads `VITE_ACCESSIBLE_FRONTEND_BASE_URL` and
 * falls back to the hardcoded PRODUCTION host when it is unset.
 *
 * Neither frontend image declared that build argument, so no containerised build could
 * ever set it — the fallback was the only reachable value. Found 21 September 2026 while
 * deciding whether to hand a penetration tester the accessible hostnames: on the staging
 * deployment the bundle carried `https://accessible.project-nexus.ie`.
 *
 * It did not fire, because every tenant row happened to carry its own `accessible_domain`
 * and the resolver checks that first. 🔴 But a tenant with NO accessible_domain uses the
 * fallback — and a super-admin creating a tenant makes exactly such a row. On a staging or
 * test deployment that link then sends the user to the LIVE production site. For a
 * penetration tester holding super-admin credentials that means being handed a link out of
 * the authorised scope and into production.
 *
 * Declaring the argument (defaulting to the production host, so production is unchanged)
 * makes the value configurable per deployment. This test pins that it stays configurable:
 * an image that stops accepting it silently re-imposes the single hardcoded destination.
 *
 * Same defect family as SpaContentSecurityPolicyApiOriginTest — a value that must vary by
 * environment, which could not actually vary. See docs/DEPLOYMENT-LESSONS.md.
 */
class AccessibleFrontendUrlIsConfigurableTest extends TestCase
{
    private const VAR = 'VITE_ACCESSIBLE_FRONTEND_BASE_URL';

    private const DOCKERFILES = [
        'react-frontend/Dockerfile.prod',
        'react-frontend/Dockerfile.bluegreen',
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

    public function test_both_images_accept_the_variable_as_a_build_argument(): void
    {
        foreach (self::DOCKERFILES as $dockerfile) {
            $source = $this->read($dockerfile);

            self::assertMatchesRegularExpression(
                '/^ARG\s+' . self::VAR . '=\S+/m',
                $source,
                "{$dockerfile} must declare ARG " . self::VAR . ' with a default. Without the '
                . 'ARG, --build-arg is ignored and every build falls back to the hardcoded '
                . 'production host, so a non-production deployment links its members to the '
                . 'LIVE accessible site.',
            );

            self::assertMatchesRegularExpression(
                '/^ENV\s+' . self::VAR . '=\$' . self::VAR . '\s*$/m',
                $source,
                "{$dockerfile} must forward the argument into ENV. Vite only inlines variables "
                . 'present in the build environment, so an ARG that is never promoted to ENV '
                . 'has no effect on the bundle.',
            );
        }
    }

    /**
     * The default must stay the production host, so adding the argument cannot change what
     * production builds today.
     */
    public function test_the_default_keeps_production_behaviour_unchanged(): void
    {
        foreach (self::DOCKERFILES as $dockerfile) {
            self::assertMatchesRegularExpression(
                '/^ARG\s+' . self::VAR . '=https:\/\/accessible\.project-nexus\.ie\s*$/m',
                $this->read($dockerfile),
                "{$dockerfile} must default " . self::VAR . ' to https://accessible.project-nexus.ie, '
                . 'which is the value the source already falls back to. A different default would '
                . 'silently change where production sends its members.',
            );
        }
    }

    /**
     * compose must hand the value to the build, sourced from the environment. Without this
     * a new environment has to edit compose itself to change the destination, which is the
     * same trap one level up: the value is configurable in principle and not in practice.
     */
    public function test_compose_passes_the_variable_from_the_environment(): void
    {
        self::assertStringContainsString(
            'VITE_ACCESSIBLE_FRONTEND_BASE_URL: ${ACCESSIBLE_FRONTEND_BASE_URL:-https://accessible.project-nexus.ie}',
            $this->read('compose.bluegreen.yml'),
            'compose.bluegreen.yml must pass ' . self::VAR . ' as a build argument, defaulting '
            . 'to the production host so production is unaffected. Sourcing it from '
            . 'ACCESSIBLE_FRONTEND_BASE_URL lets a deployment set it in its environment file '
            . 'instead of editing this file.',
        );
    }

    /**
     * The source must keep reading the variable. If someone removes the lookup, the build
     * argument above becomes decoration and the destination is hardcoded again.
     */
    public function test_the_source_still_reads_the_variable(): void
    {
        $source = $this->read('react-frontend/src/lib/accessible-frontend.ts');

        self::assertStringContainsString(
            'import.meta.env.' . self::VAR,
            $source,
            'accessible-frontend.ts must read ' . self::VAR . '. Without the lookup the build '
            . 'argument has no effect and the accessible link is hardcoded to production.',
        );
    }
}
