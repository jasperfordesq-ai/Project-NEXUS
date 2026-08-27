<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\GroupChatroomMessagePosted;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Creates in-app bell notifications for offline group members when a new
 * chatroom message is posted.
 *
 * NOTE — in-app only, NOT email. Group chat volume is too high to safely
 * email every message; users see chat in real time via the Pusher broadcast
 * that GroupChatroomMessagePosted also drives, and the in-app bell catches
 * up the rest when they next log in.
 *
 * Members who muted the sender (`user_muted_users`) are skipped. The sender
 * never gets a notification for their own message. Dedup against an
 * existing recent (last 5 min) chatroom-message notification per recipient
 * prevents a flurry of consecutive chat messages from producing one bell
 * row each.
 */
class NotifyGroupChatroomMessage implements ShouldQueue
{
    public string $queue = 'default';

    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a slow fanout released back to another worker would
     * push duplicate bell/push notifications. Killing at 60s and not retrying
     * keeps one chat message → one fanout. Belt-and-braces with the Cache
     * guard in handle().
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(GroupChatroomMessagePosted $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same chat message so the bell/push fanout runs exactly once.
        $guardMessageId = (int) ($event->message['id'] ?? 0);
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($guardMessageId > 0) {
            $handledKey = 'notify_group_chatroom_message:done:' . $guardTenantId . ':' . $guardMessageId;
            $claimKey = 'notify_group_chatroom_message:claim:' . $guardTenantId . ':' . $guardMessageId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyGroupChatroomMessage: duplicate delivery suppressed', ['message_id' => $guardMessageId, 'tenant_id' => $guardTenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyGroupChatroomMessage: concurrent delivery suppressed', ['message_id' => $guardMessageId, 'tenant_id' => $guardTenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($event->tenantId);

            $senderId    = (int) ($event->message['user_id'] ?? 0);
            $messageId   = (int) ($event->message['id'] ?? 0);
            $messageBody = (string) ($event->message['body'] ?? '');

            if ($senderId === 0 || $messageId === 0) {
                return;
            }

            // Resolve sender/group names once. The null fallbacks are resolved
            // per-recipient below so they render in each recipient's language,
            // not the queue worker's default locale.
            $sender = DB::table('users')
                ->where('id', $senderId)
                ->where('tenant_id', $event->tenantId)
                ->select(['first_name', 'name'])
                ->first();
            $senderRealName = $sender->first_name ?? $sender->name ?? null;

            // Resolve group name for the link/preview.
            $group = DB::table('groups')
                ->where('id', $event->groupId)
                ->where('tenant_id', $event->tenantId)
                ->select(['name', 'slug'])
                ->first();
            $groupRealName = $group->name ?? null;

            $previewBody = mb_substr(strip_tags($messageBody), 0, 120);
            $link    = '/groups/' . $event->groupId . '/chat';

            // All active group members EXCEPT the sender and anyone who muted
            // the sender are eligible. group_members has `joined_at` and a
            // unique (tenant_id, group_id, user_id) shape.
            $recipients = DB::table('group_members as gm')
                ->join('users as u', 'u.id', '=', 'gm.user_id')
                ->where('gm.tenant_id', $event->tenantId)
                ->where('gm.group_id', $event->groupId)
                ->where('u.status', 'active')
                ->where('u.id', '!=', $senderId)
                ->whereNotIn('u.id', function ($q) use ($senderId, $event) {
                    $q->select('user_id')->from('user_muted_users')
                      ->where('muted_user_id', $senderId)
                      ->where('tenant_id', $event->tenantId);
                })
                ->select('u.id', 'u.preferred_language')
                ->get();

            if ($recipients->isEmpty()) {
                return;
            }

            $recipientIds = $recipients->pluck('id')->all();

            // Dedup window: if the recipient already has a chatroom-message
            // bell from the same group within the last 5 minutes, don't add
            // another. Prevents 10 chat messages → 10 bell rows.
            $recentlyNotified = DB::table('notifications')
                ->where('tenant_id', $event->tenantId)
                ->where('type', 'group_chatroom_message')
                ->where('link', $link)
                ->where('created_at', '>=', now()->subMinutes(5))
                ->whereIn('user_id', $recipientIds)
                ->pluck('user_id')
                ->all();

            $newRecipientIds = array_diff($recipientIds, $recentlyNotified);
            if (empty($newRecipientIds)) {
                return;
            }

            $langByUser = $recipients->keyBy('id');

            foreach ($newRecipientIds as $userId) {
                $lang = $langByUser[$userId]->preferred_language ?? null;

                // Render the preview in THIS recipient's language so the fallback
                // names are not hardcoded English. The ':sender · :group: :preview'
                // template is locale-neutral (no preposition to mistranslate).
                LocaleContext::withLocale($lang, function () use ($userId, $senderRealName, $groupRealName, $previewBody, $link, $event) {
                    $senderName = $senderRealName ?? __('svc_notifications.group_chatroom.fallback_sender');
                    $groupName  = $groupRealName ?? __('svc_notifications.group_chatroom.fallback_group');
                    $content    = __('svc_notifications.group_chatroom.preview', [
                        'sender'  => $senderName,
                        'group'   => $groupName,
                        'preview' => $previewBody,
                    ]);

                    Notification::createNotification(
                        (int) $userId,
                        $content,
                        $link,
                        'group_chatroom_message',
                        false,
                        $event->tenantId
                    );
                    // Keep the private message preview inside the authenticated app.
                    // Lock-screen push payloads carry only a generic localized body.
                    \App\Services\NotificationDispatcher::fanOutPush(
                        (int) $userId,
                        'group_chatroom_message',
                        __('svc_notifications.group_chatroom.push_body'),
                        $link
                    );
                });
            }

            Log::debug('NotifyGroupChatroomMessage: notified members', [
                'tenant_id'   => $event->tenantId,
                'group_id'    => $event->groupId,
                'chatroom_id' => $event->chatroomId,
                'sender_id'   => $senderId,
                'sent'        => count($newRecipientIds),
                'deduped'     => count($recentlyNotified),
            ]);

            // Mark handled only after the full fanout ran so a redis re-delivery
            // cannot re-run the notification loop.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHour());
            }
        } catch (\Throwable $e) {
            Log::warning('NotifyGroupChatroomMessage listener failed', [
                'tenant_id'   => $event->tenantId ?? null,
                'group_id'    => $event->groupId ?? null,
                'chatroom_id' => $event->chatroomId ?? null,
                'error'       => $e->getMessage(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
