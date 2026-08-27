<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Enums\EventAttendanceState;
use App\Enums\EventEngagementState;
use App\Enums\EventLocationMode;
use App\Enums\EventOnlineAccessState;
use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Enums\EventRegistrationState;
use App\Enums\EventScheduleState;
use Illuminate\Support\Carbon;
use Throwable;
use App\Support\UserDisplayName;

/**
 * Pure compatibility mapper for the negotiated Events v2 read contract.
 *
 * This class never queries the database. EventService supplies tenant-scoped,
 * durable facts and these methods project them without inventing workflow
 * states that the current schema cannot prove.
 */
final class EventContractMapper
{
    public const VERSION = 2;

    private const MAINTAINED_RECURRENCE_ENGINE = 'sabre-vobject';
    private const MAINTAINED_RECURRENCE_ENGINE_VERSION = '2';

    /** @return array<string, mixed> */
    public static function event(array $event, array $facts = [], bool $detail = true): array
    {
        $legacyStatus = self::nullableString(
            $facts['legacy_status']
                ?? $event['user_rsvp']
                ?? $event['my_rsvp']
                ?? $event['rsvp_status']
                ?? null
        );
        $organizer = self::organizer($event, $facts);
        $category = self::category($event, $facts);
        $location = self::location($event);
        $schedule = self::schedule($event, $facts);
        $relationship = self::relationship($event, $facts + ['legacy_status' => $legacyStatus]);
        $permissions = self::permissions($facts);
        $metrics = self::metrics($event, $facts);
        $onlineAccess = self::onlineAccessFromProjection($event, $facts);
        $series = self::series($event, $facts);
        $primaryImage = self::primaryImage($event);

        $result = [
            'contract_version' => self::VERSION,
            'id' => self::intValue($event['id'] ?? 0),
            'title' => self::stringValue($event['title'] ?? ''),
            'description' => self::nullableString($event['description'] ?? null),
            'primary_image' => $primaryImage,
            'organizer' => $organizer,
            'category' => $category,
            'location' => $location,
            'schedule' => $schedule,
            'relationship' => $relationship,
            'online_access' => $onlineAccess,
            'series' => $series,
            'permissions' => $permissions,
            'metrics' => $metrics,
            'created_at' => self::dateString($event['created_at'] ?? null),
            'updated_at' => self::dateString($event['updated_at'] ?? null),

            // Non-conflicting compatibility aliases for the maintained clients.
            'organizer_id' => $organizer['id'],
            'user' => [
                'id' => $organizer['id'],
                'name' => $organizer['display_name'],
                'avatar' => $organizer['avatar_url'],
                'avatar_url' => $organizer['avatar_url'],
            ],
            'category_id' => $category['id'] ?? null,
            'category_name' => $category['name'] ?? null,
            'category_slug' => $category['slug'] ?? null,
            'location_label' => $location['label'],
            'latitude' => $location['latitude'],
            'longitude' => $location['longitude'],
            'coordinates' => $location['latitude'] !== null && $location['longitude'] !== null
                ? ['lat' => $location['latitude'], 'lng' => $location['longitude']]
                : null,
            'venue_accessibility' => $location['accessibility'],
            'start_time' => $schedule['start_at'],
            'end_time' => $schedule['end_at'],
            'start_date' => $schedule['start_at'],
            'end_date' => $schedule['end_at'],
            'status' => self::nullableString($event['status'] ?? null) ?? 'active',
            'cancellation_reason' => $schedule['cancellation_reason'],
            'is_online' => (bool) ($event['is_online'] ?? false),
            'allow_remote_attendance' => (bool) ($event['allow_remote_attendance'] ?? false),
            'online_link' => $onlineAccess['join_url'],
            'online_url' => $onlineAccess['join_url'],
            'video_url' => $onlineAccess['video_url'],
            'cover_image' => $primaryImage['url'] ?? null,
            'image_url' => $primaryImage['url'] ?? null,
            'max_attendees' => $relationship['capacity']['limit'],
            'spots_left' => $relationship['capacity']['remaining'],
            'is_full' => $relationship['capacity']['is_full'],
            'attendee_count' => $metrics['confirmed_count'],
            'attendees_count' => $metrics['confirmed_count'],
            'interested_count' => $metrics['interested_count'],
            'waitlist_count' => $metrics['waitlist_count'],
            'rsvp_counts' => [
                'going' => $metrics['confirmed_count'],
                'interested' => $metrics['interested_count'],
            ],
            'my_rsvp' => $legacyStatus,
            'user_rsvp' => $legacyStatus,
            'rsvp_status' => $legacyStatus,
            'series_id' => $series['named']['id'] ?? null,
            'is_series' => $series['recurrence'] !== null,
            'parent_event_id' => $series['recurrence']['parent_event_id'] ?? null,
            'recurrence_frequency' => $series['recurrence']['frequency'] ?? null,
            'series_count' => $series['recurrence']['occurrence_count'] ?? null,
            'series_occurrences' => $series['recurrence']['occurrences'] ?? [],
            'can_edit' => $permissions['edit'],
        ];

        if ($detail && is_array($event['group'] ?? null)) {
            $result['group'] = [
                'id' => self::intValue($event['group']['id'] ?? 0),
                'name' => self::stringValue($event['group']['name'] ?? ''),
                'slug' => self::nullableString($event['group']['slug'] ?? null),
            ];
        } else {
            $result['group'] = null;
        }

        if (isset($event['distance_km']) && is_numeric($event['distance_km'])) {
            $result['distance_km'] = round((float) $event['distance_km'], 2);
        }

        // Member-facing surface only — the public projection's allowlist
        // deliberately omits it. Only a configured, positive reward is worth
        // sending; clients additionally gate the badge on the tenant's
        // event_attendance_credits flag.
        if (isset($event['attendance_credit_amount'])
            && is_numeric($event['attendance_credit_amount'])
            && (float) $event['attendance_credit_amount'] > 0) {
            $result['attendance_credit_amount'] = round((float) $event['attendance_credit_amount'], 2);
        }

        return $result;
    }

    /** @return array<string, mixed> */
    public static function relationship(array $event, array $facts = []): array
    {
        $legacyStatus = self::nullableString($facts['legacy_status'] ?? null);
        $explicitEngagement = self::nullableString($facts['engagement_state'] ?? null);
        $explicitRegistration = EventRegistrationState::tryFrom(
            self::nullableString($facts['registration_state'] ?? null) ?? '',
        );
        $waitlistState = self::nullableString($facts['waitlist_state'] ?? null);
        $waitlistPosition = self::nullableInt($facts['waitlist_position'] ?? null);
        $attendance = is_array($facts['attendance'] ?? null) ? $facts['attendance'] : [];

        $engagementState = EventEngagementState::tryFrom($explicitEngagement ?? '')
            ?? (in_array($legacyStatus, ['interested', 'maybe'], true)
                ? EventEngagementState::Interested
                : EventEngagementState::None);

        $registrationState = match ($waitlistState) {
            'waiting' => EventRegistrationState::Waitlisted,
            'offered' => EventRegistrationState::Offered,
            default => $explicitRegistration ?? match (true) {
                $waitlistPosition !== null,
                $legacyStatus === 'waitlisted' => EventRegistrationState::Waitlisted,
                $legacyStatus === 'invited' => EventRegistrationState::Invited,
                in_array($legacyStatus, ['going', 'attended'], true) => EventRegistrationState::Confirmed,
                in_array($legacyStatus, ['not_going', 'declined'], true) => EventRegistrationState::Declined,
                $legacyStatus === 'cancelled' => EventRegistrationState::Cancelled,
                default => EventRegistrationState::None,
            },
        };

        $checkedInAt = self::dateString($attendance['checked_in_at'] ?? null);
        $checkedOutAt = self::dateString($attendance['checked_out_at'] ?? null);
        $attendanceState = EventAttendanceState::tryFrom(
            self::nullableString($attendance['state'] ?? null) ?? '',
        ) ?? match (true) {
            $checkedOutAt !== null => EventAttendanceState::CheckedOut,
            $checkedInAt !== null => EventAttendanceState::CheckedIn,
            $legacyStatus === 'attended' => EventAttendanceState::Attended,
            default => EventAttendanceState::NotCheckedIn,
        };

        $metrics = self::metrics($event, $facts);
        $limit = self::nullableInt($event['max_attendees'] ?? null);
        $occupied = max(
            $metrics['confirmed_count'],
            self::intValue($facts['capacity_occupied_count'] ?? $metrics['confirmed_count']),
        );
        $remaining = $limit !== null ? max(0, $limit - $occupied) : null;
        $allowedActions = is_array($facts['allowed_actions'] ?? null) ? $facts['allowed_actions'] : [];

        return [
            'engagement' => [
                'state' => $engagementState->value,
                'can_change' => (bool) ($allowedActions['set_interest'] ?? false),
            ],
            'registration' => [
                'state' => $registrationState->value,
                'waitlist_position' => $waitlistPosition,
                'can_register' => (bool) ($allowedActions['register'] ?? false),
                'can_withdraw' => (bool) ($allowedActions['withdraw'] ?? false),
                'can_join_waitlist' => (bool) ($allowedActions['join_waitlist'] ?? false),
                'can_leave_waitlist' => (bool) ($allowedActions['leave_waitlist'] ?? false),
            ],
            'attendance' => [
                'state' => $attendanceState->value,
                'checked_in_at' => $checkedInAt,
                'checked_out_at' => $checkedOutAt,
            ],
            'capacity' => [
                'limit' => $limit,
                'confirmed' => $metrics['confirmed_count'],
                'remaining' => $remaining,
                'is_full' => $limit !== null && $occupied >= $limit,
                'waitlist_count' => $metrics['waitlist_count'],
            ],
        ];
    }

    /** @return array<string, bool> */
    public static function permissions(array $facts): array
    {
        $abilities = is_array($facts['policy_abilities'] ?? null)
            ? $facts['policy_abilities']
            : [];
        $manage = (bool) ($abilities['manage'] ?? false);
        $viewRoster = (bool) ($abilities['viewRoster'] ?? false);
        $viewWaitlist = (bool) ($abilities['viewWaitlist'] ?? false);
        $manageAttendance = (bool) ($abilities['manageAttendance'] ?? false);

        return [
            'edit' => (bool) ($facts['can_edit'] ?? $manage),
            'cancel' => $manage,
            'manage_people' => $viewRoster || $viewWaitlist || $manageAttendance,
            'check_in' => $manageAttendance,
            'message' => (bool) ($abilities['messagePeople'] ?? false),
            'export' => (bool) ($abilities['exportPeople'] ?? false),
            'publish' => (bool) ($facts['can_publish'] ?? false),
            'submit_for_review' => (bool) ($facts['can_submit_for_review'] ?? false),
            'manage_agenda' => (bool) ($abilities['manageAgenda'] ?? $manage),
            'manage_staff' => (bool) ($abilities['manageStaff'] ?? false),
            'manage_registration' => (bool) ($abilities['manageRegistration'] ?? false),
            'broadcast' => (bool) ($abilities['broadcast'] ?? false),
            'manage_finance' => (bool) ($abilities['manageFinance'] ?? false),
            'reconcile_credits' => (bool) ($abilities['reconcileCredits'] ?? false),
            'reconcile_tickets' => (bool) ($abilities['reconcileTickets'] ?? false),
            'transfer_ownership' => (bool) ($abilities['transferOwnership'] ?? false),
        ];
    }

    /** @return array<string, int> */
    public static function metrics(array $event, array $facts = []): array
    {
        $counts = is_array($event['rsvp_counts'] ?? null) ? $event['rsvp_counts'] : [];

        return [
            'confirmed_count' => self::intValue(
                $facts['confirmed_count']
                    ?? $event['attendee_count']
                    ?? $event['attendees_count']
                    ?? $counts['going']
                    ?? 0
            ),
            'interested_count' => self::intValue(
                $facts['interested_count']
                    ?? $event['interested_count']
                    ?? $counts['interested']
                    ?? 0
            ),
            'waitlist_count' => self::intValue(
                $facts['waitlist_count']
                    ?? $event['waitlist_count']
                    ?? 0
            ),
        ];
    }

    /** @return array<string, mixed> */
    public static function onlineAccess(
        array $event,
        bool $isEligible,
        bool $canBypassWindow = false,
        ?Carbon $now = null
    ): array {
        $joinUrl = self::nullableString($event['online_link'] ?? $event['online_url'] ?? null);
        $videoUrl = self::nullableString($event['video_url'] ?? null);
        $hasOnlineCapability = (bool) ($event['is_online'] ?? false)
            || (bool) ($event['allow_remote_attendance'] ?? false)
            || $joinUrl !== null
            || $videoUrl !== null;
        $mode = self::location($event)['mode'];

        if (!$hasOnlineCapability) {
            return self::onlineAccessResult(
                $mode,
                EventOnlineAccessState::NotApplicable,
                null,
                null,
                null,
                null
            );
        }

        if ($joinUrl === null && $videoUrl === null) {
            return self::onlineAccessResult(
                $mode,
                EventOnlineAccessState::NotConfigured,
                null,
                null,
                null,
                null
            );
        }

        $start = self::carbon($event['start_time'] ?? $event['start_date'] ?? null);
        $end = self::carbon($event['end_time'] ?? $event['end_date'] ?? null);
        $beforeMinutes = max(0, (int) config('events.online_access.reveal_before_minutes', 30));
        $graceMinutes = max(0, (int) config('events.online_access.grace_after_minutes', 120));
        $revealAt = $start?->copy()->subMinutes($beforeMinutes);
        $expiresAt = ($end ?? $start)?->copy()->addMinutes($graceMinutes);

        if ($canBypassWindow && $isEligible) {
            return self::onlineAccessResult(
                $mode,
                EventOnlineAccessState::Available,
                $joinUrl,
                $videoUrl,
                $revealAt,
                $expiresAt
            );
        }

        if (($event['status'] ?? 'active') === 'cancelled' || ! $isEligible || $start === null) {
            return self::onlineAccessResult(
                $mode,
                EventOnlineAccessState::Restricted,
                null,
                null,
                $revealAt,
                $expiresAt
            );
        }

        $now ??= Carbon::now();
        if ($revealAt !== null && $now->lt($revealAt)) {
            return self::onlineAccessResult(
                $mode,
                EventOnlineAccessState::Scheduled,
                null,
                null,
                $revealAt,
                $expiresAt
            );
        }

        if ($expiresAt !== null && $now->gt($expiresAt)) {
            return self::onlineAccessResult(
                $mode,
                EventOnlineAccessState::Expired,
                null,
                null,
                $revealAt,
                $expiresAt
            );
        }

        return self::onlineAccessResult(
            $mode,
            EventOnlineAccessState::Available,
            $joinUrl,
            $videoUrl,
            $revealAt,
            $expiresAt
        );
    }

    /** @return array<string, mixed> */
    public static function redactLegacyOnlineFields(array $event, array $onlineAccess): array
    {
        if (array_key_exists('online_link', $event)) {
            $event['online_link'] = $onlineAccess['join_url'] ?? null;
        }
        if (array_key_exists('online_url', $event)) {
            $event['online_url'] = $onlineAccess['join_url'] ?? null;
        }
        if (array_key_exists('video_url', $event)) {
            $event['video_url'] = $onlineAccess['video_url'] ?? null;
        }
        $event['online_access'] = $onlineAccess;

        return $event;
    }

    /** @return array<string, mixed> */
    public static function roster(array $attendee): array
    {
        $legacyStatus = self::nullableString($attendee['rsvp_status'] ?? $attendee['status'] ?? null);
        $relationship = self::relationship([], [
            'legacy_status' => $legacyStatus,
            'attendance' => [
                'checked_in_at' => $attendee['checked_in_at'] ?? null,
                'checked_out_at' => $attendee['checked_out_at'] ?? null,
            ],
        ]);

        return [
            'contract_version' => self::VERSION,
            'member' => [
                'id' => self::intValue($attendee['id'] ?? $attendee['user_id'] ?? 0),
                'display_name' => self::displayName($attendee),
                'avatar_url' => self::nullableString($attendee['avatar_url'] ?? $attendee['avatar'] ?? null),
            ],
            'engagement' => $relationship['engagement'],
            'registration' => $relationship['registration'],
            'attendance' => $relationship['attendance'],
            'registered_at' => self::dateString($attendee['rsvp_at'] ?? null),

            // Compatibility aliases.
            'id' => self::intValue($attendee['id'] ?? $attendee['user_id'] ?? 0),
            'name' => self::displayName($attendee),
            'avatar' => self::nullableString($attendee['avatar_url'] ?? $attendee['avatar'] ?? null),
            'avatar_url' => self::nullableString($attendee['avatar_url'] ?? $attendee['avatar'] ?? null),
            'rsvp_status' => $legacyStatus,
            'status' => $legacyStatus,
            'rsvp_at' => self::dateString($attendee['rsvp_at'] ?? null),
        ];
    }

    /** @return array<string, mixed> */
    public static function registration(array $event, array $facts, array $legacyPayload = []): array
    {
        $relationship = self::relationship($event, $facts);
        $metrics = self::metrics($event, $facts);
        $legacyStatus = self::nullableString(
            $legacyPayload['status']
                ?? $facts['legacy_status']
                ?? $event['my_rsvp']
                ?? $event['user_rsvp']
                ?? null
        );

        return [
            'contract_version' => self::VERSION,
            'event_id' => self::intValue($event['id'] ?? 0),
            'relationship' => $relationship,
            'metrics' => $metrics,
            'status' => $legacyStatus,
            'rsvp_counts' => [
                'going' => $metrics['confirmed_count'],
                'interested' => $metrics['interested_count'],
            ],
            'waitlist_position' => $relationship['registration']['waitlist_position'],
            'message' => self::nullableString($legacyPayload['message'] ?? null),
        ];
    }

    /** @return array<string, mixed> */
    public static function seriesResource(array $series, array $occurrences = []): array
    {
        return [
            'contract_version' => self::VERSION,
            'id' => self::intValue($series['id'] ?? 0),
            'title' => self::stringValue($series['title'] ?? ''),
            'description' => self::nullableString($series['description'] ?? null),
            'event_count' => self::intValue($series['event_count'] ?? count($occurrences)),
            'next_event_at' => self::dateString($series['next_event'] ?? null),
            'creator' => self::nullableString($series['creator'] ?? $series['creator_name'] ?? null),
            'created_at' => self::dateString($series['created_at'] ?? null),
            'occurrences' => array_values(array_map(static fn (array $occurrence): array => [
                'id' => self::intValue($occurrence['id'] ?? 0),
                'title' => self::nullableString($occurrence['title'] ?? null),
                'start_at' => self::dateString($occurrence['start_at'] ?? $occurrence['start_time'] ?? null),
                'end_at' => self::dateString($occurrence['end_at'] ?? $occurrence['end_time'] ?? null),
                'status' => self::nullableString($occurrence['status'] ?? null) ?? 'active',
                'location_label' => self::nullableString($occurrence['location_label'] ?? $occurrence['location'] ?? null),
            ], $occurrences)),
        ];
    }

    /** @return array<string, mixed> */
    private static function organizer(array $event, array $facts): array
    {
        $source = is_array($event['organizer'] ?? null)
            ? $event['organizer']
            : (is_array($event['user'] ?? null) ? $event['user'] : []);
        $id = self::intValue($source['id'] ?? $event['user_id'] ?? 0);
        $viewerId = self::nullableInt($facts['viewer_id'] ?? null);

        return [
            'id' => $id,
            'display_name' => self::displayName($source),
            'avatar_url' => self::nullableString($source['avatar_url'] ?? $source['avatar'] ?? null),
            'relationship' => $viewerId !== null && $viewerId === $id ? 'self' : 'member',
            'actions' => [
                'view_profile' => $id > 0,
                'message' => (bool) ($facts['can_message_organizer'] ?? false),
            ],
        ];
    }

    /** @return array<string, mixed>|null */
    private static function category(array $event, array $facts = []): ?array
    {
        $source = is_array($facts['category'] ?? null)
            ? $facts['category']
            : (is_array($event['category'] ?? null) ? $event['category'] : []);
        $id = self::nullableInt($source['id'] ?? $event['category_id'] ?? null);
        $name = self::nullableString($source['name'] ?? $event['category_name'] ?? null);
        $slug = self::nullableString($source['slug'] ?? $event['category_slug'] ?? null);
        $colour = self::nullableString(
            $source['colour']
                ?? $source['color']
                ?? $event['category_colour']
                ?? $event['category_color']
                ?? null
        );

        if ($id === null && $name === null && $slug === null && $colour === null) {
            return null;
        }

        return [
            'id' => $id,
            'name' => $name,
            'slug' => $slug,
            'colour' => $colour,
        ];
    }

    /** @return array<string, mixed> */
    private static function location(array $event): array
    {
        $legacyLocation = is_array($event['location'] ?? null) ? $event['location'] : [];
        $label = self::nullableString(
            $legacyLocation['label']
                ?? $event['location_label']
                ?? (is_string($event['location'] ?? null) ? $event['location'] : null)
        );
        $latitude = self::nullableFloat(
            $legacyLocation['latitude']
                ?? $event['latitude']
                ?? (is_array($event['coordinates'] ?? null) ? $event['coordinates']['lat'] ?? null : null)
        );
        $longitude = self::nullableFloat(
            $legacyLocation['longitude']
                ?? $event['longitude']
                ?? (is_array($event['coordinates'] ?? null) ? $event['coordinates']['lng'] ?? null : null)
        );
        $remote = (bool) ($event['is_online'] ?? false)
            || (bool) ($event['allow_remote_attendance'] ?? false)
            || self::nullableString($event['online_link'] ?? $event['online_url'] ?? $event['video_url'] ?? null) !== null;
        $mode = match (true) {
            $remote && $label !== null => EventLocationMode::Hybrid,
            $remote => EventLocationMode::Online,
            default => EventLocationMode::InPerson,
        };

        return [
            'label' => $label,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'mode' => $mode->value,
            'accessibility' => self::venueAccessibility($event, $legacyLocation),
        ];
    }

    /**
     * Public venue facts use nullable booleans so "no" is never confused with
     * "the organiser has not supplied this information". Private attendee
     * accommodation answers are deliberately outside this projection.
     *
     * @param array<string,mixed> $event
     * @param array<string,mixed> $legacyLocation
     * @return array<string,mixed>
     */
    private static function venueAccessibility(array $event, array $legacyLocation): array
    {
        $source = is_array($legacyLocation['accessibility'] ?? null)
            ? $legacyLocation['accessibility']
            : (is_array($event['venue_accessibility'] ?? null)
                ? $event['venue_accessibility']
                : []);
        $features = is_array($source['features'] ?? null) ? $source['features'] : $source;

        $result = [
            'schema_version' => 1,
            'step_free_access' => self::nullableBoolean(
                $features['step_free_access'] ?? $event['accessibility_step_free'] ?? null,
            ),
            'accessible_toilet' => self::nullableBoolean(
                $features['accessible_toilet'] ?? $event['accessibility_toilet'] ?? null,
            ),
            'hearing_loop' => self::nullableBoolean(
                $features['hearing_loop'] ?? $event['accessibility_hearing_loop'] ?? null,
            ),
            'quiet_space' => self::nullableBoolean(
                $features['quiet_space'] ?? $event['accessibility_quiet_space'] ?? null,
            ),
            'seating_available' => self::nullableBoolean(
                $features['seating_available'] ?? $event['accessibility_seating'] ?? null,
            ),
            'accessible_parking' => self::nullableBoolean(
                $features['accessible_parking'] ?? $event['accessibility_parking'] ?? null,
            ),
            'parking_details' => self::publicText(
                $source['parking_details'] ?? $event['accessibility_parking_details'] ?? null,
            ),
            'transit_details' => self::publicText(
                $source['transit_details'] ?? $event['accessibility_transit_details'] ?? null,
            ),
            'assistance_contact' => self::publicText(
                $source['assistance_contact'] ?? $event['accessibility_assistance_contact'] ?? null,
            ),
            'notes' => self::publicText(
                $source['notes'] ?? $event['accessibility_notes'] ?? null,
            ),
        ];
        $provided = false;
        foreach ($result as $key => $value) {
            if ($key !== 'schema_version' && $value !== null) {
                $provided = true;
                break;
            }
        }
        $result['provided'] = $provided;

        return $result;
    }

    /** @return array<string, mixed> */
    private static function schedule(array $event, array $facts): array
    {
        $start = self::carbon($event['start_time'] ?? $event['start_date'] ?? null);
        $end = self::carbon($event['end_time'] ?? $event['end_date'] ?? null);
        $lifecycle = EventLifecycleCompatibility::resolve(
            self::nullableString($event['publication_status'] ?? null),
            self::nullableString($event['operational_status'] ?? null),
            self::nullableString($event['status'] ?? null),
        );
        $publication = $lifecycle['publication'];
        $operational = $lifecycle['operational'];
        $now = Carbon::now();
        $state = match (true) {
            $publication === EventPublicationState::PendingReview => EventScheduleState::PendingReview,
            $publication === EventPublicationState::Draft => EventScheduleState::Draft,
            $publication === EventPublicationState::Archived => EventScheduleState::Archived,
            $operational === EventOperationalState::Postponed => EventScheduleState::Postponed,
            $operational === EventOperationalState::Cancelled => EventScheduleState::Cancelled,
            $operational === EventOperationalState::Completed => EventScheduleState::Completed,
            $start !== null && $start->gt($now) => EventScheduleState::Upcoming,
            $end !== null && $end->lt($now) => EventScheduleState::Ended,
            $start !== null && $start->lte($now) => EventScheduleState::Ongoing,
            default => EventScheduleState::Upcoming,
        };

        return [
            'start_at' => $start?->toIso8601String(),
            'end_at' => $end?->toIso8601String(),
            'timezone' => self::nullableString($event['timezone'] ?? $facts['timezone'] ?? null) ?? 'UTC',
            'all_day' => (bool) ($event['all_day'] ?? false),
            'state' => $state->value,
            'publication_state' => $publication->value,
            'operational_state' => $operational->value,
            'lifecycle_version' => self::intValue($event['lifecycle_version'] ?? 0),
            // `cancellation_reason` is the established attendee-visible field.
            // Never fall back to notes/moderation metadata.
            'cancellation_reason' => $operational === EventOperationalState::Cancelled
                ? self::publicText($event['cancellation_reason'] ?? null)
                : null,
        ];
    }

    /** @return array<string, mixed> */
    private static function series(array $event, array $facts): array
    {
        $named = is_array($facts['named_series'] ?? null)
            ? $facts['named_series']
            : (is_array($event['series'] ?? null) ? $event['series'] : null);
        $namedResource = null;
        if ($named !== null || self::nullableInt($event['series_id'] ?? null) !== null) {
            $namedResource = [
                'id' => self::nullableInt($named['id'] ?? $event['series_id'] ?? null),
                'title' => self::nullableString($named['title'] ?? null),
                'description' => self::nullableString($named['description'] ?? null),
                'event_count' => self::intValue($named['event_count'] ?? $named['events_count'] ?? 0),
            ];
        }

        $isRecurring = (bool) ($event['is_recurring_template'] ?? false)
            || self::nullableInt($event['parent_event_id'] ?? null) !== null
            || is_array($facts['recurrence'] ?? null)
            || (bool) ($event['is_series'] ?? false);
        $recurrence = null;
        if ($isRecurring) {
            $rule = is_array($facts['recurrence'] ?? null) ? $facts['recurrence'] : [];
            $identity = is_array($facts['recurrence_identity'] ?? null)
                ? $facts['recurrence_identity']
                : [];
            $parentEventId = self::nullableInt($event['parent_event_id'] ?? null);
            $isTemplate = (bool) ($event['is_recurring_template'] ?? false);
            $rawRecurrenceId = self::nullableString(
                $identity['recurrence_id'] ?? $event['recurrence_id'] ?? null
            );
            $isMaintainedConcreteOccurrence = ! $isTemplate
                && $parentEventId !== null
                && $rawRecurrenceId !== null
                && preg_match('/^[0-9]{8}T[0-9]{6}Z$/D', $rawRecurrenceId) === 1
                && self::nullableString($identity['engine'] ?? $event['recurrence_engine'] ?? null)
                    === self::MAINTAINED_RECURRENCE_ENGINE
                && self::nullableString(
                    $identity['engine_version'] ?? $event['recurrence_engine_version'] ?? null
                )
                    === self::MAINTAINED_RECURRENCE_ENGINE_VERSION;
            $hasProjectedOccurrences = is_array($event['series_occurrences'] ?? null)
                || is_array($rule['occurrences'] ?? null);
            $occurrences = is_array($event['series_occurrences'] ?? null)
                ? $event['series_occurrences']
                : (is_array($rule['occurrences'] ?? null) ? $rule['occurrences'] : []);
            $projectedOccurrences = array_values(array_map(static fn (array $occurrence): array => [
                'id' => self::intValue($occurrence['id'] ?? 0),
                'start_at' => self::dateString($occurrence['start_at'] ?? $occurrence['start_time'] ?? null),
                'date' => self::nullableString($occurrence['date'] ?? $occurrence['occurrence_date'] ?? null),
            ], $occurrences));
            $reportedOccurrenceCount = array_key_exists('series_count', $event)
                ? self::intValue($event['series_count'])
                : (array_key_exists('occurrence_count', $rule)
                    ? self::intValue($rule['occurrence_count'])
                    : null);
            $recurrence = [
                'parent_event_id' => $parentEventId,
                'root_event_id' => self::intValue(
                    $event['parent_event_id']
                        ?? $rule['event_id']
                        ?? $event['id']
                        ?? 0
                ),
                'is_template' => $isTemplate,
                // Recurrence identity is an allowlisted manager contract, not
                // a raw rule projection. Templates, legacy engines and invalid
                // identities remain explicit nulls so clients fail closed.
                'recurrence_id' => $isMaintainedConcreteOccurrence ? $rawRecurrenceId : null,
                'engine' => $isMaintainedConcreteOccurrence
                    ? self::MAINTAINED_RECURRENCE_ENGINE
                    : null,
                'engine_version' => $isMaintainedConcreteOccurrence
                    ? self::MAINTAINED_RECURRENCE_ENGINE_VERSION
                    : null,
                'frequency' => self::nullableString($rule['frequency'] ?? $event['recurrence_frequency'] ?? null),
                'interval' => self::intValue($rule['interval_value'] ?? 1),
                'rrule' => self::nullableString($rule['rrule'] ?? null),
                // `occurrences` is a bounded preview. Preserve the separately
                // computed policy-visible total when one is available.
                'occurrence_count' => $reportedOccurrenceCount === null
                    ? ($hasProjectedOccurrences ? count($projectedOccurrences) : 0)
                    : max($reportedOccurrenceCount, count($projectedOccurrences)),
                'occurrences' => $projectedOccurrences,
            ];
        }

        return [
            'named' => $namedResource,
            'recurrence' => $recurrence,
        ];
    }

    /** @return array{url: string, alt_text: string}|null */
    private static function primaryImage(array $event): ?array
    {
        $url = self::nullableString($event['cover_image'] ?? $event['image_url'] ?? null);
        if ($url === null) {
            return null;
        }

        return [
            'url' => $url,
            'alt_text' => self::nullableString($event['image_alt'] ?? null)
                ?? self::stringValue($event['title'] ?? ''),
        ];
    }

    /** @return array<string, mixed> */
    private static function onlineAccessFromProjection(
        array $event,
        array $facts
    ): array {
        if (is_array($facts['online_access'] ?? null)) {
            return $facts['online_access'];
        }
        if (is_array($event['online_access'] ?? null)) {
            return $event['online_access'];
        }

        $abilities = is_array($facts['policy_abilities'] ?? null)
            ? $facts['policy_abilities']
            : [];

        return self::onlineAccess(
            $event,
            (bool) ($abilities['viewMeetingLink'] ?? false),
            (bool) ($abilities['manage'] ?? false)
        );
    }

    /** @return array<string, mixed> */
    private static function onlineAccessResult(
        string $mode,
        EventOnlineAccessState $state,
        ?string $joinUrl,
        ?string $videoUrl,
        ?Carbon $revealAt,
        ?Carbon $expiresAt
    ): array {
        return [
            'mode' => $mode,
            'reveal_state' => $state->value,
            'join_url' => $state === EventOnlineAccessState::Available ? $joinUrl : null,
            'video_url' => $state === EventOnlineAccessState::Available ? $videoUrl : null,
            'reveal_at' => $revealAt?->toIso8601String(),
            'expires_at' => $expiresAt?->toIso8601String(),
        ];
    }

    private static function displayName(array $source): ?string
    {
        $name = self::nullableString($source['display_name'] ?? $source['name'] ?? null);
        if ($name !== null) {
            return $name;
        }

        $organizationName = self::nullableString($source['organization_name'] ?? null);
        if (($source['profile_type'] ?? null) === 'organisation' && $organizationName !== null) {
            return $organizationName;
        }

        $name = UserDisplayName::resolve($source);

        return $name !== '' ? $name : null;
    }

    private static function carbon(mixed $value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return $value instanceof Carbon ? $value->copy() : Carbon::parse($value);
        } catch (Throwable) {
            return null;
        }
    }

    private static function dateString(mixed $value): ?string
    {
        return self::carbon($value)?->toIso8601String();
    }

    private static function stringValue(mixed $value): string
    {
        return trim((string) $value);
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $value = self::stringValue($value);

        return $value !== '' ? $value : null;
    }

    private static function publicText(mixed $value): ?string
    {
        $value = self::nullableString($value);
        if ($value === null) {
            return null;
        }

        $plain = trim(html_entity_decode(strip_tags($value)));

        return $plain !== '' ? $plain : null;
    }

    private static function intValue(mixed $value): int
    {
        return is_numeric($value) ? (int) $value : 0;
    }

    private static function nullableInt(mixed $value): ?int
    {
        return $value !== null && $value !== '' && is_numeric($value) ? (int) $value : null;
    }

    private static function nullableFloat(mixed $value): ?float
    {
        return $value !== null && $value !== '' && is_numeric($value) ? (float) $value : null;
    }

    private static function nullableBoolean(mixed $value): ?bool
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 0 || $value === '0') {
            return false;
        }
        if ($value === 1 || $value === '1') {
            return true;
        }

        return null;
    }
}
