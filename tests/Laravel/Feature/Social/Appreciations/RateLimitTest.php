<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Models\User;
use App\Services\Social\AppreciationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * SOC14 — 11th appreciation in a day raises rate_limit_exceeded.
 */
class RateLimitTest extends TestCase
{
    use DatabaseTransactions;

    public function test_eleventh_send_throws_rate_limit(): void
    {
        if (!Schema::hasTable('appreciations')) {
            $this->markTestSkipped('appreciations schema not present.');
        }
        Cache::flush();

        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $svc = new AppreciationService();

        for ($i = 0; $i < AppreciationService::DAILY_SEND_LIMIT; $i++) {
            $r = User::factory()->forTenant($this->testTenantId)->create();
            $svc->send($sender->id, $r->id, "msg {$i}", 'general');
        }

        $r11 = User::factory()->forTenant($this->testTenantId)->create();
        $caught = null;
        try {
            $svc->send($sender->id, $r11->id, 'one too many', 'general');
        } catch (\DomainException $e) {
            $caught = $e->getMessage();
        }
        $this->assertSame('rate_limit_exceeded', $caught);
    }
}
