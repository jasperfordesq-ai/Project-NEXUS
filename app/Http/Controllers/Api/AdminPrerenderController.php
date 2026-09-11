<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Support\CsvExportSanitizer;
use App\Services\PrerenderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;

/**
 * AdminPrerenderController — admin endpoints for the prerender engine.
 *
 * Read endpoints accept any admin. Mutating endpoints (enqueue, purge,
 * cancel, invalidate, auto-recache, detect-drift, purge-unexpected) require
 * a PLATFORM super-admin — the engine operates cross-tenant (a job can
 * target any tenant slug), so a tenant-scoped super-admin must not be able
 * to enqueue work against other tenants' snapshots.
 */
class AdminPrerenderController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly PrerenderService $service) {}

    /** GET /api/v2/admin/prerender/summary */
    public function summary(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        return $this->respondWithData($this->service->summary());
    }

    /**
     * GET /api/v2/admin/prerender/inventory?tenant=slug
     *
     * Returns every rendered HTML file in the cache with staleness flags.
     * Optional ?tenant=slug filters to a single host.
     */
    public function inventory(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $tenantSlug = $r->query('tenant');
        if (is_string($tenantSlug)) {
            $tenantSlug = trim($tenantSlug);
            if (!preg_match('/^[A-Za-z0-9_-]{0,64}$/', $tenantSlug)) {
                return $this->error('Invalid tenant slug', 400, 'VALIDATION_INVALID');
            }
        } else {
            $tenantSlug = null;
        }
        $items = $this->service->inventory($tenantSlug);
        $truncated = false;
        $items = array_values(array_filter($items, function (array $item) use (&$truncated): bool {
            if (!empty($item['__truncated'])) {
                $truncated = true;
                return false;
            }
            return true;
        }));

        return $this->respondWithData([
            'cache_readable' => $this->service->cacheReadable(),
            'cache_path'     => $this->service->cachePath(),
            'items'          => $items,
            'truncated'      => $truncated,
            'hard_cap'       => PrerenderService::INVENTORY_HARD_CAP,
        ]);
    }

    /**
     * GET /api/v2/admin/prerender/inspect?path=host/route/index.html
     *
     * Deep-parse a single snapshot — used by the inventory drawer.
     */
    public function inspect(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $path = (string) $r->query('path', '');
        if ($path === '') {
            return $this->error('Missing path', 400, 'VALIDATION_REQUIRED_FIELD');
        }
        $data = $this->service->inspect($path);
        if ($data === null) {
            return $this->error('Snapshot not found', 404, 'NOT_FOUND');
        }
        return $this->respondWithData($data);
    }

    /** GET /api/v2/admin/prerender/coverage */
    public function coverage(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        return $this->respondWithData([
            'expected_routes' => PrerenderService::EXPECTED_ROUTES,
            'rows'            => $this->service->coverage(),
        ]);
    }

    /** GET /api/v2/admin/prerender/tenant-safety?tenant=slug */
    public function tenantSafety(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $slug = (string) $r->query('tenant', '');
        if ($slug === '' || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $slug)) {
            return $this->error('Valid tenant slug required', 400, 'VALIDATION_INVALID');
        }
        $target = collect($this->service->loadTenantTargets())->firstWhere('slug', $slug);
        if (!is_array($target)) return $this->error(__('api.tenant_not_found'), 404, 'NOT_FOUND');

        $staticRoutes = $this->service->routesForTenant((object) $target);
        try {
            $plannedRoutes = $this->service->expectedRoutesForTenant($target, PrerenderService::MAX_PLANNED_ROUTES_PER_TENANT, true);
        } catch (\Throwable $e) {
            report($e);
            return $this->error(__('api.prerender_plan_unavailable'), 503, 'PRERENDER_PLAN_UNAVAILABLE');
        }
        $dynamicRoutes = array_values(array_filter(
            $plannedRoutes,
            fn ($route) => is_string($route) && $route !== '' && $route[0] === '/' && !in_array($route, $staticRoutes, true)
        ));

        $report = $this->service->tenantSafetyReport($slug, array_merge($staticRoutes, $dynamicRoutes));
        if ($report === null) return $this->error('Tenant not found', 404, 'NOT_FOUND');

        return $this->respondWithData($report);
    }

    /** GET /api/v2/admin/prerender/events?limit=200 */
    public function events(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $limit = (int) $r->query('limit', 200);
        return $this->respondWithData([
            'events' => $this->service->tailEvents($limit),
        ]);
    }

    /** GET /api/v2/admin/prerender/failures */
    public function failures(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        return $this->respondWithData([
            'items' => $this->service->readFailures(),
        ]);
    }

    /** GET /api/v2/admin/prerender/jobs?status=&limit= */
    public function jobs(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $status = $r->query('status');
        $limit = (int) $r->query('limit', 50);
        return $this->respondWithData([
            'items' => $this->service->listJobs($limit, is_string($status) ? $status : null),
        ]);
    }

    /** GET /api/v2/admin/prerender/jobs/{id} */
    public function showJob(int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $row = $this->service->getJob($id);
        if (!$row) return $this->error('Job not found', 404, 'NOT_FOUND');
        return $this->respondWithData($row);
    }

    /**
     * POST /api/v2/admin/prerender/jobs
     *
     * Body:
     *   tenant_slug?: string  — limit to a single tenant
     *   routes?:      string  — comma-separated, e.g. "/about,/blog"
     *   force?:       bool    — render even if up-to-date
     *   dry_run?:     bool    — plan only, no Playwright run
     *
     * Requires super_admin because force-refreshes affect every tenant's
     * snapshot and can take many minutes of host CPU.
     */
    public function enqueue(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'enqueue', 30, 60)) {
            return $this->error('Too many enqueue requests — slow down', 429, 'RATE_LIMITED');
        }

        $payload = $r->json()->all();
        $tenantSlug = $payload['tenant_slug'] ?? null;
        $routes = $payload['routes'] ?? null;
        $force = (bool) ($payload['force'] ?? false);
        $dryRun = (bool) ($payload['dry_run'] ?? false);
        $priority = isset($payload['priority']) ? max(1, min(9, (int) $payload['priority'])) : PrerenderService::PRIORITY_NORMAL;

        $tenantId = null;
        if (is_string($tenantSlug) && $tenantSlug !== '') {
            if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $tenantSlug)) {
                return $this->error('Invalid tenant slug', 400, 'VALIDATION_INVALID');
            }
            $row = \DB::table('tenants')
                ->where('slug', $tenantSlug)
                ->where('is_active', 1)
                ->first();
            if (!$row) return $this->error('Tenant not found', 404, 'NOT_FOUND');
            $tenantId = (int) $row->id;
        }

        $routesValue = null;
        if (is_string($routes) && trim($routes) !== '') {
            $tokens = array_filter(array_map('trim', explode(',', $routes)));
            foreach ($tokens as $tok) {
                if (!preg_match('#^/[A-Za-z0-9._~/%:@!$()*+,;=\-]*$#', $tok)) {
                    return $this->error(
                        "Invalid route: $tok",
                        400,
                        'VALIDATION_INVALID'
                    );
                }
                if (
                    $tenantId === null
                    && (
                        PrerenderService::routeRequiresTenantScope($tok)
                        || !PrerenderService::routeCanBeGlobalExplicit($tok)
                    )
                ) {
                    return $this->error(
                        "Route requires tenant_slug: $tok",
                        400,
                        'VALIDATION_INVALID'
                    );
                }
            }
            $routesValue = implode(',', $tokens);
        }

        $jobId = $this->service->enqueueJob(
            $tenantId,
            $routesValue,
            $force,
            $dryRun,
            $userId,
            $priority
        );

        $this->service->audit(
            'enqueue', $userId, $tenantId, $jobId, 'ok',
            ['routes' => $routesValue, 'force' => $force, 'dry_run' => $dryRun, 'priority' => $priority],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );

        return $this->respondWithData([
            'job_id' => $jobId,
            'job'    => $this->service->getJob($jobId),
        ]);
    }

    /**
     * POST /api/v2/admin/prerender/purge
     *
     * Body:
     *   pattern:      string  — required, glob like "/blog/*" or "/listings/**"
     *   tenant_slug?: string  — limit to a single tenant
     *   dry_run?:     bool    — return matches without deleting
     *   recache?:     bool    — also enqueue a low-priority recache job
     *   confirm_all_tenants?: bool — required for a real purge without tenant_slug
     *
     * Requires super_admin: a poorly-chosen pattern can blow away the whole
     * cache, which is fine operationally (snapshots regenerate) but expensive.
     */
    public function purge(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'purge', 10, 60)) {
            return $this->error('Too many purge requests', 429, 'RATE_LIMITED');
        }

        $payload = $r->json()->all();
        $pattern = trim((string) ($payload['pattern'] ?? ''));
        if ($pattern === '' || $pattern[0] !== '/') {
            return $this->error('Pattern must start with "/"', 400, 'VALIDATION_INVALID');
        }
        if (!preg_match('#^/[A-Za-z0-9._~/%:@!$()+,;=\-\*\?]*$#', $pattern)) {
            return $this->error('Invalid pattern characters', 400, 'VALIDATION_INVALID');
        }

        $tenantSlug = $payload['tenant_slug'] ?? null;
        $tenantId = null;
        if (is_string($tenantSlug) && $tenantSlug !== '') {
            if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $tenantSlug)) {
                return $this->error('Invalid tenant slug', 400, 'VALIDATION_INVALID');
            }
            $row = \DB::table('tenants')->where('slug', $tenantSlug)->where('is_active', 1)->first();
            if (!$row) return $this->error('Tenant not found', 404, 'NOT_FOUND');
            $tenantId = (int) $row->id;
        }

        foreach (['dry_run', 'recache', 'confirm_all_tenants'] as $booleanField) {
            if (array_key_exists($booleanField, $payload) && !is_bool($payload[$booleanField])) {
                return $this->error(__('api.prerender_boolean_required', ['field' => $booleanField]), 422, 'VALIDATION_INVALID');
            }
        }
        $dryRun = $payload['dry_run'] ?? false;
        $recache = $payload['recache'] ?? false;
        $confirmAllTenants = $payload['confirm_all_tenants'] ?? false;
        if (!$dryRun && $tenantId === null && !$confirmAllTenants) {
            return $this->error(
                'confirm_all_tenants is required when deleting snapshots across all tenants',
                400,
                'VALIDATION_REQUIRED_FIELD'
            );
        }

        $previewToken = $payload['preview_token'] ?? null;
        if (!$dryRun && (!is_string($previewToken) || !preg_match('/^[a-f0-9]{48}$/', $previewToken))) {
            return $this->error(__('api.prerender_preview_required'), 409, 'PRERENDER_PREVIEW_REQUIRED');
        }

        $preview = null;
        $previewFingerprints = [];
        try {
            if (!$dryRun) {
                $preview = Cache::pull('prerender:purge-preview:' . $previewToken);
                if (!is_array($preview)
                    || (int) ($preview['user_id'] ?? 0) !== $userId
                    || (string) ($preview['pattern'] ?? '') !== $pattern
                    || (string) ($preview['tenant_slug'] ?? '') !== (string) ($tenantSlug ?? '')) {
                    return $this->error(__('api.prerender_preview_mismatch'), 409, 'PRERENDER_PREVIEW_REQUIRED');
                }

                $current = $this->service->purgePattern(
                    $pattern,
                    is_string($tenantSlug) && $tenantSlug !== '' ? $tenantSlug : null,
                    true
                );
                if (!hash_equals((string) ($preview['hash'] ?? ''), $this->previewHash($current['deleted'] ?? []))) {
                    return $this->error(__('api.prerender_preview_stale'), 409, 'PRERENDER_PREVIEW_STALE');
                }
            }

            if ($dryRun) {
                $result = $this->service->purgePattern(
                    $pattern,
                    is_string($tenantSlug) && $tenantSlug !== '' ? $tenantSlug : null,
                    true
                );
                $previewFingerprints = $this->service->fingerprintCachePaths(
                    array_values($result['deleted'] ?? [])
                );
            } else {
                $authoritativeJobId = null;
                $deleted = $this->service->purgeExactCachePaths(
                    is_array($preview['paths'] ?? null) ? $preview['paths'] : [],
                    is_array($preview['fingerprints'] ?? null) ? $preview['fingerprints'] : [],
                    $authoritativeJobId
                );
                $result = [
                    'deleted' => $deleted,
                    'dry_run' => false,
                    'pattern' => $pattern,
                    'tenant_slug' => $tenantSlug,
                    'authoritative_job_id' => $authoritativeJobId,
                ];
            }
        } catch (\UnexpectedValueException $e) {
            $this->service->audit(
                'purge', $userId, $tenantId, null, 'rejected',
                ['pattern' => $pattern, 'dry_run' => $dryRun, 'reason' => 'preview_stale'],
                $r->ip(), substr((string) $r->userAgent(), 0, 255)
            );
            return $this->error(__('api.prerender_preview_stale'), 409, 'PRERENDER_PREVIEW_STALE');
        } catch (\Throwable $e) {
            report($e);
            $this->service->audit(
                'purge', $userId, $tenantId, null, 'error',
                ['pattern' => $pattern, 'dry_run' => $dryRun, 'error' => substr($e->getMessage(), 0, 1000)],
                $r->ip(), substr((string) $r->userAgent(), 0, 255)
            );
            return $this->error(__('api.prerender_purge_failed'), 503, 'PRERENDER_PURGE_FAILED');
        }

        $issuedPreviewToken = null;
        if ($dryRun) {
            $issuedPreviewToken = bin2hex(random_bytes(24));
            $previewPaths = array_values($result['deleted'] ?? []);
            Cache::put('prerender:purge-preview:' . $issuedPreviewToken, [
                'user_id' => $userId,
                'pattern' => $pattern,
                'tenant_slug' => (string) ($tenantSlug ?? ''),
                'hash' => $this->previewHash($previewPaths),
                'paths' => $previewPaths,
                'fingerprints' => $previewFingerprints,
            ], 600);
        }

        $jobId = isset($result['authoritative_job_id'])
            ? (int) $result['authoritative_job_id']
            : null;
        if ($recache && !$dryRun && !empty($result['deleted']) && $jobId === null) {
            // Enqueue a low-priority recache. We can't pass a glob to
            // prerender-tenants.sh; the worker discovers missing snapshots
            // on the next pass, so a force-render of the same tenant scope
            // is the broadest sensible action.
            $jobId = $this->service->enqueueJob(
                $tenantId,
                null,
                false,
                false,
                $userId,
                PrerenderService::PRIORITY_LOW
            );
        }

        $this->service->audit(
            'purge', $userId, $tenantId, $jobId, 'ok',
            [
                'pattern' => $pattern,
                'dry_run' => $dryRun,
                'deleted_count' => count($result['deleted']),
                'recache' => $recache,
                'confirmed_all_tenants' => $confirmAllTenants,
            ],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );

        return $this->respondWithData([
            'pattern'      => $pattern,
            'tenant_slug'  => $tenantSlug,
            'dry_run'      => $dryRun,
            'deleted_count'=> count($result['deleted']),
            'deleted'      => array_values($result['deleted']),
            'recache_job_id' => $jobId,
            'preview_token' => $issuedPreviewToken,
            'preview_expires_in' => $issuedPreviewToken !== null ? 600 : null,
        ]);
    }

    /** POST /api/v2/admin/prerender/jobs/{id}/cancel */
    public function cancelJob(Request $r, int $id): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        $ok = $this->service->cancelJob($id);
        if (!$ok) {
            return $this->error('Job is not cancellable (already claimed or finished)', 409, 'CONFLICT');
        }
        $this->service->audit(
            'cancel', $userId, null, $id, 'ok',
            null, $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );
        return $this->respondWithData(['cancelled' => true, 'id' => $id]);
    }

    /**
     * POST /api/v2/admin/prerender/invalidate
     *
     * External-system invalidation hook. Lets a headless CMS / marketing
     * automation / ops tool flag specific routes as stale without going
     * through the model layer.
     *
     * Authentication options (in order of preference):
     *   1. Bearer token = config('prerender.webhook_token')   (preferred)
     *   2. X-Nexus-Signature: hex-HMAC-SHA256 of "<timestamp>.<raw body>" with that token,
     *      where the timestamp is the value of the X-Nexus-Timestamp header (Unix seconds).
     *      Requests with a timestamp older than ±5 minutes are rejected (replay protection).
     *   3. Admin session (platform super-admin)                 (fallback for ops UI)
     *
     * Body:
     *   tenant_id:    int       — required
     *   routes:       string[]  — required, tenant-local paths ("/blog/foo")
     *   recache:      bool      — also enqueue a NORMAL-priority recache job (default true)
     *
     * Returns: { invalidated: N, job_id: id|null }
     */
    public function invalidate(Request $r): JsonResponse
    {
        $token = (string) config('prerender.webhook_token', '');
        $authed = false;
        $actorUserId = null;
        $authMode = 'unknown';

        if ($token !== '') {
            $bearer = (string) $r->bearerToken();
            if ($bearer !== '' && hash_equals($token, $bearer)) {
                // Bearer calls are intentionally repeatable and idempotent.
                // A CMS may publish the same URL twice within five minutes;
                // body-hash replay blocking would discard the second, newer
                // invalidation. One-time replay protection remains on signed
                // timestamped HMAC requests below.
                $authed = true;
                $authMode = 'bearer';
            } else {
                $sig = (string) $r->header('X-Nexus-Signature', '');
                $tsHeader = (string) $r->header('X-Nexus-Timestamp', '');
                if ($sig !== '' && $tsHeader !== '' && ctype_digit($tsHeader)) {
                    $ts = (int) $tsHeader;
                    $skew = abs(time() - $ts);
                    if ($skew <= 300) {
                        // Signed payload is "<timestamp>.<raw body>" so a
                        // captured (timestamp, body, signature) tuple is only
                        // usable inside the 5-minute window.
                        $expected = hash_hmac('sha256', $ts . '.' . $r->getContent(), $token);
                        if (hash_equals($expected, $sig)) {
                            // One-time-use nonce: even within the 5-minute
                            // window, the same signature can't be replayed.
                            // Key TTL = 2× max skew so an attacker can't
                            // simply wait for it to expire.
                            $nonceKey = 'prerender:webhook:nonce:' . hash('sha256', $ts . ':' . $sig);
                            $fresh = Cache::add($nonceKey, 1, 600);
                            if ($fresh) {
                                $authed = true;
                                $authMode = 'hmac';
                            } else {
                                // Replay detected. Don't tell the caller why
                                // — just bounce — but audit it so we have a
                                // forensic record.
                                $this->service->audit(
                                    'invalidate', null, null, null, 'denied',
                                    ['reason' => 'webhook_replay', 'ts' => $ts],
                                    $r->ip(), substr((string) $r->userAgent(), 0, 255)
                                );
                            }
                        }
                    }
                }
            }
        }

        if (!$authed) {
            // Fall back to admin-session auth so the admin UI can call this
            // directly without needing the shared secret.
            try {
                $actorUserId = $this->requirePlatformSuperAdmin();
                $authed = true;
                $authMode = 'admin_session';
            } catch (\Throwable $e) {
                return $this->error('Unauthorized', 401, 'UNAUTHENTICATED');
            }
        }

        $payload = $r->json()->all();
        $tenantId = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : 0;
        if ($tenantId <= 0) {
            return $this->error('tenant_id is required', 400, 'VALIDATION_REQUIRED_FIELD');
        }
        $routes = $payload['routes'] ?? [];
        if (!is_array($routes) || empty($routes)) {
            return $this->error('routes[] is required and must be non-empty', 400, 'VALIDATION_REQUIRED_FIELD');
        }
        if (count($routes) > 500) {
            return $this->error(__('api.prerender_routes_limit', ['max' => 500]), 422, 'VALIDATION_INVALID');
        }
        // Canonicalise conventional trailing slashes, but reject traversal,
        // ambiguous separators, malformed escapes, and encoded dot/slash
        // aliases before any route reaches a filesystem or job payload.
        $normalisedRoutes = [];
        foreach ($routes as $r2) {
            $normalised = is_string($r2)
                ? PrerenderService::normalizeRoute($r2)
                : null;
            if ($normalised === null) {
                return $this->error("Invalid route: " . (is_string($r2) ? $r2 : '(non-string)'), 400, 'VALIDATION_INVALID');
            }
            $normalisedRoutes[] = $normalised;
        }
        $routes = array_values(array_unique($normalisedRoutes));
        if (array_key_exists('recache', $payload) && !is_bool($payload['recache'])) {
            return $this->error(__('api.prerender_boolean_required', ['field' => 'recache']), 422, 'VALIDATION_INVALID');
        }
        $recache = $payload['recache'] ?? true;

        $tenantTarget = collect($this->service->loadTenantTargets())->firstWhere('tenant_id', $tenantId);
        if (!is_array($tenantTarget)) {
            return $this->error(__('api.tenant_not_found'), 404, 'NOT_FOUND');
        }

        if ($actorUserId === null && !$this->checkExternalInvalidateRate($r, $tenantId, $authMode)) {
            return $this->error(__('api.rate_limit_exceeded'), 429, 'RATE_LIMITED');
        }

        $count = $this->service->invalidateRoutes($tenantId, $routes, $recache);
        $jobId = null;
        if ($recache) {
            // invalidateRoutes already enqueues; surface the job id by reading
            // the most recent matching queued row.
            $row = \DB::table('prerender_jobs')
                ->where('tenant_id', $tenantId)
                ->where('status', 'queued')
                ->orderByDesc('id')
                ->first();
            $jobId = $row ? (int) $row->id : null;
        }

        $this->service->audit(
            'invalidate', $actorUserId, $tenantId, $jobId, 'ok',
            ['routes' => $routes, 'invalidated' => $count, 'recache' => $recache, 'auth_mode' => $authMode],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );

        return $this->respondWithData([
            'invalidated' => $count,
            'tenant_id'   => $tenantId,
            'routes'      => $routes,
            'job_id'      => $jobId,
        ]);
    }

    /**
     * GET /api/v2/admin/prerender/analytics?since=ISO8601&limit=200
     *
     * Aggregates the bot-only JSONL access log nginx writes for every search
     * engine / social / AI crawler hit. Returns hits by status, crawler, host,
     * top URIs, and the most recent rows. Default window is 7 days.
     */
    public function analytics(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $since = $r->query('since');
        $limit = (int) $r->query('limit', 200);
        $limit = max(10, min(1000, $limit));
        return $this->respondWithData(
            $this->service->crawlerAnalytics(is_string($since) ? $since : null, $limit)
        );
    }

    /**
     * POST /api/v2/admin/prerender/auto-recache
     *
     * Trigger one immediate auto-recache pass. Same logic as the cron, but
     * exposed for manual operator control. Always dry-runs unless `apply=1`.
     */
    public function autoRecache(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'auto_recache', 5, 60)) {
            return $this->error('Too many requests', 429, 'RATE_LIMITED');
        }
        $apply = (bool) $r->json('apply', false);
        $exit = \Artisan::call('prerender:auto-recache', $apply ? [] : ['--dry-run' => true]);
        $outcome = $exit === 0 ? 'ok' : 'error';
        $this->service->audit('auto_recache', $userId, null, null, $outcome, ['applied' => $apply, 'exit_code' => $exit]);
        return $this->respondWithData([
            'exit_code' => $exit,
            'output'    => \Artisan::output(),
            'applied'   => $apply,
        ], null, $exit === 0 ? 200 : 500);
    }

    /**
     * POST /api/v2/admin/prerender/detect-drift
     *
     * Trigger an immediate sitemap-drift detection pass. Dry-run by default;
     * pass `apply: true` to actually enqueue recache jobs. Same logic as the
     * 2-minute cron, exposed for operators investigating a stale-page report.
     */
    public function detectDrift(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'detect_drift', 5, 60)) {
            return $this->error('Too many requests', 429, 'RATE_LIMITED');
        }
        $apply = (bool) $r->json('apply', false);
        $exit = \Artisan::call('prerender:detect-drift', $apply ? [] : ['--dry-run' => true]);
        $outcome = $exit === 0 ? 'ok' : 'error';
        $this->service->audit('detect_drift', $userId, null, null, $outcome, ['applied' => $apply, 'exit_code' => $exit]);
        return $this->respondWithData([
            'exit_code' => $exit,
            'output'    => \Artisan::output(),
            'applied'   => $apply,
        ], null, $exit === 0 ? 200 : 500);
    }

    /**
     * POST /api/v2/admin/prerender/purge-unexpected
     *
     * Sweep the snapshot cache for routes that aren't in any tenant's current
     * expected set (e.g. /jobs snapshots for a tenant with job_vacancies off).
     * Common after toggling a feature off, or to clean up the inventory after
     * the engine went tenant-aware (this fix's first run).
     *
     * Body:
     *   apply: bool  — false = dry run (returns what would be deleted)
     *
     * Returns: { deleted_total, by_tenant: { slug: [routes] }, dry_run }
     */
    public function purgeUnexpected(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'purge_unexpected', 5, 60)) {
            return $this->error('Too many requests', 429, 'RATE_LIMITED');
        }
        $applyInput = $r->json('apply', false);
        if (!is_bool($applyInput)) {
            return $this->error(__('api.prerender_boolean_required', ['field' => 'apply']), 422, 'VALIDATION_INVALID');
        }
        $apply = $applyInput;
        $previewToken = $r->json('preview_token');
        if ($apply && (!is_string($previewToken) || !preg_match('/^[a-f0-9]{48}$/', $previewToken))) {
            return $this->error(__('api.prerender_preview_required'), 409, 'PRERENDER_PREVIEW_REQUIRED');
        }
        $preview = null;
        $previewFingerprints = [];
        try {
            if ($apply) {
                $preview = Cache::pull('prerender:unexpected-preview:' . $previewToken);
                if (!is_array($preview) || (int) ($preview['user_id'] ?? 0) !== $userId) {
                    return $this->error(__('api.prerender_preview_mismatch'), 409, 'PRERENDER_PREVIEW_REQUIRED');
                }
                $current = $this->service->purgeUnexpectedSnapshots(true);
                if (!hash_equals(
                    (string) ($preview['hash'] ?? ''),
                    $this->previewHash($this->unexpectedPreviewPaths($current))
                )) {
                    return $this->error(__('api.prerender_preview_stale'), 409, 'PRERENDER_PREVIEW_STALE');
                }
            }
            if ($apply) {
                $authoritativeJobId = null;
                $deleted = $this->service->purgeExactCachePaths(
                    is_array($preview['paths'] ?? null) ? $preview['paths'] : [],
                    is_array($preview['fingerprints'] ?? null) ? $preview['fingerprints'] : [],
                    $authoritativeJobId
                );
                $result = [
                    'deleted_total' => count($deleted),
                    'by_tenant' => is_array($preview['by_tenant'] ?? null) ? $preview['by_tenant'] : [],
                    'cache_paths' => $deleted,
                    'dry_run' => false,
                    'authoritative_job_id' => $authoritativeJobId,
                ];
            } else {
                $result = $this->service->purgeUnexpectedSnapshots(true);
                $previewFingerprints = $this->service->fingerprintCachePaths(
                    array_values($result['cache_paths'] ?? [])
                );
            }
        } catch (\UnexpectedValueException $e) {
            $this->service->audit(
                'purge_unexpected', $userId, null, null, 'rejected',
                ['applied' => $apply, 'reason' => 'preview_stale'],
                $r->ip(), substr((string) $r->userAgent(), 0, 255)
            );
            return $this->error(__('api.prerender_preview_stale'), 409, 'PRERENDER_PREVIEW_STALE');
        } catch (\Throwable $e) {
            report($e);
            $this->service->audit(
                'purge_unexpected', $userId, null, null, 'error',
                ['applied' => $apply, 'error' => substr($e->getMessage(), 0, 1000)],
                $r->ip(), substr((string) $r->userAgent(), 0, 255)
            );
            return $this->error(__('api.prerender_unexpected_purge_failed'), 503, 'PRERENDER_PURGE_FAILED');
        }
        if (!$apply) {
            $issuedPreviewToken = bin2hex(random_bytes(24));
            $previewPaths = array_values($result['cache_paths'] ?? []);
            Cache::put('prerender:unexpected-preview:' . $issuedPreviewToken, [
                'user_id' => $userId,
                'hash' => $this->previewHash($this->unexpectedPreviewPaths($result)),
                'paths' => $previewPaths,
                'fingerprints' => $previewFingerprints,
                'by_tenant' => $result['by_tenant'] ?? [],
            ], 600);
            $result['preview_token'] = $issuedPreviewToken;
            $result['preview_expires_in'] = 600;
        } else {
            $result['preview_token'] = null;
            $result['preview_expires_in'] = null;
        }
        $this->service->audit(
            'purge_unexpected', $userId, null, null, 'ok',
            ['applied' => $apply, 'deleted_total' => $result['deleted_total'] ?? 0],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );
        unset($result['cache_paths']);
        return $this->respondWithData($result);
    }

    /**
     * GET /api/v2/admin/prerender/metrics
     *
     * Prometheus-format text. Add to your scrape config as:
     *   - job_name: nexus-prerender
     *     metrics_path: /api/v2/admin/prerender/metrics
     *     bearer_token: <admin token>
     */
    public function metrics(): \Symfony\Component\HttpFoundation\Response
    {
        $this->requirePlatformSuperAdmin();
        $body = $this->service->prometheusMetrics();
        return response($body, 200, [
            'Content-Type' => 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control' => 'no-store',
        ]);
    }

    /**
     * GET /api/v2/admin/prerender/realtime-channel
     *
     * Returns the channel + event the UI should subscribe to for live job
     * updates. Decouples the React client from the channel name.
     */
    public function realtimeChannel(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        return $this->respondWithData([
            'channel' => \App\Services\PrerenderService::REALTIME_CHANNEL,
            'event'   => \App\Services\PrerenderService::REALTIME_EVENT,
        ]);
    }

    // -------------------------------------------------------------------------
    // Round 2 — health, audit, breaker, emergency reset
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/prerender/health
     *
     * Traffic-light JSON: status (green|yellow|red) plus a list of per-check
     * details with actionable suggestions. Designed to be scraped by uptime
     * monitors or rendered in the admin UI banner.
     */
    public function health(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $data = $this->service->health();
        // HTTP 200 even on red — uptime monitors decide what to alert on by
        // reading the body's status field. A 5xx would mask the engine being
        // up but the queue being jammed.
        return $this->respondWithData($data);
    }

    /**
     * GET /api/v2/admin/prerender/audit?action=&limit=
     *
     * Recent audit log entries. Read-only for any admin.
     */
    public function auditLog(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $action = $r->query('action');
        $limit  = (int) $r->query('limit', 100);
        return $this->respondWithData([
            'items' => $this->service->recentAudit($limit, is_string($action) ? $action : null),
        ]);
    }

    /**
     * POST /api/v2/admin/prerender/reset-breaker
     *
     * Manually close the circuit breaker. The audit row records who did it
     * and when; the operator should have investigated the failure trigger
     * before resetting.
     */
    public function resetBreaker(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'reset_breaker', 5, 60)) {
            return $this->error('Too many requests', 429, 'RATE_LIMITED');
        }
        $wasTripped = $this->service->breakerTrippedUntil();
        $this->service->resetBreaker();
        $this->service->audit(
            'reset_breaker', $userId, null, null, 'ok',
            ['was_tripped_until' => $wasTripped],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );
        return $this->respondWithData(['ok' => true, 'was_tripped_until' => $wasTripped]);
    }

    /**
     * POST /api/v2/admin/prerender/reset-queue
     *
     * Emergency: requeue every claimed/running row whose worker likely died,
     * AND clear the breaker. Equivalent to running reap-stale --requeue and
     * reset-breaker in one click. Rate-limited because it's destructive
     * if used while a healthy worker is actually working.
     */
    public function resetQueue(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'reset_queue', 2, 300)) {
            return $this->error('Too many requests — wait a few minutes', 429, 'RATE_LIMITED');
        }
        if (!Schema::hasTable('prerender_jobs')) {
            return $this->error(
                'Prerender job queue table is not available. Run database migrations before repairing the queue.',
                503,
                'PRERENDER_QUEUE_UNAVAILABLE'
            );
        }

        // Anything older than 30 min in claimed/running is fair game.
        $cutoff = date('Y-m-d H:i:s', time() - 1800);
        $hasHeartbeat = Schema::hasColumn('prerender_jobs', 'heartbeat_at');
        $query = \DB::table('prerender_jobs')
            ->whereIn('status', ['claimed', 'running'])
            ->where(function ($q) use ($cutoff, $hasHeartbeat) {
                if ($hasHeartbeat) {
                    $q->whereRaw('COALESCE(heartbeat_at, started_at, claimed_at) IS NULL')
                        ->orWhereRaw('COALESCE(heartbeat_at, started_at, claimed_at) < ?', [$cutoff]);
                    return;
                }
                $q->whereNull('claimed_at')->orWhere('claimed_at', '<', $cutoff);
            });
        $updates = [
            'status'        => 'queued',
            'claimed_at'    => null,
            'claimed_by'    => null,
            'started_at'    => null,
            'error_message' => 'reset by admin via /reset-queue',
        ];
        if ($hasHeartbeat) $updates['heartbeat_at'] = null;
        $candidates = (clone $query)->get(['id', 'status', 'claimed_by']);
        $reset = 0;

        foreach ($candidates as $candidate) {
            $candidateId = (int) $candidate->id;
            $owner = (string) ($candidate->claimed_by ?? '');
            $candidateQuery = \DB::table('prerender_jobs')
                ->where('id', $candidateId)
                ->where('status', (string) $candidate->status)
                ->where(function ($q) use ($cutoff, $hasHeartbeat) {
                    if ($hasHeartbeat) {
                        $q->whereRaw('COALESCE(heartbeat_at, started_at, claimed_at) IS NULL')
                            ->orWhereRaw('COALESCE(heartbeat_at, started_at, claimed_at) < ?', [$cutoff]);
                        return;
                    }
                    $q->whereNull('claimed_at')->orWhere('claimed_at', '<', $cutoff);
                });
            if ($owner === '') {
                $candidateQuery->whereNull('claimed_by');
            } else {
                $candidateQuery->where('claimed_by', $owner);
            }

            $updated = $candidateQuery->update($updates);
            if ($updated === 1) {
                $reset++;
                // Revoke the exact old owner even if the minute processor has
                // already reclaimed the now-queued row with a different token.
                if ($owner !== '') $this->service->releaseJobLease($candidateId, $owner);
                $this->service->broadcastJob($candidateId);
            }
        }

        $this->service->resetBreaker();

        $this->service->audit(
            'reset_queue', $userId, null, null, 'ok',
            ['rows_reset' => $reset],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );

        return $this->respondWithData([
            'rows_reset'      => $reset,
            'breaker_cleared' => true,
        ]);
    }

    /**
     * POST /api/v2/admin/prerender/reset-all
     *
     * Cancel/fence every older job, preflight a fresh tenant-aware route plan,
     * and enqueue one authoritative global force rebuild. Live snapshots are
     * retained until the new run validates completely.
     */
    public function resetAll(Request $r): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if ((string) $r->json('confirmation', '') !== 'RESET ALL SNAPSHOTS') {
            return $this->error(__('api.prerender_reset_confirmation'), 422, 'VALIDATION_INVALID');
        }
        if (!$this->checkActionRate($userId, 'reset_all', 1, 300)) {
            return $this->error(__('api.prerender_reset_rate_limited'), 429, 'RATE_LIMITED');
        }

        try {
            $result = $this->service->resetAllSnapshots(
                $userId,
                $r->ip(),
                substr((string) $r->userAgent(), 0, 255)
            );
        } catch (\Throwable $e) {
            report($e);
            $this->service->audit(
                'reset_all', $userId, null, null, 'error',
                ['error' => substr($e->getMessage(), 0, 1000)],
                $r->ip(), substr((string) $r->userAgent(), 0, 255)
            );
            return $this->error(__('api.prerender_reset_failed'), 503, 'PRERENDER_RESET_FAILED');
        }

        return $this->respondWithData($result, null, 202);
    }

    /**
     * GET /api/v2/admin/prerender/export/{kind}.csv
     *
     * Streamed CSV export. `kind` ∈ { audit, inventory, jobs }. No new logic —
     * just calls the read methods and emits CSV. Big-result-set safe because
     * we cap each kind at 5,000 rows; if you need more, use the JSON API
     * with paging.
     */
    public function exportCsv(Request $r, string $kind): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $this->requirePlatformSuperAdmin();
        $kind = strtolower($kind);
        if (!in_array($kind, ['audit', 'inventory', 'jobs'], true)) {
            abort(404, 'Unknown export kind');
        }

        $filename = sprintf('prerender-%s-%s.csv', $kind, date('Ymd-His'));
        $headers = [
            'Content-Type'        => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control'       => 'no-store',
        ];

        return response()->stream(function () use ($kind, $r) {
            $out = fopen('php://output', 'w');

            if ($kind === 'audit') {
                \App\Support\CsvExportSanitizer::put($out, ['id', 'created_at', 'action', 'outcome', 'actor_email', 'tenant_slug', 'job_id', 'ip', 'details']);
                foreach ($this->service->recentAudit(5000, $r->query('action')) as $row) {
                    \App\Support\CsvExportSanitizer::put($out, CsvExportSanitizer::row([
                        $row['id'] ?? '',
                        $row['created_at'] ?? '',
                        $row['action'] ?? '',
                        $row['outcome'] ?? '',
                        $row['actor_email'] ?? '',
                        $row['tenant_slug'] ?? '',
                        $row['job_id'] ?? '',
                        $row['ip'] ?? '',
                        is_array($row['details'] ?? null) ? json_encode($row['details']) : '',
                    ]));
                }
            } elseif ($kind === 'inventory') {
                \App\Support\CsvExportSanitizer::put($out, ['host', 'route', 'cache_path', 'size_bytes', 'mtime', 'age_s', 'staleness', 'http_status', 'content_stale', 'asset_issues']);
                $items = $this->service->inventory($r->query('tenant'));
                foreach (array_slice($items, 0, 5000) as $row) {
                    if (!empty($row['__truncated'])) continue;
                    \App\Support\CsvExportSanitizer::put($out, CsvExportSanitizer::row([
                        $row['host'] ?? '',
                        $row['route'] ?? '',
                        $row['cache_path'] ?? '',
                        $row['size_bytes'] ?? '',
                        $row['mtime'] ?? '',
                        $row['age_s'] ?? '',
                        $row['staleness'] ?? '',
                        $row['http_status'] ?? '',
                        ($row['content_stale'] ?? false) ? '1' : '0',
                        is_array($row['asset_issues'] ?? null) ? implode('|', $row['asset_issues']) : '',
                    ]));
                }
            } else { // jobs
                \App\Support\CsvExportSanitizer::put($out, ['id', 'status', 'priority', 'tenant_slug', 'routes', 'force', 'dry_run', 'queued_at', 'fence_ready_at', 'started_at', 'finished_at', 'duration_s', 'exit_code', 'rendered_count', 'planned_count', 'requested_by']);
                $rows = $this->service->listJobs(5000, $r->query('status'));
                foreach ($rows as $row) {
                    \App\Support\CsvExportSanitizer::put($out, CsvExportSanitizer::row([
                        $row['id'] ?? '',
                        $row['status'] ?? '',
                        $row['priority'] ?? '',
                        $row['tenant_slug'] ?? '',
                        $row['routes'] ?? '',
                        ($row['force'] ?? false) ? '1' : '0',
                        ($row['dry_run'] ?? false) ? '1' : '0',
                        $row['queued_at'] ?? '',
                        $row['fence_ready_at'] ?? '',
                        $row['started_at'] ?? '',
                        $row['finished_at'] ?? '',
                        $row['duration_s'] ?? '',
                        $row['exit_code'] ?? '',
                        $row['rendered_count'] ?? '',
                        $row['planned_count'] ?? '',
                        is_array($row['requested_by'] ?? null) ? ($row['requested_by']['email'] ?? '') : '',
                    ]));
                }
            }

            fclose($out);
        }, 200, $headers);
    }

    /**
     * GET /api/v2/admin/prerender/ttl-inspector?route=/blog/foo
     *
     * Returns which config/prerender.php pattern matches the given route and
     * what TTL it gets. Lets operators see the freshness policy at a glance
     * without grepping config.
     */
    /**
     * POST /api/v2/admin/prerender/jobs/{id}/retry
     *
     * "Try again" for a finished job: clone its parameters into a new queued
     * row. The original is left alone (history preserved). The new row gets
     * a fresh audit trail.
     */
    public function retryJob(Request $r, int $id): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        if (!$this->checkActionRate($userId, 'retry', 30, 60)) {
            return $this->error('Too many retries', 429, 'RATE_LIMITED');
        }

        $original = $this->service->getJob($id);
        if (!$original) return $this->error('Job not found', 404, 'NOT_FOUND');
        if (in_array($original['status'] ?? '', ['pending_fence', 'queued', 'claimed', 'running'], true)) {
            return $this->error('Job is still in flight — cancel it before retrying', 409, 'CONFLICT');
        }

        $newId = $this->service->enqueueJob(
            $original['tenant_id'] ?? null,
            $original['routes'] ?? null,
            (bool) ($original['force'] ?? false),
            (bool) ($original['dry_run'] ?? false),
            $userId,
            \App\Services\PrerenderService::PRIORITY_NORMAL
        );

        $this->service->audit(
            'retry', $userId, $original['tenant_id'] ?? null, $newId, 'ok',
            ['retried_from_job_id' => $id, 'original_status' => $original['status'] ?? null],
            $r->ip(), substr((string) $r->userAgent(), 0, 255)
        );

        return $this->respondWithData([
            'job_id'             => $newId,
            'retried_from_job_id'=> $id,
            'job'                => $this->service->getJob($newId),
        ]);
    }

    /**
     * GET /api/v2/admin/prerender/sitemap-explorer?tenant=slug
     *
     * Returns the full list of routes the engine expects to render for a
     * tenant — static floor (feature/module gated) plus dynamic routes from
     * SitemapService. Lets operators answer "what does the engine think this
     * tenant has?" without grepping logs or running the artisan command.
     */
    public function sitemapExplorer(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $slug = (string) $r->query('tenant', '');
        if ($slug === '' || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $slug)) {
            return $this->error('Valid tenant slug required', 400, 'VALIDATION_INVALID');
        }
        $target = collect($this->service->loadTenantTargets())->firstWhere('slug', $slug);
        if (!is_array($target)) return $this->error(__('api.tenant_not_found'), 404, 'NOT_FOUND');

        $staticRoutes  = $this->service->routesForTenant((object) $target);
        try {
            $routes = $this->service->expectedRoutesForTenant(
                $target,
                PrerenderService::MAX_PLANNED_ROUTES_PER_TENANT,
                true
            );
            $staticLookup = array_fill_keys($staticRoutes, true);
            $dynamicRoutes = array_values(array_filter(
                array_map('strval', $routes),
                fn($route) => $route !== '' && $route[0] === '/' && !isset($staticLookup[$route])
            ));
        } catch (\Throwable $e) {
            report($e);
            return $this->error(__('api.prerender_plan_unavailable'), 503, 'PRERENDER_PLAN_UNAVAILABLE');
        }

        return $this->respondWithData([
            'tenant_slug'    => $slug,
            'tenant_id'      => (int) $target['tenant_id'],
            'static_routes'  => $staticRoutes,
            'dynamic_routes' => $dynamicRoutes,
            'total_count'    => count($staticRoutes) + count($dynamicRoutes),
            'truncated'      => false,
        ]);
    }

    public function ttlInspector(Request $r): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $route = (string) $r->query('route', '');
        if ($route === '' || $route[0] !== '/') {
            return $this->error('route must start with "/"', 400, 'VALIDATION_INVALID');
        }
        $route = PrerenderService::normalizeRoute($route);
        if ($route === null) {
            return $this->error('Invalid route', 400, 'VALIDATION_INVALID');
        }
        return $this->respondWithData($this->service->describeTtlForRoute($route));
    }

    /** @param array<int|string,mixed> $paths */
    private function previewHash(array $paths): string
    {
        $normalized = array_values(array_unique(array_map('strval', $paths)));
        sort($normalized, SORT_STRING);
        return hash('sha256', json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /** @return list<string> */
    private function unexpectedPreviewPaths(array $result): array
    {
        $paths = [];
        foreach (($result['by_tenant'] ?? []) as $slug => $routes) {
            if (!is_array($routes)) continue;
            foreach ($routes as $route) {
                $paths[] = (string) $slug . "\0" . (string) $route;
            }
        }
        return $paths;
    }

    /**
     * Per-user per-action rate limit using the cache. Returns true if the
     * action is allowed, false if the caller has exceeded $limit attempts
     * in $windowSeconds. Hard-coded keys; no need for the cluster-wide
     * RateLimiter facade abstraction.
     */
    private function checkActionRate(int $userId, string $action, int $limit, int $windowSeconds): bool
    {
        $key = "prerender:rate:{$action}:{$userId}";
        $count = (int) Cache::increment($key);
        if ($count === 1) {
            Cache::put($key, 1, $windowSeconds);
        }
        if ($count > $limit) {
            $this->service->audit(
                $action, $userId, null, null, 'denied',
                ['reason' => 'rate_limit_exceeded', 'count' => $count, 'limit' => $limit]
            );
            return false;
        }
        return true;
    }

    private function checkExternalInvalidateRate(Request $r, int $tenantId, string $authMode): bool
    {
        $ipHash = hash('sha256', (string) $r->ip());
        $key = "prerender:rate:invalidate:webhook:{$tenantId}:{$authMode}:{$ipHash}";
        $limit = 60;
        $windowSeconds = 60;
        $count = (int) Cache::increment($key);
        if ($count === 1) {
            Cache::put($key, 1, $windowSeconds);
        }
        if ($count > $limit) {
            $this->service->audit(
                'invalidate', null, $tenantId, null, 'denied',
                ['reason' => 'rate_limit_exceeded', 'auth_mode' => $authMode, 'count' => $count, 'limit' => $limit],
                $r->ip(), substr((string) $r->userAgent(), 0, 255)
            );
            return false;
        }
        return true;
    }
}
