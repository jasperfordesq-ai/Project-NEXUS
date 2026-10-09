<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * What an organisation can do with a volunteer on its roster (9 Oct 2026).
 *
 * The roster is everyone holding an approved application for one of the
 * organisation's opportunities. Until now an organiser could only take a
 * volunteer off one opportunity at a time (VolunteerService::removeApprovedVolunteer),
 * so nobody who had stopped volunteering could be cleared from the roster.
 *
 *   retire     — moves the volunteer to the organisation's retired list. Their
 *                applications, hours and history are kept. Places they hold on
 *                shifts that have not started are released and offered to the
 *                waiting list, because a retired volunteer will not turn up.
 *   reinstate  — puts a retired volunteer back on the active roster.
 *   remove     — takes the volunteer off every opportunity of the organisation
 *                (their approved applications are deleted, exactly as the
 *                per-opportunity removal does) and releases upcoming shift
 *                places. Logged hours are the volunteer's own record and are
 *                kept. They may apply again later.
 *
 * Who may do this is decided by the caller (VolunteerController::ensureOrgAccess,
 * the same check that guards the roster itself). Every action is audited and
 * the volunteer is told, in their own language, unless they did it themselves.
 */
class VolunteerRosterService
{
    /**
     * @return array{ok: bool, code?: string, released_shifts?: int}
     */
    public function retire(int $tenantId, int $orgId, int $actorId, int $volunteerId): array
    {
        $released = [];
        $result = DB::transaction(function () use ($tenantId, $orgId, $actorId, $volunteerId, &$released) {
            if (!$this->isOnRoster($tenantId, $orgId, $volunteerId)) {
                return ['ok' => false, 'code' => 'NOT_VOLUNTEER'];
            }

            $existing = DB::selectOne(
                'SELECT id FROM vol_org_retired_volunteers WHERE tenant_id = ? AND organization_id = ? AND user_id = ? FOR UPDATE',
                [$tenantId, $orgId, $volunteerId]
            );
            if ($existing !== null) {
                return ['ok' => false, 'code' => 'ALREADY_RETIRED'];
            }

            DB::table('vol_org_retired_volunteers')->insert([
                'tenant_id' => $tenantId,
                'organization_id' => $orgId,
                'user_id' => $volunteerId,
                'retired_by' => $actorId,
                'retired_at' => now(),
            ]);

            $released = $this->releaseUpcomingShiftPlaces($tenantId, $orgId, $volunteerId);

            return ['ok' => true];
        });

        if (!$result['ok']) {
            return $result;
        }

        app(AuditLogService::class)->log('volunteer_retired', $orgId, $actorId, [
            'released_shift_ids' => $released,
        ], $volunteerId);
        $this->offerReleasedPlaces($tenantId, $released);
        $this->notify($tenantId, $orgId, $actorId, $volunteerId, $released === []
            ? 'api.vol_roster_retired_notification'
            : 'api.vol_roster_retired_shifts_notification');

        return ['ok' => true, 'released_shifts' => count($released)];
    }

    /**
     * @return array{ok: bool, code?: string}
     */
    public function reinstate(int $tenantId, int $orgId, int $actorId, int $volunteerId): array
    {
        $deleted = DB::table('vol_org_retired_volunteers')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $orgId)
            ->where('user_id', $volunteerId)
            ->delete();
        if ($deleted === 0) {
            return ['ok' => false, 'code' => 'NOT_RETIRED'];
        }

        app(AuditLogService::class)->log('volunteer_reinstated', $orgId, $actorId, [], $volunteerId);
        $this->notify($tenantId, $orgId, $actorId, $volunteerId, 'api.vol_roster_reinstated_notification');

        return ['ok' => true];
    }

    /**
     * @return array{ok: bool, code?: string, removed_roles?: int, released_shifts?: int}
     */
    public function remove(int $tenantId, int $orgId, int $actorId, int $volunteerId): array
    {
        $released = [];
        $applicationIds = [];
        $result = DB::transaction(function () use ($tenantId, $orgId, $volunteerId, &$released, &$applicationIds) {
            $applications = DB::select(
                "SELECT va.id, va.shift_id, s.start_time AS shift_start
                 FROM vol_applications va
                 INNER JOIN vol_opportunities vo ON vo.id = va.opportunity_id AND vo.tenant_id = va.tenant_id
                 LEFT JOIN vol_shifts s ON s.id = va.shift_id AND s.tenant_id = va.tenant_id
                 WHERE va.tenant_id = ? AND va.user_id = ? AND va.status = 'approved' AND vo.organization_id = ?
                 FOR UPDATE",
                [$tenantId, $volunteerId, $orgId]
            );
            if ($applications === []) {
                return ['ok' => false, 'code' => 'NOT_VOLUNTEER'];
            }

            $now = time();
            foreach ($applications as $app) {
                $applicationIds[] = (int) $app->id;
                if ($app->shift_id !== null && $app->shift_start !== null && strtotime((string) $app->shift_start) > $now) {
                    $released[] = (int) $app->shift_id;
                }
            }

            DB::table('vol_applications')
                ->where('tenant_id', $tenantId)
                ->where('status', 'approved')
                ->whereIn('id', $applicationIds)
                ->delete();

            // Older shift bookings live in vol_shift_signups rather than on the application.
            $released = array_merge($released, $this->cancelUpcomingSignups($tenantId, $orgId, $volunteerId));

            DB::table('vol_org_retired_volunteers')
                ->where('tenant_id', $tenantId)
                ->where('organization_id', $orgId)
                ->where('user_id', $volunteerId)
                ->delete();

            return ['ok' => true];
        });

        if (!$result['ok']) {
            return $result;
        }

        $released = array_values(array_unique($released));
        app(AuditLogService::class)->log('volunteer_removed_from_organisation', $orgId, $actorId, [
            'application_ids' => $applicationIds,
            'released_shift_ids' => $released,
        ], $volunteerId);
        $this->offerReleasedPlaces($tenantId, $released);
        $this->notify($tenantId, $orgId, $actorId, $volunteerId, 'api.vol_roster_removed_notification');

        return ['ok' => true, 'removed_roles' => count($applicationIds), 'released_shifts' => count($released)];
    }

    /**
     * On the roster = holds an approved application for one of the organisation's opportunities.
     */
    private function isOnRoster(int $tenantId, int $orgId, int $volunteerId): bool
    {
        return DB::table('vol_applications as va')
            ->join('vol_opportunities as vo', function ($join) {
                $join->on('vo.id', '=', 'va.opportunity_id')->on('vo.tenant_id', '=', 'va.tenant_id');
            })
            ->where('va.tenant_id', $tenantId)
            ->where('va.user_id', $volunteerId)
            ->where('va.status', 'approved')
            ->where('vo.organization_id', $orgId)
            ->exists();
    }

    /**
     * Frees every place the volunteer holds on a shift of this organisation
     * that has not started. The approved application itself stays (it is their
     * record of the role); only the shift booking is cleared, as when a
     * volunteer cancels a shift themselves.
     *
     * @return list<int> the shifts that now have a free place
     */
    private function releaseUpcomingShiftPlaces(int $tenantId, int $orgId, int $volunteerId): array
    {
        $rows = DB::select(
            "SELECT va.id, va.shift_id
             FROM vol_applications va
             INNER JOIN vol_opportunities vo ON vo.id = va.opportunity_id AND vo.tenant_id = va.tenant_id
             INNER JOIN vol_shifts s ON s.id = va.shift_id AND s.tenant_id = va.tenant_id
             WHERE va.tenant_id = ? AND va.user_id = ? AND va.status = 'approved'
               AND vo.organization_id = ? AND s.start_time > ?
             FOR UPDATE",
            [$tenantId, $volunteerId, $orgId, date('Y-m-d H:i:s')]
        );

        $released = array_map(static fn ($r) => (int) $r->shift_id, $rows);
        if ($rows !== []) {
            DB::table('vol_applications')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', array_map(static fn ($r) => (int) $r->id, $rows))
                ->update(['shift_id' => null, 'updated_at' => now()]);
        }

        return array_values(array_unique(array_merge($released, $this->cancelUpcomingSignups($tenantId, $orgId, $volunteerId))));
    }

    /**
     * @return list<int> the shifts whose sign-up was cancelled
     */
    private function cancelUpcomingSignups(int $tenantId, int $orgId, int $volunteerId): array
    {
        $rows = DB::select(
            "SELECT ss.id, ss.shift_id
             FROM vol_shift_signups ss
             INNER JOIN vol_shifts s ON s.id = ss.shift_id AND s.tenant_id = ss.tenant_id
             INNER JOIN vol_opportunities vo ON vo.id = s.opportunity_id AND vo.tenant_id = s.tenant_id
             WHERE ss.tenant_id = ? AND ss.user_id = ? AND ss.status = 'confirmed'
               AND vo.organization_id = ? AND s.start_time > ?
             FOR UPDATE",
            [$tenantId, $volunteerId, $orgId, date('Y-m-d H:i:s')]
        );
        if ($rows === []) {
            return [];
        }

        DB::table('vol_shift_signups')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', array_map(static fn ($r) => (int) $r->id, $rows))
            ->update(['status' => 'cancelled', 'updated_at' => now()]);

        return array_values(array_unique(array_map(static fn ($r) => (int) $r->shift_id, $rows)));
    }

    /**
     * @param list<int> $shiftIds
     */
    private function offerReleasedPlaces(int $tenantId, array $shiftIds): void
    {
        foreach ($shiftIds as $shiftId) {
            try {
                ShiftWaitlistService::notifyNext($shiftId, $tenantId);
            } catch (\Throwable $e) {
                Log::warning('VolunteerRosterService: waitlist offer failed', ['shift' => $shiftId, 'error' => $e->getMessage()]);
            }
        }
    }

    /**
     * Tell the volunteer, in their own language. A failure here never undoes the change.
     */
    private function notify(int $tenantId, int $orgId, int $actorId, int $volunteerId, string $key): void
    {
        if ($volunteerId === $actorId) {
            return;
        }

        try {
            $recipient = DB::selectOne(
                'SELECT id, preferred_language FROM users WHERE id = ? AND tenant_id = ?',
                [$volunteerId, $tenantId]
            );
            if ($recipient === null) {
                return;
            }
            $orgName = (string) DB::table('vol_organizations')->where('id', $orgId)->where('tenant_id', $tenantId)->value('name');

            LocaleContext::withLocale($recipient, function () use ($volunteerId, $tenantId, $orgName, $key) {
                \App\Models\Notification::createNotification(
                    $volunteerId,
                    __($key, ['org' => $orgName]),
                    '/volunteering',
                    'volunteer_roster',
                    false,
                    $tenantId
                );
            });
        } catch (\Throwable $e) {
            Log::warning('VolunteerRosterService: notification failed', ['org' => $orgId, 'key' => $key, 'error' => $e->getMessage()]);
        }
    }
}
