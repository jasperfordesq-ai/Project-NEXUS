<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Group;
use App\Models\VolShift;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ShiftGroupReservationService — Laravel DI-based service for group shift reservations.
 *
 * Allows group leaders to reserve blocks of shift slots for their teams.
 */
class ShiftGroupReservationService
{
    private static array $errors = [];

    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Create a group reservation for a shift.
     *
     * @return int|null Reservation ID or null on failure
     */
    public static function reserve(int $shiftId, int $groupId, int $reservedBy, int $slots, ?string $notes = null): ?int
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        if ($slots < 1) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_reservation_min_slots'), 'field' => 'reserved_slots'];
            return null;
        }

        $shift = VolShift::find($shiftId);
        if (! $shift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
            return null;
        }

        if ($shift->start_time->isPast()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_reservation_shift_started')];
            return null;
        }

        $publicShift = DB::table('vol_shifts as s')
            ->join('vol_opportunities as opp', function ($join) {
                $join->on('s.opportunity_id', '=', 'opp.id')
                    ->on('s.tenant_id', '=', 'opp.tenant_id');
            })
            ->join('vol_organizations as org', function ($join) {
                $join->on('opp.organization_id', '=', 'org.id')
                    ->on('opp.tenant_id', '=', 'org.tenant_id');
            })
            ->where('s.id', $shiftId)
            ->where('s.tenant_id', $tenantId)
            ->where('opp.is_active', true)
            ->whereIn('opp.status', ['open', 'active'])
            ->whereIn('org.status', ['approved', 'active'])
            ->exists();

        if (! $publicShift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_opportunity_not_active')];
            return null;
        }

        // Verify group exists
        $group = Group::find($groupId);
        if (! $group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return null;
        }

        if (! GroupAccessService::canIntegrate($groupId, $reservedBy)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.shift_reservation_leader_only_reserve')];
            return null;
        }

        try {
            return DB::transaction(function () use ($shiftId, $groupId, $reservedBy, $slots, $notes, $tenantId) {
                $lockedShift = DB::table('vol_shifts as s')
                    ->join('vol_opportunities as opp', function ($join) {
                        $join->on('s.opportunity_id', '=', 'opp.id')
                            ->on('s.tenant_id', '=', 'opp.tenant_id');
                    })
                    ->join('vol_organizations as org', function ($join) {
                        $join->on('opp.organization_id', '=', 'org.id')
                            ->on('opp.tenant_id', '=', 'org.tenant_id');
                    })
                    ->where('s.id', $shiftId)
                    ->where('s.tenant_id', $tenantId)
                    ->select([
                        's.id',
                        's.capacity',
                        's.start_time',
                        'opp.is_active as opportunity_is_active',
                        'opp.status as opportunity_status',
                        'org.status as organization_status',
                    ])
                    ->lockForUpdate()
                    ->first();

                if (! $lockedShift
                    || (int) ($lockedShift->opportunity_is_active ?? 0) !== 1
                    || ! in_array((string) ($lockedShift->opportunity_status ?? ''), ['open', 'active'], true)
                    || ! in_array((string) ($lockedShift->organization_status ?? ''), ['approved', 'active'], true)
                ) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_opportunity_not_active')];
                    return null;
                }

                if (strtotime((string) $lockedShift->start_time) < time()) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_reservation_shift_started')];
                    return null;
                }

                $capacity = $lockedShift->capacity !== null ? (int) $lockedShift->capacity : null;
                $availableSlots = VolunteerShiftCapacityService::availableSlots($shiftId, $tenantId, $capacity);
                if ($availableSlots !== null && $slots > $availableSlots) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_reservation_slots_available', ['count' => $availableSlots]), 'field' => 'reserved_slots'];
                    return null;
                }

                $existing = DB::table('vol_shift_group_reservations')
                    ->where('shift_id', $shiftId)
                    ->where('group_id', $groupId)
                    ->where('status', 'active')
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->exists();

                if ($existing) {
                    self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.shift_reservation_already_exists')];
                    return null;
                }

                return DB::table('vol_shift_group_reservations')->insertGetId([
                    'tenant_id'      => $tenantId,
                    'shift_id'       => $shiftId,
                    'group_id'       => $groupId,
                    'reserved_slots' => $slots,
                    'filled_slots'   => 0,
                    'reserved_by'    => $reservedBy,
                    'status'         => 'active',
                    'notes'          => $notes,
                    'created_at'     => now(),
                ]);
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::reserve error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_create_failed')];
            return null;
        }
    }

    /**
     * Add a member to a group reservation.
     */
    public static function addMember(int $reservationId, int $userId, int $leaderUserId): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $reservation = DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->where('status', 'active')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $reservation) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_reservation_not_found')];
            return false;
        }

        if (! self::canManageReservation((int) $reservation->group_id, (int) $reservation->reserved_by, $leaderUserId, $tenantId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.shift_reservation_leader_only_manage')];
            return false;
        }

        // The member being added must be a real user of THIS tenant. Without this
        // guard a leader could add an arbitrary user id — including one from another
        // tenant, which then leaked that user's name/avatar through the roster join.
        $targetIsTenantUser = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (! $targetIsTenantUser) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_user')];
            return false;
        }

        // Safeguarding: a group leader must not be able to add a minor onto a
        // shift roster without the guardian consent every individual apply/
        // signup path requires. Resolve the reservation's opportunity and apply
        // the same centralised gate.
        $opportunityId = (int) DB::table('vol_shifts')
            ->where('id', (int) $reservation->shift_id)
            ->where('tenant_id', $tenantId)
            ->value('opportunity_id');
        if ($opportunityId > 0 && ($guardianError = VolunteerService::guardianConsentError($userId, $opportunityId))) {
            self::$errors[] = $guardianError;
            return false;
        }

        $policy = app(SafeguardingInteractionPolicy::class);
        if ($leaderUserId !== $userId) {
            $policy->assertLocalContactAllowed(
                $leaderUserId,
                $userId,
                $tenantId,
                'volunteer_group_reservation_member_add',
            );
            $policy->assertLocalContactAllowed(
                $userId,
                $leaderUserId,
                $tenantId,
                'volunteer_group_reservation_member_add',
            );
        }

        $organizer = DB::table('vol_opportunities as opp')
            ->join('vol_organizations as org', function ($join): void {
                $join->on('opp.organization_id', '=', 'org.id')
                    ->on('opp.tenant_id', '=', 'org.tenant_id');
            })
            ->where('opp.id', $opportunityId)
            ->where('opp.tenant_id', $tenantId)
            ->select(['opp.created_by', 'org.user_id as organization_owner_id'])
            ->first();
        $organizerId = (int) ($organizer->created_by ?? $organizer->organization_owner_id ?? 0);
        if ($organizerId > 0 && $organizerId !== $userId) {
            $policy->assertLocalContactAllowed(
                $userId,
                $organizerId,
                $tenantId,
                'volunteer_group_reservation_placement',
            );
            $policy->assertLocalContactAllowed(
                $organizerId,
                $userId,
                $tenantId,
                'volunteer_group_reservation_placement',
            );
        }

        try {
            return DB::transaction(function () use ($reservationId, $userId, $tenantId) {
                // Lock the reservation row so concurrent addMember calls can't
                // both pass the capacity check and overbook the slots.
                $locked = DB::table('vol_shift_group_reservations')
                    ->where('id', $reservationId)
                    ->where('status', 'active')
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (! $locked) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_reservation_not_found')];
                    return false;
                }

                if ((int) $locked->filled_slots >= (int) $locked->reserved_slots) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_reservation_slots_filled')];
                    return false;
                }

                // A removed member keeps a 'cancelled' row (unique on
                // reservation_id+user_id), so re-adding must update it
                // rather than insert a duplicate.
                $existing = DB::table('vol_shift_group_members')
                    ->where('reservation_id', $reservationId)
                    ->where('user_id', $userId)
                    ->lockForUpdate()
                    ->first();

                if ($existing && $existing->status === 'confirmed') {
                    self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.shift_reservation_member_already_added')];
                    return false;
                }

                if ($existing) {
                    DB::table('vol_shift_group_members')
                        ->where('id', $existing->id)
                        ->update(['status' => 'confirmed', 'tenant_id' => $tenantId]);
                } else {
                    DB::table('vol_shift_group_members')->insert([
                        'reservation_id' => $reservationId,
                        'tenant_id'      => $tenantId,
                        'user_id'        => $userId,
                        'status'         => 'confirmed',
                        'created_at'     => now(),
                    ]);
                }

                DB::table('vol_shift_group_reservations')
                    ->where('id', $reservationId)
                    ->where('tenant_id', $tenantId)
                    ->increment('filled_slots');

                return true;
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::addMember error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_add_member_failed')];
            return false;
        }
    }

    /**
     * Remove a member from a group reservation.
     */
    public static function removeMember(int $reservationId, int $userId, int $leaderUserId): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $reservation = DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $reservation) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_reservation_not_found')];
            return false;
        }

        if (! self::canManageReservation((int) $reservation->group_id, (int) $reservation->reserved_by, $leaderUserId, $tenantId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.shift_reservation_leader_only_manage')];
            return false;
        }

        $member = DB::table('vol_shift_group_members')
            ->where('reservation_id', $reservationId)
            ->where('user_id', $userId)
            ->where('status', 'confirmed')
            ->first();

        if (! $member) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_reservation_member_not_found')];
            return false;
        }

        try {
            return DB::transaction(function () use ($member, $reservationId, $tenantId) {
                DB::table('vol_shift_group_members')
                    ->where('id', $member->id)
                    ->update(['status' => 'cancelled']);

                DB::table('vol_shift_group_reservations')
                    ->where('id', $reservationId)
                    ->where('tenant_id', $tenantId)
                    ->update(['filled_slots' => DB::raw('GREATEST(filled_slots - 1, 0)')]);

                return true;
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::removeMember error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_remove_member_failed')];
            return false;
        }
    }

    /**
     * Cancel an entire group reservation.
     */
    public static function cancelReservation(int $reservationId, int $leaderUserId): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $reservation = DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->where('status', 'active')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $reservation) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_reservation_not_found')];
            return false;
        }

        if (! self::canManageReservation((int) $reservation->group_id, (int) $reservation->reserved_by, $leaderUserId, $tenantId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.shift_reservation_leader_only_cancel')];
            return false;
        }

        try {
            return DB::transaction(function () use ($reservationId, $tenantId) {
                DB::table('vol_shift_group_reservations')
                    ->where('id', $reservationId)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'cancelled']);

                DB::table('vol_shift_group_members')
                    ->where('reservation_id', $reservationId)
                    ->update(['status' => 'cancelled']);

                return true;
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::cancelReservation error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_cancel_failed')];
            return false;
        }
    }

    /**
     * Get all group reservations a user is involved in (as leader or member).
     */
    public static function getUserReservations(int $userId, int $tenantId): array
    {
        try {
            $rows = DB::table('vol_shift_group_reservations as r')
                ->join('vol_shifts as s', 'r.shift_id', '=', 's.id')
                ->join('vol_opportunities as opp', 's.opportunity_id', '=', 'opp.id')
                ->leftJoin('vol_organizations as org', 'opp.organization_id', '=', 'org.id')
                ->leftJoin('vol_shift_group_members as gm', function ($join) use ($userId) {
                    $join->on('gm.reservation_id', '=', 'r.id')
                         ->where('gm.user_id', '=', $userId)
                         ->where('gm.status', '=', 'confirmed');
                })
                ->where('r.tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('r.reserved_by', $userId)
                      ->orWhereNotNull('gm.id');
                })
                ->distinct()
                ->orderBy('s.start_time')
                ->select(
                    'r.id', 'r.reserved_slots', 'r.filled_slots', 'r.reserved_by',
                    'r.status', 'r.notes', 'r.created_at', 'r.group_id',
                    's.id as shift_id', 's.start_time', 's.end_time',
                    'opp.id as opportunity_id', 'opp.title as opportunity_title', 'opp.location as opportunity_location',
                    'org.id as organization_id', 'org.name as organization_name', 'org.logo_url as organization_logo_url'
                )
                ->get();

            return $rows->map(function ($row) use ($tenantId, $userId) {
                $groupName = '';
                $group = Group::find((int) $row->group_id);
                if ($group) {
                    $groupName = $group->name;
                }

                // Get members
                // All statuses included — the frontend renders pending/declined
                // icons. Shape is flat {id, name, avatar_url, status} (the old
                // nested {user: {...}} shape rendered blank member lists).
                $memberRows = DB::table('vol_shift_group_members as gm')
                    ->join('vol_shift_group_reservations as r', 'gm.reservation_id', '=', 'r.id')
                    ->join('users as u', function ($join) use ($tenantId) {
                        // Tenant-scope the users join so a stray cross-tenant member
                        // row can never leak another tenant's name/avatar.
                        $join->on('gm.user_id', '=', 'u.id')
                             ->where('u.tenant_id', '=', $tenantId);
                    })
                    ->where('gm.reservation_id', $row->id)
                    ->where('r.tenant_id', $tenantId)
                    ->orderBy('gm.created_at')
                    ->select('gm.user_id', 'gm.status', 'gm.created_at', 'u.name as user_name', 'u.avatar_url as user_avatar')
                    ->get();

                $members = $memberRows->map(function ($m) {
                    return [
                        'id'         => (int) $m->user_id,
                        'name'       => $m->user_name,
                        'avatar_url' => $m->user_avatar,
                        'status'     => $m->status,
                        'created_at' => $m->created_at,
                    ];
                })->all();

                return [
                    'id'           => (int) $row->id,
                    'group_name'   => $groupName,
                    'status'       => $row->status,
                    'is_leader'    => (int) $row->reserved_by === $userId,
                    'shift'        => [
                        'id'         => (int) $row->shift_id,
                        'start_time' => $row->start_time,
                        'end_time'   => $row->end_time,
                    ],
                    'opportunity'  => [
                        'id'       => (int) $row->opportunity_id,
                        'title'    => $row->opportunity_title,
                        'location' => $row->opportunity_location ?? '',
                    ],
                    'organization' => [
                        'id'       => $row->organization_id ? (int) $row->organization_id : 0,
                        'name'     => $row->organization_name ?? '',
                        'logo_url' => $row->organization_logo_url ?? null,
                    ],
                    'members'      => $members,
                    'max_members'  => $row->reserved_slots !== null ? (int) $row->reserved_slots : null,
                    'created_at'   => $row->created_at,
                ];
            })->all();
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::getUserReservations error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Calculate available slots for a shift (accounting for regular signups + group reservations).
     */
    private static function getAvailableSlots(int $shiftId, VolShift $shift): ?int
    {
        $tenantId = TenantContext::getId();
        $capacity = $shift->capacity ? (int) $shift->capacity : null;

        return VolunteerShiftCapacityService::availableSlots($shiftId, $tenantId, $capacity);
    }

    private static function canManageReservation(int $groupId, int $reservedBy, int $userId, int $tenantId): bool
    {
        if ($reservedBy === $userId) {
            return true;
        }

        return self::canManageGroup($groupId, $userId, $tenantId);
    }

    private static function canManageGroup(int $groupId, int $userId, int $tenantId): bool
    {
        return (int) TenantContext::getId() === $tenantId
            && GroupAccessService::canManage($groupId, $userId);
    }

    private static function isTenantAdmin(int $userId, int $tenantId): bool
    {
        $role = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('role');

        return in_array($role, ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'], true);
    }
}
