<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Messaging;

use App\Events\MessageSent;
use App\Models\Message;
use App\Models\User;
use App\Services\MessageDeliveryOutboxService;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

final class MessageDeliveryOutboxTest extends TestCase
{
    use DatabaseTransactions;

    public function test_failed_enqueue_stays_pending_and_a_retry_dispatches_exactly_once(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $message = Message::withoutGlobalScopes()->create([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Outbox recovery payload remains canonical',
            'is_read' => false,
            'created_at' => now(),
        ]);
        MessageDeliveryOutboxService::record($this->testTenantId, (int) $message->id);

        $failingDispatcher = \Mockery::mock(Dispatcher::class);
        $failingDispatcher->shouldReceive('dispatch')
            ->once()
            ->andThrow(new \RuntimeException("Simulated queue outage\nwith Bearer secret-token-value transport detail"));
        $failed = (new MessageDeliveryOutboxService($failingDispatcher))
            ->dispatchMessage($this->testTenantId, (int) $message->id);
        $pending = DB::table('message_delivery_outbox')->where('message_id', $message->id)->first();

        $this->assertFalse($failed);
        $this->assertNull($pending->dispatched_at);
        $this->assertNull($pending->dead_lettered_at);
        $this->assertSame(1, (int) $pending->attempts);
        $this->assertNotNull($pending->next_attempt_at);
        $this->assertSame('Simulated queue outage with Bearer [REDACTED] transport detail', $pending->last_error);

        Event::fake([MessageSent::class]);
        $service = new MessageDeliveryOutboxService(app(Dispatcher::class));
        $this->assertTrue($service->dispatchMessage($this->testTenantId, (int) $message->id, true));
        $this->assertTrue($service->dispatchMessage($this->testTenantId, (int) $message->id, true));

        Event::assertDispatchedTimes(MessageSent::class, 1);
        Event::assertDispatched(MessageSent::class, function (MessageSent $event) use ($message, $sender, $recipient): bool {
            return (int) $event->message->id === (int) $message->id
                && (int) $event->sender->id === (int) $sender->id
                && (int) $event->tenantId === $this->testTenantId
                && (int) $event->conversationId === (int) crc32(implode('-', [$sender->id, $recipient->id]));
        });
        $this->assertNotNull(DB::table('message_delivery_outbox')->where('message_id', $message->id)->value('dispatched_at'));
    }

    public function test_scheduled_command_dispatches_due_rows_and_leaves_future_backoff_alone(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $due = $this->message($sender, $recipient, 'Due delivery');
        $future = $this->message($sender, $recipient, 'Future delivery');
        MessageDeliveryOutboxService::record($this->testTenantId, (int) $due->id);
        MessageDeliveryOutboxService::record($this->testTenantId, (int) $future->id);
        DB::table('message_delivery_outbox')->where('message_id', $future->id)->update([
            'next_attempt_at' => now()->addHour(),
        ]);

        Event::fake([MessageSent::class]);
        $this->artisan('messages:process-delivery-outbox', ['--limit' => 10])
            ->expectsOutputToContain('claimed=1')
            ->expectsOutputToContain('dispatched=1')
            ->assertSuccessful();

        Event::assertDispatchedTimes(MessageSent::class, 1);
        Event::assertDispatched(MessageSent::class, fn (MessageSent $event): bool => (int) $event->message->id === (int) $due->id);
        $this->assertNotNull(DB::table('message_delivery_outbox')->where('message_id', $due->id)->value('dispatched_at'));
        $this->assertNull(DB::table('message_delivery_outbox')->where('message_id', $future->id)->value('dispatched_at'));
    }

    public function test_eighth_failed_attempt_dead_letters_without_losing_the_message(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $message = $this->message($sender, $recipient, 'Dead letter preserves canonical content');
        MessageDeliveryOutboxService::record($this->testTenantId, (int) $message->id);
        DB::table('message_delivery_outbox')->where('message_id', $message->id)->update(['attempts' => 7]);

        $dispatcher = \Mockery::mock(Dispatcher::class);
        $dispatcher->shouldReceive('dispatch')->once()->andThrow(new \RuntimeException('Queue unavailable'));
        $this->assertFalse((new MessageDeliveryOutboxService($dispatcher))
            ->dispatchMessage($this->testTenantId, (int) $message->id, true));

        $row = DB::table('message_delivery_outbox')->where('message_id', $message->id)->first();
        $this->assertSame(8, (int) $row->attempts);
        $this->assertNotNull($row->dead_lettered_at);
        $this->assertNull($row->next_attempt_at);
        $this->assertSame(1, Message::withoutGlobalScopes()->whereKey($message->id)->count());
    }

    private function message(User $sender, User $recipient, string $body): Message
    {
        return Message::withoutGlobalScopes()->create([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => $body,
            'is_read' => false,
            'created_at' => now(),
        ]);
    }
}
