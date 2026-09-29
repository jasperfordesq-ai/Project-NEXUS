<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * F-284 (E-062) — a member could not block a member of another community at
 * all (the block endpoint answered 404), while internal cross-community
 * federation — live and ungated by design — delivered that person's message,
 * connection request, credit transfer and the bell/push/email that go with
 * them. The recipient's only remedy was switching off ALL federated contact.
 *
 * Owner decision (29 Sep 2026): a member CAN block a member of another
 * community on the same installation, and that block stops the person's
 * internal federated messages, connection requests and notifications reaching
 * the blocker. Internal federation is otherwise unchanged.
 *
 * Controls in every test: an UNBLOCKED member of the same partner community
 * still gets through on the same channel, and a same-community block still
 * behaves exactly as before.
 */
class F284CrossCommunityBlockTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    private int $home = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
    }

    // ------------------------------------------------------------ blocking

    public function test_a_member_can_block_and_unblock_a_member_of_a_partner_community(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);

        $this->as($victim, $this->home);
        $this->apiPost('/v2/users/' . $stranger->id . '/block', ['reason' => 'F284'])
            ->assertOk()
            ->assertJsonPath('data.success', true);

        $row = DB::table('user_blocks')
            ->where('user_id', (int) $victim->id)
            ->where('blocked_user_id', (int) $stranger->id)
            ->first();
        $this->assertNotNull($row, 'the cross-community block is stored');
        $this->assertSame($this->home, (int) $row->tenant_id, 'the block belongs to the blocker\'s community');

        $this->as($victim, $this->home);
        $listed = array_map(
            static fn (array $r): int => (int) ($r['user_id'] ?? 0),
            $this->apiGet('/v2/users/blocked')->assertOk()->json('data') ?? [],
        );
        $this->assertContains((int) $stranger->id, $listed, 'the member can see the block in their own list');

        $this->as($victim, $this->home);
        $this->apiGet('/v2/users/' . $stranger->id . '/block-status')
            ->assertOk()
            ->assertJsonPath('data.is_blocked', true);

        $this->as($victim, $this->home);
        $this->apiDelete('/v2/users/' . $stranger->id . '/block')->assertOk();
        $this->assertSame(0, DB::table('user_blocks')
            ->where('user_id', (int) $victim->id)
            ->where('blocked_user_id', (int) $stranger->id)
            ->count(), 'the member can remove the block again');
    }

    public function test_a_member_of_a_community_with_no_partnership_still_cannot_be_blocked(): void
    {
        $unrelated = $this->community();
        $victim = $this->federatedMember($this->home);
        $outsider = $this->federatedMember($unrelated);

        $this->as($victim, $this->home);
        $this->apiPost('/v2/users/' . $outsider->id . '/block')->assertStatus(404);
        $this->assertSame(0, DB::table('user_blocks')->where('user_id', (int) $victim->id)->count());

        // Control: a same-community block is unchanged.
        $neighbour = $this->federatedMember($this->home);
        $this->as($victim, $this->home);
        $this->apiPost('/v2/users/' . $neighbour->id . '/block')->assertOk();
        TenantContext::setById($this->home);
        $this->assertTrue(BlockUserService::isBlockedEither((int) $victim->id, (int) $neighbour->id));
    }

    // ------------------------------------------------------------ messages

    public function test_a_cross_community_block_stops_federated_messages_in_both_directions(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);
        $friend = $this->federatedMember($partner);

        $this->block($victim, $stranger, $this->home);

        // The blocked member cannot message the blocker.
        $this->as($stranger, $partner);
        $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'subject' => 'F284',
            'body' => 'F284-BLOCKED-BODY',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertSame(0, DB::table('federation_messages')->where('body', 'F284-BLOCKED-BODY')->count());
        $this->assertSame(0, $this->notificationCount($victim, 'federation_message'), 'no bell notification reached the blocker');

        // Nor can the blocker message the member they blocked (blocks are two-way, as locally).
        $this->as($victim, $this->home);
        $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $stranger->id,
            'receiver_tenant_id' => $partner,
            'subject' => 'F284',
            'body' => 'F284-REVERSE-BODY',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertSame(0, DB::table('federation_messages')->where('body', 'F284-REVERSE-BODY')->count());

        // Control: an unblocked member of the same partner community still gets through.
        $this->as($friend, $partner);
        $ok = $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'subject' => 'F284',
            'body' => 'F284-FRIEND-BODY',
        ]);
        $this->assertLessThan(300, $ok->getStatusCode(), 'control send failed: ' . $ok->getContent());
        $this->assertSame(1, DB::table('federation_messages')
            ->where('body', 'F284-FRIEND-BODY')
            ->where('receiver_user_id', (int) $victim->id)
            ->where('direction', 'inbound')
            ->count());
        $this->assertSame(1, $this->notificationCount($victim, 'federation_message'), 'control: the unblocked sender still notifies');
    }

    public function test_a_block_made_in_the_senders_community_also_holds(): void
    {
        // The blocked member blocks first, from their own community — the row
        // belongs to THAT community. The other member still cannot reach them.
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($partner);
        $sender = $this->federatedMember($this->home);

        $this->block($victim, $sender, $partner);

        $this->as($sender, $this->home);
        $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $partner,
            'subject' => 'F284',
            'body' => 'F284-OTHER-SIDE',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertSame(0, DB::table('federation_messages')->where('body', 'F284-OTHER-SIDE')->count());
    }

    public function test_unblocking_restores_federated_messaging(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);

        $this->block($victim, $stranger, $this->home);
        $this->as($victim, $this->home);
        $this->apiDelete('/v2/users/' . $stranger->id . '/block')->assertOk();

        $this->as($stranger, $partner);
        $ok = $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'subject' => 'F284',
            'body' => 'F284-AFTER-UNBLOCK',
        ]);
        $this->assertLessThan(300, $ok->getStatusCode(), $ok->getContent());
        $this->assertSame(2, DB::table('federation_messages')->where('body', 'F284-AFTER-UNBLOCK')->count());
    }

    // ------------------------------------------------------------ connections

    public function test_a_cross_community_block_stops_federated_connection_requests(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);
        $friend = $this->federatedMember($partner);

        $this->block($victim, $stranger, $this->home);

        $this->as($stranger, $partner);
        $this->apiPost('/v2/federation/connections', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'message' => 'F284-CONNECT',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertSame(0, DB::table('federation_connections')
            ->where('requester_user_id', (int) $stranger->id)
            ->where('receiver_user_id', (int) $victim->id)
            ->count());
        $this->assertSame(0, $this->notificationCount($victim, 'federation_connection'));

        // Control: an unblocked member of the same community can still ask.
        $this->as($friend, $partner);
        $ok = $this->apiPost('/v2/federation/connections', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'message' => 'F284-FRIEND-CONNECT',
        ]);
        $this->assertSame(201, $ok->getStatusCode(), $ok->getContent());
        $this->assertSame(1, DB::table('federation_connections')
            ->where('requester_user_id', (int) $friend->id)
            ->where('receiver_user_id', (int) $victim->id)
            ->where('status', 'pending')
            ->count());
        $this->assertSame(1, $this->notificationCount($victim, 'federation_connection'));
    }

    public function test_blocking_removes_a_pending_federated_connection_request_from_that_member(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);
        $friend = $this->federatedMember($partner);

        foreach ([$stranger, $friend] as $requester) {
            $this->as($requester, $partner);
            $this->apiPost('/v2/federation/connections', [
                'receiver_id' => $victim->id,
                'receiver_tenant_id' => $this->home,
            ])->assertStatus(201);
        }

        $this->as($victim, $this->home);
        $this->apiPost('/v2/users/' . $stranger->id . '/block')->assertOk();

        $this->assertSame(0, DB::table('federation_connections')
            ->where('requester_user_id', (int) $stranger->id)
            ->where('receiver_user_id', (int) $victim->id)
            ->count(), 'the blocked member\'s pending request no longer sits with the blocker');
        $this->assertSame(1, DB::table('federation_connections')
            ->where('requester_user_id', (int) $friend->id)
            ->where('receiver_user_id', (int) $victim->id)
            ->count(), 'control: another member\'s request is untouched');
    }

    // ------------------------------------------------------------ credit transfers

    public function test_a_cross_community_block_stops_a_federated_credit_transfer_and_its_notification(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);
        $friend = $this->federatedMember($partner);
        DB::table('users')->whereIn('id', [(int) $stranger->id, (int) $friend->id])->update(['balance' => 10]);

        $this->block($victim, $stranger, $this->home);

        $this->as($stranger, $partner);
        $this->apiPost('/v2/federation/transactions', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'amount' => 1,
            'description' => 'F284-BLOCKED-TX',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'BLOCKED');
        $this->assertSame(0, DB::table('transactions')->where('description', 'F284-BLOCKED-TX')->count());
        $this->assertSame(10, (int) DB::table('users')->where('id', (int) $stranger->id)->value('balance'), 'no credit moved');
        $this->assertSame(0, $this->notificationCount($victim, 'federation_transaction'));

        // Control: an unblocked member of the same partner community can still send credits.
        $this->as($friend, $partner);
        $ok = $this->apiPost('/v2/federation/transactions', [
            'receiver_id' => $victim->id,
            'receiver_tenant_id' => $this->home,
            'amount' => 1,
            'description' => 'F284-FRIEND-TX',
        ]);
        $this->assertSame(201, $ok->getStatusCode(), $ok->getContent());
        $this->assertSame(1, DB::table('transactions')->where('description', 'F284-FRIEND-TX')->count());
    }

    // ------------------------------------------------------------ F-285 interplay

    public function test_a_repeat_cross_community_block_is_not_re_homed_or_dropped(): void
    {
        $partner = $this->partnerCommunity();
        $victim = $this->federatedMember($this->home);
        $stranger = $this->federatedMember($partner);

        $this->block($victim, $stranger, $this->home, 'first');
        $this->block($victim, $stranger, $this->home, 'repeat');
        // The other member blocks back from their own community: a separate row.
        $this->block($stranger, $victim, $partner, 'reverse');

        $rows = DB::table('user_blocks')
            ->whereIn('user_id', [(int) $victim->id, (int) $stranger->id])
            ->whereIn('blocked_user_id', [(int) $victim->id, (int) $stranger->id])
            ->orderBy('user_id')
            ->get()
            ->keyBy('user_id');
        $this->assertCount(2, $rows);
        $this->assertSame($this->home, (int) $rows[(int) $victim->id]->tenant_id, 'the blocker\'s row stays in the blocker\'s community');
        $this->assertSame('first', (string) $rows[(int) $victim->id]->reason, 'a repeat block keeps the original row');
        $this->assertSame($partner, (int) $rows[(int) $stranger->id]->tenant_id);

        $this->assertTrue(BlockUserService::isBlockedEitherAcrossCommunities((int) $stranger->id, (int) $victim->id));
    }

    public function test_a_blocker_who_moved_community_can_re_block_a_cross_community_member(): void
    {
        // F-285 re-home, cross-community shape: the blocker's old row carries
        // the community they left, so it no longer applies; blocking again from
        // the new community must re-home it rather than silently do nothing.
        $partner = $this->partnerCommunity();
        $old = $this->community();
        $victim = $this->federatedMember($old);
        $stranger = $this->federatedMember($partner);

        TenantContext::setById($old);
        BlockUserService::block((int) $victim->id, (int) $stranger->id, 'before move');
        DB::table('users')->where('id', (int) $victim->id)->update(['tenant_id' => $this->home]);
        $victim->refresh();
        $this->assertFalse(BlockUserService::isBlockedEitherAcrossCommunities((int) $victim->id, (int) $stranger->id));

        $this->as($victim, $this->home);
        $this->apiPost('/v2/users/' . $stranger->id . '/block', ['reason' => 'after move'])->assertOk();

        $row = DB::table('user_blocks')
            ->where('user_id', (int) $victim->id)
            ->where('blocked_user_id', (int) $stranger->id)
            ->first();
        $this->assertNotNull($row);
        $this->assertSame($this->home, (int) $row->tenant_id);
        $this->assertTrue(BlockUserService::isBlockedEitherAcrossCommunities((int) $victim->id, (int) $stranger->id));
    }

    // ------------------------------------------------------------ helpers

    private function community(): int
    {
        $suffix = substr(bin2hex(random_bytes(4)), 0, 8);

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'F284 Community ' . $suffix,
            'slug' => 'f284-' . $suffix,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function partnerCommunity(): int
    {
        $tenantId = $this->community();

        $this->enableFederationForTenant($this->home);
        $this->enableFederationForTenant($tenantId);
        app(FederationFeatureService::class)->clearCache();

        $data = [
            'tenant_id' => $this->home,
            'partner_tenant_id' => $tenantId,
            'status' => 'active',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if (Schema::hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->home, $tenantId) . '-' . max($this->home, $tenantId);
        }
        DB::table('federation_partnerships')->insert($data);

        TenantContext::setById($this->home);

        return $tenantId;
    }

    private function federatedMember(int $tenantId): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'updated_at' => now(),
            ]
        );

        return $user;
    }

    private function as(User $user, int $tenantId): void
    {
        $this->app['auth']->forgetGuards();
        $this->withTenant($tenantId);
        TenantContext::setById($tenantId);
        Sanctum::actingAs($user, ['*']);
    }

    private function block(User $blocker, User $blocked, int $blockerTenantId, string $reason = 'F284'): void
    {
        $this->as($blocker, $blockerTenantId);
        $this->apiPost('/v2/users/' . $blocked->id . '/block', ['reason' => $reason])->assertOk();
    }

    private function notificationCount(User $user, string $type): int
    {
        return (int) DB::table('notifications')
            ->where('user_id', (int) $user->id)
            ->where('type', $type)
            ->count();
    }
}
