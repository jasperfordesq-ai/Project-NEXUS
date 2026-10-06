<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolunteerShiftManagementService — one-off shifts, created and changed by the
 * people who run an opportunity.
 *
 * Until 2026-10-06 nothing on the platform could create a shift except the
 * repeating-pattern endpoint, which no screen called. Everything built on
 * shifts (sign-up, waitlists, group sign-ups, check-in, reminders, swaps) was
 * therefore unreachable for a real organisation. This service is the one-off
 * half; RecurringShiftService remains the repeating half.
 *
 * Who may manage: VolunteerService::userCanManageOpportunityById() — the
 * opportunity's creator, the owning organisation's owner or admins, or a
 * community admin. Every method is tenant-scoped.
 */
class VolunteerShiftManagementService
{
    /** Statuses whose holders are told when their shift is removed. */
    private const AFFECTED_APPLICATION_STATUSES = ['approved', 'pending'];

    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Create a one-off shift on an opportunity.
     *
     * @param  array{start_time?: mixed, end_time?: mixed, capacity?: mixed}  $data
     * @return array<string, mixed>|null  The shift as the opportunity's shift list formats it.
     */
    public function createShift(int $opportunityId, int $userId, array $data): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $opportunity = DB::table('vol_opportunities')
            ->where('id', $opportunityId)
            ->where('tenant_id', $tenantId)
            ->first(['id']);
        if (! $opportunity) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.opportunity_not_found')];
            return null;
        }

        if (! VolunteerService::userCanManageOpportunityById($opportunityId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return null;
        }

        $window = $this->parseWindow($data['start_time'] ?? null, $data['end_time'] ?? null, true);
        if ($window === null) {
            return null;
        }
        [$start, $end] = $window;

        $capacity = $this->parseCapacity($data, 0);
        if ($capacity === false) {
            return null;
        }

        try {
            $shiftId = (int) DB::table('vol_shifts')->insertGetId([
                'tenant_id'      => $tenantId,
                'opportunity_id' => $opportunityId,
                'start_time'     => $start,
                'end_time'       => $end,
                'capacity'       => $capacity,
                'created_at'     => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('[VolunteerShiftManagement] createShift failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return null;
        }

        Log::info('[VolunteerShiftManagement] Shift created', ['shift' => $shiftId, 'opportunity' => $opportunityId, 'by' => $userId]);

        return $this->formatShift($shiftId, $tenantId);
    }

    /**
     * Change the time or the number of places on a shift that has not started.
     *
     * @param  array{start_time?: mixed, end_time?: mixed, capacity?: mixed}  $data
     * @return array<string, mixed>|null
     */
    public function updateShift(int $shiftId, int $userId, array $data): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $shift = $this->loadManagedShift($shiftId, $userId, $tenantId);
        if ($shift === null) {
            return null;
        }

        if (strtotime((string) $shift->start_time) <= time()) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
            return null;
        }

        $window = $this->parseWindow(
            array_key_exists('start_time', $data) ? $data['start_time'] : $shift->start_time,
            array_key_exists('end_time', $data) ? $data['end_time'] : $shift->end_time,
            array_key_exists('start_time', $data),
        );
        if ($window === null) {
            return null;
        }
        [$start, $end] = $window;

        $updates = ['start_time' => $start, 'end_time' => $end];

        if (array_key_exists('capacity', $data)) {
            $taken = $this->placesTaken($shiftId, $tenantId);
            $capacity = $this->parseCapacity($data, $taken);
            if ($capacity === false) {
                return null;
            }
            $updates['capacity'] = $capacity;
        }

        try {
            DB::table('vol_shifts')
                ->where('id', $shiftId)
                ->where('tenant_id', $tenantId)
                ->update($updates);
        } catch (\Throwable $e) {
            Log::error('[VolunteerShiftManagement] updateShift failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return null;
        }

        Log::info('[VolunteerShiftManagement] Shift updated', ['shift' => $shiftId, 'by' => $userId]);

        return $this->formatShift($shiftId, $tenantId);
    }

    /**
     * Remove a shift that has not started. Volunteers who held a place keep
     * their application to the opportunity (the shift link is cleared) and are
     * told, each in their own language. Waitlist entries, check-ins, group
     * reservations and swap requests on the shift go with it (database cascade).
     *
     * @return array{deleted: bool, affected_volunteers: int}|null
     */
    public function deleteShift(int $shiftId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $shift = $this->loadManagedShift($shiftId, $userId, $tenantId);
        if ($shift === null) {
            return null;
        }

        if (strtotime((string) $shift->start_time) <= time()) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
            return null;
        }

        $affected = DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->whereIn('status', self::AFFECTED_APPLICATION_STATUSES)
            ->pluck('user_id')
            ->map(static fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        try {
            DB::transaction(function () use ($shiftId, $tenantId): void {
                // Their application to the opportunity survives; only the place on this shift goes.
                DB::table('vol_applications')
                    ->where('shift_id', $shiftId)
                    ->where('tenant_id', $tenantId)
                    ->update(['shift_id' => null, 'updated_at' => now()]);

                DB::table('vol_shifts')
                    ->where('id', $shiftId)
                    ->where('tenant_id', $tenantId)
                    ->delete();
            });
        } catch (\Throwable $e) {
            Log::error('[VolunteerShiftManagement] deleteShift failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return null;
        }

        $title = (string) (DB::table('vol_opportunities')
            ->where('id', (int) $shift->opportunity_id)
            ->where('tenant_id', $tenantId)
            ->value('title') ?? '');
        foreach ($affected as $volunteerId) {
            $this->notifyShiftCancelled($volunteerId, $title, (string) $shift->start_time);
        }

        Log::info('[VolunteerShiftManagement] Shift deleted', [
            'shift' => $shiftId,
            'opportunity' => (int) $shift->opportunity_id,
            'by' => $userId,
            'affected_volunteers' => count($affected),
        ]);

        return ['deleted' => true, 'affected_volunteers' => count($affected)];
    }

    /* ───────────────────────── helpers ───────────────────────── */

    /**
     * Who is on a shift and who turned up — for the people who may manage the
     * opportunity (same gate as changing the shift).
     *
     * Volunteers are the approved applications placed on the shift (the live
     * record; `vol_shift_signups` is no longer written), each with their
     * check-in state from `vol_shift_checkins` (null = no check-in row yet).
     * Group bookings list their leader and confirmed members; the waitlist
     * lists those still waiting or notified, in queue order.
     *
     * @return array{shift: array<string, mixed>, summary: array<string, int>, volunteers: list<array<string, mixed>>, groups: list<array<string, mixed>>, waitlist: list<array<string, mixed>>}|null
     */
    public function getShiftRoster(int $shiftId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if ($this->loadManagedShift($shiftId, $userId, $tenantId) === null) {
            return null;
        }

        $person = static fn (object $row, string $prefix = ''): array => [
            'id' => (int) $row->{$prefix . 'id'},
            'name' => (string) ($row->{$prefix . 'name'} ?? ''),
            'avatar_url' => $row->{$prefix . 'avatar_url'} ?? null,
        ];

        $volunteers = DB::table('vol_applications as a')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('a.user_id', '=', 'u.id')->where('u.tenant_id', '=', $tenantId);
            })
            ->leftJoin('vol_shift_checkins as c', function ($join) use ($tenantId) {
                $join->on('c.shift_id', '=', 'a.shift_id')
                    ->on('c.user_id', '=', 'a.user_id')
                    ->where('c.tenant_id', '=', $tenantId);
            })
            ->where('a.shift_id', $shiftId)
            ->where('a.tenant_id', $tenantId)
            ->where('a.status', 'approved')
            ->orderBy('u.first_name')
            ->orderBy('u.last_name')
            ->get([
                'u.id',
                DB::raw(\App\Support\UserDisplayName::sql('u', 'name')),
                'u.avatar_url',
                'c.status as check_in_status',
                'c.checked_in_at',
                'c.checked_out_at',
            ])
            ->map(static fn (object $row): array => [
                'user' => $person($row),
                'check_in_status' => $row->check_in_status,
                'checked_in_at' => $row->checked_in_at ? (string) $row->checked_in_at : null,
                'checked_out_at' => $row->checked_out_at ? (string) $row->checked_out_at : null,
            ])
            ->values()
            ->all();

        $reservations = DB::table('vol_shift_group_reservations as r')
            ->leftJoin('groups as g', function ($join) use ($tenantId) {
                $join->on('r.group_id', '=', 'g.id')->where('g.tenant_id', '=', $tenantId);
            })
            ->leftJoin('users as l', function ($join) use ($tenantId) {
                $join->on('r.reserved_by', '=', 'l.id')->where('l.tenant_id', '=', $tenantId);
            })
            ->where('r.shift_id', $shiftId)
            ->where('r.tenant_id', $tenantId)
            ->where('r.status', 'active')
            ->orderBy('r.id')
            ->get([
                'r.id', 'r.reserved_slots', 'g.name as group_name',
                'l.id as leader_id', DB::raw(\App\Support\UserDisplayName::sql('l', 'leader_name')), 'l.avatar_url as leader_avatar_url',
            ]);

        $membersByReservation = DB::table('vol_shift_group_members as m')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('m.user_id', '=', 'u.id')->where('u.tenant_id', '=', $tenantId);
            })
            ->whereIn('m.reservation_id', $reservations->pluck('id')->all())
            ->where('m.tenant_id', $tenantId)
            ->where('m.status', 'confirmed')
            ->orderBy('u.first_name')
            ->get(['m.reservation_id', 'u.id', DB::raw(\App\Support\UserDisplayName::sql('u', 'name')), 'u.avatar_url'])
            ->groupBy('reservation_id');

        $groups = $reservations->map(static fn (object $r): array => [
            'id' => (int) $r->id,
            'group_name' => (string) ($r->group_name ?? ''),
            'reserved_slots' => (int) $r->reserved_slots,
            'leader' => $r->leader_id ? ['id' => (int) $r->leader_id, 'name' => (string) $r->leader_name, 'avatar_url' => $r->leader_avatar_url] : null,
            'members' => ($membersByReservation->get($r->id) ?? collect())->map(static fn (object $m): array => $person($m))->values()->all(),
        ])->values()->all();

        $waitlist = DB::table('vol_shift_waitlist as w')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('w.user_id', '=', 'u.id')->where('u.tenant_id', '=', $tenantId);
            })
            ->where('w.shift_id', $shiftId)
            ->where('w.tenant_id', $tenantId)
            ->whereIn('w.status', ['waiting', 'notified'])
            ->orderBy('w.position')
            ->orderBy('w.id')
            ->get(['u.id', DB::raw(\App\Support\UserDisplayName::sql('u', 'name')), 'u.avatar_url', 'w.position', 'w.status'])
            ->map(static fn (object $row): array => [
                'user' => $person($row),
                'position' => (int) $row->position,
                'status' => $row->status,
            ])
            ->values()
            ->all();

        $checkedIn = count(array_filter(
            $volunteers,
            static fn (array $v): bool => in_array($v['check_in_status'], ['checked_in', 'checked_out'], true)
        ));

        return [
            'shift' => $this->formatShift($shiftId, $tenantId) ?? ['id' => $shiftId],
            'summary' => [
                'signed_up' => count($volunteers),
                'checked_in' => $checkedIn,
                'no_show' => count(array_filter($volunteers, static fn (array $v): bool => $v['check_in_status'] === 'no_show')),
                'group_places' => array_sum(array_column($groups, 'reserved_slots')),
                'waiting' => count($waitlist),
            ],
            'volunteers' => $volunteers,
            'groups' => $groups,
            'waitlist' => $waitlist,
        ];
    }

    private function loadManagedShift(int $shiftId, int $userId, int $tenantId): ?object
    {
        $shift = DB::table('vol_shifts')
            ->where('id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'opportunity_id', 'start_time', 'end_time', 'capacity']);
        if (! $shift) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
            return null;
        }

        if (! VolunteerService::userCanManageOpportunityById((int) $shift->opportunity_id, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return null;
        }

        return $shift;
    }

    /**
     * Validate a start/end pair. Accepts "Y-m-d H:i[:s]" or ISO 8601; an input
     * carrying a timezone is converted to the application's. Returns both as
     * "Y-m-d H:i:s" (how vol_shifts stores them), or null with an error recorded.
     *
     * @return array{0: string, 1: string}|null
     */
    private function parseWindow(mixed $startInput, mixed $endInput, bool $startMustBeFuture): ?array
    {
        $start = $this->parseDateTime($startInput);
        if ($start === null) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_input'), 'field' => 'start_time'];
            return null;
        }
        $end = $this->parseDateTime($endInput);
        if ($end === null) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_input'), 'field' => 'end_time'];
            return null;
        }
        if ($end <= $start) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_end_before_start'), 'field' => 'end_time'];
            return null;
        }
        if ($startMustBeFuture && $start->getTimestamp() <= time()) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_in_past'), 'field' => 'start_time'];
            return null;
        }

        return [$start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s')];
    }

    private function parseDateTime(mixed $value): ?\DateTimeImmutable
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            $parsed = new \DateTimeImmutable(trim($value));
        } catch (\Throwable) {
            return null;
        }

        return $parsed->setTimezone(new \DateTimeZone((string) config('app.timezone', 'UTC')));
    }

    /**
     * Places on the shift: null (unlimited), or an integer no lower than the
     * places already taken. Returns false with an error recorded when invalid.
     */
    private function parseCapacity(array $data, int $taken): int|null|false
    {
        $raw = $data['capacity'] ?? null;
        if ($raw === null || $raw === '') {
            return null;
        }
        if (! is_numeric($raw) || (int) $raw != $raw || (int) $raw < 1) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_input'), 'field' => 'capacity'];
            return false;
        }
        $capacity = (int) $raw;
        if ($capacity < $taken) {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.volunteer_shift_capacity_below_signups', ['count' => $taken]),
                'field' => 'capacity',
            ];
            return false;
        }

        return $capacity;
    }

    private function placesTaken(int $shiftId, int $tenantId): int
    {
        $signedUp = (int) DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->count();
        $reserved = (int) DB::table('vol_shift_group_reservations')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->sum('reserved_slots');

        return $signedUp + $reserved;
    }

    /** Same shape as VolunteerService::getShiftsForOpportunity() returns per shift. */
    private function formatShift(int $shiftId, int $tenantId): ?array
    {
        $shift = DB::table('vol_shifts')
            ->where('id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'start_time', 'end_time', 'capacity', 'recurring_pattern_id']);
        if (! $shift) {
            return null;
        }
        $signedUp = (int) DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->count();
        $reserved = (int) DB::table('vol_shift_group_reservations')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->sum('reserved_slots');
        $capacity = $shift->capacity ? (int) $shift->capacity : null;

        return [
            'id'                   => (int) $shift->id,
            'start_time'           => $shift->start_time,
            'end_time'             => $shift->end_time,
            'capacity'             => $capacity,
            'signup_count'         => $signedUp,
            'reserved_count'       => $reserved,
            'spots_available'      => $capacity ? max(0, $capacity - $signedUp - $reserved) : null,
            'recurring_pattern_id' => $shift->recurring_pattern_id ? (int) $shift->recurring_pattern_id : null,
        ];
    }

    private function notifyShiftCancelled(int $userId, string $opportunityTitle, string $startTime): void
    {
        try {
            $locale = DB::table('users')->where('id', $userId)->value('preferred_language');
            $localeInput = is_string($locale) && $locale !== '' ? $locale : null;

            LocaleContext::withLocale($localeInput, function () use ($userId, $opportunityTitle, $startTime): void {
                $content = __('svc_notifications.shift.cancelled', [
                    'title' => $opportunityTitle,
                    'date'  => date('j M Y H:i', strtotime($startTime) ?: time()),
                ]);
                NotificationDispatcher::dispatch(
                    $userId,
                    'global',
                    null,
                    'vol_shift_cancelled',
                    $content,
                    '/volunteering?tab=applications',
                    null,
                    false
                );
            });
        } catch (\Throwable $e) {
            // Telling the volunteer must never undo the removal itself.
            Log::warning('[VolunteerShiftManagement] notification failed: ' . $e->getMessage());
        }
    }
}
