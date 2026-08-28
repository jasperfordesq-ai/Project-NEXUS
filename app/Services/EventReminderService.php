<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * EventReminderService — Laravel DI service for automated event reminders.
 *
 * Sends reminder notifications to event attendees at two intervals:
 *   - 24 hours before
 *   - 1 hour before
 *
 * Designed to be called from a cron job. Idempotent — duplicate reminders
 * are prevented by the event_reminder_sent tracking table.
 */
class EventReminderService
{
    private readonly EventReminderChannelDeliveryService $channelDeliveries;

    /**
     * Reminder intervals in hours before event start_time.
     */
    private const REMINDER_INTERVALS = [
        '24h' => 24,
        '1h'  => 1,
    ];

    /**
     * Window in minutes — how far ahead to look for events needing reminders.
     */
    private const LOOKAHEAD_MINUTES = 30;

    public function __construct(?EventReminderChannelDeliveryService $channelDeliveries = null)
    {
        $this->channelDeliveries = $channelDeliveries ?? new EventReminderChannelDeliveryService();
    }

    /**
     * Format a UTC event instant in the event's retained IANA timezone.
     *
     * Legacy rows without a valid event timezone fall back to the tenant then
     * UTC. Carbon's locale-aware format keeps weekday/month names in the
     * recipient locale selected by the surrounding LocaleContext.
     */
    private static function formatEventTimeForTenant(
        int $tenantId,
        ?string $startTime,
        ?string $eventTimezone = null,
    ): string
    {
        if (!$startTime) {
            return '';
        }

        try {
            $timezone = trim((string) $eventTimezone);
            if (!self::isIanaTimezone($timezone)) {
                $timezone = trim((string) (
                    app(\App\Services\TenantSettingsService::class)
                        ->get($tenantId, 'general.timezone', 'UTC') ?: 'UTC'
                ));
            }
            if (!self::isIanaTimezone($timezone)) {
                $timezone = 'UTC';
            }

            return \Carbon\Carbon::parse($startTime, 'UTC')
                ->setTimezone($timezone)
                ->locale(\App\I18n\FormattingLocale::carbon())
                ->isoFormat('LLLL')
                . ' (' . $timezone . ')';
        } catch (\Throwable) {
            return \Carbon\Carbon::parse($startTime, 'UTC')
                ->locale(\App\I18n\FormattingLocale::carbon())
                ->isoFormat('LLLL')
                . ' (UTC)';
        }
    }

    private static function isIanaTimezone(string $timezone): bool
    {
        if ($timezone === 'UTC') {
            return true;
        }

        static $identifiers = null;
        $identifiers ??= array_fill_keys(\DateTimeZone::listIdentifiers(\DateTimeZone::ALL_WITH_BC), true);

        return isset($identifiers[$timezone]);
    }

    public static function claimReminderDelivery(int $tenantId, int $eventId, int $userId, string $reminderType): bool
    {
        try {
            self::releaseStaleReminderDeliveryClaim($tenantId, $eventId, $userId, $reminderType);

            $inserted = DB::table('event_reminder_delivery_claims')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'reminder_type' => $reminderType,
                'status' => 'claimed',
                'claimed_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return (int) $inserted > 0;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[EventReminderService] reminder delivery claim failed', [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'reminder_type' => $reminderType,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    private static function releaseStaleReminderDeliveryClaim(int $tenantId, int $eventId, int $userId, string $reminderType): void
    {
        DB::table('event_reminder_delivery_claims')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('reminder_type', $reminderType)
            ->where('status', 'claimed')
            ->whereNull('delivered_at')
            ->where('claimed_at', '<', now()->subHour())
            ->delete();
    }

    public static function releaseReminderDeliveryClaim(int $tenantId, int $eventId, int $userId, string $reminderType): void
    {
        DB::table('event_reminder_delivery_claims')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('reminder_type', $reminderType)
            ->whereNull('delivered_at')
            ->delete();
    }

    public static function markReminderDeliverySent(int $tenantId, int $eventId, int $userId, string $reminderType): bool
    {
        return self::completeReminderAggregate($tenantId, $eventId, $userId, $reminderType, 'delivered', true);
    }

    private static function completeReminderAggregate(
        int $tenantId,
        int $eventId,
        int $userId,
        string $reminderType,
        string $status,
        bool $recordHandled,
    ): bool {
        $inserted = 0;
        if ($recordHandled) {
            $inserted = DB::table('event_reminder_sent')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'reminder_type' => $reminderType,
                'sent_at' => now(),
            ]);
        }

        DB::table('event_reminder_delivery_claims')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('reminder_type', $reminderType)
            ->update([
                'status' => $status,
                'delivered_at' => $status === 'delivered' ? now() : null,
                'updated_at' => now(),
            ]);

        return (int) $inserted > 0;
    }

    /**
     * Send all due event reminders for the current tenant.
     *
     * @return int Number of reminders sent
     */
    public function sendDueReminders(int $tenantId): int
    {
        return (int) TenantContext::runForTenant($tenantId, function () use ($tenantId): int {
            $rawMode = config('events.reminders.mode', 'canonical');
            $mode = is_string($rawMode) ? trim($rawMode) : '';
            if (! in_array($mode, ['legacy', 'shadow', 'canonical'], true)) {
                Log::critical('[EventReminderService] Invalid reminder rollout mode; delivery failed closed', [
                    'tenant_id' => $tenantId,
                    'configuration_type' => get_debug_type($rawMode),
                ]);
                return 0;
            }
            if ($mode === 'canonical') {
                return 0;
            }
            if (!TenantContext::hasFeature('events')) {
                Log::info('[EventReminderService] Events reminders skipped because the tenant feature is disabled', [
                    'tenant_id' => $tenantId,
                ]);

                return 0;
            }
            if (! (bool) TenantContext::getSetting('events.reminders_enabled', true)) {
                Log::info('[EventReminderService] Event reminders skipped by tenant policy', [
                    'tenant_id' => $tenantId,
                ]);
                return 0;
            }

            $sent = 0;

            foreach (self::REMINDER_INTERVALS as $type => $hoursBeforeEvent) {
                $result = $this->processReminderType($tenantId, $type, $hoursBeforeEvent);
                $sent += $result['sent'];
            }

            $configured = $this->processConfiguredReminders($tenantId);
            $sent += $configured['sent'];

            return $sent;
        });
    }

    /**
     * Compatibility entry point for a specific event. It uses the same
     * per-channel ledger as the cron path and still enforces due windows.
     */
    public function sendEventReminders(int $tenantId, int $eventId): int
    {
        return (int) TenantContext::runForTenant($tenantId, function () use ($tenantId, $eventId): int {
            if (!TenantContext::hasFeature('events')) {
                return 0;
            }
            if (! (bool) TenantContext::getSetting('events.reminders_enabled', true)) {
                return 0;
            }

            $sent = 0;
            foreach (self::REMINDER_INTERVALS as $type => $hoursBeforeEvent) {
                $sent += $this->processReminderType($tenantId, $type, $hoursBeforeEvent, $eventId)['sent'];
            }

            return $sent;
        });
    }

    /**
     * Cancel a reminder for an event.
     */
    public function cancelReminder(int $tenantId, int $eventId): bool
    {
        try {
            DB::delete(
                "DELETE FROM event_reminder_sent WHERE tenant_id = ? AND event_id = ?",
                [$tenantId, $eventId]
            );
            return true;
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[EventReminderService] cancelReminder error: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Process a single reminder type (24h or 1h) for a tenant.
     */
    private function processReminderType(
        int $tenantId,
        string $reminderType,
        int $hoursBeforeEvent,
        ?int $onlyEventId = null,
    ): array
    {
        $sent = 0;
        $errors = 0;

        $windowStart = $hoursBeforeEvent * 60 - self::LOOKAHEAD_MINUTES;
        $windowEnd = $hoursBeforeEvent * 60 + self::LOOKAHEAD_MINUTES;

        try {
            $events = DB::select(
                "SELECT e.id, e.title, e.start_time, e.timezone, e.location, e.is_online
                 FROM events e
                 WHERE e.tenant_id = ?
                   AND (? IS NULL OR e.id = ?)
                   AND (e.status IS NULL OR e.status = 'active')
                   AND e.start_time > NOW()
                   AND e.start_time BETWEEN
                       DATE_ADD(NOW(), INTERVAL ? MINUTE)
                       AND DATE_ADD(NOW(), INTERVAL ? MINUTE)",
                [$tenantId, $onlyEventId, $onlyEventId, $windowStart, $windowEnd]
            );
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[EventReminderService] Query error: " . $e->getMessage());
            return ['sent' => 0, 'errors' => 1];
        }

        foreach ($events as $event) {
            $eventId = (int) $event->id;

            // Get attendees who haven't been reminded yet
            $attendees = DB::select(
                "SELECT r.user_id, u.name, u.first_name, u.last_name, u.email, u.preferred_language, r.status
                 FROM event_rsvps r
                 JOIN users u ON r.user_id = u.id
                    AND u.tenant_id = ?
                    AND u.status = 'active'
                    AND u.deleted_at IS NULL
                 LEFT JOIN event_reminder_sent ers
                     ON ers.event_id = r.event_id
                     AND ers.user_id = r.user_id
                     AND ers.reminder_type = ?
                     AND ers.tenant_id = ?
                 WHERE r.event_id = ?
                   AND r.tenant_id = ?
                   AND r.status IN ('going', 'interested')
                   AND NOT EXISTS (
                       SELECT 1
                       FROM event_reminders er
                       WHERE er.event_id = r.event_id
                         AND er.user_id = r.user_id
                         AND er.tenant_id = ?
                         AND er.status IN ('pending', 'sent', 'cancelled')
                         AND er.remind_before_minutes = ?
                   )
                   AND ers.id IS NULL",
                [$tenantId, $reminderType, $tenantId, $eventId, $tenantId, $tenantId, $hoursBeforeEvent * 60]
            );

            foreach ($attendees as $attendee) {
                $userId = (int) $attendee->user_id;
                $aggregateHandled = false;

                try {
                    if (!self::claimReminderDelivery($tenantId, $eventId, $userId, $reminderType)) {
                        continue;
                    }

                    LocaleContext::withLocale($attendee, function () use ($tenantId, $eventId, $reminderType, $event, $attendee, $userId, &$sent, &$aggregateHandled): void {
                        $title = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
                        $when = self::formatEventTimeForTenant(
                            $tenantId,
                            $event->start_time,
                            $event->timezone ?? null,
                        );

                        if ($reminderType === '24h') {
                            $message = __('svc_notifications_2.event.reminder_tomorrow', ['title' => $title, 'when' => $when]);
                        } else {
                            $message = __('svc_notifications_2.event.reminder_1h', ['title' => $title, 'when' => $when]);
                        }

                        $link = "/events/{$eventId}";
                        $subjectKey = $reminderType === '24h'
                            ? 'notifications.event_reminder_subject_24h'
                            : 'notifications.event_reminder_subject_1h';
                        $subject = __($subjectKey, ['title' => $title]);
                        $eventUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
                        $name = $attendee->first_name ?? $attendee->name ?? __('emails.common.fallback_name');
                        $html = EmailTemplateBuilder::make()
                            ->title(__('emails_misc.events.reminder_email_title'))
                            ->previewText($message)
                            ->greeting($name)
                            ->paragraph($message)
                            ->button(__('emails_misc.events.reminder_email_cta'), $eventUrl)
                            ->render();

                        $statuses = $this->deliverReminderChannels(
                            $tenantId,
                            $eventId,
                            $userId,
                            'fixed:' . $reminderType . ':' . (string) $event->start_time,
                            ['email', 'in_app', 'push'],
                            $attendee,
                            $subject,
                            $message,
                            $html,
                            $link,
                        );
                        if (!$this->channelDeliveries->allTerminal($statuses)) {
                            self::releaseReminderDeliveryClaim($tenantId, $eventId, $userId, $reminderType);
                            return;
                        }

                        $anyDelivered = in_array('delivered', $statuses, true);
                        $emailStatus = $statuses['email'] ?? null;
                        $claimStatus = $emailStatus === 'delivered'
                            ? 'delivered'
                            : ($emailStatus === 'suppressed' ? 'suppressed' : 'handled');
                        $markedSent = self::completeReminderAggregate(
                            $tenantId,
                            $eventId,
                            $userId,
                            $reminderType,
                            $claimStatus,
                            $anyDelivered,
                        );
                        $aggregateHandled = true;

                        if ($anyDelivered && $markedSent) {
                            $sent++;
                        }
                    });
                } catch (\Throwable $e) {
                    if (!$aggregateHandled) {
                        self::releaseReminderDeliveryClaim($tenantId, $eventId, $userId, $reminderType);
                    }
                    Log::warning("[EventReminderService] Failed: event={$eventId}, user={$userId}: " . $e->getMessage());
                    $errors++;
                }
            }
        }

        return ['sent' => $sent, 'errors' => $errors];
    }

    /**
     * Process user-configured reminders from event_reminders.
     *
     * The React/Laravel event settings allow 60, 1440, and 10080 minute
     * reminders with platform/email/both delivery. These rows are the user's
     * explicit schedule, so they are handled separately from the legacy fixed
     * 24h/1h fallback scan above.
     */
    private function processConfiguredReminders(int $tenantId): array
    {
        $sent = 0;
        $errors = 0;

        try {
            $reminders = DB::select(
                "SELECT er.id AS reminder_id, er.remind_before_minutes, er.reminder_type AS delivery_type,
                        e.id AS event_id, e.title, e.start_time, e.timezone, e.location, e.is_online,
                        u.id AS user_id, u.name, u.first_name, u.last_name, u.email, u.preferred_language
                 FROM event_reminders er
                 JOIN events e ON e.id = er.event_id AND e.tenant_id = er.tenant_id
                 JOIN users u ON u.id = er.user_id
                    AND u.tenant_id = er.tenant_id
                    AND u.status = 'active'
                    AND u.deleted_at IS NULL
                 JOIN event_rsvps r ON r.event_id = er.event_id
                    AND r.user_id = er.user_id
                    AND r.tenant_id = er.tenant_id
                    AND r.status IN ('going', 'interested')
                 WHERE er.tenant_id = ?
                   AND er.status = 'pending'
                   AND (e.status IS NULL OR e.status = 'active')
                   AND er.scheduled_for <= NOW()
                   AND e.start_time > NOW()
                 ORDER BY er.scheduled_for ASC
                 LIMIT 200",
                [$tenantId]
            );
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[EventReminderService] configured reminder query error: ' . $e->getMessage());
            return ['sent' => 0, 'errors' => 1];
        }

        foreach ($reminders as $reminder) {
            $eventId = (int) $reminder->event_id;
            $userId = (int) $reminder->user_id;
            $deliveryType = (string) $reminder->delivery_type;
            $reminderType = $this->reminderTypeForMinutes((int) $reminder->remind_before_minutes);
            $aggregateHandled = false;
            $configuredStatus = null;

            try {
                if (!self::claimReminderDelivery($tenantId, $eventId, $userId, $reminderType)) {
                    continue;
                }

                LocaleContext::withLocale($reminder, function () use ($tenantId, $eventId, $userId, $reminder, $deliveryType, $reminderType, &$sent, &$aggregateHandled, &$configuredStatus): void {
                    $title = htmlspecialchars($reminder->title, ENT_QUOTES, 'UTF-8');
                    $when = self::formatEventTimeForTenant(
                        $tenantId,
                        $reminder->start_time,
                        $reminder->timezone ?? null,
                    );
                    $message = match ((int) $reminder->remind_before_minutes) {
                        10080 => __('svc_notifications_2.event.reminder_7d', ['title' => $title, 'when' => $when]),
                        1440 => __('svc_notifications_2.event.reminder_tomorrow', ['title' => $title, 'when' => $when]),
                        default => __('svc_notifications_2.event.reminder_1h', ['title' => $title, 'when' => $when]),
                    };
                    $link = "/events/{$eventId}";
                    $subjectKey = match ((int) $reminder->remind_before_minutes) {
                        10080 => 'notifications.event_reminder_subject_7d',
                        1440 => 'notifications.event_reminder_subject_24h',
                        default => 'notifications.event_reminder_subject_1h',
                    };
                    $subject = __($subjectKey, ['title' => $title]);
                    $eventUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
                    $name = $reminder->first_name ?? $reminder->name ?? __('emails.common.fallback_name');
                    $html = EmailTemplateBuilder::make()
                        ->title(__('emails_misc.events.reminder_email_title'))
                        ->previewText($message)
                        ->greeting($name)
                        ->paragraph($message)
                        ->button(__('emails_misc.events.reminder_email_cta'), $eventUrl)
                        ->render();
                    $channels = match ($deliveryType) {
                        'email' => ['email'],
                        'platform' => ['in_app', 'push'],
                        default => ['email', 'in_app', 'push'],
                    };
                    $statuses = $this->deliverReminderChannels(
                        $tenantId,
                        $eventId,
                        $userId,
                        'configured:' . (int) $reminder->reminder_id,
                        $channels,
                        $reminder,
                        $subject,
                        $message,
                        $html,
                        $link,
                    );
                    if (!$this->channelDeliveries->allTerminal($statuses)) {
                        self::releaseReminderDeliveryClaim($tenantId, $eventId, $userId, $reminderType);
                        return;
                    }

                    $anyDelivered = in_array('delivered', $statuses, true);
                    $emailStatus = $statuses['email'] ?? null;
                    $emailOnlySuppressed = $deliveryType === 'email' && $emailStatus === 'suppressed';
                    $claimStatus = $emailStatus === 'delivered'
                        ? 'delivered'
                        : ($emailStatus === 'suppressed' ? 'suppressed' : 'handled');

                    if ($emailOnlySuppressed || !$anyDelivered) {
                        self::completeReminderAggregate(
                            $tenantId,
                            $eventId,
                            $userId,
                            $reminderType,
                            $claimStatus,
                            false,
                        );
                        $configuredStatus = 'cancelled';
                        $aggregateHandled = true;
                        return;
                    }

                    $markedSent = self::completeReminderAggregate(
                        $tenantId,
                        $eventId,
                        $userId,
                        $reminderType,
                        $claimStatus,
                        true,
                    );
                    $configuredStatus = 'sent';
                    $aggregateHandled = true;
                    if ($markedSent) {
                        $sent++;
                    }
                });

                if ($configuredStatus !== null) {
                    DB::table('event_reminders')
                        ->where('id', $reminder->reminder_id)
                        ->where('tenant_id', $tenantId)
                        ->where('status', 'pending')
                        ->update([
                            'status' => $configuredStatus,
                            'sent_at' => $configuredStatus === 'sent' ? now() : null,
                            'updated_at' => now(),
                        ]);
                }
            } catch (\Throwable $e) {
                if (!$aggregateHandled) {
                    self::releaseReminderDeliveryClaim($tenantId, $eventId, $userId, $reminderType);
                }

                Log::warning('[EventReminderService] configured reminder failed', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
                $errors++;
            }
        }

        return ['sent' => $sent, 'errors' => $errors];
    }

    /**
     * Deliver only incomplete reminder channels and return their durable state.
     *
     * @param list<string> $channels
     * @return array<string,string>
     */
    private function deliverReminderChannels(
        int $tenantId,
        int $eventId,
        int $userId,
        string $reminderIdentity,
        array $channels,
        object $recipient,
        string $subject,
        string $message,
        string $html,
        string $link,
    ): array {
        $deliveries = $this->channelDeliveries->ensureChannels(
            $tenantId,
            $eventId,
            $userId,
            $reminderIdentity,
            $channels,
            ['event_id' => $eventId, 'link' => $link],
        );

        foreach ($deliveries as $channel => $delivery) {
            $status = (string) ($delivery['status'] ?? 'pending');
            if (in_array($status, ['delivered', 'suppressed', 'failed_terminal'], true)) {
                continue;
            }

            if ($channel === 'email') {
                $this->deliverReminderEmail(
                    $tenantId,
                    $eventId,
                    $userId,
                    $delivery,
                    $recipient,
                    $subject,
                    $html,
                );
                continue;
            }

            if ($channel === 'in_app') {
                $this->deliverReminderInApp($tenantId, $userId, $delivery, $message, $link);
                continue;
            }

            if ($channel === 'push') {
                $this->deliverReminderPush($tenantId, $userId, $delivery, $subject, $message, $link);
            }
        }

        return $this->channelDeliveries->statuses($tenantId, $deliveries);
    }

    /** @param array<string,mixed> $delivery */
    private function deliverReminderEmail(
        int $tenantId,
        int $eventId,
        int $userId,
        array $delivery,
        object $recipient,
        string $subject,
        string $html,
    ): void {
        $deliveryId = (int) $delivery['id'];
        if (!EventNotificationPreferenceResolver::allowsEmail($userId, $tenantId)) {
            $this->channelDeliveries->markSuppressed(
                $tenantId,
                $deliveryId,
                'Events email disabled by recipient preference',
                EventNotificationPreferenceResolver::EMAIL_PREFERENCE_KEY,
            );
            return;
        }

        $email = (string) ($recipient->email ?? '');
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $this->channelDeliveries->markSuppressed($tenantId, $deliveryId, 'Recipient has no valid email address');
            return;
        }
        if (Mailer::isSuppressed($email)) {
            $this->channelDeliveries->markSuppressed($tenantId, $deliveryId, 'Recipient is on the email suppression list');
            return;
        }

        $claim = $this->channelDeliveries->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $claimToken = (string) $claim['claim_token'];
        $idempotencyKey = (string) $claim['delivery_key'];

        try {
            // Recover a crash after a successful provider call but before the
            // channel ledger update whenever the email audit row is present.
            if ($this->successfulEmailEvidenceExists($tenantId, $userId, $idempotencyKey)) {
                $this->channelDeliveries->markDelivered($tenantId, $deliveryId, $claimToken, 'email_log');
                return;
            }

            $unsubscribeUrl = EventNotificationPreferenceResolver::unsubscribeUrl($userId, $tenantId);
            $sent = EmailDispatchService::sendRaw(
                $email,
                $subject,
                $html,
                null,
                null,
                $unsubscribeUrl,
                'event_reminder',
                [
                    'tenant_id' => $tenantId,
                    'idempotency_key' => $idempotencyKey,
                    'source' => self::class,
                    'event_id' => $eventId,
                ],
            );
            if (!$sent) {
                $this->channelDeliveries->markRetrying(
                    $tenantId,
                    $deliveryId,
                    $claimToken,
                    'event reminder email provider returned false',
                );
                return;
            }

            if (!$this->channelDeliveries->markDelivered($tenantId, $deliveryId, $claimToken, 'email')) {
                Log::critical('[EventReminderService] Email sent but channel ledger completion failed', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $userId,
                    'delivery_id' => $deliveryId,
                    'idempotency_key' => $idempotencyKey,
                ]);
            }
        } catch (\Throwable $e) {
            $this->channelDeliveries->markRetrying($tenantId, $deliveryId, $claimToken, $e->getMessage());
            Log::warning('[EventReminderService] Reminder email channel failed', [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverReminderInApp(
        int $tenantId,
        int $userId,
        array $delivery,
        string $message,
        string $link,
    ): void {
        $deliveryId = (int) $delivery['id'];
        $claim = $this->channelDeliveries->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $claimToken = (string) $claim['claim_token'];

        try {
            DB::transaction(function () use ($tenantId, $userId, $deliveryId, $claimToken, $message, $link): void {
                DB::table('notifications')->insert([
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                    'message' => $message,
                    'link' => $link,
                    'type' => 'event_reminder',
                    'created_at' => now(),
                ]);
                if (!$this->channelDeliveries->markDelivered($tenantId, $deliveryId, $claimToken, 'database')) {
                    throw new \RuntimeException('in-app channel ledger completion failed');
                }
            }, 3);
        } catch (\Throwable $e) {
            $this->channelDeliveries->markRetrying($tenantId, $deliveryId, $claimToken, $e->getMessage());
            Log::warning('[EventReminderService] Reminder in-app channel failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverReminderPush(
        int $tenantId,
        int $userId,
        array $delivery,
        string $title,
        string $message,
        string $link,
    ): void {
        $deliveryId = (int) $delivery['id'];
        $preferences = \App\Models\User::getNotificationPreferences($userId);
        if (!filter_var($preferences['push_enabled'] ?? true, FILTER_VALIDATE_BOOL)) {
            $this->channelDeliveries->markSuppressed($tenantId, $deliveryId, 'Push disabled by recipient preference', 'push_enabled');
            return;
        }

        $hasWebPush = Schema::hasTable('push_subscriptions') && DB::table('push_subscriptions')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->exists();
        $hasFcm = Schema::hasTable('fcm_device_tokens') && DB::table('fcm_device_tokens')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->exists();
        if (!$hasWebPush && !$hasFcm) {
            $this->channelDeliveries->markSuppressed($tenantId, $deliveryId, 'Recipient has no registered push destination');
            return;
        }

        $claim = $this->channelDeliveries->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $claimToken = (string) $claim['claim_token'];

        try {
            $delivered = false;
            if ($hasWebPush) {
                $delivered = WebPushService::sendToUserStatic($userId, $title, $message, $link, 'event_reminder');
            }
            if ($hasFcm) {
                $fcm = FCMPushService::sendToUser($userId, $title, $message, ['link' => $link, 'type' => 'event_reminder']);
                $delivered = $delivered || (int) ($fcm['sent'] ?? 0) > 0;
            }

            if ($delivered) {
                $this->channelDeliveries->markDelivered($tenantId, $deliveryId, $claimToken, 'push');
            } else {
                $this->channelDeliveries->markRetrying(
                    $tenantId,
                    $deliveryId,
                    $claimToken,
                    'event reminder push provider returned false',
                );
            }
        } catch (\Throwable $e) {
            $this->channelDeliveries->markRetrying($tenantId, $deliveryId, $claimToken, $e->getMessage());
            Log::warning('[EventReminderService] Reminder push channel failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function successfulEmailEvidenceExists(int $tenantId, int $userId, string $idempotencyKey): bool
    {
        if (!Schema::hasTable('email_log') || !Schema::hasColumn('email_log', 'idempotency_key')) {
            return false;
        }

        return DB::table('email_log')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('category', 'event_reminder')
            ->where('idempotency_key', $idempotencyKey)
            ->whereIn('status', ['sent', 'delivered'])
            ->exists();
    }

    private function reminderTypeForMinutes(int $minutes): string
    {
        return match ($minutes) {
            10080 => '7d',
            1440 => '24h',
            default => '1h',
        };
    }
}
