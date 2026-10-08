<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\FormattingLocale;
use App\I18n\LocaleContext;
use App\Models\Group;
use App\Models\VolShift;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ShiftGroupReservationService — Laravel DI-based service for group shift reservations.
 *
 * Allows group leaders to reserve blocks of shift slots for their teams, then
 * name the members one by one. A named member is a real sign-up on the shift
 * (an approved vol_applications row, as an ordinary sign-up creates), so they
 * appear in My shifts, can check in and earn hours; the reservation holds
 * their place, so the capacity service counts them once, through it.
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

        // The reservation's shift: its opportunity for the organiser contact check
        // below, and its start for the sign-up the member is about to receive.
        $shift = DB::table('vol_shifts')
            ->where('id', (int) $reservation->shift_id)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'opportunity_id', 'start_time']);
        if (! $shift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
            return false;
        }
        if (strtotime((string) $shift->start_time) < time()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
            return false;
        }
        $shiftId = (int) $shift->id;
        $opportunityId = (int) $shift->opportunity_id;

        // A member the organisation has declined for this opportunity cannot be
        // brought in through the group instead.
        $applications = DB::table('vol_applications')
            ->where('opportunity_id', $opportunityId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->get(['id', 'status', 'shift_id']);
        if ($applications->isNotEmpty() && $applications->every(fn ($row) => $row->status === 'declined')) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_reservation_member_declined')];
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
            $previousShiftId = null;
            $ok = DB::transaction(function () use ($reservationId, $userId, $tenantId, $shiftId, $opportunityId, &$previousShiftId) {
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

                // The member becomes a real sign-up on the shift. The reservation
                // row lock above is the capacity check: the place was reserved
                // when the leader booked it, so the shift's own capacity is not
                // consulted (it would read as full once ordinary volunteers took
                // the unreserved places).
                $previousShiftId = self::signUpMember($opportunityId, $shiftId, $userId, $tenantId);

                return true;
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::addMember error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_add_member_failed')];
            return false;
        }

        if (! $ok) {
            return false;
        }

        // Moving the member off another shift of the same opportunity frees a
        // place there — offer it to that shift's waitlist (as an ordinary sign-up
        // change does). After the commit, never under the row locks.
        if ($previousShiftId !== null && $previousShiftId !== $shiftId) {
            ShiftWaitlistService::notifyNext($previousShiftId, $tenantId);
        }

        if ($userId !== $leaderUserId) {
            self::notifyMemberAdded($reservationId, $userId, $leaderUserId, $tenantId);
        }

        return true;
    }

    /**
     * Remove a member from a group reservation. The leader (or a group admin)
     * can remove anyone; a member can remove themselves.
     */
    public static function removeMember(int $reservationId, int $userId, int $actorUserId): bool
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

        $isSelf = $userId === $actorUserId;
        if (! $isSelf && ! self::canManageReservation((int) $reservation->group_id, (int) $reservation->reserved_by, $actorUserId, $tenantId)) {
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
            DB::transaction(function () use ($member, $reservation, $reservationId, $userId, $tenantId): void {
                DB::table('vol_shift_group_members')
                    ->where('id', $member->id)
                    ->update(['status' => 'cancelled']);

                DB::table('vol_shift_group_reservations')
                    ->where('id', $reservationId)
                    ->where('tenant_id', $tenantId)
                    ->update(['filled_slots' => DB::raw('GREATEST(filled_slots - 1, 0)')]);

                // The place goes back to the group, not the public pool, so the
                // member's sign-up on the shift is released without a waitlist offer.
                self::releaseSignUps((int) $reservation->shift_id, [$userId], $tenantId);
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::removeMember error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_remove_member_failed')];
            return false;
        }

        if ($isSelf) {
            if ((int) $reservation->reserved_by !== $userId) {
                self::notifyReservation((int) $reservation->reserved_by, 'vol_group_signup_left', 'svc_notifications.group_signup.left', $reservationId, $tenantId, ['member_id' => $userId]);
            }
        } else {
            self::notifyReservation($userId, 'vol_group_signup_removed', 'svc_notifications.group_signup.removed', $reservationId, $tenantId);
        }

        return true;
    }

    /**
     * Cancel an entire group reservation (leader or group admin).
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

        return self::performCancellation($reservation, $tenantId, $leaderUserId);
    }

    /**
     * Cancel a group reservation on a community admin's authority. The admin
     * endpoints only ever see their own community's bookings.
     */
    public static function cancelForAdmin(int $tenantId, int $reservationId, int $adminUserId): bool
    {
        self::$errors = [];

        $reservation = DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->where('status', 'active')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $reservation) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_reservation_not_found')];
            return false;
        }

        return self::performCancellation($reservation, $tenantId, $adminUserId);
    }

    /**
     * Cancels the reservation, every member's place and every member's sign-up
     * on the shift, then tells everyone affected (bar the person who did it).
     */
    private static function performCancellation(object $reservation, int $tenantId, int $actorUserId): bool
    {
        $reservationId = (int) $reservation->id;
        $shiftId = (int) $reservation->shift_id;
        $memberIds = [];

        try {
            DB::transaction(function () use ($reservationId, $shiftId, $tenantId, &$memberIds): void {
                $memberIds = DB::table('vol_shift_group_members')
                    ->where('reservation_id', $reservationId)
                    ->where('status', 'confirmed')
                    ->pluck('user_id')
                    ->map(fn ($id) => (int) $id)
                    ->all();

                DB::table('vol_shift_group_reservations')
                    ->where('id', $reservationId)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'cancelled']);

                DB::table('vol_shift_group_members')
                    ->where('reservation_id', $reservationId)
                    ->update(['status' => 'cancelled']);

                self::releaseSignUps($shiftId, $memberIds, $tenantId);
            });
        } catch (\Exception $e) {
            Log::error('ShiftGroupReservationService::cancelReservation error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_reservation_cancel_failed')];
            return false;
        }

        $recipients = array_unique(array_merge($memberIds, [(int) $reservation->reserved_by]));
        foreach ($recipients as $recipientId) {
            if ($recipientId !== $actorUserId) {
                self::notifyReservation($recipientId, 'vol_group_signup_cancelled', 'svc_notifications.group_signup.cancelled', $reservationId, $tenantId);
            }
        }

        // The reserved places are public again — offer one to the shift's waitlist.
        ShiftWaitlistService::notifyNext($shiftId, $tenantId);

        return true;
    }

    /**
     * Give a group member the same sign-up an ordinary volunteer gets: an
     * approved application on the opportunity carrying this shift. Runs inside
     * the caller's transaction.
     *
     * @return int|null The shift the member was signed up to before, when this moved them.
     */
    private static function signUpMember(int $opportunityId, int $shiftId, int $userId, int $tenantId): ?int
    {
        $applications = DB::table('vol_applications')
            ->where('opportunity_id', $opportunityId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['approved', 'pending'])
            ->lockForUpdate()
            ->get(['id', 'status', 'shift_id']);

        $application = $applications->firstWhere('status', 'approved') ?? $applications->first();
        if ($application) {
            $previousShiftId = $application->shift_id !== null ? (int) $application->shift_id : null;
            if ($application->status === 'approved' && $previousShiftId === $shiftId) {
                // Already signed up on this shift as an ordinary volunteer: the
                // reservation now carries their place; nothing is duplicated.
                return null;
            }

            DB::table('vol_applications')
                ->where('id', $application->id)
                ->where('tenant_id', $tenantId)
                ->update(['status' => 'approved', 'shift_id' => $shiftId, 'updated_at' => now()]);

            return $previousShiftId;
        }

        DB::table('vol_applications')->insert([
            'tenant_id'      => $tenantId,
            'opportunity_id' => $opportunityId,
            'shift_id'       => $shiftId,
            'user_id'        => $userId,
            'status'         => 'approved',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        return null;
    }

    /**
     * Take the given members off the shift (their application stays, as after an
     * ordinary cancellation). Runs inside the caller's transaction.
     *
     * @param int[] $userIds
     */
    private static function releaseSignUps(int $shiftId, array $userIds, int $tenantId): void
    {
        if ($userIds === []) {
            return;
        }

        DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $userIds)
            ->update(['shift_id' => null, 'updated_at' => now()]);
    }

    // ── Admin ──

    /**
     * Every group reservation in the community, newest shift first.
     *
     * @param array{q?: string, status?: string, page?: int, per_page?: int} $filters
     * @return array{items: array<int, array<string, mixed>>, total: int, counts: array{active: int, cancelled: int}}
     */
    public static function listForAdmin(int $tenantId, array $filters = []): array
    {
        $perPage = max(1, min(100, (int) ($filters['per_page'] ?? 25)));
        $page = max(1, (int) ($filters['page'] ?? 1));

        $base = DB::table('vol_shift_group_reservations as r')
            ->join('vol_shifts as s', function ($join) use ($tenantId): void {
                $join->on('r.shift_id', '=', 's.id')->where('s.tenant_id', '=', $tenantId);
            })
            ->join('vol_opportunities as opp', function ($join) use ($tenantId): void {
                $join->on('s.opportunity_id', '=', 'opp.id')->where('opp.tenant_id', '=', $tenantId);
            })
            ->leftJoin('vol_organizations as org', function ($join) use ($tenantId): void {
                $join->on('opp.organization_id', '=', 'org.id')->where('org.tenant_id', '=', $tenantId);
            })
            ->leftJoin('groups as g', function ($join) use ($tenantId): void {
                $join->on('r.group_id', '=', 'g.id')->where('g.tenant_id', '=', $tenantId);
            })
            ->leftJoin('users as l', function ($join) use ($tenantId): void {
                $join->on('r.reserved_by', '=', 'l.id')->where('l.tenant_id', '=', $tenantId);
            })
            ->where('r.tenant_id', $tenantId);

        $counts = [
            'active' => (clone $base)->where('r.status', 'active')->count(),
            'cancelled' => (clone $base)->where('r.status', 'cancelled')->count(),
        ];

        $q = trim((string) ($filters['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $base->where(function ($query) use ($like): void {
                $query->where('g.name', 'like', $like)
                    ->orWhere('opp.title', 'like', $like)
                    ->orWhere('l.first_name', 'like', $like)
                    ->orWhere('l.last_name', 'like', $like)
                    ->orWhere('l.name', 'like', $like)
                    ->orWhere('l.organization_name', 'like', $like);
            });
        }
        $status = (string) ($filters['status'] ?? '');
        if (in_array($status, ['active', 'cancelled'], true)) {
            $base->where('r.status', $status);
        }

        $total = (clone $base)->count();
        $rows = $base
            ->select([
                'r.id', 'r.status', 'r.reserved_slots', 'r.filled_slots', 'r.notes', 'r.created_at',
                's.id as shift_id', 's.start_time', 's.end_time',
                'opp.id as opportunity_id', 'opp.title as opportunity_title',
                'org.id as organization_id', 'org.name as organization_name',
                'g.id as group_id', 'g.name as group_name',
                'l.id as leader_id', DB::raw(UserDisplayName::sql('l', 'leader_name')), 'l.avatar_url as leader_avatar_url',
            ])
            ->orderByDesc('s.start_time')
            ->orderByDesc('r.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        $membersByReservation = DB::table('vol_shift_group_members as gm')
            ->join('users as u', function ($join) use ($tenantId): void {
                $join->on('gm.user_id', '=', 'u.id')->where('u.tenant_id', '=', $tenantId);
            })
            ->whereIn('gm.reservation_id', $rows->pluck('id')->all())
            ->where('gm.status', 'confirmed')
            ->orderBy('gm.created_at')
            ->get(['gm.reservation_id', 'u.id', DB::raw(UserDisplayName::sql('u', 'name')), 'u.avatar_url'])
            ->groupBy('reservation_id');

        $items = $rows->map(fn ($row) => [
            'id' => (int) $row->id,
            'status' => $row->status,
            'reserved_slots' => (int) $row->reserved_slots,
            'filled_slots' => (int) $row->filled_slots,
            'notes' => $row->notes,
            'created_at' => $row->created_at,
            'shift' => ['id' => (int) $row->shift_id, 'start_time' => $row->start_time, 'end_time' => $row->end_time],
            'opportunity' => ['id' => (int) $row->opportunity_id, 'title' => (string) $row->opportunity_title],
            'organization' => $row->organization_id ? ['id' => (int) $row->organization_id, 'name' => (string) $row->organization_name] : null,
            'group' => $row->group_id ? ['id' => (int) $row->group_id, 'name' => (string) $row->group_name] : null,
            'leader' => $row->leader_id ? ['id' => (int) $row->leader_id, 'name' => (string) $row->leader_name, 'avatar_url' => $row->leader_avatar_url] : null,
            'members' => ($membersByReservation->get($row->id) ?? collect())->map(fn ($m) => [
                'id' => (int) $m->id,
                'name' => (string) $m->name,
                'avatar_url' => $m->avatar_url,
            ])->values()->all(),
        ])->all();

        return ['items' => $items, 'total' => $total, 'counts' => $counts];
    }

    // ── Notifications ──

    /**
     * What a notification about this reservation needs to say: who leads it, the
     * group, the opportunity and when the shift is.
     *
     * @return array{leader_name: string, group_name: string, opportunity_title: string, shift_start: ?string, shift_id: int, opportunity_id: int}|null
     */
    private static function reservationContext(int $reservationId, int $tenantId): ?array
    {
        $row = DB::table('vol_shift_group_reservations as r')
            ->join('vol_shifts as s', 'r.shift_id', '=', 's.id')
            ->join('vol_opportunities as opp', 's.opportunity_id', '=', 'opp.id')
            ->leftJoin('groups as g', 'r.group_id', '=', 'g.id')
            ->leftJoin('users as l', 'r.reserved_by', '=', 'l.id')
            ->where('r.id', $reservationId)
            ->where('r.tenant_id', $tenantId)
            ->first(['s.id as shift_id', 's.start_time', 'opp.id as opportunity_id', 'opp.title', 'g.name as group_name', DB::raw(UserDisplayName::sql('l', 'leader_name'))]);
        if (! $row) {
            return null;
        }

        return [
            'leader_name' => (string) ($row->leader_name ?? ''),
            'group_name' => (string) ($row->group_name ?? ''),
            'opportunity_title' => (string) $row->title,
            'shift_start' => $row->start_time ? (string) $row->start_time : null,
            'shift_id' => (int) $row->shift_id,
            'opportunity_id' => (int) $row->opportunity_id,
        ];
    }

    /** The shift date, written the way the recipient's language writes it (call inside LocaleContext). */
    private static function localisedShiftDate(?string $shiftStart): string
    {
        return $shiftStart
            ? \Carbon\Carbon::parse($shiftStart)->locale(FormattingLocale::carbon())->isoFormat('lll')
            : '';
    }

    /**
     * Bell + email: the leader signed this member up. Rendered in the member's
     * language, after the commit.
     */
    private static function notifyMemberAdded(int $reservationId, int $memberId, int $leaderUserId, int $tenantId): void
    {
        try {
            $context = self::reservationContext($reservationId, $tenantId);
            $recipient = DB::table('users')->where('id', $memberId)->where('tenant_id', $tenantId)->first(['id', 'preferred_language']);
            if (! $context || ! $recipient) {
                return;
            }

            $leader = DB::table('users')->where('id', $leaderUserId)->where('tenant_id', $tenantId)->first();
            $leaderName = $leader ? UserDisplayName::resolve($leader) : $context['leader_name'];
            $link = '/volunteering?tab=group-signups&reservation=' . $reservationId;

            LocaleContext::withLocale($recipient, function () use ($memberId, $context, $leaderName, $link): void {
                $params = [
                    'leader' => $leaderName,
                    'group' => $context['group_name'],
                    'opportunity' => $context['opportunity_title'],
                    'date' => self::localisedShiftDate($context['shift_start']),
                ];
                NotificationDispatcher::dispatch(
                    $memberId,
                    'global',
                    null,
                    'vol_group_signup_added',
                    __('svc_notifications.group_signup.added', $params),
                    $link,
                    self::buildMemberAddedEmail($params, $link)
                );
            });
        } catch (\Throwable $e) {
            Log::warning('ShiftGroupReservationService: member-added notification failed: ' . $e->getMessage());
        }
    }

    /**
     * Bell (and, for the types the dispatcher treats as instant, an email) about
     * a reservation changing under someone: a member left, was removed, or the
     * whole booking was cancelled. Rendered in the recipient's language.
     *
     * @param array{member_id?: int} $extra
     */
    private static function notifyReservation(int $recipientId, string $activityType, string $contentKey, int $reservationId, int $tenantId, array $extra = []): void
    {
        try {
            $context = self::reservationContext($reservationId, $tenantId);
            $recipient = DB::table('users')->where('id', $recipientId)->where('tenant_id', $tenantId)->first(['id', 'preferred_language']);
            if (! $context || ! $recipient) {
                return;
            }

            $memberName = '';
            if (isset($extra['member_id'])) {
                $member = DB::table('users')->where('id', (int) $extra['member_id'])->where('tenant_id', $tenantId)->first();
                $memberName = $member ? UserDisplayName::resolve($member) : '';
            }
            // The id suffixes keep two events a minute apart from being treated
            // as one bell by the dispatcher's type+link duplicate window.
            $link = '/volunteering?tab=group-signups&reservation=' . $reservationId
                . (isset($extra['member_id']) ? '&member=' . (int) $extra['member_id'] : '');

            LocaleContext::withLocale($recipient, function () use ($recipientId, $activityType, $contentKey, $context, $memberName, $link): void {
                $content = __($contentKey, [
                    'member' => $memberName,
                    'group' => $context['group_name'],
                    'opportunity' => $context['opportunity_title'],
                    'date' => self::localisedShiftDate($context['shift_start']),
                ]);
                NotificationDispatcher::dispatch($recipientId, 'global', null, $activityType, $content, $link, null);
            });
        } catch (\Throwable $e) {
            Log::warning('ShiftGroupReservationService: reservation notification failed: ' . $e->getMessage());
        }
    }

    /**
     * The "you have been signed up" email. Call inside the recipient's LocaleContext.
     *
     * @param array{leader: string, group: string, opportunity: string, date: string} $params
     */
    private static function buildMemberAddedEmail(array $params, string $link): string
    {
        $tenant = TenantContext::get();
        $tenantName = htmlspecialchars((string) ($tenant['name'] ?? 'Community'), ENT_QUOTES, 'UTF-8');
        $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
        $e = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');

        $heading = $e(__('emails_volunteer.group_signup_added.title'));
        $community = $e(__('emails_notifications.volunteering.tenant_volunteering', ['community' => $tenantName]));
        $body = $e(__('emails_volunteer.group_signup_added.body', ['leader' => $params['leader'], 'group' => $params['group']]));
        $labelOpportunity = $e(__('emails_volunteer.group_signup_added.label_opportunity'));
        $labelWhen = $e(__('emails_volunteer.group_signup_added.label_when'));
        $labelGroup = $e(__('emails_volunteer.group_signup_added.label_group'));
        $signedUp = $e(__('emails_volunteer.group_signup_added.signed_up'));
        $leaveNote = $e(__('emails_volunteer.group_signup_added.leave_note'));
        $cta = $e(__('emails_volunteer.group_signup_added.cta'));
        $opportunity = $e($params['opportunity']);
        $date = $e($params['date']);
        $group = $e($params['group']);

        return <<<HTML
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #7c3aed; background-image: linear-gradient(135deg, #7c3aed, #db2777); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{$heading}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">{$community}</p>
    </div>
    <div style="background: #f8fafc; padding: 32px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">{$body}</p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelOpportunity}</p>
            <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0 0 12px;">{$opportunity}</p>
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelWhen}</p>
            <p style="color: #1e293b; font-size: 16px; margin: 0 0 12px;">{$date}</p>
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">{$labelGroup}</p>
            <p style="color: #1e293b; font-size: 16px; margin: 0;">{$group}</p>
        </div>
        <p style="color: #1e293b; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">{$signedUp}</p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">{$leaveNote}</p>
        <div style="text-align: center; margin-top: 24px;">
            <a href="{$url}" style="display: inline-block; background-color: #7c3aed; background-image: linear-gradient(135deg, #7c3aed, #db2777); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">{$cta}</a>
        </div>
    </div>
</div>
HTML;
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

                // Get members. Only confirmed ones: a removed member keeps a
                // 'cancelled' row (the unique key needs it for re-adding) and
                // is not part of the group any more. Shape is flat
                // {id, name, avatar_url, status} (the old nested {user: {...}}
                // shape rendered blank member lists).
                $memberRows = DB::table('vol_shift_group_members as gm')
                    ->join('vol_shift_group_reservations as r', 'gm.reservation_id', '=', 'r.id')
                    ->join('users as u', function ($join) use ($tenantId) {
                        // Tenant-scope the users join so a stray cross-tenant member
                        // row can never leak another tenant's name/avatar.
                        $join->on('gm.user_id', '=', 'u.id')
                             ->where('u.tenant_id', '=', $tenantId);
                    })
                    ->where('gm.reservation_id', $row->id)
                    ->where('gm.status', 'confirmed')
                    ->where('r.tenant_id', $tenantId)
                    ->orderBy('gm.created_at')
                    ->select('gm.user_id', 'gm.status', 'gm.created_at', DB::raw(UserDisplayName::sql('u', 'user_name')), 'u.avatar_url as user_avatar')
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
