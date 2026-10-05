<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

use Illuminate\Support\Facades\DB;

/**
 * The only writer to vol_incident_events — the permanent record of everything
 * done on a volunteering safeguarding incident. The table is append-only: the
 * database refuses UPDATE and DELETE.
 */
final class IncidentTimelineService
{
    public const TYPES = [
        'reported', 'migrated', 'status_changed', 'handler_changed', 'filing_changed', 'authority_recorded',
        'staff_note', 'message_to_reporter', 'message_to_organisation', 'reporter_addition', 'org_update',
        'shared_with_organisation', 'share_withdrawn',
    ];

    public const ROLES = ['staff', 'reporter', 'organisation', 'system'];

    /** @param array<string, mixed> $data */
    public function record(
        int $tenantId,
        int $incidentId,
        string $type,
        ?int $actorId,
        string $actorRole,
        ?string $body = null,
        array $data = [],
        ?int $organizationId = null,
    ): int {
        if (!in_array($type, self::TYPES, true) || !in_array($actorRole, self::ROLES, true)) {
            throw new \InvalidArgumentException("Unknown incident event {$type}/{$actorRole}");
        }
        $body = $body !== null ? trim($body) : null;

        return (int) DB::table('vol_incident_events')->insertGetId([
            'tenant_id' => $tenantId,
            'incident_id' => $incidentId,
            'event_type' => $type,
            'actor_user_id' => $actorId,
            'actor_role' => $actorRole,
            'organization_id' => $organizationId,
            'body' => $body !== '' ? $body : null,
            'data' => $data !== [] ? json_encode($data) : null,
            'created_at' => now(),
        ]);
    }

    /** @return list<object> oldest first; data decoded to an array; actor_name tenant-scoped */
    public function forIncident(int $tenantId, int $incidentId): array
    {
        return DB::table('vol_incident_events as e')
            ->leftJoin('users as u', function ($join) use ($tenantId) {
                $join->on('e.actor_user_id', '=', 'u.id')->where('u.tenant_id', '=', $tenantId);
            })
            ->where('e.tenant_id', $tenantId)
            ->where('e.incident_id', $incidentId)
            ->orderBy('e.id')
            ->get(['e.*', 'u.name as actor_name'])
            ->map(function ($row) {
                $row->data = $row->data ? (json_decode((string) $row->data, true) ?: []) : [];

                return $row;
            })
            ->values()
            ->all();
    }
}
