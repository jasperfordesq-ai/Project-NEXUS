<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * VolunteerWellbeingService — detects burnout risk and manages wellbeing alerts
 * for volunteers.
 *
 * Backed by `vol_wellbeing_alerts`, `vol_logs`, `vol_shift_signups`, and
 * `vol_applications` tables. All queries are tenant-scoped via TenantContext.
 */
class VolunteerWellbeingService
{
    /** @var array Validation/business errors from the last operation */
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
     * Detect burnout risk for a volunteer user.
     *
     * Analyses multiple indicators:
     *  - Shift frequency trend (current vs previous period)
     *  - Cancellation rate
     *  - Hours trend (increasing/declining)
     *  - Engagement gap (days since last activity)
     *
     * Returns a risk assessment with a 0-100 risk_score, risk_level, and
     * detailed indicators that the controller uses to build the wellbeing dashboard.
     *
     * @param bool $persist When true, an active wellbeing alert is upserted for
     *                       an at-risk (score >= 30) volunteer. Read endpoints
     *                       (dashboard / my-status) pass false so a GET never
     *                       writes; the scheduled tenant assessment passes true.
     * @return array  Assessment with keys: risk_score, risk_level, indicators, recommendations
     */
    public static function detectBurnoutRisk(int $userId, bool $persist = false): array
    {
        $tenantId = TenantContext::getId();

        $indicators = [];
        $riskPoints = 0;

        // ── 1. Shift frequency trend ──
        // Live shift signups are vol_applications rows carrying a shift_id — the
        // legacy vol_shift_signups table is no longer written to, so reading it
        // here always returned 0 and silently disabled this indicator. Compare
        // approved shift signups whose shift starts in the last 30 days vs the
        // 30 days before that.
        $recentShifts = (int) DB::table('vol_applications as a')
            ->join('vol_shifts as s', 'a.shift_id', '=', 's.id')
            ->where('a.user_id', $userId)
            ->where('a.tenant_id', $tenantId)
            ->whereNotNull('a.shift_id')
            ->where('a.status', 'approved')
            ->where('s.start_time', '>=', now()->subDays(30))
            ->count();

        $previousShifts = (int) DB::table('vol_applications as a')
            ->join('vol_shifts as s', 'a.shift_id', '=', 's.id')
            ->where('a.user_id', $userId)
            ->where('a.tenant_id', $tenantId)
            ->whereNotNull('a.shift_id')
            ->where('a.status', 'approved')
            ->where('s.start_time', '>=', now()->subDays(60))
            ->where('s.start_time', '<', now()->subDays(30))
            ->count();

        $shiftTrend = 'stable';
        if ($previousShifts > 0 && $recentShifts < $previousShifts * 0.5) {
            $shiftTrend = 'declining';
            $riskPoints += 20;
        } elseif ($previousShifts > 0 && $recentShifts < $previousShifts * 0.8) {
            $shiftTrend = 'slightly_declining';
            $riskPoints += 10;
        } elseif ($recentShifts > $previousShifts) {
            $shiftTrend = 'increasing';
        }

        $indicators['shift_frequency'] = [
            'recent_count' => $recentShifts,
            'previous_count' => $previousShifts,
            'trend' => $shiftTrend,
        ];

        // ── 2. Cancellation rate ──
        // Shift cancellations are no longer retained as discrete records:
        // cancelling a shift nulls vol_applications.shift_id (see
        // VolunteerService::cancelShiftSignup), so a historical cancellation
        // rate cannot be reconstructed. Report total live shift signups with a
        // 0% cancellation rate rather than reading the dead vol_shift_signups
        // table. This indicator contributes no risk points until the platform
        // tracks cancellations again.
        $totalSignups = (int) DB::table('vol_applications')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('shift_id')
            ->count();

        $cancelledSignups = 0;

        $cancellationRate = $totalSignups > 0 ? round(($cancelledSignups / $totalSignups) * 100, 1) : 0;

        if ($cancellationRate > 50) {
            $riskPoints += 25;
        } elseif ($cancellationRate > 30) {
            $riskPoints += 15;
        } elseif ($cancellationRate > 15) {
            $riskPoints += 5;
        }

        $indicators['cancellation_rate'] = [
            'total_signups' => $totalSignups,
            'cancelled' => $cancelledSignups,
            'rate_percent' => $cancellationRate,
        ];

        // ── 3. Hours trend ──
        $recentHours = (float) DB::table('vol_logs')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->where('date_logged', '>=', now()->subDays(30))
            ->sum('hours');

        $previousHours = (float) DB::table('vol_logs')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->where('date_logged', '>=', now()->subDays(60))
            ->where('date_logged', '<', now()->subDays(30))
            ->sum('hours');

        $hoursTrend = 'stable';
        if ($previousHours > 0 && $recentHours < $previousHours * 0.3) {
            $hoursTrend = 'declining_significantly';
            $riskPoints += 25;
        } elseif ($previousHours > 0 && $recentHours < $previousHours * 0.6) {
            $hoursTrend = 'declining';
            $riskPoints += 15;
        } elseif ($recentHours > $previousHours && $previousHours > 0) {
            $hoursTrend = 'increasing';
        }

        $indicators['hours_trend'] = [
            'recent_hours' => round($recentHours, 2),
            'previous_hours' => round($previousHours, 2),
            'trend' => $hoursTrend,
        ];

        // ── 4. Engagement gap ──
        $lastActivity = DB::table('vol_logs')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->max('date_logged');

        $daysSinceLastActivity = 0;
        if ($lastActivity) {
            // Carbon 3 diffInDays() is signed — now()->diffInDays(past) is negative,
            // which made every engagement-gap threshold below unreachable.
            $daysSinceLastActivity = (int) abs(now()->diffInDays($lastActivity));
        } else {
            // No activity ever — check if they have any signups at all
            // (live signups are vol_applications; vol_shift_signups is legacy)
            $hasAnySignup = DB::table('vol_applications')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->exists();
            $daysSinceLastActivity = $hasAnySignup ? 90 : 0; // only flag if they were once active
        }

        if ($daysSinceLastActivity > 60) {
            $riskPoints += 20;
        } elseif ($daysSinceLastActivity > 30) {
            $riskPoints += 10;
        } elseif ($daysSinceLastActivity > 14) {
            $riskPoints += 5;
        }

        $indicators['engagement_gap'] = [
            'last_activity_date' => $lastActivity,
            'days_since_last_activity' => $daysSinceLastActivity,
        ];

        // ── 5. Overcommitment check ──
        // Count upcoming scheduled shifts in the next 7 days
        $upcomingShifts = (int) DB::table('vol_applications as a')
            ->join('vol_shifts as s', 'a.shift_id', '=', 's.id')
            ->where('a.user_id', $userId)
            ->where('a.tenant_id', $tenantId)
            ->where('a.status', 'approved')
            ->where('s.start_time', '>=', now())
            ->where('s.start_time', '<=', now()->addDays(7))
            ->count();

        if ($upcomingShifts > 7) {
            $riskPoints += 15; // More than one shift per day on average
        } elseif ($upcomingShifts > 5) {
            $riskPoints += 5;
        }

        $indicators['overcommitment'] = [
            'upcoming_shifts_7_days' => $upcomingShifts,
        ];

        // ── Calculate overall risk ──
        $riskScore = min(100, max(0, $riskPoints));

        $riskLevel = match (true) {
            $riskScore >= 70 => 'critical',
            $riskScore >= 50 => 'high',
            $riskScore >= 30 => 'moderate',
            default => 'low',
        };

        // Build recommendations based on risk indicators
        $recommendations = [];
        if ($shiftTrend === 'declining' || $hoursTrend === 'declining_significantly') {
            $recommendations[] = __('api.vol_wellbeing_recommendation_reduce_commitments');
        }
        if ($cancellationRate > 30) {
            $recommendations[] = __('api.vol_wellbeing_recommendation_fewer_shifts');
        }
        if ($daysSinceLastActivity > 30) {
            $recommendations[] = __('api.vol_wellbeing_recommendation_ease_back');
        }
        if ($upcomingShifts > 7) {
            $recommendations[] = __('api.vol_wellbeing_recommendation_schedule_rest');
        }
        if ($riskLevel === 'low' && empty($recommendations)) {
            $recommendations[] = __('api.vol_wellbeing_recommendation_healthy_balance');
        }

        // Persist an alert if risk is moderate or higher — but only in a write
        // context (the scheduled tenant assessment). Read endpoints pass
        // $persist = false so viewing the wellbeing dashboard never mutates
        // vol_wellbeing_alerts. upsertAlert is idempotent (one active row per
        // user), so the daily job refreshes rather than duplicates.
        if ($persist && $riskScore >= 30) {
            self::upsertAlert($tenantId, $userId, $riskLevel, $riskScore, $indicators);
        }

        return [
            'risk_score' => $riskScore,
            'risk_level' => $riskLevel,
            'indicators' => $indicators,
            'recommendations' => $recommendations,
        ];
    }

    /**
     * Run a tenant-wide burnout assessment.
     *
     * Scans all active volunteers in the current tenant and returns
     * summary statistics plus a list of at-risk volunteers.
     *
     * @return array  Summary with keys: total_assessed, at_risk, risk_breakdown, at_risk_users
     */
    public static function runTenantAssessment(): array
    {
        $tenantId = TenantContext::getId();

        // Get users who have volunteered (have approved logs or live shift
        // signups). Live signups are vol_applications rows carrying a shift_id —
        // the legacy vol_shift_signups table is no longer written to, so reading
        // it here silently dropped shift-only volunteers from the scan.
        $volunteerIds = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->distinct()
            ->pluck('user_id')
            ->merge(
                DB::table('vol_applications')
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('shift_id')
                    ->distinct()
                    ->pluck('user_id')
            )
            ->unique()
            ->values()
            ->all();

        $riskBreakdown = ['low' => 0, 'moderate' => 0, 'high' => 0, 'critical' => 0];
        $atRiskUsers = [];

        foreach ($volunteerIds as $userId) {
            $assessment = self::detectBurnoutRisk((int) $userId, true);
            $level = $assessment['risk_level'] ?? 'low';
            $riskBreakdown[$level] = ($riskBreakdown[$level] ?? 0) + 1;

            // Recovered below the alert threshold: close any stale system-raised
            // active alert. detectBurnoutRisk only ever WRITES alerts (score >= 30);
            // without this reconciliation a recovered volunteer keeps an 'active'
            // alert carrying old score/indicators forever.
            if ((int) ($assessment['risk_score'] ?? 0) < 30) {
                self::resolveRecoveredAlert($tenantId, (int) $userId);
            }

            if (in_array($level, ['moderate', 'high', 'critical'], true)) {
                // Fetch user name
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name')
                    ->first();

                if ($user) {
                    $atRiskUsers[] = [
                        'user_id' => (int) $user->id,
                        'name' => UserDisplayName::resolve($user),
                        'risk_level' => $level,
                        'risk_score' => $assessment['risk_score'],
                    ];
                }
            }
        }

        // Sort at-risk users by score descending
        usort($atRiskUsers, fn ($a, $b) => $b['risk_score'] <=> $a['risk_score']);

        return [
            'total_assessed' => count($volunteerIds),
            'at_risk' => count($atRiskUsers),
            'risk_breakdown' => $riskBreakdown,
            'at_risk_users' => $atRiskUsers,
        ];
    }

    /**
     * Get wellbeing alerts for the current tenant, filtered by status.
     *
     * @param string $status  One of: active, acknowledged, resolved, dismissed (defaults to active)
     * @return array  List of alerts with user info
     */
    public static function getActiveAlerts(string $status = 'active'): array
    {
        $tenantId = TenantContext::getId();

        try {
            $alerts = DB::table('vol_wellbeing_alerts as wa')
                ->join('users as u', function ($join) {
                    $join->on('wa.user_id', '=', 'u.id')
                         ->on('wa.tenant_id', '=', 'u.tenant_id');
                })
                ->where('wa.tenant_id', $tenantId)
                ->where('wa.status', $status)
                ->select(
                    'wa.id', 'wa.user_id', 'wa.risk_level', 'wa.risk_score',
                    'wa.indicators', 'wa.coordinator_notified', 'wa.coordinator_notes',
                    'wa.status', 'wa.created_at', 'wa.updated_at',
                    'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url'
                )
                ->orderByDesc('wa.risk_score')
                ->get();

            return $alerts->map(fn ($row) => [
                'id' => (int) $row->id,
                'user_id' => (int) $row->user_id,
                'user_name' => UserDisplayName::resolve($row),
                'avatar_url' => $row->avatar_url,
                'risk_level' => $row->risk_level,
                'risk_score' => round((float) $row->risk_score, 2),
                'indicators' => json_decode($row->indicators, true) ?? [],
                'coordinator_notified' => (bool) $row->coordinator_notified,
                'coordinator_notes' => $row->coordinator_notes,
                'status' => $row->status,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ])->all();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerWellbeingService::getActiveAlerts error: " . $e->getMessage());
            return [];
        }
    }

    /**
     * Update a wellbeing alert (acknowledge, resolve, dismiss, or add notes).
     *
     * @param int         $alertId
     * @param string      $action   One of: acknowledged, resolved, dismissed
     * @param string|null $notes    Optional coordinator notes
     * @return bool  True on success
     */
    public static function updateAlert(int $alertId, string $action, ?string $notes = null): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $allowedActions = ['acknowledged', 'resolved', 'dismissed'];
        if (!in_array($action, $allowedActions, true)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_wellbeing_invalid_action', ['actions' => implode(', ', $allowedActions)])];
            return false;
        }

        $alert = DB::table('vol_wellbeing_alerts')
            ->where('id', $alertId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$alert) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.alert_not_found')];
            return false;
        }

        try {
            $update = [
                'status' => $action,
                'coordinator_notified' => true,
                'updated_at' => now(),
            ];

            if ($notes !== null) {
                $update['coordinator_notes'] = trim(mb_substr($notes, 0, 2000));
            }

            if ($action === 'resolved') {
                $update['resolved_at'] = now();
            }

            DB::table('vol_wellbeing_alerts')
                ->where('id', $alertId)
                ->where('tenant_id', $tenantId)
                ->update($update);

            return true;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerWellbeingService::updateAlert error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.alert_update_failed')];
            return false;
        }
    }

    /**
     * Upsert a wellbeing alert — creates or updates an active alert for a user.
     */
    private static function upsertAlert(int $tenantId, int $userId, string $riskLevel, int $riskScore, array $indicators): void
    {
        try {
            $existing = DB::table('vol_wellbeing_alerts')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('status', 'active')
                ->first();

            if ($existing) {
                DB::table('vol_wellbeing_alerts')
                    ->where('id', $existing->id)
                    ->update([
                        'risk_level' => $riskLevel,
                        'risk_score' => $riskScore,
                        'indicators' => json_encode($indicators),
                        'updated_at' => now(),
                    ]);
            } else {
                DB::table('vol_wellbeing_alerts')->insert([
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'risk_level' => $riskLevel,
                    'risk_score' => $riskScore,
                    'indicators' => json_encode($indicators),
                    'coordinator_notified' => false,
                    'status' => 'active',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        } catch (\Throwable $e) {
            // Non-critical — log but don't fail the assessment
            \Illuminate\Support\Facades\Log::warning("VolunteerWellbeingService::upsertAlert error: " . $e->getMessage());
        }
    }

    /**
     * Auto-resolve a user's active wellbeing alert once their recomputed risk has
     * dropped below the alert threshold. The daily assessment otherwise only ever
     * writes alerts (score >= 30) and never clears them, so recovered volunteers
     * keep a stale 'active' alert with old score/indicators indefinitely. Only
     * system-raised 'active' alerts are auto-closed; coordinator-managed states
     * (acknowledged/dismissed/resolved) are left untouched.
     */
    private static function resolveRecoveredAlert(int $tenantId, int $userId): void
    {
        try {
            DB::table('vol_wellbeing_alerts')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('status', 'active')
                ->update([
                    'status' => 'resolved',
                    'resolved_at' => now(),
                    'updated_at' => now(),
                ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerWellbeingService::resolveRecoveredAlert error: " . $e->getMessage());
        }
    }
}
