<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A parent community's manager and the payment standing of the communities
 * below it.
 *
 * The owner's rule (12 Oct 2026): a tenant super admin administers every
 * community below its own, never its own, never above, never beside. This is
 * the first place that rule lets one community's manager close another
 * community, so it is pinned at both ends: the door opens for the right
 * manager on the right community, and stays shut for everyone and everything
 * else. Security record E-133.
 *
 * Tree:  hub ─ child ─ grandchild        other (a second hub, beside `hub`)
 *            └ sibling                        └ otherChild
 */
final class BranchPaymentsEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $sibling;
    private int $other;
    private int $otherChild;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hub = $this->makeCommunity('Branch hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Branch child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Branch grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Branch sibling', $this->hub, "/1/{$this->hub}/");
        $this->other = $this->makeCommunity('Other hub', 1, '/1/', true);
        $this->otherChild = $this->makeCommunity('Other child', $this->other, "/1/{$this->other}/");

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'branch-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function signInTo(int $tenantId, array $attributes): User
    {
        $this->testTenantId = $tenantId;

        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($tenantId);
        SuperPanelAccess::reset();

        return $user;
    }

    private function asManagerOf(int $tenantId): User
    {
        return $this->signInTo($tenantId, ['role' => 'admin', 'is_tenant_super_admin' => true]);
    }

    /** @return list<object> */
    private function audit(int $tenantId): array
    {
        return DB::table('billing_audit_log')->where('tenant_id', $tenantId)->orderBy('id')->get()->all();
    }

    // ── The door opens ──────────────────────────────────────────────────────

    public function test_a_manager_sees_only_the_communities_below_its_own(): void
    {
        $this->asManagerOf($this->hub);

        $response = $this->apiGet('/v2/admin/super/branch-payments');
        $response->assertStatus(200);

        $ids = collect($response->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->sort()->values()->all();
        $expected = [$this->child, $this->grandchild, $this->sibling];
        sort($expected);

        $this->assertSame($expected, $ids, 'Not its own community, not the other hub, not the other hub\'s child, not tenant 1.');

        $row = collect($response->json('data'))->firstWhere('id', $this->grandchild);
        foreach (['id', 'name', 'depth', 'parent_id', 'parent_name', 'standing', 'days_late', 'can_act', 'cannot_act_reason', 'paused_from_above'] as $key) {
            $this->assertArrayHasKey($key, $row, $key);
        }
        $this->assertTrue($row['can_act']);
        $this->assertSame('Branch child', $row['parent_name']);
        $this->assertSame('parent', $row['standing']['payer']);
    }

    public function test_a_manager_records_payment_for_a_child_and_a_grandchild(): void
    {
        $manager = $this->asManagerOf($this->hub);

        foreach ([$this->child, $this->grandchild] as $target) {
            $response = $this->apiPost("/v2/admin/super/branch-payments/{$target}/paid-until", [
                'paid_until' => '2027-01-31',
                'note' => 'Invoice paid',
            ]);

            $response->assertStatus(200);
            $this->assertSame('2027-01-31', $response->json('data.standing.paid_until'));

            $rows = $this->audit($target);
            $this->assertCount(1, $rows);
            $this->assertSame('standing_paid_until_set', $rows[0]->action);
            $this->assertSame((int) $manager->id, (int) $rows[0]->acted_by_user_id);
        }
    }

    public function test_a_manager_pauses_and_restores_a_child(): void
    {
        $manager = $this->asManagerOf($this->hub);

        $paused = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/suspend", ['note' => 'Three months unpaid']);
        $paused->assertStatus(200);
        $this->assertTrue($paused->json('data.standing.locked'));
        $this->assertTrue(BillingLock::isLocked($this->child));
        $this->assertTrue(BillingLock::isLocked($this->grandchild), 'Pausing a community pauses what is below it.');
        $this->assertFalse(BillingLock::isLocked($this->sibling));
        $this->assertFalse(BillingLock::isLocked($this->hub));

        $restored = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/restore", []);
        $restored->assertStatus(200);
        $this->assertFalse(BillingLock::isLocked($this->child));

        $rows = $this->audit($this->child);
        $this->assertSame(['standing_suspended', 'standing_restored'], array_map(static fn ($r) => $r->action, $rows));
        $this->assertSame((int) $manager->id, (int) $rows[0]->acted_by_user_id);
        $this->assertSame('Three months unpaid', $rows[0]->notes);
    }

    public function test_the_days_late_are_counted_from_the_paid_until_date(): void
    {
        $this->asManagerOf($this->hub);
        BillingStandingService::setPaidUntil($this->child, now()->subDays(9)->toDateString(), null);
        BillingStandingService::setPaidUntil($this->sibling, now()->addDays(20)->toDateString(), null);

        $rows = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'));

        $this->assertSame(9, $rows->firstWhere('id', $this->child)['days_late']);
        $this->assertNull($rows->firstWhere('id', $this->sibling)['days_late']);
        $this->assertNull($rows->firstWhere('id', $this->grandchild)['days_late']);
    }

    // ── The door stays shut ─────────────────────────────────────────────────

    /** @return array<string, array{0: string}> */
    public static function writes(): array
    {
        return [
            'paid-until' => ['paid-until'],
            'suspend' => ['suspend'],
            'restore' => ['restore'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('writes')]
    public function test_a_manager_cannot_act_on_anything_that_is_not_below_it(string $action): void
    {
        $this->asManagerOf($this->child);
        // Something for "restore" to be tempted by.
        BillingStandingService::suspend($this->sibling, null, 'manual');
        BillingStandingService::suspend($this->otherChild, null, 'manual');

        $notBelow = [
            'its own community' => $this->child,
            'its parent' => $this->hub,
            'a sibling' => $this->sibling,
            'another hub' => $this->other,
            'another hub\'s child' => $this->otherChild,
            'the platform community' => 1,
            'a community that does not exist' => 999999991,
        ];

        foreach ($notBelow as $what => $target) {
            $before = DB::table('billing_audit_log')->where('tenant_id', $target)->count();

            $response = $this->apiPost("/v2/admin/super/branch-payments/{$target}/{$action}", ['paid_until' => '2027-01-31']);

            $this->assertSame(403, $response->getStatusCode(), "{$action} on {$what} must be refused with 403, got {$response->getStatusCode()}");
            $this->assertSame($before, DB::table('billing_audit_log')->where('tenant_id', $target)->count(), "{$action} on {$what} wrote something");
        }

        $this->assertTrue(BillingLock::isLocked($this->sibling), 'A sibling paused by someone else is still paused.');
        $this->assertTrue(BillingLock::isLocked($this->otherChild));
        $this->assertFalse(BillingLock::isLocked($this->hub));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('writes')]
    public function test_a_manager_of_the_platform_community_cannot_act_on_a_community_that_pays_the_platform(string $action): void
    {
        // Tenant 1's manager reaches /1/… by the reach rule, but a community
        // directly under tenant 1 pays the platform: that is the platform team's.
        DB::table('tenants')->where('id', 1)->update(['allows_subtenants' => 1, 'path' => '/1/']);
        $this->asManagerOf(1);
        BillingStandingService::suspend($this->hub, null, 'manual');

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->hub}/{$action}", ['paid_until' => '2027-01-31']);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAYS_PLATFORM', (string) $response->getContent());
        $this->assertTrue(BillingLock::isLocked($this->hub));
        $this->assertNull(BillingStandingService::get($this->hub)['paid_until']);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('writes')]
    public function test_a_manager_cannot_act_on_an_exempt_community(string $action): void
    {
        $this->asManagerOf($this->hub);
        BillingStandingService::setExempt($this->child, true, 1, 'Council contract');

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/{$action}", ['paid_until' => '2027-01-31']);

        $response->assertStatus(422);
        $this->assertStringContainsString('EXEMPT', (string) $response->getContent());
        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertNull(BillingStandingService::get($this->child)['paid_until']);
    }

    public function test_a_community_paused_from_above_the_manager_cannot_be_restored_by_it(): void
    {
        BillingStandingService::suspend($this->hub, null, 'manual');
        $this->asManagerOf($this->child);

        $row = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'))->firstWhere('id', $this->grandchild);
        $this->assertTrue($row['paused_from_above']);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->grandchild}/restore", []);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAUSED_FROM_ABOVE', (string) $response->getContent());
        $this->assertTrue(BillingLock::isLocked($this->grandchild));
        $this->assertTrue(BillingLock::isLocked($this->hub));
    }

    public function test_a_date_that_is_not_a_date_is_refused_and_nothing_is_written(): void
    {
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/paid-until", ['paid_until' => '31/01/2027']);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAID_UNTIL_INVALID', (string) $response->getContent());
        $this->assertCount(0, $this->audit($this->child));
    }

    public function test_clearing_the_date_is_allowed(): void
    {
        $this->asManagerOf($this->hub);
        BillingStandingService::setPaidUntil($this->child, '2027-01-31', null);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/paid-until", ['paid_until' => null]);

        $response->assertStatus(200);
        $this->assertNull($response->json('data.standing.paid_until'));
    }

    // ── Found by the Stage 2 review (20 Nov 2026) ───────────────────────────

    public function test_a_request_that_does_not_say_paid_until_is_refused_and_clears_nothing(): void
    {
        $this->asManagerOf($this->hub);
        BillingStandingService::setPaidUntil($this->child, '2027-01-31', null);
        $before = count($this->audit($this->child));

        // Only an explicit null clears the date. An empty body is a mistake.
        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/paid-until", ['note' => 'oops']);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAID_UNTIL_INVALID', (string) $response->getContent());
        $this->assertSame('2027-01-31', BillingStandingService::get($this->child)['paid_until']);
        $this->assertCount($before, $this->audit($this->child));
    }

    public function test_the_list_does_not_show_a_manager_what_the_platform_team_wrote(): void
    {
        BillingStandingService::suspend($this->child, 1, 'manual', 'PRIVATE-PLATFORM-NOTE about this community');
        BillingStandingService::setExempt($this->sibling, true, 1, 'PRIVATE-EXEMPT-REASON council contract');
        $this->asManagerOf($this->hub);

        $response = $this->apiGet('/v2/admin/super/branch-payments');
        $response->assertStatus(200);

        $this->assertStringNotContainsString('PRIVATE-PLATFORM-NOTE', (string) $response->getContent());
        $this->assertStringNotContainsString('PRIVATE-EXEMPT-REASON', (string) $response->getContent());

        foreach ($response->json('data') as $row) {
            $this->assertArrayNotHasKey('suspension_note', $row['standing']);
            $this->assertArrayNotHasKey('exempt_reason', $row['standing']);
        }

        // What the page needs is still there.
        $paused = collect($response->json('data'))->firstWhere('id', $this->child);
        $this->assertNotNull($paused['standing']['suspended_at']);
        $this->assertTrue(collect($response->json('data'))->firstWhere('id', $this->sibling)['standing']['exempt']);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('writes')]
    public function test_a_community_directly_under_the_platform_is_refused_even_if_its_record_says_it_pays_a_parent(string $action): void
    {
        // Belt and braces: the rule must not rest on a stored value alone.
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $this->hub, 'payer' => 'parent', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingLock::flush();
        DB::table('tenants')->where('id', 1)->update(['allows_subtenants' => 1, 'path' => '/1/']);
        $this->asManagerOf(1);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->hub}/{$action}", ['paid_until' => '2027-01-31']);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAYS_PLATFORM', (string) $response->getContent());
        $this->assertFalse(BillingLock::isLocked($this->hub));
        $this->assertNull(BillingStandingService::get($this->hub)['paid_until']);
    }

    public function test_out_of_reach_and_does_not_exist_are_answered_identically(): void
    {
        $this->asManagerOf($this->child);

        $outOfReach = $this->apiPost("/v2/admin/super/branch-payments/{$this->sibling}/suspend", []);
        $missing = $this->apiPost('/v2/admin/super/branch-payments/999999991/suspend', []);

        $this->assertSame(403, $outOfReach->getStatusCode());
        $this->assertSame($outOfReach->getStatusCode(), $missing->getStatusCode());
        $this->assertSame($outOfReach->json('errors'), $missing->json('errors'));
    }

    public function test_a_global_super_admin_who_is_not_on_the_platform_team_has_a_managers_powers_and_no_more(): void
    {
        $this->signInTo($this->hub, ['role' => 'super_admin', 'is_super_admin' => true]);

        // The door opens: a community that pays its parent.
        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/suspend", [])->assertStatus(200);
        $this->assertTrue(BillingLock::isLocked($this->child));
        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/restore", [])->assertStatus(200);

        // And stays shut: a community that pays the platform is the platform team's.
        $refused = $this->apiPost("/v2/admin/super/branch-payments/{$this->other}/suspend", []);
        $refused->assertStatus(422);
        $this->assertStringContainsString('PAYS_PLATFORM', (string) $refused->getContent());
        $this->assertFalse(BillingLock::isLocked($this->other));
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function notManagers(): array
    {
        return [
            'a community admin' => [['role' => 'admin']],
            'a broker' => [['role' => 'broker']],
            'a member' => [['role' => 'member']],
        ];
    }

    /** @param array<string, mixed> $attributes */
    #[\PHPUnit\Framework\Attributes\DataProvider('notManagers')]
    public function test_nobody_below_a_manager_can_see_or_change_anything(array $attributes): void
    {
        $this->signInTo($this->hub, $attributes);

        $this->assertContains($this->apiGet('/v2/admin/super/branch-payments')->getStatusCode(), [401, 403]);

        foreach (['paid-until', 'suspend', 'restore'] as $action) {
            $status = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/{$action}", ['paid_until' => '2027-01-31'])->getStatusCode();
            $this->assertContains($status, [401, 403], "{$action} answered {$status}");
        }

        $this->assertCount(0, $this->audit($this->child));
        $this->assertFalse(BillingLock::isLocked($this->child));
    }
}
