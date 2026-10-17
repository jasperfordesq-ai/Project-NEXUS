<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Messaging;

use App\Core\TenantContext;
use App\Events\MessageDeleted;
use App\Events\MessageReaction;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Editing, deleting and reacting to a one-to-one message tell the other
 * participant live, and a client that was not connected can catch up through
 * the thread GET's `updated_since` parameter.
 */
final class MessageMutationBroadcastTest extends TestCase
{
    use DatabaseTransactions;

    private User $sender;
    private User $receiver;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->app->instance('tenant.id', $this->testTenantId);
        $this->sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->receiver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    public function test_edit_endpoint_dispatches_message_updated_with_the_new_body(): void
    {
        $messageId = $this->sent('first draft');
        Sanctum::actingAs($this->sender, ['*']);
        Event::fake([MessageUpdated::class]);

        $this->apiPut("/v2/messages/{$messageId}", ['body' => 'second <b>draft</b>'])->assertOk();

        Event::assertDispatchedTimes(MessageUpdated::class, 1);
        Event::assertDispatched(MessageUpdated::class, fn (MessageUpdated $event): bool => $event->tenantId === $this->testTenantId
            && $event->messageId === $messageId
            && $event->body === 'second draft'
            && $event->senderId === (int) $this->sender->id
            && $event->receiverId === (int) $this->receiver->id
            && $event->editedAt !== '');
    }

    public function test_a_refused_edit_dispatches_nothing(): void
    {
        $messageId = $this->sent('not yours');
        Sanctum::actingAs($this->receiver, ['*']);
        Event::fake([MessageUpdated::class]);

        $this->apiPut("/v2/messages/{$messageId}", ['body' => 'hijacked'])->assertStatus(403);

        Event::assertNotDispatched(MessageUpdated::class);
    }

    public function test_delete_for_everyone_dispatches_message_deleted_for_both(): void
    {
        $messageId = $this->sent('take it back');
        Sanctum::actingAs($this->sender, ['*']);
        Event::fake([MessageDeleted::class]);

        $this->apiDelete("/v2/messages/{$messageId}", ['scope' => 'everyone'])->assertOk();

        Event::assertDispatchedTimes(MessageDeleted::class, 1);
        Event::assertDispatched(MessageDeleted::class, fn (MessageDeleted $event): bool => $event->scope === 'everyone'
            && $event->messageId === $messageId
            && $event->actorId === (int) $this->sender->id
            && $event->senderId === (int) $this->sender->id
            && $event->receiverId === (int) $this->receiver->id
            && $event->deletedAt !== '');
    }

    public function test_delete_for_self_by_the_receiver_dispatches_only_to_the_receiver(): void
    {
        $messageId = $this->sent('hide from me');
        Sanctum::actingAs($this->receiver, ['*']);
        Event::fake([MessageDeleted::class]);

        $this->apiDelete("/v2/messages/{$messageId}", ['scope' => 'self'])->assertOk();

        Event::assertDispatched(MessageDeleted::class, function (MessageDeleted $event): bool {
            $channels = array_map(static fn ($channel): string => $channel->name, $event->broadcastOn());

            return $event->scope === 'self'
                && $event->actorId === (int) $this->receiver->id
                && $channels === ["private-tenant.{$this->testTenantId}.user.{$this->receiver->id}"];
        });
    }

    public function test_a_refused_delete_dispatches_nothing(): void
    {
        $messageId = $this->sent('evidence');
        Sanctum::actingAs($this->receiver, ['*']);
        Event::fake([MessageDeleted::class]);

        $this->apiDelete("/v2/messages/{$messageId}", ['scope' => 'everyone'])->assertStatus(403);

        Event::assertNotDispatched(MessageDeleted::class);
    }

    public function test_reaction_toggle_dispatches_the_counts_after_each_toggle(): void
    {
        $messageId = $this->sent('react to me');
        Sanctum::actingAs($this->receiver, ['*']);
        Event::fake([MessageReaction::class]);

        $this->apiPost("/v2/messages/{$messageId}/reactions", ['emoji' => '👍'])->assertOk();
        Event::assertDispatched(MessageReaction::class, fn (MessageReaction $event): bool => $event->action === 'added'
            && $event->messageId === $messageId
            && $event->emoji === '👍'
            && $event->actorId === (int) $this->receiver->id
            && $event->counts === ['👍' => 1]
            && $event->senderId === (int) $this->sender->id
            && $event->receiverId === (int) $this->receiver->id);

        $this->apiPost("/v2/messages/{$messageId}/reactions", ['emoji' => '👍'])->assertOk();
        Event::assertDispatched(MessageReaction::class, fn (MessageReaction $event): bool => $event->action === 'removed'
            && $event->counts === []);

        Event::assertDispatchedTimes(MessageReaction::class, 2);
    }

    public function test_thread_poll_with_updated_since_returns_edited_and_deleted_rows_below_the_cursor(): void
    {
        $edited = $this->sent('will be edited');
        $deleted = $this->sent('will be deleted');
        $untouched = $this->sent('left alone');
        $since = now()->subSecond()->toISOString();
        Event::fake([MessageUpdated::class, MessageDeleted::class]);
        MessageService::editMessage($edited, (int) $this->sender->id, 'edited body');
        MessageService::deleteMessage($deleted, (int) $this->sender->id, 'everyone');
        $newer = $this->sent('arrived later');
        Sanctum::actingAs($this->receiver, ['*']);
        $cursor = base64_encode((string) $untouched);

        $plain = $this->apiGet("/v2/messages/{$this->sender->id}?direction=newer&cursor={$cursor}")->assertOk()->json();
        $this->assertSame([$newer], array_column($plain['data'], 'id'));
        $this->assertArrayHasKey('synced_at', $plain['meta']);

        $query = http_build_query(['direction' => 'newer', 'cursor' => $cursor, 'updated_since' => $since]);
        $caughtUp = $this->apiGet("/v2/messages/{$this->sender->id}?{$query}")->assertOk()->json();

        $this->assertSame([$edited, $deleted, $newer], array_column($caughtUp['data'], 'id'));
        $byId = array_column($caughtUp['data'], null, 'id');
        $this->assertSame('edited body', $byId[$edited]['body']);
        $this->assertTrue((bool) $byId[$edited]['is_edited']);
        $this->assertTrue((bool) $byId[$deleted]['is_deleted']);
        $this->assertNotSame('will be deleted', $byId[$deleted]['body']);
    }

    public function test_thread_poll_ignores_an_unparseable_updated_since(): void
    {
        $first = $this->sent('one');
        $second = $this->sent('two');
        Sanctum::actingAs($this->receiver, ['*']);
        $cursor = base64_encode((string) $first);

        $response = $this->apiGet("/v2/messages/{$this->sender->id}?direction=newer&cursor={$cursor}&updated_since=yesterday-ish")->assertOk()->json();

        $this->assertSame([$second], array_column($response['data'], 'id'));
    }

    private function sent(string $body): int
    {
        Event::fake([MessageSent::class]);
        $message = MessageService::send((int) $this->sender->id, (int) $this->receiver->id, ['body' => $body]);
        $this->assertNotNull($message, 'fixture send failed: ' . json_encode(MessageService::getErrors()));
        // The messages table keys ordering by id; keep timestamps distinct too.
        DB::table('messages')->where('id', (int) $message['id'])->update(['created_at' => now()]);

        return (int) $message['id'];
    }
}
