<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\PrerenderService;
use App\Services\SitemapService;
use App\Support\Sentry\OperatorLog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * What search engines actually receive, checked every night (2026-10-23).
 *
 * Until then nothing on a schedule looked at the live site the way Google
 * does: check-prerender-delivery.mjs runs only during a deploy and checks body
 * size, an H1 and a description. This fetches, as Googlebot, each community's
 * home and About page, its sitemap, its host's robots.txt and its llms.txt, and
 * checks the things that cost search visibility when they break quietly:
 *
 *   - the page answers 200 with exactly one <title>;
 *   - its canonical is the community's own address;
 *   - it says noindex only when the community chose to be hidden;
 *   - the sitemap answers and lists at least one address (404 when hidden or
 *     switched off — then it must NOT answer);
 *   - robots.txt answers and names this host's sitemap;
 *   - llms.txt answers (404 when hidden).
 *
 * Any problem is logged, sent to Sentry once (stable fingerprint) and to the
 * SLO Slack channel when configured, and the command exits non-zero. Same
 * alerting path as slo:check.
 */
class SeoProbe extends Command
{
    protected $signature = 'seo:probe
                            {--community= : Check only the community with this slug}
                            {--timeout=20 : Seconds to wait for each request}';

    protected $description = 'Fetch each community as Googlebot and alert when titles, canonicals, robots, sitemaps or llms.txt are wrong.';

    private const USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

    /** @var list<string> */
    private array $problems = [];

    public function handle(PrerenderService $prerender): int
    {
        $only = trim((string) $this->option('community'));
        $checkedHosts = [];
        $checked = 0;

        foreach ($prerender->loadTenantTargets() as $target) {
            if ($only !== '' && $target['slug'] !== $only) {
                continue;
            }
            $tenantId = (int) $target['tenant_id'];
            $origin = SitemapService::targetOrigin($target);
            $base = $origin . $target['prefix'];
            $label = $target['slug'] !== '' ? $target['slug'] : "tenant {$tenantId}";
            $hidden = SitemapService::isNoindexTenant($tenantId);
            $notListed = SitemapService::notListedReason($tenantId);
            // A community that chose its accessible site for search engines:
            // its main pages must point there, and the accessible site must
            // publish the sitemap instead.
            $accessible = !$hidden && SitemapService::isAccessiblePrimary($tenantId)
                ? SitemapService::accessibleBase($tenantId)
                : null;

            foreach (['/', '/about'] as $path) {
                $this->checkPage($label, $base, $path, $hidden, $accessible !== null ? $accessible . $path : null);
            }
            $this->checkSitemap($label, $origin, $target, $tenantId, $notListed);
            if ($accessible !== null) {
                $this->checkAccessibleSitemap($label, $accessible . '/sitemap.xml');
            }
            $this->checkLlms($label, $base, $hidden);
            if (!isset($checkedHosts[$target['host']])) {
                $checkedHosts[$target['host']] = true;
                $this->checkRobots($target['host'], $origin);
            }
            $checked++;
        }

        if ($checked === 0) {
            $this->error('No community matched; nothing was checked.');
            return self::FAILURE;
        }

        if ($this->problems === []) {
            $this->info("SEO probe: {$checked} communities checked, no problems.");
            return self::SUCCESS;
        }

        foreach ($this->problems as $problem) {
            $this->error($problem);
        }
        $this->raiseAlert(count($this->problems), $checked);
        return self::FAILURE;
    }

    private function fetch(string $url): ?\Illuminate\Http\Client\Response
    {
        try {
            return Http::withHeaders(['User-Agent' => self::USER_AGENT])
                ->timeout((int) $this->option('timeout'))
                ->withoutRedirecting()
                ->get($url);
        } catch (\Throwable $e) {
            $this->problems[] = "{$url}: request failed ({$e->getMessage()})";
            return null;
        }
    }

    private function checkPage(string $label, string $base, string $path, bool $hidden, ?string $expectedCanonical = null): void
    {
        $url = $base . $path;
        $response = $this->fetch($url);
        if ($response === null) {
            return;
        }
        if ($response->status() !== 200) {
            $this->problems[] = "{$label} {$url}: HTTP {$response->status()}, expected 200";
            return;
        }
        $html = (string) preg_replace('#<!--.*?-->#s', '', $response->body());

        $titles = preg_match_all('#<title[^>]*>(.*?)</title>#is', $html, $m);
        if ($titles !== 1 || trim(strip_tags($m[1][0] ?? '')) === '') {
            $this->problems[] = "{$label} {$url}: {$titles} <title> tags, expected exactly one with text";
        }

        $robots = preg_match('#<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']*)#i', $html, $r) ? strtolower($r[1]) : '';
        $headerRobots = strtolower((string) $response->header('X-Robots-Tag'));
        $saysNoindex = str_contains($robots, 'noindex') || str_contains($headerRobots, 'noindex');
        if ($saysNoindex && !$hidden) {
            $this->problems[] = "{$label} {$url}: says noindex but the community is not hidden from search";
        }
        if (!$saysNoindex && $hidden) {
            $this->problems[] = "{$label} {$url}: the community is hidden from search but the page does not say noindex";
        }

        if (!$hidden) {
            $canonical = preg_match('#<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)#i', $html, $c) ? $c[1] : '';
            $want = $expectedCanonical ?? $url;
            if ($canonical === '' || rtrim(html_entity_decode($canonical), '/') !== rtrim($want, '/')) {
                $this->problems[] = "{$label} {$url}: canonical is " . ($canonical === '' ? 'missing' : $canonical) . ", expected {$want}";
            }
        }
    }

    /** @param array{slug:string, prefix:string, host:string} $target */
    private function checkSitemap(string $label, string $origin, array $target, int $tenantId, ?string $notListed): void
    {
        $url = $target['prefix'] === '' && $tenantId !== 1
            ? $origin . '/sitemap.xml'
            : $origin . '/sitemap-' . ($tenantId === 1 || $target['slug'] === '' ? 'main' : $target['slug']) . '.xml';
        $response = $this->fetch($url);
        if ($response === null) {
            return;
        }
        if ($notListed !== null) {
            if ($response->status() === 200) {
                $this->problems[] = "{$label} {$url}: answers 200 although the community publishes no sitemap ({$notListed})";
            }
            return;
        }
        if ($response->status() !== 200) {
            $this->problems[] = "{$label} {$url}: HTTP {$response->status()}, expected 200";
            return;
        }
        $body = $response->body();
        if (!str_contains($body, '<urlset') && !str_contains($body, '<sitemapindex')) {
            $this->problems[] = "{$label} {$url}: not a sitemap";
        } elseif (preg_match_all('#<loc>#', $body) < 1) {
            $this->problems[] = "{$label} {$url}: lists no addresses";
        }
    }

    private function checkAccessibleSitemap(string $label, string $url): void
    {
        $response = $this->fetch($url);
        if ($response === null) {
            return;
        }
        if ($response->status() !== 200 || preg_match_all('#<loc>#', $response->body()) < 1) {
            $this->problems[] = "{$label} {$url}: the accessible site is the community's site for search engines but its sitemap is missing or empty (HTTP {$response->status()})";
        }
    }

    private function checkLlms(string $label, string $base, bool $hidden): void
    {
        $url = $base . '/llms.txt';
        $response = $this->fetch($url);
        if ($response === null) {
            return;
        }
        $expected = $hidden ? 404 : 200;
        if ($response->status() !== $expected) {
            $this->problems[] = "{$label} {$url}: HTTP {$response->status()}, expected {$expected}";
        }
    }

    private function checkRobots(string $host, string $origin): void
    {
        $url = $origin . '/robots.txt';
        $response = $this->fetch($url);
        if ($response === null) {
            return;
        }
        if ($response->status() !== 200) {
            $this->problems[] = "{$host} {$url}: HTTP {$response->status()}, expected 200";
            return;
        }
        if (!preg_match('#^Sitemap:\s*https?://' . preg_quote($host, '#') . '[:/]#mi', $response->body())) {
            $this->problems[] = "{$host} {$url}: does not name this host's sitemap";
        }
    }

    private function raiseAlert(int $count, int $checked): void
    {
        $message = "SEO probe: {$count} problem(s) across {$checked} communities";
        $context = ['problems' => array_slice($this->problems, 0, 50), 'count' => $count];

        OperatorLog::withoutSentry()->error('SEO PROBE: search engines are receiving something wrong', $context);

        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('probe', 'seo');
                    $scope->setFingerprint(['seo_probe']);
                    $scope->setContext('seo_probe', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('seo:probe Sentry capture failed: ' . $e->getMessage());
        }

        $webhook = (string) (config('services.slack.slo_alerts_webhook') ?? '');
        if ($webhook === '') {
            return;
        }
        try {
            Http::timeout(10)->post($webhook, [
                'text' => ":mag: *Project NEXUS SEO probe*\n{$message}\n" . implode("\n", array_map(
                    static fn (string $p) => '• ' . $p,
                    array_slice($this->problems, 0, 15)
                )),
            ]);
        } catch (\Throwable $e) {
            Log::debug('seo:probe Slack push failed: ' . $e->getMessage());
        }
    }
}
