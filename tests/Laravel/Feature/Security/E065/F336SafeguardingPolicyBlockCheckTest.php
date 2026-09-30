<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\CommunityProjectService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-336 (E-065) — the structural finding behind the whole block-bypass family.
 *
 * `SafeguardingInteractionPolicy` called itself "One fail-closed policy boundary
 * for member-to-member interactions" and contained ZERO references to blocking.
 * 52 files call it; 17 also checked blocks; 35 did not. Nothing central — no
 * middleware, gate, policy or observer — enforced blocking anywhere, so every
 * new interaction path re-made the decision by hand and F-070, F-158, F-246,
 * F-271, F-279, F-285 and F-332 are seven samples from a population nothing
 * bounded.
 *
 * The policy now owns the decision on its DIRECTED member-to-member entry
 * points. This test pins:
 *
 *   1. each entry point that gained the check,
 *   2. the two that deliberately did NOT gain it, and why,
 *   3. an end-to-end path (`CommunityProjectService::support`) that has no block
 *      check of its own and was not edited — it is refused purely because the
 *      choke point now exists.
 */
class F336SafeguardingPolicyBlockCheckTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function policy(): SafeguardingInteractionPolicy
    {
        return app(SafeguardingInteractionPolicy::class);
    }

    private function community(): int
    {
        $suffix = substr(bin2hex(random_bytes(4)), 0, 8);

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'F336 Community ' . $suffix,
            'slug' => 'f336-' . $suffix,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // -----------------------------------------------------------------
    // The entry points that gained the check
    // -----------------------------------------------------------------

    public function test_the_local_contact_decision_denies_a_blocked_pair(): void
    {
        $a = $this->member();
        $b = $this->member();
        BlockUserService::block((int) $b->id, (int) $a->id, 'F336 harassment');

        $decision = $this->policy()->evaluateLocalContact(
            (int) $a->id,
            (int) $b->id,
            $this->testTenantId,
            'direct_message',
        );

        $this->assertSame(SafeguardingInteractionDecision::DENY, $decision->status);
        $this->assertSame('BLOCKED', $decision->code);
        $this->assertFalse($decision->isAllowed());
    }

    public function test_the_decision_is_direction_neutral(): void
    {
        $blocker = $this->member();
        $blocked = $this->member();
        BlockUserService::block((int) $blocker->id, (int) $blocked->id, 'F336 harassment');

        // The blocker acting on the blocked member gets the same answer as the
        // blocked member acting on the blocker, so neither learns who blocked
        // whom — the same rule BlockUserService::assertNoBlockBetween applies.
        $outbound = $this->policy()->evaluateLocalContact(
            (int) $blocker->id,
            (int) $blocked->id,
            $this->testTenantId,
            'direct_message',
        );
        $inbound = $this->policy()->evaluateLocalContact(
            (int) $blocked->id,
            (int) $blocker->id,
            $this->testTenantId,
            'direct_message',
        );

        $this->assertSame('BLOCKED', $outbound->code);
        $this->assertSame('BLOCKED', $inbound->code);
    }

    public function test_the_locked_write_decision_denies_a_blocked_pair(): void
    {
        $a = $this->member();
        $b = $this->member();
        BlockUserService::block((int) $b->id, (int) $a->id, 'F336 harassment');

        $decision = $this->policy()->evaluateLockedLocalContact(
            (int) $a->id,
            (int) $b->id,
            $this->testTenantId,
            'direct_message',
        );

        $this->assertSame('BLOCKED', $decision->code, 'the locked write path must deny too');
    }

    public function test_assert_local_contact_allowed_throws_the_blocked_exception(): void
    {
        $a = $this->member();
        $b = $this->member();
        BlockUserService::block((int) $b->id, (int) $a->id, 'F336 harassment');

        $threw = false;
        try {
            $this->policy()->assertLocalContactAllowed(
                (int) $a->id,
                (int) $b->id,
                $this->testTenantId,
                'direct_message',
            );
        } catch (SafeguardingPolicyException $e) {
            $threw = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
            $this->assertSame(__('safeguarding.errors.blocked_interaction'), $e->getMessage());
        }

        $this->assertTrue($threw);
    }

    public function test_the_cross_community_decision_denies_a_cross_community_block(): void
    {
        $partnerTenantId = $this->community();
        $local = $this->member();
        $remote = User::factory()->forTenant($partnerTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);

        // A block made by the local member against a partner-community member
        // (F-284, owner decision 29 Sep 2026).
        BlockUserService::block((int) $local->id, (int) $remote->id, 'F336 cross-community');

        $decision = $this->policy()->evaluateCrossTenantContact(
            (int) $remote->id,
            $partnerTenantId,
            (int) $local->id,
            $this->testTenantId,
            'federated_message',
        );

        $this->assertSame('BLOCKED', $decision->code, 'the cross-community path must honour an F-284 block');
    }

    // -----------------------------------------------------------------
    // The deliberate carve-outs
    // -----------------------------------------------------------------

    public function test_a_group_send_is_not_vetoed_by_one_blocked_recipient(): void
    {
        // 🔴 evaluateManyLocalContacts is the INDIVISIBLE group-broadcast path:
        // one denied recipient denies the whole send. Folding blocking into it
        // would let any member veto another member's group participation simply
        // by blocking them, and would silence the blocked member for everyone.
        // Blocking hides an individual interaction; it is not a group ban.
        $sender = $this->member();
        $blocker = $this->member();
        $bystander = $this->member();
        BlockUserService::block((int) $blocker->id, (int) $sender->id, 'F336 harassment');

        $decision = $this->policy()->evaluateManyLocalContacts(
            (int) $sender->id,
            [(int) $blocker->id, (int) $bystander->id],
            $this->testTenantId,
            'group_message',
        );

        $this->assertTrue(
            $decision->isAllowed(),
            'a block must not veto a whole group send: ' . $decision->code
        );
    }

    public function test_an_external_actor_decision_does_not_break_on_a_null_sender(): void
    {
        // evaluateExternalContact has no sender user id at all — a block cannot
        // apply, and the check must not throw a type error on null.
        $recipient = $this->member();

        $decision = $this->policy()->evaluateExternalContact(
            (int) $recipient->id,
            $this->testTenantId,
            'partner:example/actor-1',
            'external_federated_message',
        );

        $this->assertTrue($decision->isAllowed(), 'unchanged external behaviour: ' . $decision->code);
    }

    // -----------------------------------------------------------------
    // End to end through a caller that was NOT edited
    // -----------------------------------------------------------------

    public function test_a_path_with_no_block_check_of_its_own_is_now_refused(): void
    {
        $proposer = $this->member();
        $attacker = $this->member();

        $projectId = (int) DB::table('vol_community_projects')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'proposed_by' => (int) $proposer->id,
            'title' => 'F336 community project',
            'description' => 'A project proposal used to prove the choke point.',
            'status' => 'proposed',
            'supporter_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        BlockUserService::block((int) $proposer->id, (int) $attacker->id, 'F336 harassment');

        // CommunityProjectService::support applies the safeguarding policy and
        // has NO block check of its own; it was not edited for this finding.
        $threw = false;
        try {
            app(CommunityProjectService::class)->support($projectId, (int) $attacker->id, $this->testTenantId);
        } catch (SafeguardingPolicyException $e) {
            $threw = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertTrue($threw, 'the choke point must refuse an unpatched caller');
        $this->assertFalse(
            DB::table('vol_community_project_supporters')
                ->where('tenant_id', $this->testTenantId)
                ->where('project_id', $projectId)
                ->where('user_id', $attacker->id)
                ->exists(),
            'no supporter row may be written for a blocked member'
        );
    }

    // -----------------------------------------------------------------
    // Control
    // -----------------------------------------------------------------

    public function test_every_entry_point_still_allows_an_unblocked_pair(): void
    {
        $a = $this->member();
        $b = $this->member();

        $this->assertTrue(
            $this->policy()->evaluateLocalContact((int) $a->id, (int) $b->id, $this->testTenantId, 'direct_message')->isAllowed(),
            'CONTROL: local contact between an unblocked pair is still allowed'
        );
        $this->assertTrue(
            $this->policy()->evaluateLockedLocalContact((int) $a->id, (int) $b->id, $this->testTenantId, 'direct_message')->isAllowed(),
            'CONTROL: the locked write path is still allowed'
        );
        $this->assertTrue(
            $this->policy()->evaluateManyLocalContacts((int) $a->id, [(int) $b->id], $this->testTenantId, 'group_message')->isAllowed(),
            'CONTROL: the group path is still allowed'
        );

        // CONTROL: the end-to-end caller still works without a block.
        $proposer = $this->member();
        $supporter = $this->member();
        $projectId = (int) DB::table('vol_community_projects')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'proposed_by' => (int) $proposer->id,
            'title' => 'F336 control project',
            'description' => 'A project proposal with no block in play.',
            'status' => 'proposed',
            'supporter_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertTrue(
            app(CommunityProjectService::class)->support($projectId, (int) $supporter->id, $this->testTenantId),
            'CONTROL: an unblocked member can still support a project'
        );
        $this->assertTrue(
            DB::table('vol_community_project_supporters')
                ->where('tenant_id', $this->testTenantId)
                ->where('project_id', $projectId)
                ->where('user_id', $supporter->id)
                ->exists(),
            'CONTROL: the rightful supporter row is written'
        );
    }
}
