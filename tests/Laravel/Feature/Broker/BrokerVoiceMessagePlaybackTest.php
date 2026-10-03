<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Broker;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Brokers can hear the voice messages they review (owner decision,
 * 3 Oct 2026: "a safety feature"). Before this the broker copy showed only
 * "Voice message (N s)" and a transcript when one existed, so a voice message
 * without a transcript could not be reviewed at all.
 *
 * The route is bounded exactly like the message detail it sits beside: same
 * tenant, the F-436 party guard, only messages inside the copy's review
 * thread, nothing deleted for everyone, and every play audit-logged.
 */
final class BrokerVoiceMessagePlaybackTest extends TestCase
{
    use DatabaseTransactions;

    private const AUDIO_BYTES = "BROKER-VOICE-TEST-AUDIO\x00\x01\x02";

    /** @var list<string> */
    private array $files = [];

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        foreach ($this->files as $file) {
            @unlink($file);
        }
        parent::tearDown();
    }

    public function test_a_broker_can_play_a_voice_message_in_the_thread_they_are_reviewing(): void
    {
        [$a, $b] = [$this->user('member'), $this->user('member')];
        $voiceId = $this->voiceMessage((int) $a->id, (int) $b->id);
        $copyId = $this->copyOf($voiceId, (int) $a->id, (int) $b->id);
        $broker = $this->user('broker');

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$voiceId}");

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        self::assertSame(self::AUDIO_BYTES, $res->streamedContent());
        self::assertStringContainsString('no-store', (string) $res->headers->get('Cache-Control'));
        self::assertSame('nosniff', $res->headers->get('X-Content-Type-Options'));

        $audit = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $broker->id)
            ->where('action', 'broker_voice_message_played')
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($audit, 'every play must be audit-logged');
        $details = json_decode((string) $audit->details, true);
        self::assertSame($copyId, $details['copy_id']);
        self::assertSame($voiceId, $details['message_id']);
    }

    public function test_an_earlier_voice_message_in_the_same_thread_can_be_played_too(): void
    {
        [$a, $b] = [$this->user('member'), $this->user('member')];
        $earlier = $this->voiceMessage((int) $b->id, (int) $a->id, now()->subMinutes(5));
        $latest = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $a->id, 'receiver_id' => $b->id,
            'body' => 'reply', 'created_at' => now(),
        ]);
        $copyId = $this->copyOf($latest, (int) $a->id, (int) $b->id);

        Sanctum::actingAs($this->user('broker'), ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$earlier}");

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
    }

    public function test_a_voice_message_from_another_conversation_is_not_served(): void
    {
        [$a, $b, $c] = [$this->user('member'), $this->user('member'), $this->user('member')];
        $reviewed = $this->voiceMessage((int) $a->id, (int) $b->id);
        $copyId = $this->copyOf($reviewed, (int) $a->id, (int) $b->id);
        $elsewhere = $this->voiceMessage((int) $a->id, (int) $c->id);

        Sanctum::actingAs($this->user('broker'), ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$elsewhere}");

        self::assertSame(404, $res->getStatusCode(), 'only the thread under review may be played');
    }

    public function test_a_party_to_the_conversation_is_refused(): void
    {
        $broker = $this->user('broker');
        $other = $this->user('member');
        $voiceId = $this->voiceMessage((int) $other->id, (int) $broker->id);
        $copyId = $this->copyOf($voiceId, (int) $other->id, (int) $broker->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$voiceId}");

        self::assertSame(403, $res->getStatusCode(), 'F-436: the subject of monitoring may not use the broker route');
    }

    public function test_a_voice_message_deleted_for_everyone_is_not_served(): void
    {
        [$a, $b] = [$this->user('member'), $this->user('member')];
        $voiceId = $this->voiceMessage((int) $a->id, (int) $b->id);
        DB::table('messages')->where('id', $voiceId)->update(['is_deleted' => 1, 'deleted_at' => now()]);
        $copyId = $this->copyOf($voiceId, (int) $a->id, (int) $b->id);

        Sanctum::actingAs($this->user('broker'), ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$voiceId}");

        self::assertSame(404, $res->getStatusCode());
    }

    public function test_a_copy_from_another_community_is_not_served(): void
    {
        [$a, $b] = [$this->user('member'), $this->user('member')];
        $voiceId = $this->voiceMessage((int) $a->id, (int) $b->id);
        $copyId = $this->copyOf($voiceId, (int) $a->id, (int) $b->id);
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        self::assertGreaterThan(0, $otherTenant, 'setup: needs a second community');
        DB::table('broker_message_copies')->where('id', $copyId)->update(['tenant_id' => $otherTenant]);

        Sanctum::actingAs($this->user('broker'), ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$voiceId}");

        self::assertSame(404, $res->getStatusCode());
    }

    public function test_an_ordinary_member_cannot_use_the_broker_route(): void
    {
        [$a, $b] = [$this->user('member'), $this->user('member')];
        $voiceId = $this->voiceMessage((int) $a->id, (int) $b->id);
        $copyId = $this->copyOf($voiceId, (int) $a->id, (int) $b->id);

        Sanctum::actingAs($this->user('member'), ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}/voice/{$voiceId}");

        self::assertSame(403, $res->getStatusCode());
    }

    // ---------------------------------------------------------------- helpers

    private function user(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role, 'is_admin' => 0]);

        return User::find($u->id);
    }

    private function voiceMessage(int $senderId, int $receiverId, $at = null): int
    {
        $dir = storage_path("app/private/message-media/{$this->testTenantId}/voice");
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $name = 'voice_brokerplay' . bin2hex(random_bytes(6)) . '.webm';
        file_put_contents($dir . '/' . $name, self::AUDIO_BYTES);
        $this->files[] = $dir . '/' . $name;

        return (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'body' => '',
            'is_voice' => 1,
            'audio_url' => "message-media/{$this->testTenantId}/voice/{$name}",
            'audio_duration' => 4,
            'created_at' => $at ?? now(),
        ]);
    }

    private function copyOf(int $messageId, int $senderId, int $receiverId): int
    {
        $ids = [$senderId, $receiverId];
        sort($ids);

        return (int) DB::table('broker_message_copies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'original_message_id' => $messageId,
            'conversation_key' => md5(implode('-', $ids)),
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'message_body' => '',
            'sent_at' => now(),
            'copy_reason' => 'new_member',
        ]);
    }
}
