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
 * SOC14 — Sending an appreciation creates a row. Every new note is private:
 * only its receiver can later choose to show it on their profile.
 */
class SendAppreciationTest extends TestCase
{
    use DatabaseTransactions;

    public function test_send_creates_appreciation_row(): void
    {
        if (!Schema::hasTable('appreciations')) {
            $this->markTestSkipped('appreciations schema not present.');
        }
        Cache::flush();

        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $svc = new AppreciationService();
        $a = $svc->send($sender->id, $receiver->id, 'Thanks for the help!', 'general');

        $this->assertNotNull($a->id);
        $this->assertSame($sender->id, $a->sender_id);
        $this->assertSame($receiver->id, $a->receiver_id);
        $this->assertSame($this->testTenantId, $a->tenant_id);
        $this->assertFalse((bool) $a->is_public);

        $this->assertDatabaseHas('appreciations', [
            'id' => $a->id,
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'is_public' => 0,
        ]);
    }

    public function test_cannot_thank_self(): void
    {
        if (!Schema::hasTable('appreciations')) {
            $this->markTestSkipped('appreciations schema not present.');
        }
        Cache::flush();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $svc = new AppreciationService();

        $this->expectException(\DomainException::class);
        $svc->send($user->id, $user->id, 'Thanks me');
    }

    public function test_cannot_send_appreciation_to_user_in_another_tenant(): void
    {
        if (!Schema::hasTable('appreciations')) {
            $this->markTestSkipped('appreciations schema not present.');
        }
        Cache::flush();

        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant(999)->create();
        $svc = new AppreciationService();

        $caught = null;
        try {
            $svc->send($sender->id, $receiver->id, 'Thanks across the boundary');
        } catch (\DomainException $e) {
            $caught = $e->getMessage();
        }

        $this->assertSame('receiver_not_found', $caught);
        $this->assertDatabaseMissing('appreciations', [
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }
}
