<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * EventNotificationService — handles in-app and email notifications for event actions.
 *
 * - RSVP status changes (notify organizer)
 * - Event updates/rescheduling (notify attendees)
 * - Event cancellation (notify attendees + waitlisted)
 * - Reminder dispatch (24h and 1h before event)
 * - Generic attendee message broadcast
 *
 * Each notification method creates an in-app bell notification AND queues/sends
 * an email through the tenant mailer, respecting the user's notification frequency
 * preferences where applicable.
 */
class EventNotificationService
{
    public function __construct()
    {
    }

    /**
     * Notify event attendees with a custom message.
     *
     * Creates in-app notifications for all attendees (going + interested)
     * excluding the organizer.
     *
     * @return int Number of notifications sent
     */
    public function notifyAttendees(int $tenantId, int $eventId, string $message): int
    {
        try {
            $event = DB::table('events')
                ->where('id', $eventId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'title', 'user_id'])
                ->first();

            if (!$event) {
                return 0;
            }

            $organizerId = (int) $event->user_id;

            $attendees = DB::table('event_rsvps as r')
                ->join('users as u', function ($join) use ($tenantId) {
                    $join->on('r.user_id', '=', 'u.id')
                        ->where('u.tenant_id', '=', $tenantId);
                })
                ->where('r.event_id', $eventId)
                ->where('r.tenant_id', $tenantId)
                ->whereIn('r.status', ['going', 'interested'])
                ->select(['r.user_id', 'u.email', 'u.name', 'u.first_name', 'u.preferred_language'])
                ->distinct()
                ->get();

            if ($attendees->isEmpty()) {
                return 0;
            }

            $recipientIds = $attendees
                ->pluck('user_id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->filter(static fn (int $id): bool => $id > 0 && $id !== $organizerId)
                ->unique()
                ->values()
                ->all();
            app(SafeguardingInteractionPolicy::class)->assertManyLocalContactsAllowed(
                $organizerId,
                $recipientIds,
                $tenantId,
                'event_broadcast',
            );

            $path = '/events/' . $eventId;
            $count = 0;
            $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');

            foreach ($attendees as $attendee) {
                $attendeeId = (int) $attendee->user_id;
                if ($attendeeId === $organizerId) {
                    continue;
                }

                Notification::create([
                    'user_id' => $attendeeId,
                    'tenant_id' => $tenantId,
                    'message' => $message,
                    'link' => $path,
                    'type' => 'event_update',
                    'created_at' => now(),
                ]);

                // Send email notification — switch Laravel locale to the recipient's
                // preferred_language so subject + body render in THEIR language, not
                // the caller's. Every nested __() call inside sendEventEmail and its
                // HTML builder picks up the switched locale.
                try {
                    LocaleContext::withLocale($attendee, function () use ($attendee, $eventTitle, $message, $path) {
                        $this->sendEventEmail(
                            $attendee,
                            __('emails.events.update_subject', ['title' => $eventTitle]),
                            $message,
                            $path,
                            'event_update'
                        );
                    });
                } catch (\Throwable $e) {
                    Log::warning("[EventNotificationService] Email failed for user {$attendeeId}: " . $e->getMessage());
                }

                $count++;
            }

            return $count;
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error("EventNotificationService::notifyAttendees error: " . $e->getMessage());
            return 0;
        }
    }

    /**
     * Send event reminder to attendees who haven't been reminded yet.
     *
     * Processes both 24h and 1h reminder types for a specific event.
     * Uses the event_reminder_sent table for idempotency.
     *
     * @return int Number of reminders sent
     */
    public function sendReminder(int $tenantId, int $eventId): int
    {
        return app(EventReminderService::class)->sendEventReminders($tenantId, $eventId);
    }

    /**
     * Notify attendees and waitlisted users of event cancellation.
     *
     * @param array<int> $recipientUserIds
     * @return int Number of notifications sent
     */
    public function notifyCancellation(int $tenantId, int $eventId, ?string $reason = null, array $recipientUserIds = [], ?object $eventSnapshot = null): int
    {
        try {
            // Series DELETE removes the event rows before notifying, so the caller
            // passes a pre-deletion snapshot (including timezone) — the
            // DB lookup below would find nothing post-delete.
            $event = $eventSnapshot ?? DB::table('events')
                ->where('id', $eventId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'title', 'start_time', 'location', 'timezone'])
                ->first();

            if (!$event) {
                return 0;
            }

            $recipientUserIds = collect($recipientUserIds)
                ->map(fn ($id) => (int) $id)
                ->filter(fn (int $id) => $id > 0)
                ->unique()
                ->values()
                ->all();

            if ($recipientUserIds !== []) {
                $allUsers = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $recipientUserIds)
                    ->select(['id as user_id', 'tenant_id', 'email', 'name', 'first_name', 'preferred_language'])
                    ->get()
                    ->keyBy('user_id');
            } else {
                // Get all RSVP users (going, interested, invited) with email info
                $rsvpUsers = DB::table('event_rsvps as r')
                    ->join('users as u', function ($join) use ($tenantId) {
                        $join->on('r.user_id', '=', 'u.id')
                            ->where('u.tenant_id', '=', $tenantId);
                    })
                    ->where('r.event_id', $eventId)
                    ->where('r.tenant_id', $tenantId)
                    ->whereIn('r.status', ['going', 'interested', 'invited'])
                    ->select(['r.user_id', 'u.email', 'u.name', 'u.first_name', 'u.preferred_language'])
                    ->distinct()
                    ->get()
                    ->keyBy('user_id');

                // Get waitlisted users with email info
                $waitlistedUsers = DB::table('event_waitlist as w')
                    ->join('users as u', function ($join) use ($tenantId) {
                        $join->on('w.user_id', '=', 'u.id')
                            ->where('u.tenant_id', '=', $tenantId);
                    })
                    ->where('w.event_id', $eventId)
                    ->where('w.tenant_id', $tenantId)
                    ->where('w.status', 'waiting')
                    ->select(['w.user_id', 'u.email', 'u.name', 'u.first_name', 'u.preferred_language'])
                    ->distinct()
                    ->get()
                    ->keyBy('user_id');

                // Merge all users (RSVP + waitlisted), deduplicated by user_id
                $allUsers = $rsvpUsers->union($waitlistedUsers);
            }

            if ($allUsers->isEmpty()) {
                return 0;
            }

            $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
            $path = '/events/' . $eventId;
            $count = 0;

            foreach ($allUsers as $uid => $user) {
                try {
                    // Render bell message + email subject/body under the recipient's
                    // preferred_language so every nested __() resolves in THEIR locale.
                    LocaleContext::withLocale($user, function () use ($user, $uid, $tenantId, $event, $eventTitle, $reason, $path) {
                        $message = __('notifications.event_cancelled', ['title' => $event->title]);
                        if (!empty($reason)) {
                            $message .= ' ' . __('notifications.event_cancelled_reason', ['reason' => $reason]);
                        }

                        Notification::create([
                            'user_id' => (int) $uid,
                            'tenant_id' => $tenantId,
                            'message' => $message,
                            'link' => $path,
                            'type' => 'event',
                            'created_at' => now(),
                        ]);

                        // Send cancellation email
                        try {
                            $this->sendEventEmail(
                                $user,
                                __('emails.events.cancelled_subject', ['title' => $eventTitle]),
                                $message,
                                $path,
                                'event_cancellation',
                                $this->buildCancellationEmailHtml($event, $reason, $user)
                            );
                        } catch (\Throwable $e) {
                            Log::warning("[EventNotificationService] Cancellation email failed for user {$uid}: " . $e->getMessage());
                        }
                    });

                    $count++;
                } catch (\Throwable $e) {
                    Log::warning("Failed to notify user {$uid} of event cancellation: " . $e->getMessage());
                }
            }

            return $count;
        } catch (\Throwable $e) {
            Log::error("EventNotificationService::notifyCancellation error: " . $e->getMessage());
            return 0;
        }
    }

    /**
     * Notify attendees that an event has been updated.
     *
     * Only notifies for attendee-relevant schedule, venue, access and capacity changes.
     * Creates in-app notifications for each attendee.
     */
    public function notifyEventUpdated(int $eventId, array $changes): void
    {
        try {
            $meaningfulKeys = [
                'start_time',
                'end_time',
                'timezone',
                'all_day',
                'location',
                'title',
                'is_online',
                'online_link',
                'allow_remote_attendance',
                'max_attendees',
                'venue_accessibility',
            ];
            $meaningfulChanges = array_intersect_key($changes, array_flip($meaningfulKeys));
            if (empty($meaningfulChanges)) {
                return;
            }

            $tenantId = TenantContext::getId();

            $event = DB::table('events')
                ->where('id', $eventId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'title', 'start_time', 'end_time', 'location', 'timezone', 'user_id'])
                ->first();

            if (!$event) {
                return;
            }

            // Get all attendees (going + interested) with email info
            $attendees = DB::table('event_rsvps as r')
                ->join('users as u', function ($join) use ($tenantId) {
                    $join->on('r.user_id', '=', 'u.id')
                        ->where('u.tenant_id', '=', $tenantId);
                })
                ->where('r.event_id', $eventId)
                ->where('r.tenant_id', $tenantId)
                ->whereIn('r.status', ['going', 'interested'])
                ->select(['r.user_id', 'u.email', 'u.name', 'u.first_name', 'u.preferred_language'])
                ->distinct()
                ->get();

            if ($attendees->isEmpty()) {
                return;
            }

            $eventTitle = $event->title;
            $path = '/events/' . $eventId;
            $organizerId = (int) $event->user_id;
            $safeTitle = htmlspecialchars($eventTitle, ENT_QUOTES, 'UTF-8');

            foreach ($attendees as $attendee) {
                $attendeeId = (int) $attendee->user_id;
                if ($attendeeId === $organizerId) {
                    continue;
                }

                // Each recipient gets their own locale wrap so the change summary,
                // bell message, and email subject all render in their language.
                LocaleContext::withLocale($attendee, function () use ($attendee, $attendeeId, $tenantId, $event, $eventTitle, $safeTitle, $path, $meaningfulChanges) {
                    // Build change summary (localised per recipient)
                    $changeParts = [];
                    if (array_key_exists('start_time', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.time');
                    }
                    if (array_key_exists('end_time', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.time');
                    }
                    if (array_key_exists('timezone', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.timezone');
                    }
                    if (array_key_exists('all_day', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.all_day');
                    }
                    if (array_key_exists('location', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.venue');
                    }
                    if (array_key_exists('title', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.title');
                    }
                    if (array_key_exists('is_online', $meaningfulChanges)
                        || array_key_exists('online_link', $meaningfulChanges)
                        || array_key_exists('allow_remote_attendance', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.online_access');
                    }
                    if (array_key_exists('max_attendees', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.capacity');
                    }
                    if (array_key_exists('venue_accessibility', $meaningfulChanges)) {
                        $changeParts[] = __('event_notifications.update.fields.accessibility');
                    }
                    $changeParts = array_values(array_unique($changeParts));
                    $changeLabel = implode(__('event_notifications.update.separator'), $changeParts);
                    $message = __('notifications.event_updated', ['title' => $eventTitle, 'changes' => $changeLabel]);

                    Notification::create([
                        'user_id' => $attendeeId,
                        'tenant_id' => $tenantId,
                        'message' => $message,
                        'link' => $path,
                        'type' => 'event_update',
                        'created_at' => now(),
                    ]);

                    // Send update email
                    try {
                        $this->sendEventEmail(
                            $attendee,
                            __('emails.events.updated_subject', ['title' => $safeTitle, 'changes' => $changeLabel]),
                            $message,
                            $path,
                            'event_update',
                            $this->buildUpdateEmailHtml($event, $meaningfulChanges, $attendee)
                        );
                    } catch (\Throwable $e) {
                        Log::warning("[EventNotificationService] Update email failed for user {$attendeeId}: " . $e->getMessage());
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::error("EventNotificationService::notifyEventUpdated error: " . $e->getMessage());
        }
    }

    /**
     * Notify event organizer when someone RSVPs.
     */
    public function notifyRsvp(int $eventId, int $userId, string $status): void
    {
        try {
            if (!in_array($status, ['going', 'interested'])) {
                return;
            }

            $tenantId = TenantContext::getId();

            $event = DB::table('events')
                ->where('id', $eventId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'title', 'user_id', 'start_time', 'location'])
                ->first();

            if (!$event || (int) $event->user_id === $userId) {
                return;
            }

            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language'])
                ->first();

            if (!$user) {
                return;
            }

            $userName = $user->name ?? UserDisplayName::resolve($user);
            $eventTitle = $event->title;
            $organizerId = (int) $event->user_id;
            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed($userId, $organizerId, $tenantId, 'event_rsvp');
            $policy->assertLocalContactAllowed($organizerId, $userId, $tenantId, 'event_rsvp');
            $path = '/events/' . $eventId;

            // Fetch organizer up-front so we have preferred_language available for
            // the bell + email wraps.
            $organizer = DB::table('users')
                ->where('id', $organizerId)
                ->where('tenant_id', $tenantId)
                ->select(['id as user_id', 'tenant_id', 'email', 'name', 'first_name', 'preferred_language'])
                ->first();

            // Organizer bell + email — rendered in the organizer's locale.
            if ($organizer) {
                LocaleContext::withLocale($organizer, function () use ($organizer, $organizerId, $tenantId, $status, $userName, $eventTitle, $event, $user, $path) {
                    $statusLabel = $status === 'going'
                        ? __('emails.events.rsvp_status_going')
                        : __('emails.events.rsvp_status_interested');

                    $message = $status === 'going'
                        ? __('notifications.event_rsvp_going', ['name' => $userName, 'title' => $eventTitle])
                        : __('notifications.event_rsvp_interested', ['name' => $userName, 'title' => $eventTitle]);

                    Notification::create([
                        'user_id' => $organizerId,
                        'tenant_id' => $tenantId,
                        'message' => $message,
                        'link' => $path,
                        'type' => 'event_rsvp',
                        'created_at' => now(),
                    ]);

                    // Send email to organizer about the RSVP
                    try {
                        $safeTitle = htmlspecialchars($eventTitle, ENT_QUOTES, 'UTF-8');
                        $safeUserName = htmlspecialchars($userName, ENT_QUOTES, 'UTF-8');

                        $this->sendEventEmail(
                            $organizer,
                            __('emails.events.rsvp_subject', ['name' => $safeUserName, 'status_label' => $statusLabel, 'title' => $safeTitle]),
                            $message,
                            $path,
                            'event_rsvp',
                            $this->buildRsvpEmailHtml($event, $user, $status, $organizer)
                        );
                    } catch (\Throwable $e) {
                        Log::warning("[EventNotificationService] RSVP email failed for organizer {$organizerId}: " . $e->getMessage());
                    }
                });
            }

            // Confirm the RSVP to the person who RSVPed — rendered in THEIR locale.
            try {
                LocaleContext::withLocale($user, function () use ($userId, $tenantId, $status, $eventTitle, $path) {
                    $selfBell = $status === 'going'
                        ? __('svc_notifications_2.event.rsvp_confirmed_going', ['title' => $eventTitle])
                        : __('svc_notifications_2.event.rsvp_confirmed_interested', ['title' => $eventTitle]);

                    Notification::create([
                        'user_id'    => $userId,
                        'tenant_id'  => $tenantId,
                        'message'    => $selfBell,
                        'link'       => $path,
                        'type'       => 'event_rsvp_confirm',
                        'created_at' => now(),
                    ]);
                });
            } catch (\Throwable $e) {
                Log::warning("[EventNotificationService] RSVP self-confirmation bell failed for user {$userId}: " . $e->getMessage());
            }
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error("EventNotificationService::notifyRsvp error: " . $e->getMessage());
        }
    }

    /**
     * Notify the event organizer that their event has been published.
     *
     * Sends a confirmation email (theme: success) to the organizer with the
     * event title, date, and location/online URL. Also dispatches an in-app
     * bell notification. Optionally notifies any initial attendees (e.g. users
     * who RSVPed immediately during creation) by delegating to notifyAttendees().
     *
     * @param int  $tenantId    Tenant the event belongs to
     * @param int  $eventId     ID of the newly created event
     * @param int  $organizerId User ID of the event creator/organizer
     * @param bool $notifyInitialAttendees  Pass true to also notify existing RSVPs
     */
    public function notifyEventCreated(int $tenantId, int $eventId, int $organizerId, bool $notifyInitialAttendees = false): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($tenantId);

            if (!EventNotificationPreferenceResolver::allowsBackgroundActivity($tenantId, 'event_created')) {
                return;
            }

            $event = DB::table('events')
                ->where('id', $eventId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'title', 'start_time', 'end_time', 'location', 'timezone', 'is_online', 'online_link'])
                ->first();

            if (!$event) {
                Log::error("[EventNotificationService] notifyEventCreated: event {$eventId} not found for tenant {$tenantId}");
                return;
            }

            $organizer = DB::table('users')
                ->where('id', $organizerId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->select(['id as user_id', 'tenant_id', 'email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if (!$organizer) {
                Log::error("[EventNotificationService] notifyEventCreated: organizer {$organizerId} not found for tenant {$tenantId}");
                return;
            }

            $eventTitle = $event->title;
            $path = '/events/' . $eventId;

            // Render bell + email under the organizer's locale so confirmation text
            // matches their preferred_language.
            LocaleContext::withLocale($organizer, function () use ($organizer, $organizerId, $tenantId, $event, $eventTitle, $path) {
                $bellMessage = __('notifications.event_created_confirmation', ['title' => $eventTitle]);

                // In-app bell notification for the organizer
                Notification::create([
                    'user_id'    => $organizerId,
                    'tenant_id'  => $tenantId,
                    'message'    => $bellMessage,
                    'link'       => $path,
                    'type'       => 'event_created',
                    'created_at' => now(),
                ]);

                // Email notification to organizer
                try {
                    $subject = __('emails_misc.events.created_subject');

                    $this->sendEventEmail(
                        $organizer,
                        $subject,
                        $bellMessage,
                        $path,
                        'event_created',
                        $this->buildEventCreatedEmailHtml($event, $organizer)
                    );
                } catch (\Throwable $e) {
                    Log::warning("[EventNotificationService] notifyEventCreated email failed for organizer {$organizerId}: " . $e->getMessage());
                }
            });

            // Render every attendee's confirmation independently. The caller's
            // locale must never leak into stored bell copy, email subjects, or
            // the default HTML email body.
            if ($notifyInitialAttendees) {
                $this->notifyInitialAttendeesOfCreation(
                    $tenantId,
                    $eventId,
                    $organizerId,
                    $eventTitle,
                    $path,
                );
            }
        } catch (\Throwable $e) {
            Log::error("EventNotificationService::notifyEventCreated error: " . $e->getMessage());
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * Notify RSVPs that already exist when publication completes.
     *
     * This intentionally does not delegate to notifyAttendees(): that method
     * accepts organizer-authored copy, while this system confirmation must be
     * translated separately for every recipient.
     */
    private function notifyInitialAttendeesOfCreation(
        int $tenantId,
        int $eventId,
        int $organizerId,
        string $eventTitle,
        string $path,
    ): void {
        $attendees = DB::table('event_rsvps as r')
            ->join('users as u', function ($join) use ($tenantId): void {
                $join->on('r.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('r.event_id', $eventId)
            ->where('r.tenant_id', $tenantId)
            ->whereIn('r.status', ['going', 'interested'])
            ->where('u.status', 'active')
            ->whereNull('u.deleted_at')
            ->where('u.id', '<>', $organizerId)
            ->select([
                'r.user_id',
                'u.tenant_id',
                'u.email',
                'u.name',
                'u.first_name',
                'u.preferred_language',
            ])
            ->distinct()
            ->get();

        foreach ($attendees as $attendee) {
            $attendeeId = (int) $attendee->user_id;

            try {
                LocaleContext::withLocale($attendee, function () use (
                    $attendee,
                    $attendeeId,
                    $tenantId,
                    $eventTitle,
                    $path,
                ): void {
                    $message = __('notifications.event_attendee_confirmation', [
                        'title' => $eventTitle,
                    ]);

                    Notification::create([
                        'user_id' => $attendeeId,
                        'tenant_id' => $tenantId,
                        'message' => $message,
                        'link' => $path,
                        'type' => 'event_created',
                        'created_at' => now(),
                    ]);

                    $this->sendEventEmail(
                        $attendee,
                        $message,
                        $message,
                        $path,
                        'event_created',
                    );
                });
            } catch (\Throwable $e) {
                Log::warning('[EventNotificationService] Initial attendee confirmation failed', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $attendeeId,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    // =========================================================================
    // EMAIL SENDING
    // =========================================================================

    /**
     * Send an event-related email to a user.
     *
     * Respects the user's notification frequency setting. If the user has email
     * notifications set to 'off', no email is sent. For 'instant', the email is
     * sent immediately. For 'daily'/'monthly', it is queued.
     *
     * @param object $user     User object with email, name, first_name, user_id
     * @param string $subject  Email subject line
     * @param string $content  Plain text content (fallback)
     * @param string $link     Relative link to the event
     * @param string $type     Notification type for queue classification
     * @param string|null $htmlBody  Rich HTML email body (optional)
     */
    private function sendEventEmail(object $user, string $subject, string $content, string $link, string $type, ?string $htmlBody = null): bool
    {
        $userId = (int) ($user->user_id ?? 0);
        if ($userId <= 0) {
            return false;
        }

        $tenantId = $this->resolveRecipientTenantId($user);
        if ($tenantId === null) {
            Log::warning('[EventNotificationService] Could not resolve recipient tenant for email', [
                'user_id' => $userId,
                'type' => $type,
            ]);
            return false;
        }

        return (bool) TenantContext::runForTenant($tenantId, function () use ($user, $subject, $content, $link, $type, $htmlBody, $userId, $tenantId): bool {
            if (!EventNotificationPreferenceResolver::isRecipientEligible($userId, $tenantId)
                || !EventNotificationPreferenceResolver::allowsBackgroundActivity($tenantId, $type)) {
                return true;
            }

            // Web push is an independent channel. An Events email opt-out or
            // digest cadence must never disable a user's push preference.
            try {
                WebPushService::sendToUserStatic($userId, $subject, $content, $link, $type);
            } catch (\Throwable $e) {
                Log::debug("[EventNotificationService] WebPush failed: " . $e->getMessage());
            }

            if (empty($user->email)) {
                return true;
            }

            $frequency = EventNotificationPreferenceResolver::frequency($userId, $tenantId);

            if ($frequency === 'off') {
                return true;
            }

            if ($frequency === 'instant') {
                // Send immediately
                try {
                    $body = $htmlBody ?? $this->buildDefaultEventEmailHtml($subject, $content, $link, $user);
                    $unsubscribeUrl = EventNotificationPreferenceResolver::unsubscribeUrl($userId, $tenantId);
                    $sent = EmailDispatchService::sendRaw($user->email, $subject, $body, null, null, $unsubscribeUrl, $type, ['tenant_id' => $tenantId]);
                    if (!$sent) {
                        Log::warning("[EventNotificationService] Instant email send returned false", [
                            'user_id' => $userId,
                            'tenant_id' => $tenantId,
                            'type'    => $type,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::warning("[EventNotificationService] Instant email send failed: " . $e->getMessage());
                    $sent = false;
                }

                return (bool) $sent;
            }

            // Queue for daily/monthly digest
            try {
                DB::table('notification_queue')->insert([
                    'tenant_id'       => $tenantId,
                    'user_id'         => $userId,
                    'activity_type'   => $type,
                    'content_snippet' => substr($content, 0, 250),
                    'link'            => $link,
                    'frequency'       => $frequency,
                    'email_body'      => $htmlBody,
                    'created_at'      => now(),
                    'status'          => 'pending',
                ]);
                return true;
            } catch (\Throwable $e) {
                Log::warning("[EventNotificationService] Email queue insert failed: " . $e->getMessage());
                return false;
            }
        });
    }

    private function resolveRecipientTenantId(object $user): ?int
    {
        if (!empty($user->tenant_id)) {
            return (int) $user->tenant_id;
        }

        $contextTenantId = TenantContext::currentId();
        $userId = (int) ($user->user_id ?? $user->id ?? 0);
        if ($userId <= 0) {
            return $contextTenantId !== null ? (int) $contextTenantId : null;
        }

        try {
            $tenantId = DB::table('users')->where('id', $userId)->value('tenant_id');
            if ($tenantId !== null) {
                return (int) $tenantId;
            }
        } catch (\Throwable $e) {
            Log::warning('[EventNotificationService] Recipient tenant lookup failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        return $contextTenantId !== null ? (int) $contextTenantId : null;
    }

    // =========================================================================
    // REMINDER NOTIFICATION (in-app)
    // =========================================================================

    /**
     * Build the event reminder text shared by the bell and email.
     */
    private function buildReminderMessage(object $event, string $reminderType): string
    {
        $title = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
        $when = $this->formatEventDateTime(
            $event->start_time,
            eventTimezone: $event->timezone ?? null,
        );

        $locationText = '';
        if (!empty($event->is_online) && !empty($event->online_link)) {
            $locationText = ' ' . __('notifications.event_reminder_location_online');
        } elseif (!empty($event->location)) {
            $loc = htmlspecialchars($event->location, ENT_QUOTES, 'UTF-8');
            $locationText = ' ' . __('notifications.event_reminder_location_at', ['location' => $loc]);
        }

        if ($reminderType === '24h') {
            $message = __('notifications.event_reminder_24h', ['title' => $title, 'when' => $when, 'location' => $locationText]);
        } else {
            $message = __('notifications.event_reminder_1h', ['title' => $title, 'when' => $when, 'location' => $locationText]);
        }

        return $message;
    }

    /**
     * Format an event date/time for user-facing text in the active locale.
     *
     * PHP's date() always renders English weekday/month names; Carbon's
     * isoFormat honours the locale switched in by LocaleContext, so reminder,
     * cancellation, update, and created emails render dates in the
     * recipient's preferred_language.
     *
     * The default pattern must stay a LOCALISED token ('llll', 'LL', …) rather
     * than a literal field order like 'dddd, MMM D': a literal order is the same
     * in every language, so it silently imposed American month-before-day on
     * Irish and UK recipients no matter which locale was switched in.
     *
     * Event timestamps are stored as UTC and
     * converted to the event's validated IANA timezone; legacy or invalid
     * timezone values fail safe to UTC. The explicit zone label prevents an
     * ambiguous local time from being sent to attendees.
     */
    private function formatEventDateTime(
        string $dateTime,
        string $isoFormat = 'llll',
        ?string $eventTimezone = null,
    ): string
    {
        $timezone = trim((string) $eventTimezone);
        if (!$this->isIanaTimezone($timezone)) {
            $timezone = 'UTC';
        }

        return \Carbon\Carbon::parse($dateTime, 'UTC')
            ->setTimezone($timezone)
            ->locale(\App\I18n\FormattingLocale::carbon())
            ->isoFormat($isoFormat)
            . ' (' . $timezone . ')';
    }

    private function isIanaTimezone(string $timezone): bool
    {
        if ($timezone === 'UTC') {
            return true;
        }

        static $identifiers = null;
        $identifiers ??= array_fill_keys(
            \DateTimeZone::listIdentifiers(\DateTimeZone::ALL_WITH_BC),
            true,
        );

        return isset($identifiers[$timezone]);
    }

    /**
     * Create an in-app reminder notification after the email path is accepted.
     */
    private function createReminderNotification(int $tenantId, int $userId, object $event, string $message): void
    {
        $link = "/events/{$event->id}";

        Notification::create([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'message' => $message,
            'link' => $link,
            'type' => 'event_reminder',
            'created_at' => now(),
        ]);
    }

    // =========================================================================
    // HTML EMAIL BUILDERS
    // =========================================================================

    /**
     * Build a default event email when no specific template is provided.
     */
    private function buildDefaultEventEmailHtml(string $subject, string $content, string $link, object $user): string
    {
        $recipientName = htmlspecialchars($user->first_name ?? $user->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $safeSubject = htmlspecialchars($subject, ENT_QUOTES, 'UTF-8');
        $safeContent = htmlspecialchars($content, ENT_QUOTES, 'UTF-8');
        $tenantName = htmlspecialchars(TenantContext::getSetting('site_name', 'Project NEXUS'), ENT_QUOTES, 'UTF-8');
        $baseUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $fullUrl = $baseUrl . $basePath . $link;
        $greeting = htmlspecialchars(__('emails.common.greeting', ['name' => $recipientName]), ENT_QUOTES, 'UTF-8');
        $viewEventLabel = htmlspecialchars(__('emails.events.view_event'), ENT_QUOTES, 'UTF-8');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">{$safeSubject}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$greeting}</p>
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$safeContent}</p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$fullUrl}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$viewEventLabel}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build rich HTML email for RSVP notification (sent to organizer).
     */
    private function buildRsvpEmailHtml(object $event, object $rsvpUser, string $status, object $organizer): string
    {
        $organizerName = htmlspecialchars($organizer->first_name ?? $organizer->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $rsvpUserName = htmlspecialchars($rsvpUser->name ?? UserDisplayName::resolve($rsvpUser), ENT_QUOTES, 'UTF-8');
        $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
        $statusLabel = $status === 'going'
            ? __('emails.events.rsvp_status_going')
            : __('emails.events.rsvp_status_interested');
        $statusColor = $status === 'going' ? '#10b981' : '#f59e0b';
        $statusBadge = $status === 'going'
            ? __('emails.events.rsvp_badge_going')
            : __('emails.events.rsvp_badge_interested');
        $tenantName = htmlspecialchars(TenantContext::getSetting('site_name', 'Project NEXUS'), ENT_QUOTES, 'UTF-8');
        $baseUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $eventUrl = $baseUrl . $basePath . '/events/' . $event->id;
        $greeting = htmlspecialchars(__('emails.common.greeting', ['name' => $organizerName]), ENT_QUOTES, 'UTF-8');
        $rsvpHeading = htmlspecialchars(__('emails.events.new_rsvp_heading'), ENT_QUOTES, 'UTF-8');
        $rsvpBody = __('emails.events.rsvp_body', ['name' => $rsvpUserName, 'status_label' => $statusLabel]);
        $viewEventLabel = htmlspecialchars(__('emails.events.view_event'), ENT_QUOTES, 'UTF-8');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">{$rsvpHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$greeting}</p>
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">
            {$rsvpBody}
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <h2 style="color: #1e293b; margin: 0 0 8px; font-size: 18px;">{$eventTitle}</h2>
            <span style="display: inline-block; background: {$statusColor}; color: white; padding: 4px 12px; border-radius: 16px; font-size: 13px; font-weight: 600;">{$statusBadge}</span>
        </div>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$eventUrl}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$viewEventLabel}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build rich HTML email for event cancellation.
     */
    private function buildCancellationEmailHtml(object $event, ?string $reason, object $user): string
    {
        $recipientName = htmlspecialchars($user->first_name ?? $user->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
        $tenantName = htmlspecialchars(TenantContext::getSetting('site_name', 'Project NEXUS'), ENT_QUOTES, 'UTF-8');
        $baseUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $eventsUrl = $baseUrl . $basePath . '/events';

        $reasonLabel = htmlspecialchars(__('emails.events.cancelled_reason_label'), ENT_QUOTES, 'UTF-8');
        $reasonHtml = '';
        if (!empty($reason)) {
            $safeReason = htmlspecialchars($reason, ENT_QUOTES, 'UTF-8');
            $reasonHtml = <<<HTML
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
            <p style="color: #991b1b; margin: 0; font-size: 14px;"><strong>{$reasonLabel}</strong> {$safeReason}</p>
        </div>
HTML;
        }

        $dateHtml = '';
        if (!empty($event->start_time)) {
            $when = $this->formatEventDateTime(
                $event->start_time,
                eventTimezone: $event->timezone ?? null,
            );
            $scheduledFor = htmlspecialchars(__('emails.events.cancelled_scheduled_for', ['when' => $when]), ENT_QUOTES, 'UTF-8');
            $dateHtml = "<p style=\"color: #64748b; margin: 4px 0 0; font-size: 14px;\">{$scheduledFor}</p>";
        }

        $cancelledHeading = htmlspecialchars(__('emails.events.cancelled_heading'), ENT_QUOTES, 'UTF-8');
        $greeting = htmlspecialchars(__('emails.common.greeting', ['name' => $recipientName]), ENT_QUOTES, 'UTF-8');
        $cancelledBody = htmlspecialchars(__('emails.events.cancelled_body'), ENT_QUOTES, 'UTF-8');
        $browseEventsLabel = htmlspecialchars(__('emails.events.browse_events'), ENT_QUOTES, 'UTF-8');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #ef4444; background-image: linear-gradient(135deg, #ef4444, #dc2626); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">{$cancelledHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$greeting}</p>
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$cancelledBody}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <h2 style="color: #1e293b; margin: 0 0 4px; font-size: 18px;">{$eventTitle}</h2>
            {$dateHtml}
        </div>
        {$reasonHtml}
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$eventsUrl}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$browseEventsLabel}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build rich HTML email for event update notification.
     */
    private function buildUpdateEmailHtml(object $event, array $changes, object $user): string
    {
        $recipientName = htmlspecialchars($user->first_name ?? $user->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
        $tenantName = htmlspecialchars(TenantContext::getSetting('site_name', 'Project NEXUS'), ENT_QUOTES, 'UTF-8');
        $baseUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $eventUrl = $baseUrl . $basePath . '/events/' . $event->id;

        $dateTimeLabel = htmlspecialchars(__('emails.events.change_label_date_time'), ENT_QUOTES, 'UTF-8');
        $endTimeLabel = htmlspecialchars(__('emails.events.change_label_end_time'), ENT_QUOTES, 'UTF-8');
        $locationLabel = htmlspecialchars(__('emails.events.change_label_location'), ENT_QUOTES, 'UTF-8');
        $titleLabel = htmlspecialchars(__('emails.events.change_label_title'), ENT_QUOTES, 'UTF-8');
        $timezoneLabel = htmlspecialchars(__('event_notifications.update.fields.timezone'), ENT_QUOTES, 'UTF-8');
        $allDayLabel = htmlspecialchars(__('event_notifications.update.fields.all_day'), ENT_QUOTES, 'UTF-8');
        $onlineAccessLabel = htmlspecialchars(__('event_notifications.update.fields.online_access'), ENT_QUOTES, 'UTF-8');
        $capacityLabel = htmlspecialchars(__('event_notifications.update.fields.capacity'), ENT_QUOTES, 'UTF-8');
        $accessibilityLabel = htmlspecialchars(__('event_notifications.update.fields.accessibility'), ENT_QUOTES, 'UTF-8');

        $changesHtml = '';
        if (array_key_exists('start_time', $changes)) {
            $newTime = $this->formatEventDateTime(
                $changes['start_time'],
                eventTimezone: $event->timezone ?? null,
            );
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$dateTimeLabel}</strong> {$newTime}</li>";
        }
        if (array_key_exists('end_time', $changes)) {
            $newEndTime = $this->formatEventDateTime(
                $changes['end_time'],
                eventTimezone: $event->timezone ?? null,
            );
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$endTimeLabel}</strong> {$newEndTime}</li>";
        }
        if (array_key_exists('location', $changes)) {
            $newLocation = htmlspecialchars((string) ($changes['location'] ?? ''), ENT_QUOTES, 'UTF-8');
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$locationLabel}</strong> {$newLocation}</li>";
        }
        if (array_key_exists('title', $changes)) {
            $newTitle = htmlspecialchars($changes['title'], ENT_QUOTES, 'UTF-8');
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$titleLabel}</strong> {$newTitle}</li>";
        }
        if (array_key_exists('timezone', $changes)) {
            $newTimezone = htmlspecialchars((string) $changes['timezone'], ENT_QUOTES, 'UTF-8');
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$timezoneLabel}</strong> {$newTimezone}</li>";
        }
        if (array_key_exists('all_day', $changes)) {
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$allDayLabel}</strong></li>";
        }
        if (array_key_exists('is_online', $changes)
            || array_key_exists('online_link', $changes)
            || array_key_exists('allow_remote_attendance', $changes)) {
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$onlineAccessLabel}</strong></li>";
        }
        if (array_key_exists('max_attendees', $changes)) {
            $newCapacity = $changes['max_attendees'] === null
                ? ''
                : ' ' . htmlspecialchars((string) $changes['max_attendees'], ENT_QUOTES, 'UTF-8');
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$capacityLabel}</strong>{$newCapacity}</li>";
        }
        if (array_key_exists('venue_accessibility', $changes)) {
            $changesHtml .= "<li style=\"color: #1e293b; margin-bottom: 8px;\"><strong>{$accessibilityLabel}</strong></li>";
        }

        $updatedHeading = htmlspecialchars(__('emails.events.updated_heading'), ENT_QUOTES, 'UTF-8');
        $greeting = htmlspecialchars(__('emails.common.greeting', ['name' => $recipientName]), ENT_QUOTES, 'UTF-8');
        $updatedBody = __('emails.events.updated_body', ['title' => $eventTitle]);
        $viewUpdatedLabel = htmlspecialchars(__('emails.events.view_updated_event'), ENT_QUOTES, 'UTF-8');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #f59e0b; background-image: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">{$updatedHeading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$greeting}</p>
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$updatedBody}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <ul style="padding-left: 20px; margin: 0;">{$changesHtml}</ul>
        </div>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$eventUrl}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$viewUpdatedLabel}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build rich HTML email for event created confirmation (sent to organizer).
     *
     * Uses a green success gradient to signal a positive confirmation.
     * Displays event title, date/time, and location or online indicator.
     */
    private function buildEventCreatedEmailHtml(object $event, object $organizer): string
    {
        $organizerName = htmlspecialchars($organizer->first_name ?? $organizer->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
        $tenantName = htmlspecialchars(TenantContext::getSetting('site_name', 'Project NEXUS'), ENT_QUOTES, 'UTF-8');
        $baseUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $eventUrl = $baseUrl . $basePath . '/events/' . $event->id;

        $heading = htmlspecialchars(__('emails_misc.events.created_heading'), ENT_QUOTES, 'UTF-8');
        $greeting = htmlspecialchars(__('emails_misc.events.created_greeting', ['name' => $organizerName]), ENT_QUOTES, 'UTF-8');
        $body = __('emails_misc.events.created_body', ['title' => $eventTitle]);
        $detailsLabel = htmlspecialchars(__('emails_misc.events.created_details_label'), ENT_QUOTES, 'UTF-8');
        $ctaLabel = htmlspecialchars(__('emails_misc.events.created_cta'), ENT_QUOTES, 'UTF-8');

        // Date/time row
        $dateHtml = '';
        if (!empty($event->start_time)) {
            $when = $this->formatEventDateTime(
                $event->start_time,
                'LLLL',
                $event->timezone ?? null,
            );
            $safeWhen = htmlspecialchars($when, ENT_QUOTES, 'UTF-8');
            $dateHtml = "<p style=\"color: #64748b; margin: 0 0 6px; font-size: 14px;\">&#128197; {$safeWhen}</p>";
        }

        // Location row
        $locationHtml = '';
        if (!empty($event->is_online) && !empty($event->online_link)) {
            $onlineLabel = htmlspecialchars(__('emails.events.online_event'), ENT_QUOTES, 'UTF-8');
            $locationHtml = "<p style=\"color: #6366f1; margin: 0; font-size: 14px;\">&#127760; {$onlineLabel}</p>";
        } elseif (!empty($event->location)) {
            $safeLoc = htmlspecialchars($event->location, ENT_QUOTES, 'UTF-8');
            $locationHtml = "<p style=\"color: #64748b; margin: 0; font-size: 14px;\">&#128205; {$safeLoc}</p>";
        }

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #10b981; background-image: linear-gradient(135deg, #10b981, #059669); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$greeting}</p>
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$body}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">{$detailsLabel}</p>
            <h2 style="color: #1e293b; margin: 0 0 10px; font-size: 18px; font-weight: 700;">{$eventTitle}</h2>
            {$dateHtml}
            {$locationHtml}
        </div>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$eventUrl}" style="display: inline-block; background-color: #10b981; background-image: linear-gradient(135deg, #10b981, #059669); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$ctaLabel}</a>
        </div>
    </div>
</div>
HTML;
    }

    /**
     * Build rich HTML email for event reminder.
     */
    private function buildReminderEmailHtml(object $event, string $reminderType, object $user): string
    {
        $recipientName = htmlspecialchars($user->first_name ?? $user->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
        $eventTitle = htmlspecialchars($event->title, ENT_QUOTES, 'UTF-8');
        $tenantName = htmlspecialchars(TenantContext::getSetting('site_name', 'Project NEXUS'), ENT_QUOTES, 'UTF-8');
        $baseUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $eventUrl = $baseUrl . $basePath . '/events/' . $event->id;

        $when = $this->formatEventDateTime(
            $event->start_time,
            eventTimezone: $event->timezone ?? null,
        );
        $heading = $reminderType === '24h'
            ? htmlspecialchars(__('emails.events.reminder_heading_24h'), ENT_QUOTES, 'UTF-8')
            : htmlspecialchars(__('emails.events.reminder_heading_1h'), ENT_QUOTES, 'UTF-8');
        $gradientColors = $reminderType === '24h' ? '#6366f1, #8b5cf6' : '#f59e0b, #ef4444';
        // Solid fallback for clients that strip gradients (Outlook) — the heading
        // over this header is white. See App\Core\EmailBackground.
        $gradientSolid = $reminderType === '24h' ? '#6366f1' : '#f59e0b';
        $timeNote = $reminderType === '24h'
            ? __('emails.events.reminder_time_note_24h')
            : __('emails.events.reminder_time_note_1h');

        $onlineEventLabel = htmlspecialchars(__('emails.events.online_event'), ENT_QUOTES, 'UTF-8');
        $locationHtml = '';
        if (!empty($event->is_online) && !empty($event->online_link)) {
            $locationHtml = "<p style=\"color: #6366f1; margin: 4px 0 0; font-size: 14px;\">{$onlineEventLabel}</p>";
        } elseif (!empty($event->location)) {
            $loc = htmlspecialchars($event->location, ENT_QUOTES, 'UTF-8');
            $locationLabelHtml = htmlspecialchars(__('emails.events.location_label', ['location' => $loc]), ENT_QUOTES, 'UTF-8');
            $locationHtml = "<p style=\"color: #64748b; margin: 4px 0 0; font-size: 14px;\">{$locationLabelHtml}</p>";
        }

        $greeting = htmlspecialchars(__('emails.common.greeting', ['name' => $recipientName]), ENT_QUOTES, 'UTF-8');
        $reminderBody = __('emails.events.reminder_body', ['title' => $eventTitle, 'time_note' => $timeNote]);
        $viewEventLabel = htmlspecialchars(__('emails.events.view_event'), ENT_QUOTES, 'UTF-8');

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: {$gradientSolid}; background-image: linear-gradient(135deg, {$gradientColors}); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">{$tenantName}</p>
    </div>
    <div style="background: #f8fafc; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$greeting}</p>
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6;">{$reminderBody}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #1e293b; margin: 0; font-size: 15px; font-weight: 600;">{$when}</p>
            {$locationHtml}
        </div>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$eventUrl}" style="display: inline-block; background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">{$viewEventLabel}</a>
        </div>
    </div>
</div>
HTML;
    }
}
