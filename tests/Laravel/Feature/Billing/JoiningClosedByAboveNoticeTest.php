<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\EmailDispatchService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Task 7A: a community whose door is shut by a full community ABOVE it is
 * told first, by the daily check, and told again when joining opens.
 *
 * Tree:  tenant 1 ─ hub (block_joining, member number 13) ─ child
 *
 * The child's 13 active members count towards the hub's number, so the hub
 * is at its number. The hub has been told (TellsCommunityOfMemberLimit).
 */
final class JoiningClosedByAboveNoticeTest extends TestCase
{
    use DatabaseTransactions;
    use BillingAutomationFixtures;
    use TellsCommunityOfMemberLimit;

    private const MAX = 13;

    private int $hub;
    private int $child;
    private int $plan;
    private string $hubAdmin;
    private string $childAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAutomation();
        PlanTerms::flush();
        JoiningGate::flush();

        $this->hub = $this->makeCommunity('Notice hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Notice child', $this->hub, "/1/{$this->hub}/");
        $this->hubAdmin = $this->person($this->hub, ['role' => 'admin']);
        $this->childAdmin = $this->person($this->child, ['role' => 'admin']);

        $this->plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Zeta Lumen Plan',
            'slug' => 'notice-plan-' . bin2hex(random_bytes(5)),
            'tier_level' => 1,
            'max_users' => self::MAX,
            'price_monthly' => 987.65,
            'price_yearly' => 9876.54,
            'is_standard' => 1,
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->hub, 'pay_plan_id' => $this->plan, 'status' => 'active',
        ]);
        $this->standing($this->hub, ['over_limit_action' => 'block_joining', 'exempt' => 0]);
        $this->addActiveMembers($this->child, self::MAX);

        $this->switchOn();
        $this->tellCommunityOfMemberLimit($this->hub);
    }

    protected function tearDown(): void
    {
        try {
            JoiningGate::flush();
            PlanTerms::flush();
        } finally {
            $this->tearDownAutomation();
        }
    }

    public function test_a_child_is_told_before_its_door_shuts(): void
    {
        $this->assertNotNull(JoiningGate::closedBy($this->hub), 'precondition: the hub itself is shut');
        $this->assertNull(JoiningGate::closedBy($this->child), 'the child has not been told: open');

        $outcome = BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame(['member_limit:joining_closed_by_above'], $this->actionsFor($outcome, $this->child));
        $entry = $this->entryFor($outcome, $this->child);
        $this->assertSame(['tenant_id' => $this->hub, 'tenant_name' => 'Notice hub'], $entry['detail']['closed_by'] ?? null);

        $mail = $this->mailTo($this->childAdmin);
        $this->assertCount(1, $mail);
        $this->assertSame(
            __('emails_misc.billing_standing.joining_closed_above_subject', ['community' => 'Notice child']),
            $mail[0]->subject
        );
        $this->assertSame('billing', $mail[0]->category);
        $this->assertSame([], $this->mailTo($this->hubAdmin), 'the hub was told already and is not told again');

        $this->assertSame(JoiningGate::noticeKeyFor($this->hub), $this->standingRow($this->child)->joining_closed_notice_key);
        $this->assertSame(['tenant_id' => $this->hub, 'active' => self::MAX, 'max' => self::MAX], JoiningGate::closedBy($this->child));
    }

    public function test_the_child_email_names_no_figures(): void
    {
        $recorder = new ChildNoticeRecordingDispatch();
        app()->instance(EmailDispatchService::class, $recorder);

        BillingAutomationService::run();

        $toChild = array_values(array_filter($recorder->sent, fn (array $m): bool => $m['to'] === $this->childAdmin));
        $this->assertCount(1, $toChild);
        $text = $this->visibleText($toChild[0]['body']);

        $this->assertStringContainsString('Notice hub', $text, 'it names the community above');
        $this->assertStringContainsString('Notice child', $text);
        foreach ([$toChild[0]['subject'], $text] as $where) {
            $this->assertStringNotContainsString('Zeta', $where, 'no plan name');
            $this->assertStringNotContainsString('Lumen', $where, 'no plan name');
            $this->assertStringNotContainsString('987', $where, 'no price');
            $this->assertStringNotContainsString('9876', $where, 'no price');
            $this->assertDoesNotMatchRegularExpression('/\b' . self::MAX . '\b/', $where, 'no member number or count');
        }
    }

    public function test_a_failed_child_send_keeps_the_door_open_and_retries(): void
    {
        app()->instance(EmailDispatchService::class, new RefusingEmailDispatch());

        $outcome = BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame(['member_limit:joining_closed_by_above'], $this->actionsFor($outcome, $this->child), 'the attempt is listed');
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key ?? null, 'nothing recorded');
        $this->assertNull(JoiningGate::closedBy($this->child), 'not told: still open');

        $this->standInAcceptingMailProvider();
        BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertCount(1, $this->mailTo($this->childAdmin));
        $this->assertSame(JoiningGate::noticeKeyFor($this->hub), $this->standingRow($this->child)->joining_closed_notice_key);
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'told at the retry: shut');
    }

    public function test_a_child_is_told_once(): void
    {
        BillingAutomationService::run();
        $second = BillingAutomationService::run();
        $third = BillingAutomationService::run();

        $this->assertSame([], $this->actionsFor($second, $this->child));
        $this->assertSame([], $this->actionsFor($third, $this->child));
        $this->assertCount(1, $this->mailTo($this->childAdmin));
    }

    public function test_the_child_is_told_when_joining_opens_again(): void
    {
        BillingAutomationService::run();
        $this->assertCount(1, $this->mailTo($this->childAdmin));

        // Clearly under its number (8 of 13): the hub's door opens.
        $this->retire($this->child, 5);
        JoiningGate::flush();

        $outcome = BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame(['member_limit:joining_opened_again'], $this->actionsFor($outcome, $this->child));
        $mail = $this->mailTo($this->childAdmin);
        $this->assertCount(2, $mail);
        $this->assertSame(
            __('emails_misc.billing_standing.joining_opened_again_subject', ['community' => 'Notice child']),
            $mail[1]->subject
        );
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key);
        $this->assertNull(JoiningGate::closedBy($this->child));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run(), $this->child));
        $this->assertCount(2, $this->mailTo($this->childAdmin), 'nothing more');
    }

    public function test_a_change_of_the_parents_terms_re_tells_the_child(): void
    {
        BillingAutomationService::run();
        $firstKey = $this->standingRow($this->child)->joining_closed_notice_key;
        $this->assertNotNull($firstKey);

        // The hub's days change: its terms key changes.
        $this->standing($this->hub, ['over_limit_grace_days' => 45]);
        BillingLock::flush();
        JoiningGate::flush();
        $this->assertNull(JoiningGate::closedBy($this->child), 'told under the old terms: open');

        $outcome = BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame(['member_limit:joining_closed_by_above'], $this->actionsFor($outcome, $this->child));
        $newKey = $this->standingRow($this->child)->joining_closed_notice_key;
        $this->assertNotSame($firstKey, $newKey);
        $this->assertSame(JoiningGate::noticeKeyFor($this->hub), $newKey);
        $this->assertCount(2, $this->mailTo($this->childAdmin));
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'told under the new terms: shut');
    }

    public function test_a_grandchild_under_an_exempt_child_is_not_told_and_not_shut(): void
    {
        $grandchild = $this->makeCommunity('Notice grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $grandchildAdmin = $this->person($grandchild, ['role' => 'admin']);
        $this->addActiveMembers($grandchild, 2);
        $this->standing($this->child, ['exempt' => 1, 'exempt_reason' => 'Pilot']);
        BillingLock::flush();
        JoiningGate::flush();

        $outcome = BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame([], $this->actionsFor($outcome, $grandchild));
        $this->assertSame([], $this->actionsFor($outcome, $this->child));
        $this->assertSame([], $this->mailTo($grandchildAdmin));
        $this->assertSame([], $this->mailTo($this->childAdmin));
        $this->assertNull($this->standingRow($grandchild)->joining_closed_notice_key ?? null);
        $this->assertNull(JoiningGate::closedBy($grandchild));
        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_a_paused_child_is_not_told(): void
    {
        $this->standing($this->child, [
            'suspended_at' => now()->subDay(),
            'suspension_source' => 'manual',
            'suspension_reason' => 'non_payment',
        ]);
        BillingLock::flush();
        JoiningGate::flush();

        $outcome = BillingAutomationService::run();

        $this->assertSame([], $this->actionsFor($outcome, $this->child));
        $this->assertSame([], $this->mailTo($this->childAdmin));
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key);
    }

    public function test_nothing_runs_while_the_checks_are_off(): void
    {
        BillingSettings::set('automation_enabled', false, null);

        $this->assertSame([], BillingAutomationService::run());
        $this->assertSame([], $this->mailTo($this->childAdmin));
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key ?? null, 'no key written');

        // Told while the checks were on; the hub then drops under while they
        // are off: nothing is cleared and nobody is told.
        $this->switchOn();
        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);
        $key = $this->standingRow($this->child)->joining_closed_notice_key;
        BillingSettings::set('automation_enabled', false, null);
        $this->retire($this->child, 5);

        $this->assertSame([], BillingAutomationService::run());
        $this->assertSame([], $this->mailTo($this->childAdmin));
        $this->assertSame($key, $this->standingRow($this->child)->joining_closed_notice_key, 'no key cleared');

        // A preview with the checks off lists nothing for the door from above
        // either: no false "opened again".
        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview(), $this->child));
        $this->assertSame($key, $this->standingRow($this->child)->joining_closed_notice_key);
    }

    public function test_switching_the_checks_on_re_tells_the_child_before_its_door_shuts(): void
    {
        BillingAutomationService::run();
        $this->assertCount(1, $this->mailTo($this->childAdmin));
        $this->assertNotNull($this->standingRow($this->child)->joining_closed_notice_key);

        BillingSettings::set('automation_enabled', false, null);
        BillingSettings::set('automation_enabled', true, null);
        JoiningGate::flush();

        // Nothing acted while the checks were off, so nothing told then counts.
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key, 'the child is not told any more');
        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertCount(1, $this->mailTo($this->childAdmin), 'no email for the switch itself');

        $outcome = BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame(['member_limit:joining_closed_by_above'], $this->actionsFor($outcome, $this->child));
        $this->assertCount(2, $this->mailTo($this->childAdmin), 'told again on the first run');
        $this->assertSame(JoiningGate::noticeKeyFor($this->hub), $this->standingRow($this->child)->joining_closed_notice_key);
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'told afresh: shut');
    }

    public function test_an_exempt_child_has_its_key_cleared_without_an_email(): void
    {
        BillingAutomationService::run();
        $this->assertCount(1, $this->mailTo($this->childAdmin));

        $this->standing($this->child, ['exempt' => 1, 'exempt_reason' => 'Pilot']);
        BillingLock::flush();
        JoiningGate::flush();

        $outcome = BillingAutomationService::run();

        $this->assertSame([], $this->actionsFor($outcome, $this->child));
        $this->assertCount(1, $this->mailTo($this->childAdmin), 'no email');
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key, 'key cleared');

        // Lifting the exemption starts afresh: told again before it shuts.
        $this->standing($this->child, ['exempt' => 0, 'exempt_reason' => null]);
        BillingLock::flush();
        JoiningGate::flush();
        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_preview_lists_the_child_notice_and_writes_nothing(): void
    {
        $outcome = BillingAutomationService::preview();

        $this->assertSame(['member_limit:joining_closed_by_above'], $this->actionsFor($outcome, $this->child));
        $this->assertSame(['tenant_id' => $this->hub, 'tenant_name' => 'Notice hub'], $this->entryFor($outcome, $this->child)['detail']['closed_by'] ?? null);
        $this->assertSame([], $this->mailTo($this->childAdmin));
        $this->assertNull($this->standingRow($this->child)->joining_closed_notice_key ?? null);

        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);
        $key = $this->standingRow($this->child)->joining_closed_notice_key;
        $this->retire($this->child, 5);
        JoiningGate::flush();

        $outcome = BillingAutomationService::preview();

        $this->assertSame(['member_limit:joining_opened_again'], $this->actionsFor($outcome, $this->child));
        $this->assertSame([], $this->mailTo($this->childAdmin));
        $this->assertSame($key, $this->standingRow($this->child)->joining_closed_notice_key, 'nothing cleared');
    }

    // ------------------------------------------------------------------ helpers

    private function addActiveMembers(int $tenantId, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'first_name' => 'Notice',
                'last_name' => 'Member',
                'name' => 'Notice Member',
                'email' => 'notice.' . bin2hex(random_bytes(7)) . '@example.com',
                'password_hash' => 'x',
                'role' => 'member',
                'status' => 'active',
                'is_approved' => 1,
                'last_login_at' => now()->subDays(5),
                'created_at' => now(),
            ];
        }
        DB::table('users')->insert($rows);
        JoiningGate::flush();
    }

    /** Make $count of the community's recent members no longer active. */
    private function retire(int $tenantId, int $count): void
    {
        $ids = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('email', 'like', 'notice.%')
            ->where('last_login_at', '>=', now()->subDays(90))
            ->limit($count)
            ->pluck('id')
            ->all();
        DB::table('users')->whereIn('id', $ids)->update(['last_login_at' => now()->subDays(200)]);
        JoiningGate::flush();
    }

    /**
     * @param list<array{tenant_id:int, clock:string, action:string, detail:array<string, mixed>}> $outcome
     * @return array{tenant_id:int, clock:string, action:string, detail:array<string, mixed>}|null
     */
    private function entryFor(array $outcome, int $tenantId): ?array
    {
        foreach ($outcome as $entry) {
            if ($entry['tenant_id'] === $tenantId) {
                return $entry;
            }
        }

        return null;
    }

    /** The words a reader sees: no styles, no markup, entities decoded. */
    private function visibleText(string $html): string
    {
        $html = (string) preg_replace('#<(style|script|head)\b[^>]*>.*?</\1>#is', ' ', $html);

        return html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
}

/** Keeps every message a test sends, and accepts it. */
final class ChildNoticeRecordingDispatch extends EmailDispatchService
{
    /** @var list<array{to:string, subject:string, body:string}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

        return true;
    }
}
