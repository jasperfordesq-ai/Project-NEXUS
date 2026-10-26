<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Events\SafeguardingContactAttemptBlocked;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\GroupService;
use App\Services\MemberVettingAttestationService;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decisions, 25 Oct 2026, for "I consider myself a vulnerable adult" —
 * the one question new members are asked:
 *
 *  - it switches on the community's vetting system: coordinators of the
 *    community, and members whose vetting the community has recorded (Garda
 *    Vetting in Ireland; the jurisdiction's own check in the UK), can contact
 *    the member; nobody else;
 *  - the member can contact the same people and nobody else, so nobody is
 *    left unable to reply;
 *  - groups keep working: the member's choice no longer stops everyone else
 *    posting in, or joining, a group they belong to — but nobody unvetted may
 *    @mention or otherwise target them directly.
 */
final class VulnerableMemberContactTest extends TestCase
{
    use DatabaseTransactions;

    private User $admin;
    private User $broker;
    private User $vulnerable;
    private User $unvetted;
    private User $vetted;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($this->admin);
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'ireland'])->assertStatus(200);

        $this->broker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'role' => 'broker']);
        $this->vulnerable = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->unvetted = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->vetted = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        app(MemberVettingAttestationService::class)->confirmForCurrentPolicy($this->testTenantId, $this->vetted->id, $this->admin->id);
        $this->hold($this->vulnerable, 'is_vulnerable_adult');
    }

    public function test_an_unvetted_member_cannot_message_a_vulnerable_member_and_is_not_told_they_are_vulnerable(): void
    {
        Sanctum::actingAs($this->unvetted);
        $response = $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'hello'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');

        $this->assertStringNotContainsString('vulnerable', strtolower(json_encode($response->json('errors')) ?: ''));
    }

    public function test_a_member_with_recorded_vetting_can_message_a_vulnerable_member_and_be_answered(): void
    {
        Sanctum::actingAs($this->vetted);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'Hello from a vetted member'])->assertSuccessful();

        Sanctum::actingAs($this->vulnerable);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->vetted->id, 'body' => 'Thanks'])->assertSuccessful();
    }

    public function test_a_coordinator_can_always_message_a_vulnerable_member_and_be_answered(): void
    {
        Sanctum::actingAs($this->broker);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'Hi, I am your coordinator'])->assertSuccessful();

        Sanctum::actingAs($this->vulnerable);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->broker->id, 'body' => 'Thank you'])->assertSuccessful();
    }

    public function test_a_vulnerable_member_cannot_start_contact_with_an_unvetted_member(): void
    {
        Sanctum::actingAs($this->vulnerable);
        $response = $this->apiPost('/v2/messages', ['recipient_id' => $this->unvetted->id, 'body' => 'hello'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');

        $this->assertSame(__('safeguarding.errors.contact_via_coordinator_detail'), $response->json('errors.0.detail'));
    }

    public function test_a_vulnerable_member_starting_a_group_conversation_is_told_it_is_their_own_choice(): void
    {
        Sanctum::actingAs($this->vulnerable);
        $response = $this->apiPost('/v2/conversations/groups', [
            'name' => 'Chat',
            'member_ids' => [$this->unvetted->id, $this->vetted->id],
        ])->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');

        $this->assertSame(__('safeguarding.errors.contact_via_coordinator_detail'), $response->json('errors.0.detail'));
    }

    public function test_coordinators_are_alerted_about_the_right_member_when_a_vulnerable_member_tries_to_message(): void
    {
        Event::fake([SafeguardingContactAttemptBlocked::class]);

        Sanctum::actingAs($this->vulnerable);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->unvetted->id, 'body' => 'hello'])->assertStatus(403);

        Event::assertDispatched(
            SafeguardingContactAttemptBlocked::class,
            fn ($event): bool => $event->reasonCode === 'SAFEGUARDING_CONTACT_VIA_COORDINATOR'
                && $event->senderId === $this->vulnerable->id,
        );
    }

    public function test_groups_keep_working_but_unvetted_members_cannot_target_the_member_directly(): void
    {
        $poster = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $groupId = $this->groupWith([$poster, $this->vulnerable, $this->unvetted]);

        GroupService::assertSafeguardingBroadcastAllowed($groupId, $poster->id, $this->testTenantId, 'group_discussion_create', 'Hello everyone');

        $newcomer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        GroupService::assertSafeguardingCohortAllowed($groupId, $newcomer->id, $this->testTenantId, 'group_join');

        $this->expectException(SafeguardingPolicyException::class);
        GroupService::assertSafeguardingBroadcastAllowed(
            $groupId,
            $poster->id,
            $this->testTenantId,
            'group_discussion_create',
            'Hello',
            [$this->vulnerable->id],
        );
    }

    public function test_a_vulnerable_member_can_join_and_post_in_a_group(): void
    {
        $groupId = $this->groupWith([$this->unvetted]);

        GroupService::assertSafeguardingCohortAllowed($groupId, $this->vulnerable->id, $this->testTenantId, 'group_join');
        $this->groupMember($groupId, $this->vulnerable);
        GroupService::assertSafeguardingBroadcastAllowed($groupId, $this->vulnerable->id, $this->testTenantId, 'group_discussion_create', 'Hi all');

        $this->addToAssertionCount(1);
    }

    public function test_new_members_are_asked_only_the_vulnerable_adult_question_which_uses_the_jurisdictions_vetting(): void
    {
        $expectedVetting = [
            'ireland' => 'garda_vetting',
            'united_kingdom' => 'uk_safeguarding_clearance',
            'england_wales' => 'dbs_enhanced',
            'scotland' => 'pvg_scotland',
            'northern_ireland' => 'access_ni',
        ];

        foreach (config('safeguarding_presets') as $key => $preset) {
            if ($key === 'custom') {
                continue;
            }
            $options = $preset['options'];
            $byKey = array_column($options, null, 'option_key');
            $offered = array_values(array_map(
                static fn (array $o): string => $o['option_key'],
                array_filter($options, static fn (array $o): bool => $o['accepts_new_selections'] ?? true),
            ));

            $this->assertSame(['is_vulnerable_adult', 'none_apply'], $offered, "{$key}: new members are asked only the essentials");
            $triggers = $byKey['is_vulnerable_adult']['triggers'];
            $this->assertTrue($triggers['requires_vetted_interaction'] ?? false, "{$key}: vulnerable adult switches on vetted contact");
            $this->assertSame($expectedVetting[$key], $triggers['vetting_type_required'] ?? null, "{$key}: the jurisdiction's own check");
            $this->assertArrayNotHasKey('restricts_messaging', $triggers, "{$key}: vetted members are not shut out");

            if ($key === 'ireland') {
                $this->assertArrayNotHasKey('requires_vetted_partners', $byKey, 'The separate vetted-only question is folded into the vulnerable-adult question');
            }
        }
    }

    /** @param list<User> $members */
    private function groupWith(array $members): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $members[0]->id,
            'name' => 'Safeguarding test group ' . uniqid(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ($members as $member) {
            $this->groupMember($groupId, $member);
        }

        return $groupId;
    }

    private function groupMember(int $groupId, User $member): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $member->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    private function hold(User $member, string $key): void
    {
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => (int) TenantSafeguardingOption::withoutGlobalScopes()
                ->where('tenant_id', $this->testTenantId)
                ->where('option_key', $key)
                ->where('is_active', true)
                ->valueOrFail('id'),
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
    }
}
