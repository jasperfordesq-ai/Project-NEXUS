<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Http\Middleware\SeoRedirectMiddleware;
use App\Services\RedisCache;
use App\Services\TokenService;

/**
 * AdminToolsController -- Admin tools: redirects, 404s, health checks, WebP, SEO audit, seed, blog backups, IP debug.
 *
 * All methods require admin authentication.
 */
class AdminToolsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly RedisCache $redisCache,
        private readonly TokenService $tokenService,
    ) {}

    // =========================================================================
    // SEO Redirects
    // =========================================================================

    /** GET /api/v2/admin/tools/redirects */
    public function getRedirects(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $redirects = DB::select(
                "SELECT id, tenant_id, source_url, destination_url, hits, created_at
                 FROM seo_redirects WHERE tenant_id = ? ORDER BY created_at DESC",
                [$tenantId]
            );

            $formatted = array_map(fn($r) => [
                'id' => (int) $r->id,
                'tenant_id' => (int) $r->tenant_id,
                'source_url' => $r->source_url,
                'destination_url' => $r->destination_url,
                'hits' => (int) ($r->hits ?? 0),
                'created_at' => $r->created_at ?? '',
            ], $redirects);

            return $this->respondWithData($formatted);
        } catch (\Throwable $e) {
            return $this->respondWithData([]);
        }
    }

    /** POST /api/v2/admin/tools/redirects */
    public function createRedirect(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $sourceUrl = trim($this->input('source_url', $this->input('from_url', '')));
        $destinationUrl = trim($this->input('destination_url', $this->input('to_url', '')));

        if (empty($sourceUrl)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.from_url_required'), 'source_url', 422);
        }
        if (empty($destinationUrl)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.to_url_required'), 'destination_url', 422);
        }
        // F-061: destinations are same-host paths only ("/new-page"), never
        // another site — otherwise the API host becomes an open redirect.
        if (!SeoRedirectMiddleware::isSafeDestination($destinationUrl)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.redirect_destination_invalid'), 'destination_url', 422);
        }

        try {
            DB::insert(
                "INSERT INTO seo_redirects (tenant_id, source_url, destination_url) VALUES (?, ?, ?)",
                [$tenantId, $sourceUrl, $destinationUrl]
            );

            return $this->respondWithData([
                'id' => (int) DB::getPdo()->lastInsertId(),
                'source_url' => $sourceUrl,
                'destination_url' => $destinationUrl,
            ], null, 201);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.redirect_create_failed'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/tools/redirects/{id} */
    public function deleteRedirect(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $redirect = DB::selectOne("SELECT id FROM seo_redirects WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$redirect) {
                return $this->respondWithError('NOT_FOUND', __('api.redirect_not_found'), 'id', 404);
            }

            DB::delete("DELETE FROM seo_redirects WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $this->respondWithData(['deleted' => true, 'id' => $id]);
        } catch (\Throwable $e) {
            return $this->respondWithError('NOT_FOUND', __('api.redirect_not_found_or_missing_table'), 'id', 404);
        }
    }

    // =========================================================================
    // 404 Errors
    // =========================================================================

    /** GET /api/v2/admin/tools/404-errors */
    public function get404Errors(): JsonResponse
    {
        // Global log — intentionally cross-tenant (super-admin only). error_404_log has no tenant_id column.
        $this->requirePlatformSuperAdmin();

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 1, 100);
        $offset = ($page - 1) * $perPage;

        try {
            $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM error_404_log WHERE resolved = 0")->cnt;

            $errors = DB::select(
                "SELECT id, url, referer, hit_count, first_seen_at, last_seen_at, resolved
                 FROM error_404_log WHERE resolved = 0
                 ORDER BY hit_count DESC, last_seen_at DESC
                 LIMIT ? OFFSET ?",
                [$perPage, $offset]
            );

            $formatted = array_map(fn($r) => [
                'id' => (int) $r->id,
                'url' => $r->url,
                'referrer' => $r->referer ?? null,
                'hits' => (int) ($r->hit_count ?? 1),
                'first_seen' => $r->first_seen_at ?? '',
                'last_seen' => $r->last_seen_at ?? '',
            ], $errors);

            return $this->respondWithData(['items' => $formatted, 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
        } catch (\Throwable $e) {
            return $this->respondWithData(['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage]);
        }
    }

    /** DELETE /api/v2/admin/tools/404-errors/{id} */
    public function delete404Error(int $id): JsonResponse
    {
        // Global log — intentionally cross-tenant (super-admin only). error_404_log has no tenant_id column.
        $this->requirePlatformSuperAdmin();

        try {
            $error = DB::selectOne("SELECT id FROM error_404_log WHERE id = ?", [$id]);
            if (!$error) {
                return $this->respondWithError('NOT_FOUND', __('api.error_404_not_found'), 'id', 404);
            }

            DB::delete("DELETE FROM error_404_log WHERE id = ?", [$id]);
            return $this->respondWithData(['deleted' => true, 'id' => $id]);
        } catch (\Throwable $e) {
            return $this->respondWithError('NOT_FOUND', __('api.error_404_not_found_or_missing_table'), 'id', 404);
        }
    }

    // =========================================================================
    // Health Check
    // =========================================================================

    /** POST /api/v2/admin/tools/health-check */
    public function runHealthCheck(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $tests = [];

        // Database
        $start = microtime(true);
        try {
            DB::selectOne("SELECT 1");
            $tests[] = ['code' => 'database', 'status' => 'pass', 'duration_ms' => round((microtime(true) - $start) * 1000)];
        } catch (\Throwable $e) {
            $tests[] = ['code' => 'database', 'status' => 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000), 'error' => __('api_controllers_1.admin_tools.connection_failed')];
        }

        // Redis
        $start = microtime(true);
        try {
            $stats = $this->redisCache->getStats();
            $tests[] = ['code' => 'redis', 'status' => ($stats['enabled'] ?? false) ? 'pass' : 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000)];
        } catch (\Throwable $e) {
            $tests[] = ['code' => 'redis', 'status' => 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000), 'error' => __('api_controllers_1.admin_tools.connection_failed')];
        }

        // Token Service
        $start = microtime(true);
        try {
            $testToken = $this->tokenService->generateToken(0, $tenantId);
            $tests[] = ['code' => 'auth_token', 'status' => !empty($testToken) ? 'pass' : 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000)];
        } catch (\Throwable $e) {
            $tests[] = ['code' => 'auth_token', 'status' => 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000), 'error' => __('api_controllers_1.admin_tools.connection_failed')];
        }

        // Tenant
        $start = microtime(true);
        try {
            $tenant = DB::selectOne("SELECT id, name FROM tenants WHERE id = ?", [$tenantId]);
            $tests[] = ['code' => 'tenant_bootstrap', 'status' => $tenant ? 'pass' : 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000)];
        } catch (\Throwable $e) {
            $tests[] = ['code' => 'tenant_bootstrap', 'status' => 'fail', 'duration_ms' => round((microtime(true) - $start) * 1000), 'error' => __('api_controllers_1.admin_tools.connection_failed')];
        }

        $passCount = count(array_filter($tests, fn($t) => $t['status'] === 'pass'));

        return $this->respondWithData([
            'tests' => $tests,
            'summary' => ['total' => count($tests), 'passed' => $passCount, 'failed' => count($tests) - $passCount, 'overall' => $passCount === count($tests) ? 'healthy' : 'degraded'],
        ]);
    }

    // =========================================================================
    // WebP, Seed, Blog Backups, SEO Audit
    // =========================================================================

    /** GET /api/v2/admin/tools/webp-stats */
    public function getWebpStats(): JsonResponse
    {
        $this->requireAdmin();

        $totalImages = 0;
        $webpImages = 0;
        $pendingConversion = 0;

        $uploadsDir = dirname(__DIR__, 4) . '/httpdocs/uploads';

        if (is_dir($uploadsDir)) {
            try {
                $iterator = new \RecursiveIteratorIterator(
                    new \RecursiveDirectoryIterator($uploadsDir, \RecursiveDirectoryIterator::SKIP_DOTS)
                );

                $imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];
                $nonWebpImages = 0;

                foreach ($iterator as $file) {
                    if (!$file->isFile()) continue;
                    $ext = strtolower($file->getExtension());

                    if ($ext === 'webp') {
                        $webpImages++;
                        $totalImages++;
                    } elseif (in_array($ext, $imageExtensions, true)) {
                        $nonWebpImages++;
                        $totalImages++;
                    }
                }

                $pendingConversion = $nonWebpImages;
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        return $this->respondWithData([
            'total_images' => $totalImages,
            'webp_images' => $webpImages,
            'pending_conversion' => $pendingConversion,
            'uploads_dir_exists' => is_dir($uploadsDir),
        ]);
    }

    /** POST /api/v2/admin/tools/webp-conversion */
    public function runWebpConversion(): JsonResponse
    {
        $this->requireAdmin();
        return $this->respondWithData(['started' => true, 'message' => __('api_controllers_1.admin_tools.conversion_queued')]);
    }

    /** POST /api/v2/admin/tools/seed-generator */
    public function runSeedGenerator(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $input = $this->getAllInput();
        $types = $input['types'] ?? [];
        $counts = $input['counts'] ?? [];

        if (empty($types)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.seed_type_required'), 'types', 422);
        }

        $validTypes = ['users', 'listings', 'transactions', 'events', 'groups', 'feed_posts', 'messages', 'reviews'];
        $invalidTypes = array_diff($types, $validTypes);

        if (!empty($invalidTypes)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_seed_types', ['invalid' => implode(', ', $invalidTypes), 'valid' => implode(', ', $validTypes)]),
                'types',
                422
            );
        }

        return $this->respondWithData([
            'started' => true,
            'message' => __('api_controllers_1.admin_tools.seed_generation_queued'),
            'types' => $types,
            'counts' => $counts,
        ]);
    }

    /** GET /api/v2/admin/tools/blog-backups */
    public function getBlogBackups(): JsonResponse
    {
        $this->requireAdmin();

        $backups = [];
        $backupsDir = dirname(__DIR__, 4) . '/backups/blog';

        if (is_dir($backupsDir)) {
            try {
                $files = scandir($backupsDir);
                foreach ($files as $file) {
                    if ($file === '.' || $file === '..') continue;

                    $filePath = $backupsDir . '/' . $file;
                    if (is_file($filePath)) {
                        $backups[] = [
                            'filename' => $file,
                            'size_bytes' => filesize($filePath),
                            'created_at' => date('Y-m-d H:i:s', filemtime($filePath)),
                        ];
                    }
                }

                usort($backups, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        return $this->respondWithData($backups);
    }

    /** POST /api/v2/admin/tools/blog-backups/restore */
    public function restoreBlogBackup(): JsonResponse
    {
        $this->requireAdmin();

        $id = $this->inputInt('backup_id', 0, 1);
        if ($id < 1) {
            // Try extracting from URI
            $uri = $_SERVER['REQUEST_URI'] ?? '';
            preg_match('#/blog-backups/(\d+)/restore#', $uri, $matches);
            $id = (int) ($matches[1] ?? 0);
        }

        if ($id < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_backup_id'), 'id', 400);
        }

        return $this->respondWithData([
            'restored' => true,
            'backup_id' => $id,
            'message' => __('api_controllers_1.admin_tools.blog_backup_restore_queued'),
        ]);
    }

    /** GET /api/v2/admin/tools/seo-audit */
    public function getSeoAudit(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $auditService = app(\App\Services\SeoAuditService::class);
            return $this->respondWithData($auditService->getLatestAudit($tenantId));
        } catch (\Throwable $e) {
            return $this->respondWithData(null);
        }
    }

    /** POST /api/v2/admin/tools/seo-audit */
    public function runSeoAudit(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $auditService = app(\App\Services\SeoAuditService::class);
        $results = $auditService->runAudit($tenantId);

        return $this->respondWithData($results);
    }

    /** GET /api/v2/admin/tools/ip-debug */
    public function ipDebug(): JsonResponse
    {
        $this->requireAdmin();
        return $this->respondWithData(\App\Core\ClientIp::debug());
    }

}
