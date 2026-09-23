<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\JobFeedService;
use App\Services\JobConfigurationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * JobFeedController — Public RSS/XML and JSON job feeds for aggregator syndication.
 *
 * These endpoints are public (no auth required) but tenant-scoped via subdomain/header.
 * Designed for consumption by Google Jobs, Indeed, and other job aggregators.
 */
class JobFeedController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly JobFeedService $feedService,
    ) {}

    private function feedsEnabled(): bool
    {
        $value = JobConfigurationService::get(JobConfigurationService::CONFIG_ENABLE_RSS_FEED, true);
        if (is_bool($value)) {
            return $value;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? true;
    }

    /**
     * GET /api/v2/jobs/feed.xml — RSS 2.0 feed of open job vacancies.
     *
     * Returns XML with Content-Type: application/rss+xml.
     * Cached for 15 minutes per tenant.
     */
    public function rssFeed(): Response
    {
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('job_vacancies') || !$this->feedsEnabled()) {
            return response('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feature Disabled</title></channel></rss>', 403)
                ->header('Content-Type', 'application/rss+xml; charset=UTF-8');
        }

        $xml = $this->feedService->generateRssFeed($tenantId);

        return response($xml, 200)
            ->header('Content-Type', 'application/rss+xml; charset=UTF-8')
            ->header('Cache-Control', 'public, max-age=900');
    }

    /**
     * GET /api/v2/jobs/feed.json — JSON feed with Google Jobs / Schema.org JobPosting format.
     *
     * Returns structured JSON for search engine consumption.
     * Cached for 15 minutes per tenant.
     */
    public function jsonFeed(): JsonResponse
    {
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('job_vacancies') || !$this->feedsEnabled()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.job_feed_disabled'), null, 403);
        }

        $data = $this->feedService->generateJsonFeed($tenantId);

        return response()->json($data, 200, [
            'Cache-Control' => 'public, max-age=900',
        ]);
    }

    /**
     * GET /api/v2/jobs/feed/indeed.xml — Indeed XML feed format.
     *
     * Returns XML in Indeed's expected feed format for job syndication.
     * Cached for 15 minutes per tenant.
     */
    public function indeedXml(): Response
    {
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('job_vacancies') || !$this->feedsEnabled()) {
            return response('<?xml version="1.0" encoding="UTF-8"?><source></source>', 403)
                ->header('Content-Type', 'application/xml; charset=UTF-8');
        }

        $jobs = \App\Models\JobVacancy::where('job_vacancies.tenant_id', $tenantId)
            ->where('job_vacancies.status', 'open')
            ->where(function ($query) {
                $query->whereNull('job_vacancies.deadline')
                    ->orWhere('job_vacancies.deadline', '>', now());
            })
            ->where(function ($query) {
                $query->whereNull('job_vacancies.moderation_status')
                    ->orWhere('job_vacancies.moderation_status', 'approved');
            })
            ->leftJoin('organizations as o', 'job_vacancies.organization_id', '=', 'o.id')
            ->select('job_vacancies.*', 'o.name as organization_name')
            ->orderByDesc('job_vacancies.created_at')
            ->limit(100)
            ->get();

        $baseUrl = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');

        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<source>' . "\n";
        $xml .= '  <publisher>Project NEXUS</publisher>' . "\n";
        $xml .= '  <publisherurl>' . htmlspecialchars($baseUrl) . '</publisherurl>' . "\n";
        $xml .= '  <lastBuildDate>' . now()->toRfc2822String() . '</lastBuildDate>' . "\n";

        // Every value is XML-escaped rather than CDATA-wrapped: a job's own title,
        // description, location or category containing `]]>` would otherwise end
        // the CDATA section and inject forged <job> entries into the feed (F-076).
        $e = fn (mixed $value): string => $this->feedService->xmlEscape((string) $value);

        foreach ($jobs as $job) {
            $xml .= '  <job>' . "\n";
            $xml .= '    <title>' . $e($job->title ?? '') . '</title>' . "\n";
            $xml .= '    <date>' . $e($job->created_at ? $job->created_at->format('D, d M Y H:i:s O') : '') . '</date>' . "\n";
            $xml .= '    <referencenumber>' . (int) $job->id . '</referencenumber>' . "\n";
            $xml .= '    <url>' . $e($baseUrl . '/jobs/' . $job->id) . '</url>' . "\n";
            $xml .= '    <company>' . $e($job->organization_name ?? 'Project NEXUS') . '</company>' . "\n";
            $xml .= '    <city>' . $e($job->location ?? '') . '</city>' . "\n";
            $xml .= '    <description>' . $e(mb_substr((string) ($job->description ?? ''), 0, 5000)) . '</description>' . "\n";

            if ($job->salary_min) {
                $xml .= '    <salary>' . $e(number_format($job->salary_min, 0) . ' - ' . number_format($job->salary_max ?? $job->salary_min, 0)) . '</salary>' . "\n";
            }

            $typeMap = ['full_time' => 'fulltime', 'part_time' => 'parttime', 'one_off' => 'contract', 'flexible' => 'parttime'];
            $xml .= '    <jobtype>' . $e($typeMap[$job->commitment] ?? 'other') . '</jobtype>' . "\n";
            $xml .= '    <category>' . $e($job->category ?? 'General') . '</category>' . "\n";

            if ($job->deadline) {
                $xml .= '    <expirationdate>' . $e($job->deadline->format('D, d M Y')) . '</expirationdate>' . "\n";
            }

            $xml .= '  </job>' . "\n";
        }

        $xml .= '</source>';

        return response($xml, 200, [
            'Content-Type' => 'application/xml; charset=utf-8',
            'Cache-Control' => 'public, max-age=900',
        ]);
    }
}
