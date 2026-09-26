<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Messages;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-210: only the person who SENT a message may delete it for everyone.
 *
 * `MessageService::deleteMessage()` used to accept `scope=everyone` from the
 * receiver too, blanking the other person's words for both participants — so a
 * member could erase what someone else had said to them, including evidence of
 * harassment. The receiver keeps "delete for me" (a per-user hide).
 */
class MessageDeleteScopeTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0: User, 1: User, 2: int} */
    private function conversation(): array
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $this->app->instance('tenant.id', $tenantId);
        \Illuminate\Support\Facades\Event::fake([\App\Events\MessageSent::class]);
        $sender = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $receiver = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $message = MessageService::send((int) $sender->id, (int) $receiver->id, ['body' => 'words the sender wrote']);

        return [$sender, $receiver, (int) $message['id']];
    }

    public function test_receiver_cannot_delete_the_senders_message_for_everyone(): void
    {
        [, $receiver, $messageId] = $this->conversation();
        Sanctum::actingAs($receiver, ['*']);

        $this->apiDelete("/v2/messages/{$messageId}", ['scope' => 'everyone'])->assertStatus(403);

        $row = DB::table('messages')->where('id', $messageId)->first();
        self::assertSame('words the sender wrote', $row->body);
        self::assertFalse((bool) $row->is_deleted);
    }

    public function test_a_request_without_a_scope_does_not_let_the_receiver_blank_the_message(): void
    {
        [, $receiver, $messageId] = $this->conversation();
        Sanctum::actingAs($receiver, ['*']);

        $this->apiDelete("/v2/messages/{$messageId}")->assertStatus(403);

        self::assertSame('words the sender wrote', DB::table('messages')->where('id', $messageId)->value('body'));
    }

    public function test_receiver_can_still_delete_the_message_for_themselves(): void
    {
        [, $receiver, $messageId] = $this->conversation();
        Sanctum::actingAs($receiver, ['*']);

        $this->apiDelete("/v2/messages/{$messageId}", ['scope' => 'self'])->assertOk();

        $row = DB::table('messages')->where('id', $messageId)->first();
        self::assertTrue((bool) $row->is_deleted_receiver);
        self::assertSame('words the sender wrote', $row->body);
    }

    public function test_sender_can_delete_their_own_message_for_everyone(): void
    {
        [$sender, , $messageId] = $this->conversation();
        Sanctum::actingAs($sender, ['*']);

        $this->apiDelete("/v2/messages/{$messageId}", ['scope' => 'everyone'])->assertOk();

        self::assertTrue((bool) DB::table('messages')->where('id', $messageId)->value('is_deleted'));
    }
}
