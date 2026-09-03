<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\OutboundUrlGuard;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * LinkPreviewService — Fetches, caches, and retrieves Open Graph metadata for URLs.
 *
 * Features:
 * - HTTP fetching with timeout and size limits
 * - OG tag parsing with <title>/<meta description> fallbacks
 * - Favicon extraction
 * - SHA-256 URL hashing for cache deduplication
 * - 7-day cache expiry in the link_previews table
 * - SSRF protection (private IP blocking, protocol allowlist)
 * - YouTube/Vimeo special handling (video embeds)
 * - Post and message link preview associations
 *
 * Note: link_previews is NOT tenant-scoped — URLs are global cache entries.
 * The post_link_previews and message_link_previews junction tables associate
 * cached previews with tenant-scoped posts/messages.
 */
class LinkPreviewService
{
    /** Maximum response body to read (500 KB) */
    private const MAX_BODY_SIZE = 512000;

    /** HTTP timeout in seconds */
    private const HTTP_TIMEOUT = 5;

    /** Cache duration in days */
    private const CACHE_DAYS = 7;

    /** User-Agent string for fetching */
    private const USER_AGENT = 'NexusBot/1.0 (+https://project-nexus.ie)';

    /** Private/reserved IP ranges for SSRF protection */
    private const PRIVATE_IP_RANGES = [
        '127.',
        '10.',
        '0.',
        '169.254.',
        '::1',
        'fc00:',
        'fe80:',
    ];

    /** Additional private CIDR ranges */
    private const PRIVATE_CIDR = [
        ['172.16.0.0', '172.31.255.255'],
        ['192.168.0.0', '192.168.255.255'],
    ];

    /**
     * Fetch (or return cached) link preview for a URL.
     *
     * @return array|null  The preview data, or null if the URL cannot be fetched/parsed.
     */
    public function fetchPreview(string $url): ?array
    {
        $url = trim($url);

        if (! OutboundUrlGuard::isSafeHttpUrl($url)) {
            return null;
        }

        // Normalize URL for hashing (lowercase scheme + host)
        $normalizedUrl = $this->normalizeUrl($url);
        $urlHash = hash('sha256', $normalizedUrl);

        // Check cache
        $cached = $this->getCachedPreview($urlHash);
        if ($cached !== null) {
            return $cached;
        }

        // SSRF check: resolve hostname and verify it's not a private IP
        $parsed = parse_url($url);
        if (! $parsed || empty($parsed['host'])) {
            return null;
        }

        $domain = preg_replace('/^www\./', '', strtolower($parsed['host']));

        // Known video/media providers (YouTube, Vimeo, Spotify, SoundCloud,
        // Twitch, TikTok) embed straight from the URL. Build the preview here —
        // BEFORE any outbound fetch — so the player works even when the provider
        // blocks server-side scraping. YouTube now blocks datacenter IPs, which
        // silently killed every video embed on production (0 video previews ever
        // reached the feed) even though the video id was sitting in the URL.
        $providerEmbed = $this->videoEmbedFor($url, $domain);
        if ($providerEmbed !== null) {
            $preview = array_merge([
                'title'       => $providerEmbed['site_name'] ?? null,
                'description' => null,
                'image_url'   => null,
                'favicon_url' => null,
            ], $providerEmbed, [
                'url'      => $url,
                'url_hash' => $urlHash,
                'domain'   => $domain,
            ]);
            $this->storePreview($preview);

            return $this->formatPreviewResponse($preview);
        }

        // Fetch the URL with DNS/IP validation pinned into the cURL request.
        try {
            $response = Http::timeout(self::HTTP_TIMEOUT)
                ->withHeaders([
                    'User-Agent' => self::USER_AGENT,
                    'Accept' => 'text/html,application/xhtml+xml',
                ])
                ->withOptions(['stream' => true] + OutboundUrlGuard::httpClientOptions($url))
                ->get($url);

            if (! $response->successful()) {
                return null;
            }

            // Check content type
            $contentType = $response->header('Content-Type') ?? '';
            if (! str_contains($contentType, 'text/html') && ! str_contains($contentType, 'application/xhtml')) {
                return null;
            }

            // Read body with size limit
            $body = substr($response->body(), 0, self::MAX_BODY_SIZE);
        } catch (\Exception $e) {
            Log::debug('LinkPreviewService: fetch failed', ['url' => $url, 'error' => $e->getMessage()]);
            return null;
        }

        // Parse OG metadata ($domain already resolved above)
        $preview = $this->parseHtml($body, $url, $domain);

        if ($preview === null) {
            return null;
        }

        // YouTube / Vimeo special handling
        $preview = $this->handleVideoEmbeds($preview, $url, $domain);

        // Store in cache
        $preview['url'] = $url;
        $preview['url_hash'] = $urlHash;
        $preview['domain'] = $domain;

        $this->storePreview($preview);

        return $this->formatPreviewResponse($preview);
    }

    /**
     * Extract all URLs from a text string.
     *
     * @return string[]
     */
    public function extractUrls(string $text): array
    {
        $pattern = '/https?:\/\/[^\s<>\'")\]]+/i';

        // 🔴 Anchor hrefs come FIRST, before any tag stripping. The composer's
        // link button renders the member's own wording as the visible text, so
        // the address exists only in the href — strip_tags() discarded it and no
        // preview was ever built. Ordering also matters: an href-only link keeps
        // its position ahead of URLs written further down the post.
        $candidates = [];
        preg_match_all('/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/i', $text, $hrefMatches, PREG_SET_ORDER);
        foreach ($hrefMatches as $match) {
            $href = ($match[1] ?? '') !== '' ? $match[1] : ($match[2] ?? '');
            if ($href !== '') {
                $candidates[] = $this->decodeHtmlEntities($href);
            }
        }

        // Then the visible text. Entities are decoded AFTER stripping tags, never
        // before: decoding first would turn an escaped "&lt;a href=..." into a
        // real tag and hand an attacker a way to inject an extra candidate.
        $plainText = $this->decodeHtmlEntities(strip_tags($text));
        preg_match_all($pattern, $plainText, $matches);
        foreach ($matches[0] as $found) {
            $candidates[] = $found;
        }

        // Deduplicate, trim trailing punctuation, and keep only http(s). An href
        // can hold any scheme — javascript:, mailto:, data: — and none of those
        // may ever reach fetchPreview as a candidate.
        $urls = [];
        foreach ($candidates as $url) {
            $url = rtrim(trim($url), '.,;:!?)>');
            if ($url === '' || preg_match('/^' . substr($pattern, 1, -2) . '$/i', $url) !== 1) {
                continue;
            }
            if (! in_array($url, $urls, true)) {
                $urls[] = $url;
            }
        }

        return $urls;
    }

    /**
     * Decode HTML entities in a URL. A post stores "&" as "&amp;", which left a
     * literal "&amp;" in the extracted address and corrupted every query
     * parameter after the first. YouTube only escaped it because its video id
     * sits before the first "&".
     */
    private function decodeHtmlEntities(string $value): string
    {
        return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /**
     * Get cached link previews for a post.
     *
     * @return array[]
     */
    public function getPreviewsForPost(int $postId): array
    {
        return DB::table('post_link_previews as plp')
            ->join('link_previews as lp', 'plp.link_preview_id', '=', 'lp.id')
            ->where('plp.post_id', $postId)
            ->orderBy('plp.display_order')
            ->select([
                'lp.id',
                'lp.url',
                'lp.title',
                'lp.description',
                'lp.image_url',
                'lp.site_name',
                'lp.favicon_url',
                'lp.domain',
                'lp.content_type',
                'lp.embed_html',
            ])
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Get cached link preview for a message.
     *
     * @return array[]
     */
    public function getPreviewsForMessage(int $messageId): array
    {
        return DB::table('message_link_previews as mlp')
            ->join('link_previews as lp', 'mlp.link_preview_id', '=', 'lp.id')
            ->where('mlp.message_id', $messageId)
            ->select([
                'lp.id',
                'lp.url',
                'lp.title',
                'lp.description',
                'lp.image_url',
                'lp.site_name',
                'lp.favicon_url',
                'lp.domain',
                'lp.content_type',
                'lp.embed_html',
            ])
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Attach a link preview to a post.
     */
    public function attachPreviewToPost(int $postId, int $previewId, int $displayOrder = 0): void
    {
        DB::table('post_link_previews')->insertOrIgnore([
            'post_id' => $postId,
            'link_preview_id' => $previewId,
            'display_order' => $displayOrder,
        ]);
    }

    /**
     * Attach a link preview to a message.
     */
    public function attachPreviewToMessage(int $messageId, int $previewId): void
    {
        DB::table('message_link_previews')->insertOrIgnore([
            'message_id' => $messageId,
            'link_preview_id' => $previewId,
        ]);
    }

    /**
     * Process URLs in post content: extract, fetch previews, attach to post.
     *
     * @return array[] The link previews that were attached.
     */
    public function processPostUrls(int $postId, string $content): array
    {
        $urls = $this->extractUrls($content);
        if (empty($urls)) {
            return [];
        }

        $previews = [];
        foreach (array_slice($urls, 0, 3) as $order => $url) {
            $preview = $this->fetchPreview($url);
            if ($preview !== null) {
                // Get the preview ID from DB
                $urlHash = hash('sha256', $this->normalizeUrl($url));
                $row = DB::table('link_previews')->where('url_hash', $urlHash)->first();
                if ($row) {
                    $this->attachPreviewToPost($postId, (int) $row->id, $order);
                    $previews[] = $preview;
                }
            }
        }

        return $previews;
    }

    /**
     * Batch load link previews for multiple posts.
     *
     * @param int[] $postIds
     * @return array<int, array[]>  Keyed by post_id.
     */
    public function batchLoadPostPreviews(array $postIds): array
    {
        if (empty($postIds)) {
            return [];
        }

        $rows = DB::table('post_link_previews as plp')
            ->join('link_previews as lp', 'plp.link_preview_id', '=', 'lp.id')
            ->whereIn('plp.post_id', $postIds)
            ->orderBy('plp.display_order')
            ->select([
                'plp.post_id',
                'lp.url',
                'lp.title',
                'lp.description',
                'lp.image_url',
                'lp.site_name',
                'lp.favicon_url',
                'lp.domain',
                'lp.content_type',
                'lp.embed_html',
            ])
            ->get();

        $result = [];
        foreach ($rows as $row) {
            $postId = (int) $row->post_id;
            $preview = (array) $row;
            unset($preview['post_id']);
            $result[$postId][] = $preview;
        }

        return $result;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Check if a URL is allowed for fetching (protocol allowlist).
     */
    private function isAllowedUrl(string $url): bool
    {
        $parsed = parse_url($url);
        if (! $parsed || empty($parsed['scheme']) || empty($parsed['host'])) {
            return false;
        }

        // Only allow HTTP and HTTPS
        $scheme = strtolower($parsed['scheme']);
        return in_array($scheme, ['http', 'https'], true);
    }

    /**
     * Check if a hostname resolves to a private IP address (SSRF protection).
     */
    private function isPrivateHost(string $host): bool
    {
        // Resolve hostname to IP
        $ips = gethostbynamel($host);
        if ($ips === false) {
            // If DNS resolution fails, block for safety
            return true;
        }

        foreach ($ips as $ip) {
            if ($this->isPrivateIp($ip)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if an IP address is in a private/reserved range.
     */
    private function isPrivateIp(string $ip): bool
    {
        // Check simple prefix ranges
        foreach (self::PRIVATE_IP_RANGES as $prefix) {
            if (str_starts_with($ip, $prefix)) {
                return true;
            }
        }

        // Check CIDR ranges (172.16-31.x, 192.168.x)
        $ipLong = ip2long($ip);
        if ($ipLong === false) {
            return true; // Can't parse = block
        }

        foreach (self::PRIVATE_CIDR as [$start, $end]) {
            $startLong = ip2long($start);
            $endLong = ip2long($end);
            if ($ipLong >= $startLong && $ipLong <= $endLong) {
                return true;
            }
        }

        return false;
    }

    /**
     * Normalize a URL for consistent hashing.
     */
    private function normalizeUrl(string $url): string
    {
        $parsed = parse_url($url);
        if (! $parsed) {
            return $url;
        }

        $scheme = strtolower($parsed['scheme'] ?? 'https');
        $host = strtolower($parsed['host'] ?? '');
        $path = $parsed['path'] ?? '/';
        $query = isset($parsed['query']) ? '?' . $parsed['query'] : '';

        return $scheme . '://' . $host . $path . $query;
    }

    /**
     * Check cache for a preview by URL hash.
     */
    private function getCachedPreview(string $urlHash): ?array
    {
        $row = DB::table('link_previews')
            ->where('url_hash', $urlHash)
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
            })
            ->first();

        if (! $row) {
            return null;
        }

        return $this->formatPreviewResponse((array) $row);
    }

    /**
     * Store a preview in the cache table.
     */
    private function storePreview(array $preview): void
    {
        $expiresAt = now()->addDays(self::CACHE_DAYS);

        DB::table('link_previews')->updateOrInsert(
            ['url_hash' => $preview['url_hash']],
            [
                'url' => $preview['url'],
                'title' => $this->sanitizeText($preview['title'] ?? null, 500),
                'description' => $this->sanitizeText($preview['description'] ?? null, 2000),
                'image_url' => $preview['image_url'] ?? null,
                'site_name' => $this->sanitizeText($preview['site_name'] ?? null, 255),
                'favicon_url' => $preview['favicon_url'] ?? null,
                'domain' => $preview['domain'],
                'content_type' => $preview['content_type'] ?? 'website',
                'embed_html' => $preview['embed_html'] ?? null,
                'fetched_at' => now(),
                'expires_at' => $expiresAt,
            ]
        );
    }

    /**
     * Format a preview row for API response.
     */
    private function formatPreviewResponse(array $preview): array
    {
        return [
            'url' => $preview['url'],
            'title' => $preview['title'] ?? null,
            'description' => $preview['description'] ?? null,
            'image' => $preview['image_url'] ?? null,
            'image_url' => $preview['image_url'] ?? null,
            'siteName' => $preview['site_name'] ?? null,
            'site_name' => $preview['site_name'] ?? null,
            'favicon_url' => $preview['favicon_url'] ?? null,
            'domain' => $preview['domain'] ?? null,
            'content_type' => $preview['content_type'] ?? 'website',
            'embed_html' => $preview['embed_html'] ?? null,
        ];
    }

    /**
     * Parse HTML to extract OG metadata.
     */
    private function parseHtml(string $html, string $url, string $domain): ?array
    {
        $result = [
            'title' => null,
            'description' => null,
            'image_url' => null,
            'site_name' => null,
            'favicon_url' => null,
            'content_type' => 'website',
            'embed_html' => null,
        ];

        // Use DOMDocument for robust parsing
        $doc = new \DOMDocument();
        @$doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOERROR | LIBXML_NOWARNING);

        $metaTags = $doc->getElementsByTagName('meta');

        foreach ($metaTags as $meta) {
            $property = $meta->getAttribute('property') ?: $meta->getAttribute('name');
            $content = $meta->getAttribute('content');

            if (! $property || ! $content) {
                continue;
            }

            switch ($property) {
                case 'og:title':
                    $result['title'] = $content;
                    break;
                case 'og:description':
                    $result['description'] = $content;
                    break;
                case 'og:image':
                    $result['image_url'] = $this->resolveUrl($content, $url);
                    break;
                case 'og:site_name':
                    $result['site_name'] = $content;
                    break;
                case 'og:type':
                    $result['content_type'] = $content;
                    break;
                case 'description':
                    // Fallback: <meta name="description">
                    if (! $result['description']) {
                        $result['description'] = $content;
                    }
                    break;
                // Twitter Card fallbacks (used by X/Twitter and many sites without OG tags)
                case 'twitter:title':
                    if (! $result['title']) {
                        $result['title'] = $content;
                    }
                    break;
                case 'twitter:description':
                    if (! $result['description']) {
                        $result['description'] = $content;
                    }
                    break;
                case 'twitter:image':
                case 'twitter:image:src':
                    if (! $result['image_url']) {
                        $result['image_url'] = $this->resolveUrl($content, $url);
                    }
                    break;
                case 'twitter:site':
                    if (! $result['site_name']) {
                        $result['site_name'] = $content;
                    }
                    break;
            }
        }

        // Fallback: <title> tag
        if (! $result['title']) {
            $titleTags = $doc->getElementsByTagName('title');
            if ($titleTags->length > 0) {
                $result['title'] = $titleTags->item(0)->textContent;
            }
        }

        // If we still have no title, this page has no useful metadata
        if (! $result['title']) {
            return null;
        }

        // Extract favicon
        $result['favicon_url'] = $this->extractFavicon($doc, $url);

        return $result;
    }

    /**
     * Extract favicon URL from HTML document.
     */
    private function extractFavicon(\DOMDocument $doc, string $baseUrl): ?string
    {
        $linkTags = $doc->getElementsByTagName('link');

        foreach ($linkTags as $link) {
            $rel = strtolower($link->getAttribute('rel'));
            if (in_array($rel, ['icon', 'shortcut icon', 'apple-touch-icon'], true)) {
                $href = $link->getAttribute('href');
                if ($href) {
                    return $this->resolveUrl($href, $baseUrl);
                }
            }
        }

        // Fallback: /favicon.ico
        $parsed = parse_url($baseUrl);
        if ($parsed && isset($parsed['scheme'], $parsed['host'])) {
            return $parsed['scheme'] . '://' . $parsed['host'] . '/favicon.ico';
        }

        return null;
    }

    /**
     * Resolve a potentially relative URL against a base URL.
     */
    private function resolveUrl(string $relative, string $base): string
    {
        // Already absolute
        if (preg_match('#^https?://#i', $relative)) {
            return $relative;
        }

        // Protocol-relative
        if (str_starts_with($relative, '//')) {
            $parsed = parse_url($base);
            return ($parsed['scheme'] ?? 'https') . ':' . $relative;
        }

        // Absolute path
        $parsed = parse_url($base);
        $origin = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');

        if (str_starts_with($relative, '/')) {
            return $origin . $relative;
        }

        // Relative path
        $basePath = isset($parsed['path']) ? dirname($parsed['path']) : '/';
        return $origin . rtrim($basePath, '/') . '/' . $relative;
    }

    /**
     * Merge a provider media embed into a scraped preview. Defensive: the
     * provider short-circuit in fetchPreview normally handles these before any
     * scrape, so this only fires if a provider page was somehow scraped.
     */
    private function handleVideoEmbeds(array $preview, string $url, string $domain): array
    {
        $embed = $this->videoEmbedFor($url, $domain);
        if ($embed === null) {
            return $preview;
        }

        $preview['content_type'] = 'video';
        $preview['embed_html']   = $embed['embed_html'];
        if (empty($preview['image_url']) && ! empty($embed['image_url'])) {
            $preview['image_url'] = $embed['image_url'];
        }
        if (empty($preview['site_name']) && ! empty($embed['site_name'])) {
            $preview['site_name'] = $embed['site_name'];
        }

        return $preview;
    }

    /**
     * Build an inline-player embed for a known media provider, purely from the
     * URL — no outbound fetch. Providers: YouTube, Vimeo, Spotify, SoundCloud,
     * Twitch, TikTok. Returns embed fields, or null if not a known provider or
     * the URL carries no embeddable id.
     *
     * `embed_html` holds the iframe *src* (the frontend builds the <iframe>).
     * Twitch requires a `&parent=<host>` param appended client-side.
     *
     * @return array{content_type:string,embed_html:string,image_url:?string,site_name:string}|null
     */
    private function videoEmbedFor(string $url, string $domain): ?array
    {
        // YouTube
        if ($this->domainMatches($domain, ['youtube.com', 'youtu.be', 'youtube-nocookie.com'])) {
            $id = $this->extractYouTubeVideoId($url);
            if ($id !== null) {
                return [
                    'content_type' => 'video',
                    'embed_html'   => 'https://www.youtube-nocookie.com/embed/' . $id,
                    'image_url'    => 'https://img.youtube.com/vi/' . $id . '/hqdefault.jpg',
                    'site_name'    => 'YouTube',
                ];
            }
        }

        // Vimeo
        if ($this->domainMatches($domain, ['vimeo.com'])) {
            $id = $this->extractVimeoVideoId($url);
            if ($id !== null) {
                return [
                    'content_type' => 'video',
                    'embed_html'   => 'https://player.vimeo.com/video/' . $id,
                    'image_url'    => null,
                    'site_name'    => 'Vimeo',
                ];
            }
        }

        // Spotify (track / album / playlist / episode / show / artist)
        if ($this->domainMatches($domain, ['spotify.com'])
            && preg_match('#spotify\.com/(?:embed/)?(track|album|playlist|episode|show|artist)/([A-Za-z0-9]+)#i', $url, $m)) {
            return [
                'content_type' => 'video',
                'embed_html'   => 'https://open.spotify.com/embed/' . strtolower($m[1]) . '/' . $m[2],
                'image_url'    => null,
                'site_name'    => 'Spotify',
            ];
        }

        // SoundCloud — the player embeds any track/set by its full URL.
        // (delimiter is ~ because the pattern contains a literal # in [^/?#])
        if ($this->domainMatches($domain, ['soundcloud.com'])
            && preg_match('~^https?://[^/]*soundcloud\.com/[^/]+/[^/?#]+~i', $url)) {
            return [
                'content_type' => 'video',
                'embed_html'   => 'https://w.soundcloud.com/player/?url=' . rawurlencode($url) . '&color=%23ff5500',
                'image_url'    => null,
                'site_name'    => 'SoundCloud',
            ];
        }

        // Twitch (VOD / clip / live channel) — frontend appends &parent=<host>.
        if ($this->domainMatches($domain, ['twitch.tv'])) {
            $src = null;
            if (preg_match('#twitch\.tv/videos/(\d+)#i', $url, $m)) {
                $src = 'https://player.twitch.tv/?video=' . $m[1];
            } elseif (preg_match('#clips\.twitch\.tv/([A-Za-z0-9_-]+)#i', $url, $m)
                   || preg_match('#twitch\.tv/[^/]+/clip/([A-Za-z0-9_-]+)#i', $url, $m)) {
                $src = 'https://clips.twitch.tv/embed?clip=' . $m[1];
            } elseif (preg_match('#twitch\.tv/([A-Za-z0-9_]{2,25})/?(?:$|\?)#i', $url, $m)) {
                $src = 'https://player.twitch.tv/?channel=' . $m[1];
            }
            if ($src !== null) {
                return [
                    'content_type' => 'video',
                    'embed_html'   => $src,
                    'image_url'    => null,
                    'site_name'    => 'Twitch',
                ];
            }
        }

        // TikTok
        if ($this->domainMatches($domain, ['tiktok.com'])
            && preg_match('#tiktok\.com/(?:@[^/]+/video|v|embed/v2)/(\d+)#i', $url, $m)) {
            return [
                'content_type' => 'video',
                'embed_html'   => 'https://www.tiktok.com/embed/v2/' . $m[1],
                'image_url'    => null,
                'site_name'    => 'TikTok',
            ];
        }

        return null;
    }

    /**
     * True if $domain equals one of $suffixes or is a subdomain of it.
     *
     * @param string[] $suffixes
     */
    private function domainMatches(string $domain, array $suffixes): bool
    {
        $domain = strtolower($domain);
        foreach ($suffixes as $suffix) {
            if ($domain === $suffix || str_ends_with($domain, '.' . $suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Extract Vimeo video ID from URL.
     */
    private function extractVimeoVideoId(string $url): ?string
    {
        if (preg_match('/vimeo\.com\/(\d+)/', $url, $matches)) {
            return $matches[1];
        }

        return null;
    }

    /**
     * Extract YouTube video ID from various URL formats.
     */
    private function extractYouTubeVideoId(string $url): ?string
    {
        $patterns = [
            '/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/',
            '/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $url, $matches)) {
                return $matches[1];
            }
        }

        return null;
    }

    /**
     * Sanitize text by stripping HTML tags and limiting length.
     */
    private function sanitizeText(?string $text, int $maxLength): ?string
    {
        if ($text === null) {
            return null;
        }

        // Strip HTML tags
        $text = strip_tags($text);

        // Decode HTML entities
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // Trim whitespace
        $text = trim($text);

        // Limit length
        if (mb_strlen($text) > $maxLength) {
            $text = mb_substr($text, 0, $maxLength);
        }

        return $text ?: null;
    }
}
