<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\ShiftSwapService;
use Illuminate\Support\Facades\DB;

class ShiftSwapServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Reset static errors
        $ref = new \ReflectionClass(ShiftSwapService::class);
        $prop = $ref->getProperty('errors');
        $prop->setAccessible(true);
        $prop->setValue(null, []);
    }

    // ── requestSwap ──

    public function test_requestSwap_fails_with_missing_fields(): void
    {
        $result = ShiftSwapService::requestSwap(1, []);
        $this->assertNull($result);
        $this->assertEquals('VALIDATION_ERROR', ShiftSwapService::getErrors()[0]['code']);
    }

    public function test_requestSwap_fails_for_self_swap(): void
    {
        $result = ShiftSwapService::requestSwap(1, [
            'from_shift_id' => 1,
            'to_shift_id' => 2,
            'to_user_id' => 1,
        ]);
        $this->assertNull($result);
        $this->assertStringContainsString('yourself', ShiftSwapService::getErrors()[0]['message']);
    }

    // ── respond ──

    public function test_respond_rejects_invalid_action(): void
    {
        $result = ShiftSwapService::respond(1, 1, 'invalid');
        $this->assertFalse($result);
        $this->assertEquals('VALIDATION_ERROR', ShiftSwapService::getErrors()[0]['code']);
    }

    public function test_respond_fails_when_swap_not_found(): void
    {
        DB::shouldReceive('table->where->where->where->first')->andReturnNull();

        $result = ShiftSwapService::respond(999, 1, 'accept');
        $this->assertFalse($result);
        $this->assertEquals('NOT_FOUND', ShiftSwapService::getErrors()[0]['code']);
    }

    // ── adminDecision ──

    public function test_adminDecision_rejects_invalid_action(): void
    {
        $result = ShiftSwapService::adminDecision(1, 1, 'invalid');
        $this->assertFalse($result);
    }

    public function test_adminDecision_fails_when_not_pending(): void
    {
        DB::shouldReceive('table->where->where->where->first')->andReturnNull();

        $result = ShiftSwapService::adminDecision(999, 1, 'approve');
        $this->assertFalse($result);
    }

    // ── cancel ──

    public function test_cancel_fails_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->whereIn->where->first')->andReturnNull();

        $result = ShiftSwapService::cancel(999, 1, $this->testTenantId);
        $this->assertFalse($result);
    }

    // ── getCancelErrors ──

    public function test_getCancelErrors_is_alias_for_getErrors(): void
    {
        $this->assertEquals(ShiftSwapService::getErrors(), ShiftSwapService::getCancelErrors());
    }

    // ── getSwapRequests ──

    public function test_getSwapRequests_returns_array(): void
    {
        $result = ShiftSwapService::getSwapRequests(1);
        $this->assertIsArray($result);
    }

    // ------------------------------------------------------------------
    //  Direction filtering (2026-09-09)
    //
    //  The native app sends `sent` / `received`. The service only tested for
    //  `incoming` / `outgoing`, so both fell through to the catch-all and
    //  every swap came back in both directions — the filter looked like it
    //  worked and did nothing. These pin the mapping in both directions.
    // ------------------------------------------------------------------

    public function test_normaliseDirection_accepts_the_words_the_native_app_sends(): void
    {
        $this->assertSame('outgoing', ShiftSwapService::normaliseDirection('sent'));
        $this->assertSame('incoming', ShiftSwapService::normaliseDirection('received'));
    }

    public function test_normaliseDirection_keeps_the_original_api_vocabulary(): void
    {
        $this->assertSame('incoming', ShiftSwapService::normaliseDirection('incoming'));
        $this->assertSame('outgoing', ShiftSwapService::normaliseDirection('outgoing'));
    }

    public function test_normaliseDirection_falls_back_to_all_for_anything_else(): void
    {
        // Unrecognised input must show BOTH directions, never an empty list:
        // a filter nobody asked for is worse than no filter.
        $this->assertSame('all', ShiftSwapService::normaliseDirection('all'));
        $this->assertSame('all', ShiftSwapService::normaliseDirection(''));
        $this->assertSame('all', ShiftSwapService::normaliseDirection('sideways'));
    }

    public function test_normaliseDirection_is_case_and_whitespace_tolerant(): void
    {
        $this->assertSame('outgoing', ShiftSwapService::normaliseDirection(' Sent '));
        $this->assertSame('incoming', ShiftSwapService::normaliseDirection('RECEIVED'));
    }
}
