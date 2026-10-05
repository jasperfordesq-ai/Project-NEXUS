<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

use Illuminate\Support\Facades\DB;

/**
 * Staff may share the full report with the incident's organisation's safeguarding
 * lead (its designated liaison person and deputy). A share counts only while it is
 * not withdrawn AND the incident still belongs to that organisation. Every share
 * and withdrawal is also written to the incident's timeline.
 */
final class IncidentShareService
{
    public function __construct(private readonly IncidentTimelineService $timeline)
    {
    }

    public function activeShare(int $tenantId, object $incident): ?object
    {
        $orgId = (int) ($incident->organization_id ?? 0);
        if ($orgId <= 0) {
            return null;
        }

        return DB::table('vol_incident_shares')
            ->where('tenant_id', $tenantId)
            ->where('incident_id', (int) $incident->id)
            ->where('organization_id', $orgId)
            ->whereNull('withdrawn_at')
            ->orderByDesc('id')
            ->first();
    }

    /** @return 'shared'|'already_shared'|'no_organisation'|'no_lead' */
    public function share(int $tenantId, object $incident, int $staffId): string
    {
        $orgId = (int) ($incident->organization_id ?? 0);
        if ($orgId <= 0) {
            return 'no_organisation';
        }
        // A lead the incident is about can never read it (F-507), so they do not
        // count: sharing with only them would share with nobody.
        if (self::readableLeadIds($tenantId, $incident) === []) {
            return 'no_lead';
        }
        $outcome = DB::transaction(function () use ($tenantId, $incident, $orgId, $staffId) {
            // Lock the incident so two clicks cannot both create a share.
            DB::table('vol_safeguarding_incidents')
                ->where('id', (int) $incident->id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($this->activeShare($tenantId, $incident)) {
                return 'already_shared';
            }
            DB::table('vol_incident_shares')->insert([
                'tenant_id' => $tenantId,
                'incident_id' => (int) $incident->id,
                'organization_id' => $orgId,
                'shared_by' => $staffId,
                'shared_at' => now(),
            ]);
            $this->timeline->record(
                $tenantId, (int) $incident->id, 'shared_with_organisation', $staffId, 'staff', null,
                ['organization_id' => $orgId], $orgId
            );

            return 'shared';
        });

        return $outcome;
    }

    /**
     * The organisation's lead and deputy who may actually read this incident —
     * never someone it is about.
     *
     * @return list<int>
     */
    public static function readableLeadIds(int $tenantId, object $incident): array
    {
        return array_values(array_filter(
            IncidentAccess::organisationLeadIds($tenantId, (int) ($incident->organization_id ?? 0)),
            fn (int $id) => !IncidentAccess::isAboutUser($incident, $id)
        ));
    }

    /** Withdraw every open share of this incident (with any organisation); one timeline row per share. */
    public function withdraw(int $tenantId, object $incident, int $staffId, string $reason = 'withdrawn'): bool
    {
        $open = DB::table('vol_incident_shares')
            ->where('tenant_id', $tenantId)
            ->where('incident_id', (int) $incident->id)
            ->whereNull('withdrawn_at')
            ->get();
        if ($open->isEmpty()) {
            return false;
        }
        DB::transaction(function () use ($open, $tenantId, $incident, $staffId, $reason) {
            foreach ($open as $share) {
                DB::table('vol_incident_shares')
                    ->where('id', $share->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['withdrawn_at' => now(), 'withdrawn_by' => $staffId]);
                $this->timeline->record(
                    $tenantId, (int) $incident->id, 'share_withdrawn', $staffId, 'staff', null,
                    ['organization_id' => (int) $share->organization_id, 'reason' => $reason],
                    (int) $share->organization_id
                );
            }
        });

        return true;
    }
}
