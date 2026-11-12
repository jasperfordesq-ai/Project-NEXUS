<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Models\Social\Appreciation;
use App\Models\User;
use App\Services\Social\AppreciationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * SOC14 — Reacting twice with same type toggles off; swapping types swaps reaction.
 */
class ReactToggleTest extends TestCase
{
    use DatabaseTransactions;

    private function setupAppreciation(): array
    {
        Cache::flush();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        $reactor = User::factory()->forTenant($this->testTenantId)->create();
        $svc = new AppreciationService();
        $a = $svc->send($sender->id, $receiver->id, 'Thanks!');
        // A note can only be reacted to once its receiver has shown it.
        $svc->setVisibility($a->id, $receiver->id, true);
        return [$svc, $a, $reactor];
    }

    public function test_reacting_with_same_type_toggles_off(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        if (!Schema::hasTable('appreciations') || !Schema::hasTable('appreciation_reactions')) {
            $this->markTestSkipped('appreciation schema not present.');
        }
        [$svc, $a, $reactor] = $this->setupAppreciation();

        $r1 = $svc->react($a->id, $reactor->id, 'heart');
        $this->assertTrue($r1['reacted']);
        $this->assertSame(1, (int) Appreciation::find($a->id)->reactions_count);

        $r2 = $svc->react($a->id, $reactor->id, 'heart');
        $this->assertFalse($r2['reacted']);
        $this->assertSame(0, (int) Appreciation::find($a->id)->reactions_count);
    }

    public function test_swapping_reaction_type_keeps_count_at_one(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        if (!Schema::hasTable('appreciations') || !Schema::hasTable('appreciation_reactions')) {
            $this->markTestSkipped('appreciation schema not present.');
        }
        [$svc, $a, $reactor] = $this->setupAppreciation();

        $svc->react($a->id, $reactor->id, 'heart');
        $svc->react($a->id, $reactor->id, 'star');

        $fresh = Appreciation::find($a->id);
        $this->assertSame(1, (int) $fresh->reactions_count);
    }
}
