<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Helpers\UrlHelper;
use App\Models\JobVacancy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * JobFeedService — Generates RSS 2.0 XML and Google Jobs JSON feeds.
 *
 * Feeds include only open vacancies with future or null deadlines,
 * limited to 100 most recent, and cached for 15 minutes.
 */
class JobFeedService
{
    /** Cache TTL in seconds (15 minutes) */
    private const CACHE_TTL = 900;

    /**
     * Generate an RSS 2.0 XML feed of open job vacancies.
     *
     * @param int $tenantId
     * @return string RSS XML string
     */
    public function generateRssFeed(int $tenantId): string
    {
        $cacheKey = "job_feed_rss_{$tenantId}";

        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        $jobs = $this->getOpenJobs($tenantId);
        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? 'Community';
        $appUrl = UrlHelper::getBaseUrl();
        $lastBuildDate = gmdate('D, d M Y H:i:s') . ' GMT';

        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">' . "\n";
        $xml .= '  <channel>' . "\n";
        $xml .= '    <title>' . $this->xmlEscape($tenantName) . ' - Job Vacancies</title>' . "\n";
        $xml .= '    <link>' . $this->xmlEscape($appUrl . '/jobs') . '</link>' . "\n";
        $xml .= '    <description>Latest job vacancies from ' . $this->xmlEscape($tenantName) . '</description>' . "\n";
        $xml .= '    <language>en</language>' . "\n";
        $xml .= '    <lastBuildDate>' . $lastBuildDate . '</lastBuildDate>' . "\n";
        $xml .= '    <atom:link href="' . $this->xmlEscape($appUrl . '/api/v2/jobs/feed.xml') . '" rel="self" type="application/rss+xml"/>' . "\n";

        foreach ($jobs as $job) {
            $jobUrl = $appUrl . '/jobs/' . $job->id;
            $pubDate = $job->created_at ? $job->created_at->format('D, d M Y H:i:s') . ' GMT' : $lastBuildDate;

            $xml .= '    <item>' . "\n";
            $xml .= '      <title>' . $this->xmlEscape($job->title) . '</title>' . "\n";
            $xml .= '      <link>' . $this->xmlEscape($jobUrl) . '</link>' . "\n";
            // Escaped, not CDATA-wrapped: a `]]>` in the description would close
            // the CDATA section and let a job post inject its own items (F-076).
            $xml .= '      <description>' . $this->xmlEscape((string) ($job->description ?? '')) . '</description>' . "\n";
            $xml .= '      <pubDate>' . $pubDate . '</pubDate>' . "\n";
            $xml .= '      <guid isPermaLink="true">' . $this->xmlEscape($jobUrl) . '</guid>' . "\n";

            if (!empty($job->category)) {
                $xml .= '      <category>' . $this->xmlEscape($job->category) . '</category>' . "\n";
            }

            $xml .= '    </item>' . "\n";
        }

        $xml .= '  </channel>' . "\n";
        $xml .= '</rss>';

        Cache::put($cacheKey, $xml, self::CACHE_TTL);

        return $xml;
    }

    /**
     * Generate a JSON feed using Google Jobs / Schema.org JobPosting format.
     *
     * @param int $tenantId
     * @return array Structured data array
     */
    public function generateJsonFeed(int $tenantId): array
    {
        $cacheKey = "job_feed_json_{$tenantId}";

        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        $jobs = $this->getOpenJobs($tenantId);
        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? 'Community';
        $appUrl = UrlHelper::getBaseUrl();

        $result = [
            'jobs' => [],
        ];

        foreach ($jobs as $job) {
            $posting = [
                '@context' => 'https://schema.org',
                '@type' => 'JobPosting',
                'title' => $job->title,
                'description' => $job->description ?? '',
                'datePosted' => $job->created_at ? $job->created_at->toIso8601String() : now()->toIso8601String(),
                'url' => $appUrl . '/jobs/' . $job->id,
                'hiringOrganization' => [
                    '@type' => 'Organization',
                    'name' => $job->organization_name ?? $tenantName,
                ],
            ];

            // Valid through / deadline
            if ($job->deadline) {
                $posting['validThrough'] = $job->deadline->toIso8601String();
            }

            // Employment type mapping
            $posting['employmentType'] = $this->mapCommitmentToEmploymentType($job->commitment);

            // Location
            if ($job->is_remote) {
                $posting['jobLocationType'] = 'TELECOMMUTE';
            }
            if (!empty($job->location)) {
                $posting['jobLocation'] = [
                    '@type' => 'Place',
                    'address' => $job->location,
                ];
            }

            // Salary
            if ($job->salary_min || $job->salary_max) {
                $salary = [
                    '@type' => 'MonetaryAmount',
                    'currency' => $job->salary_currency ?? 'EUR',
                ];

                $unitText = $job->salary_type === 'hourly' ? 'HOUR' : 'YEAR';

                if ($job->salary_min && $job->salary_max) {
                    $salary['value'] = [
                        '@type' => 'QuantitativeValue',
                        'minValue' => $job->salary_min,
                        'maxValue' => $job->salary_max,
                        'unitText' => $unitText,
                    ];
                } elseif ($job->salary_min) {
                    $salary['value'] = [
                        '@type' => 'QuantitativeValue',
                        'value' => $job->salary_min,
                        'unitText' => $unitText,
                    ];
                } else {
                    $salary['value'] = [
                        '@type' => 'QuantitativeValue',
                        'value' => $job->salary_max,
                        'unitText' => $unitText,
                    ];
                }

                $posting['baseSalary'] = $salary;
            }

            // Category / skills
            if (!empty($job->category)) {
                $posting['occupationalCategory'] = $job->category;
            }
            if (!empty($job->skills_required)) {
                $posting['skills'] = $job->skills_required;
            }

            $result['jobs'][] = $posting;
        }

        Cache::put($cacheKey, $result, self::CACHE_TTL);

        return $result;
    }

    /**
     * Get open jobs with valid deadlines, limited to 100 most recent.
     *
     * @param int $tenantId
     * @return \Illuminate\Database\Eloquent\Collection
     */
    private function getOpenJobs(int $tenantId): \Illuminate\Database\Eloquent\Collection
    {
        return JobVacancy::withoutGlobalScopes()
            ->where('job_vacancies.tenant_id', $tenantId)
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
    }

    /**
     * Map internal commitment types to Schema.org employment types.
     */
    private function mapCommitmentToEmploymentType(?string $commitment): string
    {
        return match ($commitment) {
            'full_time' => 'FULL_TIME',
            'part_time' => 'PART_TIME',
            'flexible' => 'OTHER',
            'one_off' => 'TEMPORARY',
            default => 'OTHER',
        };
    }

    /**
     * Escape a string for XML text or attribute content.
     *
     * Use this for every member-supplied value in a feed. Do not wrap such
     * values in CDATA: CDATA is not escaping, and `]]>` ends it (F-076).
     */
    public function xmlEscape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
