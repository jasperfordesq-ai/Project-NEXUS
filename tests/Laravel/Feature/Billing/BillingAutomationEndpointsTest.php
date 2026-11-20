<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The platform team's controls for the daily check: its settings, the "what
 * would happen today" list, and setting any community's paid-until date. And
 * what a community's own admins are told before anything is paused.
 *
 * That only the platform team may call the first three is pinned in
 * Security/PlatformTeamLocks/AdminSuperControllerPlatformTeamLockTest; this
 * file proves the door opens for the platform team and what happens then.
 * The keys asserted here are the ones BillingAutomationCard.tsx and
 * BillingPausedBanner.tsx read: rename them together.
 */
final class BillingAutomationEndpointsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    /** Read by BillingAutomationCard.tsx off each preview entry. */
    private const PREVIEW_ENTRY_KEYS = ['tenant_id', 'tenant_name', 'clock', 'action', 'detail'];

    private int $community;

    protected function setUp(): void
    {
        parent::setUp();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Automation endpoint community',
            'slug' => 'auto-endpoint-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);

        BillingLock::flush();
        BillingSettings::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            BillingSettings::flush();
        } finally {
            parent::tearDown();
        }
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    public function test_the_platform_team_reads_every_setting(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiGet('/v2/admin/super/billing/settings');

        $response->assertStatus(200);
        $this->assertSame(array_keys(BillingSettings::DEFAULTS), array_keys($response->json('data')));
        $this->assertSame(BillingSettings::all(), $response->json('data'));
    }

    public function test_saving_some_settings_changes_only_those(): void
    {
        $this->actAsPlatformTeam();
        $before = BillingSettings::all();

        $response = $this->apiPut('/v2/admin/super/billing/settings', [
            'automation_enabled' => true,
            'over_limit_action' => 'pause',
            'over_limit_grace_days' => 45,
        ]);

        $response->assertStatus(200);
        $this->assertTrue($response->json('data.automation_enabled'));
        $this->assertSame('pause', $response->json('data.over_limit_action'));
        $this->assertSame(45, $response->json('data.over_limit_grace_days'));
        $this->assertSame($before['suspend_days_late'], $response->json('data.suspend_days_late'));

        BillingSettings::flush();
        $this->assertTrue(BillingSettings::get('automation_enabled'));
        $this->assertSame(45, BillingSettings::get('over_limit_grace_days'));
    }

    /** @return array<string, array{array<string, mixed>}> */
    public static function refusedSettings(): array
    {
        return [
            'a value out of range, beside a good one' => [['automation_enabled' => true, 'limit_warning_percent' => 120]],
            'an unknown setting' => [['automation_enabled' => true, 'make_everyone_pay' => 1]],
            'the pause before the final warning' => [['final_warning_days_late' => 20, 'suspend_days_late' => 10]],
            'an unknown over-limit choice' => [['over_limit_action' => 'delete']],
        ];
    }

    /**
     * @param array<string, mixed> $body
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('refusedSettings')]
    public function test_a_bad_setting_is_refused_and_nothing_is_saved(array $body): void
    {
        $this->actAsPlatformTeam();
        $before = BillingSettings::all();

        $response = $this->apiPut('/v2/admin/super/billing/settings', $body);

        $response->assertStatus(422);
        $this->assertStringContainsString('BILLING_SETTING_INVALID', (string) $response->getContent());
        $this->assertStringContainsString(__('api.billing_setting_invalid'), (string) $response->getContent());

        BillingSettings::flush();
        $this->assertSame($before, BillingSettings::all());
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    public function test_the_preview_says_what_would_happen_while_the_switch_is_off_and_does_nothing(): void
    {
        $this->actAsPlatformTeam();
        $this->assertFalse(BillingSettings::get('automation_enabled'));
        BillingStandingService::setPaidUntil($this->community, now()->subDays(40)->toDateString(), null);

        $response = $this->apiGet('/v2/admin/super/billing/standing/preview');

        $response->assertStatus(200);
        $entry = collect($response->json('data'))->firstWhere('tenant_id', $this->community);
        $this->assertNotNull($entry, 'The late community is on the list.');
        $this->assertSame(self::PREVIEW_ENTRY_KEYS, array_keys($entry));
        $this->assertSame('payment', $entry['clock']);
        $this->assertSame('suspend', $entry['action']);
        $this->assertSame('Automation endpoint community', $entry['tenant_name']);

        $this->assertFalse(BillingLock::isLocked($this->community), 'The preview pauses nobody.');
        $this->assertNull(DB::table('tenant_billing_standing')->where('tenant_id', $this->community)->value('last_notice_stage'));
    }

    // ── Paid-until ───────────────────────────────────────────────────────────

    public function test_the_platform_team_sets_and_clears_a_paid_until_date(): void
    {
        $actor = $this->actAsPlatformTeam();

        $set = $this->apiPost('/v2/admin/super/billing/standing/paid-until', [
            'tenant_id' => $this->community,
            'paid_until' => '2027-01-31',
            'note' => 'Invoice 42 paid',
        ]);
        $set->assertStatus(200);
        $this->assertSame('2027-01-31', $set->json('data.standing.paid_until'));

        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->community)->orderByDesc('id')->first();
        $this->assertSame('standing_paid_until_set', $audit->action);
        $this->assertSame((int) $actor->id, (int) $audit->acted_by_user_id);
        $this->assertSame('Invoice 42 paid', $audit->notes);

        $cleared = $this->apiPost('/v2/admin/super/billing/standing/paid-until', [
            'tenant_id' => $this->community,
            'paid_until' => null,
        ]);
        $cleared->assertStatus(200);
        $this->assertNull($cleared->json('data.standing.paid_until'));
    }

    public function test_a_request_that_does_not_say_paid_until_clears_nothing(): void
    {
        $this->actAsPlatformTeam();
        BillingStandingService::setPaidUntil($this->community, '2027-01-31', null);

        $response = $this->apiPost('/v2/admin/super/billing/standing/paid-until', ['tenant_id' => $this->community]);

        $response->assertStatus(422);
        $this->assertSame('2027-01-31', BillingStandingService::get($this->community)['paid_until']);
    }

    public function test_a_bad_date_or_a_missing_community_is_refused(): void
    {
        $this->actAsPlatformTeam();

        $bad = $this->apiPost('/v2/admin/super/billing/standing/paid-until', ['tenant_id' => $this->community, 'paid_until' => '31/01/2027']);
        $bad->assertStatus(422);
        $this->assertStringContainsString('PAID_UNTIL_INVALID', (string) $bad->getContent());

        $this->apiPost('/v2/admin/super/billing/standing/paid-until', ['paid_until' => '2027-01-31'])->assertStatus(422);
        $this->apiPost('/v2/admin/super/billing/standing/paid-until', ['tenant_id' => 1, 'paid_until' => '2027-01-31'])->assertStatus(422);
    }

    public function test_marking_paid_opens_a_community_the_check_paused_for_non_payment(): void
    {
        $this->actAsPlatformTeam();
        BillingStandingService::setPaidUntil($this->community, now()->subDays(40)->toDateString(), null);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'non_payment');
        $this->assertTrue(BillingLock::isLocked($this->community));

        $response = $this->apiPost('/v2/admin/super/billing/standing/paid-until', [
            'tenant_id' => $this->community,
            'paid_until' => now()->addMonth()->toDateString(),
        ]);

        $response->assertStatus(200);
        $this->assertFalse($response->json('data.standing.locked'));
    }

    /** The platform team may set a date on a child that pays its parent too (DESIGN §6.4). */
    public function test_the_platform_team_may_set_a_date_on_a_community_that_pays_its_parent(): void
    {
        $child = (int) DB::table('tenants')->insertGetId([
            'name' => 'Automation endpoint child',
            'slug' => 'auto-endpoint-child-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $this->community,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $child)->update(['path' => "/1/{$this->community}/{$child}/"]);
        $this->assertSame('parent', BillingStandingService::get($child)['payer']);

        $this->actAsPlatformTeam();
        $this->apiPost('/v2/admin/super/billing/standing/paid-until', ['tenant_id' => $child, 'paid_until' => '2027-02-28'])
            ->assertStatus(200);

        $this->assertSame('2027-02-28', BillingStandingService::get($child)['paid_until']);
    }

    // ── What the community's own admins are told ─────────────────────────────

    private function signInAsCommunityAdmin(): void
    {
        $this->testTenantId = $this->community;
        $admin = User::factory()->forTenant($this->community)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
        Sanctum::actingAs($admin, ['*']);
        TenantContext::setById($this->community);
    }

    private function giveStandardPlan(int $maxUsers): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Endpoint package',
            'slug' => 'endpoint-package-' . bin2hex(random_bytes(5)),
            'tier_level' => 1,
            'max_users' => $maxUsers,
            'is_standard' => 1,
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->community,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ]);
    }

    private function addActiveMembers(int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $this->community,
                'first_name' => 'Active',
                'last_name' => 'Member',
                'name' => 'Active Member',
                'email' => 'endpoint.' . bin2hex(random_bytes(7)) . '@example.com',
                'password_hash' => 'x',
                'role' => 'member',
                'status' => 'active',
                'is_approved' => 1,
                'last_login_at' => now()->subDays(5),
                'created_at' => now(),
            ];
        }
        DB::table('users')->insert($rows);
    }

    public function test_an_open_community_is_told_nothing_when_nothing_is_wrong(): void
    {
        $this->signInAsCommunityAdmin();

        $data = $this->apiGet('/v2/admin/billing/standing')->assertStatus(200)->json('data');

        $this->assertFalse($data['paused']);
        $this->assertNull($data['overdue_days']);
        $this->assertNull($data['member_limit'], 'No package with a limit: nothing to measure against.');
    }

    public function test_an_open_community_is_told_how_late_its_payment_is(): void
    {
        BillingStandingService::setPaidUntil($this->community, now()->subDays(10)->toDateString(), null);
        $this->signInAsCommunityAdmin();

        $this->assertSame(10, $this->apiGet('/v2/admin/billing/standing')->json('data.overdue_days'));
    }

    public function test_a_date_still_ahead_is_not_overdue(): void
    {
        BillingStandingService::setPaidUntil($this->community, now()->addDays(3)->toDateString(), null);
        $this->signInAsCommunityAdmin();

        $this->assertNull($this->apiGet('/v2/admin/billing/standing')->json('data.overdue_days'));
    }

    public function test_an_exempt_community_is_never_told_it_is_overdue(): void
    {
        BillingStandingService::setPaidUntil($this->community, now()->subDays(10)->toDateString(), null);
        $team = User::factory()->forTenant($this->testTenantId)->create(['is_super_admin' => true, 'is_god' => true]);
        BillingStandingService::setExempt($this->community, true, (int) $team->id, 'Council contract');
        $this->signInAsCommunityAdmin();

        $this->assertNull($this->apiGet('/v2/admin/billing/standing')->json('data.overdue_days'));
    }

    public function test_an_open_community_is_told_it_is_approaching_its_member_limit(): void
    {
        $this->giveStandardPlan(100);
        $this->addActiveMembers(85);
        $this->signInAsCommunityAdmin();

        $limit = $this->apiGet('/v2/admin/billing/standing')->json('data.member_limit');

        $this->assertSame(['used' => 85, 'max' => 100, 'percent' => 85, 'stage' => 'approaching'], $limit);
    }

    public function test_the_member_limit_stages_use_the_same_thresholds_as_the_daily_check(): void
    {
        $this->giveStandardPlan(10);
        $this->signInAsCommunityAdmin();

        $this->addActiveMembers(7);
        $this->assertNull($this->apiGet('/v2/admin/billing/standing')->json('data.member_limit.stage'), '70% is below the warning.');

        $this->addActiveMembers(3);
        $this->assertSame('reached', $this->apiGet('/v2/admin/billing/standing')->json('data.member_limit.stage'));

        $this->addActiveMembers(1);
        $limit = $this->apiGet('/v2/admin/billing/standing')->json('data.member_limit');
        $this->assertSame('over', $limit['stage']);
        $this->assertSame(110, $limit['percent']);
    }

    public function test_a_paused_community_is_also_told_its_member_limit(): void
    {
        $this->giveStandardPlan(10);
        $this->addActiveMembers(11);
        BillingStandingService::suspend($this->community, null, 'manual');
        $this->signInAsCommunityAdmin();

        $data = $this->apiGet('/v2/admin/billing/standing')->json('data');

        $this->assertTrue($data['paused']);
        $this->assertSame('over', $data['member_limit']['stage']);
        $this->assertArrayHasKey('overdue_days', $data);
    }
}
