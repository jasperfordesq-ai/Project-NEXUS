<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * "Stop new members joining" (DESIGN 6.4): when is a community's door shut?
 *
 * Tree:  tenant 1 ─ hub ─ child
 *                       └ sibling
 */
final class JoiningGateTest extends TestCase
{
    use DatabaseTransactions;
    use TellsCommunityOfMemberLimit;

    private int $hub;
    private int $child;
    private int $sibling;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();
        JoiningGate::flush();

        $this->hub = $this->makeCommunity('Gate hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Gate child', $this->hub, "/1/{$this->hub}/");
        $this->sibling = $this->makeCommunity('Gate sibling', $this->hub, "/1/{$this->hub}/");

        BillingSettings::set('automation_enabled', true, null);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            JoiningGate::swapAnswerForTesting(null);
            JoiningGate::flush();
            BillingLock::flush();
            BillingSettings::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    public function test_at_the_limit_the_door_is_shut(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);

        $this->assertSame(['tenant_id' => $this->child, 'active' => 3, 'max' => 3], JoiningGate::closedBy($this->child));
        $this->assertSame(0, JoiningGate::roomLeft($this->child));
    }

    public function test_over_the_limit_the_door_is_shut(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 4);

        $this->assertSame(['tenant_id' => $this->child, 'active' => 4, 'max' => 3], JoiningGate::closedBy($this->child));
        $this->assertSame(0, JoiningGate::roomLeft($this->child));
    }

    public function test_under_the_limit_the_door_is_open(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 2);

        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertSame(1, JoiningGate::roomLeft($this->child));
    }

    public function test_members_who_have_not_signed_in_lately_do_not_count(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 2);
        $this->addActiveMembers($this->child, 5, now()->subDays(200));

        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_a_parents_rule_shuts_its_childs_door(): void
    {
        // Members of a child count towards its parent's number.
        $this->cap($this->hub, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);

        $this->assertSame(['tenant_id' => $this->hub, 'active' => 3, 'max' => 3], JoiningGate::closedBy($this->child));
        $this->assertSame(0, JoiningGate::roomLeft($this->child));
    }

    public function test_a_door_shut_from_above_needs_the_child_told(): void
    {
        // Warning first, for the community below too (task 7A).
        $this->cap($this->hub, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);

        $this->assertNotNull(JoiningGate::closedBy($this->hub), 'the full hub itself is shut');
        $this->assertNull(JoiningGate::closedBy($this->child), 'the child has not been told: open');
        $this->assertNull(JoiningGate::roomLeft($this->child), 'no cap applies to an untold child of a full hub');

        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);
        $this->assertSame($this->hub, JoiningGate::closedBy($this->child)['tenant_id'] ?? null, 'told: shut');
        $this->assertNull(JoiningGate::closedBy($this->sibling), 'telling one child shuts no other');

        // The hub's terms change (its days): the child was told under the old
        // terms, so its door opens until it is told again.
        $this->standing($this->hub, ['over_limit_grace_days' => 45]);
        $this->tellCommunityOfMemberLimit($this->hub);
        $this->assertNotNull(JoiningGate::closedBy($this->hub), 'precondition: the hub is told under its new terms');
        $this->assertNull(JoiningGate::closedBy($this->child), 'told under old terms: open');

        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);
        $this->assertNotNull(JoiningGate::closedBy($this->child));

        // A key naming another community does not count.
        $this->standing($this->child, ['joining_closed_notice_key' => $this->sibling . '|' . explode('|', (string) JoiningGate::noticeKeyFor($this->hub), 2)[1]]);
        JoiningGate::flush();
        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_a_siblings_rule_does_not_shut_the_door(): void
    {
        $this->cap($this->sibling, 3, 'block_joining');
        $this->addActiveMembers($this->sibling, 3);

        $this->assertNotNull(JoiningGate::closedBy($this->sibling), 'precondition: the sibling itself is shut');
        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertNull(JoiningGate::roomLeft($this->child), 'no cap applies to the child at all');
    }

    public function test_room_left_is_the_smallest_in_the_line(): void
    {
        $this->cap($this->hub, 10, 'block_joining');
        $this->cap($this->child, 20, 'block_joining');
        $this->addActiveMembers($this->sibling, 7);
        $this->addActiveMembers($this->child, 1);

        // The hub limits the child only once the child has been told under
        // the hub's present terms (task 7A): until then, only its own.
        $this->assertSame(19, JoiningGate::roomLeft($this->child));
        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);

        // Hub: 10 - 8 = 2; child: 20 - 1 = 19.
        $this->assertSame(2, JoiningGate::roomLeft($this->child));
        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_an_untold_child_is_not_capped_by_the_community_above(): void
    {
        // The hub has room for 2 more; the child has no limit of its own.
        $this->cap($this->hub, 10, 'block_joining');
        $this->addActiveMembers($this->child, 8);

        $this->assertSame(2, JoiningGate::roomLeft($this->hub), 'the hub itself is capped');
        $this->assertNull(JoiningGate::roomLeft($this->child), 'not told: no cap from above');
        $this->assertNull(JoiningGate::tightest($this->child));
        $this->assertSame([], JoiningGate::limits($this->child));

        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);
        $this->assertSame(2, JoiningGate::roomLeft($this->child), 'told: the hub limits it');
        $this->assertNull(JoiningGate::roomLeft($this->sibling), 'telling one child caps no other');
    }

    public function test_an_exempt_community_does_not_shut_its_door(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $this->standing($this->child, ['exempt' => 1, 'exempt_reason' => 'Pilot']);
        JoiningGate::flush();

        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertNull(JoiningGate::roomLeft($this->child));
    }

    public function test_an_exempt_child_under_a_full_parent_stays_open(): void
    {
        $this->cap($this->hub, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $this->standing($this->child, ['exempt' => 1, 'exempt_reason' => 'Pilot']);
        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);
        $this->tellCommunityOfDoorShutAbove($this->sibling, $this->hub);

        $this->assertNotNull(JoiningGate::closedBy($this->sibling), 'control: the non-exempt sibling is shut by the full parent');
        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertNull(JoiningGate::roomLeft($this->child));
    }

    public function test_a_child_under_an_exempt_hub_is_not_shut_by_a_full_grandparent(): void
    {
        $grandparent = $this->makeCommunity('Gate grandparent', 1, '/1/', true);
        $hub = $this->makeCommunity('Gate exempt hub', $grandparent, "/1/{$grandparent}/", true);
        $child = $this->makeCommunity('Gate grandchild', $hub, "/1/{$grandparent}/{$hub}/");
        $this->cap($grandparent, 3, 'block_joining');
        $this->addActiveMembers($child, 3);
        $this->standing($hub, ['exempt' => 1, 'exempt_reason' => 'Pilot']);
        JoiningGate::flush();

        $this->assertNull(JoiningGate::closedBy($child));
        $this->assertNull(JoiningGate::closedBy($hub));
        $this->assertNotNull(JoiningGate::closedBy($grandparent), 'control: the grandparent itself is shut');
    }

    public function test_a_parent_whose_rule_is_pause_or_none_adds_no_limit_for_its_child(): void
    {
        $this->addActiveMembers($this->child, 3);

        foreach (['pause', 'none'] as $rule) {
            $this->cap($this->hub, 3, $rule);
            $this->assertNull(JoiningGate::closedBy($this->child), "a parent's {$rule} rule must not shut the child's door");
            $this->assertNull(JoiningGate::roomLeft($this->child));
        }
    }

    public function test_the_admin_message_names_the_number_only_for_the_communitys_own_limit(): void
    {
        $this->cap($this->hub, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $this->tellCommunityOfDoorShutAbove($this->child, $this->hub);

        $own = JoiningGate::closedBy($this->hub);
        $above = JoiningGate::closedBy($this->child);

        $this->assertSame(__('api.community_member_limit_reached', ['max' => 3]), JoiningGate::adminMessage($own, $this->hub));
        $this->assertSame(__('api.community_member_limit_reached_above'), JoiningGate::adminMessage($above, $this->child));
        $this->assertStringNotContainsString('3', JoiningGate::adminMessage($above, $this->child));
    }

    public function test_changing_to_a_bigger_plan_opens_the_door_on_the_very_next_question(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'precondition: shut, and the answer is now cached');

        TenantBillingService::changePlanOnly($this->child, $this->makePlan(10), null, 'platform');

        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_changing_the_rule_or_the_exemption_is_seen_at_once(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $actor = (int) DB::table('users')->where('tenant_id', $this->child)->value('id');
        $this->assertNotNull(JoiningGate::closedBy($this->child));

        BillingStandingService::setOverLimitRule($this->child, 'none', null, $actor);
        $this->assertNull(JoiningGate::closedBy($this->child), 'a rule change is seen at once');

        BillingStandingService::setOverLimitRule($this->child, 'block_joining', null, $actor);
        $this->assertNull(JoiningGate::closedBy($this->child), 'a new rule is not in force for the door until the community is told');
        $this->tellCommunityOfMemberLimit($this->child);
        $this->assertNotNull(JoiningGate::closedBy($this->child));

        BillingStandingService::setExempt($this->child, true, $actor, 'Pilot');
        $this->assertNull(JoiningGate::closedBy($this->child), 'an exemption is seen at once');
    }

    public function test_with_the_automatic_checks_off_the_door_is_open(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        BillingSettings::set('automation_enabled', false, null);

        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertNull(JoiningGate::roomLeft($this->child));
    }

    public function test_the_other_rules_never_shut_the_door(): void
    {
        $this->addActiveMembers($this->child, 3);

        foreach (['none', 'pause', 'upgrade'] as $rule) {
            $this->cap($this->child, 3, $rule);
            $this->assertNull(JoiningGate::closedBy($this->child), "rule {$rule} must not shut the door");
            $this->assertNull(JoiningGate::roomLeft($this->child), "rule {$rule} sets no import cap");
        }
    }

    public function test_a_rule_reaching_the_child_from_its_parents_default_shuts_its_door(): void
    {
        $this->assignPlan($this->child, $this->makePlan(3));
        $this->standing($this->hub, ['children_over_limit_action' => 'block_joining']);
        $this->addActiveMembers($this->child, 3);
        $this->tellCommunityOfMemberLimit($this->child);

        $this->assertSame($this->child, JoiningGate::closedBy($this->child)['tenant_id'] ?? null);
    }

    public function test_a_plan_without_a_member_number_shuts_nothing(): void
    {
        $this->assignPlan($this->child, $this->makePlan(null));
        $this->standing($this->child, ['over_limit_action' => 'block_joining']);
        $this->addActiveMembers($this->child, 50);
        JoiningGate::flush();

        $this->assertNull(JoiningGate::closedBy($this->child));
    }

    public function test_a_failing_check_answers_open_and_is_logged_once(): void
    {
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        Log::spy();
        JoiningGate::swapAnswerForTesting(static function (): never {
            throw new \RuntimeException('billing tables unreachable');
        });

        $this->assertNull(JoiningGate::closedBy($this->child));
        $this->assertNull(JoiningGate::roomLeft($this->child));

        Log::shouldHaveReceived('error')
            ->withArgs(static fn (string $message): bool => str_contains($message, '[JoiningGate]'))
            ->once();
    }

    public function test_tenant_1_is_never_shut_and_never_shuts_a_door(): void
    {
        $direct = $this->makeCommunity('Gate direct', 1, '/1/');
        $this->cap(1, 1, 'block_joining');
        $this->addActiveMembers($direct, 2);

        $this->assertNull(JoiningGate::closedBy(1));
        $this->assertNull(JoiningGate::closedBy($direct));
        $this->assertNull(JoiningGate::roomLeft($direct));
    }

    public function test_a_move_inside_the_capped_branch_is_not_counted_twice(): void
    {
        // The person moving from the child to the sibling is already one of
        // the hub's members, so the hub's full count does not shut the move.
        $this->cap($this->hub, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);
        $this->tellCommunityOfDoorShutAbove($this->sibling, $this->hub);

        $this->assertNotNull(JoiningGate::closedBy($this->sibling));
        $this->assertNull(JoiningGate::closedBy($this->sibling, $this->child));
        $this->assertNotNull(JoiningGate::closedBy($this->sibling, $this->makeCommunity('Gate outsider', 1, '/1/')));
    }

    // ------------------------------------------------------------- told first

    public function test_the_door_is_not_shut_before_the_community_is_told(): void
    {
        $this->assignPlan($this->child, $this->makePlan(3));
        $this->standing($this->child, ['over_limit_action' => 'block_joining', 'exempt' => 0]);
        $this->addActiveMembers($this->child, 3);

        $this->assertNull(JoiningGate::closedBy($this->child), 'at its number but never told: open');
        $this->assertNull(JoiningGate::roomLeft($this->child), 'no cap applies before the community is told');

        $this->tellCommunityOfMemberLimit($this->child, 'approaching');
        $this->assertNull(JoiningGate::closedBy($this->child), 'told only that it is close: open');

        $this->tellCommunityOfMemberLimit($this->child, 'reached');
        $this->standing($this->child, ['limit_notice_at' => null]);
        JoiningGate::flush();
        $this->assertNull(JoiningGate::closedBy($this->child), 'a stage with no notice sent: open');

        $this->tellCommunityOfMemberLimit($this->child, 'reached');
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'told it is at its number: shut');

        $this->tellCommunityOfMemberLimit($this->child, 'over');
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'told it is over: shut');
    }

    public function test_a_change_of_terms_opens_the_door_until_the_next_notice(): void
    {
        // The hub lowers the member number of the plan its child is on, under
        // the child's members. The child has not been told under the new
        // terms, so its door stays open until the next daily run tells it.
        $this->standInAcceptingMailProvider();
        $plan = $this->makePlan(3);
        $this->assignPlan($this->child, $plan);
        $this->standing($this->child, ['over_limit_action' => 'block_joining', 'exempt' => 0]);
        $this->addActiveMembers($this->child, 3);
        $this->tellCommunityOfMemberLimit($this->child);
        $this->assertNotNull(JoiningGate::closedBy($this->child), 'precondition: told and shut');

        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $this->hub, 'pay_plan_id' => $plan, 'max_users' => 2,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        PlanTerms::flush();
        JoiningGate::flush();
        $this->assertSame(2, BillingAutomationService::watchedLimit($this->child)['max_users'] ?? null, 'precondition: the number the hub set applies');

        $this->assertNull(JoiningGate::closedBy($this->child), 'new terms, not yet told: open');

        BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertSame(['tenant_id' => $this->child, 'active' => 3, 'max' => 2], JoiningGate::closedBy($this->child), 'told under the new terms: shut');
    }

    public function test_switching_the_checks_on_shuts_no_door_before_the_first_run(): void
    {
        $this->standInAcceptingMailProvider();
        BillingSettings::set('automation_enabled', false, null);
        $this->cap($this->child, 3, 'block_joining');
        $this->addActiveMembers($this->child, 3);

        BillingSettings::setMany(['automation_enabled' => true], null);
        JoiningGate::flush();
        $this->assertNull(JoiningGate::closedBy($this->child), 'switched on, first run not yet made: open');

        BillingAutomationService::run();
        JoiningGate::flush();

        $this->assertNotNull(JoiningGate::closedBy($this->child), 'the first run told it: shut');
    }

    // ------------------------------------------------------------------ helpers

    /** Put a community on a standard plan of $max members with $rule as its own rule. */
    private function cap(int $tenantId, int $max, string $rule): void
    {
        $this->assignPlan($tenantId, $this->makePlan($max));
        $this->standing($tenantId, ['over_limit_action' => $rule, 'exempt' => 0]);
        // As a real run leaves it once the community has been told.
        $this->tellCommunityOfMemberLimit($tenantId);
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'gate-' . bin2hex(random_bytes(5)),
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

    private function makePlan(?int $maxUsers): int
    {
        return (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Gate plan ' . ($maxUsers ?? 'unlimited'),
            'slug' => 'gate-plan-' . bin2hex(random_bytes(5)),
            'tier_level' => 1,
            'max_users' => $maxUsers,
            'is_standard' => 1,
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function assignPlan(int $tenantId, int $planId): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->delete();
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ]);
    }

    /** @param array<string, mixed> $values */
    private function standing(int $tenantId, array $values): void
    {
        if (DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->exists()) {
            DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->update($values);
        } else {
            DB::table('tenant_billing_standing')->insert($values + ['tenant_id' => $tenantId, 'created_at' => now(), 'updated_at' => now()]);
        }
        BillingLock::flush();
    }

    private function addActiveMembers(int $tenantId, int $count, ?\DateTimeInterface $lastLogin = null): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'first_name' => 'Gate',
                'last_name' => 'Member',
                'name' => 'Gate Member',
                'email' => 'gate.' . bin2hex(random_bytes(7)) . '@example.com',
                'password_hash' => 'x',
                'role' => 'member',
                'status' => 'active',
                'is_approved' => 1,
                'last_login_at' => $lastLogin ?? now()->subDays(5),
                'created_at' => now(),
            ];
        }
        DB::table('users')->insert($rows);
        JoiningGate::flush();
    }
}
