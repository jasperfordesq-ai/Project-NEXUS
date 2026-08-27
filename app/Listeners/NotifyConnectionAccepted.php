<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\ConnectionAccepted;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies the original requester when their connection request is accepted.
 */
class NotifyConnectionAccepted implements ShouldQueue
{
    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a slow run released back to another worker would
     * re-send the acceptance email. Killing at 60s and not retrying keeps one
     * acceptance → one notification. Belt-and-braces with the Cache guard in handle().
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(ConnectionAccepted $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same connection so the acceptance notification is sent exactly once.
        $connectionId = (int) ($event->connectionModel->id ?? 0);
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($connectionId > 0) {
            $handledKey = 'notify_connection_accepted:done:' . $guardTenantId . ':' . $connectionId;
            $claimKey = 'notify_connection_accepted:claim:' . $guardTenantId . ':' . $connectionId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyConnectionAccepted: duplicate delivery suppressed', ['connection_id' => $connectionId, 'tenant_id' => $guardTenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyConnectionAccepted: concurrent delivery suppressed', ['connection_id' => $connectionId, 'tenant_id' => $guardTenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($event->tenantId);

            $connection  = $event->connectionModel;
            $requesterId = $connection->requester_id;
            $receiverId  = $connection->receiver_id;

            // Load the receiver (the person who accepted the request)
            $receiver = DB::table('users')
                ->where('id', $receiverId)
                ->where('tenant_id', $event->tenantId)
                ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
                ->first();

            if (!$receiver) {
                return;
            }

            // Fetch REQUESTER's preferred_language — they're the notification recipient.
            $requesterLocale = DB::table('users')
                ->where('id', $requesterId)
                ->where('tenant_id', $event->tenantId)
                ->value('preferred_language');

            $content = LocaleContext::withLocale($requesterLocale, function () use ($receiver) {
                $receiverName = UserDisplayName::resolve($receiver)
                    ?: ($receiver->name ?? __('emails.common.fallback_someone'));
                return __('emails_misc.social.connection_accepted', ['name' => $receiverName]);
            });
            $link = '/connections';

            // Respect email_connections opt-out preference
            $emailEnabled = true;
            try {
                $prefs        = User::getNotificationPreferences($requesterId);
                $emailEnabled = (bool) ($prefs['email_connections'] ?? true);
            } catch (\Throwable) {
                // Default to sending if preference lookup fails
            }

            LocaleContext::withLocale($requesterLocale, function () use ($emailEnabled, $requesterId, $content, $link) {
                if ($emailEnabled) {
                    NotificationDispatcher::dispatch(
                        $requesterId,
                        'global',
                        null,
                        'connection_accepted',
                        $content,
                        $link,
                        null
                    );
                } else {
                    // Bell notification only — user opted out of connection emails
                    Notification::createNotification($requesterId, $content, $link, 'connection_accepted');
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($requesterId), 'connection_accepted', $content, $link);
                }
            });

            // Mark handled only after the flow ran to completion so a redis
            // re-delivery cannot re-send the acceptance notification.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHour());
            }
        } catch (\Throwable $e) {
            Log::error('NotifyConnectionAccepted listener failed', [
                'connection_id' => $event->connectionModel->id ?? null,
                'tenant_id'     => $event->tenantId,
                'error'         => $e->getMessage(),
                'trace'         => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
