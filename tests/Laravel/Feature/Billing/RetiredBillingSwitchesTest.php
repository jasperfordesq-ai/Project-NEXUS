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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Three switches that did nothing, retired on 22 November 2026: "pause
 * billing" / "resume billing", the "grace period" and "billing delegates".
 *
 * Each wrote a value nothing ever read and answered "success" whether or not
 * anything had changed, so whoever used one believed a community had stopped
 * being billed, or had been given time, when nothing was different. The
 * endpoints now refuse plainly and write nothing. The columns and the table
 * are kept.
 *
 * That nobody below the platform team reaches them is pinned in
 * AdminSuperControllerPlatformTeamLockTest.
 */
final class RetiredBillingSwitchesTest extends TestCase
{
    use DatabaseTransactions;

    private int $community;
    private int $assignmentId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Retired switches community',
            'slug' => 'retired-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);

        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Retired switches plan',
            'slug' => 'retired-plan-' . bin2hex(random_bytes(4)),
            'tier_level' => 1,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assignmentId = (int) DB::table('tenant_plan_assignments')->insertGetId([
            'tenant_id' => $this->community,
            'pay_plan_id' => $planId,
            'status' => 'active',
            'starts_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->testTenantId = 1;
        $user = User::factory()->forTenant(1)->create([
            'status' => 'active', 'is_approved' => true,
            'role' => 'super_admin', 'is_super_admin' => true, 'is_god' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById(1);
        SuperPanelAccess::reset();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    /** @return array<string, array{0: string, 1: array<string, mixed>, 2: string}> */
    public static function retired(): array
    {
        return [
            'pause billing' => ['/v2/admin/super/billing/pause', [], 'Pause billing'],
            'resume billing' => ['/v2/admin/super/billing/resume', [], 'Pause billing'],
            'grace period' => ['/v2/admin/super/billing/grace-period', ['days' => 14], 'grace period'],
            'grant a delegate' => ['/v2/admin/super/billing/delegate/grant', ['scope' => 'view_billing'], 'Billing delegates'],
            'revoke a delegate' => ['/v2/admin/super/billing/delegate/revoke', ['scope' => 'view_billing'], 'Billing delegates'],
        ];
    }

    /** @param array<string, mixed> $body */
    #[\PHPUnit\Framework\Attributes\DataProvider('retired')]
    public function test_a_retired_switch_refuses_plainly_and_changes_nothing(string $uri, array $body, string $names): void
    {
        $target = (int) User::factory()->forTenant($this->community)->create()->id;
        $delegatesBefore = DB::table('billing_delegates')->count();
        $auditBefore = DB::table('billing_audit_log')->count();

        $response = $this->apiPost($uri, ['tenant_id' => $this->community, 'user_id' => $target] + $body);

        $this->assertSame(410, $response->getStatusCode());
        $this->assertSame('FEATURE_RETIRED', $response->json('errors.0.code'));
        $message = (string) $response->json('errors.0.message');
        $this->assertStringNotContainsString('api.', $message, 'a sentence, not a wording key');
        $this->assertStringContainsString($names, $message);
        $this->assertStringContainsString('retired', $message);

        $assignment = DB::table('tenant_plan_assignments')->where('id', $this->assignmentId)->first();
        $this->assertSame(0, (int) $assignment->is_paused);
        $this->assertNull($assignment->grace_period_ends_at);
        $this->assertSame($delegatesBefore, DB::table('billing_delegates')->count());
        $this->assertSame($auditBefore, DB::table('billing_audit_log')->count(), 'Nothing happened, so nothing is in the record.');
    }

    public function test_the_refusal_says_what_to_use_instead_in_the_readers_language(): void
    {
        $this->assertStringContainsString('Billing control', __('api.billing_pause_billing_retired'));
        $this->assertStringContainsString('paid-until date', __('api.billing_grace_period_retired'));
        $this->assertStringContainsString('Branch payments', __('api.billing_delegates_retired'));

        foreach (['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'] as $locale) {
            foreach (['billing_pause_billing_retired', 'billing_grace_period_retired', 'billing_delegates_retired'] as $key) {
                $text = __("api.{$key}", [], $locale);
                $this->assertNotSame("api.{$key}", $text, "{$locale}: {$key} is missing");
                $this->assertNotSame(__("api.{$key}", [], 'en'), $text, "{$locale}: {$key} is still English");
            }
        }
    }

    public function test_billing_control_no_longer_sends_the_grace_period_or_the_paused_flag(): void
    {
        DB::table('tenant_plan_assignments')->where('id', $this->assignmentId)->update([
            'is_paused' => 1,
            'grace_period_ends_at' => now()->addDays(10),
        ]);

        $row = collect(\App\Services\TenantBillingService::getBillingSnapshot())->firstWhere('id', $this->community);

        $this->assertArrayNotHasKey('is_in_grace_period', $row);
        $this->assertArrayNotHasKey('grace_days_remaining', $row);
        $this->assertArrayNotHasKey('is_paused', $row['current_plan']);
        $this->assertArrayNotHasKey('grace_period_ends_at', $row['current_plan']);
    }
}
