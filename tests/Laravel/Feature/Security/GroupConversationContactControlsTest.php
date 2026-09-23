<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-086 — group conversations must apply the same member-to-member controls as
 * one-to-one messages: blocks, the broker "messaging disabled" restriction,
 * and broker review copying for monitored members.
 *
 * Decision for blocks created AFTER two members already share a group: the
 * group keeps working for everyone else and neither member is removed (that
 * would let anyone eject a member by blocking them, and would reveal the
 * block). Instead each member of the blocked pair stops seeing the other's
 * group messages, in either direction.
 */
class GroupConversationContactControlsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance('tenant.id', $this->testTenantId);

        // Broker review copies email the tenant's brokers for monitored
        // members. Never let a test reach the real mail transport.
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->andReturn(true);
        $this->app->instance(EmailDispatchService::class, $mailer);
    }

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the invitee blocked the actor' => ['target_blocked_actor'],
            'the actor blocked the invitee' => ['actor_blocked_target'],
        ];
    }

    #[DataProvider('blockDirections')]
    public function test_group_cannot_be_created_with_a_member_who_has_a_block_with_the_creator(string $direction): void
    {
        [$creator, $blocked] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $creator, $blocked);
        $before = $this->conversationCount();
        Sanctum::actingAs($creator, ['*']);

        // Two unblocked invitees as well, so the group would still be large
        // enough if the blocked member were silently dropped (the old
        // behaviour): the request must be refused, not quietly altered.
        $response = $this->apiPost('/v2/conversations/groups', [
            'name' => 'Blocked pair group',
            'member_ids' => [$blocked->id, $this->member()->id, $this->member()->id],
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertSame($before, $this->conversationCount());
    }

    public function test_group_without_blocks_is_still_created(): void
    {
        [$creator, $first, $second] = [$this->member(), $this->member(), $this->member()];
        Sanctum::actingAs($creator, ['*']);

        $this->apiPost('/v2/conversations/groups', [
            'name' => 'Ordinary group',
            'member_ids' => [$first->id, $second->id],
        ])->assertStatus(201)->assertJsonPath('data.participant_count', 3);
    }

    #[DataProvider('blockDirections')]
    public function test_admin_cannot_add_a_member_who_has_a_block_with_them(string $direction): void
    {
        [$admin, $member, $target] = [$this->member(), $this->member(), $this->member()];
        $conversationId = $this->group($admin, [$member, $this->member()]);
        $this->applyBlock($direction, $admin, $target);
        Sanctum::actingAs($admin, ['*']);

        $response = $this->apiPost("/v2/conversations/{$conversationId}/participants", [
            'user_id' => $target->id,
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertFalse(DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $target->id)
            ->exists());
    }

    public function test_messaging_disabled_member_cannot_create_a_group(): void
    {
        [$creator, $first, $second] = [$this->member(), $this->member(), $this->member()];
        $this->disableMessaging($creator);
        $before = $this->conversationCount();
        Sanctum::actingAs($creator, ['*']);

        $this->apiPost('/v2/conversations/groups', [
            'name' => 'Restricted creator group',
            'member_ids' => [$first->id, $second->id],
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'MESSAGING_DISABLED');

        $this->assertSame($before, $this->conversationCount());
    }

    public function test_messaging_disabled_admin_cannot_add_a_member(): void
    {
        [$admin, $target] = [$this->member(), $this->member()];
        $conversationId = $this->group($admin, [$this->member(), $this->member()]);
        $this->disableMessaging($admin);
        Sanctum::actingAs($admin, ['*']);

        $this->apiPost("/v2/conversations/{$conversationId}/participants", [
            'user_id' => $target->id,
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'MESSAGING_DISABLED');

        $this->assertFalse(DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $target->id)
            ->exists());
    }

    public function test_messaging_disabled_member_cannot_send_a_group_message(): void
    {
        [$admin, $restricted] = [$this->member(), $this->member()];
        $conversationId = $this->group($admin, [$restricted, $this->member()]);
        $this->disableMessaging($restricted);
        Sanctum::actingAs($restricted, ['*']);

        $this->apiPost("/v2/conversations/{$conversationId}/messages", [
            'body' => 'Restricted member group message',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'MESSAGING_DISABLED');

        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'conversation_id' => $conversationId,
            'sender_id' => $restricted->id,
        ]);
    }

    public function test_group_message_from_a_monitored_member_is_copied_for_broker_review(): void
    {
        [$admin, $monitored] = [$this->member(), $this->member()];
        $conversationId = $this->group($admin, [$monitored, $this->member()]);
        $this->monitor($monitored);
        Sanctum::actingAs($monitored, ['*']);

        $messageId = (int) $this->apiPost("/v2/conversations/{$conversationId}/messages", [
            'body' => 'Monitored member group message',
        ])->assertStatus(201)->json('data.id');

        $copy = DB::table('broker_message_copies')
            ->where('tenant_id', $this->testTenantId)
            ->where('original_message_id', $messageId)
            ->first();
        $this->assertNotNull($copy, 'A monitored member\'s group message was not copied for broker review.');
        $this->assertSame((int) $monitored->id, (int) $copy->sender_id);
        $this->assertSame('flagged_user', $copy->copy_reason);
        $this->assertSame('Monitored member group message', $copy->message_body);
        $this->assertTrue(DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->where('user_id', (int) $copy->receiver_id)
            ->exists(), 'The broker copy must name a real participant of the group.');

        // The broker's detail view shows the group thread as context, not the
        // named recipient's one-to-one history.
        $broker = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $monitored->id,
            'receiver_id' => (int) $copy->receiver_id,
            'body' => 'Unrelated direct message',
            'created_at' => now(),
        ]);
        Sanctum::actingAs($broker, ['*']);
        $thread = $this->apiGet("/v2/admin/broker/messages/{$copy->id}")->assertOk()->json('data.thread');
        $bodies = array_column($thread, 'body');
        $this->assertContains('Monitored member group message', $bodies);
        $this->assertNotContains('Unrelated direct message', $bodies);
    }

    public function test_group_message_to_a_monitored_member_is_copied_for_broker_review(): void
    {
        [$admin, $sender, $monitored] = [$this->member(), $this->member(), $this->member()];
        $conversationId = $this->group($admin, [$sender, $monitored]);
        $this->monitor($monitored);
        Sanctum::actingAs($sender, ['*']);

        $messageId = (int) $this->apiPost("/v2/conversations/{$conversationId}/messages", [
            'body' => 'Message to a monitored member',
        ])->assertStatus(201)->json('data.id');

        $copy = DB::table('broker_message_copies')
            ->where('tenant_id', $this->testTenantId)
            ->where('original_message_id', $messageId)
            ->first();
        $this->assertNotNull($copy);
        $this->assertSame('flagged_user', $copy->copy_reason);
        $this->assertSame((int) $monitored->id, (int) $copy->receiver_id);
    }

    #[DataProvider('blockDirections')]
    public function test_members_of_a_later_blocked_pair_stop_seeing_each_others_group_messages(string $direction): void
    {
        [$admin, $actor, $target] = [$this->member(), $this->member(), $this->member()];
        $conversationId = $this->group($admin, [$actor, $target]);
        $this->applyBlock($direction, $actor, $target);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost("/v2/conversations/{$conversationId}/messages", ['body' => 'From actor'])
            ->assertStatus(201);
        Sanctum::actingAs($target, ['*']);
        $this->apiPost("/v2/conversations/{$conversationId}/messages", ['body' => 'From target'])
            ->assertStatus(201);
        Sanctum::actingAs($admin, ['*']);
        $this->apiPost("/v2/conversations/{$conversationId}/messages", ['body' => 'From admin'])
            ->assertStatus(201);

        // Newest first. Each member of the pair sees their own and the
        // admin's messages, but not the other member's.
        $this->assertSame(['From admin', 'From target'], $this->visibleBodies($target, $conversationId));
        $this->assertSame(['From admin', 'From actor'], $this->visibleBodies($actor, $conversationId));
        $this->assertSame(
            ['From admin', 'From target', 'From actor'],
            $this->visibleBodies($admin, $conversationId),
        );

        Sanctum::actingAs($actor, ['*']);
        $group = collect($this->apiGet('/v2/conversations/groups')->assertOk()->json('data'))
            ->firstWhere('id', $conversationId);
        $this->assertNotNull($group);
        $this->assertSame('From admin', $group['last_message']['body'] ?? null);
    }

    /** @return list<string> */
    private function visibleBodies(User $viewer, int $conversationId): array
    {
        Sanctum::actingAs($viewer, ['*']);

        return collect($this->apiGet("/v2/conversations/{$conversationId}/messages")->assertOk()->json('data'))
            ->pluck('body')
            ->filter(static fn ($body): bool => in_array($body, ['From actor', 'From target', 'From admin'], true))
            ->values()
            ->all();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /** @param list<User> $members */
    private function group(User $admin, array $members): int
    {
        $conversationId = DB::table('conversations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'is_group' => true,
            'group_name' => 'F-086 test group',
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('conversation_participants')->insert([
            'tenant_id' => $this->testTenantId,
            'conversation_id' => $conversationId,
            'user_id' => $admin->id,
            'role' => 'admin',
            'joined_at' => now(),
        ]);
        foreach ($members as $member) {
            DB::table('conversation_participants')->insert([
                'tenant_id' => $this->testTenantId,
                'conversation_id' => $conversationId,
                'user_id' => $member->id,
                'role' => 'member',
                'joined_at' => now(),
            ]);
        }

        return (int) $conversationId;
    }

    private function applyBlock(string $direction, User $actor, User $target): void
    {
        [$blocker, $blocked] = $direction === 'target_blocked_actor' ? [$target, $actor] : [$actor, $target];
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $blocker->id,
            'blocked_user_id' => $blocked->id,
            'created_at' => now(),
        ]);
    }

    private function disableMessaging(User $user): void
    {
        DB::table('user_messaging_restrictions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'messaging_disabled' => 1,
            'restriction_reason' => 'F-086 test restriction',
            'restricted_at' => now(),
        ]);
    }

    private function monitor(User $user): void
    {
        DB::table('user_messaging_restrictions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'under_monitoring' => 1,
            'messaging_disabled' => 0,
            'monitoring_reason' => 'F-086 test monitoring',
            'monitoring_started_at' => now(),
        ]);
    }

    private function conversationCount(): int
    {
        return DB::table('conversations')->where('tenant_id', $this->testTenantId)->count();
    }
}
