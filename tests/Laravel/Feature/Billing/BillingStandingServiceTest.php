<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Pausing, restoring and exempting a community for payment reasons: what is
 * refused, what is recorded, and who it is recorded against.
 */
final class BillingStandingServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $top;
    private int $child;
    private int $actor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->top = $this->makeCommunity('Standing top', 1, '/1/');
        $this->child = $this->makeCommunity('Standing child', $this->top, "/1/{$this->top}/");
        $this->actor = (int) User::factory()->forTenant($this->testTenantId)->create()->id;

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back. It must run even if
        // the flush throws, or the open transaction keeps its row locks and
        // every later test waits on them.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'standing-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @return list<object> */
    private function audit(int $tenantId): array
    {
        return DB::table('billing_audit_log')->where('tenant_id', $tenantId)->orderBy('id')->get()->all();
    }

    public function test_suspend_and_restore_are_audited_with_the_actor(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual', 'Two invoices unpaid');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame($this->child, $standing['locked_by_tenant_id']);
        $this->assertSame('manual', $standing['suspension_source']);
        $this->assertSame('Two invoices unpaid', $standing['suspension_note']);
        $this->assertNotNull($standing['suspended_at']);

        BillingStandingService::restore($this->child, $this->actor, 'Paid by transfer');

        $standing = BillingStandingService::get($this->child);
        $this->assertFalse($standing['locked']);
        $this->assertNull($standing['suspended_at']);
        $this->assertNull($standing['locked_by_tenant_id']);

        $rows = $this->audit($this->child);
        $this->assertSame(['standing_suspended', 'standing_restored'], array_map(static fn ($r) => $r->action, $rows));
        $this->assertSame($this->actor, (int) $rows[0]->acted_by_user_id);
        $this->assertSame($this->actor, (int) $rows[1]->acted_by_user_id);
        $this->assertSame('Two invoices unpaid', $rows[0]->notes);
        $this->assertSame('Paid by transfer', $rows[1]->notes);
    }

    public function test_a_suspension_by_the_system_has_no_actor(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto');

        $rows = $this->audit($this->child);
        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]->acted_by_user_id);
        $this->assertSame('auto', BillingStandingService::get($this->child)['suspension_source']);
    }

    public function test_suspending_twice_writes_one_audit_row(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual');
        BillingStandingService::suspend($this->child, $this->actor, 'manual');

        $this->assertCount(1, $this->audit($this->child));
    }

    public function test_restoring_an_open_community_writes_nothing(): void
    {
        BillingStandingService::restore($this->child, $this->actor);

        $this->assertCount(0, $this->audit($this->child));
        $this->assertFalse(BillingStandingService::get($this->child)['locked']);
    }

    public function test_tenant_one_cannot_be_suspended(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('platform_tenant_not_billable');

        BillingStandingService::suspend(1, $this->actor, 'manual');
    }

    public function test_an_unknown_community_is_refused(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('tenant_not_found');

        BillingStandingService::suspend(999999991, $this->actor, 'manual');
    }

    public function test_an_exempt_community_cannot_be_suspended(): void
    {
        BillingStandingService::setExempt($this->child, true, $this->actor, 'Council contract, paid annually');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('community_is_exempt');

        BillingStandingService::suspend($this->child, $this->actor, 'manual');
    }

    public function test_exempting_needs_a_reason(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('exempt_reason_required');

        BillingStandingService::setExempt($this->child, true, $this->actor, '   ');
    }

    public function test_exempting_a_suspended_community_restores_it(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual');
        BillingStandingService::setExempt($this->child, true, $this->actor, 'Council contract');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['exempt']);
        $this->assertSame('Council contract', $standing['exempt_reason']);
        $this->assertFalse($standing['locked']);
        $this->assertNull($standing['suspended_at']);

        $this->assertSame(
            ['standing_suspended', 'standing_restored', 'standing_exempted'],
            array_map(static fn ($r) => $r->action, $this->audit($this->child))
        );
    }

    public function test_removing_an_exemption_is_audited(): void
    {
        BillingStandingService::setExempt($this->child, true, $this->actor, 'Council contract');
        BillingStandingService::setExempt($this->child, false, $this->actor);

        $standing = BillingStandingService::get($this->child);
        $this->assertFalse($standing['exempt']);
        $this->assertNull($standing['exempt_reason']);

        $this->assertSame(
            ['standing_exempted', 'standing_exemption_removed'],
            array_map(static fn ($r) => $r->action, $this->audit($this->child))
        );
    }

    public function test_default_payer_by_position(): void
    {
        $this->assertSame('not_billed', BillingStandingService::defaultPayer(1));
        $this->assertSame('platform_invoice', BillingStandingService::defaultPayer($this->top));
        $this->assertSame('parent', BillingStandingService::defaultPayer($this->child));

        $standing = BillingStandingService::get($this->child);
        $this->assertSame('parent', $standing['payer']);
        $this->assertTrue($standing['payer_is_default']);
        $this->assertNull($standing['paid_until']);
        $this->assertFalse($standing['exempt']);
        $this->assertFalse($standing['locked']);
    }

    public function test_default_payer_is_card_when_a_live_stripe_subscription_exists(): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->top,
            'pay_plan_id' => $planId,
            'status' => 'active',
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)),
        ]);

        $this->assertSame('platform_card', BillingStandingService::defaultPayer($this->top));
    }

    public function test_a_child_under_a_suspended_parent_reports_who_locked_it(): void
    {
        BillingStandingService::suspend($this->top, $this->actor, 'manual');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame($this->top, $standing['locked_by_tenant_id']);
        $this->assertNull($standing['suspended_at'], 'The child itself is not suspended.');
    }
}
