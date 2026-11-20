<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The platform team pauses, restores and exempts a community.
 *
 * That only the platform team may call these is pinned, tier by tier, in
 * Security/PlatformTeamLocks/AdminSuperControllerPlatformTeamLockTest. This
 * file proves the door opens for the platform team and what happens when it
 * does — a lock test alone would pass on an endpoint that refused everyone.
 */
final class BillingStandingEndpointsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private int $community;

    protected function setUp(): void
    {
        parent::setUp();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Endpoint community',
            'slug' => 'endpoint-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    public function test_platform_team_pauses_and_restores_a_community(): void
    {
        $actor = $this->actAsPlatformTeam();

        $paused = $this->apiPost('/v2/admin/super/billing/standing/suspend', [
            'tenant_id' => $this->community,
            'note' => 'Two invoices unpaid',
        ]);

        $paused->assertStatus(200);
        $this->assertTrue($paused->json('data.standing.locked'));
        $this->assertSame($this->community, $paused->json('data.standing.locked_by_tenant_id'));
        $this->assertSame('manual', $paused->json('data.standing.suspension_source'));
        $this->assertTrue(BillingLock::isLocked($this->community));

        $restored = $this->apiPost('/v2/admin/super/billing/standing/restore', [
            'tenant_id' => $this->community,
            'note' => 'Paid',
        ]);

        $restored->assertStatus(200);
        $this->assertFalse($restored->json('data.standing.locked'));
        $this->assertFalse(BillingLock::isLocked($this->community));

        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->community)->orderBy('id')->get();
        $this->assertSame(['standing_suspended', 'standing_restored'], $audit->pluck('action')->all());
        $this->assertSame([(int) $actor->id, (int) $actor->id], $audit->pluck('acted_by_user_id')->map(fn ($v) => (int) $v)->all());
        $this->assertSame('Two invoices unpaid', $audit[0]->notes);
    }

    public function test_platform_team_exempts_a_community_and_removes_the_exemption(): void
    {
        $this->actAsPlatformTeam();

        $exempted = $this->apiPost('/v2/admin/super/billing/standing/exempt', [
            'tenant_id' => $this->community,
            'exempt' => true,
            'reason' => 'Council contract, paid annually',
        ]);

        $exempted->assertStatus(200);
        $this->assertTrue($exempted->json('data.standing.exempt'));
        $this->assertSame('Council contract, paid annually', $exempted->json('data.standing.exempt_reason'));

        $refused = $this->apiPost('/v2/admin/super/billing/standing/suspend', ['tenant_id' => $this->community]);
        $refused->assertStatus(422);
        $this->assertStringContainsString('COMMUNITY_IS_EXEMPT', (string) $refused->getContent());
        $this->assertFalse(BillingLock::isLocked($this->community));

        $removed = $this->apiPost('/v2/admin/super/billing/standing/exempt', [
            'tenant_id' => $this->community,
            'exempt' => false,
        ]);

        $removed->assertStatus(200);
        $this->assertFalse($removed->json('data.standing.exempt'));
    }

    public function test_pausing_tenant_one_is_refused_with_422(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost('/v2/admin/super/billing/standing/suspend', ['tenant_id' => 1]);

        $response->assertStatus(422);
        $this->assertStringContainsString('PLATFORM_TENANT_NOT_BILLABLE', (string) $response->getContent());
    }

    public function test_pausing_an_unknown_community_is_refused_with_422(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost('/v2/admin/super/billing/standing/suspend', ['tenant_id' => 999999991]);

        $response->assertStatus(422);
        $this->assertStringContainsString('TENANT_NOT_FOUND', (string) $response->getContent());
    }

    public function test_a_missing_community_id_is_refused_with_422(): void
    {
        $this->actAsPlatformTeam();

        $this->apiPost('/v2/admin/super/billing/standing/suspend', [])->assertStatus(422);
        $this->apiPost('/v2/admin/super/billing/standing/restore', [])->assertStatus(422);
        $this->apiPost('/v2/admin/super/billing/standing/exempt', ['exempt' => true, 'reason' => 'x'])->assertStatus(422);
    }

    public function test_exempting_without_a_reason_is_refused_with_422(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost('/v2/admin/super/billing/standing/exempt', [
            'tenant_id' => $this->community,
            'exempt' => true,
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('EXEMPT_REASON_REQUIRED', (string) $response->getContent());
        $this->assertSame(0, DB::table('billing_audit_log')->where('tenant_id', $this->community)->count());
    }

    public function test_a_tenant_super_admin_cannot_pause_a_community(): void
    {
        $this->actAsTier(['role' => 'admin', 'is_tenant_super_admin' => true]);

        $this->apiPost('/v2/admin/super/billing/standing/suspend', ['tenant_id' => $this->community])->assertStatus(403);
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_snapshot_rows_carry_standing(): void
    {
        $this->actAsPlatformTeam();
        $this->apiPost('/v2/admin/super/billing/standing/suspend', ['tenant_id' => $this->community])->assertStatus(200);

        $response = $this->apiGet('/v2/admin/super/billing/snapshot');
        $response->assertStatus(200);

        $row = collect($response->json('data'))->firstWhere('id', $this->community);
        $this->assertNotNull($row, 'The new community is on the snapshot.');

        foreach (['payer', 'payer_is_default', 'paid_until', 'suspended_at', 'suspension_source', 'exempt', 'locked', 'locked_by_tenant_id'] as $key) {
            $this->assertArrayHasKey($key, $row['standing'], $key);
        }

        $this->assertTrue($row['standing']['locked']);
        $this->assertSame('platform_invoice', $row['standing']['payer']);
    }
}
