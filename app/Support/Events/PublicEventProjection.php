<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

/**
 * The PUBLIC view of an event — the single allowlist shared by every surface
 * that shows events to visitors without an account (the /v2/public/events API
 * and the accessible frontend's What's On pages).
 *
 * This is an allowlist, not a denylist: anything not named here is not served,
 * so a new column on `events` is private-by-default on every public surface at
 * once. It was extracted from EventPublicController precisely so a second
 * consumer could not fork the field list — two copies of a privacy boundary
 * WILL drift.
 *
 * Deliberately absent: online joining links, RSVP/registration state, attendee
 * counts or lists, organiser contact details or surname, capacity, safety and
 * agenda internals.
 */
final class PublicEventProjection
{
    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    public static function project(array $event, bool $detail = false): array
    {
        $organiser = is_array($event['user'] ?? null) ? $event['user'] : [];
        $category = is_array($event['category'] ?? null) ? $event['category'] : [];

        $locationLabel = is_string($event['location'] ?? null) && trim((string) $event['location']) !== ''
            ? $event['location']
            : null;

        // Same remote/hybrid semantics as the member contract's location.mode
        // (EventContractMapper::location): the raw is_online column alone is
        // NOT the truth — the create form only ever writes
        // allow_remote_attendance, so relying on is_online rendered every
        // hybrid/online event as in-person on the public pages. The link
        // itself stays private; only the FACT of a remote option is public.
        $remote = (bool) ($event['is_online'] ?? false)
            || (bool) ($event['allow_remote_attendance'] ?? false)
            || (is_string($event['online_link'] ?? null) && trim((string) $event['online_link']) !== '')
            || (is_string($event['video_url'] ?? null) && trim((string) $event['video_url']) !== '');
        $attendanceMode = match (true) {
            $remote && $locationLabel !== null => 'hybrid',
            $remote => 'online',
            default => 'in_person',
        };

        // Cancelled/postponed events stay listed (people who saw the poster
        // need to learn the plan changed) but must SAY so. Only the state is
        // public — the organiser-written cancellation_reason is member-facing.
        $operationalStatus = in_array($event['operational_status'] ?? null, ['scheduled', 'postponed', 'cancelled', 'completed'], true)
            ? $event['operational_status']
            : 'scheduled';

        $projection = [
            'id' => (int) ($event['id'] ?? 0),
            'title' => $event['title'] ?? null,
            'start_time' => $event['start_time'] ?? null,
            'end_time' => $event['end_time'] ?? null,
            'timezone' => $event['timezone'] ?? null,
            'all_day' => (bool) ($event['all_day'] ?? false),
            // Location LABEL only. Coordinates are included because they are
            // already public on the page's map, but no venue contact details,
            // access codes or joining links are.
            'location' => $locationLabel,
            'latitude' => $event['latitude'] ?? null,
            'longitude' => $event['longitude'] ?? null,
            'is_online' => $remote,
            'attendance_mode' => $attendanceMode,
            'operational_status' => $operationalStatus,
            'image_url' => $event['image_url'] ?? null,
            'category' => $category === [] ? null : [
                'id' => (int) ($category['id'] ?? 0),
                'name' => $category['name'] ?? null,
                'slug' => $category['slug'] ?? null,
                'color' => $category['color'] ?? null,
            ],
            'organizer_name' => self::organiserDisplayName($organiser),
        ];

        if ($detail) {
            $projection['description'] = $event['description'] ?? null;
            // Venue accessibility is published deliberately: it is the
            // information a disabled visitor needs in order to decide whether
            // to attend, and withholding it until sign-up defeats the purpose.
            $projection['accessibility'] = [
                'step_free' => $event['accessibility_step_free'] ?? null,
                'accessible_toilet' => $event['accessibility_toilet'] ?? null,
                'hearing_loop' => $event['accessibility_hearing_loop'] ?? null,
                'quiet_space' => $event['accessibility_quiet_space'] ?? null,
                'seating' => $event['accessibility_seating'] ?? null,
                'parking' => $event['accessibility_parking'] ?? null,
                'notes' => $event['accessibility_notes'] ?? null,
            ];
        }

        return $projection;
    }

    /**
     * @param  array<string, mixed>  $organiser
     */
    public static function organiserDisplayName(array $organiser): ?string
    {
        if (($organiser['profile_type'] ?? null) === 'organisation'
            && ! empty($organiser['organization_name'])) {
            return (string) $organiser['organization_name'];
        }

        // Individual organisers are shown by FIRST name only. The member-facing
        // listing shows the full name, but that audience is already inside the
        // community; a public page should not put a resident's full name on the
        // open web because they offered to host a craft session.
        $first = trim((string) ($organiser['first_name'] ?? ''));

        return $first === '' ? null : $first;
    }
}
