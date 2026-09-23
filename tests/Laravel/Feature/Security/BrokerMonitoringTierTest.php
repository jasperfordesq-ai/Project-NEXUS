<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-055 — POST /v2/admin/broker/monitoring/{userId} must not let a broker lift
 * a restriction on themselves, nor let an operator restrict someone of equal or
 * higher rank. The actor must strictly outrank the target (same hierarchy as
 * the member security-reset endpoints).
 */
final class BrokerMonitoringTierTest extends TestCase
{
    use DatabaseTransactions;

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function restrict(User $target, string $reason, ?int $by = null): void
    {
        DB::table('user_messaging_restrictions')->insert([
            'user_id' => $target->id,
            'tenant_id' => $this->testTenantId,
            'under_monitoring' => 1,
            'messaging_disabled' => 1,
            'requires_broker_approval' => 1,
            'monitoring_reason' => $reason,
            'restriction_reason' => $reason,
            'monitoring_started_at' => now(),
            'restricted_by' => $by,
        ]);
    }

    private function restriction(User $target): ?object
    {
        return DB::table('user_messaging_restrictions')
            ->where('user_id', $target->id)
            ->where('tenant_id', $this->testTenantId)
            ->first();
    }

    public function test_broker_cannot_lift_a_safeguarding_restriction_on_themselves(): void
    {
        $broker = $this->broker();
        $this->restrict($broker, 'Safeguarding: automated trigger');
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/monitoring/{$broker->id}", ['under_monitoring' => false])
            ->assertStatus(403);

        $row = $this->restriction($broker);
        $this->assertNotNull($row);
        $this->assertSame(1, (int) $row->under_monitoring);
        $this->assertSame(1, (int) $row->messaging_disabled);
        $this->assertSame(1, (int) $row->requires_broker_approval);
    }

    public function test_broker_cannot_restrict_an_admin(): void
    {
        $broker = $this->broker();
        $admin = $this->admin();
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/monitoring/{$admin->id}", [
            'under_monitoring' => true,
            'messaging_disabled' => true,
            'reason' => 'Silence the admin',
        ])->assertStatus(403);

        $this->assertNull($this->restriction($admin));
    }

    public function test_broker_cannot_restrict_or_release_a_peer_broker(): void
    {
        $broker = $this->broker();
        $peer = $this->broker();
        $this->restrict($peer, 'Peer restriction');
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/monitoring/{$peer->id}", ['under_monitoring' => false])
            ->assertStatus(403);

        $this->assertSame(1, (int) $this->restriction($peer)->under_monitoring);
    }

    public function test_admin_cannot_restrict_a_peer_admin(): void
    {
        $admin = $this->admin();
        $peer = $this->admin();
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/monitoring/{$peer->id}", [
            'under_monitoring' => true,
            'reason' => 'Peer admin',
        ])->assertStatus(403);

        $this->assertNull($this->restriction($peer));
    }

    public function test_broker_can_still_restrict_and_release_a_member(): void
    {
        $broker = $this->broker();
        $member = $this->member();
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/monitoring/{$member->id}", [
            'under_monitoring' => true,
            'messaging_disabled' => true,
            'reason' => 'Concerning messages',
        ])->assertStatus(200)->assertJsonPath('data.under_monitoring', true);
        $this->assertSame(1, (int) $this->restriction($member)->messaging_disabled);

        $this->apiPost("/v2/admin/broker/monitoring/{$member->id}", ['under_monitoring' => false])
            ->assertStatus(200)->assertJsonPath('data.under_monitoring', false);
        $this->assertSame(0, (int) $this->restriction($member)->under_monitoring);
    }

    public function test_admin_can_still_restrict_a_member_and_a_broker(): void
    {
        $admin = $this->admin();
        $member = $this->member();
        $broker = $this->broker();
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/monitoring/{$member->id}", [
            'under_monitoring' => true,
            'reason' => 'Admin review',
        ])->assertStatus(200);
        $this->assertSame(1, (int) $this->restriction($member)->under_monitoring);

        $this->apiPost("/v2/admin/broker/monitoring/{$broker->id}", [
            'under_monitoring' => true,
            'reason' => 'Admin review of broker',
        ])->assertStatus(200);
        $this->assertSame(1, (int) $this->restriction($broker)->under_monitoring);
    }

    public function test_admin_can_manage_their_own_restriction(): void
    {
        $admin = $this->admin();
        $this->restrict($admin, 'Safeguarding: automated trigger');
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/monitoring/{$admin->id}", ['under_monitoring' => false])
            ->assertStatus(200);

        $this->assertSame(0, (int) $this->restriction($admin)->under_monitoring);
    }
}
