<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Runs tenant SEO audits and returns locale-independent result codes.
 *
 * Display copy is deliberately owned by the consuming client. Check and issue
 * parameters contain only measurements, identifiers, URLs, or tenant content.
 */
class SeoAuditService
{
    private const TITLE_MAX_LENGTH = 60;
    private const DESC_MAX_LENGTH = 160;
    private const DESC_MIN_LENGTH = 50;

    /**
     * Run a full SEO audit for a tenant and persist the result.
     *
     * @return array{
     *     checks: list<array<string, mixed>>,
     *     score: int,
     *     max_score: int,
     *     grade: string,
     *     run_at: string
     * }
     */
    public function runAudit(int $tenantId): array
    {
        $checks = [
            $this->checkTenantMetadata($tenantId),
            $this->checkSeoSettings($tenantId),
            $this->checkBlogPostMeta($tenantId),
            $this->checkPageMeta($tenantId),
            $this->checkKbArticleMeta($tenantId),
            $this->checkRedirectHealth($tenantId),
            $this->checkDuplicateTitles($tenantId),
            $this->checkSitemapCoverage($tenantId),
            $this->checkCanonicalUrls($tenantId),
            $this->checkOpenGraph($tenantId),
            $this->checkContentQuality($tenantId),
        ];

        $score = 0;
        $maxScore = 0;
        foreach ($checks as $check) {
            $maxScore += $check['max_points'];
            $score += $check['points'];
        }

        $results = [
            'checks' => $checks,
            'score' => $score,
            'max_score' => $maxScore,
            'grade' => $this->calculateGrade($score, $maxScore),
            'run_at' => now()->toIso8601String(),
        ];

        $this->persistResults($tenantId, $results);

        return $results;
    }

    /**
     * Get the most recent audit result in the current code-based contract.
     *
     * Older rows contained fixed English fields. They are normalised here so
     * historical data can never leak untranslated display copy back to clients.
     *
     * @return array<string, mixed>|null
     */
    public function getLatestAudit(int $tenantId): ?array
    {
        $row = DB::selectOne(
            'SELECT results, created_at FROM seo_audits WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1',
            [$tenantId]
        );

        if (!$row || empty($row->results)) {
            return null;
        }

        $results = json_decode($row->results, true);
        if (!is_array($results)) {
            return null;
        }

        return $this->normaliseStoredResults($results, (string) $row->created_at);
    }

    private function checkTenantMetadata(int $tenantId): array
    {
        $tenant = DB::selectOne(
            'SELECT meta_title, meta_description, h1_headline, robots_directive FROM tenants WHERE id = ?',
            [$tenantId]
        );

        $issues = [];
        $metaTitle = $tenant?->meta_title;
        $metaDescription = $tenant?->meta_description;

        // The super-admin "Robots directive" can take a whole community out of
        // search engines with one dropdown choice (2026-10-23).
        if (stripos((string) ($tenant?->robots_directive ?? ''), 'noindex') !== false) {
            $issues[] = $this->issue('search_engines_blocked');
        }

        // Characters, not bytes: Irish, Arabic and Japanese titles were
        // counted long by strlen().
        if (empty($metaTitle)) {
            $issues[] = $this->issue('missing_homepage_meta_title');
        } elseif (mb_strlen($metaTitle) > self::TITLE_MAX_LENGTH) {
            $issues[] = $this->issue('homepage_meta_title_too_long', [
                'length' => mb_strlen($metaTitle),
                'max' => self::TITLE_MAX_LENGTH,
            ]);
        }

        if (empty($metaDescription)) {
            $issues[] = $this->issue('missing_meta_description');
        } elseif (mb_strlen($metaDescription) > self::DESC_MAX_LENGTH) {
            $issues[] = $this->issue('meta_description_too_long', [
                'length' => mb_strlen($metaDescription),
                'max' => self::DESC_MAX_LENGTH,
            ]);
        } elseif (mb_strlen($metaDescription) < self::DESC_MIN_LENGTH) {
            $issues[] = $this->issue('meta_description_too_short', [
                'length' => mb_strlen($metaDescription),
                'min' => self::DESC_MIN_LENGTH,
            ]);
        }

        // h1_headline is the accessible site's hub heading: only a hub (the
        // master tenant, or a community with communities beneath it) uses it.
        // The main website's heading comes from the landing page builder.
        if (empty($tenant?->h1_headline) && $this->isHub($tenantId)) {
            $issues[] = $this->issue('missing_homepage_h1');
        }

        return $this->buildCheck('tenant_metadata', [], $issues, 10);
    }

    private function isHub(int $tenantId): bool
    {
        if ($tenantId === 1) {
            return true;
        }
        try {
            return DB::table('tenants')->where('parent_id', $tenantId)->where('is_active', 1)->exists();
        } catch (\Throwable) {
            return false;
        }
    }

    private function checkSeoSettings(int $tenantId): array
    {
        $settings = $this->getTenantSettings($tenantId, [
            'seo_auto_sitemap', 'seo_canonical_urls', 'seo_open_graph',
            'seo_twitter_cards',
        ]);

        // These switches are ON unless a community turned them off: a missing
        // row means "never changed", not "disabled" (wrongly reported as
        // disabled until 2026-10-23).
        $issues = [];

        if (!filter_var($settings['seo_canonical_urls'] ?? true, FILTER_VALIDATE_BOOLEAN)) {
            $issues[] = $this->issue('canonical_urls_not_enabled');
        }

        if (!filter_var($settings['seo_open_graph'] ?? true, FILTER_VALIDATE_BOOLEAN)) {
            $issues[] = $this->issue('open_graph_not_enabled');
        }

        if (!filter_var($settings['seo_twitter_cards'] ?? true, FILTER_VALIDATE_BOOLEAN)) {
            $issues[] = $this->issue('twitter_cards_not_enabled');
        }

        // No title_suffix_missing issue any more: with no suffix, every page
        // title ends with the community's name (PageMeta), which is correct.

        return $this->buildCheck('seo_settings', [], $issues, 10);
    }

    private function checkBlogPostMeta(int $tenantId): array
    {
        $total = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM posts WHERE tenant_id = ? AND status = 'published'",
            [$tenantId]
        )->cnt;

        $issues = [];
        if ($total > 0) {
            $missingMeta = DB::select(
                "SELECT bp.id, bp.title, bp.slug
                 FROM posts bp
                 LEFT JOIN seo_metadata sm ON sm.tenant_id = bp.tenant_id
                    AND sm.entity_type = 'post' AND sm.entity_id = bp.id
                 WHERE bp.tenant_id = ? AND bp.status = 'published'
                    AND (sm.meta_title IS NULL OR sm.meta_title = ''
                         OR sm.meta_description IS NULL OR sm.meta_description = '')
                 LIMIT 20",
                [$tenantId]
            );

            foreach ($missingMeta as $post) {
                $issues[] = $this->issue('blog_post_meta_missing', [
                    'title' => (string) $post->title,
                    'path' => '/' . (string) $post->slug,
                ]);
            }

            if (count($missingMeta) >= 20) {
                $issues[] = $this->issue('additional_results_truncated', ['limit' => 20]);
            }
        }

        return $this->buildCheck('blog_meta', ['count' => $total], $issues, 10);
    }

    private function checkPageMeta(int $tenantId): array
    {
        $total = (int) DB::selectOne(
            'SELECT COUNT(*) AS cnt FROM pages WHERE tenant_id = ? AND is_published = 1',
            [$tenantId]
        )->cnt;

        $issues = [];
        if ($total > 0) {
            $missingMeta = DB::select(
                "SELECT p.id, p.title, p.slug
                 FROM pages p
                 LEFT JOIN seo_metadata sm ON sm.tenant_id = p.tenant_id
                    AND sm.entity_type = 'page' AND sm.entity_id = p.id
                 WHERE p.tenant_id = ? AND p.is_published = 1
                    AND (sm.meta_title IS NULL OR sm.meta_title = '')
                 LIMIT 20",
                [$tenantId]
            );

            foreach ($missingMeta as $page) {
                $issues[] = $this->issue('cms_page_meta_title_missing', [
                    'title' => (string) $page->title,
                    'path' => '/' . (string) $page->slug,
                ]);
            }
        }

        return $this->buildCheck('page_meta', ['count' => $total], $issues, 5);
    }

    private function checkKbArticleMeta(int $tenantId): array
    {
        $total = (int) DB::selectOne(
            'SELECT COUNT(*) AS cnt FROM knowledge_base_articles WHERE tenant_id = ? AND is_published = 1',
            [$tenantId]
        )->cnt;

        $issues = [];
        if ($total > 0) {
            $missingTitle = (int) DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM knowledge_base_articles
                 WHERE tenant_id = ? AND is_published = 1 AND (title IS NULL OR title = '')",
                [$tenantId]
            )->cnt;

            if ($missingTitle > 0) {
                $issues[] = $this->issue('kb_article_titles_missing', ['count' => $missingTitle]);
            }
        }

        return $this->buildCheck('kb_meta', ['count' => $total], $issues, 5);
    }

    private function checkRedirectHealth(int $tenantId): array
    {
        $redirects = DB::select(
            'SELECT id, source_url, destination_url FROM seo_redirects WHERE tenant_id = ?',
            [$tenantId]
        );

        $issues = [];
        $destinationMap = [];

        foreach ($redirects as $redirect) {
            $destinationMap[(string) $redirect->source_url] = (string) $redirect->destination_url;
        }

        foreach ($destinationMap as $from => $to) {
            if (isset($destinationMap[$to])) {
                $issues[] = $this->issue('redirect_chain', [
                    'from' => $from,
                    'via' => $to,
                    'destination' => $destinationMap[$to],
                ]);
            }
        }

        foreach ($destinationMap as $from => $to) {
            if (isset($destinationMap[$to]) && $destinationMap[$to] === $from) {
                $issues[] = $this->issue('redirect_loop', ['from' => $from, 'to' => $to]);
            }
        }

        foreach ($destinationMap as $from => $to) {
            if ($from === $to) {
                $issues[] = $this->issue('self_redirect', ['from' => $from, 'to' => $to]);
            }
        }

        return $this->buildCheck('redirect_health', ['count' => count($redirects)], $issues, 10);
    }

    private function checkDuplicateTitles(int $tenantId): array
    {
        $duplicates = DB::select(
            "SELECT meta_title, COUNT(*) AS cnt
             FROM seo_metadata
             WHERE tenant_id = ? AND meta_title IS NOT NULL AND meta_title != ''
             GROUP BY meta_title
             HAVING cnt > 1
             LIMIT 10",
            [$tenantId]
        );

        $issues = [];
        foreach ($duplicates as $duplicate) {
            $issues[] = $this->issue('duplicate_meta_title', [
                'title' => (string) $duplicate->meta_title,
                'count' => (int) $duplicate->cnt,
            ]);
        }

        return $this->buildCheck('duplicate_titles', [], $issues, 10);
    }

    private function checkSitemapCoverage(int $tenantId): array
    {
        $stats = app(SitemapService::class)->getStats($tenantId);
        $totalUrls = (int) $stats['total_urls'];
        $issues = [];

        if ($totalUrls === 0) {
            $issues[] = $this->issue('sitemap_empty');
        } elseif ($totalUrls < 5) {
            $issues[] = $this->issue('sitemap_low_coverage', ['count' => $totalUrls]);
        }

        foreach ($stats['content_types'] as $type => $count) {
            if ((int) $count !== 0) {
                continue;
            }

            if ($type === 'static_pages') {
                $issues[] = $this->issue('sitemap_static_pages_missing');
            } elseif ($type === 'profiles') {
                $issues[] = $this->issue('sitemap_profiles_missing');
            }
        }

        return $this->buildCheck('sitemap_coverage', ['count' => $totalUrls], $issues, 10);
    }

    private function checkCanonicalUrls(int $tenantId): array
    {
        $settings = $this->getTenantSettings($tenantId, ['seo_canonical_urls']);
        $issues = [];

        if (!filter_var($settings['seo_canonical_urls'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $issues[] = $this->issue('canonical_generation_disabled');
        }

        $customCanonicals = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM seo_metadata
             WHERE tenant_id = ? AND canonical_url IS NOT NULL AND canonical_url != ''",
            [$tenantId]
        )->cnt;

        if ($customCanonicals > 50) {
            $issues[] = $this->issue('custom_canonical_urls_high', ['count' => $customCanonicals]);
        }

        return $this->buildCheck('canonical_urls', [], $issues, 10);
    }

    private function checkOpenGraph(int $tenantId): array
    {
        $settings = $this->getTenantSettings($tenantId, ['seo_open_graph', 'seo_twitter_cards']);
        $tenant = DB::selectOne('SELECT og_image_url FROM tenants WHERE id = ?', [$tenantId]);
        $issues = [];

        if (!filter_var($settings['seo_open_graph'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $issues[] = $this->issue('open_graph_sharing_disabled');
        }

        if (!filter_var($settings['seo_twitter_cards'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $issues[] = $this->issue('twitter_cards_disabled');
        }

        if ($tenant && empty($tenant->og_image_url)) {
            $issues[] = $this->issue('open_graph_default_image_missing');
        }

        return $this->buildCheck('open_graph', [], $issues, 10);
    }

    private function checkContentQuality(int $tenantId): array
    {
        $issues = [];

        $shortPosts = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM posts
             WHERE tenant_id = ? AND status = 'published' AND LENGTH(content) < 300",
            [$tenantId]
        )->cnt;

        if ($shortPosts > 0) {
            $issues[] = $this->issue('thin_blog_content', [
                'count' => $shortPosts,
                'minimum' => 300,
            ]);
        }

        $untitledPages = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM pages
             WHERE tenant_id = ? AND is_published = 1 AND (title IS NULL OR title = '')",
            [$tenantId]
        )->cnt;

        if ($untitledPages > 0) {
            $issues[] = $this->issue('untitled_published_pages', ['count' => $untitledPages]);
        }

        return $this->buildCheck('content_quality', [], $issues, 10);
    }

    /**
     * @param array<string, string|int|float|bool|null> $params
     * @param list<array{code: string, params: array<string, string|int|float|bool|null>}> $issues
     * @return array<string, mixed>
     */
    private function buildCheck(string $code, array $params, array $issues, int $maxPoints): array
    {
        $issueCount = count($issues);

        if ($issueCount === 0) {
            $status = 'pass';
            $points = $maxPoints;
        } elseif ($issueCount <= 2) {
            $status = 'warning';
            $points = (int) round($maxPoints * 0.5);
        } else {
            $status = 'fail';
            $points = 0;
        }

        return [
            'code' => $code,
            'params' => $params,
            'status' => $status,
            'issues' => $issues,
            'issue_count' => $issueCount,
            'points' => $points,
            'max_points' => $maxPoints,
        ];
    }

    /**
     * @param array<string, string|int|float|bool|null> $params
     * @return array{code: string, params: array<string, string|int|float|bool|null>}
     */
    private function issue(string $code, array $params = []): array
    {
        return ['code' => $code, 'params' => $params];
    }

    /**
     * @param array<string, mixed> $results
     * @return array<string, mixed>
     */
    private function normaliseStoredResults(array $results, string $storedAt): array
    {
        $checks = [];

        foreach (($results['checks'] ?? []) as $check) {
            if (!is_array($check)) {
                continue;
            }

            $code = $check['code'] ?? $check['key'] ?? 'unknown';
            if (!is_string($code) || $code === '') {
                $code = 'unknown';
            }

            $params = is_array($check['params'] ?? null) ? $check['params'] : [];
            $issues = [];
            $containsLegacyIssue = false;

            foreach (($check['issues'] ?? []) as $issue) {
                if (!is_array($issue) || !is_string($issue['code'] ?? null)) {
                    $containsLegacyIssue = true;
                    continue;
                }

                $issues[] = [
                    'code' => $issue['code'],
                    'params' => is_array($issue['params'] ?? null) ? $issue['params'] : [],
                ];
            }

            if ($containsLegacyIssue) {
                $issues[] = $this->issue('legacy_result_requires_rerun');
            }

            $status = $check['status'] ?? 'warning';
            if (!in_array($status, ['pass', 'warning', 'fail'], true)) {
                $status = 'warning';
            }

            $checks[] = [
                'code' => $code,
                'params' => $params,
                'status' => $status,
                'issues' => $issues,
                'issue_count' => count($issues),
                'points' => max(0, (int) ($check['points'] ?? 0)),
                'max_points' => max(0, (int) ($check['max_points'] ?? 0)),
            ];
        }

        $grade = $results['grade'] ?? 'N/A';
        if (!is_string($grade) || !in_array($grade, ['A', 'B', 'C', 'D', 'F', 'N/A'], true)) {
            $grade = 'N/A';
        }

        $runAt = $results['run_at'] ?? $storedAt;

        return [
            'checks' => $checks,
            'score' => max(0, (int) ($results['score'] ?? 0)),
            'max_score' => max(0, (int) ($results['max_score'] ?? 0)),
            'grade' => $grade,
            'run_at' => is_string($runAt) ? $runAt : $storedAt,
            'stored_at' => $storedAt,
        ];
    }

    private function calculateGrade(int $score, int $maxScore): string
    {
        if ($maxScore === 0) {
            return 'N/A';
        }

        $percentage = ($score / $maxScore) * 100;

        return match (true) {
            $percentage >= 90 => 'A',
            $percentage >= 80 => 'B',
            $percentage >= 70 => 'C',
            $percentage >= 60 => 'D',
            default => 'F',
        };
    }

    /**
     * @param list<string> $keys
     * @return array<string, string>
     */
    private function getTenantSettings(int $tenantId, array $keys): array
    {
        if ($keys === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        $rows = DB::select(
            "SELECT setting_key, setting_value FROM tenant_settings
             WHERE tenant_id = ? AND setting_key IN ({$placeholders})",
            array_merge([$tenantId], $keys)
        );

        $settings = [];
        foreach ($rows as $row) {
            $settings[$row->setting_key] = $row->setting_value;
        }

        return $settings;
    }

    /** @param array<string, mixed> $results */
    private function persistResults(int $tenantId, array $results): void
    {
        try {
            DB::insert(
                "INSERT INTO seo_audits (tenant_id, url, results, created_at) VALUES (?, '', ?, NOW())",
                [$tenantId, json_encode($results)]
            );
        } catch (\Throwable $exception) {
            Log::warning('Failed to persist SEO audit results', [
                'tenant_id' => $tenantId,
                'error' => $exception->getMessage(),
            ]);
        }
    }
}
