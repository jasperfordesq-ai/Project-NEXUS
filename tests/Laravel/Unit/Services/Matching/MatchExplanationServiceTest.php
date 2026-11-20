<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Matching;

use Tests\Laravel\TestCase;
use App\Services\Matching\MatchExplanationService;
use Illuminate\Support\Facades\DB;

/** Test double: overrides the provider seam instead of mocking statics. */
class FakeExplanationService extends MatchExplanationService
{
    public array $llmResponse = ['entries' => [], 'tokens_in' => 0, 'tokens_out' => 0];
    public bool $enabled = true;
    public int $llmCalls = 0;

    protected function aiEnabled(): bool
    {
        return $this->enabled;
    }

    /** @var array<int, array<string, mixed>> what the service last sent to the provider */
    public array $lastItems = [];

    protected function callLlm(array $items): array
    {
        $this->lastItems = $items;
        $this->llmCalls++;
        return $this->llmResponse;
    }
}

class MatchExplanationServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $prop = new \ReflectionProperty(\App\Core\TenantContext::class, 'cachedId');
        $prop->setAccessible(true);
        $prop->setValue(null, 7);
    }

    protected function tearDown(): void
    {
        \App\Core\TenantContext::reset();
        parent::tearDown();
    }

    private function cacheRow(): object
    {
        return (object) [
            'id' => 1, 'listing_id' => 5, 'match_score' => 82.0,
            'match_reasons' => json_encode(['Same category: Gardening']),
            'distance_km' => 3.4, 'title' => 'Need hedge trimming',
            'description' => 'Overgrown hedges', 'service_type' => 'physical_only',
            // The member's listing this match is FOR, as the engine stored it.
            'score_breakdown' => json_encode(['matched_listing' => 'Gardening offered']),
        ];
    }

    public function test_disabled_ai_makes_no_llm_calls_and_no_writes(): void
    {
        $service = new FakeExplanationService();
        $service->enabled = false;

        DB::shouldReceive('select')->never();
        DB::shouldReceive('update')->never();

        $result = $service->generateForUser(42);

        $this->assertSame(0, $result['explained']);
        $this->assertSame(0, $service->llmCalls);
    }

    public function test_writes_truncated_explanation_and_clamps_rerank_delta(): void
    {
        $service = new FakeExplanationService();
        $service->llmResponse = [
            'entries' => [[
                'listing_id' => 5,
                'rerank_delta' => 99,                       // must clamp to +5
                'explanation' => str_repeat('x', 500),      // must truncate to 220
            ]],
            'tokens_in' => 100, 'tokens_out' => 50,
        ];

        DB::shouldReceive('select')->once()->andReturn([$this->cacheRow()]);
        DB::shouldReceive('update')->once()->withArgs(function ($sql, $bindings) {
            return str_contains($sql, 'match_cache')
                && strlen($bindings[0]) === 220             // truncated explanation
                && abs(((float) $bindings[1]) - 5.0) < 0.001 // clamped delta
                && (int) $bindings[4] === 5;                 // listing_id
        })->andReturn(1);

        $result = $service->generateForUser(42);

        $this->assertSame(1, $result['explained']);
        $this->assertSame(100, $result['tokens_in']);
    }

    public function test_the_ai_can_mark_a_poor_match_well_down_but_a_good_one_up_only_a_little(): void
    {
        // On live (20 Nov 2026) the AI wrote "has little to do with your
        // listing" about matches it could only move by 5, so they stayed.
        $service = new FakeExplanationService();
        $service->llmResponse = [
            'entries' => [['listing_id' => 5, 'rerank_delta' => -40, 'explanation' => 'Not about the same thing.']],
            'tokens_in' => 1, 'tokens_out' => 1,
        ];

        DB::shouldReceive('select')->once()->andReturn([$this->cacheRow()]);
        DB::shouldReceive('update')->once()->withArgs(
            fn ($sql, $bindings) => abs(((float) $bindings[1]) - (-15.0)) < 0.001
        )->andReturn(1);

        $this->assertSame(1, $service->generateForUser(42)['explained']);
    }

    public function test_the_ai_is_told_which_of_the_members_listings_the_match_is_for(): void
    {
        $service = new FakeExplanationService();
        $service->llmResponse = ['entries' => [], 'tokens_in' => 0, 'tokens_out' => 0];
        DB::shouldReceive('select')->once()->andReturn([$this->cacheRow()]);
        DB::shouldReceive('update')->never();

        $service->generateForUser(42);

        $this->assertSame('Gardening offered', $service->lastItems[0]['searcher_listing'] ?? null);
    }

    public function test_provider_failure_leaves_algorithmic_reasons_untouched(): void
    {
        $service = new FakeExplanationService();
        $service->llmResponse = ['entries' => [], 'tokens_in' => 0, 'tokens_out' => 0]; // failed parse

        DB::shouldReceive('select')->once()->andReturn([$this->cacheRow()]);
        DB::shouldReceive('update')->never();

        $result = $service->generateForUser(42);

        $this->assertSame(0, $result['explained']);
        $this->assertSame(1, $service->llmCalls);
    }

    public function test_no_unexplained_rows_skips_the_llm_entirely(): void
    {
        $service = new FakeExplanationService();

        DB::shouldReceive('select')->once()->andReturn([]);

        $result = $service->generateForUser(42);

        $this->assertSame(0, $service->llmCalls, 'no rows → no spend');
        $this->assertSame(0, $result['explained']);
    }

    public function test_entries_missing_explanation_are_skipped(): void
    {
        $service = new FakeExplanationService();
        $service->llmResponse = [
            'entries' => [
                ['listing_id' => 5, 'rerank_delta' => 2, 'explanation' => ''],
                ['listing_id' => 0, 'rerank_delta' => 2, 'explanation' => 'orphan'],
            ],
            'tokens_in' => 10, 'tokens_out' => 5,
        ];

        DB::shouldReceive('select')->once()->andReturn([$this->cacheRow()]);
        DB::shouldReceive('update')->never();

        $result = $service->generateForUser(42);

        $this->assertSame(0, $result['explained']);
    }
}
