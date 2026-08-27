<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\MemberAvailability;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * MemberAvailabilityService — Laravel DI-based service for member availability.
 *
 * Manages recurring weekly availability, specific-date slots, compatible time
 * matching, and available member queries.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class MemberAvailabilityService
{
    private array $errors = [];

    public function __construct(
        private readonly MemberAvailability $availability,
    ) {}

    /**
     * Get validation errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Get all availability slots for a user.
     */
    public function getAvailability(int $userId): array
    {
        return $this->availability->newQuery()
            ->where('user_id', $userId)
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->get()
            ->toArray();
    }

    /**
     * Get all availability slots for a user (alias).
     */
    public function getUserAvailability(int $userId): array
    {
        return $this->availability->newQuery()
            ->where('user_id', $userId)
            ->select('id', 'day_of_week', 'start_time', 'end_time', 'is_recurring', 'specific_date', 'note')
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->get()
            ->toArray();
    }

    /**
     * Set recurring availability for a user on a given day (replaces existing).
     *
     * @param int   $dayOfWeek 0=Sunday, 6=Saturday
     * @param array $slots     Array of ['start_time' => 'HH:MM', 'end_time' => 'HH:MM']
     */
    public function setAvailability(int $userId, int $dayOfWeek, array $slots): bool
    {
        if ($dayOfWeek < 0 || $dayOfWeek > 6) {
            return false;
        }

        return DB::transaction(function () use ($userId, $dayOfWeek, $slots) {
            $this->availability->newQuery()
                ->where('user_id', $userId)
                ->where('day_of_week', $dayOfWeek)
                ->where('is_recurring', true)
                ->delete();

            foreach ($slots as $slot) {
                if (empty($slot['start_time']) || empty($slot['end_time'])) {
                    continue;
                }
                if ($slot['start_time'] >= $slot['end_time']) {
                    continue;
                }

                $this->availability->newInstance([
                    'tenant_id'   => TenantContext::getId(),
                    'user_id'     => $userId,
                    'day_of_week' => $dayOfWeek,
                    'start_time'  => $slot['start_time'],
                    'end_time'    => $slot['end_time'],
                    'is_recurring' => true,
                    'note'        => $slot['note'] ?? null,
                ])->save();
            }

            return true;
        });
    }

    /**
     * Set availability for a user on a given day with validation errors.
     *
     * @param int   $dayOfWeek 0=Sunday, 6=Saturday
     * @param array $slots     Array of ['start_time' => 'HH:MM', 'end_time' => 'HH:MM', 'note' => '']
     */
    public function setDayAvailability(int $userId, int $dayOfWeek, array $slots): bool
    {
        $this->errors = [];

        if ($dayOfWeek < 0 || $dayOfWeek > 6) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'day_of_week must be 0-6', 'field' => 'day_of_week'];
            return false;
        }

        // Validate slots
        foreach ($slots as $i => $slot) {
            if (empty($slot['start_time']) || empty($slot['end_time'])) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => "Slot {$i}: start_time and end_time required", 'field' => 'slots'];
                return false;
            }
            if ($slot['start_time'] >= $slot['end_time']) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => "Slot {$i}: end_time must be after start_time", 'field' => 'slots'];
                return false;
            }
        }

        try {
            return DB::transaction(function () use ($userId, $dayOfWeek, $slots) {
                $this->availability->newQuery()
                    ->where('user_id', $userId)
                    ->where('day_of_week', $dayOfWeek)
                    ->where('is_recurring', true)
                    ->delete();

                foreach ($slots as $slot) {
                    $this->availability->newInstance([
                        'tenant_id'    => TenantContext::getId(),
                        'user_id'      => $userId,
                        'day_of_week'  => $dayOfWeek,
                        'start_time'   => $slot['start_time'],
                        'end_time'     => $slot['end_time'],
                        'is_recurring' => true,
                        'note'         => $slot['note'] ?? null,
                    ])->save();
                }

                return true;
            });
        } catch (\Exception $e) {
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => 'Failed to save availability'];
            return false;
        }
    }

    /**
     * Set a bulk availability schedule (all 7 days at once).
     *
     * Accepts either:
     * - Flat array: [['day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '17:00'], ...]
     * - Nested by day: ['0' => [['start_time' => '09:00', 'end_time' => '17:00']], '1' => [...], ...]
     */
    public function setBulkAvailability(int $userId, array $schedule): bool
    {
        $this->errors = [];

        // Detect flat array format (each item has day_of_week) and regroup by day
        if (!empty($schedule) && isset($schedule[0]['day_of_week'])) {
            $grouped = [];
            foreach ($schedule as $slot) {
                $day = (int) ($slot['day_of_week'] ?? -1);
                if ($day >= 0 && $day <= 6) {
                    $grouped[$day][] = $slot;
                }
            }
            $schedule = $grouped;
        }

        try {
            return DB::transaction(function () use ($userId, $schedule) {
                // Remove all recurring slots
                $this->availability->newQuery()
                    ->where('user_id', $userId)
                    ->where('is_recurring', true)
                    ->delete();

                foreach ($schedule as $dayOfWeek => $slots) {
                    $dayOfWeek = (int) $dayOfWeek;
                    if ($dayOfWeek < 0 || $dayOfWeek > 6) {
                        continue;
                    }

                    foreach ($slots as $slot) {
                        if (empty($slot['start_time']) || empty($slot['end_time'])) {
                            continue;
                        }
                        if ($slot['start_time'] >= $slot['end_time']) {
                            continue;
                        }

                        $this->availability->newInstance([
                            'tenant_id'    => TenantContext::getId(),
                            'user_id'      => $userId,
                            'day_of_week'  => $dayOfWeek,
                            'start_time'   => $slot['start_time'],
                            'end_time'     => $slot['end_time'],
                            'is_recurring' => true,
                            'note'         => $slot['note'] ?? null,
                        ])->save();
                    }
                }

                return true;
            });
        } catch (\Exception $e) {
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => 'Failed to save availability'];
            return false;
        }
    }

    /**
     * Add a one-off availability slot for a specific date.
     */
    public function addSpecificDate(int $userId, array $data): ?int
    {
        $this->errors = [];

        $date = $data['date'] ?? '';
        $startTime = $data['start_time'] ?? '';
        $endTime = $data['end_time'] ?? '';

        if (empty($date) || empty($startTime) || empty($endTime)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'date, start_time, and end_time are required'];
            return null;
        }

        if ($startTime >= $endTime) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'end_time must be after start_time'];
            return null;
        }

        $dayOfWeek = (int) date('w', strtotime($date));

        $slot = $this->availability->newInstance([
            'tenant_id'     => TenantContext::getId(),
            'user_id'       => $userId,
            'day_of_week'   => $dayOfWeek,
            'start_time'    => $startTime,
            'end_time'      => $endTime,
            'is_recurring'  => false,
            'specific_date' => $date,
            'note'          => $data['note'] ?? null,
        ]);
        $slot->save();

        return $slot->id;
    }

    /**
     * Delete an availability slot.
     */
    public function deleteSlot(int $userId, int $slotId): bool
    {
        return $this->availability->newQuery()
            ->where('id', $slotId)
            ->where('user_id', $userId)
            ->delete() > 0;
    }

    /**
     * Find compatible time slots between two users.
     *
     * @return array Overlapping day/time combinations.
     */
    public function findCompatible(int $userIdA, int $userIdB): array
    {
        $slotsA = collect($this->getAvailability($userIdA))->groupBy('day_of_week');
        $slotsB = collect($this->getAvailability($userIdB))->groupBy('day_of_week');

        $compatible = [];

        foreach ($slotsA as $day => $daySlots) {
            if (! isset($slotsB[$day])) {
                continue;
            }

            foreach ($daySlots as $a) {
                foreach ($slotsB[$day] as $b) {
                    $overlapStart = max($a['start_time'], $b['start_time']);
                    $overlapEnd = min($a['end_time'], $b['end_time']);

                    if ($overlapStart < $overlapEnd) {
                        $compatible[] = [
                            'day_of_week' => (int) $day,
                            'start_time'  => $overlapStart,
                            'end_time'    => $overlapEnd,
                        ];
                    }
                }
            }
        }

        return $compatible;
    }

    /**
     * Find compatible times between two members (full version with day names).
     */
    public function findCompatibleTimes(int $userId1, int $userId2): array
    {
        $dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        $rows = $this->availability->newQuery()
            ->whereIn('user_id', [$userId1, $userId2])
            ->where('is_recurring', true)
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->get();

        // Group by day and user
        $byDay = [];
        foreach ($rows as $row) {
            $day = $row->day_of_week;
            $uid = $row->user_id;
            $byDay[$day][$uid][] = [
                'start' => $row->start_time,
                'end'   => $row->end_time,
            ];
        }

        $compatible = [];

        foreach ($byDay as $day => $users) {
            if (! isset($users[$userId1]) || ! isset($users[$userId2])) {
                continue;
            }

            foreach ($users[$userId1] as $slot1) {
                foreach ($users[$userId2] as $slot2) {
                    $overlapStart = max($slot1['start'], $slot2['start']);
                    $overlapEnd = min($slot1['end'], $slot2['end']);

                    if ($overlapStart < $overlapEnd) {
                        $compatible[] = [
                            'day_of_week' => $day,
                            'day_name'    => $dayNames[$day],
                            'start_time'  => $overlapStart,
                            'end_time'    => $overlapEnd,
                        ];
                    }
                }
            }
        }

        return $compatible;
    }

    /**
     * Get members available on a specific day and time.
     *
     * @param int         $dayOfWeek
     * @param string|null $time  Optional time to check (HH:MM)
     * @param int         $limit
     * @return array User IDs with availability
     */
    public function getAvailableMembers(int $dayOfWeek, ?string $time = null, int $limit = 50): array
    {
        $query = $this->availability->newQuery()
            ->join('users as u', 'member_availability.user_id', '=', 'u.id')
            ->where('member_availability.day_of_week', $dayOfWeek)
            ->where('member_availability.is_recurring', true)
            ->select(
                'member_availability.user_id',
                'member_availability.start_time',
                'member_availability.end_time',
                DB::raw(UserDisplayName::sql('u', 'member_name')),
                'u.avatar_url'
            )
            ->distinct();

        if ($time !== null) {
            $query->where('member_availability.start_time', '<=', $time)
                ->where('member_availability.end_time', '>', $time);
        }

        return $query
            ->orderBy('member_availability.start_time')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => $r->toArray())
            ->all();
    }
}
