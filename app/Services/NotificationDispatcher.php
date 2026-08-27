<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailBackground;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * NotificationDispatcher — Native Laravel service for dispatching notifications.
 *
 * Handles in-app (bell), email, and web-push notifications with a
 * hierarchical frequency-setting system (Thread > Group > Global).
 *
 * DB facade / Eloquent instead of legacy Database class.
 */
class NotificationDispatcher
{
    public function __construct()
    {
    }

    // =========================================================================
    // PRIMARY DISPATCH
    // =========================================================================

    /**
     * Dispatch a notification (In-App + Email Traffic Cop).
     *
     * @param int         $userId      Target User ID
     * @param string      $contextType 'global', 'group', 'thread'
     * @param int|null    $contextId   Group ID or Discussion ID
     * @param string      $activityType 'new_topic', 'new_reply', 'mention'
     * @param string      $content     Plain text content for email preview
     * @param string      $link        Relative link to the item
     * @param string|null $htmlContent Full HTML content for Instant Emails
     * @param bool        $isOrganizer If true, applies strict Organizer Priority rules
     */
    /**
     * Dispatch a notification (In-App + Email Traffic Cop).
     *
     * @param int         $userId      Target User ID
     * @param string      $contextType 'global', 'group', 'thread'
     * @param int|null    $contextId   Group ID or Discussion ID
     * @param string      $activityType 'new_topic', 'new_reply', 'mention'
     * @param string      $content     Plain text content for email preview
     * @param string      $link        Relative link to the item
     * @param string|null $htmlContent Full HTML content for Instant Emails
     * @param bool        $isOrganizer If true, applies strict Organizer Priority rules
     * @param int|null    $fromUserId  The actor sending this notification (used for mute check)
     * @param array{frequency?: string, in_app_enabled?: bool, email_enabled?: bool, push_enabled?: bool}|null $deliveryPolicy
     *        Optional resolved per-context channel policy. Group notifications
     *        use this to consume group_notification_preferences directly.
     */
    public static function dispatch(
        $userId,
        $contextType,
        $contextId,
        $activityType,
        $content,
        $link,
        $htmlContent,
        $isOrganizer = false,
        ?int $fromUserId = null,
        ?array $deliveryPolicy = null,
    ): bool
    {
        $recipientTenantId = self::resolveTenantIdForQueue((int) $userId);
        if ($recipientTenantId === null) {
            Log::error('NotificationDispatcher::dispatch could not resolve recipient tenant', [
                'user_id' => (int) $userId,
                'activity_type' => $activityType,
            ]);
            return false;
        }

        return TenantContext::runForTenant($recipientTenantId, function () use ($userId, $contextType, $contextId, $activityType, $content, $link, $htmlContent, $isOrganizer, $fromUserId, $deliveryPolicy): bool {
            return self::dispatchForResolvedTenant($userId, $contextType, $contextId, $activityType, $content, $link, $htmlContent, $isOrganizer, $fromUserId, $deliveryPolicy);
        });
    }

    private static function dispatchForResolvedTenant(
        $userId,
        $contextType,
        $contextId,
        $activityType,
        $content,
        $link,
        $htmlContent,
        $isOrganizer = false,
        ?int $fromUserId = null,
        ?array $deliveryPolicy = null,
    ): bool
    {
        // 1. Create In-App Notification (The "Bell") with 60-second deduplication window
        $tenantId = TenantContext::currentId();
        if ($tenantId === null) {
            Log::error('NotificationDispatcher::dispatchForResolvedTenant called without tenant context', [
                'user_id' => (int) $userId,
                'activity_type' => $activityType,
            ]);
            return false;
        }

        // Fix 9: Skip notification if the sending user is muted by the recipient.
        // Only checked when fromUserId is provided — system notifications are never suppressed.
        if ($fromUserId !== null && $fromUserId !== (int) $userId) {
            $isMuted = DB::table('user_muted_users')
                ->where('user_id', (int) $userId)
                ->where('muted_user_id', $fromUserId)
                ->where('tenant_id', $tenantId)
                ->exists();
            if ($isMuted) {
                Log::debug('NotificationDispatcher: suppressed notification from muted user', [
                    'recipient' => $userId,
                    'actor'     => $fromUserId,
                    'type'      => $activityType,
                ]);
                return true;
            }
        }
        $policyFrequency = is_string($deliveryPolicy['frequency'] ?? null)
            ? $deliveryPolicy['frequency']
            : null;
        $policyMuted = in_array($policyFrequency, ['muted', 'off'], true);
        $inAppEnabled = (bool) ($deliveryPolicy['in_app_enabled'] ?? true);
        $emailEnabled = (bool) ($deliveryPolicy['email_enabled'] ?? true);
        $pushEnabled = (bool) ($deliveryPolicy['push_enabled'] ?? true);
        $dedupKey = "notif_dedup:{$tenantId}:{$userId}:{$activityType}:" . md5($link ?? '');
        $isDuplicateBell = false;
        $bellCreated = false;
        $bellId = null;

        if (! $inAppEnabled || $policyMuted) {
            // An explicit per-context mute suppresses the bell as well as all
            // outbound channels. Global digest "off" remains bell-only.
        } elseif (Cache::has($dedupKey)) {
            // Duplicate within 60s window — skip in-app creation but still process email
            Log::debug('NotificationDispatcher: deduplicated', ['user' => $userId, 'type' => $activityType]);
            $isDuplicateBell = true;
        } else {
            try {
                $bellId = Notification::createNotification((int) $userId, $content, $link, $activityType);
                $bellCreated = true;
            } catch (\Throwable $e) {
                Log::warning('NotificationDispatcher: bell creation failed', [
                    'user_id' => (int) $userId,
                    'type' => $activityType,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // 2. CHECK Notification Settings Hierarchy
        $frequency = $policyFrequency === null
            ? self::getFrequencySetting($userId, $contextType, $contextId)
            : match ($policyFrequency) {
                'digest' => 'daily',
                'muted' => 'off',
                'weekly' => 'monthly',
                default => $policyFrequency,
            };

        // 3. APPLY "Organizer Rule" (Set in Stone)
        if ($isOrganizer && $activityType === 'new_topic') {
            if ($frequency === null) {
                $frequency = 'instant';
            }
        }

        // 4. Default for normal users if no setting found.
        //
        // Members do NOT receive a daily-digest email until they explicitly
        // opt in from notification settings. "Daily" was the previous default
        // and produced unwanted email for every member of every tenant —
        // members described it as spam. Critical user-facing events are
        // forced 'instant' below so disabling the digest does not silence
        // them. Non-critical chatter (new topics, replies, stories, mentions
        // in groups the user joined) stays off until the member chooses to
        // turn it on.
        if ($frequency === null) {
            $frequency = 'off';
        }

        // 5. Critical user-facing events: always 'instant' regardless of the
        //    digest default. These are direct social actions (someone messaged
        //    you, someone wants to connect, your volunteer application moved)
        //    that members reasonably expect to see immediately. They are NOT
        //    suppressed by an 'off' digest preference — that preference only
        //    controls topic/reply/mention digest emails.
        $criticalInstantTypes = [
            'new_message',
            'connection_request',
            'connection_accepted',
            'vol_application_approved',
            'vol_application_declined',
            'vol_hours_approved',
            // A waitlist spot offer is time-sensitive (the offer expires and passes
            // to the next person). It was previously neither instant nor a curated
            // push type, so with the default 'off' digest it reached nobody by email
            // OR push. Marking it instant delivers both (push uses the generic title).
            'vol_waitlist_spot',
            // Someone asking to manage your account, and the answer to that
            // request. Both are direct, consequential and action-required: the
            // recipient of the request is being asked to let another member post
            // listings and spend credits on their behalf. Neither may wait for a
            // digest the member has not opted into.
            'sub_account_request',
            'sub_account_approved',
            // A carer ACTED: posted a listing in the member's name or spent
            // credits from their balance. Money leaving your account is never
            // digest material — the disclosure must arrive when the act does.
            'sub_account_proxy_listing',
            'sub_account_proxy_transfer',
            // A supporter's power over the member's account GREW. The member
            // must hear that when it happens, not in a digest they never
            // opted into. (Shrinks stay bell-level news.)
            'sub_account_permissions_expanded',
            // Co-decide support actions (guardian redesign phase 3). The
            // pending notification carries the single-use confirm link — for a
            // member who rarely logs in, the email IS the flow. The answers
            // matter to the supporter who is waiting to know whether to help
            // differently. None of these may sit in a digest the member never
            // opted into.
            'support_action_pending',
            'support_action_confirmed',
            'support_action_declined',
            'support_action_expired',
            // A staff member recorded the member's OFFLINE confirmation. The
            // member must learn this happened in their name — if the record is
            // wrong, this notice is how they find out.
            'support_action_attested',
        ];
        if (! $policyMuted && in_array($activityType, $criticalInstantTypes, true)) {
            $frequency = 'instant';
        }

        // 5b. DEVICE PUSH — a SEPARATE channel from the email digest (its own
        // push_enabled pref, enforced inside the push services), fired as soon as
        // a fresh bell exists and independent of whether the email queue insert
        // below succeeds. For 'instant' notifications (critical types + members
        // who opted into instant) push everything, falling back to the generic
        // push title — this preserves the prior behaviour where new_message,
        // connection_request, etc. pushed even though they have no curated title.
        // For digest frequencies push only curated push-title types, so routine
        // digest items don't all turn into device push. Deduped 60s in fanOutPush().
        if ($pushEnabled && ! $policyMuted && $bellCreated && !$isDuplicateBell) {
            self::fanOutPush((int) $userId, (string) $activityType, (string) $content, $link, $frequency !== 'instant');
        }

        // 6. TRAFFIC LIGHT LOGIC
        $queueSucceeded = true;
        switch ($emailEnabled && ! $policyMuted ? $frequency : 'off') {
            case 'instant':
                // Device push is NOT fired here anymore. It used to live inside
                // this 'instant' email branch, which coupled push to the email
                // digest preference: a member who had not opted into instant
                // digest emails (the default is 'off') received no web/FCM push
                // at all, even though push is a separate channel with its own
                // push_enabled pref. Push now fires from fanOutPush() once the
                // frequency is resolved — see step 5b above.
                $queueSucceeded = self::queueNotification($userId, $activityType, $content, $link, 'instant', $htmlContent);
                break;

            case 'daily':
            case 'weekly':
            case 'monthly':
                $queueSucceeded = self::queueNotification($userId, $activityType, $content, $link, $frequency);
                break;

            case 'off':
                // Do nothing
                break;
        }

        if (!$queueSucceeded) {
            if (!$isDuplicateBell && $bellCreated && $bellId !== null) {
                DB::table('notifications')
                    ->where('id', (int) $bellId)
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $userId)
                    ->delete();
            }
            Log::warning('NotificationDispatcher: queue insert failed', [
                'user_id' => (int) $userId,
                'type' => $activityType,
                'frequency' => $frequency,
            ]);
            return false;
        }

        if (!$isDuplicateBell && $bellCreated) {
            Cache::put($dedupKey, 1, now()->addSeconds(60));
        }

        return true;
    }

    // =========================================================================
    // FREQUENCY SETTINGS HIERARCHY
    // =========================================================================

    /**
     * Resolve the effective frequency setting based on hierarchy:
     * Thread > Group > Global
     */
    private static function getFrequencySetting($userId, $contextType, $contextId): ?string
    {
        $tenantId = TenantContext::getId();

        // Check exact match first
        // notification_settings may not have tenant_id column; user_id is
        // already tenant-scoped by the caller (dispatch verifies the user
        // belongs to TenantContext). Adding tenant_id here as defense-in-depth.
        $row = DB::table('notification_settings')
            ->where('user_id', $userId)
            ->where('context_type', $contextType)
            ->where('context_id', $contextId)
            ->value('frequency');

        if ($row !== null) {
            return $row === 'weekly' ? 'monthly' : $row;
        }

        // If 'thread', try 'group' parent
        if ($contextType === 'thread') {
            $groupId = DB::table('group_discussions')
                ->where('id', $contextId)
                ->where('tenant_id', $tenantId)
                ->value('group_id');

            if ($groupId) {
                return self::getFrequencySetting($userId, 'group', $groupId);
            }
        }

        // If 'group', try 'global'
        if ($contextType === 'group') {
            return self::getFrequencySetting($userId, 'global', 0);
        }

        // Global default (if not set in DB, return default from Config).
        // Members opt INTO the daily digest from notification settings —
        // we don't email until they say yes. Critical types are forced to
        // 'instant' in dispatch() above so this 'off' default never silences
        // direct social actions.
        if ($contextType === 'global') {
            $tenant = TenantContext::get();
            $config = json_decode($tenant['configuration'] ?? '{}', true);
            $default = $config['notifications']['default_frequency'] ?? 'off';
            return $default === 'weekly' ? 'monthly' : $default;
        }

        return null;
    }

    // =========================================================================
    // PUSH & QUEUE HELPERS
    // =========================================================================

    /**
     * Resolve a push title for an activity type.
     *
     * Returns the curated `notifications.push_<type>` title when one exists.
     * Otherwise returns the generic default title — or null when $onlyCurated
     * is set, which lets the auto-push path skip activity types nobody curated
     * a push title for (so routine bell writes don't all turn into push).
     */
    private static function resolvePushTitle(string $activityType, bool $onlyCurated = false): ?string
    {
        $key = 'notifications.push_' . $activityType;
        $translated = __($key);
        if ($translated !== $key) {
            return $translated;
        }
        return $onlyCurated ? null : __('notifications.push_default');
    }

    /**
     * Map activity types to short push notification titles.
     */
    private static function getPushTitle(string $activityType): string
    {
        return self::resolvePushTitle($activityType, false) ?? __('notifications.push_default');
    }

    /**
     * Fan out web + mobile (FCM) push for a single notification.
     *
     * This is the canonical push entry point. Push is a SEPARATE channel from
     * the email digest — it has its own push_enabled preference, enforced inside
     * WebPushService and FCMPushService, so this method does not re-check it.
     * The send runs after the HTTP response (afterResponse) so a slow VAPID/FCM
     * POST never delays the caller, falling back to an inline send under CLI /
     * queue workers. Both providers are failure-isolated. A per-(user,type,link)
     * 60s dedup means a retry or a double-dispatch can never double-push.
     *
     * Call this from any path that writes a bell directly via
     * Notification::createNotification() and wants the matching device push —
     * those paths otherwise bypass the dispatcher and never reach a push fan-out.
     *
     * @param int         $userId       Recipient user id.
     * @param string      $activityType Notification type (drives the push title).
     * @param string      $content      Push body text (already localized).
     * @param string|null $link         Deep link for the push tap target.
     * @param bool        $onlyCurated  When true, only fire for activity types
     *   that have a curated notifications.push_<type> title. When false, an
     *   explicit caller has decided this event warrants push, so the generic
     *   title is used as a fallback for uncurated types.
     */
    public static function fanOutPush(int $userId, string $activityType, string $content, ?string $link, bool $onlyCurated = false): void
    {
        if ($userId <= 0) {
            return;
        }

        $pushTitle = self::resolvePushTitle($activityType, $onlyCurated);
        if ($pushTitle === null) {
            return;
        }

        // Dedup so a retry / double-dispatch within the window can't double-push.
        $dedupKey = 'push_dedup:' . $userId . ':' . $activityType . ':' . md5((string) ($link ?? ''));
        if (!Cache::add($dedupKey, 1, now()->addSeconds(60))) {
            return;
        }

        $uid = $userId;
        $pushContent = $content;
        $pushLink = (string) ($link ?? '');
        $pushType = $activityType;
        // Captured now so push_log records the right tenant even though $send
        // runs after the response (when the request's tenant context is gone).
        $tid = TenantContext::currentId();

        $deliver = function () use ($uid, $pushTitle, $pushContent, $pushLink, $pushType, $tid) {
            // Web push (browser) and mobile push (FCM via Capacitor) fan out in
            // parallel — a user on multiple devices is notified everywhere they
            // are subscribed. Failure-isolated so one provider being down does
            // not suppress the other. Per-channel outcomes are captured and
            // recorded to push_log for delivery observability; genuine send
            // failures surface at warning level (previously discarded at debug).
            $webOk = null;
            $fcmSent = 0;
            $fcmFailed = 0;
            $errors = [];

            try {
                $webOk = (bool) \App\Services\WebPushService::sendToUserStatic($uid, $pushTitle, $pushContent, $pushLink);
            } catch (\Throwable $e) {
                $webOk = false;
                $errors[] = 'web: ' . $e->getMessage();
                Log::warning('[NotificationDispatcher] WebPush failed', ['user_id' => $uid, 'type' => $pushType, 'error' => $e->getMessage()]);
            }

            try {
                if (class_exists(\App\Services\FCMPushService::class)) {
                    $result = \App\Services\FCMPushService::sendToUser($uid, $pushTitle, $pushContent, ['link' => $pushLink]);
                    $fcmSent = (int) ($result['sent'] ?? 0);
                    $fcmFailed = (int) ($result['failed'] ?? 0);
                    foreach ((array) ($result['errors'] ?? []) as $fcmErr) {
                        $errors[] = 'fcm: ' . $fcmErr;
                    }
                }
            } catch (\Throwable $e) {
                $errors[] = 'fcm: ' . $e->getMessage();
                Log::warning('[NotificationDispatcher] FCM push failed', ['user_id' => $uid, 'type' => $pushType, 'error' => $e->getMessage()]);
            }

            // Delivery observability — best-effort, never affects delivery.
            \App\Models\PushLog::record($tid, $uid, $pushType, $pushTitle, $webOk, $fcmSent, $fcmFailed, $errors);
        };

        /**
         * 🔴 The send must run INSIDE the captured tenant, not merely log it.
         *
         * `FCMPushService::sendToUser()` finds tokens with
         * `->where('tenant_id', TenantContext::getId())`. This closure runs after the
         * caller has moved on: `NotifyMessageReceived` sets the tenant, calls
         * `fanOutPush`, and restores the previous tenant when `handle()` returns. By the
         * time the send ran, `getId()` no longer matched the recipient, the token query
         * returned nothing, and `sendToUser` reported `sent 0, failed 0, errors []`.
         * `PushLog::record()` treats that as "no targets" and writes no row — which is
         * exactly what production shows: a `new_message` bell with no push_log line
         * beside it. It reads as "the send never happened" when it was "the send found no
         * devices".
         *
         * 🔴 The tenant was already captured above FOR THE LOG, with a comment noting the
         * request's context would be gone. The same reasoning was never applied to the
         * send. Fixing the log and not the thing being logged is how this survived — the
         * observability was accurate about a delivery that never occurred.
         */
        $send = function () use ($deliver, $tid) {
            if ($tid === null) {
                $deliver();
                return;
            }

            TenantContext::runForTenant($tid, $deliver);
        };

        /**
         * 🔴 Decide the context EXPLICITLY. Do not rely on an exception to detect it.
         *
         * This was `try { dispatch($send)->afterResponse(); } catch { $send(); }` with the
         * comment "No container / running in CLI / queue misconfigured — run inline". That
         * fallback never ran: `afterResponse()` does not throw outside an HTTP request. It
         * registers the closure against a response that, in a queue worker or an artisan
         * command, is never sent — so the closure was queued against nothing.
         *
         * `NotifyMessageReceived` is `ShouldQueue`, so this is the path every "someone
         * messaged you" push took. Running inline here also means the send happens while
         * the listener's tenant context is still set, which is the belt to the braces
         * above.
         *
         * `runningInConsole()` is true for `queue:work`, `schedule:run` and every other
         * non-HTTP entry point — exactly the set that must send inline.
         */
        $inConsole = true;
        try {
            $inConsole = app()->runningInConsole();
        } catch (\Throwable) {
            // No container at all (early boot, isolated unit test) — inline is safe.
            $inConsole = true;
        }

        if ($inConsole) {
            $send();
            return;
        }

        try {
            // Laravel's afterResponse() closure dispatch: flushes the response,
            // then runs the closure. Non-blocking for the HTTP request.
            dispatch($send)->afterResponse();
        } catch (\Throwable $e) {
            // Genuine last resort: a container present but the dispatcher unusable.
            // No longer the only route to an inline send.
            $send();
        }
    }

    private static function queueNotification($userId, $activityType, $content, $link, $frequency = 'daily', $emailBody = null): bool
    {
        $snippet = substr($content, 0, 250);

        $tenantId = self::resolveTenantIdForQueue((int) $userId);
        if ($tenantId === null) {
            Log::error('NotificationDispatcher::queueNotification could not resolve tenant_id', [
                'user_id' => (int) $userId,
                'activity_type' => $activityType,
                'frequency' => $frequency,
            ]);
            return false;
        }

        try {
            DB::table('notification_queue')->insert([
                'user_id'        => $userId,
                'tenant_id'      => $tenantId,
                'activity_type'  => $activityType,
                'content_snippet' => $snippet,
                'link'           => $link,
                'frequency'      => $frequency,
                'email_body'     => $emailBody,
                'created_at'     => now(),
                'status'         => 'pending',
            ]);
        } catch (\Throwable $e) {
            Log::error('NotificationDispatcher::queueNotification insert failed', [
                'user_id' => (int) $userId,
                'tenant_id' => $tenantId,
                'activity_type' => $activityType,
                'frequency' => $frequency,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        return true;
    }

    private static function resolveTenantIdForQueue(int $userId): ?int
    {
        $contextTenantId = TenantContext::currentId();

        try {
            $userTenantId = DB::table('users')
                ->where('id', $userId)
                ->value('tenant_id');

            if ($userTenantId !== null) {
                $userTenantId = (int) $userTenantId;
                if ($contextTenantId !== null && (int) $contextTenantId !== $userTenantId) {
                    Log::warning('NotificationDispatcher::queueNotification tenant context differed from recipient tenant', [
                        'context_tenant_id' => (int) $contextTenantId,
                        'user_tenant_id' => $userTenantId,
                        'user_id' => $userId,
                    ]);
                }

                return $userTenantId;
            }
        } catch (\Throwable $e) {
            Log::warning('NotificationDispatcher::queueNotification tenant lookup failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        return $contextTenantId !== null ? (int) $contextTenantId : null;
    }

    // =========================================================================
    // HOT MATCH / MUTUAL MATCH / DIGEST
    // =========================================================================

    /**
     * Dispatch a HOT MATCH notification (85%+ match).
     */
    public static function dispatchHotMatch($userId, $match): bool
    {
        // Check user's match notification preferences (cheap DB miss exit first)
        $prefs = \App\Services\MatchingService::getPreferences($userId);
        if (empty($prefs['notify_hot_matches'])) {
            return false;
        }

        $frequency = $prefs['notification_frequency'] ?? 'fortnightly';
        if ($frequency === 'never') {
            return false;
        }

        // Normalize legacy/unsupported digest frequencies for the queue.
        $queueFrequency = match ($frequency) {
            'fortnightly', 'weekly' => 'monthly',
            default => $frequency,
        };

        // Lookup recipient so bell + email render in their preferred locale.
        $tenantId = TenantContext::getId();
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        return (bool) LocaleContext::withLocale($recipient, function () use ($userId, $match, $queueFrequency): bool {
            $listingTitle = $match['title'] ?? __('emails.common.fallback_listing');
            $matchScore = (int) ($match['match_score'] ?? 85);
            $userName = $match['user_name'] ?? __('emails.common.fallback_someone');
            $distance = $match['distance_km'] ?? null;
            $listingId = $match['id'] ?? 0;

            $distanceText = $distance !== null
                ? ' (' . __('emails_notifications.hot_match.km_away', ['distance' => $distance]) . ')'
                : '';
            $content = __('notifications.hot_match_content', ['name' => $userName, 'title' => $listingTitle, 'score' => $matchScore, 'distance' => $distanceText]);
            // Land on the matches page with this match highlighted (the page
            // scrolls to and pulses the card).
            $link = "/matches?highlight=listing-{$listingId}";

            Notification::createNotification((int) $userId, $content, $link, 'hot_match');
            // Device push (curated push_hot_match title). Independent of the
            // digest frequency this method queues below.
            self::fanOutPush((int) $userId, 'hot_match', $content, $link);

            // Inject the recipient id so the email template can personalize
            // the greeting (call sites only pass listing/match data).
            $htmlContent = self::buildHotMatchEmail(array_merge($match, ['recipient_user_id' => (int) $userId]), $matchScore);
            return self::queueNotification($userId, 'hot_match', $content, $link, $queueFrequency, $htmlContent);
        });
    }

    /**
     * Dispatch a MUTUAL MATCH notification.
     */
    public static function dispatchMutualMatch($userId, $match, $reciprocalInfo = []): void
    {
        $prefs = \App\Services\MatchingService::getPreferences($userId);
        if (empty($prefs['notify_mutual_matches'])) {
            return;
        }

        $frequency = $prefs['notification_frequency'] ?? 'fortnightly';
        if ($frequency === 'never') {
            return;
        }

        // Normalize legacy/unsupported digest frequencies for the queue.
        $queueFrequency = match ($frequency) {
            'fortnightly', 'weekly' => 'monthly',
            default => $frequency,
        };

        // Lookup recipient so bell + email render in their preferred locale.
        $tenantId = TenantContext::getId();
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        LocaleContext::withLocale($recipient, function () use ($userId, $match, $reciprocalInfo, $queueFrequency) {
            $userName = $match['user_name'] ?? __('emails.common.fallback_someone');
            $theyOffer = $reciprocalInfo['they_offer'] ?? __('emails.common.fallback_they_offer');
            $youOffer = $reciprocalInfo['you_offer'] ?? __('emails.common.fallback_you_offer');
            $listingId = $match['id'] ?? 0;

            $content = __('notifications.mutual_match_content', ['name' => $userName, 'they_offer' => $theyOffer, 'you_offer' => $youOffer]);
            // Mutual matches land on the matches page pre-filtered to mutual.
            $link = "/matches?type=mutual&highlight=listing-{$listingId}";

            Notification::createNotification((int) $userId, $content, $link, 'mutual_match');
            // Device push (curated push_mutual_match title).
            self::fanOutPush((int) $userId, 'mutual_match', $content, $link);

            // Inject the recipient id so the email template can personalize
            // the greeting (call sites only pass listing/match data).
            $htmlContent = self::buildMutualMatchEmail(array_merge($match, ['recipient_user_id' => (int) $userId]), $reciprocalInfo);
            self::queueNotification($userId, 'mutual_match', $content, $link, $queueFrequency, $htmlContent);
        });
    }

    /**
     * Dispatch a NEW MATCHES DIGEST notification.
     */
    public static function dispatchMatchDigest($userId, $matches, $period = 'fortnightly'): void
    {
        if (empty($matches)) {
            return;
        }

        // Lookup recipient so bell + email render in their preferred locale.
        $tenantId = TenantContext::getId();
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        LocaleContext::withLocale($recipient, function () use ($userId, $matches, $period) {
            $count = count($matches);
            $hotCount = count(array_filter($matches, fn($m) => ($m['match_score'] ?? 0) >= 85));
            $mutualCount = count(array_filter($matches, fn($m) => ($m['match_type'] ?? '') === 'mutual'));

            $periodLabel = in_array($period, ['daily', 'weekly', 'fortnightly', 'monthly'], true)
                ? __('notifications.period_' . $period)
                : $period;
            $content = __('notifications.match_digest_content', ['period' => $periodLabel, 'count' => $count]);
            if ($hotCount > 0) {
                $content .= __('notifications.match_digest_hot', ['count' => $hotCount]);
            }
            if ($mutualCount > 0) {
                $content .= __('notifications.match_digest_mutual', ['count' => $mutualCount]);
            }

            $link = "/matches";

            Notification::createNotification((int) $userId, $content, $link, 'match_digest');
            // Device push — falls back to the generic title (no curated
            // push_match_digest); this is an explicit, low-frequency digest.
            self::fanOutPush((int) $userId, 'match_digest', $content, $link);

            $htmlContent = self::buildMatchDigestEmail($matches, $period, $hotCount, $mutualCount, (int) $userId);
            self::queueNotification($userId, 'match_digest', $content, $link, 'instant', $htmlContent);
        });
    }

    // =========================================================================
    // MATCH APPROVAL WORKFLOW
    // =========================================================================

    /**
     * Dispatch notification to brokers/admins when a match needs approval.
     */
    public static function dispatchMatchApprovalRequest($brokerId, $userName, $listingTitle, $requestId): void
    {
        // Lookup broker so bell + email render in the broker's preferred locale.
        $tenantId = TenantContext::getId();
        $broker = DB::table('users')
            ->where('id', $brokerId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        LocaleContext::withLocale($broker, function () use ($brokerId, $userName, $listingTitle, $requestId) {
            $content = __('notifications.match_approval_request', ['name' => $userName, 'title' => $listingTitle]);
            // Recipient query upstream (MatchApprovalWorkflowService) targets
            // role IN ('admin','broker','coordinator'). /admin/match-approvals
            // 403's brokers — link to the broker exchanges queue with the
            // pending_broker filter, which renders the same pending requests
            // in a broker-accessible UI for all three roles.
            $link = "/broker/exchanges?status=pending_broker";

            Notification::createNotification((int) $brokerId, $content, $link, 'match_approval_request');
            // Device push to the broker/admin — an approval is waiting on them.
            self::fanOutPush((int) $brokerId, 'match_approval_request', $content, $link);

            $htmlContent = self::buildMatchApprovalRequestEmail($userName, $listingTitle, $requestId);
            self::queueNotification($brokerId, 'match_approval_request', $content, $link, 'instant', $htmlContent);
        });
    }

    /**
     * Dispatch notification to user when their match is approved.
     */
    public static function dispatchMatchApproved($userId, $listingTitle, $listingId, $matchScore = 0): void
    {
        // Lookup recipient so bell + email render in their preferred locale.
        $tenantId = TenantContext::getId();
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        LocaleContext::withLocale($recipient, function () use ($userId, $listingTitle, $listingId, $matchScore) {
            $content = __('notifications.match_approved', ['title' => $listingTitle]);
            $link = "/listings/{$listingId}";

            Notification::createNotification((int) $userId, $content, $link, 'match_approved');
            // Device push — their match was approved; a clear, expected event.
            self::fanOutPush((int) $userId, 'match_approved', $content, $link);

            $htmlContent = self::buildMatchApprovedEmail($listingTitle, $listingId, $matchScore);
            self::queueNotification($userId, 'match_approved', $content, $link, 'instant', $htmlContent);
        });
    }

    /**
     * Dispatch notification to user when their match is rejected.
     */
    public static function dispatchMatchRejected($userId, $listingTitle, $reason = ''): void
    {
        // Lookup recipient so bell + email render in their preferred locale.
        $tenantId = TenantContext::getId();
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        LocaleContext::withLocale($recipient, function () use ($userId, $listingTitle, $reason) {
            $content = __('notifications.match_rejected', ['title' => $listingTitle]);
            if (!empty($reason)) {
                $content .= __('notifications.match_rejected_reason', ['reason' => $reason]);
            }
            $link = "/matches";

            Notification::createNotification((int) $userId, $content, $link, 'match_rejected');
            // Device push — the outcome of their match request.
            self::fanOutPush((int) $userId, 'match_rejected', $content, $link);

            $htmlContent = self::buildMatchRejectedEmail($listingTitle, $reason);
            self::queueNotification($userId, 'match_rejected', $content, $link, 'instant', $htmlContent);
        });
    }

    // =========================================================================
    // SIMPLE NOTIFICATION (for broker control services)
    // =========================================================================

    /**
     * Send a simple notification to a user.
     */
    public static function send(int $userId, string $type, array $data = []): void
    {
        // Lookup recipient so bell text + email all render in the recipient's locale.
        $tenantId = TenantContext::getId();
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        LocaleContext::withLocale($recipient, function () use ($userId, $type, $data) {
            $content = self::buildNotificationContent($type, $data);
            $link = self::buildNotificationLink($type, $data);

            Notification::createNotification($userId, $content, $link, $type);
            // Device push for exchange/broker lifecycle events.
            self::fanOutPush((int) $userId, (string) $type, $content, $link);

            // Send email immediately for exchange notifications
            self::sendExchangeEmailImmediately($userId, $type, $data, $content, $link);
        });
    }

    /**
     * Notify all admins/brokers of the current tenant.
     */
    public static function notifyAdmins(string $type, array $data = [], string $message = ''): void
    {
        $tenantId = TenantContext::getId();

        $admins = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['admin', 'broker', 'coordinator'])
            ->where('status', 'active')
            ->select(['id', 'preferred_language'])
            ->get();

        foreach ($admins as $admin) {
            // Render bell text + email per-admin under their preferred locale.
            LocaleContext::withLocale($admin, function () use ($admin, $type, $data, $message) {
                $content = $message ?: self::buildNotificationContent($type, $data);
                $link = self::buildNotificationLink($type, $data);

                Notification::createNotification((int) $admin->id, $content, $link, $type);
                // Device push to each admin/broker — these are action alerts.
                self::fanOutPush((int) $admin->id, (string) $type, $content, $link);

                self::sendExchangeEmailImmediately((int) $admin->id, $type, $data, $content, $link);
            });
        }
    }

    /**
     * Fan out a MODERATION alert (bell + device push + email) to every
     * admin/broker/coordinator in the current tenant, each rendered in their
     * own preferred_language. Used for "new report" / auto-flag alerts so a
     * moderation queue never sits silent.
     *
     * Distinct from notifyAdmins(): that path renders via the legacy exchange
     * switch and only emails 'exchange_*' types. This method takes explicit
     * translation keys + shared placeholders and always sends all three
     * channels. Best-effort and failure-isolated per recipient/channel.
     *
     * @param string $type       activity type (bell type + drives push title)
     * @param string $link       relative deep link to the moderation item
     * @param string $bellKey    translation key for the bell + push body
     * @param string $subjectKey translation key for the email subject + heading
     * @param string $bodyKey    translation key for the email body paragraph
     * @param array  $params     placeholder replacements shared by the keys
     * @param string $theme      EmailTemplateBuilder theme (warning/danger/brand)
     * @return int number of admins the alert was dispatched to
     */
    public static function notifyModerationAdmins(string $type, string $link, string $bellKey, string $subjectKey, string $bodyKey, array $params = [], string $theme = 'warning'): int
    {
        $tenantId = TenantContext::getId();
        if ($tenantId === null) {
            return 0;
        }

        $admins = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['admin', 'broker', 'coordinator'])
            ->where('status', 'active')
            ->select(['id', 'email', 'preferred_language'])
            ->get();

        if ($admins->isEmpty()) {
            return 0;
        }

        $adminUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
        $count = 0;

        foreach ($admins as $admin) {
            $uid = (int) $admin->id;

            LocaleContext::withLocale($admin, function () use ($admin, $uid, $tenantId, $type, $link, $bellKey, $subjectKey, $bodyKey, $params, $theme, $adminUrl): void {
                $bell = __($bellKey, $params);

                try {
                    Notification::createNotification($uid, $bell, $link, $type, true, (int) $tenantId);
                } catch (\Throwable $e) {
                    Log::warning('notifyModerationAdmins bell failed: ' . $e->getMessage(), ['user_id' => $uid, 'type' => $type]);
                }

                try {
                    self::fanOutPush($uid, $type, $bell, $link);
                } catch (\Throwable $e) {
                    Log::debug('notifyModerationAdmins push failed: ' . $e->getMessage());
                }

                if (empty($admin->email)) {
                    return;
                }
                try {
                    $subject = __($subjectKey, $params);
                    $html = EmailTemplateBuilder::make()
                        ->theme($theme)
                        ->title($subject)
                        ->paragraph(__($bodyKey, $params))
                        ->button(__('emails_misc.moderation.review_cta'), $adminUrl)
                        ->render();
                    EmailDispatchService::sendRaw($admin->email, $subject, $html, null, null, null, 'moderation', ['tenant_id' => (int) $tenantId]);
                } catch (\Throwable $e) {
                    Log::warning('notifyModerationAdmins email failed: ' . $e->getMessage(), ['user_id' => $uid]);
                }
            });

            $count++;
        }

        return $count;
    }

    /**
     * Send credit received email to a user.
     */
    public static function sendCreditEmail(int $recipientUserId, string $senderName, float $amount, string $description = ''): ?bool
    {
        try {
            $tenantId = TenantContext::getId();

            $user = DB::table('users')
                ->where('id', $recipientUserId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if (!$user || empty($user->email)) {
                return null;
            }

            // Defence-in-depth: honour `email_transactions` even if the caller
            // forgot to check. NotifyTransactionCompleted does already, but
            // any future caller (admin tools, retroactive transfers) would
            // otherwise bypass the user's preference.
            try {
                $prefs = \App\Models\User::getNotificationPreferences($recipientUserId);
                if (!(bool) ($prefs['email_transactions'] ?? true)) {
                    return null;
                }
            } catch (\Throwable $prefError) {
                Log::debug('sendCreditEmail: could not read email_transactions pref', [
                    'user_id' => $recipientUserId,
                    'error'   => $prefError->getMessage(),
                ]);
            }

            // Render subject + body under the recipient's preferred locale.
            return (bool) LocaleContext::withLocale($user, function () use ($user, $recipientUserId, $senderName, $amount, $description, $tenantId): bool {
                $recipientName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                $tenantName = TenantContext::getSetting('site_name', 'Project NEXUS');
                $baseUrl = TenantContext::getFrontendUrl();
                $basePath = TenantContext::getSlugPrefix();
                $walletUrl = $baseUrl . $basePath . '/wallet';

                // Subject lines are plain-text MIME headers — no HTML escaping —
                // and the unit must come from i18n, not a hardcoded English plural.
                $amountDisplay = __('emails.common.hours_amount', ['amount' => $amount]);
                $subject = __('emails.notification.credit_received_subject', ['sender' => $senderName, 'amount' => $amountDisplay, 'community' => $tenantName]);
                $emailBody = self::buildCreditReceivedEmail(
                    htmlspecialchars($recipientName),
                    htmlspecialchars($senderName),
                    $amount,
                    htmlspecialchars($description),
                    $walletUrl,
                    htmlspecialchars($tenantName)
                );

                if (!EmailDispatchService::sendRaw($user->email, $subject, $emailBody, null, null, null, 'transaction', ['tenant_id' => $tenantId])) {
                    Log::warning('NotificationDispatcher::sendCreditEmail mailer returned false', [
                        'user_id' => $recipientUserId,
                    ]);
                    return false;
                }

                return true;
            });
        } catch (\Exception $e) {
            Log::warning("NotificationDispatcher::sendCreditEmail failed: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Send credit sent confirmation email to the SENDER of a time-credit transfer.
     */
    public static function sendCreditSentEmail(int $senderUserId, string $recipientName, float $amount, string $description = ''): ?bool
    {
        try {
            $tenantId = TenantContext::getId();

            $user = DB::table('users')
                ->where('id', $senderUserId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if (!$user || empty($user->email)) {
                return null;
            }

            // Defence-in-depth: honour `email_transactions` even if the caller
            // forgot to check (NotifyTransactionCompleted already does).
            try {
                $prefs = \App\Models\User::getNotificationPreferences($senderUserId);
                if (!(bool) ($prefs['email_transactions'] ?? true)) {
                    return null;
                }
            } catch (\Throwable $prefError) {
                Log::debug('sendCreditSentEmail: could not read email_transactions pref', [
                    'user_id' => $senderUserId,
                    'error'   => $prefError->getMessage(),
                ]);
            }

            // The "sender" is the recipient of this confirmation email — render in their locale.
            return (bool) LocaleContext::withLocale($user, function () use ($user, $senderUserId, $recipientName, $amount, $description, $tenantId): bool {
                $senderFirstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                $tenantName      = TenantContext::getSetting('site_name', 'Project NEXUS');
                $baseUrl         = TenantContext::getFrontendUrl();
                $basePath        = TenantContext::getSlugPrefix();
                $walletUrl       = $baseUrl . $basePath . '/wallet';
                // i18n unit (no hardcoded English plural). infoCard/previewText
                // escape at render time — pre-escaping double-encodes names
                // like O'Brien. paragraph() is the only raw-HTML sink here.
                $amountDisplay   = __('emails.common.hours_amount', ['amount' => $amount]);

                $infoCard = [
                    __('emails_created.credits_sent.label_amount')    => $amountDisplay,
                    __('emails_created.credits_sent.label_recipient') => $recipientName,
                ];
                if ($description !== '') {
                    $infoCard[__('emails_created.credits_sent.label_description')] = $description;
                }

                $html = EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title(__('emails_created.credits_sent.title'))
                    ->previewText(__('emails_created.credits_sent.preview', ['amount' => $amountDisplay, 'recipient' => $recipientName, 'community' => $tenantName]))
                    ->greeting($senderFirstName)
                    ->paragraph(__('emails_created.credits_sent.body', ['recipient' => htmlspecialchars($recipientName, ENT_QUOTES, 'UTF-8')]))
                    ->infoCard($infoCard)
                    ->button(__('emails_created.credits_sent.cta'), $walletUrl)
                    ->render();

                // Plain-text MIME subject — no HTML escaping.
                $subject = __('emails_created.credits_sent.subject', [
                    'amount'    => $amountDisplay,
                    'recipient' => $recipientName,
                    'community' => $tenantName,
                ]);

                if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'transaction', ['tenant_id' => $tenantId])) {
                    Log::warning('NotificationDispatcher::sendCreditSentEmail mailer returned false', [
                        'user_id' => $senderUserId,
                    ]);
                    return false;
                }

                return true;
            });
        } catch (\Exception $e) {
            Log::warning("NotificationDispatcher::sendCreditSentEmail failed: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Send a review request email to a user after a time-credit transaction.
     *
     * @param int    $userId          The user to email
     * @param string $otherPersonName The name of the person they exchanged with
     * @param int    $transactionId   The completed transaction ID (for the CTA link)
     */
    public static function sendReviewRequestEmail(int $userId, string $otherPersonName, int $transactionId): ?bool
    {
        try {
            $tenantId = TenantContext::getId();

            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if (!$user || empty($user->email)) {
                return null;
            }

            // Review-request emails are reviews-related, so honour
            // `email_reviews` (NOT `email_transactions` — that was a
            // mislabelled key from an earlier refactor). A user who turned
            // off review emails should not get review-request prompts.
            try {
                $prefs = \App\Models\User::getNotificationPreferences($userId);
                if (!(bool) ($prefs['email_reviews'] ?? true)) {
                    return null;
                }
            } catch (\Throwable $prefError) {
                Log::debug('sendReviewRequestEmail: could not read email_reviews pref', [
                    'user_id' => $userId,
                    'error'   => $prefError->getMessage(),
                ]);
            }

            // Render subject + body under the recipient's preferred locale.
            return (bool) LocaleContext::withLocale($user, function () use ($user, $otherPersonName, $transactionId, $tenantId): bool {
                $firstName  = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                $baseUrl    = TenantContext::getFrontendUrl();
                $basePath   = TenantContext::getSlugPrefix();
                $reviewUrl  = $baseUrl . $basePath . '/reviews/create?transaction_id=' . $transactionId;

                // Plain-text MIME subject; title() escapes at render time —
                // pre-escaping double-encodes names like O'Brien.
                $subject = __('emails.review_request.subject', ['name' => $otherPersonName]);

                $html = EmailTemplateBuilder::make()
                    ->theme('brand')
                    ->title(__('emails.review_request.subject', ['name' => $otherPersonName]))
                    ->greeting($firstName)
                    ->paragraph(__('emails.review_request.body', ['name' => htmlspecialchars($otherPersonName, ENT_QUOTES, 'UTF-8')]))
                    ->button(__('emails.review_request.cta'), $reviewUrl)
                    ->render();

                if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'review', ['tenant_id' => $tenantId])) {
                    Log::warning('NotificationDispatcher::sendReviewRequestEmail mailer returned false', [
                        'user_id' => $user->id,
                    ]);
                    return false;
                }

                return true;
            });
        } catch (\Exception $e) {
            Log::warning('NotificationDispatcher::sendReviewRequestEmail failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send review received email to a user.
     */
    public static function sendReviewEmail(int $receiverUserId, string $reviewerName, int $rating, ?string $comment = null, bool $isAnonymous = false): ?bool
    {
        try {
            $tenantId = TenantContext::getId();

            $user = DB::table('users')
                ->where('id', $receiverUserId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if (!$user || empty($user->email)) {
                return null;
            }

            // Honour `email_reviews`. ReviewsController used to call this
            // method only after checking the pref — but `HandleFederatedReviewReceived`
            // also calls it (federated reviews), and that path did not check.
            // Moving the check here closes the gap for every caller.
            try {
                $prefs = \App\Models\User::getNotificationPreferences($receiverUserId);
                if (!(bool) ($prefs['email_reviews'] ?? true)) {
                    return null;
                }
            } catch (\Throwable $prefError) {
                Log::debug('sendReviewEmail: could not read email_reviews pref', [
                    'user_id' => $receiverUserId,
                    'error'   => $prefError->getMessage(),
                ]);
            }

            // Render subject + body under the receiver's preferred locale.
            return (bool) LocaleContext::withLocale($user, function () use ($user, $receiverUserId, $reviewerName, $rating, $comment, $isAnonymous, $tenantId): bool {
                $recipientName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                $tenantName = TenantContext::getSetting('site_name', 'Project NEXUS');
                $baseUrl = TenantContext::getFrontendUrl();
                $basePath = TenantContext::getSlugPrefix();
                $profileUrl = $baseUrl . $basePath . '/profile/' . $receiverUserId;

                $displayName = $isAnonymous ? __('emails.notification.someone') : htmlspecialchars($reviewerName);
                $subject = __('emails.notification.review_subject', ['reviewer' => $displayName, 'rating' => $rating, 'community' => $tenantName]);

                $emailBody = self::buildReviewReceivedEmail(
                    htmlspecialchars($recipientName),
                    $displayName,
                    $rating,
                    $comment ? htmlspecialchars($comment) : null,
                    $profileUrl,
                    htmlspecialchars($tenantName)
                );

                if (!EmailDispatchService::sendRaw($user->email, $subject, $emailBody, null, null, null, 'review', ['tenant_id' => $tenantId])) {
                    Log::warning('NotificationDispatcher::sendReviewEmail mailer returned false', [
                        'user_id' => $receiverUserId,
                    ]);
                    return false;
                }

                return true;
            });
        } catch (\Exception $e) {
            Log::warning("NotificationDispatcher::sendReviewEmail failed: " . $e->getMessage());
            return false;
        }
    }

    // =========================================================================
    // IDENTITY VERIFICATION NOTIFICATIONS
    // =========================================================================

    /**
     * Dispatch a "verification started" email when a user begins the identity verification flow.
     */
    public static function dispatchVerificationStarted(int $userId): void
    {
        $tenantId = TenantContext::getId();

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'email', 'preferred_language'])
            ->first();

        if (!$user || empty($user->email)) {
            return;
        }

        // Render + send under the recipient's preferred locale.
        LocaleContext::withLocale($user, function () use ($user, $tenantId, $userId) {
            $tenantName = TenantContext::getSetting('site_name', 'Project NEXUS');
            $baseUrl    = TenantContext::getFrontendUrl();
            $basePath   = TenantContext::getSlugPrefix();
            $statusUrl  = $baseUrl . $basePath . '/verify-identity';
            $firstName  = $user->first_name ?? __('emails.common.fallback_name');

            $html = \App\Core\EmailTemplateBuilder::make()
                ->theme('brand')
                ->title(__('emails_identity.started.title'))
                ->previewText(__('emails_identity.started.preview'))
                ->greeting($firstName)
                ->paragraph(__('emails_identity.started.body', ['community' => $tenantName]))
                ->paragraph(__('emails_identity.started.next_steps'))
                ->paragraph('<em>' . __('emails_identity.started.note') . '</em>')
                ->button(__('emails_identity.started.cta'), $statusUrl)
                ->render();

            try {
                $subject = __('emails_identity.started.subject', ['community' => $tenantName]);
                if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'identity_verification', ['tenant_id' => $tenantId])) {
                    Log::warning('[IdentityVerification] started email returned false', [
                        'user_id' => $userId,
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('[IdentityVerification] started email failed: ' . $e->getMessage());
            }
        });
    }

    public static function dispatchVerificationPassed(int $userId): void
    {
        // Lookup recipient first so the bell, queue, and direct email all render
        // in the recipient's preferred locale (not the caller / worker default).
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'email', 'preferred_language'])
            ->first();

        LocaleContext::withLocale($user, function () use ($userId, $user, $tenantId) {
            $link = "/dashboard";
            $content = __('notifications.verification_passed');

            Notification::createNotification($userId, $content, $link, 'verification_passed');
            // Device push — identity verification result is a clear, expected event.
            self::fanOutPush((int) $userId, 'verification_passed', $content, $link);

            // Send a direct email immediately. Do not also queue an instant
            // email here; the instant queue is processed every minute and
            // would send an identical verification result email.
            if ($user && !empty($user->email)) {
                $tenantName = TenantContext::getSetting('site_name', 'Project NEXUS');
                $baseUrl    = TenantContext::getFrontendUrl();
                $basePath   = TenantContext::getSlugPrefix();
                $profileUrl = $baseUrl . $basePath . '/profile/' . $userId;
                $firstName  = $user->first_name ?? __('emails.common.fallback_name');

                $html = \App\Core\EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title(__('emails_identity.passed.title'))
                    ->previewText(__('emails_identity.passed.preview'))
                    ->greeting($firstName)
                    ->paragraph(__('emails_identity.passed.body', ['community' => $tenantName]))
                    ->highlight(__('emails_identity.passed.highlight'))
                    ->paragraph(__('emails_identity.passed.badge_note'))
                    ->button(__('emails_identity.passed.cta'), $profileUrl)
                    ->render();

                try {
                    $subject = __('emails_identity.passed.subject', ['community' => $tenantName]);
                    if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'identity_verification', ['tenant_id' => $tenantId])) {
                        Log::warning('[IdentityVerification] passed email returned false', [
                            'user_id' => $userId,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('[IdentityVerification] passed email failed: ' . $e->getMessage());
                }
            }
        });
    }

    public static function dispatchVerificationFailed(int $userId, string $reason = ''): void
    {
        // Lookup recipient first so the bell, queue, and direct email all render
        // in the recipient's preferred locale (not the caller / worker default).
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'email', 'preferred_language'])
            ->first();

        LocaleContext::withLocale($user, function () use ($userId, $user, $reason, $tenantId) {
            $link = "/verify-identity";
            $content = !empty($reason)
                ? __('notifications.verification_failed_reason', ['reason' => $reason])
                : __('notifications.verification_failed');

            Notification::createNotification($userId, $content, $link, 'verification_failed');
            // Device push — identity verification result is a clear, expected event.
            self::fanOutPush((int) $userId, 'verification_failed', $content, $link);

            // Send a direct email immediately. Do not also queue an instant
            // email here; the instant queue would send an identical copy.
            if ($user && !empty($user->email)) {
                $tenantName = TenantContext::getSetting('site_name', 'Project NEXUS');
                $baseUrl    = TenantContext::getFrontendUrl();
                $basePath   = TenantContext::getSlugPrefix();
                $retryUrl   = $baseUrl . $basePath . '/verify-identity';
                $firstName  = $user->first_name ?? __('emails.common.fallback_name');

                $builder = \App\Core\EmailTemplateBuilder::make()
                    ->theme('danger')
                    ->title(__('emails_identity.failed.title'))
                    ->previewText(__('emails_identity.failed.preview'))
                    ->greeting($firstName)
                    ->paragraph(__('emails_identity.failed.body', ['community' => $tenantName]));

                if (!empty($reason)) {
                    $builder->paragraph('<strong>' . __('emails_identity.failed.reason_label') . '</strong> ' . htmlspecialchars($reason));
                }

                $html = $builder
                    ->paragraph(__('emails_identity.failed.retry_note'))
                    ->button(__('emails_identity.failed.cta'), $retryUrl)
                    ->render();

                try {
                    $subject = __('emails_identity.failed.subject', ['community' => $tenantName]);
                    if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'identity_verification', ['tenant_id' => $tenantId])) {
                        Log::warning('[IdentityVerification] failed email returned false', [
                            'user_id' => $userId,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('[IdentityVerification] failed email failed: ' . $e->getMessage());
                }
            }
        });
    }

    public static function dispatchVerificationCompletedToAdmins(int $userId, string $status): void
    {
        $tenantId = TenantContext::getId();

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'email'])
            ->first();

        if (!$user) {
            return;
        }

        $userName = UserDisplayName::resolve($user);
        $email = $user->email ?? '';
        $isPassed = $status === 'passed';
        $link = "/admin/members";

        $admins = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['admin', 'super_admin'])
            ->where('status', 'active')
            ->select(['id', 'preferred_language'])
            ->get();

        foreach ($admins as $admin) {
            // Render bell text per-admin under their preferred locale.
            LocaleContext::withLocale($admin, function () use ($admin, $isPassed, $userName, $email, $link) {
                $content = $isPassed
                    ? __('notifications.verification_passed_admin', ['name' => $userName, 'email' => $email])
                    : __('notifications.verification_failed_admin', ['name' => $userName, 'email' => $email]);
                Notification::createNotification((int) $admin->id, $content, $link, 'admin_verification_update');
            });
        }
    }

    public static function dispatchVerificationReminder(int $userId): bool
    {
        // Lookup recipient's preferred_language so bell + queued email render
        // under the recipient's locale, not the caller/worker locale.
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['email', 'first_name', 'name', 'preferred_language'])
            ->first();

        if (!$user || empty($user->email)) {
            Log::warning('NotificationDispatcher::dispatchVerificationReminder missing recipient email', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
            ]);

            return false;
        }

        return (bool) LocaleContext::withLocale($user, function () use ($user, $userId, $tenantId): bool {
            $content = __('notifications.verification_reminder');
            $link = '/verify-identity';

            $tenant = TenantContext::get();
            $tenantName = htmlspecialchars($tenant['name'] ?? __('emails.common.fallback_tenant_name'), ENT_QUOTES, 'UTF-8');
            $verificationUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');

            $htmlContent = EmailTemplateBuilder::make()
                ->theme('brand')
                ->title(__('notifications.verification_reminder_heading'))
                ->previewText($content)
                ->greeting($firstName)
                ->paragraph(__('notifications.verification_reminder_body'))
                ->infoCard([
                    __('emails.common.community_label') => $tenantName,
                ])
                ->button(__('notifications.verification_reminder_cta'), $verificationUrl)
                ->render();

            $sent = EmailDispatchService::sendRaw(
                (string) $user->email,
                __('notifications.verification_reminder_heading'),
                $htmlContent,
                null,
                null,
                null,
                'identity_verification',
                ['tenant_id' => $tenantId]
            );

            if (!$sent) {
                Log::warning('NotificationDispatcher::dispatchVerificationReminder email failed', [
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                ]);

                return false;
            }

            try {
                Notification::createNotification($userId, $content, $link, 'verification_reminder');
            } catch (\Throwable $e) {
                Log::warning('NotificationDispatcher::dispatchVerificationReminder bell failed after email send', [
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            return true;
        });
    }

    // =========================================================================
    // NOTIFICATION CONTENT BUILDERS
    // =========================================================================

    private static function buildNotificationContent(string $type, array $data): string
    {
        switch ($type) {
            case 'exchange_request_received':
                return __('notifications.exchange_request_received');
            case 'exchange_request_declined':
                if (!empty($data['reason'])) {
                    return __('notifications.exchange_request_declined_reason', ['reason' => $data['reason']]);
                }
                return __('notifications.exchange_request_declined');
            case 'exchange_approved':
                return __('notifications.exchange_approved');
            case 'exchange_rejected':
                if (!empty($data['reason'])) {
                    return __('notifications.exchange_rejected_reason', ['reason' => $data['reason']]);
                }
                return __('notifications.exchange_rejected');
            case 'exchange_completed':
                $hours = $data['hours'] ?? 0;
                return __('notifications.exchange_completed', ['hours' => $hours]);
            case 'exchange_cancelled':
                return __('notifications.exchange_cancelled');
            case 'exchange_disputed':
                /*
                  🔴 Two very different things reach this type, and telling a member the
                  wrong one is a false statement about their own exchange. The automatic
                  rule fires when the two confirmed hour figures disagree; a member-raised
                  report (journey 3.20) carries a `dispute_reason` and may have nothing to
                  do with hours at all. Measured on a device 2026-08-23: a `no_show` report
                  told the other member "Exchange has conflicting hour confirmations".
                */
                return !empty($data['dispute_reason'])
                    ? __('notifications.exchange_problem_reported')
                    : __('notifications.exchange_disputed');
            case 'exchange_accepted':
                return __('notifications.exchange_accepted');
            case 'exchange_pending_broker':
                return __('notifications.exchange_pending_broker');
            case 'exchange_started':
                return __('notifications.exchange_started');
            case 'exchange_ready_confirmation':
                $hours = $data['proposed_hours'] ?? 0;
                return __('notifications.exchange_ready_confirmation', ['hours' => $hours]);
            case 'listing_risk_tagged':
                $level = $data['risk_level'] ?? 'unknown';
                $title = $data['listing_title'] ?? 'Listing';
                return __('notifications.listing_risk_tagged', ['title' => $title, 'level' => $level]);
            case 'credit_received':
                $senderName = $data['sender_name'] ?? __('emails.common.fallback_someone');
                $amount = $data['amount'] ?? 0;
                return __('notifications.credit_received', ['name' => $senderName, 'amount' => $amount]);
            default:
                return __('emails_notifications.default_notification', ['type' => $type]);
        }
    }

    private static function buildNotificationLink(string $type, array $data): string
    {
        switch ($type) {
            case 'exchange_request_received':
            case 'exchange_approved':
            case 'exchange_rejected':
            case 'exchange_completed':
            case 'exchange_cancelled':
            case 'exchange_disputed':
            case 'exchange_accepted':
            case 'exchange_started':
            case 'exchange_ready_confirmation':
                $exchangeId = $data['exchange_id'] ?? 0;
                return "/exchanges/{$exchangeId}";
            case 'exchange_pending_broker':
                // Universal user-facing route: works for the requester (member),
                // brokers, and admins alike. Pre-broker-port code linked to
                // /admin/broker-controls/exchanges/{id} which 403'd brokers and
                // 404'd members.
                $exchangeId = $data['exchange_id'] ?? 0;
                return "/exchanges/{$exchangeId}";
            case 'exchange_request_declined':
                return "/exchanges";
            case 'listing_risk_tagged':
                // Sent to admins/brokers/coordinators (notifyAdmins query).
                // Brokers don't have admin-route access, so point at the
                // broker panel which all three roles can reach.
                return "/broker/risk-tags";
            case 'credit_received':
                return "/wallet";
            default:
                return "/notifications";
        }
    }

    // =========================================================================
    // EXCHANGE EMAIL SENDER
    // =========================================================================

    private static function sendExchangeEmailImmediately(int $userId, string $type, array $data, string $content, string $link): void
    {
        // Only send for exchange and credit notifications
        if (strpos($type, 'exchange_') !== 0 && $type !== 'credit_received') {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if (!$user || empty($user->email)) {
                return;
            }

            // Render subject + body under the recipient's preferred locale.
            LocaleContext::withLocale($user, function () use ($user, $type, $data, $link, $tenantId) {
                $baseUrl = TenantContext::getFrontendUrl();
                $slugPrefix = TenantContext::getSlugPrefix();
                $fullUrl = $baseUrl . $slugPrefix . $link;

                if ($type === 'credit_received') {
                    $senderNameRaw = $data['sender_name'] ?? __('emails.common.fallback_member_name');
                    $senderName = htmlspecialchars($senderNameRaw);
                    $amount = (float) ($data['amount'] ?? 0);
                    $description = htmlspecialchars($data['description'] ?? '');
                    $recipientName = htmlspecialchars($user->first_name ?? $user->name ?? __('emails.common.fallback_name'));
                    $tenantNameRaw = TenantContext::getSetting('site_name', 'Project NEXUS');
                    $tenantName = htmlspecialchars($tenantNameRaw);

                    $amountDisplay = __('emails.common.hours_amount', ['amount' => $amount]);
                    // Plain-text MIME subject — raw values, no HTML entities.
                    $subject = __('emails.notification.credit_received_subject', ['sender' => $senderNameRaw, 'amount' => $amountDisplay, 'community' => $tenantNameRaw]);
                    $emailBody = self::buildCreditReceivedEmail($recipientName, $senderName, $amount, $description, $fullUrl, $tenantName);
                    if (!EmailDispatchService::sendRaw($user->email, $subject, $emailBody, null, null, null, 'transaction', ['tenant_id' => $tenantId])) {
                        Log::warning('NotificationDispatcher: credit received email returned false', [
                            'user_id' => $user->id ?? null,
                        ]);
                    }
                } else {
                    $exchangeDetails = self::getExchangeDetailsForEmail($data['exchange_id'] ?? 0);
                    $userArr = ['email' => $user->email, 'name' => $user->name, 'first_name' => $user->first_name];
                    $emailBody = self::buildRichExchangeEmail($type, $data, $userArr, $exchangeDetails, $fullUrl);
                    $subject = self::getExchangeEmailSubject($type, $exchangeDetails);
                    if (!EmailDispatchService::sendRaw($user->email, $subject, $emailBody, null, null, null, 'exchange', ['tenant_id' => $tenantId])) {
                        Log::warning('NotificationDispatcher: exchange email returned false', [
                            'user_id' => $user->id ?? null,
                            'type' => $type,
                        ]);
                    }
                }
            });
        } catch (\Exception $e) {
            Log::warning("NotificationDispatcher: Failed to send exchange email - " . $e->getMessage());
        }
    }

    private static function getExchangeDetailsForEmail(int $exchangeId): array
    {
        if ($exchangeId <= 0) {
            return [];
        }

        try {
            $tenantId = TenantContext::getId();
            $row = DB::table('exchange_requests as e')
                ->join('listings as l', function ($join) {
                    $join->on('e.listing_id', '=', 'l.id')
                        ->on('e.tenant_id', '=', 'l.tenant_id');
                })
                ->join('users as req', function ($join) {
                    $join->on('e.requester_id', '=', 'req.id')
                        ->on('e.tenant_id', '=', 'req.tenant_id');
                })
                ->join('users as prov', function ($join) {
                    $join->on('e.provider_id', '=', 'prov.id')
                        ->on('e.tenant_id', '=', 'prov.tenant_id');
                })
                ->where('e.id', $exchangeId)
                ->where('e.tenant_id', $tenantId)
                ->select([
                    'e.*',
                    'l.title as listing_title',
                    'l.type as listing_type',
                    'l.description as listing_description',
                    'req.name as requester_name',
                    'req.first_name as requester_first_name',
                    'req.avatar_url as requester_avatar',
                    'prov.name as provider_name',
                    'prov.first_name as provider_first_name',
                    'prov.avatar_url as provider_avatar',
                ])
                ->first();

            return $row ? (array) $row : [];
        } catch (\Exception $e) {
            Log::debug('[NotificationDispatcher] getExchangeDetails failed: ' . $e->getMessage());
            return [];
        }
    }

    private static function getExchangeEmailSubject(string $type, array $details): string
    {
        $listingTitle = $details['listing_title'] ?? 'your listing';
        $shortTitle = strlen($listingTitle) > 30 ? substr($listingTitle, 0, 30) . '...' : $listingTitle;

        $key = 'notifications.exchange_email_' . str_replace('exchange_', '', $type);
        if ($type === 'exchange_request_received') {
            return __('notifications.exchange_email_request_received', ['title' => $shortTitle]);
        }
        $translated = __($key);
        return $translated !== $key ? $translated : __('notifications.exchange_email_default');
    }

    // =========================================================================
    // EMAIL TEMPLATE BUILDERS
    // =========================================================================

    private static function buildHotMatchEmail($match, $matchScore): string
    {
        $userId = $match['recipient_user_id'] ?? 0;
        $tenantId = TenantContext::getId();

        $user = null;
        if ($userId) {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['name', 'first_name'])
                ->first();
        }
        $userName = $user->name ?? $user->first_name ?? __('emails.common.fallback_name');

        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? __('emails.common.fallback_tenant_name');

        $templatePath = base_path('views/emails/match_hot.php');
        if (file_exists($templatePath)) {
            ob_start();
            include $templatePath;
            return ob_get_clean();
        }

        $title = htmlspecialchars($match['title'] ?? __('emails.common.fallback_listing'));
        $posterName = htmlspecialchars($match['user_name'] ?? __('emails.common.fallback_someone'));
        $distance = $match['distance_km'] ?? null;
        $distanceLabel = $distance !== null ? __('emails_notifications.hot_match.km_away', ['distance' => $distance]) : '';
        $distanceHtml = $distance !== null ? "<p style='color: #10b981;'>📍 {$distanceLabel}</p>" : '';
        $hotHeading = __('emails_notifications.hot_match.heading');
        $hotSubheading = __('emails_notifications.hot_match.subheading', ['score' => $matchScore]);
        $postedByText = __('emails_notifications.hot_match.posted_by', ['name' => $posterName]);

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #f97316; background-image: linear-gradient(135deg, #f97316, #ef4444); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$hotHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$hotSubheading}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <h2 style="color: #1e293b; margin: 0 0 8px;">{$title}</h2>
        <p style="color: #6366f1; font-weight: 600; margin: 0 0 12px;">{$postedByText}</p>
        {$distanceHtml}
    </div>
</div>
HTML;
    }

    private static function buildMutualMatchEmail($match, $reciprocalInfo): string
    {
        $userId = $match['recipient_user_id'] ?? 0;
        $tenantId = TenantContext::getId();

        $user = null;
        if ($userId) {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['name', 'first_name'])
                ->first();
        }
        $userName = $user->name ?? $user->first_name ?? __('emails.common.fallback_name');

        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? __('emails.common.fallback_tenant_name');

        $templatePath = base_path('views/emails/match_mutual.php');
        if (file_exists($templatePath)) {
            ob_start();
            include $templatePath;
            return ob_get_clean();
        }

        $posterName = htmlspecialchars($match['user_name'] ?? __('emails.common.fallback_someone'));
        $theyOffer = htmlspecialchars($reciprocalInfo['they_offer'] ?? __('emails.common.fallback_they_offer'));
        $youOffer = htmlspecialchars($reciprocalInfo['you_offer'] ?? __('emails.common.fallback_you_offer'));

        $mutualHeading = __('emails_notifications.mutual_match.heading');
        $mutualSubheading = __('emails_notifications.mutual_match.subheading');
        $exchangeWith = __('emails_notifications.mutual_match.exchange_with', ['name' => $posterName]);
        $theyHelpLabel = __('emails_notifications.mutual_match.they_help_you');
        $youHelpLabel = __('emails_notifications.mutual_match.you_help_them');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #10b981; background-image: linear-gradient(135deg, #10b981, #06b6d4); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$mutualHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$mutualSubheading}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <h2 style="color: #1e293b; margin: 0 0 16px;">{$exchangeWith}</h2>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
            <p style="color: #64748b; margin: 0 0 8px; font-size: 14px;">{$theyHelpLabel}</p>
            <p style="color: #10b981; font-weight: 600; margin: 0; font-size: 16px;">{$theyOffer}</p>
        </div>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
            <p style="color: #64748b; margin: 0 0 8px; font-size: 14px;">{$youHelpLabel}</p>
            <p style="color: #6366f1; font-weight: 600; margin: 0; font-size: 16px;">{$youOffer}</p>
        </div>
    </div>
</div>
HTML;
    }

    private static function buildMatchDigestEmail($matches, $period, $hotCount, $mutualCount, int $recipientUserId = 0): string
    {
        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? __('emails.common.fallback_tenant_name');

        $recipient = null;
        if ($recipientUserId > 0) {
            $recipient = DB::table('users')
                ->where('id', $recipientUserId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['name', 'first_name'])
                ->first();
        }
        $userName = $recipient->name ?? $recipient->first_name ?? __('emails.common.fallback_name');

        $templatePath = base_path('views/emails/match_digest.php');
        if (file_exists($templatePath)) {
            $stats = [
                'hotCount' => $hotCount,
                'mutualCount' => $mutualCount,
                'totalCount' => count($matches),
            ];
            ob_start();
            include $templatePath;
            return ob_get_clean();
        }

        $count = count($matches);
        $periodTitle = in_array($period, ['daily', 'weekly', 'fortnightly', 'monthly'], true)
            ? __('emails.match_digest.period_title_' . $period)
            : ucfirst($period);

        $matchListHtml = '';
        foreach (array_slice($matches, 0, 5) as $match) {
            $title = htmlspecialchars($match['title'] ?? __('emails.common.fallback_listing'));
            $score = (int) ($match['match_score'] ?? 0);
            $matchUserName = !empty($match['user_name']) ? $match['user_name'] : UserDisplayName::resolve($match);
            $posterName = htmlspecialchars($matchUserName ?: __('emails.common.fallback_member_name'));
            $scoreColor = $score >= 85 ? '#ef4444' : ($score >= 70 ? '#6366f1' : '#64748b');
            $byPosterText = __('emails_notifications.match_digest.by_poster', ['name' => $posterName]);
            $matchListHtml .= <<<HTML
<div style="background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 10px;">
    <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
            <p style="color: #1e293b; font-weight: 600; margin: 0;">{$title}</p>
            <p style="color: #64748b; font-size: 14px; margin: 4px 0 0;">{$byPosterText}</p>
        </div>
        <span style="background: {$scoreColor}; color: white; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 14px;">{$score}%</span>
    </div>
</div>
HTML;
        }

        $statsHtml = '';
        if ($hotCount > 0) {
            $hotBadge = __('emails_notifications.match_digest.hot_badge', ['count' => $hotCount]);
            $statsHtml .= "<span style='background: #fef2f2; color: #ef4444; padding: 6px 12px; border-radius: 20px; margin-right: 8px;'>{$hotBadge}</span>";
        }
        if ($mutualCount > 0) {
            $mutualBadge = __('emails_notifications.match_digest.mutual_badge', ['count' => $mutualCount]);
            $statsHtml .= "<span style='background: #ecfdf5; color: #10b981; padding: 6px 12px; border-radius: 20px;'>{$mutualBadge}</span>";
        }

        $digestHeading = __('emails_notifications.match_digest.heading', ['period' => $periodTitle]);
        $digestWaiting = __('emails_notifications.match_digest.matches_waiting', ['count' => $count]);
        $topMatchesLabel = __('emails_notifications.match_digest.top_matches');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$digestHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$digestWaiting}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <div style="margin-bottom: 20px; text-align: center;">{$statsHtml}</div>
        <h3 style="color: #1e293b; margin: 0 0 16px;">{$topMatchesLabel}</h3>
        {$matchListHtml}
    </div>
</div>
HTML;
    }

    private static function buildMatchApprovalRequestEmail($userName, $listingTitle, $requestId): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $userName = htmlspecialchars($userName, ENT_QUOTES, 'UTF-8');
        $listingTitle = htmlspecialchars($listingTitle, ENT_QUOTES, 'UTF-8');

        $approvalHeading = __('emails_notifications.match_approval.heading');
        $approvalBody = __('emails_notifications.match_approval.body');
        $labelMember = __('emails_notifications.match_approval.label_member');
        $labelMatched = __('emails_notifications.match_approval.label_matched_listing');
        $reviewNote = __('emails_notifications.match_approval.review_note');
        $btnReview = __('emails_notifications.match_approval.btn_review');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #f59e0b; background-image: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$approvalHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$approvalBody}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; margin: 0 0 8px; font-size: 14px;">{$labelMember}</p>
            <p style="color: #1e293b; font-weight: 600; margin: 0 0 16px; font-size: 18px;">{$userName}</p>
            <p style="color: #64748b; margin: 0 0 8px; font-size: 14px;">{$labelMatched}</p>
            <p style="color: #6366f1; font-weight: 600; margin: 0; font-size: 18px;">{$listingTitle}</p>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
            {$reviewNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/broker/exchanges?status=pending_broker" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$btnReview}</a>
        </div>
    </div>
</div>
HTML;
    }

    private static function buildMatchApprovedEmail($listingTitle, $listingId, $matchScore): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $listingTitle = htmlspecialchars($listingTitle, ENT_QUOTES, 'UTF-8');
        $scoreText = $matchScore > 0 ? " " . __('emails_notifications.match_approved.score_text', ['score' => $matchScore]) : "";
        $matchedHeading = __('emails_notifications.match_approved.heading');
        $matchedBody = __('emails_notifications.match_approved.body');
        $matchedViewNote = __('emails_notifications.match_approved.view_note');
        $btnViewMatch = __('emails_notifications.match_approved.btn_view');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #16a34a); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$matchedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$matchedBody}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0; text-align: center;">
            <p style="color: #22c55e; font-weight: 600; margin: 0; font-size: 20px;">{$listingTitle}</p>
            <p style="color: #64748b; margin: 8px 0 0; font-size: 14px;">{$scoreText}</p>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
            {$matchedViewNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/listings/{$listingId}" style="display: inline-block; background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #16a34a); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$btnViewMatch}</a>
        </div>
    </div>
</div>
HTML;
    }

    private static function buildMatchRejectedEmail($listingTitle, $reason): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $listingTitle = htmlspecialchars($listingTitle, ENT_QUOTES, 'UTF-8');
        $reason = htmlspecialchars($reason, ENT_QUOTES, 'UTF-8');

        $reasonLabel = __('emails_notifications.match_rejected.label_reason');
        $reasonHtml = '';
        if (!empty($reason)) {
            $reasonHtml = <<<HTML
<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 16px 0;">
    <p style="color: #dc2626; font-weight: 600; margin: 0 0 8px; font-size: 14px;">{$reasonLabel}</p>
    <p style="color: #7f1d1d; margin: 0; font-size: 14px; line-height: 1.5;">{$reason}</p>
</div>
HTML;
        }

        $rejectedHeading = __('emails_notifications.match_rejected.heading');
        $rejectedBody = __('emails_notifications.match_rejected.body');
        $rejectedEncouragement = __('emails_notifications.match_rejected.encouragement');
        $btnBrowse = __('emails_notifications.match_rejected.btn_browse');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$rejectedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$rejectedBody}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0; text-align: center;">
            <p style="color: #64748b; font-weight: 600; margin: 0; font-size: 18px;">{$listingTitle}</p>
        </div>
        {$reasonHtml}
        <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
            {$rejectedEncouragement}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/matches" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$btnBrowse}</a>
        </div>
    </div>
</div>
HTML;
    }

    private static function buildCreditReceivedEmail(string $recipientName, string $senderName, float $amount, string $description, string $walletUrl, string $tenantName): string
    {
        $amountDisplay = __('emails.common.hours_amount', ['amount' => $amount]);
        $descriptionHtml = $description ? "<p style=\"margin:12px 0 0;padding:12px;background:#f0f0f0;border-radius:8px;font-style:italic;color:#555;\">\"{$description}\"</p>" : '';
        $creditTitle = __('emails.notification.credit_received_title');
        $creditGreeting = __('emails.common.greeting', ['name' => $recipientName]);
        $creditBody = __('emails.notification.credit_sent_body', ['sender' => $senderName, 'amount' => $amountDisplay, 'community' => $tenantName]);
        $viewWalletText = __('emails.notification.view_wallet');
        $creditFooterTagline = __('emails_notifications.credit_received.footer_tagline', ['community' => $tenantName]);

        return <<<HTML
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background-color: #10b981; background-image: linear-gradient(135deg,#10b981,#059669);padding:32px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:24px;">{$creditTitle}</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#374151;">{$creditGreeting}</p>
    <p style="margin:0 0 16px;font-size:16px;color:#374151;">
      {$creditBody}
    </p>
    {$descriptionHtml}
    <div style="text-align:center;margin:28px 0;">
      <a href="{$walletUrl}" style="display:inline-block;padding:14px 32px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">{$viewWalletText}</a>
    </div>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">{$creditFooterTagline}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>
HTML;
    }

    private static function buildReviewReceivedEmail(string $recipientName, string $reviewerName, int $rating, ?string $comment, string $profileUrl, string $tenantName): string
    {
        $stars = str_repeat('&#9733;', $rating) . str_repeat('&#9734;', 5 - $rating);
        $starColor = $rating >= 4 ? '#f59e0b' : ($rating >= 3 ? '#6b7280' : '#ef4444');
        $reviewBodyText = __('emails_notifications.review.review_body', ['reviewer' => "<strong>{$reviewerName}</strong>", 'community' => $tenantName]);
        $ratingText = __('emails_notifications.review.rating_text', ['rating' => $rating]);
        $whatTheySaidLabel = __('emails_notifications.review.what_they_said');

        $commentHtml = '';
        if ($comment) {
            $commentHtml = <<<COMMENT
                    <tr>
                        <td style="padding: 0 24px 24px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <p style="margin: 0 0 8px; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">{$whatTheySaidLabel}</p>
                                        <p style="margin: 0; font-size: 16px; color: #374151; font-style: italic; line-height: 1.6;">&ldquo;{$comment}&rdquo;</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
COMMENT;
        }

        $gradient = $rating >= 4
            ? 'linear-gradient(135deg, #f59e0b, #d97706)'
            : ($rating >= 3
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : 'linear-gradient(135deg, #6b7280, #4b5563)');

        $year = date('Y');
        $sentByText = __('emails.notification.sent_by', ['community' => $tenantName]);
        $allRightsReserved = __('emails.footer.all_rights_reserved');
        $viewProfileText = __('emails.notification.view_profile');
        $reviewGreeting = __('emails.common.greeting', ['name' => $recipientName]);
        $reviewTitle = __('emails.notification.review_title');

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{$reviewTitle}</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <tr>
                        <td style="background: {$gradient}; padding: 32px 24px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">{$reviewTitle}</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantName}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 32px 24px 16px;">
                            <p style="margin: 0; font-size: 18px; color: #111827;">{$reviewGreeting}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 16px;">
                            <p style="margin: 0; font-size: 16px; color: #374151; line-height: 1.6;">
                                {$reviewBodyText}
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 24px; text-align: center;">
                            <div style="display: inline-block; padding: 16px 32px; background-color: #fffbeb; border-radius: 12px; border: 1px solid #fde68a;">
                                <span style="font-size: 36px; color: {$starColor}; letter-spacing: 4px;">{$stars}</span>
                                <p style="margin: 8px 0 0; font-size: 14px; color: #92400e; font-weight: 500;">{$ratingText}</p>
                            </div>
                        </td>
                    </tr>
                    {$commentHtml}
                    <tr>
                        <td style="padding: 0 24px 32px; text-align: center;">
                            <a href="{$profileUrl}" style="display: inline-block; background: {$gradient}; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">{$viewProfileText}</a>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td style="text-align: center;">
                                        <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">{$sentByText}</p>
                                        <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; {$year} {$tenantName}. {$allRightsReserved}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
HTML;
    }

    private static function buildRichExchangeEmail(string $type, array $data, array $user, array $details, string $actionUrl): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');

        $userName = htmlspecialchars($user['first_name'] ?? $user['name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $listingTitle = htmlspecialchars($details['listing_title'] ?? 'Service Exchange', ENT_QUOTES, 'UTF-8');
        $listingType = $details['listing_type'] ?? 'offer';
        $proposedHours = $details['proposed_hours'] ?? $data['hours'] ?? 0;
        $requesterName = htmlspecialchars($details['requester_first_name'] ?? $details['requester_name'] ?? __('emails.common.fallback_member_name'), ENT_QUOTES, 'UTF-8');
        $providerName = htmlspecialchars($details['provider_first_name'] ?? $details['provider_name'] ?? 'Provider', ENT_QUOTES, 'UTF-8');

        $emailConfig = self::getExchangeEmailConfig($type, $data, $details);

        // Solid colour first, gradient second. Outlook strips gradient
        // backgrounds, and both the header title and the CTA label are white —
        // without a solid fallback they render invisibly. See EmailBackground.
        $brandBg = EmailBackground::gradient((string) $emailConfig['gradient']);
        $brandBgColor = EmailBackground::firstColor((string) $emailConfig['gradient']) ?? '#4f46e5';

        $year = date('Y');
        $buttonFallback = __('emails.common.button_fallback_short');
        $greeting = __('emails.common.greeting', ['name' => $userName]);
        $sentByText = __('emails.notification.sent_by', ['community' => $tenantName]);
        $allRightsReserved = __('emails.footer.all_rights_reserved');
        $labelService = __('emails_notifications.exchange.label_service');
        $labelRequester = __('emails_notifications.exchange.label_requester');
        $labelProvider = __('emails_notifications.exchange.label_provider');

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{$emailConfig['title']}</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <tr>
                        <td bgcolor="{$brandBgColor}" style="{$brandBg} padding: 32px 24px; text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 12px;">{$emailConfig['icon']}</div>
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">{$emailConfig['title']}</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantName}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 32px 24px 16px;">
                            <p style="margin: 0; font-size: 18px; color: #111827;">{$greeting}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 24px;">
                            <p style="margin: 0; font-size: 16px; color: #374151; line-height: 1.6;">{$emailConfig['message']}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 24px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                            <tr>
                                                <td style="padding-bottom: 16px; border-bottom: 1px solid #e5e7eb;">
                                                    <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">{$labelService}</p>
                                                    <p style="margin: 0; font-size: 18px; color: #111827; font-weight: 600;">{$listingTitle}</p>
                                                    <span style="display: inline-block; margin-top: 8px; padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 999px; background-color: {$emailConfig['typeColor']}; color: {$emailConfig['typeText']};">{$emailConfig['typeBadge']}</span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding-top: 16px;">
                                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                                        <tr>
                                                            <td width="50%" style="vertical-align: top;">
                                                                <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280;">{$labelRequester}</p>
                                                                <p style="margin: 0; font-size: 14px; color: #111827; font-weight: 500;">{$requesterName}</p>
                                                            </td>
                                                            <td width="50%" style="vertical-align: top;">
                                                                <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280;">{$labelProvider}</p>
                                                                <p style="margin: 0; font-size: 14px; color: #111827; font-weight: 500;">{$providerName}</p>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            {$emailConfig['extraDetails']}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    {$emailConfig['alertBox']}
                    <tr>
                        <td style="padding: 0 24px 32px; text-align: center;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                <tr>
                                    <td bgcolor="{$brandBgColor}" style="border-radius: 8px; {$brandBg}">
                                        <a href="{$actionUrl}" style="display: inline-block; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">{$emailConfig['buttonText']}</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 24px;">
                            <p style="margin: 0; font-size: 14px; color: #6b7280; text-align: center;">{$emailConfig['helpText']}</p>
                            <p style="margin: 12px 0 0; font-size: 12px; color: #9ca3af; text-align: center;">{$buttonFallback}<br><a href="{$actionUrl}" style="color: #4f46e5; word-break: break-all; font-size: 11px;">{$actionUrl}</a></p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td style="text-align: center;">
                                        <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">{$sentByText}</p>
                                        <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; {$year} {$tenantName}. {$allRightsReserved}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
HTML;
    }

    private static function getExchangeEmailConfig(string $type, array $data, array $details): array
    {
        $hours = $details['proposed_hours'] ?? $data['hours'] ?? 0;
        $finalHours = $details['final_hours'] ?? $data['hours'] ?? $hours;
        $reason = $data['reason'] ?? '';
        $listingType = $details['listing_type'] ?? 'offer';
        $requesterName = $details['requester_first_name'] ?? $details['requester_name'] ?? __('emails.common.fallback_member_name');
        $providerName = $details['provider_first_name'] ?? $details['provider_name'] ?? 'the provider';

        $typeColor = $listingType === 'offer' ? '#dcfce7' : '#fef3c7';
        $typeText = $listingType === 'offer' ? '#166534' : '#92400e';
        $typeBadge = $listingType === 'offer' ? __('notifications.exchange_type_offering') : __('notifications.exchange_type_requesting');

        $labelProposedHours = __('emails_notifications.exchange.label_proposed_hours');
        $labelApprovedHours = __('emails_notifications.exchange.label_approved_hours');
        $labelHoursTransferred = __('emails_notifications.exchange.label_hours_transferred');
        $labelAgreedHours = __('emails_notifications.exchange.label_agreed_hours');
        $labelExpectedHours = __('emails_notifications.exchange.label_expected_hours');
        $labelRequesterConfirmed = __('emails_notifications.exchange.label_requester_confirmed');
        $labelProviderConfirmed = __('emails_notifications.exchange.label_provider_confirmed');
        $labelReasonProvided = __('emails_notifications.exchange.label_reason_provided');
        $labelCoordinatorsNote = __('emails_notifications.exchange.label_coordinators_note');
        $labelNextStep = __('emails_notifications.exchange.label_next_step');
        $labelWellDone = __('emails_notifications.exchange.label_well_done');
        $labelUnderReview = __('emails_notifications.exchange.label_under_review');
        $labelRemember = __('emails_notifications.exchange.label_remember');
        $labelActionNeeded = __('emails_notifications.exchange.label_action_needed');
        $labelWhyApproval = __('emails_notifications.exchange.label_why_approval');

        $configs = [
            'exchange_request_received' => [
                'gradient' => 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                'icon' => '📥',
                'title' => __('notifications.exchange_title_request_received'),
                // The :hours placeholder supplies the number only — every locale's
                // own string carries the unit. Appending an English unit here
                // duplicated it in English and leaked English into other locales.
                'message' => __('emails_notifications.exchange.request_received_msg', ['name' => "<strong>{$requesterName}</strong>", 'hours' => "<strong>{$hours}</strong>"]),
                'buttonText' => __('notifications.exchange_btn_review'),
                'helpText' => __('notifications.exchange_help_review'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => $hours > 0 ? "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelProposedHours}</p>
                            <p style=\"margin: 0; font-size: 24px; color: #6366f1; font-weight: 700;\">{$hours}h</p>
                        </td>
                    </tr>
                " : '',
                'alertBox' => '',
            ],
            'exchange_request_declined' => [
                'gradient' => 'linear-gradient(135deg, #ef4444, #dc2626)',
                'icon' => '❌',
                'title' => __('notifications.exchange_title_request_declined'),
                'message' => __('emails_notifications.exchange.request_declined_msg', ['name' => "<strong>{$providerName}</strong>"]) . ($reason ? __('emails_notifications.exchange.request_declined_reason', ['reason' => $reason]) : ''),
                'buttonText' => __('notifications.exchange_btn_browse'),
                'helpText' => __('notifications.exchange_help_declined'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => '',
                'alertBox' => $reason ? "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #fef2f2; border-radius: 8px; border-left: 4px solid #ef4444;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0 0 4px; font-size: 12px; color: #991b1b; font-weight: 600;\">{$labelReasonProvided}</p>
                                        <p style=\"margin: 0; font-size: 14px; color: #7f1d1d;\">{$reason}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                " : '',
            ],
            'exchange_approved' => [
                'gradient' => 'linear-gradient(135deg, #10b981, #059669)',
                'icon' => '✅',
                'title' => __('notifications.exchange_title_approved'),
                'message' => __('emails_notifications.exchange.approved_msg'),
                'buttonText' => __('notifications.exchange_btn_start'),
                'helpText' => __('notifications.exchange_help_approved'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelApprovedHours}</p>
                            <p style=\"margin: 0; font-size: 24px; color: #10b981; font-weight: 700;\">{$hours}h</p>
                        </td>
                    </tr>
                ",
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #065f46;\">
                                            <strong>{$labelNextStep}</strong> " . __('emails_notifications.exchange.approved_next_step') . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
            'exchange_rejected' => [
                'gradient' => 'linear-gradient(135deg, #ef4444, #dc2626)',
                'icon' => '❌',
                'title' => __('notifications.exchange_title_rejected'),
                'message' => __('emails_notifications.exchange.rejected_msg') . ($reason ? __('emails_notifications.exchange.rejected_reason', ['reason' => $reason]) : ''),
                'buttonText' => __('notifications.exchange_btn_view'),
                'helpText' => __('notifications.exchange_help_rejected'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => '',
                'alertBox' => $reason ? "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #fef2f2; border-radius: 8px; border-left: 4px solid #ef4444;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0 0 4px; font-size: 12px; color: #991b1b; font-weight: 600;\">{$labelCoordinatorsNote}</p>
                                        <p style=\"margin: 0; font-size: 14px; color: #7f1d1d;\">{$reason}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                " : '',
            ],
            'exchange_completed' => [
                'gradient' => 'linear-gradient(135deg, #10b981, #059669)',
                'icon' => '🎉',
                'title' => __('notifications.exchange_title_completed'),
                // See request_received_msg above — the locale string carries the unit.
                'message' => __('emails_notifications.exchange.completed_msg', ['hours' => "<strong>{$finalHours}</strong>"]),
                'buttonText' => __('notifications.exchange_btn_view_wallet'),
                'helpText' => __('notifications.exchange_help_completed'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelHoursTransferred}</p>
                            <p style=\"margin: 0; font-size: 32px; color: #10b981; font-weight: 700;\">{$finalHours}h</p>
                        </td>
                    </tr>
                ",
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #065f46;\">
                                            <strong>{$labelWellDone}</strong> " . __('emails_notifications.exchange.completed_well_done') . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
            'exchange_cancelled' => [
                'gradient' => 'linear-gradient(135deg, #f59e0b, #d97706)',
                'icon' => '⚠️',
                'title' => __('notifications.exchange_title_cancelled'),
                'message' => __('emails_notifications.exchange.cancelled_msg') . ($reason ? __('emails_notifications.exchange.cancelled_reason', ['reason' => $reason]) : ''),
                'buttonText' => __('notifications.exchange_btn_view'),
                'helpText' => __('notifications.exchange_help_cancelled'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => '',
                'alertBox' => '',
            ],
            'exchange_disputed' => [
                'gradient' => 'linear-gradient(135deg, #ef4444, #dc2626)',
                'icon' => '⚠️',
                'title' => __('notifications.exchange_title_disputed'),
                // See buildNotificationContent(): a member-raised report is not an
                // hours discrepancy, and the email must not claim it is.
                'message' => !empty($data['dispute_reason'])
                    ? __('emails_notifications.exchange.problem_reported_msg')
                    : __('emails_notifications.exchange.disputed_msg'),
                'buttonText' => __('notifications.exchange_btn_view_exchange'),
                'helpText' => __('notifications.exchange_help_disputed'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => !empty($data['requester_hours']) && !empty($data['provider_hours']) ? "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\">
                                <tr>
                                    <td width=\"50%\" style=\"text-align: center; padding: 8px;\">
                                        <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelRequesterConfirmed}</p>
                                        <p style=\"margin: 0; font-size: 20px; color: #ef4444; font-weight: 700;\">{$data['requester_hours']}h</p>
                                    </td>
                                    <td width=\"50%\" style=\"text-align: center; padding: 8px;\">
                                        <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelProviderConfirmed}</p>
                                        <p style=\"margin: 0; font-size: 20px; color: #ef4444; font-weight: 700;\">{$data['provider_hours']}h</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                " : '',
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #fef2f2; border-radius: 8px; border-left: 4px solid #ef4444;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #7f1d1d;\">
                                            <strong>{$labelUnderReview}</strong> " . __('emails_notifications.exchange.disputed_under_review') . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
            'exchange_accepted' => [
                'gradient' => 'linear-gradient(135deg, #10b981, #059669)',
                'icon' => '✅',
                'title' => __('notifications.exchange_title_accepted'),
                'message' => __('emails_notifications.exchange.accepted_msg', ['name' => "<strong>{$providerName}</strong>"]),
                'buttonText' => __('notifications.exchange_btn_view_exchange'),
                'helpText' => __('notifications.exchange_help_accepted'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelAgreedHours}</p>
                            <p style=\"margin: 0; font-size: 24px; color: #10b981; font-weight: 700;\">{$hours}h</p>
                        </td>
                    </tr>
                ",
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #065f46;\">
                                            <strong>{$labelNextStep}</strong> " . __('emails_notifications.exchange.accepted_next_step', ['name' => $providerName]) . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
            'exchange_pending_broker' => [
                'gradient' => 'linear-gradient(135deg, #f59e0b, #d97706)',
                'icon' => '⏳',
                'title' => __('notifications.exchange_title_pending_broker'),
                'message' => __('emails_notifications.exchange.pending_broker_msg'),
                'buttonText' => __('notifications.exchange_btn_view_exchange'),
                'helpText' => __('notifications.exchange_help_pending_broker'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelProposedHours}</p>
                            <p style=\"margin: 0; font-size: 24px; color: #f59e0b; font-weight: 700;\">{$hours}h</p>
                        </td>
                    </tr>
                ",
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #fffbeb; border-radius: 8px; border-left: 4px solid #f59e0b;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #92400e;\">
                                            <strong>{$labelWhyApproval}</strong> " . __('emails_notifications.exchange.pending_broker_why') . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
            'exchange_started' => [
                'gradient' => 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                'icon' => '🚀',
                'title' => __('notifications.exchange_title_started'),
                'message' => __('emails_notifications.exchange.started_msg'),
                'buttonText' => __('notifications.exchange_btn_view_exchange'),
                'helpText' => __('notifications.exchange_help_started'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelExpectedHours}</p>
                            <p style=\"margin: 0; font-size: 24px; color: #3b82f6; font-weight: 700;\">{$hours}h</p>
                        </td>
                    </tr>
                ",
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #eff6ff; border-radius: 8px; border-left: 4px solid #3b82f6;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #1e40af;\">
                                            <strong>{$labelRemember}</strong> " . __('emails_notifications.exchange.started_remember') . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
            'exchange_ready_confirmation' => [
                'gradient' => 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                'icon' => '✋',
                'title' => __('notifications.exchange_title_ready_confirmation'),
                'message' => __('emails_notifications.exchange.ready_confirmation_msg'),
                'buttonText' => __('notifications.exchange_btn_confirm'),
                'helpText' => __('notifications.exchange_help_ready_confirmation'),
                'typeColor' => $typeColor,
                'typeText' => $typeText,
                'typeBadge' => $typeBadge,
                'extraDetails' => "
                    <tr>
                        <td style=\"padding-top: 16px; border-top: 1px solid #e5e7eb; margin-top: 16px;\">
                            <p style=\"margin: 0 0 4px; font-size: 12px; color: #6b7280;\">{$labelProposedHours}</p>
                            <p style=\"margin: 0; font-size: 24px; color: #8b5cf6; font-weight: 700;\">{$hours}h</p>
                        </td>
                    </tr>
                ",
                'alertBox' => "
                    <tr>
                        <td style=\"padding: 0 24px 24px;\">
                            <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color: #f5f3ff; border-radius: 8px; border-left: 4px solid #8b5cf6;\">
                                <tr>
                                    <td style=\"padding: 16px;\">
                                        <p style=\"margin: 0; font-size: 14px; color: #5b21b6;\">
                                            <strong>{$labelActionNeeded}</strong> " . __('emails_notifications.exchange.ready_confirmation_action') . "
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                ",
            ],
        ];

        return $configs[$type] ?? [
            'gradient' => 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            'icon' => '📋',
            'title' => __('notifications.exchange_title_default'),
            'message' => __('notifications.exchange_msg_default'),
            'buttonText' => __('notifications.exchange_btn_view_exchange'),
            'helpText' => __('notifications.exchange_help_default'),
            'typeColor' => $typeColor,
            'typeText' => $typeText,
            'typeBadge' => $typeBadge,
            'extraDetails' => '',
            'alertBox' => '',
        ];
    }

    private static function buildVerificationPassedEmail(): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();

        $heading = __('notifications.verification_passed_heading');
        $body = __('notifications.verification_passed_body');
        $cta = __('notifications.verification_passed_cta');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #16a34a); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$body}</p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/dashboard" style="display: inline-block; background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #16a34a); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$cta}</a>
        </div>
    </div>
</div>
HTML;
    }

    private static function buildVerificationFailedEmail(string $reason): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $reasonHtml = !empty($reason) ? "<p style=\"color: #dc2626; font-weight: 500; margin: 16px 0;\">" . __('notifications.label_reason') . " " . htmlspecialchars($reason) . "</p>" : '';

        $heading = __('notifications.verification_failed_heading');
        $body = __('notifications.verification_failed_body');
        $cta = __('notifications.verification_failed_cta');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #dc2626; background-image: linear-gradient(135deg, #dc2626, #991b1b); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$body}</p>
        {$reasonHtml}
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/verify-identity" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$cta}</a>
        </div>
    </div>
</div>
HTML;
    }

    // =========================================================================
    // LINKED ACCOUNT (SUB-ACCOUNT) EMAIL BUILDERS
    // =========================================================================

    /**
     * Build HTML email for "someone wants to manage your account".
     *
     * Deliberately plain and slightly cautionary rather than celebratory: the
     * recipient is being asked to grant another member the ability to act for
     * them, and the honest framing is "you decide", not "good news". The button
     * carries ?tab=linked-accounts so it lands on the tab holding the request.
     *
     * @param string $requesterName  Full name of the member making the request.
     * @param string $relationshipType One of SubAccountService::RELATIONSHIP_TYPES.
     */
    public static function buildSubAccountRequestEmail(string $requesterName, string $relationshipType): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $requesterHtml = htmlspecialchars($requesterName, ENT_QUOTES, 'UTF-8');

        $typeLabel = htmlspecialchars(
            __('emails_notifications.sub_account.type_' . SubAccountService::normalizeRelationshipType($relationshipType)),
            ENT_QUOTES,
            'UTF-8',
        );

        $heading = __('emails_notifications.sub_account.request_heading');
        $tenantLabel = __('emails_notifications.sub_account.tenant_label', ['community' => $tenantName]);
        $body = __('emails_notifications.sub_account.request_body', ['name' => $requesterHtml]);
        $labelRequestedBy = __('emails_notifications.sub_account.label_requested_by');
        $labelAs = __('emails_notifications.sub_account.label_relationship');
        $whatItMeans = __('emails_notifications.sub_account.request_what_it_means');
        $noAction = __('emails_notifications.sub_account.request_no_action');
        $btnReview = __('emails_notifications.sub_account.btn_review_request');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$body}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelRequestedBy}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0 0 12px;">{$requesterHtml}</p>
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelAs}</p>
            <p style="color: #1e293b; font-size: 16px; font-weight: 600; margin: 0;">{$typeLabel}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$whatItMeans}
        </p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$noAction}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/settings?tab=linked-accounts" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$btnReview}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build HTML email telling the requester their linked-account request was
     * approved.
     *
     * @param string $approverName Full name of the member who approved it.
     */
    public static function buildSubAccountApprovedEmail(string $approverName): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $approverHtml = htmlspecialchars($approverName, ENT_QUOTES, 'UTF-8');

        $heading = __('emails_notifications.sub_account.approved_heading');
        $tenantLabel = __('emails_notifications.sub_account.tenant_label', ['community' => $tenantName]);
        $body = __('emails_notifications.sub_account.approved_body', ['name' => $approverHtml]);
        $labelMember = __('emails_notifications.sub_account.label_member');
        $whatNext = __('emails_notifications.sub_account.approved_what_next');
        $btnView = __('emails_notifications.sub_account.btn_view_linked_accounts');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$body}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelMember}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$approverHtml}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$whatNext}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/settings?tab=linked-accounts" style="display: inline-block; background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$btnView}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Email to the member whose account a carer just ACTED on (represent
     * tier): a listing was posted in their name. Names the carer — "someone
     * who manages your account" withheld the one fact the member would act
     * on — and links straight to the listing so the disclosure is checkable.
     */
    public static function buildSubAccountProxyListingEmail(string $actorName, string $listingLink): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $actorHtml = htmlspecialchars($actorName, ENT_QUOTES, 'UTF-8');
        $linkPath = htmlspecialchars($listingLink, ENT_QUOTES, 'UTF-8');

        $heading = __('emails_notifications.sub_account.proxy_listing_heading');
        $tenantLabel = __('emails_notifications.sub_account.tenant_label', ['community' => $tenantName]);
        $body = __('emails_notifications.sub_account.proxy_listing_body', ['name' => $actorHtml]);
        $labelActor = __('emails_notifications.sub_account.label_acted_by');
        $recordedNote = __('emails_notifications.sub_account.proxy_recorded_note');
        $btnView = __('emails_notifications.sub_account.btn_view_listing');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$body}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelActor}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$actorHtml}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$recordedNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}{$linkPath}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$btnView}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Email to the member whose balance a carer just spent from (represent
     * tier). Amber header on purpose: money left the account, and the member
     * did not press the button — attention-worthy, not celebratory.
     */
    public static function buildSubAccountProxyTransferEmail(string $actorName): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $actorHtml = htmlspecialchars($actorName, ENT_QUOTES, 'UTF-8');

        $heading = __('emails_notifications.sub_account.proxy_transfer_heading');
        $tenantLabel = __('emails_notifications.sub_account.tenant_label', ['community' => $tenantName]);
        $body = __('emails_notifications.sub_account.proxy_transfer_body', ['name' => $actorHtml]);
        $labelActor = __('emails_notifications.sub_account.label_acted_by');
        $recordedNote = __('emails_notifications.sub_account.proxy_recorded_note');
        $btnWallet = __('emails_notifications.sub_account.btn_view_wallet');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #f59e0b; background-image: linear-gradient(135deg, #f59e0b, #d97706); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$body}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelActor}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$actorHtml}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$recordedNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/wallet" style="display: inline-block; background-color: #f59e0b; background-image: linear-gradient(135deg, #f59e0b, #d97706); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$btnWallet}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Email to the SUPPORTED MEMBER: a supporter prepared something and it
     * waits for their answer. Carries the single-use confirm link (raw token,
     * never stored) — for a member who rarely logs in, this email IS the flow.
     * Refusing is stated as an equal option, and no reason is ever required.
     */
    public static function buildSupportActionPendingEmail(string $supporterName, \App\Models\SupportPendingAction $action, string $token): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $supporterHtml = htmlspecialchars($supporterName, ENT_QUOTES, 'UTF-8');
        $typeLabel = htmlspecialchars(__('emails_notifications.support_action.type_' . $action->action_type), ENT_QUOTES, 'UTF-8');
        $expires = htmlspecialchars((string) $action->expires_at?->translatedFormat('j F Y'), ENT_QUOTES, 'UTF-8');
        $tokenUrl = $frontendUrl . $basePath . '/support-actions/confirm/' . rawurlencode($token);

        $heading = __('emails_notifications.support_action.pending_heading');
        $tenantLabel = __('emails_notifications.sub_account.tenant_label', ['community' => $tenantName]);
        $body = __('emails_notifications.support_action.pending_body', ['name' => $supporterHtml, 'what' => $typeLabel]);
        $labelWhat = __('emails_notifications.support_action.label_prepared');
        $nothingHappens = __('emails_notifications.support_action.pending_nothing_without_you');
        $declineOk = __('emails_notifications.support_action.pending_decline_is_fine');
        $expiryNote = __('emails_notifications.support_action.pending_expires', ['date' => $expires]);
        $btnReview = __('emails_notifications.support_action.btn_review_and_answer');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$body}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelWhat}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$typeLabel}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$nothingHappens}
        </p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$declineOk}
        </p>
        <p style="color: #64748b; font-size: 13px; line-height: 1.6;">
            {$expiryNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$tokenUrl}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$btnReview}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Email to the SUPPORTER: how the supported member answered (confirmed /
     * declined / the action expired unanswered). Any decline reason travels in
     * the bell + list views, not this email — a reason typed for staff eyes
     * should not be replayed to the person it refuses.
     */
    public static function buildSupportActionAnswerEmail(string $supportedName, \App\Models\SupportPendingAction $action, string $outcomeKey): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $supportedHtml = htmlspecialchars($supportedName, ENT_QUOTES, 'UTF-8');
        $typeLabel = htmlspecialchars(__('emails_notifications.support_action.type_' . $action->action_type), ENT_QUOTES, 'UTF-8');

        $isConfirmed = $outcomeKey === 'confirmed';
        $gradient = $isConfirmed
            ? 'background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669);'
            : 'background-color: #64748b; background-image: linear-gradient(135deg, #64748b, #475569);';

        $heading = __('emails_notifications.support_action.' . $outcomeKey . '_heading');
        $tenantLabel = __('emails_notifications.sub_account.tenant_label', ['community' => $tenantName]);
        $body = __('emails_notifications.support_action.' . $outcomeKey . '_body', ['name' => $supportedHtml, 'what' => $typeLabel]);
        $btnView = __('emails_notifications.sub_account.btn_view_linked_accounts');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="{$gradient} padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$tenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$body}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/settings?tab=linked-accounts" style="display: inline-block; {$gradient} color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$btnView}</a>
        </div>
    </div>
</div>
HTML;
    }

    // =========================================================================
    // VOLUNTEERING EMAIL BUILDERS
    // =========================================================================

    /**
     * Build HTML email for volunteer application approval.
     */
    public static function buildVolApplicationApprovedEmail(string $oppTitle, int $oppId): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $oppTitleHtml = htmlspecialchars($oppTitle, ENT_QUOTES, 'UTF-8');

        $volAcceptedHeading = __('emails_notifications.volunteering.heading_accepted');
        $volTenantLabel = __('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]);
        $volApprovedBody = __('emails_notifications.volunteering.approved_body');
        $volLabelOpp = __('emails_notifications.volunteering.label_opportunity');
        $volApprovedNext = __('emails_notifications.volunteering.approved_next');
        $volBtnViewOpp = __('emails_notifications.volunteering.btn_view_opportunity');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 12px;">🎉</div>
        <h1 style="color: white; margin: 0; font-size: 24px;">{$volAcceptedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$volTenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$volApprovedBody}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$volLabelOpp}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$oppTitleHtml}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$volApprovedNext}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/volunteering/opportunities/{$oppId}" style="display: inline-block; background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$volBtnViewOpp}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build HTML email for volunteer application decline.
     */
    public static function buildVolApplicationDeclinedEmail(string $oppTitle): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $oppTitleHtml = htmlspecialchars($oppTitle, ENT_QUOTES, 'UTF-8');

        $volDeclinedHeading = __('emails_notifications.volunteering.heading_declined');
        $volTenantLabel = __('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]);
        $volDeclinedBody = __('emails_notifications.volunteering.declined_body');
        $volLabelOpp = __('emails_notifications.volunteering.label_opportunity');
        $volDeclinedEncouragement = __('emails_notifications.volunteering.declined_encouragement');
        $volBtnBrowse = __('emails_notifications.volunteering.btn_browse_opportunities');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$volDeclinedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$volTenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$volDeclinedBody}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$volLabelOpp}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$oppTitleHtml}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$volDeclinedEncouragement}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/volunteering" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$volBtnBrowse}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build HTML email for volunteer hours approved with payment.
     */
    public static function buildVolHoursApprovedPaidEmail(float $hours, string $orgName): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $orgNameHtml = htmlspecialchars($orgName, ENT_QUOTES, 'UTF-8');

        $volHoursPaidHeading = __('emails_notifications.volunteering.heading_hours_paid');
        $volTenantLabel = __('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]);
        $volHoursPaidBody = __('emails_notifications.volunteering.hours_paid_body');
        $volLabelHoursApproved = __('emails_notifications.volunteering.label_hours_approved');
        $volLabelCreditsEarned = __('emails_notifications.volunteering.label_credits_earned');
        // The translated hours_paid_detail template already contains the
        // "time credits" wording around the :hours placeholder, so pass only the
        // number — appending "time credits" here duplicated it in English and
        // injected untranslated English into every other locale.
        $volHoursPaidDetail = __('emails_notifications.volunteering.hours_paid_detail', ['org' => "<strong>{$orgNameHtml}</strong>", 'hours' => "<strong>{$hours}</strong>"]);
        $volBtnViewWallet = __('emails_notifications.volunteering.btn_view_wallet');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 12px;">⏰💰</div>
        <h1 style="color: white; margin: 0; font-size: 24px;">{$volHoursPaidHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$volTenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$volHoursPaidBody}
        </p>
        <div style="display: flex; gap: 16px; margin: 20px 0;">
            <div style="flex: 1; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center;">
                <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$volLabelHoursApproved}</p>
                <p style="color: #22c55e; font-size: 28px; font-weight: 700; margin: 0;">{$hours}h</p>
            </div>
            <div style="flex: 1; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center;">
                <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$volLabelCreditsEarned}</p>
                <p style="color: #22c55e; font-size: 28px; font-weight: 700; margin: 0;">{$hours}</p>
            </div>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$volHoursPaidDetail}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/wallet" style="display: inline-block; background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$volBtnViewWallet}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build HTML email for volunteer hours approved (no payment).
     *
     * @param bool $creditAdded false for sub-whole-hour approvals: balances
     *                          store whole hours, so approvals under 1h mint
     *                          nothing — the email must say so honestly instead
     *                          of the celebratory generic copy (VOL-BE-008 /
     *                          2026-07-09 audit P4).
     */
    public static function buildVolHoursApprovedEmail(float $hours, string $orgName, bool $creditAdded = true): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $orgNameHtml = htmlspecialchars($orgName, ENT_QUOTES, 'UTF-8');

        $volHoursApprovedHeading = __('emails_notifications.volunteering.heading_hours_approved');
        $volTenantLabel = __('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]);
        $volHoursApprovedBody = __('emails_notifications.volunteering.hours_approved_body', ['org' => "<strong>{$orgNameHtml}</strong>"]);
        $volLabelHoursApproved = __('emails_notifications.volunteering.label_hours_approved');
        $volHoursApprovedThanks = $creditAdded
            ? __('emails_notifications.volunteering.hours_approved_thanks')
            : __('emails_notifications.volunteering.hours_approved_no_credit_note');
        $volBtnViewHours = __('emails_notifications.volunteering.btn_view_hours');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
        <h1 style="color: white; margin: 0; font-size: 24px;">{$volHoursApprovedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$volTenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$volHoursApprovedBody}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center; margin: 20px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$volLabelHoursApproved}</p>
            <p style="color: #22c55e; font-size: 28px; font-weight: 700; margin: 0;">{$hours}h</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$volHoursApprovedThanks}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/volunteering?tab=hours" style="display: inline-block; background-color: #22c55e; background-image: linear-gradient(135deg, #22c55e, #059669); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$volBtnViewHours}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build HTML email for volunteer hours declined.
     */
    public static function buildVolHoursDeclinedEmail(float $hours, string $orgName): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $orgNameHtml = htmlspecialchars($orgName, ENT_QUOTES, 'UTF-8');

        $volHoursDeclinedHeading = __('emails_notifications.volunteering.heading_hours_declined');
        $volTenantLabel = __('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]);
        $volHoursDeclinedBody = __('emails_notifications.volunteering.hours_declined_body', ['hours' => "<strong>{$hours}h</strong>", 'org' => "<strong>{$orgNameHtml}</strong>"]);
        $volHoursDeclinedNote = __('emails_notifications.volunteering.hours_declined_note');
        $volBtnViewHours = __('emails_notifications.volunteering.btn_view_hours');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$volHoursDeclinedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$volTenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$volHoursDeclinedBody}
        </p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$volHoursDeclinedNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/volunteering?tab=hours" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$volBtnViewHours}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build HTML email for new volunteer application received (sent to org owner).
     */
    public static function buildVolApplicationReceivedEmail(string $volunteerName, string $oppTitle, int $orgId): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars($tenant['name'] ?? 'Community', ENT_QUOTES, 'UTF-8');
        $basePath = TenantContext::getSlugPrefix();
        $frontendUrl = TenantContext::getFrontendUrl();
        $volunteerHtml = htmlspecialchars($volunteerName, ENT_QUOTES, 'UTF-8');
        $oppTitleHtml = htmlspecialchars($oppTitle, ENT_QUOTES, 'UTF-8');

        $volAppReceivedHeading = __('emails_notifications.volunteering.heading_application_received');
        $volTenantLabel = __('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]);
        $volAppReceivedBody = __('emails_notifications.volunteering.application_received_body', ['name' => "<strong>{$volunteerHtml}</strong>"]);
        $volLabelOpp = __('emails_notifications.volunteering.label_opportunity');
        $volAppReceivedNote = __('emails_notifications.volunteering.application_received_note');
        $volBtnReviewApp = __('emails_notifications.volunteering.btn_review_application');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #f43f5e; background-image: linear-gradient(135deg, #f43f5e, #e11d48); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 12px;">🙋</div>
        <h1 style="color: white; margin: 0; font-size: 24px;">{$volAppReceivedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$volTenantLabel}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
            {$volAppReceivedBody}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$volLabelOpp}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0;">{$oppTitleHtml}</p>
        </div>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            {$volAppReceivedNote}
        </p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$frontendUrl}{$basePath}/volunteering/org/{$orgId}/dashboard?tab=applications" style="display: inline-block; background-color: #f43f5e; background-image: linear-gradient(135deg, #f43f5e, #e11d48); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$volBtnReviewApp}</a>
        </div>
    </div>
</div>
HTML;
    }
}
