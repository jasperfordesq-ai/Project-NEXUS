<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\JobApplication;
use App\Models\JobInterviewSlot;
use App\Models\JobVacancy;
use App\Models\JobVacancyTeam;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * JobInterviewSchedulingService — Manages interview self-scheduling slots.
 *
 * Employers create available time slots; candidates book from those slots.
 * All queries are tenant-scoped.
 */
class JobInterviewSchedulingService
{
    /** @var array Collected errors from the last operation */
    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    private function isAdminUser(int $userId, int $tenantId): bool
    {
        $user = User::where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if (!$user) {
            return false;
        }

        return in_array((string) ($user->role ?? ''), ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || (bool) ($user->is_admin ?? false)
            || (bool) ($user->is_super_admin ?? false)
            || (bool) ($user->is_tenant_super_admin ?? false)
            || (bool) ($user->is_god ?? false);
    }

    private function canManageSlots(JobVacancy $vacancy, int $userId, int $tenantId): bool
    {
        if ((int) $vacancy->user_id === $userId || $this->isAdminUser($userId, $tenantId)) {
            return true;
        }

        return JobVacancyTeam::where('tenant_id', $tenantId)
            ->where('vacancy_id', $vacancy->id)
            ->where('user_id', $userId)
            ->where('role', 'manager')
            ->exists();
    }

    /**
     * An absolute http(s) URL with a host. Same rule as EventService::isHttpUrl().
     */
    private static function isHttpUrl(string $value): bool
    {
        $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));

        return in_array($scheme, ['http', 'https'], true)
            && (string) parse_url($value, PHP_URL_HOST) !== ''
            && filter_var($value, FILTER_VALIDATE_URL) !== false;
    }

    private function hasActiveApplication(int $jobId, int $userId, int $tenantId): bool
    {
        return JobApplication::where('tenant_id', $tenantId)
            ->where('vacancy_id', $jobId)
            ->where('user_id', $userId)
            ->whereNotIn('status', ['withdrawn', 'rejected'])
            ->exists();
    }

    /**
     * @return array<string, mixed>
     */
    private function slotPayload(JobInterviewSlot $slot, bool $includePrivate): array
    {
        $data = $slot->toArray();
        unset($data['booked_by_user_id']);

        if (!$includePrivate) {
            unset($data['meeting_link'], $data['notes']);
        }

        return $data;
    }

    /**
     * Create individual interview slots for a job.
     *
     * @param int $jobId
     * @param int $employerId
     * @param array $slots Each: { start, end, type?, meeting_link?, location?, notes? }
     * @param int $tenantId
     * @return array Created slot records
     */
    public function createSlots(int $jobId, int $employerId, array $slots, int $tenantId): array
    {
        $this->errors = [];

        $vacancy = JobVacancy::where('id', $jobId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return [];
        }

        if (!$this->canManageSlots($vacancy, $employerId, $tenantId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_slots_manage_forbidden')];
            return [];
        }

        // F-297: the applicant's "Join call" button links to meeting_link, so a
        // supplied value must be an http(s) URL. Checked for the whole batch
        // before anything is written, so a refused batch stores no slot.
        foreach ($slots as $slot) {
            $link = is_array($slot) ? trim((string) ($slot['meeting_link'] ?? '')) : '';
            if ($link !== '' && !self::isHttpUrl($link)) {
                $this->errors[] = [
                    'code' => 'VALIDATION_INVALID_URL',
                    'message' => __('api.invalid_url'),
                    'field' => 'meeting_link',
                ];
                return [];
            }
        }

        $created = [];

        foreach ($slots as $slot) {
            if (empty($slot['start']) || empty($slot['end'])) {
                continue;
            }

            // Auto-generate Jitsi meeting link for video interviews if not provided
            $meetingLink = $slot['meeting_link'] ?? null;
            $interviewType = $slot['type'] ?? 'video';
            if ($interviewType === 'video' && empty($meetingLink)) {
                $roomName = 'nexus-interview-' . $tenantId . '-' . $jobId . '-' . time() . '-' . bin2hex(random_bytes(4));
                $meetingLink = 'https://meet.jit.si/' . $roomName;
            }

            $record = JobInterviewSlot::create([
                'tenant_id' => $tenantId,
                'job_id' => $jobId,
                'employer_user_id' => $employerId,
                'slot_start' => $slot['start'],
                'slot_end' => $slot['end'],
                'interview_type' => $interviewType,
                'meeting_link' => $meetingLink,
                'location' => $slot['location'] ?? null,
                'notes' => $slot['notes'] ?? null,
            ]);

            $created[] = $this->slotPayload($record, true);
        }

        return $created;
    }

    /**
     * Get available (unbooked) slots for a job.
     *
     * @param int $jobId
     * @param int $tenantId
     * @return array
     */
    public function getAvailableSlots(int $jobId, int $tenantId, int $userId): array
    {
        $this->errors = [];

        $vacancy = JobVacancy::where('id', $jobId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return [];
        }

        $canManage = $this->canManageSlots($vacancy, $userId, $tenantId);
        if (!$canManage && !$this->hasActiveApplication($jobId, $userId, $tenantId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_slots_active_application_required')];
            return [];
        }

        return JobInterviewSlot::where('tenant_id', $tenantId)
            ->where('job_id', $jobId)
            ->where('is_booked', false)
            ->where('slot_start', '>', now())
            ->orderBy('slot_start', 'asc')
            ->get()
            ->map(fn (JobInterviewSlot $slot) => $this->slotPayload($slot, $canManage))
            ->all();
    }

    /**
     * Book an available slot for a candidate.
     *
     * @param int $slotId
     * @param int $candidateUserId
     * @param int $tenantId
     * @return array|null Slot data on success, null on failure
     */
    public function bookSlot(int $slotId, int $candidateUserId, int $tenantId): ?array
    {
        $this->errors = [];

        $slot = JobInterviewSlot::where('id', $slotId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$slot) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_slot_not_found')];
            return null;
        }

        if ($slot->is_booked) {
            $this->errors[] = ['code' => 'RESOURCE_CONFLICT', 'message' => __('api.job_slot_already_booked')];
            return null;
        }

        if ($slot->slot_start <= now()) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.job_slot_passed')];
            return null;
        }

        // Prevent employer from booking their own slot
        if ((int) $slot->employer_user_id === $candidateUserId) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_cannot_book_own_slot')];
            return null;
        }

        if (!$this->hasActiveApplication((int) $slot->job_id, $candidateUserId, $tenantId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_slots_active_application_required')];
            return null;
        }

        // Atomically claim the slot: only one concurrent request can flip is_booked
        // from false to true, so two candidates cannot book the same slot.
        $claimed = JobInterviewSlot::where('id', $slotId)
            ->where('tenant_id', $tenantId)
            ->where('is_booked', false)
            ->update([
                'is_booked' => true,
                'booked_by_user_id' => $candidateUserId,
                'booked_at' => now(),
            ]);

        if ($claimed === 0) {
            // Lost the race — another candidate booked this slot first.
            $this->errors[] = ['code' => 'RESOURCE_CONFLICT', 'message' => __('api.job_slot_already_booked')];
            return null;
        }

        $fresh = $slot->fresh();
        return $fresh instanceof JobInterviewSlot ? $this->slotPayload($fresh, true) : $this->slotPayload($slot, true);
    }

    /**
     * Cancel a slot booking and reopen it.
     *
     * @param int $slotId
     * @param int $tenantId
     * @return bool
     */
    public function cancelSlotBooking(int $slotId, int $tenantId, int $userId): bool
    {
        $this->errors = [];

        $slot = JobInterviewSlot::where('id', $slotId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$slot) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_slot_not_found')];
            return false;
        }

        if (!$slot->is_booked) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.job_slot_not_booked')];
            return false;
        }

        $vacancy = JobVacancy::where('id', $slot->job_id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$vacancy || ((int) $slot->booked_by_user_id !== $userId && !$this->canManageSlots($vacancy, $userId, $tenantId))) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_slots_cancel_forbidden')];
            return false;
        }

        $slot->update([
            'is_booked' => false,
            'booked_by_user_id' => null,
            'booked_at' => null,
        ]);

        return true;
    }

    /**
     * Delete a slot entirely (employer action).
     *
     * @param int $slotId
     * @param int $tenantId
     * @return bool
     */
    public function deleteSlot(int $slotId, int $tenantId, int $userId): bool
    {
        $this->errors = [];

        $slot = JobInterviewSlot::where('id', $slotId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$slot) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_slot_not_found')];
            return false;
        }

        $vacancy = JobVacancy::where('id', $slot->job_id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$vacancy || !$this->canManageSlots($vacancy, $userId, $tenantId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_slots_manage_forbidden')];
            return false;
        }

        $slot->delete();

        return true;
    }

    /**
     * Bulk-create slots for a date range with per-day time windows.
     *
     * @param int $jobId
     * @param int $employerId
     * @param string $dateFrom Y-m-d
     * @param string $dateTo Y-m-d
     * @param int $durationMinutes Slot duration (e.g. 30, 45, 60)
     * @param array $dayConfig e.g. { "monday": { "start": "09:00", "end": "17:00" }, ... }
     * @param int $tenantId
     * @return array Created slot records
     */
    public function bulkCreateSlots(
        int $jobId,
        int $employerId,
        string $dateFrom,
        string $dateTo,
        int $durationMinutes,
        array $dayConfig,
        int $tenantId
    ): array {
        $this->errors = [];

        $vacancy = JobVacancy::where('id', $jobId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$vacancy) {
            $this->errors[] = ['code' => 'RESOURCE_NOT_FOUND', 'message' => __('api.job_vacancy_not_found')];
            return [];
        }

        if (!$this->canManageSlots($vacancy, $employerId, $tenantId)) {
            $this->errors[] = ['code' => 'RESOURCE_FORBIDDEN', 'message' => __('api.job_slots_manage_forbidden')];
            return [];
        }

        $durationMinutes = max(15, min(180, $durationMinutes));
        $slots = [];

        $start = Carbon::parse($dateFrom)->startOfDay();
        $end = Carbon::parse($dateTo)->endOfDay();

        $dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

        $current = $start->copy();
        while ($current->lte($end)) {
            $dayName = $dayNames[$current->dayOfWeek];

            if (isset($dayConfig[$dayName]) && !empty($dayConfig[$dayName]['start']) && !empty($dayConfig[$dayName]['end'])) {
                $dayStart = Carbon::parse($current->format('Y-m-d') . ' ' . $dayConfig[$dayName]['start']);
                $dayEnd = Carbon::parse($current->format('Y-m-d') . ' ' . $dayConfig[$dayName]['end']);

                $slotStart = $dayStart->copy();
                while ($slotStart->copy()->addMinutes($durationMinutes)->lte($dayEnd)) {
                    $slotEnd = $slotStart->copy()->addMinutes($durationMinutes);

                    // Only create future slots
                    if ($slotStart->gt(now())) {
                        $slots[] = [
                            'start' => $slotStart->format('Y-m-d H:i:s'),
                            'end' => $slotEnd->format('Y-m-d H:i:s'),
                        ];
                    }

                    $slotStart = $slotEnd;
                }
            }

            $current->addDay();
        }

        if (empty($slots)) {
            return [];
        }

        return $this->createSlots($jobId, $employerId, $slots, $tenantId);
    }
}
