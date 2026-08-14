<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Providers;

use App\Core\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

/**
 * RouteServiceProvider
 *
 * API routes ARE registered under a global `/api` prefix — see the
 * `->prefix('api')` on the routes/api.php group below. Apache rewrites
 * `/api/*` to index.php while keeping the prefix in REQUEST_URI, so Laravel has
 * to match it.
 *
 * The paths written inside routes/api.php therefore omit `/api` and, in most
 * cases, spell `/v2/...` out per route rather than inheriting it from a group
 * prefix — which is why a handful of live routes sit directly under `/api/...`
 * with no version segment (`POST /api/auth/login`, routes/api.php:3040, is the
 * one most often mis-documented). Read the route line before writing a URL down.
 *
 * This docblock previously claimed "there is NO /api prefix", left over from the
 * pre-Laravel router. It was corrected on 2026-07-30 after the same wrong URL
 * had propagated into docs/API.md and docs/SLO.md.
 */
class RouteServiceProvider extends ServiceProvider
{
    /**
     * The path to your application's "home" route.
     *
     * Typically used by authentication, but NEXUS is API-only.
     */
    public const HOME = '/';

    /**
     * Legacy numeric route policies expressed as explicit named limiters.
     *
     * Every declaration using one of these names receives an endpoint-specific
     * tenant/actor bucket plus a broader IP envelope. This preserves the
     * existing ceilings without Laravel's numeric-throttle behaviour, where
     * unrelated routes for the same authenticated user share one cache key.
     *
     * This is a catalogue of available tiers, NOT a list of tiers in use — as of
     * 2026-08-10 'nexus-route-1-per-1m' has no `throttle:` reference anywhere.
     * Unused tiers are retained deliberately: they make no claim about which
     * endpoints are protected, and removing one would make a route that later
     * names it throw at request time.
     *
     * @var array<string, array{attempts: int, minutes: int}>
     */
    private const ROUTE_RATE_POLICIES = [
        'nexus-route-1-per-1m' => ['attempts' => 1, 'minutes' => 1],
        'nexus-route-2-per-1m' => ['attempts' => 2, 'minutes' => 1],
        'nexus-route-3-per-60m' => ['attempts' => 3, 'minutes' => 60],
        'nexus-route-5-per-1m' => ['attempts' => 5, 'minutes' => 1],
        'nexus-route-5-per-5m' => ['attempts' => 5, 'minutes' => 5],
        'nexus-route-5-per-60m' => ['attempts' => 5, 'minutes' => 60],
        'nexus-route-10-per-1m' => ['attempts' => 10, 'minutes' => 1],
        'nexus-route-15-per-1m' => ['attempts' => 15, 'minutes' => 1],
        'nexus-route-20-per-1m' => ['attempts' => 20, 'minutes' => 1],
        'nexus-route-30-per-1m' => ['attempts' => 30, 'minutes' => 1],
        'nexus-route-40-per-1m' => ['attempts' => 40, 'minutes' => 1],
        'nexus-route-60-per-1m' => ['attempts' => 60, 'minutes' => 1],
        'nexus-route-120-per-1m' => ['attempts' => 120, 'minutes' => 1],
        'nexus-route-200-per-1m' => ['attempts' => 200, 'minutes' => 1],
        'nexus-route-300-per-1m' => ['attempts' => 300, 'minutes' => 1],
    ];

    /**
     * Define your route model bindings, pattern filters, and other route configuration.
     */
    public function boot(): void
    {
        // 🔴 REMOVED 2026-08-14: this registered a view namespace
        // `accessible-frontend` pointing at `accessible-frontend/views`, the Blade
        // accessible frontend's template root. Both the directory and its only
        // remaining consumer (App\Support\AccessibleErrorPage) are gone.
        //
        // Worth knowing why it did not fail loudly on its own: addNamespace() never
        // stats the path, so boot succeeded and the namespace simply resolved to
        // nothing. It was the enabler for a 500 raised inside the exception
        // handler, not the thing that raised it.

        RateLimiter::for('api', function (Request $request) {
            $tenant = (string) ($request->header('X-Tenant-ID') ?: $request->header('X-Tenant-Slug') ?: 'unresolved');
            $identity = $request->user()?->id;
            if (! $identity && $request->bearerToken()) {
                $identity = 'token:' . hash('sha256', $request->bearerToken());
            }
            $key = $tenant . '|' . ($identity ?: 'ip:' . $request->ip());

            return [
                Limit::perMinute(300)->by('minute|' . $key),
                Limit::perMinutes(10, 2000)->by('sustained|' . $key),
            ];
        });

        // NOTE (2026-08-10): there is deliberately no 'auth' or 'uploads' named
        // limiter here. Both existed but no route ever referenced either name in
        // a throttle declaration, so they protected nothing while reading as
        // though login and uploads each had their own ceiling. Do not
        // reintroduce either without also attaching it to a route.
        // (Names are spelled without the throttle prefix on purpose — a test
        // scans this tree for throttle references and requires each to resolve.)
        //
        // Login protection is two real layers, neither of which is a named
        // Laravel limiter:
        //   1. App\Core\RateLimiter — DB-backed per-email + per-IP brute-force
        //      lockout on FAILED attempts, keyed off App\Core\ClientIp::get()
        //      (see AuthController::login). ClientIp::get() reads the
        //      CF-Connecting-IP / forwarded chain; $request->ip() does NOT,
        //      because this app has no TrustProxies configuration.
        //   2. throttle:nexus-route-30-per-1m on the route group in
        //      routes/api.php — general request-rate/DoS ceiling.
        //
        // Unrelated to the above: 'auth' is also a middleware ALIAS in
        // bootstrap/app.php (App\Http\Middleware\Authenticate). That alias is
        // live and has nothing to do with rate limiting.
        //
        // Upload endpoints use the nexus-route-* policies below (and
        // 'groups-upload' for group media).

        foreach (self::ROUTE_RATE_POLICIES as $name => $policy) {
            RateLimiter::for(
                $name,
                static fn (Request $request): array => self::routeRateLimits(
                    $request,
                    $policy['attempts'],
                    $policy['minutes'],
                ),
            );
        }

        // Event People bulk mutations must not share Laravel's default numeric
        // throttle bucket with unrelated API routes. Keep the existing allowance,
        // but isolate it per tenant and authenticated actor.
        RateLimiter::for('events-people-bulk', static function (Request $request): Limit {
            $tenantId = (int) TenantContext::getId();
            $userId = $request->user()?->getAuthIdentifier();
            $actor = $userId !== null ? 'user:' . $userId : 'ip:' . $request->ip();

            return Limit::perMinute(30)->by(
                "events:people-bulk:tenant:{$tenantId}:{$actor}"
            );
        });

        // Bulk data export / import — 1 per minute keyed by authenticated user
        // (falls back to IP for unauthenticated, but all current callers are
        // behind auth:sanctum). This replaces the old per-IP numeric throttle that
        // allowed multiple admins behind a shared NAT to starve each other.
        RateLimiter::for('bulk-export', function (Request $request) {
            return Limit::perMinute(1)->by(
                $request->user()?->id ? 'user:' . $request->user()->id : 'ip:' . $request->ip()
            );
        });

        RateLimiter::for('groups-join', static fn (Request $request): array => [
            Limit::perMinute(30)->by(self::groupsRateKey($request, 'join')),
            Limit::perMinute(120)->by(self::groupsActorRateKey($request, 'join')),
        ]);
        RateLimiter::for('groups-invite-read', static fn (Request $request): array => [
            Limit::perMinute(60)->by(self::groupsRateKey($request, 'invite-read')),
            Limit::perMinute(180)->by(self::groupsActorRateKey($request, 'invite-read')),
        ]);
        RateLimiter::for('groups-invite-write', static fn (Request $request): array => [
            Limit::perHour(10)->by(self::groupsRateKey($request, 'invite-write')),
            Limit::perHour(30)->by(self::groupsActorRateKey($request, 'invite-write')),
        ]);
        RateLimiter::for('groups-vote', static fn (Request $request): array => [
            Limit::perMinute(60)->by(self::groupsRateKey($request, 'vote')),
            Limit::perMinute(180)->by(self::groupsActorRateKey($request, 'vote')),
        ]);
        RateLimiter::for('groups-chat-write', static fn (Request $request): array => [
            Limit::perMinute(30)->by(self::groupsRateKey($request, 'chat-write')),
            Limit::perMinute(90)->by(self::groupsActorRateKey($request, 'chat-write')),
        ]);
        RateLimiter::for('groups-upload', static fn (Request $request): array => [
            Limit::perMinute(10)->by(self::groupsRateKey($request, 'upload')),
            Limit::perMinute(30)->by(self::groupsActorRateKey($request, 'upload')),
        ]);
        RateLimiter::for('groups-analytics-read', static fn (Request $request): array => [
            Limit::perMinute(60)->by(self::groupsRateKey($request, 'analytics-read')),
            Limit::perMinute(180)->by(self::groupsActorRateKey($request, 'analytics-read')),
        ]);
        RateLimiter::for('groups-analytics-export', static fn (Request $request): array => [
            Limit::perMinute(5)->by(self::groupsRateKey($request, 'analytics-export')),
            Limit::perMinute(15)->by(self::groupsActorRateKey($request, 'analytics-export')),
        ]);
        RateLimiter::for('groups-export-write', static fn (Request $request): array => [
            Limit::perMinute(5)->by(self::groupsRateKey($request, 'export-write')),
            Limit::perMinute(15)->by(self::groupsActorRateKey($request, 'export-write')),
        ]);
        RateLimiter::for('groups-export-read', static fn (Request $request): array => [
            Limit::perMinute(60)->by(self::groupsRateKey($request, 'export-read')),
            Limit::perMinute(180)->by(self::groupsActorRateKey($request, 'export-read')),
        ]);

        // Podcast audio streaming — generous because seeking fires bursts of
        // HTTP Range requests (each is a fresh request), but bounded so a
        // single client cannot use the media proxy for bandwidth DoS.
        RateLimiter::for('podcast-media', function (Request $request) {
            return Limit::perMinute(180)->by(
                $request->user()?->id ? 'user:' . $request->user()->id : 'ip:' . $request->ip()
            );
        });

        $this->routes(function () {
            // API routes — prefixed with /api (Apache rewrites /api/* → index.php,
            // so REQUEST_URI keeps the /api prefix that Laravel must match)
            Route::middleware('api')
                ->prefix('api')
                ->group(base_path('routes/api.php'));

            // 🔴 The Blade accessible frontend route group was REMOVED on 2026-08-14.
            //
            // It served `/{tenantSlug}/accessible/...` from routes/govuk-alpha.php through
            // App\Http\Controllers\GovukAlpha. Every member-facing accessible surface now
            // runs on `web-uk` (the Express/Nunjucks app): the platform host
            // accessible.project-nexus.ie and both community hosts
            // (accessible-uk.timebank.global, accessible-minehead-and-coast.timebank.global)
            // were verified serving web-uk before this was deleted.
            //
            // Removed with it: StripTenantSlugOnAccessibleDomain and AlphaSetLocale, whose
            // only callers were this group.
            //
            // 🔴 `lang/*/govuk_alpha*.php` is DELIBERATELY KEPT. web-uk's translation
            // catalogues for all eleven languages are GENERATED from those files
            // (web-uk/scripts/audit-laravel-locales.js), and three non-Blade classes still
            // read that namespace — EventsController, MemberDataExportService and
            // StaticPublicPageContentService. Deleting them would strip the new
            // frontend's translations.
            //
            // (This said FOUR classes and named AccessibleErrorPage as one of them.
            // That class was itself deleted later the same day, once it was found to
            // be rendering a view namespace that no longer resolved.)

            // HTTP cron endpoint REMOVED (2026-04-02) — email bombing root cause.
            // The /cron/run-all route allowed a second execution path (curl-based cron)
            // that bypassed withoutOverlapping() and caused duplicate newsletter sends.
            // The ONLY cron trigger is now: docker exec nexus-php-app artisan schedule:run
            // (root crontab on the host, every minute).

            // Sitemap endpoints — no /api prefix (crawlers access these directly)
            // Compatibility for newsletter links generated without the /api
            // prefix. Already-sent emails must keep resolving.
            Route::middleware('api')->group(function () {
                Route::get('/v2/newsletter/unsubscribe', [\App\Http\Controllers\Api\NewsletterController::class, 'unsubscribe'])
                    ->middleware('throttle:nexus-route-30-per-1m');
                Route::post('/v2/newsletter/unsubscribe', [\App\Http\Controllers\Api\NewsletterController::class, 'unsubscribe'])
                    ->middleware('throttle:nexus-route-30-per-1m');
                Route::get('/v2/newsletter/pixel/{token}', [\App\Http\Controllers\Api\NewsletterController::class, 'trackOpen']);
                Route::get('/v2/newsletter/click/{token}', [\App\Http\Controllers\Api\NewsletterController::class, 'trackClick'])
                    ->middleware('throttle:nexus-route-120-per-1m');
            });

            Route::get('/sitemap.xml', [\App\Http\Controllers\SitemapController::class, 'index']);
            Route::get('/sitemap-{slug}.xml', [\App\Http\Controllers\SitemapController::class, 'tenant'])
                ->where('slug', '[a-zA-Z0-9_-]+');

            // AI-readable site summaries (https://llmstxt.org/).
            // Each tenant domain gets its own llms.txt and llms-full.txt.
            Route::get('/llms.txt', [\App\Http\Controllers\LlmsController::class, 'index']);
            Route::get('/llms-full.txt', [\App\Http\Controllers\LlmsController::class, 'full']);

            // Channel authorization routes for broadcasting
            if (file_exists(base_path('routes/channels.php'))) {
                require base_path('routes/channels.php');
            }
        });
    }

    private static function groupsRateKey(Request $request, string $family): string
    {
        $groupId = $request->route('id') ?? $request->route('groupId');
        $token = $request->route('token');
        $scope = is_scalar($groupId) && (string) $groupId !== ''
            ? 'group:' . (string) $groupId
            : (is_scalar($token) && (string) $token !== ''
                ? 'token:' . hash('sha256', (string) $token)
                : 'route:' . hash('sha256', $request->path()));

        return self::groupsActorRateKey($request, $family) . ":{$scope}";
    }

    private static function groupsActorRateKey(Request $request, string $family): string
    {
        $tenantId = (int) TenantContext::getId();
        $userId = $request->user()?->getAuthIdentifier();
        $actor = $userId !== null ? 'user:' . $userId : 'ip:' . $request->ip();

        return "groups:{$family}:tenant:{$tenantId}:{$actor}:all";
    }

    /** @return array{0: Limit, 1: Limit} */
    private static function routeRateLimits(Request $request, int $attempts, int $minutes): array
    {
        $tenantId = (int) (TenantContext::currentId() ?? 0);
        $userId = $request->user()?->getAuthIdentifier();
        $ip = (string) $request->ip();
        $actor = $userId !== null ? 'user:' . $userId : 'ip:' . $ip;

        $route = $request->route();
        $routeName = is_object($route) && method_exists($route, 'getName')
            ? $route->getName()
            : null;
        $routeUri = is_object($route) && method_exists($route, 'uri')
            ? $route->uri()
            : $request->path();
        $routeIdentity = hash('sha256', $request->method() . ':' . ($routeName ?: $routeUri));

        return [
            Limit::perMinutes($minutes, $attempts)->by(
                "nexus-route:tenant:{$tenantId}:{$actor}:route:{$routeIdentity}"
            ),
            // Preserve a broad abuse ceiling for this policy tier after
            // isolating endpoint buckets. It is intentionally IP-wide so
            // tenant/domain hopping cannot multiply that tier's allowance.
            Limit::perMinute(600)->by('nexus-route:ip:' . $ip . ':all'),
        ];
    }
}
