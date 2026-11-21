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

    /** @return array<string, array{0: string, 1: ?string}> */
    public static function ruleLines(): array
    {
        return [
            'warn only says nothing more' => ['none', null],
            'stop new members' => ['block_joining', 'new members will not be able to join'],
            'pause' => ['pause', 'stays over for 21 days, it will be paused automatically'],
            'move up' => ['upgrade', 'stays over for 21 days, it will be moved automatically to the smallest package that fits'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('ruleLines')]
    public function test_the_approaching_and_reached_notices_say_what_the_rule_will_do(string $rule, ?string $line): void
    {
        BillingStandingNotifier::limitApproaching($this->child, $this->facts(['rule' => $rule, 'grace_days' => 21]));
        BillingStandingNotifier::limitReached($this->child, $this->facts(['rule' => $rule, 'grace_days' => 21, 'active_members' => 100]));

        foreach ($this->mailer->to($this->childAdmin) as $mail) {
            if ($line === null) {
                $this->assertStringNotContainsString('stays over for', $mail['body']);
                $this->assertStringNotContainsString('will not be able to join', $mail['body']);
            } else {
                $this->assertStringContainsString($line, $mail['body']);
            }
        }
        $this->assertCount(2, $this->mailer->to($this->childAdmin));
    }

    // ── The "over" notice's closing line ────────────────────────────────────

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function closingLines(): array
    {
        return [
            'warn only' => [['rule' => 'none', 'rule_action' => 'none'], 'Nothing has changed for its members'],
            'pause' => [['rule' => 'pause', 'rule_action' => 'pause', 'pause_date' => '2027-04-09'], 'If it is still over the limit on <strong>2027-04-09</strong>, it will be paused'],
            'stop new members' => [['rule' => 'block_joining', 'rule_action' => 'block_joining'], 'new members cannot join until it is back under the limit'],
            'move up' => [['rule' => 'upgrade', 'rule_action' => 'upgrade', 'move_date' => '2027-04-09', 'move_plan' => 'Local'], 'it will be moved automatically to the <strong>Local</strong> package'],
            'move up with no plan that fits' => [['rule' => 'upgrade', 'rule_action' => 'upgrade'], 'cannot be moved to a bigger package automatically'],
            'move up on a card payer' => [['rule' => 'none', 'rule_action' => 'upgrade'], 'cannot be moved to a bigger package automatically'],
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
        $this->assertStringContainsString('<strong>' . $fits['name'] . '</strong> package', $this->body($admin));
        $this->assertFalse(BillingLock::isLocked($this->platformPayer), 'Move up never pauses.');
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
        $this->assertStringContainsString('cannot be moved to a bigger package automatically', $mail[0]['body']);
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
