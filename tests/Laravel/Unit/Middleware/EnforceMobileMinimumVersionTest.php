<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Middleware;

use App\Http\Middleware\EnforceMobileMinimumVersion;
use Illuminate\Http\Request;
use Illuminate\Http\Response as IlluminateResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Laravel\TestCase;

/**
 * The server half of the mobile force-update lever.
 *
 * Every assertion here corresponds to a way this middleware could take the platform
 * down or lock a member out permanently, which is why it is tested branch by branch:
 * it sits high in the API stack and runs on every single request.
 */
class EnforceMobileMinimumVersionTest extends TestCase
{
    private EnforceMobileMinimumVersion $middleware;

    protected function setUp(): void
    {
        parent::setUp();

        $this->middleware = new EnforceMobileMinimumVersion();

        config()->set('mobile.expo.minimum_version', '1.2.0');
        config()->set('mobile.expo.current_version', '1.3.0');
        config()->set('mobile.expo.update_url', 'https://mobile.project-nexus.ie');
        config()->set('mobile.version_gate_exempt_paths', ['api/app/*']);
    }

    /** Runs the middleware and reports whether the request was let through. */
    private function dispatch(string $path, ?string $version): Response
    {
        $request = Request::create('/' . ltrim($path, '/'), 'GET');
        if ($version !== null) {
            $request->headers->set(EnforceMobileMinimumVersion::VERSION_HEADER, $version);
        }

        return $this->middleware->handle(
            $request,
            fn () => new IlluminateResponse('passed through', 200)
        );
    }

    public function test_it_refuses_a_build_below_the_minimum(): void
    {
        $response = $this->dispatch('api/v2/feed', '1.1.0');

        $this->assertSame(Response::HTTP_UPGRADE_REQUIRED, $response->getStatusCode());
    }

    public function test_the_refusal_carries_everything_the_client_needs(): void
    {
        // 🔴 The update URL comes from the SERVER, deliberately. The copies that need
        // it most are the ones that cannot be updated any other way, so the
        // destination must be changeable without shipping a new binary.
        $response = $this->dispatch('api/v2/feed', '1.0.0');
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(EnforceMobileMinimumVersion::ERROR_CODE, $body['error']['code']);
        $this->assertSame('1.0.0', $body['client_version']);
        $this->assertSame('1.2.0', $body['minimum_version']);
        $this->assertSame('1.3.0', $body['current_version']);
        $this->assertSame('https://mobile.project-nexus.ie', $body['update_url']);
    }

    public function test_it_uses_426_and_not_403(): void
    {
        // 403 is indistinguishable from a permissions problem, and the mobile client
        // treats 401/403 as a session decision — it would sign the member out instead
        // of asking them to update.
        $response = $this->dispatch('api/v2/feed', '1.1.0');

        $this->assertNotSame(403, $response->getStatusCode());
        $this->assertSame(426, $response->getStatusCode());
    }

    public function test_it_allows_a_build_at_exactly_the_minimum(): void
    {
        $response = $this->dispatch('api/v2/feed', '1.2.0');

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_it_allows_a_newer_build(): void
    {
        $response = $this->dispatch('api/v2/feed', '1.4.0');

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_it_allows_a_request_with_no_version_header(): void
    {
        // 🔴 The load-bearing one. Everything without the header is the web frontend,
        // the Capacitor wrapper (which polls instead), a server-to-server caller, or
        // an Expo build from before the header existed. Refusing unknown callers would
        // take the entire API down for the website.
        $response = $this->dispatch('api/v2/feed', null);

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_it_allows_an_empty_version_header(): void
    {
        $response = $this->dispatch('api/v2/feed', '   ');

        $this->assertSame(200, $response->getStatusCode());
    }

    /**
     * @dataProvider malformedVersions
     */
    public function test_it_allows_a_malformed_version_rather_than_locking_someone_out(string $version): void
    {
        // A garbled header must not be able to brick a member's app. Enforcement only
        // acts on a value it can actually compare.
        $response = $this->dispatch('api/v2/feed', $version);

        $this->assertSame(200, $response->getStatusCode(), "should have allowed: {$version}");
    }

    /** @return array<string, array{string}> */
    public static function malformedVersions(): array
    {
        return [
            'words' => ['not-a-version'],
            'leading v' => ['v1.1.0'],
            'suffix' => ['1.1.0-beta'],
            'empty segments' => ['1..0'],
            'too many parts' => ['1.2.3.4.5'],
            'injection attempt' => ["1.1.0'; DROP TABLE users; --"],
        ];
    }

    public function test_the_version_endpoints_are_never_blocked(): void
    {
        // 🔴 Without this exemption a locked-out copy could not even ask what version
        // it needs, turning a recoverable "please update" into a dead end — exactly
        // the defect class this lever exists to prevent.
        $response = $this->dispatch('api/app/check-version', '1.0.0');

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_it_fails_open_when_the_minimum_is_not_configured(): void
    {
        // A missing setting must mean "do not enforce", never "refuse everything".
        config()->set('mobile.expo.minimum_version', '');

        $response = $this->dispatch('api/v2/feed', '0.0.1');

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_it_fails_open_when_deciding_throws(): void
    {
        // The compensating control for sitting on the hottest path in the app: any
        // error while deciding is logged and the request proceeds. A version
        // comparison must never be able to take the platform offline.
        config()->set('mobile.version_gate_exempt_paths', 'not-an-array-and-not-a-string-pattern');

        $response = $this->dispatch('api/v2/feed', '1.1.0');

        $this->assertContains(
            $response->getStatusCode(),
            [200, 426],
            'it must either enforce or allow — never 500'
        );
    }

    public function test_a_two_part_version_still_compares(): void
    {
        // The Capacitor line uses two-part versions ('1.1'), and a future Expo build
        // could too. version_compare handles it; the regex must not reject it.
        config()->set('mobile.expo.minimum_version', '2.0');

        $this->assertSame(426, $this->dispatch('api/v2/feed', '1.9')->getStatusCode());
        $this->assertSame(200, $this->dispatch('api/v2/feed', '2.0')->getStatusCode());
    }
}
