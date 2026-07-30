<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\CorsOriginMatcher;
use PHPUnit\Framework\TestCase;

/**
 * The origin-matching rules, tested once at the place they now live.
 *
 * App\Core\CorsHelper and App\Helpers\CorsHelper both delegate here. Their own
 * test classes still assert the behaviour end-to-end through isOriginAllowed()
 * (including the tenant-custom-domain step, which is not this class's job), but
 * the edge cases of the allowlist itself belong here — including the
 * environment-driven allowlist, which no test covered before 2026-07-30.
 */
final class CorsOriginMatcherTest extends TestCase
{
    /** @var array<string, mixed> */
    private array $savedEnv = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->savedEnv = ['CORS_ALLOWED_SUBDOMAINS' => $_ENV['CORS_ALLOWED_SUBDOMAINS'] ?? null];
        unset($_ENV['CORS_ALLOWED_SUBDOMAINS']);
        putenv('CORS_ALLOWED_SUBDOMAINS');
    }

    protected function tearDown(): void
    {
        putenv('CORS_ALLOWED_SUBDOMAINS');
        unset($_ENV['CORS_ALLOWED_SUBDOMAINS']);
        if ($this->savedEnv['CORS_ALLOWED_SUBDOMAINS'] !== null) {
            $_ENV['CORS_ALLOWED_SUBDOMAINS'] = $this->savedEnv['CORS_ALLOWED_SUBDOMAINS'];
        }
        parent::tearDown();
    }

    public function test_exact_origin_matches(): void
    {
        $this->assertTrue(CorsOriginMatcher::matchesAllowlist(
            'https://project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_unrelated_origin_does_not_match(): void
    {
        $this->assertFalse(CorsOriginMatcher::matchesAllowlist(
            'https://evil.com',
            ['https://project-nexus.ie']
        ));
    }

    /**
     * A suffix match must respect the label boundary. Without the leading dot,
     * "notproject-nexus.ie" ends with "project-nexus.ie" and an attacker only
     * has to register a domain whose name ends with the target's.
     */
    public function test_a_host_merely_ending_in_an_allowed_host_does_not_match(): void
    {
        $this->assertFalse(CorsOriginMatcher::matchesAllowlist(
            'https://notproject-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    /**
     * @dataProvider allowlistedLabelProvider
     */
    public function test_default_allowlisted_labels_match(string $label): void
    {
        $this->assertTrue(CorsOriginMatcher::matchesAllowlist(
            "https://{$label}.project-nexus.ie",
            ['https://project-nexus.ie']
        ));
    }

    /** @return array<string, array{string}> */
    public static function allowlistedLabelProvider(): array
    {
        return [
            'app' => ['app'],
            'api' => ['api'],
            'staging' => ['staging'],
            'admin' => ['admin'],
            'super-admin' => ['super-admin'],
        ];
    }

    /**
     * @dataProvider rejectedHostProvider
     */
    public function test_hosts_outside_the_allowlist_are_rejected(string $host, string $why): void
    {
        $this->assertFalse(
            CorsOriginMatcher::matchesAllowlist("https://{$host}", ['https://project-nexus.ie']),
            $why
        );
    }

    /** @return array<string, array{string, string}> */
    public static function rejectedHostProvider(): array
    {
        return [
            'unlisted label' => [
                'evil.project-nexus.ie',
                'Production reflected exactly this origin before 2026-07-30.',
            ],
            'nested labels' => [
                'a.b.project-nexus.ie',
                'Nested sub-subdomains must never match.',
            ],
            'nested with allowlisted leading label' => [
                'app.b.project-nexus.ie',
                'The whole label set is compared, not just the first label.',
            ],
            'nested with allowlisted trailing label' => [
                'b.app.project-nexus.ie',
                'A nested host is rejected even when its trailing label is allowlisted.',
            ],
            'empty leading label' => [
                '.project-nexus.ie',
                'An empty leading label is not in the allowlist.',
            ],
        ];
    }

    public function test_scheme_must_match(): void
    {
        $this->assertFalse(CorsOriginMatcher::matchesAllowlist(
            'http://app.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_label_matching_is_case_insensitive(): void
    {
        $this->assertTrue(CorsOriginMatcher::matchesAllowlist(
            'https://APP.project-nexus.ie',
            ['https://project-nexus.ie']
        ));
    }

    public function test_malformed_origin_is_rejected_without_error(): void
    {
        $this->assertFalse(CorsOriginMatcher::matchesAllowlist(
            'not-a-valid-origin',
            ['https://project-nexus.ie']
        ));
        $this->assertFalse(CorsOriginMatcher::matchesAllowlist(
            '',
            ['https://project-nexus.ie']
        ));
    }

    /** A non-string entry in the allowlist must be skipped, not fatal. */
    public function test_non_string_allowlist_entries_are_ignored(): void
    {
        $this->assertFalse(CorsOriginMatcher::matchesAllowlist(
            'https://app.project-nexus.ie',
            [null, 123, ['nested']]
        ));
    }

    public function test_env_allowlist_overrides_the_default(): void
    {
        putenv('CORS_ALLOWED_SUBDOMAINS=tenant, PORTAL ');

        $this->assertTrue(
            CorsOriginMatcher::matchesAllowlist('https://tenant.project-nexus.ie', ['https://project-nexus.ie']),
            'A label listed in the env var must match.'
        );
        $this->assertTrue(
            CorsOriginMatcher::matchesAllowlist('https://portal.project-nexus.ie', ['https://project-nexus.ie']),
            'Env labels are trimmed and lowercased.'
        );
        $this->assertFalse(
            CorsOriginMatcher::matchesAllowlist('https://app.project-nexus.ie', ['https://project-nexus.ie']),
            'Setting the env var REPLACES the defaults rather than adding to them — '
            . 'so production must list every label it needs, `app` included.'
        );
    }

    public function test_default_labels_are_used_when_env_is_unset(): void
    {
        $this->assertSame(
            ['app', 'api', 'staging', 'admin', 'super-admin', 'project-nexus'],
            CorsOriginMatcher::allowedSubdomains()
        );
    }
}
