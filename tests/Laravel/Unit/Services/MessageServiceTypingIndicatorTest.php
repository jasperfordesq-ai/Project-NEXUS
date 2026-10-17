<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\MessageService;
use App\Services\PusherService;
use Mockery;
use Pusher\Pusher;
use Tests\Laravel\TestCase;

/**
 * Typing is ephemeral, so it is triggered synchronously through the shared
 * PusherService instance (the same no-op-when-unconfigured path every other
 * realtime service uses) on the RECIPIENT's user channel — the channel both
 * clients already hold open.
 */
final class MessageServiceTypingIndicatorTest extends TestCase
{
    protected function tearDown(): void
    {
        $this->setPusherInstance(null);
        parent::tearDown();
    }

    public function test_typing_is_triggered_on_the_recipients_user_channel_with_a_timestamp(): void
    {
        $tenantId = TenantContext::getId();
        $pusher = Mockery::mock(Pusher::class);
        $pusher->shouldReceive('trigger')
            ->once()
            ->with(
                "private-tenant.{$tenantId}.user.5",
                'typing',
                Mockery::on(static fn (array $data): bool => $data['user_id'] === 9
                    && $data['is_typing'] === true
                    && is_int($data['timestamp'] ?? null)),
            );
        $this->setPusherInstance($pusher);

        $this->assertTrue(MessageService::setTypingIndicator(recipientId: 5, userId: 9, isTyping: true));
    }

    public function test_typing_is_a_no_op_when_pusher_is_not_configured(): void
    {
        config(['broadcasting.connections.pusher.key' => '']);
        $this->setPusherInstance(null);

        $this->assertTrue(MessageService::setTypingIndicator(recipientId: 5, userId: 9, isTyping: false));
    }

    private function setPusherInstance(?Pusher $pusher): void
    {
        $ref = new \ReflectionClass(PusherService::class);
        $prop = $ref->getProperty('instance');
        $prop->setAccessible(true);
        $prop->setValue(null, $pusher);
    }
}
