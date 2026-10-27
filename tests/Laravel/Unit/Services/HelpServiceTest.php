<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\HelpService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class HelpServiceTest extends TestCase
{
    private HelpService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new HelpService();
    }

    public function test_getFaqs_returns_grouped_by_category(): void
    {
        DB::shouldReceive('table')->with('help_faqs')->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', 2)->andReturnSelf();
        DB::shouldReceive('where')->with('is_published', 1)->andReturnSelf();
        DB::shouldReceive('orderBy')->with('category')->andReturnSelf();
        DB::shouldReceive('orderBy')->with('sort_order')->andReturnSelf();
        DB::shouldReceive('orderBy')->with('id')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([
            (object) ['id' => 1, 'question' => 'What is TB?', 'answer' => 'Timebanking', 'category' => 'Getting Started'],
            (object) ['id' => 2, 'question' => 'How?', 'answer' => 'Easy', 'category' => 'Getting Started'],
        ]));

        $result = $this->service->getFaqs(2);

        $this->assertCount(1, $result);
        $this->assertSame('Getting Started', $result[0]['category']);
        $this->assertCount(2, $result[0]['faqs']);
        $this->assertSame(1, $result[0]['faqs'][0]['id']);
    }

    public function test_getFaqs_falls_back_to_global_when_tenant_empty(): void
    {
        // First call for tenant_id=2 returns empty
        DB::shouldReceive('table')->with('help_faqs')->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', 2)->andReturnSelf();
        DB::shouldReceive('where')->with('is_published', 1)->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('get')->once()->andReturn(collect([]));

        // Fallback call for tenant_id=0
        DB::shouldReceive('table')->with('help_faqs')->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', 0)->andReturnSelf();
        DB::shouldReceive('where')->with('is_published', 1)->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('get')->once()->andReturn(collect([
            (object) ['id' => 10, 'question' => 'Global FAQ', 'answer' => 'Answer', 'category' => 'General'],
        ]));

        $result = $this->service->getFaqs(2);

        $this->assertCount(1, $result);
        $this->assertSame('General', $result[0]['category']);
    }

    public function test_getFaqs_with_search_filter(): void
    {
        DB::shouldReceive('table')->with('help_faqs')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([
            (object) ['id' => 1, 'question' => 'Credits?', 'answer' => 'Time credits', 'category' => null],
        ]));

        $result = $this->service->getFaqs(2, null, 'credits');

        $this->assertCount(1, $result);
        $this->assertSame('General', $result[0]['category']);
    }

    public function test_getFaqs_with_category_filter_does_not_fallback(): void
    {
        DB::shouldReceive('table')->with('help_faqs')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('get')->once()->andReturn(collect([]));

        $result = $this->service->getFaqs(2, 5);

        // No fallback when category filter is set
        $this->assertSame([], $result);
    }

    /**
     * React dbf875e5: FAQ answers are admin-authored HTML, so a search must
     * match what a member can read, never the markup ("strong", "href").
     */
    private function mockFaqRows(array $rows): void
    {
        DB::shouldReceive('table')->with('help_faqs')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect($rows));
    }

    public function test_search_does_not_match_html_markup_in_answers(): void
    {
        $this->mockFaqRows([
            (object) ['id' => 1, 'question' => 'Formatting', 'answer' => '<p><strong>Bold</strong> and <a href="https://example.org">a link</a></p>', 'category' => 'General'],
        ]);

        $this->assertSame([], $this->service->getFaqs(2, null, 'strong'));
    }

    public function test_search_ignores_link_targets_and_attributes(): void
    {
        $this->mockFaqRows([
            (object) ['id' => 1, 'question' => 'Links', 'answer' => '<a href="https://example.org/wallet">Read more</a>', 'category' => 'General'],
        ]);

        $this->assertSame([], $this->service->getFaqs(2, null, 'href'));
        $this->assertSame([], $this->service->getFaqs(2, null, 'wallet'));
    }

    public function test_search_matches_visible_answer_text_case_insensitively(): void
    {
        $this->mockFaqRows([
            (object) ['id' => 1, 'question' => 'Formatting', 'answer' => '<p><strong>Bold</strong> text</p>', 'category' => 'General'],
            (object) ['id' => 2, 'question' => 'Other', 'answer' => '<p>Nothing here</p>', 'category' => 'General'],
        ]);

        $result = $this->service->getFaqs(2, null, 'BOLD TEXT');

        $this->assertCount(1, $result);
        $this->assertSame([1], array_column($result[0]['faqs'], 'id'));
        // The answer itself is returned untouched, markup and all.
        $this->assertSame('<p><strong>Bold</strong> text</p>', $result[0]['faqs'][0]['answer']);
    }

    public function test_search_matches_decoded_entities_and_the_question(): void
    {
        $this->mockFaqRows([
            (object) ['id' => 1, 'question' => 'Fees &amp; costs', 'answer' => '<p>None</p>', 'category' => 'General'],
            (object) ['id' => 2, 'question' => 'Rules', 'answer' => '<p>Give &amp; take</p>', 'category' => 'General'],
        ]);

        $result = $this->service->getFaqs(2, null, '&');

        $this->assertSame([1, 2], array_column($result[0]['faqs'], 'id'));
    }

    public function test_search_does_not_merge_words_across_tags(): void
    {
        $this->mockFaqRows([
            (object) ['id' => 1, 'question' => 'List', 'answer' => '<li>first</li><li>second</li>', 'category' => 'General'],
        ]);

        $this->assertSame([], $this->service->getFaqs(2, null, 'firstsecond'));
    }
}
