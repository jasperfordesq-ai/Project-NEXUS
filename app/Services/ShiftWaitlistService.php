<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\VolShift;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ShiftWaitlistService — Laravel DI-based service for shift waitlist operations.
 *
 * Manages waitlist automation for volunteer shifts with tenant scoping.
 */
class ShiftWaitlistService
{
    private static array $errors = [];

    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Join the waitlist for a shift.
     *
     * @return int|null Waitlist entry ID or null on failure
     */
    public static function join(int $shiftId, int $userId): ?int
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $shift = VolShift::find($shiftId);
        if (! $shift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
            return null;
        }

        if ($shift->start_time->isPast()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
            return null;
        }

        $context = DB::table('vol_shifts as s')
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
            ->select(
                's.id',
                's.capacity',
                'opp.id as opportunity_id',
                'opp.status as opportunity_status',
                'opp.is_active as opportunity_is_active',
                'org.status as organization_status',
                'org.user_id as coordinator_id'
            )
            ->first();

        if (! $context
            || (int) ($context->opportunity_is_active ?? 0) !== 1
            || ! in_array((string) ($context->opportunity_status ?? ''), ['open', 'active'], true)
            || ! in_array((string) ($context->organization_status ?? ''), ['approved', 'active'], true)
        ) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_opportunity_not_active')];
            return null;
        }

        $approvedApplication = DB::table('vol_applications')
            ->where('opportunity_id', (int) $context->opportunity_id)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $approvedApplication) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_shift_approved_application_required')];
            return null;
        }

        // Check if already on waitlist
        $onWaitlist = DB::table('vol_shift_waitlist')
            ->where('shift_id', $shiftId)
            ->where('user_id', $userId)
            ->where('status', 'waiting')
            ->where('tenant_id', $tenantId)
            ->exists();

        if ($onWaitlist) {
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.shift_waitlist_already_joined')];
            return null;
        }

        // Check if already signed up
        $signedUp = DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->where('tenant_id', $tenantId)
            ->exists();

        if ($signedUp) {
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.shift_waitlist_already_signed_up')];
            return null;
        }

        $capacity = $context->capacity !== null ? (int) $context->capacity : null;
        if ($capacity === null) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_not_full')];
            return null;
        }

        $availableSlots = VolunteerShiftCapacityService::availableSlots($shiftId, $tenantId, $capacity);
        if ($availableSlots === null || $availableSlots > 0) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_not_full')];
            return null;
        }

        self::assertShiftRelationshipAllowed(
            $userId,
            (int) ($context->coordinator_id ?? 0),
            $tenantId,
            'volunteer_shift_waitlist_join',
        );

        try {
            return DB::transaction(function () use ($shiftId, $userId, $tenantId) {
                // Get next position (locked to prevent race condition)
                $nextPos = (int) DB::table('vol_shift_waitlist')
                    ->where('shift_id', $shiftId)
                    ->where('status', 'waiting')
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->max('position') + 1;

                return DB::table('vol_shift_waitlist')->insertGetId([
                    'tenant_id'  => $tenantId,
                    'shift_id'   => $shiftId,
                    'user_id'    => $userId,
                    'position'   => $nextPos,
                    'status'     => 'waiting',
                    'created_at' => now(),
                ]);
            });
        } catch (\Exception $e) {
            Log::error('ShiftWaitlistService::join error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.event_waitlist_failed')];
            return null;
        }
    }

    /**
     * Leave the waitlist for a shift.
     */
    public static function leave(int $shiftId, int $userId): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        try {
            $left = DB::transaction(function () use ($shiftId, $userId, $tenantId) {
                // Lock the entry so concurrent leave() calls reorder from the
                // live position instead of a stale snapshot (which left gaps).
                // A 'notified' entry (outstanding spot offer) can also leave —
                // its declined offer is passed to the next person below.
                $entry = DB::table('vol_shift_waitlist')
                    ->where('shift_id', $shiftId)
                    ->where('user_id', $userId)
                    ->whereIn('status', ['waiting', 'notified'])
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (! $entry) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_waitlist_not_on_waitlist')];
                    return null;
                }

                // Cancel the entry
                DB::table('vol_shift_waitlist')
                    ->where('id', $entry->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'cancelled']);

                // Reorder remaining positions
                DB::table('vol_shift_waitlist')
                    ->where('shift_id', $shiftId)
                    ->where('status', 'waiting')
                    ->where('position', '>', $entry->position)
                    ->where('tenant_id', $tenantId)
                    ->decrement('position');

                return $entry;
            });

            if ($left === null) {
                return false;
            }

            if ($left->status === 'notified') {
                self::notifyNext($shiftId, $tenantId);
            }

            return true;
        } catch (\Exception $e) {
            Log::error('ShiftWaitlistService::leave error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_waitlist_leave_failed')];
            return false;
        }
    }

    /**
     * Get waitlist entries for a shift.
     */
    public static function getWaitlist(int $shiftId): array
    {
        $tenantId = TenantContext::getId();

        $entries = DB::table('vol_shift_waitlist as w')
            ->join('users as u', 'w.user_id', '=', 'u.id')
            ->where('w.shift_id', $shiftId)
            ->where('w.status', 'waiting')
            ->where('w.tenant_id', $tenantId)
            ->orderBy('w.position')
            ->select('w.*', 'u.name as user_name', 'u.avatar_url as user_avatar')
            ->get();

        return $entries->map(function ($e) {
            return [
                'id'       => (int) $e->id,
                'position' => (int) $e->position,
                'user'     => [
                    'id'         => (int) $e->user_id,
                    'name'       => $e->user_name,
                    'avatar_url' => $e->user_avatar,
                ],
                'created_at' => $e->created_at,
            ];
        })->all();
    }

    /**
     * Get user's waitlist position for a shift.
     */
    public static function getUserPosition(int $shiftId, int $userId): ?array
    {
        $tenantId = TenantContext::getId();

        $entry = DB::table('vol_shift_waitlist')
            ->where('shift_id', $shiftId)
            ->where('user_id', $userId)
            ->where('status', 'waiting')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $entry) {
            return null;
        }

        $totalWaiting = DB::table('vol_shift_waitlist')
            ->where('shift_id', $shiftId)
            ->where('status', 'waiting')
            ->where('tenant_id', $tenantId)
            ->count();

        return [
            'id'            => (int) $entry->id,
            'position'      => (int) $entry->position,
            'total_waiting' => $totalWaiting,
        ];
    }

    /**
     * Get all waitlist entries for a user across all shifts.
     */
    public static function getUserWaitlists(int $userId, int $tenantId): array
    {
        try {
            $rows = DB::table('vol_shift_waitlist as w')
                ->join('vol_shifts as s', 'w.shift_id', '=', 's.id')
                ->join('vol_opportunities as opp', 's.opportunity_id', '=', 'opp.id')
                ->leftJoin('vol_organizations as org', 'opp.organization_id', '=', 'org.id')
                ->where('w.user_id', $userId)
                ->where('w.tenant_id', $tenantId)
                ->whereIn('w.status', ['waiting', 'notified'])
                ->orderBy('s.start_time')
                ->select(
                    'w.id', 'w.position', 'w.status', 'w.notified_at', 'w.created_at as joined_at',
                    's.id as shift_id', 's.start_time', 's.end_time', 's.capacity',
                    'opp.id as opportunity_id', 'opp.title as opportunity_title', 'opp.location as opportunity_location',
                    'org.id as organization_id', 'org.name as organization_name', 'org.logo_url as organization_logo_url'
                )
                ->get();

            return $rows->map(function ($row) {
                return [
                    'id'          => (int) $row->id,
                    'position'    => (int) $row->position,
                    'status'      => $row->status,
                    'notified_at' => $row->notified_at,
                    'shift'       => [
                        'id'         => (int) $row->shift_id,
                        'start_time' => $row->start_time,
                        'end_time'   => $row->end_time,
                        'capacity'   => $row->capacity !== null ? (int) $row->capacity : null,
                    ],
                    'opportunity' => [
                        'id'       => (int) $row->opportunity_id,
                        'title'    => $row->opportunity_title,
                        'location' => $row->opportunity_location ?? '',
                    ],
                    'organization' => [
                        'id'       => $row->organization_id ? (int) $row->organization_id : 0,
                        'name'     => $row->organization_name ?? '',
                        'logo_url' => $row->organization_logo_url ?? null,
                    ],
                    'joined_at' => $row->joined_at,
                ];
            })->all();
        } catch (\Exception $e) {
            Log::error('ShiftWaitlistService::getUserWaitlists error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Promote a user from the waitlist to the shift.
     *
     * Requires the entry to be in 'notified' state (the user was offered the
     * freed spot via notifyNext). Re-checks shift capacity under a row lock
     * so a claim can never overbook the shift.
     */
    public static function promoteUser(int $waitlistId, int $tenantId): bool
    {
        self::$errors = [];

        // If reactivating the user's application moves it off a different shift,
        // that shift frees a slot and its own waitlist must be offered the spot.
        $displacedShiftId = null;

        try {
            $ok = DB::transaction(function () use ($waitlistId, $tenantId, &$displacedShiftId) {
                $entry = DB::table('vol_shift_waitlist')
                    ->where('id', $waitlistId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (! $entry) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.vol_waitlist_not_found')];
                    return false;
                }

                if ($entry->status !== 'notified') {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_waitlist_not_notified')];
                    return false;
                }

                // Lock the shift and re-check capacity — the freed spot may have
                // been taken through another path since the notification.
                $shift = DB::table('vol_shifts')
                    ->where('id', $entry->shift_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (! $shift) {
                    self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.volunteer_shift_not_found')];
                    return false;
                }

                if (strtotime($shift->start_time) < time()) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_shift_started')];
                    return false;
                }

                if ($shift->capacity && ! VolunteerShiftCapacityService::hasAvailableSlot((int) $entry->shift_id, $tenantId, (int) $shift->capacity)) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_waitlist_spot_gone')];
                    return false;
                }

                // Attach the notified volunteer's existing approved application to the offered shift.
                $existingApp = DB::table('vol_applications')
                    ->where('opportunity_id', (int) $shift->opportunity_id)
                    ->where('user_id', $entry->user_id)
                    ->where('status', 'approved')
                    ->where('tenant_id', $tenantId)
                    ->first();

                if (! $existingApp) {
                    self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.volunteer_shift_approved_application_required')];
                    return false;
                }

                self::assertShiftRelationshipAllowed(
                    (int) $entry->user_id,
                    self::coordinatorIdForShift((int) $entry->shift_id, $tenantId),
                    $tenantId,
                    'volunteer_shift_waitlist_promotion',
                );

                // Attach the already-approved application to the shift. If it
                // was already attached to a different shift, capture that so
                // its waitlist gets the freed slot after we commit.
                if (!empty($existingApp->shift_id) && (int) $existingApp->shift_id !== (int) $entry->shift_id) {
                    $displacedShiftId = (int) $existingApp->shift_id;
                }
                DB::table('vol_applications')
                    ->where('id', $existingApp->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['shift_id' => $entry->shift_id, 'updated_at' => now()]);

                DB::table('vol_shift_waitlist')
                    ->where('id', $waitlistId)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'status'      => 'promoted',
                        'promoted_at' => now(),
                    ]);

                return true;
            });

            if ($ok && $displacedShiftId) {
                self::notifyNext($displacedShiftId, $tenantId);
            }

            return $ok;
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Exception $e) {
            Log::error('ShiftWaitlistService::promoteUser error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_waitlist_claim_failed')];
            return false;
        }
    }

    /**
     * Offer a freed shift spot to the next person on the waitlist.
     *
     * Called whenever a shift slot frees (signup cancelled, approved
     * application declined). Picks the lowest-position 'waiting' entry,
     * marks it 'notified', and sends the user a bell + push notification
     * in their own language. The user then claims the spot via
     * promoteUser() (or it expires via expireStaleNotifications()).
     *
     * No-op when the shift has no free capacity, has already started, or
     * the waitlist is empty. Safe to call from any slot-freeing code path —
     * never throws.
     */
    public static function notifyNext(int $shiftId, int $tenantId): bool
    {
        try {
            $notifiedEntry = DB::transaction(function () use ($shiftId, $tenantId) {
                $shift = DB::table('vol_shifts')
                    ->where('id', $shiftId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (! $shift || strtotime($shift->start_time) < time()) {
                    return null;
                }

                // Only offer a spot if there is genuinely free capacity once
                // approved signups AND outstanding (unexpired) offers are counted.
                if ($shift->capacity && ! VolunteerShiftCapacityService::hasAvailableSlot($shiftId, $tenantId, (int) $shift->capacity, null, true)) {
                    return null;
                }

                $entry = DB::table('vol_shift_waitlist')
                    ->where('shift_id', $shiftId)
                    ->where('status', 'waiting')
                    ->where('tenant_id', $tenantId)
                    ->orderBy('position')
                    ->lockForUpdate()
                    ->first();

                if (! $entry) {
                    return null;
                }

                self::assertShiftRelationshipAllowed(
                    (int) $entry->user_id,
                    self::coordinatorIdForShift($shiftId, $tenantId),
                    $tenantId,
                    'volunteer_shift_waitlist_spot_offer',
                );

                DB::table('vol_shift_waitlist')
                    ->where('id', $entry->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'notified', 'notified_at' => now()]);

                return $entry;
            });

            if (! $notifiedEntry) {
                return false;
            }

            // Notify outside the transaction — a notification failure must not
            // roll back the state change (the cron expiry path re-offers).
            try {
                $recipient = DB::table('users')
                    ->where('id', $notifiedEntry->user_id)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($notifiedEntry) {
                    $content = __('svc_notifications.shift_waitlist.spot_available');
                    NotificationDispatcher::dispatch(
                        (int) $notifiedEntry->user_id,
                        'global',
                        null,
                        'vol_waitlist_spot',
                        $content,
                        '/volunteering?tab=waitlist',
                        null,
                        false
                    );
                });
            } catch (\Throwable $notifErr) {
                Log::warning('ShiftWaitlistService::notifyNext notification failed', ['error' => $notifErr->getMessage()]);
            }

            return true;
        } catch (SafeguardingPolicyException $e) {
            Log::warning('Waitlist spot offer blocked by safeguarding policy', [
                'shift_id' => $shiftId,
                'tenant_id' => $tenantId,
                'reason_code' => $e->reasonCode,
            ]);
            return false;
        } catch (\Throwable $e) {
            Log::error('ShiftWaitlistService::notifyNext error: ' . $e->getMessage());
            return false;
        }
    }

    private static function coordinatorIdForShift(int $shiftId, int $tenantId): int
    {
        return (int) (DB::table('vol_shifts as s')
            ->join('vol_opportunities as opportunity', function ($join): void {
                $join->on('opportunity.id', '=', 's.opportunity_id')
                    ->on('opportunity.tenant_id', '=', 's.tenant_id');
            })
            ->join('vol_organizations as organization', function ($join): void {
                $join->on('organization.id', '=', 'opportunity.organization_id')
                    ->on('organization.tenant_id', '=', 'opportunity.tenant_id');
            })
            ->where('s.id', $shiftId)
            ->where('s.tenant_id', $tenantId)
            ->value('organization.user_id') ?? 0);
    }

    private static function assertShiftRelationshipAllowed(
        int $volunteerId,
        int $coordinatorId,
        int $tenantId,
        string $channel,
    ): void {
        if ($volunteerId === $coordinatorId) {
            return;
        }

        if ($coordinatorId <= 0) {
            throw new SafeguardingPolicyException(
                'SAFEGUARDING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.policy_unavailable'),
            );
        }

        $policy = app(SafeguardingInteractionPolicy::class);
        $policy->assertLocalContactAllowed($volunteerId, $coordinatorId, $tenantId, $channel);
        $policy->assertLocalContactAllowed($coordinatorId, $volunteerId, $tenantId, $channel);
    }

    /**
     * Expire stale spot offers and pass them to the next person in line.
     *
     * Cron entry point (CronJobRunner). Any 'notified' entry older than
     * $hours is marked 'expired' and notifyNext() runs for its shift so the
     * offer cascades down the queue. Returns the number of expired offers.
     */
    public static function expireStaleNotifications(int $hours = 48): int
    {
        $cutoff = now()->subHours($hours);

        $stale = DB::table('vol_shift_waitlist')
            ->where('status', 'notified')
            ->where('notified_at', '<', $cutoff)
            ->select(['id', 'shift_id', 'tenant_id'])
            ->get();

        $expired = 0;
        foreach ($stale as $entry) {
            try {
                $affected = DB::table('vol_shift_waitlist')
                    ->where('id', $entry->id)
                    ->where('tenant_id', $entry->tenant_id)
                    ->where('status', 'notified')
                    ->update(['status' => 'expired']);

                if ($affected > 0) {
                    $expired++;
                    self::notifyNext((int) $entry->shift_id, (int) $entry->tenant_id);
                }
            } catch (\Throwable $e) {
                Log::warning('ShiftWaitlistService::expireStaleNotifications entry failed', [
                    'waitlist_id' => $entry->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $expired;
    }
}
