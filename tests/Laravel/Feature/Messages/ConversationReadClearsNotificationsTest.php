<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Messages;

use App\Core\TenantContext;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Reading a conversation must clear the bell notifications it generated.
 *
 * Unread message state lives in TWO stores: `messages.is_read` (the real
 * per-message flag) and `notifications` rows of type `new_message` (the bell
 * feed, written by NotifyMessageReceived with link `/messages/{senderId}`).
 * MessageService::markAsRead only ever cleared the first, so the second
 * accumulated for ever — and `/v2/notifications/counts` reports its `messages`
 * category from those rows. A member who had read every message still had a
 * non-zero count waiting at the next login, which is what the native app's
 * message badge was rendering.
 *
 * These tests pin the conversation-scoped clear: the partner's rows go read,
 * and nobody else's do.
 */
class ConversationReadClearsNotificationsTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0:int,1:int,2:int,3:int} [tenantId, userId, partnerId, otherPartnerId] */
    private function tenantAndThreeUsers(): array
    {
        $tenantId = (int) DB::table('tenants')->where('is_active', 1)->orderBy('id')->value('id');
        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->orderBy('id')
            ->limit(3)
            ->pluck('id')
            ->all();
        if (count($users) < 3) {
            $this->markTestSkipped('Test DB lacks three active users');
        }
        TenantContext::setById($tenantId);
        $this->app->instance('tenant.id', $tenantId);

        return [$tenantId, (int) $users[0], (int) $users[1], (int) $users[2]];
    }

    private function insertBellNotification(int $tenantId, int $userId, int $senderId, string $type = 'new_message'): int
    {
        return (int) DB::table('notifications')->insertGetId([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'message' => 'You have a new message',
            'link' => '/messages/' . $senderId,
            'type' => $type,
            'is_read' => 0,
            'created_at' => now(),
        ]);
    }

    public function test_marking_a_conversation_read_also_clears_its_bell_notifications(): void
    {
        [$tenantId, $userId, $partnerId] = $this->tenantAndThreeUsers();

        $notificationId = $this->insertBellNotification($tenantId, $userId, $partnerId);

        MessageService::markAsRead($partnerId, $userId);

        $this->assertSame(
            1,
            (int) DB::table('notifications')->where('id', $notificationId)->value('is_read'),
            'Reading the conversation left its new_message bell row unread, so the count returns at next login.'
        );
    }

    public function test_it_clears_every_message_notification_type_for_that_partner(): void
    {
        [$tenantId, $userId, $partnerId] = $this->tenantAndThreeUsers();

        $ids = [];
        foreach (['message', 'new_message', 'message_received'] as $type) {
            $ids[$type] = $this->insertBellNotification($tenantId, $userId, $partnerId, $type);
        }

        MessageService::markAsRead($partnerId, $userId);

        foreach ($ids as $type => $id) {
            $this->assertSame(
                1,
                (int) DB::table('notifications')->where('id', $id)->value('is_read'),
                "Notification type '{$type}' was left unread."
            );
        }
    }

    public function test_it_does_not_clear_notifications_from_a_different_conversation(): void
    {
        [$tenantId, $userId, $partnerId, $otherPartnerId] = $this->tenantAndThreeUsers();

        $readThis = $this->insertBellNotification($tenantId, $userId, $partnerId);
        $leaveThis = $this->insertBellNotification($tenantId, $userId, $otherPartnerId);

        MessageService::markAsRead($partnerId, $userId);

        $this->assertSame(1, (int) DB::table('notifications')->where('id', $readThis)->value('is_read'));
        $this->assertSame(
            0,
            (int) DB::table('notifications')->where('id', $leaveThis)->value('is_read'),
            'An unrelated conversation was marked read — the clear is not conversation-scoped.'
        );
    }

    public function test_it_does_not_clear_a_non_message_notification_sharing_the_link(): void
    {
        [$tenantId, $userId, $partnerId] = $this->tenantAndThreeUsers();

        $unrelated = $this->insertBellNotification($tenantId, $userId, $partnerId, 'connection_request');

        MessageService::markAsRead($partnerId, $userId);

        $this->assertSame(
            0,
            (int) DB::table('notifications')->where('id', $unrelated)->value('is_read'),
            'A non-message notification was cleared by reading a conversation.'
        );
    }

    public function test_it_does_not_clear_another_users_notifications(): void
    {
        [$tenantId, $userId, $partnerId, $otherUserId] = $this->tenantAndThreeUsers();

        $someoneElse = $this->insertBellNotification($tenantId, $otherUserId, $partnerId);

        MessageService::markAsRead($partnerId, $userId);

        $this->assertSame(
            0,
            (int) DB::table('notifications')->where('id', $someoneElse)->value('is_read'),
            'Reading my conversation cleared another member\'s bell row.'
        );
    }
}
