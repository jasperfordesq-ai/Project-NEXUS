<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Contracts\EventBroadcastTransport;
use App\Core\Mailer;
use App\Enums\EventBroadcastChannel;
use App\Exceptions\EventBroadcastException;
use App\Models\Notification;
use App\Support\Events\EventBroadcastRenderedMessage;
use App\Support\Events\EventBroadcastTransportResult;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Provider handoff only; claiming, retry, and suppression remain in the consumer. */
final class EventBroadcastChannelDispatcher implements EventBroadcastTransport
{
    private const EMAIL_CATEGORY = 'event_broadcast';

    public function send(
        EventBroadcastChannel $channel,
        int $tenantId,
        int $eventId,
        object $recipient,
        EventBroadcastRenderedMessage $message,
        string $deliveryKey,
        string $emailCadence,
    ): EventBroadcastTransportResult {
        return match ($channel) {
            EventBroadcastChannel::Email => $this->email(
                $tenantId,
                $eventId,
                $recipient,
                $message,
                $deliveryKey,
                $emailCadence,
            ),
            EventBroadcastChannel::InApp => $this->inApp(
                $tenantId,
                $recipient,
                $message,
                $deliveryKey,
            ),
            EventBroadcastChannel::Push => $this->push(
                $tenantId,
                $eventId,
                $recipient,
                $message,
                $deliveryKey,
            ),
        };
    }

    private function email(
        int $tenantId,
        int $eventId,
        object $recipient,
        EventBroadcastRenderedMessage $message,
        string $deliveryKey,
        string $cadence,
    ): EventBroadcastTransportResult {
        $userId = (int) ($recipient->id ?? 0);
        $email = trim((string) ($recipient->email ?? ''));
        if ($userId <= 0 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new EventBroadcastException('event_broadcast_email_destination_invalid');
        }
        if (Mailer::isSuppressed($email)) {
            throw new EventBroadcastException('event_broadcast_email_provider_suppressed');
        }
        if ($this->successfulEmailEvidenceExists($tenantId, $deliveryKey)) {
            return new EventBroadcastTransportResult('email_log', $deliveryKey);
        }
        if ($cadence !== 'instant') {
            if (! in_array($cadence, ['daily', 'monthly'], true)) {
                throw new EventBroadcastException('event_broadcast_email_cadence_invalid');
            }
            DB::table('notification_queue')->insertOrIgnore([
                'event_delivery_id' => null,
                'event_id' => $eventId,
                'idempotency_key' => $deliveryKey,
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'activity_type' => $message->notificationType,
                'content_snippet' => mb_substr($message->message, 0, 250),
                'link' => $message->path,
                'frequency' => $cadence,
                'email_body' => $message->html,
                'created_at' => now(),
                'status' => 'pending',
            ]);

            return new EventBroadcastTransportResult('notification_queue', $deliveryKey);
        }

        $sent = EmailDispatchService::sendRaw(
            $email,
            $message->subject,
            $message->html,
            null,
            null,
            EventNotificationPreferenceResolver::unsubscribeUrl($userId, $tenantId),
            self::EMAIL_CATEGORY,
            [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'idempotency_key' => $deliveryKey,
                'source' => self::class,
            ],
        );
        if (! $sent) {
            throw new EventBroadcastException('event_broadcast_email_provider_rejected');
        }

        return new EventBroadcastTransportResult('email', $deliveryKey);
    }

    private function inApp(
        int $tenantId,
        object $recipient,
        EventBroadcastRenderedMessage $message,
        string $deliveryKey,
    ): EventBroadcastTransportResult {
        // Keyed by the delivery, so a repeated hand-off (a released stale
        // claim, a retry) never puts a second copy in the bell (E-106 FN-3).
        $notificationId = Notification::createNotification(
            (int) $recipient->id,
            $message->message,
            $message->path,
            $message->notificationType,
            false,
            $tenantId,
            'event_broadcast:' . $deliveryKey,
        );

        return new EventBroadcastTransportResult('database', (string) $notificationId);
    }

    private function push(
        int $tenantId,
        int $eventId,
        object $recipient,
        EventBroadcastRenderedMessage $message,
        string $deliveryKey,
    ): EventBroadcastTransportResult {
        $userId = (int) ($recipient->id ?? 0);
        if ($userId <= 0) {
            throw new EventBroadcastException('event_broadcast_push_destination_invalid');
        }

        $preferences = EventNotificationPreferenceResolver::resolveForEvent(
            $userId,
            $tenantId,
            $eventId,
        );
        $channels = is_array($preferences['channels'] ?? null)
            ? $preferences['channels']
            : [];
        $webPushEnabled = (bool) ($channels['web_push'] ?? false);
        $fcmEnabled = (bool) ($channels['fcm'] ?? false);
        if (! $webPushEnabled && ! $fcmEnabled) {
            throw new EventBroadcastException('event_broadcast_push_channel_disabled');
        }

        // This worker is the durable push outbox. Provider calls must complete
        // before the delivery row is acknowledged; after-response fan-out would
        // turn a successful handoff into untracked best-effort work. Each
        // provider is invoked only when its independently configurable channel
        // remains enabled at dispatch time.
        $webSent = $webPushEnabled && WebPushService::sendToUserStatic(
            $userId,
            $message->subject,
            $message->message,
            $message->path,
            $message->notificationType,
            ['event_delivery_key' => $deliveryKey],
        );
        $fcm = $fcmEnabled
            ? FCMPushService::sendToUser(
                $userId,
                $message->subject,
                $message->message,
                [
                    'link' => $message->path,
                    'type' => $message->notificationType,
                    'event_delivery_key' => $deliveryKey,
                ],
            )
            : ['sent' => 0, 'failed' => 0];
        $fcmSent = max(0, (int) ($fcm['sent'] ?? 0));
        $fcmFailed = max(0, (int) ($fcm['failed'] ?? 0));
        if (! $webSent && $fcmSent < 1) {
            throw new EventBroadcastException($fcmFailed > 0
                ? 'event_broadcast_push_provider_rejected'
                : 'event_broadcast_push_destination_missing');
        }

        return new EventBroadcastTransportResult(
            $fcmFailed > 0 ? 'push_partial' : 'push',
            $deliveryKey,
        );
    }

    private function successfulEmailEvidenceExists(int $tenantId, string $deliveryKey): bool
    {
        return Schema::hasTable('email_log')
            && Schema::hasColumn('email_log', 'idempotency_key')
            && DB::table('email_log')
                ->where('tenant_id', $tenantId)
                ->where('category', self::EMAIL_CATEGORY)
                ->where('idempotency_key', $deliveryKey)
                ->whereIn('status', ['sent', 'delivered'])
                ->exists();
    }
}
