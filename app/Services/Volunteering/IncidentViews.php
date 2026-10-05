<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

use Illuminate\Support\Facades\DB;

/**
 * Allow-listed responses for each kind of viewer of a volunteering safeguarding
 * incident. Nothing reaches a client unless it is named here, so a new column
 * can never leak by default.
 *
 * - staff: everything;
 * - the reporter: their report, status changes (without staff reasons), messages
 *   to them and their own additions — never staff notes, the handler or the
 *   authority reference;
 * - an organisation contact: the summary, status changes, its own updates and
 *   messages to it;
 * - the organisation's safeguarding lead: as a contact, plus sharing events, plus
 *   — only while staff have shared the full report — the title, what was
 *   written, who it is about and the reporter's additions. Never who reported it.
 */
final class IncidentViews
{
    private const REPORTER_EVENTS = ['reported', 'migrated', 'status_changed', 'message_to_reporter', 'reporter_addition'];

    private const ORG_EVENTS = ['reported', 'migrated', 'status_changed', 'org_update', 'message_to_organisation'];

    private const ORG_LEAD_EXTRA = ['shared_with_organisation', 'share_withdrawn'];

    private const ORG_SCOPED = ['org_update', 'message_to_organisation', 'shared_with_organisation', 'share_withdrawn'];

    /** @return array<string, mixed> the fields every relation may read */
    public static function summary(object $incident): array
    {
        $names = self::names($incident);

        return self::summaryWithNames($incident, $names['organisation'], $names['opportunity']);
    }

    /**
     * The same summary, from organisation and opportunity names the caller has
     * already looked up — so a list does not query per row.
     */
    public static function summaryWithNames(object $incident, ?string $organisationName, ?string $opportunityTitle): array
    {
        $names = ['organisation' => $organisationName, 'opportunity' => $opportunityTitle];

        return [
            'id' => (int) $incident->id,
            'type' => (string) $incident->incident_type,
            'severity' => (string) $incident->severity,
            'status' => (string) $incident->status,
            'incident_date' => $incident->incident_date ? substr((string) $incident->incident_date, 0, 10) : null,
            'created_at' => (string) $incident->created_at,
            'organization_id' => $incident->organization_id ? (int) $incident->organization_id : null,
            'organization_name' => $names['organisation'],
            'opportunity_id' => $incident->opportunity_id ? (int) $incident->opportunity_id : null,
            'opportunity_title' => $names['opportunity'],
        ];
    }

    /**
     * @param list<object> $events
     * @return array<string, mixed>
     */
    public static function staff(object $incident, array $events, ?object $share): array
    {
        $names = self::names($incident);

        return self::summary($incident) + [
            'title' => (string) $incident->title,
            'description' => (string) $incident->description,
            'category' => (string) ($incident->category ?? ''),
            'reported_by' => (int) $incident->reported_by,
            'reporter_name' => $names['reporter'],
            'subject_user_id' => $incident->subject_user_id ? (int) $incident->subject_user_id : null,
            'involved_user_id' => $incident->involved_user_id ? (int) $incident->involved_user_id : null,
            'subject_name' => $names['subject'],
            'assigned_to' => $incident->assigned_to ? (int) $incident->assigned_to : null,
            'assigned_to_name' => $names['handler'],
            'authority_notified' => (bool) ($incident->authority_notified ?? false),
            'authority_reference' => $incident->authority_reference,
            'share' => $share ? [
                'organization_id' => (int) $share->organization_id,
                'shared_at' => (string) $share->shared_at,
            ] : null,
            'timeline' => array_map(fn ($e) => self::event($e, true), $events),
        ];
    }

    /**
     * @param list<object> $events
     * @return array<string, mixed>
     */
    public static function reporter(object $incident, array $events): array
    {
        $names = self::names($incident);
        $visible = array_values(array_filter($events, fn ($e) => in_array($e->event_type, self::REPORTER_EVENTS, true)));

        return self::summary($incident) + [
            'title' => (string) $incident->title,
            'description' => (string) $incident->description,
            'subject_name' => $names['subject'],
            'can_add' => $incident->status !== 'closed',
            'timeline' => array_map(fn ($e) => self::event($e, false), $visible),
        ];
    }

    /**
     * @param list<object> $events
     * @return array<string, mixed>
     */
    public static function organisation(object $incident, array $events, string $relation, bool $shareActive, int $organizationId): array
    {
        $full = $relation === IncidentAccess::ORG_LEAD && $shareActive;
        $allowed = self::ORG_EVENTS;
        if ($relation === IncidentAccess::ORG_LEAD) {
            $allowed = array_merge($allowed, self::ORG_LEAD_EXTRA);
        }
        if ($full) {
            $allowed[] = 'reporter_addition';
        }
        $visible = array_values(array_filter($events, function ($e) use ($allowed, $organizationId) {
            if (!in_array($e->event_type, $allowed, true)) {
                return false;
            }
            // Organisation-scoped events belong to one organisation only.
            if (in_array($e->event_type, self::ORG_SCOPED, true)) {
                return (int) ($e->organization_id ?? 0) === $organizationId;
            }

            return true;
        }));

        $view = self::summary($incident) + [
            'relation' => $relation,
            'full_report_shared' => $full,
            'timeline' => array_map(fn ($e) => self::event($e, false, true), $visible),
        ];
        if ($full) {
            $names = self::names($incident);
            $view['title'] = (string) $incident->title;
            $view['description'] = (string) $incident->description;
            $view['subject_name'] = $names['subject'];
        }

        return $view;
    }

    /**
     * Status reasons and who on staff acted are staff-only. Organisation colleagues
     * see which of their own people sent an update.
     *
     * @return array<string, mixed>
     */
    private static function event(object $e, bool $isStaff, bool $orgView = false): array
    {
        $out = ['id' => (int) $e->id, 'type' => (string) $e->event_type, 'created_at' => (string) $e->created_at];
        if ($e->event_type === 'status_changed') {
            $out['from'] = $e->data['from'] ?? null;
            $out['to'] = $e->data['to'] ?? null;
        }
        if ($e->body !== null && ($e->event_type !== 'status_changed' || $isStaff)) {
            $out['body'] = (string) $e->body;
        }
        if ($isStaff) {
            $out['actor_user_id'] = $e->actor_user_id !== null ? (int) $e->actor_user_id : null;
            $out['actor_name'] = $e->actor_name;
            $out['actor_role'] = (string) $e->actor_role;
            $out['data'] = $e->data;
        } elseif ($orgView && $e->event_type === 'org_update') {
            $out['actor_name'] = $e->actor_name;
        }

        return $out;
    }

    /** @return array{organisation: ?string, opportunity: ?string, reporter: ?string, subject: ?string, handler: ?string} */
    private static function names(object $incident): array
    {
        $tenantId = (int) $incident->tenant_id;
        $user = fn ($id) => $id
            ? DB::table('users')->where('id', (int) $id)->where('tenant_id', $tenantId)->value('name')
            : null;

        return [
            'organisation' => $incident->organization_id
                ? DB::table('vol_organizations')->where('id', (int) $incident->organization_id)->where('tenant_id', $tenantId)->value('name')
                : null,
            'opportunity' => $incident->opportunity_id
                ? DB::table('vol_opportunities')->where('id', (int) $incident->opportunity_id)->where('tenant_id', $tenantId)->value('title')
                : null,
            'reporter' => $user($incident->reported_by ?? null),
            'subject' => $user(($incident->subject_user_id ?? null) ?: ($incident->involved_user_id ?? null)),
            'handler' => $user($incident->assigned_to ?? null),
        ];
    }
}
