<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\VolApplication;
use App\Models\VolShift;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolunteerCheckInService — QR-based check-in for volunteer shifts.
 *
 * Generates unique QR tokens per shift+volunteer combination.
 * Volunteers scan QR on arrival to mark checked in.
 * Coordinators can verify check-ins via the admin dashboard.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait on models.
 */
class VolunteerCheckInService
{
    /** @var array<int, array{code: string, message: string}> */
    private array $errors = [];

    /** @var array<int, array{code: string, message: string}> */
    private static array $staticErrors = [];

    public function __construct()
    {
    }

    /**
     * Get errors from the last operation.
     *
     * @return array<int, array{code: string, message: string}>
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Get errors from the last static token operation.
     *
     * @return array<int, array{code: string, message: string}>
     */
    public static function getTokenErrors(): array
    {
        return self::$staticErrors;
    }

    /**
     * Clear errors.
     */
    private function clearErrors(): void
    {
        $this->errors = [];
    }

    /**
     * Add an error.
     */
    private function addError(string $code, string $message): void
    {
        $this->errors[] = ['code' => $code, 'message' => $message];
    }

    private static function dateTimeString(mixed $value): ?string
    {
        return $value ? Carbon::parse($value)->toDateTimeString() : null;
    }

    /**
     * Check out a volunteer using QR token.
     *
     * @param string $token QR token
     * @return bool
     */
    public function checkOut(string $token): bool
    {
        return $this->checkOutWithOutcome($token) !== null;
    }

    /** A replay succeeds without changing the original checkout timestamp. */
    public function checkOutWithOutcome(string $token): ?string
    {
        $this->clearErrors();

        try {
            return DB::transaction(function () use ($token): ?string {
                $checkin = DB::table('vol_shift_checkins')
                    ->where('qr_token', $token)
                    ->where('tenant_id', TenantContext::getId())
                    ->lockForUpdate()->first();

                if (!$checkin) {
                    $this->addError('NOT_FOUND', __('api.vol_checkin_record_not_found'));
                    return null;
                }

                if ($checkin->status === 'checked_out') {
                    return 'replayed';
                }

                if ($checkin->status !== 'checked_in') {
                    $this->addError('VALIDATION_ERROR', __('api.vol_checkin_not_currently_checked_in'));
                    return null;
                }

                DB::table('vol_shift_checkins')
                    ->where('id', $checkin->id)
                    ->where('tenant_id', TenantContext::getId())
                    ->update(['status' => 'checked_out', 'checked_out_at' => now(), 'updated_at' => now()]);

                return 'completed';
            });
        } catch (\Exception $e) {
            Log::error('VolunteerCheckInService::checkOut error: ' . $e->getMessage());
            $this->addError('INTERNAL_ERROR', __('api.unexpected_error'));
            return null;
        }
    }

    /**
     * Get all check-ins for an opportunity (legacy-compatible signature).
     */
    public static function getCheckIns(int $tenantId, int $opportunityId): array
    {
        try {
            $shiftIds = VolShift::where('opportunity_id', $opportunityId)
                ->where('tenant_id', $tenantId)
                ->pluck('id');

            return DB::table('vol_shift_checkins as c')
                ->leftJoin('users as u', function ($join) {
                    $join->on('c.user_id', '=', 'u.id')
                        ->on('c.tenant_id', '=', 'u.tenant_id');
                })
                ->whereIn('c.shift_id', $shiftIds)
                ->where('c.tenant_id', $tenantId)
                ->orderBy('c.created_at', 'asc')
                ->get([
                    'c.id',
                    'c.user_id',
                    'c.status',
                    'c.checked_in_at',
                    'c.checked_out_at',
                    'u.name as user_name',
                    'u.avatar_url',
                ])
                ->map(fn ($c) => [
                    'id' => (int) $c->id,
                    'user' => [
                        'id' => (int) $c->user_id,
                        'name' => $c->user_name ?? '',
                        'avatar_url' => $c->avatar_url ?? null,
                    ],
                    'status' => $c->status,
                    'checked_in_at' => self::dateTimeString($c->checked_in_at),
                    'checked_out_at' => self::dateTimeString($c->checked_out_at),
                ])
                ->toArray();
        } catch (\Exception $e) {
            Log::error('VolunteerCheckInService::getCheckIns error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Check if a volunteer is currently checked in for an opportunity.
     */
    public static function isCheckedIn(int $tenantId, int $opportunityId, int $userId): bool
    {
        try {
            $shiftIds = VolShift::where('opportunity_id', $opportunityId)
                ->where('tenant_id', $tenantId)
                ->pluck('id');

            return DB::table('vol_shift_checkins')
                ->whereIn('shift_id', $shiftIds)
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'checked_in')
                ->exists();
        } catch (\Exception $e) {
            Log::warning('[VolunteerCheckIn] isUserCheckedIntoOpportunity failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get a user's check-in record for a specific shift.
     *
     * @param int $shiftId Shift ID
     * @param int $userId User ID
     * @return array|null
     */
    public function getUserCheckIn(int $shiftId, int $userId): ?array
    {
        $tenantId = TenantContext::getId();

        $hasApproved = VolApplication::where('shift_id', $shiftId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->exists();

        if (!$hasApproved) {
            return null;
        }

        $checkin = DB::table('vol_shift_checkins')
            ->where('shift_id', $shiftId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$checkin) {
            return null;
        }

        // The QR must open a FRONTEND page a scanning coordinator can act on — the
        // old value pointed at the POST-only, auth-gated JSON API route, so scanning
        // it just produced a 405/401. The landing page (CheckInVerifyPage) POSTs the
        // verify endpoint on the authenticated coordinator's behalf.
        $qrUrl = TenantContext::getFrontendUrl()
            . TenantContext::getSlugPrefix()
            . '/volunteering/checkin/' . $checkin->qr_token;

        return [
            'id' => $checkin->id,
            'qr_token' => $checkin->qr_token,
            'qr_url' => $qrUrl,
            'status' => $checkin->status,
            'checked_in_at' => self::dateTimeString($checkin->checked_in_at),
            'checked_out_at' => self::dateTimeString($checkin->checked_out_at),
        ];
    }

    /**
     * Generate a QR check-in token for a shift+volunteer.
     *
     * Returns null if the volunteer is not approved for the shift.
     *
     * @param int $shiftId Shift ID
     * @param int $volunteerId Volunteer user ID
     * @return string|null Token string or null if unapproved
     */
    public static function generateToken(int $shiftId, int $volunteerId): ?string
    {
        self::$staticErrors = [];
        $tenantId = TenantContext::getId();

        // Check volunteer is approved for this shift (tenant-scoped)
        $hasApproved = VolApplication::where('shift_id', $shiftId)
            ->where('user_id', $volunteerId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->exists();

        if (!$hasApproved) {
            self::$staticErrors[] = ['code' => 'FORBIDDEN', 'message' => __('api.vol_checkin_approved_shift_required')];
            return null;
        }

        // Serialise the check-then-insert under an atomic lock (same pattern as
        // VolunteerService::logHours). Without it, two concurrent calls both
        // find no existing token and both insert, leaving duplicate checkin
        // rows with two valid QR tokens for one signup.
        $lock = Cache::lock(sprintf('vol_checkin_token:%d:%d:%d', $tenantId, $shiftId, $volunteerId), 10);
        if (! $lock->get()) {
            self::$staticErrors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_checkin_save_failed')];
            return null;
        }

        try {
            // Check for existing token (tenant-scoped)
            $existing = DB::table('vol_shift_checkins')
                ->where('shift_id', $shiftId)
                ->where('user_id', $volunteerId)
                ->where('tenant_id', $tenantId)
                ->whereNotNull('qr_token')
                ->value('qr_token');

            if ($existing) {
                return $existing;
            }

            $token = bin2hex(random_bytes(32));

            DB::table('vol_shift_checkins')->insert([
                'tenant_id' => $tenantId,
                'shift_id' => $shiftId,
                'user_id' => $volunteerId,
                'qr_token' => $token,
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return $token;
        } finally {
            $lock->release();
        }
    }

    /**
     * Resolve shift ID from a check-in token.
     */
    public static function getShiftIdByToken(string $token, int $tenantId): ?int
    {
        $shiftId = DB::table('vol_shift_checkins')
            ->where('qr_token', $token)
            ->where('tenant_id', $tenantId)
            ->value('shift_id');

        return $shiftId !== null ? (int) $shiftId : null;
    }

    /**
     * Verify a check-in via QR token scan.
     *
     * @param string $token QR token
     * @return array|null Check-in result or null on failure
     */
    public function verifyCheckIn(string $token): ?array
    {
        $this->clearErrors();

        $tenantId = TenantContext::getId();
        $checkin = DB::table('vol_shift_checkins as c')
            ->leftJoin('vol_shifts as s', function ($join) {
                $join->on('c.shift_id', '=', 's.id')
                    ->on('c.tenant_id', '=', 's.tenant_id');
            })
            ->leftJoin('users as u', function ($join) {
                $join->on('c.user_id', '=', 'u.id')
                    ->on('c.tenant_id', '=', 'u.tenant_id');
            })
            ->where('c.qr_token', $token)
            ->where('c.tenant_id', $tenantId)
            ->select([
                'c.id',
                'c.shift_id',
                'c.user_id',
                'c.status',
                'c.checked_in_at',
                's.start_time',
                's.end_time',
                'u.name as user_name',
                'u.avatar_url',
            ])
            ->first();

        if (!$checkin) {
            $this->addError('NOT_FOUND', __('api.vol_invalid_checkin_token'));
            return null;
        }

        // Check if the shift has started (allow 30 min early)
        if ($checkin->start_time) {
            $shiftStart = Carbon::parse($checkin->start_time);
            $earliestCheckin = $shiftStart->copy()->subMinutes(30);
            if (now()->lt($earliestCheckin)) {
                $this->addError('VALIDATION_ERROR', __('api.vol_checkin_not_yet_available', ['time' => $shiftStart->toDateTimeString()]));
                return null;
            }
        }

        // Upper bound: QR tokens previously never expired, so a leaked/stale
        // token could still check a volunteer in weeks after the shift. Allow a
        // 4-hour grace window after the shift ends; when the shift has no
        // end_time, fall back to 24 hours after the start. Shifts with neither
        // timestamp keep the historical always-open behaviour.
        $latestCheckin = null;
        if ($checkin->end_time) {
            $latestCheckin = Carbon::parse($checkin->end_time)->addHours(4);
        } elseif ($checkin->start_time) {
            $latestCheckin = Carbon::parse($checkin->start_time)->addHours(24);
        }
        if ($latestCheckin !== null && now()->gt($latestCheckin)) {
            $this->addError('VALIDATION_ERROR', __('api.vol_checkin_window_closed', ['time' => $latestCheckin->toDateTimeString()]));
            return null;
        }

        if ($checkin->status === 'checked_in') {
            return [
                'status' => 'already_checked_in',
                'checked_in_at' => self::dateTimeString($checkin->checked_in_at),
                'user' => [
                    'id' => (int) $checkin->user_id,
                    'name' => $checkin->user_name ?? '',
                    'avatar_url' => $checkin->avatar_url ?? null,
                ],
                'shift' => [
                    'id' => (int) $checkin->shift_id,
                    'start_time' => self::dateTimeString($checkin->start_time),
                    'end_time' => self::dateTimeString($checkin->end_time),
                ],
            ];
        }

        if ($checkin->status === 'checked_out') {
            $this->addError('VALIDATION_ERROR', __('api.vol_checkin_already_checked_out'));
            return null;
        }

        DB::table('vol_shift_checkins')
            ->where('id', $checkin->id)
            ->where('tenant_id', $tenantId)
            ->update(['status' => 'checked_in', 'checked_in_at' => now(), 'updated_at' => now()]);

        return [
            'status' => 'checked_in',
            'checked_in_at' => now()->toDateTimeString(),
            'user' => [
                'id' => (int) $checkin->user_id,
                'name' => $checkin->user_name ?? '',
                'avatar_url' => $checkin->avatar_url ?? null,
            ],
            'shift' => [
                'id' => (int) $checkin->shift_id,
                'start_time' => self::dateTimeString($checkin->start_time),
                'end_time' => self::dateTimeString($checkin->end_time),
            ],
        ];
    }

    /**
     * Resolve volunteer user ID from a check-in token.
     */
    public static function getUserIdByToken(string $token): ?int
    {
        $userId = DB::table('vol_shift_checkins')
            ->where('qr_token', $token)
            ->where('tenant_id', TenantContext::getId())
            ->value('user_id');

        return $userId !== null ? (int) $userId : null;
    }

    /**
     * Get all check-ins for a shift (without exposing qr_token).
     *
     * @param int $shiftId Shift ID
     * @return array
     */
    public function getShiftCheckIns(int $shiftId): array
    {
        return DB::table('vol_shift_checkins as c')
            ->leftJoin('users as u', function ($join) {
                $join->on('c.user_id', '=', 'u.id')
                    ->on('c.tenant_id', '=', 'u.tenant_id');
            })
            ->where('c.shift_id', $shiftId)
            ->where('c.tenant_id', TenantContext::getId())
            ->orderBy('c.created_at', 'asc')
            ->get([
                'c.id',
                'c.user_id',
                'c.status',
                'c.checked_in_at',
                'c.checked_out_at',
                'u.name as user_name',
                'u.avatar_url',
            ])
            ->map(fn ($c) => [
                'id' => (int) $c->id,
                'user' => [
                    'id' => (int) $c->user_id,
                    'name' => $c->user_name ?? '',
                    'avatar_url' => $c->avatar_url ?? null,
                ],
                'status' => $c->status,
                'checked_in_at' => self::dateTimeString($c->checked_in_at),
                'checked_out_at' => self::dateTimeString($c->checked_out_at),
            ])
            ->toArray();
    }
}
