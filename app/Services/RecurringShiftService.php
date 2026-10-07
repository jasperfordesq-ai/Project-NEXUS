<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * RecurringShiftService — Manages recurring shift patterns for volunteer opportunities.
 *
 * Handles CRUD for recurring_shift_patterns and automatic generation of
 * vol_shifts instances from those patterns.
 */
class RecurringShiftService
{
    /** @var array<string> */
    private array $errors = [];

    public function __construct()
    {
    }

    /**
     * Get accumulated errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Create a new recurring shift pattern.
     */
    public function createPattern(int $opportunityId, int $createdBy, array $data): ?int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        // Validate opportunity belongs to tenant and user has access
        $opp = DB::selectOne(
            "SELECT id, created_by FROM vol_opportunities WHERE id = ? AND tenant_id = ?",
            [$opportunityId, $tenantId]
        );

        if (!$opp) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.opportunity_not_found')];
            return null;
        }

        // Only the opportunity creator, the owning org's owner/admins, or a site
        // admin may manage its recurring patterns. Previously ANY tenant member
        // could create patterns for any opportunity.
        if (!VolunteerService::userCanManageOpportunityById($opportunityId, $createdBy)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return null;
        }

        // Validate required fields
        $frequency = $data['frequency'] ?? 'weekly';
        $validFrequencies = ['daily', 'weekly', 'biweekly', 'monthly'];
        if (!in_array($frequency, $validFrequencies, true)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_frequency')];
            return null;
        }

        $startTime = $data['start_time'] ?? null;
        $endTime = $data['end_time'] ?? null;
        if (!$startTime || !$endTime) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_input')];
            return null;
        }

        $startDate = $data['start_date'] ?? date('Y-m-d');

        // Weekly and fortnightly patterns repeat on chosen weekdays (1 = Monday …
        // 7 = Sunday). Until 6 Oct 2026 a weekly pattern with none was accepted
        // and generated a shift EVERY day; text weekdays ("2") were stored but
        // never matched, so they generated nothing.
        $days = self::normaliseDaysOfWeek($data['days_of_week'] ?? null);
        if ($days === null) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_pattern_days_invalid'), 'field' => 'days_of_week'];
            return null;
        }
        if (self::usesWeekdays($frequency) && $days === []) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_pattern_days_required'), 'field' => 'days_of_week'];
            return null;
        }
        $daysOfWeek = $days === [] ? null : json_encode($days);

        try {
            DB::insert(
                "INSERT INTO recurring_shift_patterns
                 (tenant_id, opportunity_id, created_by, title, frequency, days_of_week,
                  start_time, end_time, spots_per_shift, capacity, start_date, end_date,
                  max_occurrences, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())",
                [
                    $tenantId,
                    $opportunityId,
                    $createdBy,
                    $data['title'] ?? null,
                    $frequency,
                    $daysOfWeek,
                    $startTime,
                    $endTime,
                    (int) ($data['spots_per_shift'] ?? 1),
                    (int) ($data['capacity'] ?? 1),
                    $startDate,
                    $data['end_date'] ?? null,
                    isset($data['max_occurrences']) ? (int) $data['max_occurrences'] : null,
                ]
            );

            $patternId = (int) DB::getPdo()->lastInsertId();

            Log::info('[RecurringShift] Pattern created', [
                'id' => $patternId,
                'opportunity' => $opportunityId,
                'frequency' => $frequency,
            ]);

            return $patternId;
        } catch (\Exception $e) {
            Log::error('[RecurringShift] createPattern failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return null;
        }
    }

    /**
     * Generate shift occurrences from a pattern for the next N days.
     */
    public function generateOccurrences(int $patternId, int $daysAhead = 14): int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        try {
            $pattern = DB::selectOne(
                "SELECT * FROM recurring_shift_patterns WHERE id = ? AND tenant_id = ? AND is_active = 1",
                [$patternId, $tenantId]
            );

            if (!$pattern) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.not_found')];
                return 0;
            }

            // Recurrence anchor: ALWAYS the pattern's original start date.
            // Clamping the anchor to today made monthly patterns match
            // "today's day-of-month" on every daily cron run (a shift per day)
            // and rolled biweekly week-parity so it fired on the wrong weeks.
            $anchorDate = new \DateTime($pattern->start_date);

            // Integers, so the strict in_array() below matches text weekdays too.
            // A weekly/fortnightly row stored with none (accepted before 6 Oct
            // 2026) repeats on its start date's weekday — never on every day.
            $daysOfWeek = self::normaliseDaysOfWeek($pattern->days_of_week) ?? [];
            if ($daysOfWeek === [] && self::usesWeekdays((string) $pattern->frequency)) {
                $daysOfWeek = [(int) $anchorDate->format('N')];
            }
            // Iteration window: never generate before today or the pattern start.
            $startDate = new \DateTime(max($pattern->start_date, date('Y-m-d')));
            $endDate = new \DateTime(date('Y-m-d', strtotime("+{$daysAhead} days")));

            // Respect pattern end_date
            if ($pattern->end_date) {
                $patternEnd = new \DateTime($pattern->end_date);
                if ($patternEnd < $endDate) {
                    $endDate = $patternEnd;
                }
            }

            // Respect max_occurrences
            $maxOccurrences = $pattern->max_occurrences ? (int) $pattern->max_occurrences : PHP_INT_MAX;
            $currentGenerated = (int) $pattern->occurrences_generated;

            $generated = 0;
            $current = clone $startDate;

            while ($current <= $endDate && ($currentGenerated + $generated) < $maxOccurrences) {
                if (self::occursOn((string) $pattern->frequency, $anchorDate, $daysOfWeek, $current)) {
                    $shiftDate = $current->format('Y-m-d');
                    $shiftStart = $shiftDate . ' ' . $pattern->start_time;
                    $shiftEnd = $shiftDate . ' ' . $pattern->end_time;

                    // Check if shift already exists for this date/pattern
                    $exists = DB::selectOne(
                        "SELECT id FROM vol_shifts
                         WHERE recurring_pattern_id = ? AND tenant_id = ? AND start_time = ?",
                        [$patternId, $tenantId, $shiftStart]
                    );

                    if (!$exists) {
                        DB::insert(
                            "INSERT INTO vol_shifts (tenant_id, opportunity_id, recurring_pattern_id, start_time, end_time, capacity, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, NOW())",
                            [
                                $tenantId,
                                (int) $pattern->opportunity_id,
                                $patternId,
                                $shiftStart,
                                $shiftEnd,
                                (int) $pattern->capacity,
                            ]
                        );
                        $generated++;
                    }
                }

                $current->modify('+1 day');
            }

            // Update occurrences_generated count
            if ($generated > 0) {
                DB::update(
                    "UPDATE recurring_shift_patterns SET occurrences_generated = occurrences_generated + ?, updated_at = NOW() WHERE id = ?",
                    [$generated, $patternId]
                );
            }

            Log::info('[RecurringShift] Occurrences generated', [
                'pattern' => $patternId,
                'generated' => $generated,
            ]);

            return $generated;
        } catch (\Exception $e) {
            Log::error('[RecurringShift] generateOccurrences failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return 0;
        }
    }

    /**
     * Process all active patterns for a tenant, generating upcoming occurrences.
     */
    public function processAllPatterns(int $daysAhead = 14): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();
        $results = ['processed' => 0, 'generated' => 0, 'errors' => 0];

        try {
            $patterns = DB::select(
                "SELECT id FROM recurring_shift_patterns
                 WHERE tenant_id = ? AND is_active = 1
                   AND (end_date IS NULL OR end_date >= CURDATE())",
                [$tenantId]
            );

            foreach ($patterns as $pattern) {
                try {
                    $generated = $this->generateOccurrences((int) $pattern->id, $daysAhead);
                    $results['generated'] += $generated;
                    $results['processed']++;
                } catch (\Exception $e) {
                    $results['errors']++;
                    Log::error('[RecurringShift] processAllPatterns: pattern failed', [
                        'pattern' => $pattern->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            return $results;
        } catch (\Exception $e) {
            Log::error('[RecurringShift] processAllPatterns failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return $results;
        }
    }

    /**
     * Get recurring patterns for an opportunity.
     */
    public function getPatternsForOpportunity(int $opportunityId, ?int $userId = null): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        try {
            $rows = DB::select(
                "SELECT rsp.*,
                        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
                 FROM recurring_shift_patterns rsp
                 LEFT JOIN users u ON rsp.created_by = u.id
                 WHERE rsp.opportunity_id = ? AND rsp.tenant_id = ?
                 ORDER BY rsp.created_at DESC",
                [$opportunityId, $tenantId]
            );

            return array_map(function ($row) {
                $daysOfWeek = is_string($row->days_of_week)
                    ? (json_decode($row->days_of_week, true) ?: [])
                    : [];

                return [
                    'id' => (int) $row->id,
                    'opportunity_id' => (int) $row->opportunity_id,
                    'title' => $row->title,
                    'frequency' => $row->frequency,
                    'days_of_week' => $daysOfWeek,
                    'start_time' => $row->start_time,
                    'end_time' => $row->end_time,
                    'spots_per_shift' => (int) $row->spots_per_shift,
                    'capacity' => (int) $row->capacity,
                    'start_date' => $row->start_date,
                    'end_date' => $row->end_date,
                    'max_occurrences' => $row->max_occurrences ? (int) $row->max_occurrences : null,
                    'occurrences_generated' => (int) $row->occurrences_generated,
                    'is_active' => (bool) $row->is_active,
                    'created_by' => (int) $row->created_by,
                    'created_by_name' => $row->created_by_name ? trim($row->created_by_name) : null,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            }, $rows);
        } catch (\Exception $e) {
            Log::error('[RecurringShift] getPatternsForOpportunity failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return [];
        }
    }

    /**
     * Get a single pattern by ID.
     */
    public function getPattern(int $patternId): ?array
    {
        $tenantId = TenantContext::getId();

        try {
            $row = DB::selectOne(
                "SELECT rsp.*,
                        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
                 FROM recurring_shift_patterns rsp
                 LEFT JOIN users u ON rsp.created_by = u.id
                 WHERE rsp.id = ? AND rsp.tenant_id = ?",
                [$patternId, $tenantId]
            );

            if (!$row) {
                return null;
            }

            $daysOfWeek = is_string($row->days_of_week)
                ? (json_decode($row->days_of_week, true) ?: [])
                : [];

            return [
                'id' => (int) $row->id,
                'opportunity_id' => (int) $row->opportunity_id,
                'title' => $row->title,
                'frequency' => $row->frequency,
                'days_of_week' => $daysOfWeek,
                'start_time' => $row->start_time,
                'end_time' => $row->end_time,
                'spots_per_shift' => (int) $row->spots_per_shift,
                'capacity' => (int) $row->capacity,
                'start_date' => $row->start_date,
                'end_date' => $row->end_date,
                'max_occurrences' => $row->max_occurrences ? (int) $row->max_occurrences : null,
                'occurrences_generated' => (int) $row->occurrences_generated,
                'is_active' => (bool) $row->is_active,
                'created_by' => (int) $row->created_by,
                'created_by_name' => $row->created_by_name ? trim($row->created_by_name) : null,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ];
        } catch (\Exception $e) {
            Log::error('[RecurringShift] getPattern failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Update a recurring shift pattern.
     */
    public function updatePattern(int $patternId, array $data, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $pattern = DB::selectOne(
            "SELECT id, created_by, opportunity_id, frequency, days_of_week FROM recurring_shift_patterns WHERE id = ? AND tenant_id = ?",
            [$patternId, $tenantId]
        );

        if (!$pattern) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.not_found')];
            return false;
        }

        // Only managers of the owning opportunity may edit its patterns.
        if (!VolunteerService::userCanManageOpportunityById((int) $pattern->opportunity_id, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return false;
        }

        $updates = [];
        $params = [];

        $allowedFields = [
            'title' => 'string',
            'frequency' => 'string',
            'start_time' => 'string',
            'end_time' => 'string',
            'spots_per_shift' => 'int',
            'capacity' => 'int',
            'start_date' => 'string',
            'end_date' => 'string',
            'max_occurrences' => 'int',
        ];

        foreach ($allowedFields as $field => $type) {
            if (array_key_exists($field, $data)) {
                if ($field === 'frequency') {
                    $validFrequencies = ['daily', 'weekly', 'biweekly', 'monthly'];
                    if (!in_array($data[$field], $validFrequencies, true)) {
                        $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_frequency')];
                        return false;
                    }
                }

                $updates[] = "{$field} = ?";
                $params[] = $type === 'int' ? (int) $data[$field] : $data[$field];
            }
        }

        $resultingDays = self::normaliseDaysOfWeek($pattern->days_of_week ?? null) ?? [];
        if (array_key_exists('days_of_week', $data)) {
            $newDays = self::normaliseDaysOfWeek($data['days_of_week']);
            if ($newDays === null) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_pattern_days_invalid'), 'field' => 'days_of_week'];
                return false;
            }
            $resultingDays = $newDays;
            $updates[] = 'days_of_week = ?';
            $params[] = $newDays === [] ? null : json_encode($newDays);
        }
        // Only an update that touches the weekdays or the frequency is held to the
        // weekday rule; an old row is otherwise left alone (generation falls back
        // to its start weekday).
        $resultingFrequency = (string) ($data['frequency'] ?? $pattern->frequency ?? '');
        $touchesRepeat = array_key_exists('days_of_week', $data) || array_key_exists('frequency', $data);
        if ($touchesRepeat && self::usesWeekdays($resultingFrequency) && $resultingDays === []) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_pattern_days_required'), 'field' => 'days_of_week'];
            return false;
        }

        if (empty($updates)) {
            return true;
        }

        try {
            $params[] = $patternId;
            $params[] = $tenantId;
            DB::update(
                "UPDATE recurring_shift_patterns SET " . implode(', ', $updates) . ", updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                $params
            );

            Log::info('[RecurringShift] Pattern updated', ['id' => $patternId, 'by' => $userId]);
            return true;
        } catch (\Exception $e) {
            Log::error('[RecurringShift] updatePattern failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return false;
        }
    }

    /**
     * Deactivate a recurring shift pattern.
     */
    public function deactivatePattern(int $patternId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $pattern = DB::selectOne(
            "SELECT id, opportunity_id FROM recurring_shift_patterns WHERE id = ? AND tenant_id = ?",
            [$patternId, $tenantId]
        );
        if (!$pattern) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.not_found')];
            return false;
        }

        // Only managers of the owning opportunity may deactivate its patterns.
        if (!VolunteerService::userCanManageOpportunityById((int) $pattern->opportunity_id, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return false;
        }

        try {
            DB::update(
                "UPDATE recurring_shift_patterns SET is_active = 0, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$patternId, $tenantId]
            );

            Log::info('[RecurringShift] Pattern deactivated', ['id' => $patternId, 'by' => $userId]);
            return true;
        } catch (\Exception $e) {
            Log::error('[RecurringShift] deactivatePattern failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return false;
        }
    }

    /**
     * Delete future (unstarted) shifts generated by a pattern.
     * Returns the number of shifts deleted.
     */
    public function deleteFutureShifts(int $patternId, int $userId): int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $pattern = DB::selectOne(
            "SELECT id, opportunity_id FROM recurring_shift_patterns WHERE id = ? AND tenant_id = ?",
            [$patternId, $tenantId]
        );
        if (!$pattern) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.not_found')];
            return 0;
        }

        // Only managers of the owning opportunity may delete its generated shifts.
        if (!VolunteerService::userCanManageOpportunityById((int) $pattern->opportunity_id, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return 0;
        }

        try {
            return DB::transaction(function () use ($patternId, $tenantId, $userId) {
                // Capture the shift ids first so we can neutralise emergency
                // alerts that point at them. vol_emergency_alerts.shift_id has no
                // FK, so a hard shift delete would orphan any 'active' alert
                // (every alert query INNER JOINs vol_shifts, making orphans
                // invisible and impossible to cancel afterwards).
                $shiftIds = DB::table('vol_shifts')
                    ->where('recurring_pattern_id', $patternId)
                    ->where('tenant_id', $tenantId)
                    ->where('start_time', '>', now())
                    ->pluck('id')
                    ->all();

                $deleted = DB::delete(
                    "DELETE FROM vol_shifts
                     WHERE recurring_pattern_id = ? AND tenant_id = ? AND start_time > NOW()",
                    [$patternId, $tenantId]
                );

                if (!empty($shiftIds)) {
                    DB::table('vol_emergency_alerts')
                        ->whereIn('shift_id', $shiftIds)
                        ->where('tenant_id', $tenantId)
                        ->where('status', 'active')
                        ->update(['status' => 'cancelled']);
                }

                Log::info('[RecurringShift] Future shifts deleted', [
                    'pattern' => $patternId,
                    'deleted' => $deleted,
                    'by' => $userId,
                ]);

                return $deleted;
            });
        } catch (\Exception $e) {
            Log::error('[RecurringShift] deleteFutureShifts failed', ['error' => $e->getMessage()]);
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.server_error')];
            return 0;
        }
    }

    /**
     * Whether a pattern repeats on the given calendar day. One rule for both
     * generation and reconcileFutureShifts(), so the two can never disagree.
     *
     * @param int[] $daysOfWeek ISO weekdays, 1=Monday … 7=Sunday
     */
    private static function occursOn(string $frequency, \DateTime $anchorDate, array $daysOfWeek, \DateTime $date): bool
    {
        $dayOfWeek = (int) $date->format('N');

        switch ($frequency) {
            case 'daily':
                return true;
            case 'weekly':
                return in_array($dayOfWeek, $daysOfWeek, true);
            case 'biweekly':
                $weekDiff = intdiv((int) $anchorDate->diff($date)->days, 7);
                return ($weekDiff % 2 === 0) && in_array($dayOfWeek, $daysOfWeek, true);
            case 'monthly':
                // Clamp the anchor day to the last valid day of the current
                // month so a day-29/30/31 anchor still fires in shorter months
                // (e.g. a Jan-31 pattern fires on Feb 28/29), matching
                // EventService's monthly clamp instead of silently skipping.
                $anchorDay = (int) $anchorDate->format('d');
                $targetDay = min($anchorDay, (int) $date->format('t'));
                return (int) $date->format('d') === $targetDay;
        }

        return false;
    }

    /**
     * Bring a pattern's future shifts into line after its repeat rules change
     * (found walking the journey, 7 Oct 2026). Editing the weekdays, times or dates
     * used to change only the pattern row: shifts on dropped days stayed listed,
     * and the new days appeared only when the cron next ran.
     *
     * A future shift that no longer fits is removed only if nothing refers to it —
     * no application, sign-up, check-in, waitlist place, group reservation, swap
     * request, expense, incident or alert. A shift somebody is booked on is kept,
     * never silently taken away from them, and counted in `kept` so the organiser
     * can deal with it. Then the next 14 days are generated straight away.
     *
     * @return array{removed: int, kept: int, generated: int}
     */
    public function reconcileFutureShifts(int $patternId): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();
        $result = ['removed' => 0, 'kept' => 0, 'generated' => 0];

        $pattern = DB::selectOne(
            "SELECT * FROM recurring_shift_patterns WHERE id = ? AND tenant_id = ? AND is_active = 1",
            [$patternId, $tenantId]
        );
        if (!$pattern) {
            return $result;
        }

        $anchorDate = new \DateTime($pattern->start_date);
        $daysOfWeek = self::normaliseDaysOfWeek($pattern->days_of_week) ?? [];
        if ($daysOfWeek === [] && self::usesWeekdays((string) $pattern->frequency)) {
            $daysOfWeek = [(int) $anchorDate->format('N')];
        }
        $startDay = substr((string) $pattern->start_date, 0, 10);
        $endDay = $pattern->end_date ? substr((string) $pattern->end_date, 0, 10) : null;

        $shifts = DB::table('vol_shifts')
            ->where('recurring_pattern_id', $patternId)
            ->where('tenant_id', $tenantId)
            ->where('start_time', '>', now())
            ->get(['id', 'start_time', 'end_time']);

        $removable = [];
        foreach ($shifts as $shift) {
            $day = substr((string) $shift->start_time, 0, 10);
            $fits = $day >= $startDay
                && ($endDay === null || $day <= $endDay)
                && self::occursOn((string) $pattern->frequency, $anchorDate, $daysOfWeek, new \DateTime($day))
                && strtotime((string) $shift->start_time) === strtotime($day . ' ' . $pattern->start_time)
                && strtotime((string) $shift->end_time) === strtotime($day . ' ' . $pattern->end_time);
            if ($fits) {
                continue;
            }
            if (self::shiftIsUntouched((int) $shift->id, $tenantId)) {
                $removable[] = (int) $shift->id;
            } else {
                $result['kept']++;
            }
        }

        if ($removable !== []) {
            DB::transaction(function () use ($removable, $tenantId, $patternId, &$result) {
                $result['removed'] = DB::table('vol_shifts')
                    ->whereIn('id', $removable)
                    ->where('tenant_id', $tenantId)
                    ->delete();
                // Removed occurrences no longer count towards max_occurrences.
                DB::update(
                    "UPDATE recurring_shift_patterns SET occurrences_generated = GREATEST(0, occurrences_generated - ?) WHERE id = ? AND tenant_id = ?",
                    [$result['removed'], $patternId, $tenantId]
                );
            });
        }

        $result['generated'] = $this->generateOccurrences($patternId, 14);

        Log::info('[RecurringShift] Future shifts reconciled', ['pattern' => $patternId] + $result);

        return $result;
    }

    /** True when nothing at all refers to the shift, so removing it loses nobody's booking or record. */
    private static function shiftIsUntouched(int $shiftId, int $tenantId): bool
    {
        foreach ([
            'vol_applications' => ['shift_id'],
            'vol_shift_signups' => ['shift_id'],
            'vol_shift_checkins' => ['shift_id'],
            'vol_shift_waitlist' => ['shift_id'],
            'vol_shift_group_reservations' => ['shift_id'],
            'vol_shift_swap_requests' => ['from_shift_id', 'to_shift_id'],
            'vol_expenses' => ['shift_id'],
            'vol_safeguarding_incidents' => ['shift_id'],
            'vol_emergency_alerts' => ['shift_id'],
        ] as $table => $columns) {
            $query = DB::table($table)->where('tenant_id', $tenantId)
                ->where(function ($q) use ($columns, $shiftId) {
                    foreach ($columns as $column) {
                        $q->orWhere($column, $shiftId);
                    }
                });
            if ($query->exists()) {
                return false;
            }
        }

        return true;
    }

    /** Weekly and fortnightly patterns repeat on chosen weekdays; daily and monthly do not. */
    private static function usesWeekdays(string $frequency): bool
    {
        return in_array($frequency, ['weekly', 'biweekly'], true);
    }

    /**
     * Weekdays as sorted, distinct ISO numbers (1 = Monday … 7 = Sunday).
     * Accepts a list or its JSON text, with numbers or numeric strings.
     * Returns [] for none, or null when any value is not a weekday.
     *
     * @return list<int>|null
     */
    private static function normaliseDaysOfWeek(mixed $value): ?array
    {
        if ($value === null || $value === '' || $value === []) {
            return [];
        }
        if (is_string($value)) {
            $value = json_decode($value, true);
        }
        if (!is_array($value)) {
            return null;
        }
        $days = [];
        foreach ($value as $day) {
            if (is_int($day) || (is_string($day) && ctype_digit($day))) {
                $day = (int) $day;
                if ($day >= 1 && $day <= 7) {
                    $days[$day] = $day;
                    continue;
                }
            }
            return null;
        }
        ksort($days);

        return array_values($days);
    }
}
