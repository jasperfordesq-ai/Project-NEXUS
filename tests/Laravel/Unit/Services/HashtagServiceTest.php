<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\HashtagService;
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
}
