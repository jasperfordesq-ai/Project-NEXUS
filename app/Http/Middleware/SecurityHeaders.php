<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    /** @var list<string> */
    private const PRIVACY_PRESERVING_REFERRER_POLICIES = [
        'no-referrer',
        'same-origin',
        'strict-origin',
        'strict-origin-when-cross-origin',
    ];

    /**
     * Cached build commit, resolved once per worker boot. Reading the file on
     * every request would be wasteful; OPCache + this static keep it free.
     */
    private static ?string $cachedBuildCommit = null;

    /**
     * Resolve the current server build commit from httpdocs/.build-version
     * (written by bluegreen-deploy.sh) or fall back to git HEAD in dev. Empty
     * string means "unknown" — header is then omitted so old clients don't
     * see a phantom mismatch.
     */
    // Public because Sentry initialisation (AppServiceProvider::initializeSentry)
    // reports the SAME commit as this header — one derivation, so an error's
    // release in Sentry always matches the X-Build header of the deploy that
    // produced it.
    public static function buildCommit(): string
    {
        if (self::$cachedBuildCommit !== null) {
            return self::$cachedBuildCommit;
        }

        $commit = '';
        $versionFile = base_path('httpdocs/.build-version');
        if (is_file($versionFile)) {
            $raw = @file_get_contents($versionFile);
            if (is_string($raw) && $raw !== '') {
                $data = json_decode($raw, true);
                if (is_array($data) && !empty($data['commit'])) {
                    $commit = (string) $data['commit'];
                } else {
                    // Some deploy scripts write a raw SHA instead of JSON.
                    $commit = trim($raw);
                }
            }
        }
        if ($commit === '' && env('BUILD_COMMIT')) {
            $commit = (string) env('BUILD_COMMIT');
        }
        if ($commit === '' && is_dir(base_path('.git'))) {
            $head = @shell_exec('cd ' . escapeshellarg(base_path()) . ' && git rev-parse HEAD 2>/dev/null');
            if (is_string($head)) {
                $commit = trim($head);
            }
        }

        // Normalise to the same 12-char short form the frontend embeds.
        if ($commit !== '' && strlen($commit) > 12) {
            $commit = substr($commit, 0, 12);
        }

        self::$cachedBuildCommit = $commit;
        return self::$cachedBuildCommit;
    }

    public function handle(Request $request, Closure $next): Response
    {
        // Telemetry: log array-shaped query params (?email[]=x, ?cursor[]=…).
        // These are the fingerprint of the type-juggling bot that hit /admin/alpha/*
        // on 2026-05-14 (see V1 commit 07005a057 + Sentry NEXUS-PHP-G..Q). The
        // hardening already coerces these to '' so they're harmless to the app,
        // but logging them gives us intent telemetry without depending on Sentry
        // catching a crash. info-level only — do not page on it.
        $arrayParams = [];
        foreach ($request->query->all() as $k => $v) {
            if (is_array($v)) {
                $arrayParams[] = $k;
            }
        }
        if ($arrayParams !== []) {
            \Illuminate\Support\Facades\Log::info('security.array_query_params', [
                'path' => $request->path(),
                'method' => $request->method(),
                'ip' => $request->ip(),
                'ua' => substr((string) $request->userAgent(), 0, 200),
                'params' => $arrayParams,
            ]);
        }

        // Generate a per-request nonce for CSP script-src. Blade templates can
        // read this via $request->attributes->get('csp_nonce') or the shared
        // 'cspNonce' view variable and emit <script nonce="{{ $cspNonce }}">.
        $nonce = bin2hex(random_bytes(16));
        $request->attributes->set('csp_nonce', $nonce);
        if (function_exists('view')) {
            try {
                view()->share('cspNonce', $nonce);
            } catch (\Throwable $e) {
                // View factory not bootable in this context — ignore.
            }
        }

        $response = $next($request);

        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-XSS-Protection', '1; mode=block');

        // CSP notes:
        // - script-src: 'unsafe-inline' removed; per-request nonce required for
        //   any inline <script> blocks. Scheme-wide https: is deliberately not
        //   allowed for executable or connection sources.
        // - style-src: 'unsafe-inline' retained because HeroUI / Tailwind /
        //   Framer Motion inject runtime inline style attributes (e.g. style="...")
        //   and removing it would break the UI. Narrowed from "https:" wildcard
        //   to 'self' + explicit https: origins only.
        //   TODO: migrate to nonce/hash-based style-src once HeroUI exposes a
        //   nonce prop and inline style attributes are eliminated.
        $csp = "default-src 'self'; "
            . "script-src 'self' 'nonce-{$nonce}' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com https://challenges.cloudflare.com; "
            . "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            . "connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://challenges.cloudflare.com https://api.pwnedpasswords.com; "
            . "img-src 'self' https: data: blob:; "
            . "font-src 'self' https://fonts.gstatic.com data:; "
            . "frame-src 'self' https://*.google.com https://challenges.cloudflare.com https://www.openstreetmap.org; "
            . "media-src 'self' https: blob:; "
            . "worker-src 'self' blob:; "
            . "frame-ancestors 'self'; "
            . "form-action 'self'; "
            . "base-uri 'self'; "
            . "object-src 'none'; "
            . "report-uri /api/csp-report; "
            . "report-to nexus-csp;";
        $response->headers->set('Content-Security-Policy', $csp);
        $response->headers->set('Reporting-Endpoints', 'nexus-csp="/api/csp-report"');
        // Keep an endpoint's equally strict or stricter policy (for example,
        // one-time calendar feed secrets), while replacing unknown or weaker
        // policies with the platform default.
        $endpointPolicies = array_values(array_filter(array_map(
            static fn (string $policy): string => strtolower(trim($policy)),
            explode(',', (string) $response->headers->get('Referrer-Policy', '')),
        )));
        $hasSafeEndpointPolicy = $endpointPolicies !== []
            && array_diff($endpointPolicies, self::PRIVACY_PRESERVING_REFERRER_POLICIES) === [];
        if (! $hasSafeEndpointPolicy) {
            $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        }

        // Self-only grants: camera (story creator), microphone (voice
        // messages), geolocation (maps); everything else denied to
        // embedded third-party content.
        $response->headers->set(
            'Permissions-Policy',
            'camera=(self), microphone=(self), geolocation=(self), fullscreen=(self), payment=(), usb=(), browsing-topics=()'
        );

        if ($request->secure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }

        // X-Build: stamps every API response with the server's deployed commit
        // so the frontend's stale-client gate (api.ts checkStaleBuild) can
        // detect users running older code than the server is serving. Also
        // exposed via CORS Access-Control-Expose-Headers in EnsureCorsHeaders.
        $build = self::buildCommit();
        if ($build !== '') {
            $response->headers->set('X-Build', $build);
        }

        return $response;
    }
}
