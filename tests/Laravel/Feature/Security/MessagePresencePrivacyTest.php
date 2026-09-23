<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PresenceService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-088 — "Hide my presence" must hold. The setting is stored in
 * user_presence.hide_presence, but the Redis presence entry was rebuilt on
 * the next heartbeat after it expired with hide_presence = false, and the
 * message endpoints derived "online" from users.last_active_at without
 * looking at the setting at all.
 */
class MessagePresencePrivacyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance('tenant.id', $this->testTenantId);
    }

    public function test_hidden_presence_survives_the_redis_entry_expiring(): void
    {
        $this->requireRedis();
        $member = $this->member();
        $key = "nexus:presence:{$this->testTenantId}:{$member->id}";

        try {
            PresenceService::heartbeat((int) $member->id);
            PresenceService::setPrivacy((int) $member->id, true);
            $this->assertSame('offline', PresenceService::getPresence((int) $member->id)['status']);

            // The 5-minute Redis entry lapses (member idle), then they come back.
            Redis::del($key);
            Redis::del("nexus:presence:throttle:{$this->testTenantId}:{$member->id}");
            PresenceService::heartbeat((int) $member->id);

            $this->assertSame('offline', PresenceService::getPresence((int) $member->id)['status']);
            $this->assertSame(
                'offline',
                PresenceService::getBulkPresence([(int) $member->id])[(int) $member->id]['status'],
            );

            // A status change after expiry must not unhide them either.
            Redis::del($key);
            PresenceService::setStatus((int) $member->id, 'online');
            $this->assertSame('offline', PresenceService::getPresence((int) $member->id)['status']);
        } finally {
            Redis::del($key);
            Redis::del("nexus:presence:throttle:{$this->testTenantId}:{$member->id}");
        }
    }

    public function test_message_endpoints_do_not_show_a_hidden_member_as_online(): void
    {
        [$viewer, $hidden, $visible] = [$this->member(), $this->member(), $this->member()];
        DB::table('users')->whereIn('id', [$hidden->id, $visible->id])->update(['last_active_at' => now()]);
        $this->hidePresence($hidden);
        $this->message($hidden, $viewer, 'From hidden member');
        $this->message($visible, $viewer, 'From visible member');
        Sanctum::actingAs($viewer, ['*']);

        $inbox = collect($this->apiGet('/v2/messages')->assertOk()->json('data'))->keyBy('partner_id');
        $this->assertFalse($inbox[$hidden->id]['other_user']['is_online']);
        $this->assertTrue($inbox[$visible->id]['other_user']['is_online']);

        $this->apiGet("/v2/messages/{$hidden->id}")
            ->assertOk()
            ->assertJsonPath('meta.conversation.other_user.is_online', false);
        $this->apiGet("/v2/messages/{$visible->id}")
            ->assertOk()
            ->assertJsonPath('meta.conversation.other_user.is_online', true);
    }

    public function test_inbox_never_returns_raw_last_active_times(): void
    {
        [$viewer, $hidden] = [$this->member(), $this->member()];
        DB::table('users')->where('id', $hidden->id)->update(['last_active_at' => now()]);
        $this->hidePresence($hidden);
        $this->message($hidden, $viewer, 'From hidden member');
        Sanctum::actingAs($viewer, ['*']);

        $row = collect($this->apiGet('/v2/messages')->assertOk()->json('data'))->keyBy('partner_id')[$hidden->id];

        foreach (['sender', 'receiver'] as $key) {
            if (is_array($row[$key] ?? null)) {
                $this->assertArrayNotHasKey('last_active_at', $row[$key], "The inbox {$key} object must not carry a raw last-active time.");
            }
        }
    }

    public function test_group_participant_list_does_not_show_a_hidden_member_as_online(): void
    {
        [$viewer, $hidden, $visible] = [$this->member(), $this->member(), $this->member()];
        DB::table('users')->whereIn('id', [$hidden->id, $visible->id])->update(['last_active_at' => now()]);
        $this->hidePresence($hidden);
        $conversationId = $this->group($viewer, [$hidden, $visible]);
        Sanctum::actingAs($viewer, ['*']);

        $participants = collect($this->apiGet("/v2/conversations/{$conversationId}/participants")
            ->assertOk()->json('data'))->keyBy('id');

        $this->assertFalse($participants[$hidden->id]['is_online']);
        $this->assertTrue($participants[$visible->id]['is_online']);
    }

    private function requireRedis(): void
    {
        try {
            Redis::ping();
        } catch (\Throwable $e) {
            $this->markTestSkipped('Redis unavailable: ' . $e->getMessage());
        }
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

    private function hidePresence(User $user): void
    {
        DB::table('user_presence')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'status' => 'online',
            'last_seen_at' => now(),
            'last_activity_at' => now(),
            'hide_presence' => 1,
        ]);
    }

    private function message(User $from, User $to, string $body): void
    {
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $from->id,
            'receiver_id' => $to->id,
            'body' => $body,
            'is_read' => 0,
            'created_at' => now(),
        ]);
    }

    /** @param list<User> $members */
    private function group(User $admin, array $members): int
    {
        $conversationId = (int) DB::table('conversations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'is_group' => true,
            'group_name' => 'F-088 presence group',
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach (array_merge([$admin], $members) as $index => $member) {
            DB::table('conversation_participants')->insert([
                'tenant_id' => $this->testTenantId,
                'conversation_id' => $conversationId,
                'user_id' => $member->id,
                'role' => $index === 0 ? 'admin' : 'member',
                'joined_at' => now(),
            ]);
        }

        return $conversationId;
    }
}
