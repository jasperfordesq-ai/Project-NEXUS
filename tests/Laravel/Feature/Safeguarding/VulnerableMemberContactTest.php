<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Exceptions\SafeguardingPolicyException;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\GroupService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 25 Oct 2026, for "I consider myself a vulnerable adult":
 *
 *  - nobody can contact the member directly, except coordinators and members a
 *    coordinator has approved for them;
 *  - the member cannot start contact either — they ask a coordinator, who
 *    approves the contact, and then both sides can talk (until 25 Oct the
 *    member could send a message nobody was allowed to answer);
 *  - groups keep working: one member's protection no longer stops everyone
 *    else posting in, or joining, a group they belong to — but nobody may
 *    @mention or otherwise target them directly;
 *  - a blocked sender is told contact goes through a coordinator, never why.
 */
final class VulnerableMemberContactTest extends TestCase
{
    use DatabaseTransactions;

    private User $broker;
    private User $vulnerable;
    private User $other;

    protected function setUp(): void
    {
        parent::setUp();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'ireland'])->assertStatus(200);

        $this->broker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'role' => 'broker']);
        $this->vulnerable = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->hold($this->vulnerable, 'is_vulnerable_adult');
    }

    public function test_a_member_cannot_message_a_vulnerable_member_and_is_not_told_why(): void
    {
        Sanctum::actingAs($this->other);
        $response = $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'hello'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');

        $text = strtolower(json_encode($response->json('errors')) ?: '');
        $this->assertStringNotContainsString('vulnerable', $text);
        $this->assertStringNotContainsString('safeguarding preference', $text);
        $this->assertStringContainsString('coordinator', $text);
    }

    public function test_a_coordinator_can_message_a_vulnerable_member_and_be_answered(): void
    {
        Sanctum::actingAs($this->broker);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'Hi, I am your coordinator'])->assertSuccessful();

        Sanctum::actingAs($this->vulnerable);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->broker->id, 'body' => 'Thank you'])->assertSuccessful();
    }

    public function test_a_vulnerable_member_is_told_to_ask_a_coordinator_instead_of_messaging_someone(): void
    {
        Sanctum::actingAs($this->vulnerable);
        $response = $this->apiPost('/v2/messages', ['recipient_id' => $this->other->id, 'body' => 'hello'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');

        $this->assertSame(__('safeguarding.errors.contact_via_coordinator_detail'), $response->json('errors.0.detail'));
    }

    public function test_coordinators_are_alerted_about_the_right_member_when_a_vulnerable_member_tries_to_message(): void
    {
        \Illuminate\Support\Facades\Event::fake([\App\Events\SafeguardingContactAttemptBlocked::class]);

        Sanctum::actingAs($this->vulnerable);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->other->id, 'body' => 'hello'])->assertStatus(403);

        \Illuminate\Support\Facades\Event::assertDispatched(
            \App\Events\SafeguardingContactAttemptBlocked::class,
            fn ($event): bool => $event->reasonCode === 'SAFEGUARDING_CONTACT_VIA_COORDINATOR'
                && $event->senderId === $this->vulnerable->id,
        );
    }

    public function test_a_coordinator_approved_contact_can_talk_both_ways_until_revoked(): void
    {
        Sanctum::actingAs($this->broker);
        $approvalId = $this->apiPost("/v2/admin/safeguarding/members/{$this->vulnerable->id}/approved-contacts", [
            'contact_user_id' => $this->other->id,
        ])->assertStatus(201)->json('data.id');

        Sanctum::actingAs($this->other);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'approved hello'])->assertSuccessful();
        Sanctum::actingAs($this->vulnerable);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->other->id, 'body' => 'approved reply'])->assertSuccessful();

        $policy = app(SafeguardingInteractionPolicy::class);
        $this->assertTrue($policy->evaluateLocalContact($this->other->id, $this->vulnerable->id, $this->testTenantId, 'exchange_request')->isAllowed());
        $this->assertTrue($policy->evaluateLocalContact($this->vulnerable->id, $this->other->id, $this->testTenantId, 'exchange_request')->isAllowed());

        Sanctum::actingAs($this->broker);
        $list = $this->apiGet("/v2/admin/safeguarding/members/{$this->vulnerable->id}/approved-contacts")->assertOk();
        $this->assertSame($this->other->id, (int) $list->json('data.0.contact_user_id'));

        $this->apiDelete("/v2/admin/safeguarding/members/{$this->vulnerable->id}/approved-contacts/{$approvalId}")->assertOk();

        Sanctum::actingAs($this->other);
        $this->apiPost('/v2/messages', ['recipient_id' => $this->vulnerable->id, 'body' => 'after revoke'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');
    }

    public function test_only_coordinators_can_approve_contacts(): void
    {
        Sanctum::actingAs($this->other);
        $this->apiPost("/v2/admin/safeguarding/members/{$this->vulnerable->id}/approved-contacts", [
            'contact_user_id' => $this->other->id,
        ])->assertStatus(403);

        $this->assertDatabaseMissing('safeguarding_approved_contacts', ['protected_user_id' => $this->vulnerable->id]);
    }

    public function test_a_contact_from_another_community_cannot_be_approved(): void
    {
        $outsiderTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $outsider = User::factory()->forTenant($outsiderTenantId)->create(['status' => 'active']);

        Sanctum::actingAs($this->broker);
        $this->apiPost("/v2/admin/safeguarding/members/{$this->vulnerable->id}/approved-contacts", [
            'contact_user_id' => $outsider->id,
        ])->assertStatus(422);
    }

    public function test_groups_keep_working_but_the_member_cannot_be_targeted_directly(): void
    {
        $poster = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $groupId = $this->groupWith([$poster, $this->vulnerable, $this->other]);

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
        $groupId = $this->groupWith([$this->other]);

        GroupService::assertSafeguardingCohortAllowed($groupId, $this->vulnerable->id, $this->testTenantId, 'group_join');
        $this->groupMember($groupId, $this->vulnerable);
        GroupService::assertSafeguardingBroadcastAllowed($groupId, $this->vulnerable->id, $this->testTenantId, 'group_discussion_create', 'Hi all');

        $this->addToAssertionCount(1);
    }

    public function test_every_preset_puts_vulnerable_adult_first_with_a_contact_block_and_drops_vetting_in_ireland(): void
    {
        foreach (config('safeguarding_presets') as $key => $preset) {
            if ($key === 'custom') {
                continue;
            }
            $options = $preset['options'];
            $byKey = array_column($options, null, 'option_key');

            $this->assertSame('is_vulnerable_adult', $options[0]['option_key'], "{$key}: vulnerable adult comes first");
            $this->assertSame('none_apply', end($options)['option_key'], "{$key}: 'none apply' comes last");
            $this->assertTrue((bool) ($byKey['is_vulnerable_adult']['triggers']['restricts_messaging'] ?? false), "{$key}: vulnerable adult blocks direct contact");
            $this->assertFalse($byKey['requires_coordinator_contact']['accepts_new_selections'] ?? true, "{$key}: the duplicate coordinator-contact option is not offered to newcomers");
            $offered = array_values(array_map(static fn (array $o): string => $o['option_key'], array_filter($options, static fn (array $o): bool => $o['accepts_new_selections'] ?? true)));
            $this->assertSame(['is_vulnerable_adult', 'works_with_vulnerable_adults', 'none_apply'], $offered, "{$key}: new members are asked only the essentials");

            if ($key === 'ireland') {
                $this->assertArrayNotHasKey('requires_vetted_partners', $byKey, 'Irish vetting is per organisation and role; it cannot follow a member');
            } else {
                $this->assertFalse($byKey['requires_vetted_partners']['accepts_new_selections'] ?? true, "{$key}: vetted-only stays switched off until staff record checks");
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
