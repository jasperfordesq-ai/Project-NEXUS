<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\KnowledgeBaseService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class KnowledgeBaseServiceTest extends TestCase
{
    private KnowledgeBaseService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new KnowledgeBaseService();
    }

    public function test_getAll_returns_paginated_structure(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->getAll();

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertFalse($result['has_more']);
    }

    public function test_getById_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertNull($this->service->getById(999));
    }

    public function test_delete_with_children_returns_false(): void
    {
        DB::shouldReceive('table')->with('knowledge_base_articles')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(3);

        $result = $this->service->delete(1);
        $this->assertFalse($result);
        $this->assertSame('CONFLICT', $this->service->getErrors()[0]['code']);
    }

    public function test_delete_no_children_succeeds(): void
    {
        // All table/where calls return self; count returns 0, delete returns 0 then 1
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(0);
        DB::shouldReceive('delete')->andReturn(0, 1);

        $this->assertTrue($this->service->delete(1));
    }

    public function test_submitFeedback_article_not_found_returns_false(): void
    {
        DB::shouldReceive('table')->with('knowledge_base_articles')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('exists')->andReturn(false);

        $this->assertFalse($this->service->submitFeedback(999, 1, true));
    }

    public function test_submitFeedback_new_feedback_increments_counter(): void
    {
        // Article exists
        DB::shouldReceive('table')->with('knowledge_base_articles')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('exists')->andReturn(true);

        // No existing feedback
        DB::shouldReceive('table')->with('knowledge_base_feedback')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        // Insert new feedback
        DB::shouldReceive('table')->with('knowledge_base_feedback')->andReturnSelf();
        DB::shouldReceive('insert')->once();

        // Increment
        DB::shouldReceive('table')->with('knowledge_base_articles')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('increment')->with('helpful_yes');

        $this->assertTrue($this->service->submitFeedback(1, 1, true));
    }

    public function test_create_auto_generates_slug(): void
    {
        DB::shouldReceive('table')->with('knowledge_base_articles')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('exists')->andReturn(false);
        DB::shouldReceive('insertGetId')->once()->andReturn(10);

        $id = $this->service->create(1, ['title' => 'My Article', 'content' => 'Body text']);
        $this->assertSame(10, $id);
    }

    public function test_search_returns_results(): void
    {
        DB::shouldReceive('raw')->andReturnUsing(fn ($v) => new \Illuminate\Database\Query\Expression($v));
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderByRaw')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        // search() adds the relevance rank with selectRaw() as well as select().
        // Without this the mock throws BadMethodCallException rather than failing
        // an assertion, so the error looks unrelated to the query being built.
        DB::shouldReceive('selectRaw')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->search('test');
        $this->assertSame([], $result);
    }
}
