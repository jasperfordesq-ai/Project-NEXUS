<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\ConnectionRequested;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationDispatcher;
use App\Support\UserDisplayName;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Sends a notification to the target user when they receive a connection request.
 */
class NotifyConnectionRequest implements ShouldQueue
{
    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a slow run released back to another worker would
     * re-send the request email. Killing at 60s and not retrying keeps one
     * request → one notification. Belt-and-braces with the Cache guard in handle().
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     */
    public function handle(ConnectionRequested $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same connection request so the notification is sent exactly once.
        $connectionId = (int) ($event->connectionModel->id ?? 0);
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($connectionId > 0) {
            $handledKey = 'notify_connection_request:done:' . $guardTenantId . ':' . $connectionId;
            $claimKey = 'notify_connection_request:claim:' . $guardTenantId . ':' . $connectionId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyConnectionRequest: duplicate delivery suppressed', ['connection_id' => $connectionId, 'tenant_id' => $guardTenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyConnectionRequest: concurrent delivery suppressed', ['connection_id' => $connectionId, 'tenant_id' => $guardTenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            // Ensure tenant context is set (required when running via async queue)
            TenantContext::setById($event->tenantId);

            $targetUserId = $event->target->id;
            $link = '/connections';

            // Render bell + email content in the TARGET's language (this listener runs
            // in a queue worker where config('app.locale') defaults to 'en').
            $targetLocale = $event->target->preferred_language ?? null;
            $content = LocaleContext::withLocale($targetLocale, function () use ($event) {
                // `?? $user->name` could never reach the fallback: User::getNameAttribute()
                // is typed `: string` and returns '' for a nameless account, and '' is not
                // null. A member with no first name got a notification reading " sent you
                // a connection request". Empty must count as absent.
                //
                // The first name is deliberately preferred for a PERSON (the greeting is
                // meant to be informal), but never for an ORGANISATION, whose first_name
                // holds the contact person and must not stand in for the account.
                $requester = $event->requester;
                $firstName = trim((string) ($requester->first_name ?? ''));
                $isOrganisation = ($requester->profile_type ?? null) === UserDisplayName::ORGANISATION;
                $requesterName = (!$isOrganisation && $firstName !== '')
                    ? $firstName
                    : UserDisplayName::resolve($requester, __('emails.common.fallback_someone'));
                return __('emails_misc.social.connection_request', ['name' => $requesterName]);
            });

            // Check email_connections preference — default to sending (opt-out model)
            $emailEnabled = true;
            try {
                $prefs = User::getNotificationPreferences($targetUserId);
                $emailEnabled = (bool) ($prefs['email_connections'] ?? true);
            } catch (\Throwable $prefError) {
                Log::debug('NotifyConnectionRequest: could not read email_connections pref', [
                    'user_id' => $targetUserId,
                    'error' => $prefError->getMessage(),
                ]);
            }

            LocaleContext::withLocale($targetLocale, function () use ($emailEnabled, $targetUserId, $content, $link) {
                if ($emailEnabled) {
                    // Bell + email (via dispatcher) — dispatcher also renders strings via __().
                    NotificationDispatcher::dispatch(
                        $targetUserId,
                        'global',
                        null,
                        'connection_request',
                        $content,
                        $link,
                        null
                    );
                } else {
                    // Bell only — user opted out of connection emails
                    Notification::createNotification($targetUserId, $content, $link, 'connection_request');
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($targetUserId), 'connection_request', $content, $link);
                }
            });

            // Mark handled only after the flow ran to completion so a redis
            // re-delivery cannot re-send the request notification.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHour());
            }
        } catch (\Throwable $e) {
            Log::error('NotifyConnectionRequest listener failed', [
                'requester_id' => $event->requester->id ?? null,
                'target_id' => $event->target->id ?? null,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
