<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Services\BillingAutomationService;
use App\Services\BillingStandingNotifier;
use App\Services\BillingStandingService;
use App\Services\EmailDispatchService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\PlanTerms;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The member-limit notices under the rule for going over (DESIGN 6.5):
 *
 * - the 80% notice also reaches whoever the community pays;
 * - the 80% and "at the limit" notices say what the rule will do;
 * - the "over" notice's last line says what will happen, per rule.
 */
final class OverLimitNoticeTest extends TestCase
{
    use DatabaseTransactions;

    private LimitNoticeCapturingEmailDispatch $mailer;
    private int $hub;
    private int $child;
    private int $platformPayer;
    private string $childAdmin;
    private string $manager;
    private string $team;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();

        $this->mailer = new LimitNoticeCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);

        $this->hub = $this->makeCommunity('Notice rule hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Notice rule child', $this->hub, "/1/{$this->hub}/");
        $this->platformPayer = $this->makeCommunity('Notice rule platform payer', 1, '/1/');

        $this->childAdmin = $this->person($this->child, ['role' => 'admin']);
        $this->manager = $this->person($this->hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->team = $this->person($this->hub, ['role' => 'member', 'is_super_admin' => true, 'is_god' => true]);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            BillingSettings::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'ntcrule-' . bin2hex(random_bytes(5)),
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
    private function person(int $tenantId, array $attributes): string
    {
        $email = 'ntcrule.' . bin2hex(random_bytes(6)) . '@example.com';
        User::factory()->forTenant($tenantId)->create(array_merge([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ], $attributes));

        return $email;
    }

    /** @return array<string, mixed> */
    private function facts(array $extra = []): array
    {
        return $extra + [
            'active_members' => 85,
            'max_users' => 100,
            'plan_name' => 'Spark',
            'window_days' => 90,
        ];
    }

    private function body(string $email): string
    {
        $mail = $this->mailer->to($email);
        $this->assertNotEmpty($mail, "{$email} was not mailed");

        return $mail[0]['body'];
    }

    // ── Who is told ─────────────────────────────────────────────────────────

    public function test_the_80_percent_notice_reaches_the_hubs_managers(): void
    {
        BillingStandingNotifier::limitApproaching($this->child, $this->facts(['rule' => 'pause', 'grace_days' => 30]));

        $this->assertCount(1, $this->mailer->to($this->childAdmin));
        $this->assertCount(1, $this->mailer->to($this->manager));
        $this->assertStringContainsString('close to its member limit', $this->mailer->to($this->manager)[0]['subject']);
        $this->assertStringContainsString('pays your community', $this->body($this->manager));
    }

    public function test_the_80_percent_notice_reaches_the_platform_team_for_a_community_that_pays_the_platform(): void
    {
        $admin = $this->person($this->platformPayer, ['role' => 'admin']);

        BillingStandingNotifier::limitApproaching($this->platformPayer, $this->facts(['rule' => 'none', 'grace_days' => 30]));

        $this->assertCount(1, $this->mailer->to($admin));
        $this->assertCount(1, $this->mailer->to($this->team));
        $this->assertCount(0, $this->mailer->to($this->manager));
    }

    // ── What the earlier notices say the rule will do ───────────────────────

    /** @return array<string, array{0: string, 1: ?string, 2: ?string}> */
    public static function ruleLines(): array
    {
        return [
            'warn only says nothing more' => ['none', null, null],
            // At its number the door is shut from that moment (JoiningGate),
            // so "reached" says so plainly; "approaching" names what is to come.
            'stop new members' => ['block_joining', 'new members will not be able to join', 'From now on, new members cannot join until it is back under the limit'],
            'pause' => ['pause', 'stays over for 21 days, it will be paused automatically', 'stays over for 21 days, it will be paused automatically'],
            'move up' => ['upgrade', 'stays over for 21 days, it will be moved automatically to the smallest plan that fits', 'stays over for 21 days, it will be moved automatically to the smallest plan that fits'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('ruleLines')]
    public function test_the_approaching_and_reached_notices_say_what_the_rule_will_do(string $rule, ?string $approaching, ?string $reached): void
    {
        BillingStandingNotifier::limitApproaching($this->child, $this->facts(['rule' => $rule, 'grace_days' => 21]));
        BillingStandingNotifier::limitReached($this->child, $this->facts(['rule' => $rule, 'grace_days' => 21, 'active_members' => 100]));

        $mail = $this->mailer->to($this->childAdmin);
        $this->assertCount(2, $mail);
        foreach ([[$mail[0], $approaching], [$mail[1], $reached]] as [$one, $line]) {
            if ($line === null) {
                $this->assertStringNotContainsString('stays over for', $one['body']);
                $this->assertStringNotContainsString('will not be able to join', $one['body']);
                $this->assertStringNotContainsString('cannot join', $one['body']);
            } else {
                $this->assertStringContainsString($line, $one['body']);
            }
        }
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function moveThatWillNotHappen(): array
    {
        return [
            'no plan fits' => [['rule' => 'upgrade', 'rule_action' => 'upgrade', 'move_decision' => 'no_plan_fits']],
            'a specially agreed price' => [['rule' => 'upgrade', 'rule_action' => 'upgrade', 'move_decision' => 'custom_price']],
            'a card payer' => [['rule' => 'none', 'rule_action' => 'upgrade']],
        ];
    }

    /** @param array<string, mixed> $extra */
    #[\PHPUnit\Framework\Attributes\DataProvider('moveThatWillNotHappen')]
    public function test_the_approaching_and_reached_notices_promise_no_move_that_will_not_happen(array $extra): void
    {
        BillingStandingNotifier::limitApproaching($this->child, $this->facts($extra + ['grace_days' => 21]));
        BillingStandingNotifier::limitReached($this->child, $this->facts($extra + ['grace_days' => 21, 'active_members' => 100]));

        $mail = $this->mailer->to($this->childAdmin);
        $this->assertCount(2, $mail);
        foreach ($mail as $one) {
            $this->assertStringNotContainsString('it will be moved automatically', $one['body']);
            $this->assertStringContainsString('cannot be moved to a bigger plan automatically', $one['body']);
        }
    }

    // ── The "over" notice's closing line ────────────────────────────────────

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function closingLines(): array
    {
        return [
            'warn only' => [['rule' => 'none', 'rule_action' => 'none'], 'Nothing has changed for its members'],
            'pause' => [['rule' => 'pause', 'rule_action' => 'pause', 'pause_date' => '2027-04-09'], 'If it is still over the limit on <strong>2027-04-09</strong>, it will be paused'],
            'stop new members' => [['rule' => 'block_joining', 'rule_action' => 'block_joining'], 'new members cannot join until it is back under the limit'],
            'move up' => [['rule' => 'upgrade', 'rule_action' => 'upgrade', 'move_date' => '2027-04-09', 'move_plan' => 'Local'], 'it will be moved automatically to the <strong>Local</strong> plan'],
            'move up with no plan that fits' => [['rule' => 'upgrade', 'rule_action' => 'upgrade'], 'cannot be moved to a bigger plan automatically'],
            'move up on a card payer' => [['rule' => 'none', 'rule_action' => 'upgrade'], 'cannot be moved to a bigger plan automatically'],
        ];
    }

    /** @param array<string, mixed> $extra */
    #[\PHPUnit\Framework\Attributes\DataProvider('closingLines')]
    public function test_each_over_notice_closes_with_what_the_rule_will_do(array $extra, string $line): void
    {
        BillingStandingNotifier::limitOver($this->child, $this->facts($extra + ['active_members' => 101, 'grace_days' => 30]));

        $this->assertStringContainsString($line, $this->body($this->childAdmin));
        $this->assertStringContainsString($line, $this->body($this->manager), 'Whoever it pays reads the same line.');
        if ($extra['rule'] === 'upgrade' && isset($extra['move_date'])) {
            $this->assertStringContainsString('2027-04-09', $this->body($this->childAdmin));
        }
    }

    public function test_the_move_up_line_names_the_plans_price_in_the_communitys_currency(): void
    {
        // DESIGN 6.5: "it will move to PLAN (price) on DATE".
        BillingStandingNotifier::limitOver($this->child, $this->facts([
            'active_members' => 101, 'grace_days' => 30, 'rule' => 'upgrade', 'rule_action' => 'upgrade',
            'move_date' => '2027-04-09', 'move_plan' => 'Local', 'move_price_monthly' => 199.0, 'move_price_yearly' => 1990.0, 'move_currency' => 'gbp',
        ]));

        $body = $this->body($this->childAdmin);
        $this->assertStringContainsString('<strong>Local</strong> plan (£199.00 a month)', $body);
        $this->assertStringContainsString('2027-04-09', $body);
        $this->assertStringNotContainsString('€', $body);
    }

    public function test_the_move_up_line_without_a_price_names_only_the_plan(): void
    {
        BillingStandingNotifier::limitOver($this->child, $this->facts([
            'active_members' => 101, 'rule' => 'upgrade', 'move_date' => '2027-04-09', 'move_plan' => 'Local', 'move_price_monthly' => 0,
        ]));

        $this->assertStringContainsString('<strong>Local</strong> plan, the smallest that fits', $this->body($this->childAdmin));
    }

    public function test_the_limit_notices_say_how_many_sends_the_mailer_accepted(): void
    {
        // Task 5A C1: an outage answers false, it does not throw.
        $counts = BillingStandingNotifier::limitOver($this->child, $this->facts(['active_members' => 101, 'rule' => 'none']));
        $this->assertSame(['tried' => 2, 'accepted' => 2], $counts, 'The child admin and the hub manager.');

        app()->instance(EmailDispatchService::class, new class () extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return false;
            }
        });
        $this->assertSame(['tried' => 2, 'accepted' => 0], BillingStandingNotifier::limitOver($this->child, $this->facts(['active_members' => 101, 'rule' => 'none'])));
        $this->assertSame(['tried' => 2, 'accepted' => 0], BillingStandingNotifier::limitApproaching($this->child, $this->facts(['rule' => 'none'])));
    }

    public function test_an_address_refused_before_the_mailer_is_not_counted_as_tried(): void
    {
        $hub = $this->makeCommunity('Unroutable notice hub', 1, '/1/', true);
        $child = $this->makeCommunity('Unroutable notice child', $hub, "/1/{$hub}/");
        User::factory()->forTenant($child)->create([
            'email' => 'admin.' . bin2hex(random_bytes(4)) . '@nowhere.test',
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'preferred_language' => 'en',
        ]);
        // The hub's manager cannot be reached either. Without a manager at
        // all, the platform team is told instead (since 21 Nov 2026), which
        // is a different thing from this test's subject.
        User::factory()->forTenant($hub)->create([
            'email' => 'manager.' . bin2hex(random_bytes(4)) . '@nowhere.test',
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'is_tenant_super_admin' => true, 'preferred_language' => 'en',
        ]);

        $this->assertSame(['tried' => 0, 'accepted' => 0], BillingStandingNotifier::limitOver($child, $this->facts(['active_members' => 101, 'rule' => 'none'])));
    }

    public function test_the_decision_mail_writes_numbers_in_the_readers_format(): void
    {
        BillingStandingNotifier::moveNeedsDecision($this->child, $this->facts(['reason' => 'no_plan_fits', 'active_members' => 12345, 'max_users' => 10000]));

        $body = $this->body($this->manager);
        $this->assertStringContainsString('12,345', $body);
        $this->assertStringContainsString('10,000', $body);
    }

    public function test_a_caller_without_a_rule_is_read_as_before(): void
    {
        BillingStandingNotifier::limitOver($this->child, $this->facts(['pause_date' => '2027-04-09']));
        $this->assertStringContainsString('it will be paused', $this->body($this->childAdmin));
    }

    // ── Through the daily check ─────────────────────────────────────────────

    public function test_the_daily_check_names_the_plan_a_move_up_would_go_to(): void
    {
        $spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $sparkMax = (int) DB::table('pay_plans')->where('id', $spark)->value('max_users');
        DB::table('tenant_plan_assignments')->insert(['tenant_id' => $this->platformPayer, 'pay_plan_id' => $spark, 'status' => 'active']);
        $admin = $this->person($this->platformPayer, ['role' => 'admin']);
        $this->addActiveMembers($this->platformPayer, $sparkMax + 1);
        BillingSettings::set('automation_enabled', true, null);
        BillingStandingService::setOverLimitRule($this->platformPayer, 'upgrade', 10, (int) User::withoutGlobalScopes()->where('email', $this->team)->value('id'));

        $today = CarbonImmutable::parse('2027-03-10');
        $outcome = BillingAutomationService::run($today);
        $entry = array_values(array_filter($outcome, fn ($e) => $e['tenant_id'] === $this->platformPayer))[0];

        $this->assertSame('over', $entry['action']);
        $this->assertSame('upgrade', $entry['detail']['rule']);
        $fits = PlanTerms::smallestFitting($this->platformPayer, $sparkMax + 1);
        $this->assertSame($fits['name'], $entry['detail']['move_plan']);
        $this->assertSame('2027-03-20', $entry['detail']['move_date']);
        $this->assertStringContainsString('<strong>' . $fits['name'] . '</strong> plan', $this->body($admin));
        $this->assertFalse(BillingLock::isLocked($this->platformPayer), 'Move up never pauses.');
    }

    public function test_the_daily_checks_approaching_notice_promises_no_move_for_a_specially_agreed_price(): void
    {
        $spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $sparkMax = (int) DB::table('pay_plans')->where('id', $spark)->value('max_users');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->platformPayer, 'pay_plan_id' => $spark, 'status' => 'active', 'custom_price_monthly' => 5,
        ]);
        $admin = $this->person($this->platformPayer, ['role' => 'admin']);
        // At the warning percent, under the member number.
        $this->addActiveMembers($this->platformPayer, (int) ceil($sparkMax * 0.85));
        BillingSettings::set('automation_enabled', true, null);
        BillingStandingService::setOverLimitRule($this->platformPayer, 'upgrade', 10, (int) User::withoutGlobalScopes()->where('email', $this->team)->value('id'));

        $outcome = BillingAutomationService::run(CarbonImmutable::parse('2027-03-10'));
        $entry = array_values(array_filter($outcome, fn ($e) => $e['tenant_id'] === $this->platformPayer))[0];

        $this->assertSame('approaching', $entry['action']);
        $this->assertSame('custom_price', $entry['detail']['move_decision']);
        $body = $this->body($admin);
        $this->assertStringNotContainsString('it will be moved automatically', $body);
        $this->assertStringContainsString('cannot be moved to a bigger plan automatically', $body);
    }

    public function test_the_platform_team_is_told_once_that_a_card_payer_set_to_move_up_needs_moving_by_hand(): void
    {
        $spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $sparkMax = (int) DB::table('pay_plans')->where('id', $spark)->value('max_users');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->platformPayer, 'pay_plan_id' => $spark, 'status' => 'active',
            'stripe_subscription_id' => 'sub_notice_' . bin2hex(random_bytes(4)),
        ]);
        $this->addActiveMembers($this->platformPayer, $sparkMax + 1);
        BillingSettings::setMany(['automation_enabled' => true, 'over_limit_action' => 'upgrade'], null);

        $today = CarbonImmutable::parse('2027-03-10');
        BillingAutomationService::run($today);
        BillingAutomationService::run($today->addDay());

        $mail = $this->mailer->to($this->team);
        $this->assertCount(1, $mail, 'Once per over episode.');
        $this->assertStringContainsString('cannot be moved to a bigger plan automatically', $mail[0]['body']);
    }

    private function addActiveMembers(int $tenantId, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'first_name' => 'Active',
                'last_name' => 'Member',
                'name' => 'Active Member',
                'email' => 'ntcrule.m.' . bin2hex(random_bytes(7)) . '@example.com',
                'password_hash' => 'x',
                'role' => 'member',
                'status' => 'active',
                'is_approved' => 1,
                'last_login_at' => now()->subDays(5),
                'created_at' => now(),
            ];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('users')->insert($chunk);
        }
    }
}

final class LimitNoticeCapturingEmailDispatch extends EmailDispatchService
{
    /** @var list<array{to: string, subject: string, body: string}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

        return true;
    }

    /** @return list<array{to: string, subject: string, body: string}> */
    public function to(string $email): array
    {
        return array_values(array_filter($this->sent, static fn (array $m): bool => $m['to'] === $email));
    }
}
