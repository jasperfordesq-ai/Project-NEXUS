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
use App\Services\ContextualMessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

final class ContextualMessageServiceTest extends TestCase
{
    use DatabaseTransactions;

    private ContextualMessageService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance('tenant.id', $this->testTenantId);
        $this->service = new ContextualMessageService();
        Event::fake([MessageSent::class]);
    }

    public function test_send_without_context_uses_the_authoritative_message_and_outbox_boundary(): void
    {
        [$sender, $recipient] = $this->members();

        $messageId = $this->service->sendWithContext($sender->id, $recipient->id, 'Plain contextual service message');

        $this->assertNotNull($messageId);
        $this->assertDatabaseHas('messages', [
            'id' => $messageId,
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'context_type' => null,
            'context_id' => null,
        ]);
        $this->assertDatabaseHas('message_delivery_outbox', [
            'tenant_id' => $this->testTenantId,
            'message_id' => $messageId,
        ]);
        Event::assertDispatched(MessageSent::class);
    }

    public function test_invalid_sender_returns_null_and_creates_no_message(): void
    {
        [, $recipient] = $this->members();

        $messageId = $this->service->sendWithContext(2_000_000_001, $recipient->id, 'Invalid sender');

        $this->assertNull($messageId);
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'receiver_id' => $recipient->id,
            'body' => 'Invalid sender',
        ]);
        Event::assertNotDispatched(MessageSent::class);
    }

    public function test_invalid_context_type_is_removed_before_persistence(): void
    {
        [$sender, $recipient] = $this->members();

        $messageId = $this->service->sendWithContext($sender->id, $recipient->id, 'Invalid context', 'not-a-context', 42);
        $stored = Message::withoutGlobalScopes()->findOrFail($messageId);

        $this->assertNull($stored->context_type);
        $this->assertNull($stored->context_id);
    }

    public function test_context_without_an_id_is_removed_before_persistence(): void
    {
        [$sender, $recipient] = $this->members();

        $messageId = $this->service->sendWithContext($sender->id, $recipient->id, 'Missing context id', 'listing');
        $stored = Message::withoutGlobalScopes()->findOrFail($messageId);

        $this->assertNull($stored->context_type);
        $this->assertNull($stored->context_id);
    }

    /** @return array{User,User} */
    private function members(): array
    {
        return [
            User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']),
            User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']),
        ];
    }
}
