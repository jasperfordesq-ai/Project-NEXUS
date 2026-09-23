<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-087 — the legacy POST /api/messages/delete-conversation route permanently
 * deleted BOTH members' messages, and the broker_message_copies foreign key
 * (ON DELETE CASCADE) took the broker's safeguarding copies with them. It must
 * behave like the v2 delete-conversation with scope "self": hide the
 * conversation from the caller only.
 */
class LegacyConversationDeleteTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance('tenant.id', $this->testTenantId);
    }

    public function test_legacy_delete_conversation_only_hides_it_from_the_caller(): void
    {
        [$caller, $other] = [$this->member(), $this->member()];
        $sentId = $this->message($caller, $other, 'Caller to other');
        $receivedId = $this->message($other, $caller, 'Other to caller');
        $copyId = DB::table('broker_message_copies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'original_message_id' => $receivedId,
            'conversation_key' => md5('f087'),
            'sender_id' => $other->id,
            'receiver_id' => $caller->id,
            'message_body' => 'Other to caller',
            'sent_at' => now(),
            'copy_reason' => 'flagged_user',
        ]);
        Sanctum::actingAs($caller, ['*']);

        $this->apiPost('/messages/delete-conversation', ['other_user_id' => $other->id])
            ->assertOk();

        // Neither member's messages are destroyed, and the broker copy survives.
        $this->assertDatabaseHas('messages', ['id' => $sentId, 'body' => 'Caller to other']);
        $this->assertDatabaseHas('messages', ['id' => $receivedId, 'body' => 'Other to caller']);
        $this->assertDatabaseHas('broker_message_copies', ['id' => $copyId, 'original_message_id' => $receivedId]);

        // The caller's inbox no longer lists the conversation ...
        $callerInbox = collect($this->apiGet('/v2/messages')->assertOk()->json('data'))->pluck('partner_id')->all();
        $this->assertNotContains($other->id, $callerInbox);

        // ... but the other member still has their whole conversation.
        Sanctum::actingAs($other, ['*']);
        $otherInbox = collect($this->apiGet('/v2/messages')->assertOk()->json('data'))->pluck('partner_id')->all();
        $this->assertContains($caller->id, $otherInbox);
        $thread = collect($this->apiGet("/v2/messages/{$caller->id}")->assertOk()->json('data'))->pluck('body')->all();
        $this->assertContains('Caller to other', $thread);
        $this->assertContains('Other to caller', $thread);
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

    private function message(User $from, User $to, string $body): int
    {
        return (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $from->id,
            'receiver_id' => $to->id,
            'body' => $body,
            'is_read' => 0,
            'created_at' => now(),
        ]);
    }
}
