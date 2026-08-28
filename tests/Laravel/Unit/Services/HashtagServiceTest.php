<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\HashtagService;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

class HashtagServiceTest extends TestCase
{
    // ─── extractHashtags ─────────────────────────────────────────

    public function test_extractHashtags_empty_string_returns_empty_array(): void
    {
        $this->assertSame([], HashtagService::extractHashtags(''));
    }

    public function test_extractHashtags_no_hashtags_returns_empty(): void
    {
        $this->assertSame([], HashtagService::extractHashtags('Hello world'));
    }

    public function test_extractHashtags_extracts_valid_tags(): void
    {
        $result = HashtagService::extractHashtags('Check out #gardening and #cooking tips');
        $this->assertContains('gardening', $result);
        $this->assertContains('cooking', $result);
        $this->assertCount(2, $result);
    }

    public function test_extractHashtags_deduplicates_and_lowercases(): void
    {
        $result = HashtagService::extractHashtags('#Gardening #GARDENING #gardening');
        $this->assertSame(['gardening'], $result);
    }

    public function test_extractHashtags_ignores_single_char_tags(): void
    {
        $result = HashtagService::extractHashtags('#a #bc');
        $this->assertSame(['bc'], $result);
    }

    public function test_extractHashtags_allows_hyphens_and_underscores(): void
    {
        $result = HashtagService::extractHashtags('#dog-walking #cat_sitting');
        $this->assertContains('dog-walking', $result);
        $this->assertContains('cat_sitting', $result);
    }

    // ─── extractTags (alias) ─────────────────────────────────────

    public function test_extractTags_is_alias_for_extractHashtags(): void
    {
        $result = HashtagService::extractTags('#hello #world');
        $this->assertContains('hello', $result);
        $this->assertContains('world', $result);
    }

    // ─── getTrending ─────────────────────────────────────────────

    public function test_getTrending_returns_array_of_tag_counts(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) ['tag' => 'gardening', 'usage_count' => 5],
            (object) ['tag' => 'cooking', 'usage_count' => 3],
        ]);

        $result = HashtagService::getTrending(10, 7);
        $this->assertCount(2, $result);
        $this->assertSame('gardening', $result[0]['tag']);
    }

    public function test_getTrending_returns_empty_on_error(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('Table not found'));

        $result = HashtagService::getTrending();
        $this->assertSame([], $result);
    }

    // ─── getPopular ──────────────────────────────────────────────

    public function test_getPopular_returns_array_of_tag_counts(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) ['tag' => 'timebank', 'usage_count' => 100],
        ]);

        $result = HashtagService::getPopular(20);
        $this->assertCount(1, $result);
        $this->assertSame('timebank', $result[0]['tag']);
    }

    public function test_getPopular_returns_empty_on_error(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('Error'));
        $this->assertSame([], HashtagService::getPopular());
    }

    // ─── search ──────────────────────────────────────────────────

    public function test_search_strips_hash_prefix(): void
    {
        DB::shouldReceive('select')->once()->andReturn([]);

        $result = HashtagService::search('#garden', 10);
        $this->assertSame([], $result);
    }

    public function test_search_returns_empty_on_error(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('Error'));
        $this->assertSame([], HashtagService::search('test'));
    }

    // ─── getPostHashtags ─────────────────────────────────────────

    public function test_getPostHashtags_returns_tags_for_post(): void
    {
        DB::shouldReceive('table')->with('post_hashtags')->andReturnSelf();
        DB::shouldReceive('where')->with('post_id', 1)->andReturnSelf();
        DB::shouldReceive('pluck')->with('tag')->andReturn(collect(['tag1', 'tag2']));

        $result = HashtagService::getPostHashtags(1);
        $this->assertSame(['tag1', 'tag2'], $result);
    }

    public function test_getPostHashtags_returns_empty_on_error(): void
    {
        DB::shouldReceive('table')->andThrow(new \Exception('Error'));
        $this->assertSame([], HashtagService::getPostHashtags(999));
    }

    // ─── getBatchPostHashtags ────────────────────────────────────

    public function test_getBatchPostHashtags_empty_ids_returns_empty(): void
    {
        $this->assertSame([], HashtagService::getBatchPostHashtags([]));
    }

    public function test_getBatchPostHashtags_groups_by_post_id(): void
    {
        DB::shouldReceive('table')->with('post_hashtags')->andReturnSelf();
        DB::shouldReceive('whereIn')->with('post_id', [1, 2])->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([
            (object) ['post_id' => 1, 'tag' => 'tag1'],
            (object) ['post_id' => 1, 'tag' => 'tag2'],
            (object) ['post_id' => 2, 'tag' => 'tag3'],
        ]));

        $result = HashtagService::getBatchPostHashtags([1, 2]);
        $this->assertArrayHasKey(1, $result);
        $this->assertArrayHasKey(2, $result);
        $this->assertCount(2, $result[1]);
        $this->assertCount(1, $result[2]);
    }

    public function test_getBatchPostHashtags_returns_empty_on_error(): void
    {
        DB::shouldReceive('table')->andThrow(new \Exception('Error'));
        $this->assertSame([], HashtagService::getBatchPostHashtags([1]));
    }
}
