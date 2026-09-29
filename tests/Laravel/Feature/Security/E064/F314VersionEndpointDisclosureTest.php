<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E064;

use Tests\Laravel\TestCase;

/**
 * F-314 (E-062 F-11): the unauthenticated /version.php named the exact PHP
 * patch level (CVE matching) and the deployed commit's message (security
 * fixes are titled with their finding id, so the message says which fix is
 * live).
 *
 * 🔴 The endpoint is load-bearing and stays public: scripts/deploy/
 * bluegreen-deploy.sh (candidate + public cutover checks), phases/
 * candidate-journeys.sh, .github/workflows/deploy-drift-watchdog.yml and the
 * security register all read its `commit` field. So the control half of each
 * test proves `commit` / `commit_short` / `deployed_at` / `service` survive.
 */
final class F314VersionEndpointDisclosureTest extends TestCase
{
    private string $buildVersionFile;
    private bool $createdBuildVersion = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildVersionFile = base_path('httpdocs/.build-version');
    }

    protected function tearDown(): void
    {
        if ($this->createdBuildVersion) {
            @unlink($this->buildVersionFile);
            $this->createdBuildVersion = false;
        }
        parent::tearDown();
    }

    /** @return array<string, mixed> */
    private function runVersionEndpoint(): array
    {
        $output = [];
        $exit = 0;
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(base_path('httpdocs/version.php')) . ' 2>/dev/null', $output, $exit);
        $this->assertSame(0, $exit, 'version.php must run');
        $decoded = json_decode(implode("\n", $output), true);
        $this->assertIsArray($decoded, 'version.php must answer JSON');

        return $decoded;
    }

    public function test_the_deployed_build_file_path_no_longer_discloses_php_version_or_commit_message(): void
    {
        if (file_exists($this->buildVersionFile)) {
            $this->markTestSkipped('A real httpdocs/.build-version exists; not overwriting it.');
        }

        // The exact shape scripts/deploy/phases/write-build-version.sh writes.
        file_put_contents($this->buildVersionFile, json_encode([
            'service' => 'nexus-php-api',
            'commit' => '0123456789abcdef0123456789abcdef01234567',
            'commit_short' => '01234567',
            'commit_message' => 'fix(security): close the thing (F-999)',
            'deployed_at' => '2026-09-29T12:00:00Z',
            'deploy_mode' => 'bluegreen',
        ]));
        $this->createdBuildVersion = true;

        $version = $this->runVersionEndpoint();

        $this->assertArrayNotHasKey('php_version', $version);
        $this->assertArrayNotHasKey('commit_message', $version);
        $this->assertStringNotContainsString(PHP_VERSION, json_encode($version));
        $this->assertStringNotContainsString('F-999', json_encode($version));

        // Control: everything the deploy tooling and the register read is still there.
        $this->assertSame('nexus-php-api', $version['service']);
        $this->assertSame('0123456789abcdef0123456789abcdef01234567', $version['commit']);
        $this->assertSame('01234567', $version['commit_short']);
        $this->assertSame('2026-09-29T12:00:00Z', $version['deployed_at']);
        $this->assertSame('bluegreen', $version['deploy_mode']);
    }

    public function test_the_development_fallback_does_not_disclose_them_either(): void
    {
        if (file_exists($this->buildVersionFile)) {
            $this->markTestSkipped('A real httpdocs/.build-version exists; the git fallback is not in use.');
        }

        $version = $this->runVersionEndpoint();

        $this->assertArrayNotHasKey('php_version', $version);
        $this->assertArrayNotHasKey('commit_message', $version);
        $this->assertArrayHasKey('commit', $version, 'control: the commit field the tooling reads');
    }
}
