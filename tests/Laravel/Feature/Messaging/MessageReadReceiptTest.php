<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Messaging;

use App\Events\MessageRead;
use App\Models\Message;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Reading a conversation tells the sender, live, that their messages were read.
 *
 * `markAsRead` runs on every thread GET, so the event goes out only when rows
 * actually changed: zero broadcasts for an already-read thread.
 */
final class MessageReadReceiptTest extends TestCase
{
    use DatabaseTransactions;

    private User $me;
    private User $partner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->me = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->partner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    public function test_mark_as_read_dispatches_once_with_the_highest_read_id_when_rows_changed(): void
    {
        $first = $this->unreadFrom($this->partner, 'one');
        $second = $this->unreadFrom($this->partner, 'two');
        $third = $this->unreadFrom($this->partner, 'three');
        // Unread from someone else: stays unread and is what the reader's badge still shows.
        $stranger = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->unreadFrom($stranger, 'elsewhere');
        Event::fake([MessageRead::class]);

        $marked = MessageService::markAsRead((int) $this->partner->id, (int) $this->me->id);

        $this->assertSame(3, $marked);
        Event::assertDispatchedTimes(MessageRead::class, 1);
        Event::assertDispatched(MessageRead::class, fn (MessageRead $event): bool => $event->tenantId === $this->testTenantId
            && $event->readerId === (int) $this->me->id
            && $event->senderId === (int) $this->partner->id
            && $event->upToMessageId === max((int) $first->id, (int) $second->id, (int) $third->id)
            && $event->readCount === 3
            && $event->readerUnreadMessages === 1
            && $event->readAt !== '');
        $this->assertSame(0, Message::withoutGlobalScopes()->whereKey($third->id)->where('is_read', false)->count());
    }

    public function test_mark_as_read_does_not_dispatch_when_nothing_was_unread(): void
    {
        $this->unreadFrom($this->partner, 'already read', isRead: true);
        Event::fake([MessageRead::class]);

        $this->assertSame(0, MessageService::markAsRead((int) $this->partner->id, (int) $this->me->id));

        Event::assertNotDispatched(MessageRead::class);
    }

    public function test_mark_as_read_ignores_federated_rows(): void
    {
        $federated = $this->unreadFrom($this->partner, 'from a partner platform', isFederated: true);
        Event::fake([MessageRead::class]);

        $this->assertSame(0, MessageService::markAsRead((int) $this->partner->id, (int) $this->me->id));

        Event::assertNotDispatched(MessageRead::class);
        $this->assertFalse((bool) Message::withoutGlobalScopes()->whereKey($federated->id)->value('is_read'));
    }

    public function test_put_read_endpoint_dispatches_message_read(): void
    {
        $this->unreadFrom($this->partner, 'hello');
        Sanctum::actingAs($this->me, ['*']);
        Event::fake([MessageRead::class]);

        $this->apiPut("/v2/messages/{$this->partner->id}/read")->assertOk();

        Event::assertDispatchedTimes(MessageRead::class, 1);
    }

    public function test_thread_get_dispatches_but_a_newer_cursor_poll_does_not(): void
    {
        $first = $this->unreadFrom($this->partner, 'hello');
        Sanctum::actingAs($this->me, ['*']);
        Event::fake([MessageRead::class]);

        $this->apiGet("/v2/messages/{$this->partner->id}")->assertOk();
        Event::assertDispatchedTimes(MessageRead::class, 1);

        // A background poll for newer messages must not mark anything read (the
        // member may not be looking), so it must not broadcast either.
        $this->unreadFrom($this->partner, 'arrived while polling');
        $cursor = base64_encode((string) $first->id);
        $this->apiGet("/v2/messages/{$this->partner->id}?direction=newer&cursor={$cursor}")->assertOk();

        Event::assertDispatchedTimes(MessageRead::class, 1);
    }

    private function unreadFrom(User $sender, string $body, bool $isRead = false, bool $isFederated = false): Message
    {
        // forceCreate: is_federated is deliberately not mass-assignable on the model.
        return Message::withoutGlobalScopes()->forceCreate([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $this->me->id,
            'body' => $body,
            'is_read' => $isRead,
            'is_federated' => $isFederated ? 1 : 0,
            'created_at' => now(),
        ]);
    }
}
