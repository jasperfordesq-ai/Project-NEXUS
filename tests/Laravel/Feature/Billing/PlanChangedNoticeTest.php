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
use App\Services\BillingStandingNotifier;
use App\Services\EmailDispatchService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A community's admins are told when its plan changes: every admin, each in
 * their own language, with the plan, its member number and its price in the
 * currency the community is billed in, linking to the admin panel.
 *
 * Replaces assignPlan()'s own email, which went to one admin, quoted the
 * default euro price with a hard-coded "€" and linked to a page most
 * communities are never shown.
 */
final class PlanChangedNoticeTest extends TestCase
{
    use DatabaseTransactions;

    private PlanNoticeCapturingEmailDispatch $mailer;
    private int $hub;
    private int $child;
    private int $local;
    private int $spark;

    protected function setUp(): void
    {
        parent::setUp();

        $this->mailer = new PlanNoticeCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);

        $this->hub = $this->makeCommunity('Notice plan hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Notice plan child', $this->hub, "/1/{$this->hub}/");
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');

        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            PlanTerms::flush();
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false, ?string $currency = null): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'planmail-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        if ($currency !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $id,
                'setting_key' => 'general.default_currency',
                'setting_value' => $currency,
            ]);
        }

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function person(int $tenantId, array $attributes): string
    {
        $email = 'planmail.' . bin2hex(random_bytes(6)) . '@example.com';
        User::factory()->forTenant($tenantId)->create(array_merge([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ], $attributes));

        return $email;
    }

    private function assign(int $tenantId, int $planId): void
    {
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ]);
    }

    public function test_every_admin_is_told_and_nobody_else(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);
        $flagOnly = $this->person($this->child, ['role' => 'member', 'is_tenant_super_admin' => true]);
        $member = $this->person($this->child, ['role' => 'member']);
        $broker = $this->person($this->child, ['role' => 'broker']);
        $hubManager = $this->person($this->hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->assign($this->child, $this->local);

        $sent = BillingStandingNotifier::planChanged($this->child, TenantBillingService::planChangedFacts($this->child, 'Spark'));

        $this->assertSame(2, $sent);
        $this->assertCount(1, $this->mailer->to($admin));
        $this->assertCount(1, $this->mailer->to($flagOnly));
        foreach ([$member, $broker, $hubManager] as $notTold) {
            $this->assertCount(0, $this->mailer->to($notTold), 'Only the community\'s own admins are told.');
        }

        $mail = $this->mailer->to($admin)[0];
        $this->assertSame('billing', $mail['options']['category']);
        $this->assertStringContainsString('Notice plan child', $mail['subject']);
        $this->assertStringContainsString('Local', $mail['body']);
        $this->assertStringContainsString('Spark', $mail['body'], 'The plan it was on before is named.');
        $this->assertStringContainsString('300', $mail['body'], 'The member number is given.');
        $this->assertStringContainsString('Notice plan hub', $mail['body'], 'It is told whom it pays.');
        $this->assertMatchesRegularExpression('#/admin"#', $mail['body'], 'The button opens the admin panel.');
        $this->assertStringNotContainsString('/admin/billing', $mail['body']);
    }

    public function test_each_admin_is_told_in_their_own_language(): void
    {
        $english = $this->person($this->child, ['role' => 'admin', 'preferred_language' => 'en']);
        // German: one of the locales the test bootstrap loads
        // (app.test_translation_locales).
        $german = $this->person($this->child, ['role' => 'admin', 'preferred_language' => 'de']);
        $this->assign($this->child, $this->local);

        BillingStandingNotifier::planChanged($this->child, TenantBillingService::planChangedFacts($this->child, null));

        $this->assertStringContainsString('is now on the Local plan', $this->mailer->to($english)[0]['subject']);
        $this->assertStringContainsString('hat jetzt den Tarif', $this->mailer->to($german)[0]['subject']);
        $germanBody = $this->mailer->to($german)[0]['body'];
        $this->assertStringNotContainsString('emails_misc.', $germanBody, 'No raw key reaches anyone.');
        // Money in the reader's own format: German writes "229,00 €".
        $this->assertStringContainsString('229,00', $germanBody);
        $this->assertStringContainsString('229.00', $this->mailer->to($english)[0]['body']);
    }

    public function test_a_community_billed_in_pounds_sees_pounds(): void
    {
        $pounds = $this->makeCommunity('Notice pound community', 1, '/1/', false, 'GBP');
        $admin = $this->person($pounds, ['role' => 'admin']);
        $this->assign($pounds, $this->local);

        BillingStandingNotifier::planChanged($pounds, TenantBillingService::planChangedFacts($pounds, null));

        $body = $this->mailer->to($admin)[0]['body'];
        $this->assertStringContainsString('£199', $body, 'The pound price of the plan, with a pound sign.');
        $this->assertStringNotContainsString('€', $body);
        $this->assertStringNotContainsString('229', $body, 'Not the euro amount.');
    }

    public function test_a_community_billed_in_euro_sees_euro(): void
    {
        $euro = $this->makeCommunity('Notice euro community', 1, '/1/');
        $admin = $this->person($euro, ['role' => 'admin']);
        $this->assign($euro, $this->local);

        BillingStandingNotifier::planChanged($euro, TenantBillingService::planChangedFacts($euro, null));

        $body = $this->mailer->to($admin)[0]['body'];
        $this->assertStringContainsString('€229', $body);
        $this->assertStringNotContainsString('£', $body);
    }

    public function test_a_child_that_pays_its_hub_is_quoted_the_hubs_price(): void
    {
        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $this->hub,
            'pay_plan_id' => $this->local,
            'price_monthly' => 150.00,
            'max_users' => 250,
            'is_offered' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        PlanTerms::flush();
        $admin = $this->person($this->child, ['role' => 'admin']);

        // Through the hub manager's own action, end to end.
        $manager = User::factory()->forTenant($this->hub)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'is_tenant_super_admin' => true,
        ]);
        $this->testTenantId = $this->hub;
        Sanctum::actingAs($manager, ['*']);
        TenantContext::setById($this->hub);
        SuperPanelAccess::reset();

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local])->assertStatus(200);

        $body = $this->mailer->to($admin)[0]['body'];
        $this->assertStringContainsString('€150', $body, 'The hub\'s price.');
        $this->assertStringNotContainsString('229', $body, 'Not the default price.');
        $this->assertStringContainsString('250', $body, 'The hub\'s member number.');
    }

    public function test_with_two_active_records_the_newest_one_is_described(): void
    {
        $direct = $this->makeCommunity('Notice two records', 1, '/1/');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $direct, 'pay_plan_id' => $this->spark, 'status' => 'active', 'custom_price_monthly' => 1.00,
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $direct, 'pay_plan_id' => $this->local, 'status' => 'active', 'custom_price_monthly' => 77.00,
        ]);

        $facts = TenantBillingService::planChangedFacts($direct, null);

        $this->assertSame('Local', $facts['plan_name']);
        $this->assertEquals(77.0, $facts['price_monthly'], 'The newest record\'s own price, not the older one\'s.');
    }

    public function test_a_plan_with_no_price_reads_as_no_charge_recorded(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);

        BillingStandingNotifier::planChanged($this->child, [
            'plan_name' => 'Free plan',
            'max_users' => 50,
            'price_monthly' => null,
            'price_yearly' => 0.0,
            'currency' => 'eur',
        ]);

        $body = $this->mailer->to($admin)[0]['body'];
        $this->assertStringContainsString('No charge is recorded', $body);
        $this->assertStringNotContainsString('0.00', $body);
        $this->assertStringNotContainsString('€', $body);
    }

    public function test_the_platform_teams_assign_now_tells_every_admin_in_the_right_currency(): void
    {
        $pounds = $this->makeCommunity('Notice assigned pound community', 1, '/1/', false, 'GBP');
        $first = $this->person($pounds, ['role' => 'admin']);
        $second = $this->person($pounds, ['role' => 'admin']);
        $this->assign($pounds, $this->spark);

        TenantBillingService::assignPlan($pounds, $this->local, null, null, 1);

        foreach ([$first, $second] as $admin) {
            $mail = $this->mailer->to($admin);
            $this->assertCount(1, $mail, 'Every admin, not the first one found.');
            $this->assertStringContainsString('£', $mail[0]['body']);
            $this->assertStringNotContainsString('€', $mail[0]['body']);
            $this->assertStringNotContainsString('/admin/billing', $mail[0]['body']);
        }
    }
}

/** Records every email instead of sending it, so a test can read the body. */
final class PlanNoticeCapturingEmailDispatch extends EmailDispatchService
{
    /** @var list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body, 'options' => $options];

        return true;
    }

    /** @return list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    public function to(string $email): array
    {
        return array_values(array_filter($this->sent, static fn (array $m): bool => $m['to'] === $email));
    }
}
