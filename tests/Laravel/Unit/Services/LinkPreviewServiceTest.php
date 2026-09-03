<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\LinkPreviewService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * Unit tests for LinkPreviewService — URL extraction, HTML parsing, caching, SSRF protection.
 */
class LinkPreviewServiceTest extends TestCase
{
    private LinkPreviewService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new LinkPreviewService();
    }

    // ------------------------------------------------------------------
    //  extractUrls()
    // ------------------------------------------------------------------

    public function test_extractUrls_extracts_single_http_url(): void
    {
        $result = $this->service->extractUrls('Check out https://example.com for more info.');
        $this->assertCount(1, $result);
        $this->assertEquals('https://example.com', $result[0]);
    }

    public function test_extractUrls_extracts_multiple_urls(): void
    {
        $text = 'Visit https://example.com and http://test.org for details.';
        $result = $this->service->extractUrls($text);
        $this->assertCount(2, $result);
        $this->assertEquals('https://example.com', $result[0]);
        $this->assertEquals('http://test.org', $result[1]);
    }

    public function test_extractUrls_deduplicates_urls(): void
    {
        $text = 'Visit https://example.com and also https://example.com again.';
        $result = $this->service->extractUrls($text);
        $this->assertCount(1, $result);
    }

    public function test_extractUrls_strips_trailing_punctuation(): void
    {
        $text = 'See https://example.com/page. Also https://test.org/path, and https://foo.com!';
        $result = $this->service->extractUrls($text);
        $this->assertEquals('https://example.com/page', $result[0]);
        $this->assertEquals('https://test.org/path', $result[1]);
        $this->assertEquals('https://foo.com', $result[2]);
    }

    public function test_extractUrls_returns_empty_for_text_without_urls(): void
    {
        $result = $this->service->extractUrls('No URLs in this text at all.');
        $this->assertCount(0, $result);
    }

    public function test_extractUrls_strips_html_tags_before_extraction(): void
    {
        $html = '<p>Check <a href="https://example.com">https://example.com</a></p>';
        $result = $this->service->extractUrls($html);
        $this->assertCount(1, $result);
        $this->assertEquals('https://example.com', $result[0]);
    }

    public function test_extractUrls_handles_url_with_query_parameters(): void
    {
        $text = 'Visit https://example.com/search?q=test&page=1 for results.';
        $result = $this->service->extractUrls($text);
        $this->assertCount(1, $result);
        $this->assertStringContainsString('q=test', $result[0]);
    }

    public function test_extractUrls_handles_url_with_path(): void
    {
        $text = 'Read https://example.com/blog/my-article today.';
        $result = $this->service->extractUrls($text);
        $this->assertCount(1, $result);
        $this->assertEquals('https://example.com/blog/my-article', $result[0]);
    }

    /**
     * 🔴 The composer's link button produces an anchor whose visible text is the
     * member's own wording, so the address exists ONLY in the href. Stripping
     * tags first threw it away and no preview was ever built — a YouTube link
     * inserted that way rendered as plain words with no player, and the failure
     * was invisible because createPostV2 logs preview errors at debug level.
     */
    public function test_extractUrls_finds_a_url_that_only_exists_in_an_anchor_href(): void
    {
        $html = '<p><a href="https://www.youtube.com/watch?v=k0Flh6cuuWs">Watch this</a></p>';
        $result = $this->service->extractUrls($html);
        $this->assertSame(['https://www.youtube.com/watch?v=k0Flh6cuuWs'], $result);
    }

    /** An href and matching visible text must still yield ONE url, not two. */
    public function test_extractUrls_deduplicates_a_url_present_in_both_href_and_text(): void
    {
        $html = '<p><a href="https://example.com/a">https://example.com/a</a></p>';
        $this->assertSame(['https://example.com/a'], $this->service->extractUrls($html));
    }

    /**
     * HTML-encoded ampersands survived extraction, so the stored url held a
     * literal "&amp;" and every query parameter after the first was wrong.
     * YouTube only escaped this by luck: its video id sits before the first "&".
     */
    public function test_extractUrls_decodes_html_entities_inside_urls(): void
    {
        $html = '<p>https://example.com/search?q=test&amp;page=2</p>';
        $result = $this->service->extractUrls($html);
        $this->assertSame(['https://example.com/search?q=test&page=2'], $result);
        $this->assertStringNotContainsString('&amp;', $result[0]);
    }

    /** A javascript: href must never be promoted into a preview candidate. */
    public function test_extractUrls_ignores_non_http_anchor_hrefs(): void
    {
        $html = '<p><a href="javascript:alert(1)">click</a><a href="mailto:a@b.test">mail</a></p>';
        $this->assertSame([], $this->service->extractUrls($html));
    }

    // ------------------------------------------------------------------
    //  fetchPreview() — cache and SSRF protection
    // ------------------------------------------------------------------

    public function test_fetchPreview_returns_null_for_non_http_scheme(): void
    {
        $result = $this->service->fetchPreview('ftp://example.com/file');
        $this->assertNull($result);
    }

    public function test_fetchPreview_returns_null_for_empty_url(): void
    {
        $result = $this->service->fetchPreview('');
        $this->assertNull($result);
    }

    public function test_fetchPreview_returns_null_for_url_without_host(): void
    {
        $result = $this->service->fetchPreview('https://');
        $this->assertNull($result);
    }

    /**
     * 🔴 This asserted caching but silently depended on LIVE DNS, so it passed
     * in CI and failed on any machine without outbound resolution — including
     * the dev container, which made the pre-commit gate unusable for anyone
     * editing this file. `fetchPreview()` runs `OutboundUrlGuard::isSafeHttpUrl()`
     * FIRST, and that resolves the host to check it is not a private address; a
     * failed lookup returns false, so the method returned null before the mocked
     * cache was ever consulted and the failure looked like a caching bug.
     *
     * A public IP literal skips resolution entirely (the guard only range-checks
     * it), which is what makes this a real unit test. `domain` still comes from
     * the cached row, not the URL, so the assertion below is unchanged.
     */
    public function test_fetchPreview_returns_cached_data_when_available(): void
    {
        $urlHash = hash('sha256', 'https://93.184.216.34/');

        $cachedRow = (object) [
            'url' => 'https://93.184.216.34/',
            'title' => 'Cached Title',
            'description' => 'Cached description',
            'image_url' => 'https://example.com/img.jpg',
            'site_name' => 'Example',
            'favicon_url' => 'https://example.com/favicon.ico',
            'domain' => 'example.com',
            'content_type' => 'website',
            'embed_html' => null,
        ];

        DB::shouldReceive('table->where->where->first')
            ->once()
            ->andReturn($cachedRow);

        $result = $this->service->fetchPreview('https://93.184.216.34/');
        $this->assertNotNull($result);
        $this->assertEquals('Cached Title', $result['title']);
        // Read back off the cached row, not derived from the URL — which is why
        // swapping the request URL for an IP literal does not weaken this.
        $this->assertEquals('example.com', $result['domain']);
    }

    public function test_fetchPreview_returns_null_for_file_protocol(): void
    {
        $result = $this->service->fetchPreview('file:///etc/passwd');
        $this->assertNull($result);
    }

    public function test_fetchPreview_returns_null_for_javascript_protocol(): void
    {
        $result = $this->service->fetchPreview('javascript:alert(1)');
        $this->assertNull($result);
    }

    public function test_fetchPreview_returns_null_for_data_protocol(): void
    {
        $result = $this->service->fetchPreview('data:text/html,<h1>Hi</h1>');
        $this->assertNull($result);
    }

    // ------------------------------------------------------------------
    //  getPreviewsForPost()
    // ------------------------------------------------------------------

    public function test_getPreviewsForPost_returns_array(): void
    {
        $previewRow = (object) [
            'id' => 1,
            'url' => 'https://example.com',
            'title' => 'Example',
            'description' => 'Desc',
            'image_url' => null,
            'site_name' => 'Example',
            'favicon_url' => null,
            'domain' => 'example.com',
            'content_type' => 'website',
            'embed_html' => null,
        ];

        $collection = collect([$previewRow]);

        DB::shouldReceive('table->join->where->orderBy->select->get')
            ->once()
            ->andReturn($collection);

        $result = $this->service->getPreviewsForPost(1);
        $this->assertCount(1, $result);
        $this->assertEquals('https://example.com', $result[0]['url']);
    }

    // ------------------------------------------------------------------
    //  getPreviewsForMessage()
    // ------------------------------------------------------------------

    public function test_getPreviewsForMessage_returns_array(): void
    {
        $previewRow = (object) [
            'id' => 1,
            'url' => 'https://example.com',
            'title' => 'Example',
            'description' => 'Desc',
            'image_url' => null,
            'site_name' => 'Example',
            'favicon_url' => null,
            'domain' => 'example.com',
            'content_type' => 'website',
            'embed_html' => null,
        ];

        $collection = collect([$previewRow]);

        DB::shouldReceive('table->join->where->select->get')
            ->once()
            ->andReturn($collection);

        $result = $this->service->getPreviewsForMessage(42);
        $this->assertCount(1, $result);
        $this->assertEquals('Example', $result[0]['title']);
    }

    // ------------------------------------------------------------------
    //  attachPreviewToPost()
    // ------------------------------------------------------------------

    public function test_attachPreviewToPost_inserts_record(): void
    {
        DB::shouldReceive('table->insertOrIgnore')
            ->once()
            ->with([
                'post_id' => 10,
                'link_preview_id' => 5,
                'display_order' => 0,
            ])
            ->andReturn(1);

        $this->service->attachPreviewToPost(10, 5, 0);
        // No exception = pass
        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  attachPreviewToMessage()
    // ------------------------------------------------------------------

    public function test_attachPreviewToMessage_inserts_record(): void
    {
        DB::shouldReceive('table->insertOrIgnore')
            ->once()
            ->with([
                'message_id' => 20,
                'link_preview_id' => 3,
            ])
            ->andReturn(1);

        $this->service->attachPreviewToMessage(20, 3);
        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  batchLoadPostPreviews()
    // ------------------------------------------------------------------

    public function test_batchLoadPostPreviews_returns_empty_for_empty_input(): void
    {
        $result = $this->service->batchLoadPostPreviews([]);
        $this->assertEmpty($result);
    }

    public function test_batchLoadPostPreviews_groups_by_post_id(): void
    {
        $row1 = (object) [
            'post_id' => 10,
            'url' => 'https://a.com',
            'title' => 'A',
            'description' => null,
            'image_url' => null,
            'site_name' => null,
            'favicon_url' => null,
            'domain' => 'a.com',
            'content_type' => 'website',
            'embed_html' => null,
        ];
        $row2 = (object) [
            'post_id' => 20,
            'url' => 'https://b.com',
            'title' => 'B',
            'description' => null,
            'image_url' => null,
            'site_name' => null,
            'favicon_url' => null,
            'domain' => 'b.com',
            'content_type' => 'website',
            'embed_html' => null,
        ];

        $collection = collect([$row1, $row2]);

        DB::shouldReceive('table->join->whereIn->orderBy->select->get')
            ->once()
            ->andReturn($collection);

        $result = $this->service->batchLoadPostPreviews([10, 20]);
        $this->assertArrayHasKey(10, $result);
        $this->assertArrayHasKey(20, $result);
        $this->assertCount(1, $result[10]);
        $this->assertEquals('A', $result[10][0]['title']);
    }

    // ------------------------------------------------------------------
    //  processPostUrls()
    // ------------------------------------------------------------------

    public function test_processPostUrls_returns_empty_when_no_urls(): void
    {
        $result = $this->service->processPostUrls(1, 'No links here.');
        $this->assertEmpty($result);
    }

    // ------------------------------------------------------------------
    //  Protocol allowlist (SSRF protection)
    // ------------------------------------------------------------------

    public function test_fetchPreview_blocks_malformed_url(): void
    {
        $result = $this->service->fetchPreview('://missing-scheme.com');
        $this->assertNull($result);
    }

    public function test_fetchPreview_blocks_url_without_scheme(): void
    {
        $result = $this->service->fetchPreview('example.com');
        $this->assertNull($result);
    }
}
