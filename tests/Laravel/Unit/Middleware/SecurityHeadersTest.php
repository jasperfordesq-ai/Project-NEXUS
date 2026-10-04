<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Http\Middleware\SecurityHeaders;
use Illuminate\Http\Request;
use Tests\Laravel\TestCase;

class SecurityHeadersTest extends TestCase
{
    private SecurityHeaders $middleware;

    protected function setUp(): void
    {
        parent::setUp();
        $this->middleware = new SecurityHeaders();
    }

    private function makeNext(): \Closure
    {
        return function ($request) {
            return response()->json(['ok' => true], 200);
        };
    }

    /**
     * @return array<string, list<string>>
     */
    private function parseCsp(string $policy): array
    {
        $directives = [];
        foreach (explode(';', $policy) as $segment) {
            $tokens = preg_split('/\s+/', trim($segment)) ?: [];
            if ($tokens === []) {
                continue;
            }

            $name = array_shift($tokens);
            if (is_string($name) && $name !== '') {
                $directives[$name] = array_values($tokens);
            }
        }

        return $directives;
    }

    public function test_handle_sets_x_frame_options(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals('SAMEORIGIN', $response->headers->get('X-Frame-Options'));
    }

    public function test_handle_sets_x_content_type_options(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals('nosniff', $response->headers->get('X-Content-Type-Options'));
    }

    public function test_handle_sets_x_xss_protection(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals('1; mode=block', $response->headers->get('X-XSS-Protection'));
    }

    public function test_handle_sets_content_security_policy(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $csp = $response->headers->get('Content-Security-Policy');
        $this->assertNotNull($csp);
        $directives = $this->parseCsp($csp);

        $requiredSources = [
            'default-src' => ["'self'"],
            'script-src' => [
                "'self'",
                'https://*.googleapis.com',
                'https://*.gstatic.com',
                'https://*.google.com',
                'https://*.ggpht.com',
                'https://*.googleusercontent.com',
                'https://challenges.cloudflare.com',
            ],
            'connect-src' => [
                "'self'",
                'https://*.googleapis.com',
                'https://*.gstatic.com',
                'https://*.google.com',
                'https://challenges.cloudflare.com',
                'https://api.pwnedpasswords.com',
            ],
            'frame-src' => [
                "'self'",
                'https://*.google.com',
                'https://challenges.cloudflare.com',
                'https://www.openstreetmap.org',
            ],
            'frame-ancestors' => ["'self'"],
        ];
        foreach ($requiredSources as $directive => $sources) {
            $this->assertArrayHasKey($directive, $directives);
            foreach ($sources as $source) {
                $this->assertContains($source, $directives[$directive], "{$directive} must allow {$source}");
            }
        }

        $this->assertMatchesRegularExpression("/'nonce-[a-f0-9]{32}'/", $csp);
        $this->assertStringNotContainsString('stripe.com', $csp);
        $this->assertStringNotContainsString('pusher.com', $csp);
        $this->assertDoesNotMatchRegularExpression('/(?:default|script|connect)-src[^;]*\\shttps:(?:\\s|;)/', $csp);
    }

    public function test_handle_sets_referrer_policy(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals('strict-origin-when-cross-origin', $response->headers->get('Referrer-Policy'));
    }

    public function test_handle_configures_csp_reporting_endpoint(): void
    {
        $response = $this->middleware->handle(Request::create('/api/v2/feed', 'GET'), $this->makeNext());

        $this->assertStringContainsString('report-uri /api/csp-report', (string) $response->headers->get('Content-Security-Policy'));
        $this->assertStringContainsString('report-to nexus-csp', (string) $response->headers->get('Content-Security-Policy'));
        $this->assertSame('nexus-csp="/api/csp-report"', $response->headers->get('Reporting-Endpoints'));
    }

    public function test_handle_preserves_a_stricter_endpoint_referrer_policy(): void
    {
        $request = Request::create('/api/v2/events/calendar/feed-tokens', 'POST');
        $response = $this->middleware->handle($request, static function ($request) {
            return response()
                ->json(['ok' => true])
                ->header('Referrer-Policy', 'no-referrer');
        });

        $this->assertEquals('no-referrer', $response->headers->get('Referrer-Policy'));
    }

    public function test_handle_replaces_a_weaker_endpoint_referrer_policy(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, static function ($request) {
            return response()
                ->json(['ok' => true])
                ->header('Referrer-Policy', 'unsafe-url');
        });

        $this->assertEquals('strict-origin-when-cross-origin', $response->headers->get('Referrer-Policy'));
    }

    /**
     * F-555 (E-088): private file endpoints (message attachments, voice, admin
     * support screenshots) set a locked-down CSP so a stored file opened
     * directly can run nothing. The platform policy used to replace it.
     */
    public function test_handle_preserves_a_locked_down_endpoint_csp(): void
    {
        $request = Request::create('/api/v2/messages/1/attachments/1', 'GET');
        $response = $this->middleware->handle($request, static function ($request) {
            return response('file-bytes')
                ->header('Content-Security-Policy', "default-src 'none'; sandbox");
        });

        $this->assertSame("default-src 'none'; sandbox", $response->headers->get('Content-Security-Policy'));
    }

    public function test_handle_preserves_a_locked_down_endpoint_csp_without_sandbox(): void
    {
        $request = Request::create('/api/v2/admin/support-reports/1/screenshots/1', 'GET');
        $response = $this->middleware->handle($request, static function ($request) {
            return response('file-bytes')->header('Content-Security-Policy', "default-src 'none'");
        });

        $this->assertSame("default-src 'none'", $response->headers->get('Content-Security-Policy'));
    }

    public function test_handle_replaces_an_endpoint_csp_that_loosens_scripts(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, static function ($request) {
            return response('x')->header('Content-Security-Policy', "default-src 'none'; script-src *");
        });

        $csp = (string) $response->headers->get('Content-Security-Policy');
        $this->assertStringContainsString("default-src 'self'", $csp);
        $this->assertStringNotContainsString('script-src *', $csp);
    }

    public function test_handle_replaces_a_weaker_endpoint_csp(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, static function ($request) {
            return response('x')->header('Content-Security-Policy', "default-src *");
        });

        $this->assertStringContainsString("default-src 'self'", (string) $response->headers->get('Content-Security-Policy'));
    }

    public function test_handle_sets_permissions_policy(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $policy = $response->headers->get('Permissions-Policy');
        $this->assertNotNull($policy);
        $this->assertStringContainsString('camera=(self)', $policy);
        $this->assertStringContainsString('microphone=(self)', $policy);
        $this->assertStringContainsString('payment=()', $policy);
    }

    public function test_handle_sets_hsts_on_secure_request(): void
    {
        $request = Request::create('https://app.project-nexus.ie/api/v2/feed', 'GET', [], [], [], [
            'HTTPS' => 'on',
        ]);
        $response = $this->middleware->handle($request, $this->makeNext());

        $hsts = $response->headers->get('Strict-Transport-Security');
        $this->assertNotNull($hsts);
        $this->assertStringContainsString('max-age=31536000', $hsts);
        $this->assertStringContainsString('includeSubDomains', $hsts);
        $this->assertStringContainsString('preload', $hsts);
    }

    public function test_handle_does_not_set_hsts_on_insecure_request(): void
    {
        $request = Request::create('http://localhost/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertNull($response->headers->get('Strict-Transport-Security'));
    }

    public function test_handle_preserves_original_response_status(): void
    {
        $next = function ($request) {
            return response()->json(['created' => true], 201);
        };

        $request = Request::create('/api/v2/listings', 'POST');
        $response = $this->middleware->handle($request, $next);

        $this->assertEquals(201, $response->getStatusCode());
        // Security headers still added
        $this->assertEquals('nosniff', $response->headers->get('X-Content-Type-Options'));
    }

    public function test_handle_preserves_original_response_body(): void
    {
        $next = function ($request) {
            return response()->json(['data' => 'test_value'], 200);
        };

        $request = Request::create('/api/v2/feed', 'GET');
        $response = $this->middleware->handle($request, $next);

        $data = $response->getData(true);
        $this->assertEquals('test_value', $data['data']);
    }
}
