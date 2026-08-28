<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Models\VolApplication;
use App\Models\VolEmergencyAlert;
use App\Models\VolEmergencyAlertRecipient;
use App\Models\VolOpportunity;
use App\Models\VolOrganization;
use App\Models\VolShift;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolunteerEmergencyAlertService — urgent shift-fill requests.
 *
 * Coordinators can send urgent alerts to qualified volunteers when
 * a shift needs to be filled quickly. Filters by skills, availability,
 * and proximity.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait on models.
 */
class VolunteerEmergencyAlertService
{
    /** @var array */
    private static array $errors = [];

    public function __construct()
    {
    }

    /**
     * Get errors from the last operation.
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Create an emergency alert for a shift.
     *
     * @param int $createdBy Coordinator user ID
     * @param array $data [shift_id, message, priority, required_skills, expires_hours]
     * @return int|null Alert ID or null on failure
     */
    public static function createAlert(int $createdBy, array $data): ?int
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $shiftId = (int) ($data['shift_id'] ?? 0);
        $message = trim($data['message'] ?? '');
        $priority = $data['priority'] ?? 'urgent';
        $requiredSkills = $data['required_skills'] ?? null;
        // Clamp the expiry window: at least 1 hour, at most 336 (14 days),
        // defaulting to 24. Prevents a zero/negative value (an immediately-stale
        // alert) or an unbounded one that would linger for months.
        $expiresHours = max(1, min(336, (int) ($data['expires_hours'] ?? 24)));

        if (!$shiftId) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_alert_shift_id_required'), 'field' => 'shift_id'];
            return null;
        }

        if (!$message) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_alert_message_required'), 'field' => 'message'];
            return null;
        }

        if (!in_array($priority, ['normal', 'urgent', 'critical'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_alert_priority_invalid'), 'field' => 'priority'];
            return null;
        }

        // Verify shift exists
        $shift = VolShift::find($shiftId);
        if (!$shift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.vol_alert_shift_not_found')];
            return null;
        }

        // Verify coordinator owns the opportunity's org
        $opportunity = VolOpportunity::with('organization')->find($shift->opportunity_id);
        if (!$opportunity || !$opportunity->organization) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.vol_alert_opportunity_not_found')];
            return null;
        }

        // Allow org owner or tenant admin
        if (!self::isAdminOrOrgOwner($createdBy, (int) $opportunity->organization->user_id)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.vol_alert_create_forbidden')];
            return null;
        }

        // Encode skills as JSON string for storage
        $skillsJson = null;
        if ($requiredSkills) {
            if (is_array($requiredSkills)) {
                $skillsJson = json_encode($requiredSkills);
            } elseif (is_string($requiredSkills)) {
                $skills = array_filter(array_map('trim', explode(',', $requiredSkills)));
                $skillsJson = json_encode(array_values($skills));
            }
        }

        try {
            $candidates = self::qualifiedVolunteers($shiftId, $skillsJson, $tenantId);
            app(SafeguardingInteractionPolicy::class)->assertManyLocalContactsAllowed(
                $createdBy,
                $candidates->pluck('user_id')->map(static fn ($id): int => (int) $id)->all(),
                $tenantId,
                'volunteer_emergency_alert_broadcast',
            );

            $expiresAt = now()->addHours($expiresHours);
            $alert = VolEmergencyAlert::create([
                'tenant_id' => $tenantId,
                'shift_id' => $shiftId,
                'created_by' => $createdBy,
                'priority' => $priority,
                'message' => $message,
                'required_skills' => $skillsJson,
                'status' => 'active',
                'expires_at' => $expiresAt,
                'created_at' => now(),
            ]);

            // Notify qualified volunteers (best-effort, non-blocking)
            self::notifyQualifiedVolunteers($alert->id, $shiftId, $candidates, $tenantId, $priority, $message);

            return $alert->id;
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Exception $e) {
            Log::error('VolunteerEmergencyAlertService::createAlert error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_alert_create_failed')];
            return null;
        }
    }

    /**
     * Respond to an emergency alert (accept/decline).
     *
     * @param int $alertId Alert ID
     * @param int $userId Responding user
     * @param string $response 'accepted' or 'declined'
     * @return bool Success
     */
    public static function respond(int $alertId, int $userId, string $response): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        if (!in_array($response, ['accepted', 'declined'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_alert_response_invalid')];
            return false;
        }

        try {
            $alert = DB::transaction(function () use ($tenantId, $alertId, $userId, $response) {
                $alert = VolEmergencyAlert::where('tenant_id', $tenantId)
                    ->where('id', $alertId)
                    ->lockForUpdate()
                    ->first();

                if (!$alert || $alert->status !== 'active') {
                    throw new \RuntimeException('ALERT_INACTIVE');
                }

                // Lapsed alerts are no longer actionable: without this guard a
                // volunteer could "accept" a days-old alert, flipping it to
                // 'filled' and pinging the coordinator as though the (long past)
                // shift were covered. expires_at is set on create but there is
                // no sweeper flipping status, so it must be enforced on read.
                if ($alert->expires_at !== null && $alert->expires_at->isPast()) {
                    throw new \RuntimeException('ALERT_INACTIVE');
                }

                $recipient = VolEmergencyAlertRecipient::where('tenant_id', $tenantId)
                    ->where('alert_id', $alertId)
                    ->where('user_id', $userId)
                    ->lockForUpdate()
                    ->first();

                if (!$recipient || $recipient->response !== 'pending') {
                    throw new \RuntimeException('RECIPIENT_NOT_FOUND');
                }

                if ($response === 'accepted') {
                    $policy = app(SafeguardingInteractionPolicy::class);
                    $policy->assertLocalContactAllowed(
                        $userId,
                        (int) $alert->created_by,
                        $tenantId,
                        'volunteer_emergency_alert_acceptance',
                    );
                    $policy->assertLocalContactAllowed(
                        (int) $alert->created_by,
                        $userId,
                        $tenantId,
                        'volunteer_emergency_alert_acceptance',
                    );
                }

                $recipient->update([
                    'response' => $response,
                    'responded_at' => now(),
                ]);

                if ($response === 'accepted') {
                    // Mark alert as filled
                    $alert->update([
                        'status' => 'filled',
                        'filled_at' => now(),
                    ]);
                }

                return $alert;
            });

            if ($response === 'accepted') {
                // Notify the coordinator (best-effort)
                try {
                    $user = User::where('tenant_id', $tenantId)->where('id', $userId)->first();
                    $userName = $user->name ?? __('api.vol_alert_volunteer_fallback');

                    $coordinator = User::where('tenant_id', $tenantId)->where('id', (int) $alert->created_by)->first(['id', 'preferred_language']);
                    TenantContext::runForTenant($tenantId, function () use ($alert, $coordinator, $userName): void {
                        LocaleContext::withLocale($coordinator, function () use ($alert, $userName): void {
                            \App\Models\Notification::createNotification(
                                (int) $alert->created_by,
                                __('api.vol_alert_filled_bell', ['name' => $userName]),
                                '/volunteering',
                                'volunteer_emergency_filled',
                                true
                            );
                            \App\Services\NotificationDispatcher::fanOutPush((int) ($alert->created_by), 'volunteer_emergency_filled', __('api.vol_alert_filled_bell', ['name' => $userName]), '/volunteering');
                        });
                    });
                } catch (\Throwable $e) {
                    // Silent fail for notification
                }
            }

            return true;
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            throw $e;
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'ALERT_INACTIVE') {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_alert_inactive')];
                return false;
            }

            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.vol_alert_not_invited_or_responded')];
            return false;
        } catch (\Exception $e) {
            Log::error('VolunteerEmergencyAlertService::respond error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_alert_response_failed')];
            return false;
        }
    }

    /**
     * Get active alerts for a user (ones they've been notified about) with cursor pagination.
     *
     * @param int $userId User ID
     * @param array $filters Optional: limit, cursor
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getUserAlerts(int $userId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        $query = VolEmergencyAlert::query()
            ->join('vol_emergency_alert_recipients as r', function ($join) {
                $join->on('r.alert_id', '=', 'vol_emergency_alerts.id')
                    ->on('r.tenant_id', '=', 'vol_emergency_alerts.tenant_id');
            })
            ->join('vol_shifts as s', function ($join) {
                $join->on('vol_emergency_alerts.shift_id', '=', 's.id')
                    ->on('vol_emergency_alerts.tenant_id', '=', 's.tenant_id');
            })
            ->join('vol_opportunities as o', function ($join) {
                $join->on('s.opportunity_id', '=', 'o.id')
                    ->on('s.tenant_id', '=', 'o.tenant_id');
            })
            ->join('vol_organizations as org', function ($join) {
                $join->on('o.organization_id', '=', 'org.id')
                    ->on('o.tenant_id', '=', 'org.tenant_id');
            })
            ->join('users as u', function ($join) {
                $join->on('vol_emergency_alerts.created_by', '=', 'u.id')
                    ->on('vol_emergency_alerts.tenant_id', '=', 'u.tenant_id');
            })
            ->where('vol_emergency_alerts.tenant_id', $tenantId)
            ->where('r.user_id', $userId)
            ->where('vol_emergency_alerts.status', 'active')
            // No sweeper flips lapsed alerts to 'expired', so enforce
            // expires_at on read — a stale urgent alert must not stay
            // visible/actionable for recipients indefinitely.
            ->where(function ($q) {
                $q->whereNull('vol_emergency_alerts.expires_at')
                    ->orWhere('vol_emergency_alerts.expires_at', '>', now());
            })
            ->select([
                'vol_emergency_alerts.*',
                'r.response as my_response',
                'r.notified_at',
                's.start_time',
                's.end_time',
                'o.title as opp_title',
                'o.location as opp_location',
                'org.name as org_name',
                'u.name as coordinator_name',
            ]);

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('vol_emergency_alerts.id', '<', (int) $cid);
        }

        $query->orderByDesc('vol_emergency_alerts.id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $mapped = $items->map(fn ($a) => [
            'id' => $a->id,
            'priority' => $a->priority,
            'message' => $a->message,
            'my_response' => $a->my_response,
            'required_skills' => json_decode($a->getRawOriginal('required_skills') ?? '[]', true) ?: [],
            'shift' => [
                'id' => (int) $a->shift_id,
                'start_time' => $a->start_time,
                'end_time' => $a->end_time,
            ],
            'opportunity' => [
                'title' => $a->opp_title,
                'location' => $a->opp_location,
            ],
            'organization' => [
                'name' => $a->org_name,
            ],
            'coordinator' => [
                'name' => $a->coordinator_name,
            ],
            'expires_at' => $a->expires_at?->toDateTimeString(),
            'created_at' => $a->created_at?->toDateTimeString(),
        ]);

        return [
            'items'    => $mapped->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get alerts created by a coordinator.
     *
     * @param int $coordinatorId Coordinator user ID
     * @return array Alerts with response stats
     */
    public static function getCoordinatorAlerts(int $coordinatorId): array
    {
        $tenantId = TenantContext::getId();
        $alerts = VolEmergencyAlert::query()
            ->join('vol_shifts as s', function ($join) {
                $join->on('vol_emergency_alerts.shift_id', '=', 's.id')
                    ->on('vol_emergency_alerts.tenant_id', '=', 's.tenant_id');
            })
            ->join('vol_opportunities as o', function ($join) {
                $join->on('s.opportunity_id', '=', 'o.id')
                    ->on('s.tenant_id', '=', 'o.tenant_id');
            })
            ->where('vol_emergency_alerts.tenant_id', $tenantId)
            ->where('vol_emergency_alerts.created_by', $coordinatorId)
            ->orderByDesc('vol_emergency_alerts.created_at')
            ->limit(50)
            ->select([
                'vol_emergency_alerts.*',
                's.start_time',
                's.end_time',
                'o.title as opp_title',
            ])
            ->get();

        // Aggregate response stats for all alerts in a single grouped query
        // instead of 3 COUNT round-trips per alert (N+1 — up to 150 queries for
        // a coordinator with 50 alerts).
        $alertIds = $alerts->pluck('id')->map(static fn ($id) => (int) $id)->all();
        $statsByAlert = [];
        if ($alertIds !== []) {
            $statRows = VolEmergencyAlertRecipient::query()
                ->where('tenant_id', $tenantId)
                ->whereIn('alert_id', $alertIds)
                ->selectRaw(
                    "alert_id,
                     COUNT(*) as total_notified,
                     SUM(CASE WHEN response = 'accepted' THEN 1 ELSE 0 END) as total_accepted,
                     SUM(CASE WHEN response = 'declined' THEN 1 ELSE 0 END) as total_declined"
                )
                ->groupBy('alert_id')
                ->get();
            foreach ($statRows as $statRow) {
                $statsByAlert[(int) $statRow->alert_id] = [
                    'total_notified' => (int) $statRow->total_notified,
                    'total_accepted' => (int) $statRow->total_accepted,
                    'total_declined' => (int) $statRow->total_declined,
                ];
            }
        }

        return $alerts->map(function ($a) use ($statsByAlert) {
            $stats = $statsByAlert[(int) $a->id] ?? [
                'total_notified' => 0,
                'total_accepted' => 0,
                'total_declined' => 0,
            ];

            return [
                'id' => $a->id,
                'priority' => $a->priority,
                'message' => $a->message,
                'status' => $a->status,
                'shift' => [
                    'id' => (int) $a->shift_id,
                    'start_time' => $a->start_time,
                    'end_time' => $a->end_time,
                ],
                'opportunity_title' => $a->opp_title,
                'stats' => $stats,
                'expires_at' => $a->expires_at?->toDateTimeString(),
                'created_at' => $a->created_at?->toDateTimeString(),
            ];
        })->toArray();
    }

    /**
     * Cancel an active emergency alert.
     *
     * @param int $alertId  Alert ID
     * @param int $userId   User cancelling (must be the creator)
     * @param int $tenantId Tenant ID
     * @return bool Success
     */
    public static function cancelAlert(int $alertId, int $userId, int $tenantId): bool
    {
        self::$errors = [];

        $alert = VolEmergencyAlert::where('id', $alertId)
            ->where('tenant_id', $tenantId)
            ->where('created_by', $userId)
            ->where('status', 'active')
            ->first();

        if (!$alert) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.vol_alert_cancel_not_found')];
            return false;
        }

        try {
            $alert->update(['status' => 'cancelled']);
            return true;
        } catch (\Exception $e) {
            Log::error('VolunteerEmergencyAlertService::cancelAlert error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_alert_cancel_failed')];
            return false;
        }
    }

    /**
     * Get errors from the last cancelAlert() call.
     */
    public static function getCancelErrors(): array
    {
        return self::$errors;
    }

    /**
     * Find qualified volunteers before the alert or any recipient row is written.
     *
     * @return Collection<int, object>
     */
    private static function qualifiedVolunteers(int $shiftId, ?string $skillsJson, int $tenantId): Collection
    {
        // Find volunteers who:
        // 1. Have approved applications for the opportunity's org
        // 2. Are not already signed up for this specific shift
        $candidates = User::query()
            ->join('vol_applications as va', function ($join) use ($tenantId) {
                $join->on('va.user_id', '=', 'users.id')
                    ->where('va.status', '=', 'approved')
                    ->where('va.tenant_id', '=', $tenantId);
            })
            ->join('vol_opportunities as opp', function ($join) use ($tenantId) {
                $join->on('va.opportunity_id', '=', 'opp.id')
                    ->where('opp.tenant_id', '=', $tenantId);
            })
            ->join('vol_shifts as s', function ($join) use ($shiftId, $tenantId) {
                $join->on('s.opportunity_id', '=', 'opp.id')
                    ->where('s.id', '=', $shiftId)
                    ->where('s.tenant_id', '=', $tenantId);
            })
            ->whereNotIn('users.id', function ($q) use ($shiftId, $tenantId) {
                $q->select('user_id')
                    ->from('vol_applications')
                    ->where('shift_id', $shiftId)
                    ->where('status', 'approved')
                    ->where('tenant_id', $tenantId);
            })
            ->select('users.id as user_id', 'users.email', 'users.name', 'users.skills', 'users.preferred_language')
            ->distinct()
            ->limit(50)
            ->get();

        $requiredSkills = [];
        if ($skillsJson) {
            $decoded = json_decode($skillsJson, true);
            $requiredSkills = is_array($decoded) ? $decoded : [];
        }

        return $candidates->filter(static function (object $candidate) use ($requiredSkills): bool {
            if (! empty($requiredSkills)) {
                $userSkillsRaw = $candidate->skills ?? '';
                $userSkills = array_filter(array_map('trim', explode(',', $userSkillsRaw)));
                $hasMatch = false;

                foreach ($requiredSkills as $requiredSkill) {
                    $requiredSkill = trim($requiredSkill);
                    if ($requiredSkill === '') {
                        continue;
                    }
                    foreach ($userSkills as $userSkill) {
                        if (preg_match('/\b' . preg_quote($requiredSkill, '/') . '\b/i', $userSkill)) {
                            $hasMatch = true;
                            break 2;
                        }
                    }
                }

                return $hasMatch;
            }

            return true;
        })->values();
    }

    /**
     * @param Collection<int, object> $candidates
     */
    private static function notifyQualifiedVolunteers(int $alertId, int $shiftId, Collection $candidates, int $tenantId, string $priority, string $message): int
    {
        $notifiedCount = 0;
        $shift = VolShift::where('tenant_id', $tenantId)->where('id', $shiftId)->first();
        // Keep the raw shift start; the human-readable date is formatted inside
        // each recipient's LocaleContext below so it renders in their language.
        $shiftStart = $shift?->start_time;

        foreach ($candidates as $candidate) {
            try {
                $priorityLabel = strtoupper($priority);
                $bellCreated = TenantContext::runForTenant($tenantId, function () use ($candidate, $priorityLabel, $message, $shiftStart, $tenantId): bool {
                    return (bool) LocaleContext::withLocale($candidate, function () use ($candidate, $priorityLabel, $message, $shiftStart, $tenantId) {
                        $shiftDate = $shiftStart
                            ? \Carbon\Carbon::parse($shiftStart)->locale(\App\I18n\FormattingLocale::carbon())->isoFormat('lll')
                            : __('api.vol_alert_shift_date_upcoming');
                        $pushBody = __('api.vol_alert_request_bell', [
                            'priority' => $priorityLabel,
                            'message' => $message,
                            'date' => $shiftDate,
                        ]);
                        $bellId = \App\Models\Notification::createNotification(
                            (int) $candidate->user_id,
                            $pushBody,
                            '/volunteering',
                            'volunteer_emergency',
                            true,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($candidate->user_id), 'volunteer_emergency', $pushBody, '/volunteering');
                        return $bellId;
                    });
                });

                if (!$bellCreated) {
                    Log::warning("Failed to create emergency alert notification for volunteer {$candidate->user_id}");
                    continue;
                }

                VolEmergencyAlertRecipient::create([
                    'alert_id' => $alertId,
                    'tenant_id' => $tenantId,
                    'user_id' => $candidate->user_id,
                    'notified_at' => now(),
                    'response' => 'pending',
                ]);

                $notifiedCount++;
            } catch (\Throwable $e) {
                Log::warning("Failed to notify volunteer {$candidate->user_id}: " . $e->getMessage());
            }
        }

        return $notifiedCount;
    }

    /**
     * Check if user is admin or org owner.
     */
    private static function isAdminOrOrgOwner(int $userId, int $orgOwnerId): bool
    {
        if ($userId === $orgOwnerId) {
            return true;
        }

        $user = User::where('tenant_id', TenantContext::getId())->where('id', $userId)->first();
        if ($user && in_array($user->role ?? '', ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'])) {
            return true;
        }

        return false;
    }
}
