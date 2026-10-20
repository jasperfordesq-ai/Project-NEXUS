<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Services\Volunteering\WellbeingRecipientResolver;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * VolunteerWellbeingService — detects burnout risk and manages wellbeing alerts
 * for volunteers.
 *
 * Backed by `vol_wellbeing_alerts`, `vol_mood_checkins`, `vol_logs` and
 * `vol_applications`. All queries are tenant-scoped via TenantContext.
 * A volunteer's own Low/Struggling check-in counts towards their risk and, when
 * they agree, tells the community's team and their organisations (recordCheckin).
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

        // ── 6. How the volunteer says they feel ──
        // Their own check-ins, the most direct signal there is. Until 7 Oct 2026
        // they were stored and used for nothing. Only the last 14 days count, and
        // the LATEST check-in decides, so a later "Good" clears an earlier
        // "Struggling". A write ($persist) makes a staff-visible alert, so it uses
        // only check-ins the volunteer chose to share; a private check-in still
        // moves the volunteer's own score on their own dashboard.
        $mood = self::moodIndicator($tenantId, $userId, $persist);
        $riskPoints += $mood['risk_points'];
        unset($mood['risk_points']);
        $indicators['mood'] = $mood;

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
        if (self::isLowMood($indicators['mood']['latest_mood'])) {
            $recommendations[] = __('api.vol_wellbeing_recommendation_reach_out');
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
            // A volunteer whose only signal is a shared Low/Struggling check-in
            // (no hours, no shift yet) was never scanned, so their alert was
            // never refreshed and never auto-resolved when they felt better.
            ->merge(
                DB::table('vol_mood_checkins')
                    ->where('tenant_id', $tenantId)
                    ->where('share_with_team', 1)
                    ->where('mood', '<=', self::LOW_MOOD_MAX)
                    ->where('created_at', '>=', now()->subDays(14))
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
                        'name' => UserDisplayName::person($user),
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

            return $alerts->map(function ($row) use ($tenantId) {
                $indicators = json_decode($row->indicators, true) ?? [];
                $latestMood = isset($indicators['mood']['latest_mood']) ? (int) $indicators['mood']['latest_mood'] : null;

                // The volunteer's latest SHARED Low/Struggling check-in, note
                // included: staff are told by email to sign in to read it.
                $checkin = DB::table('vol_mood_checkins')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $row->user_id)
                    ->where('share_with_team', 1)
                    ->orderByDesc('created_at')
                    ->orderByDesc('id')
                    ->first(['mood', 'note', 'created_at']);

                return [
                    'id' => (int) $row->id,
                    'user_id' => (int) $row->user_id,
                    'user_name' => UserDisplayName::person($row),
                    'avatar_url' => $row->avatar_url,
                    'risk_level' => $row->risk_level,
                    'risk_score' => round((float) $row->risk_score, 2),
                    'indicators' => $indicators,
                    'reason' => self::isLowMood($latestMood) ? 'low_mood' : 'activity',
                    'latest_checkin' => $checkin ? [
                        'mood' => (int) $checkin->mood,
                        'note' => $checkin->note,
                        'created_at' => $checkin->created_at,
                    ] : null,
                    'coordinator_notified' => (bool) $row->coordinator_notified,
                    'coordinator_notes' => $row->coordinator_notes,
                    'status' => $row->status,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            })->all();
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

    /** Moods 1 (Struggling) and 2 (Low) are the ones that ask for support. */
    /** Moods 1 (Struggling) and 2 (Low) are the ones that may reach staff. */
    public const LOW_MOOD_MAX = 2;

    public static function isLowMood(?int $mood): bool
    {
        return $mood !== null && $mood >= 1 && $mood <= self::LOW_MOOD_MAX;
    }

    /**
     * The mood part of the burnout assessment.
     *
     * Latest check-in in the last 14 days: Struggling adds 55 risk points (a
     * "high" risk on its own, wellbeing score 45), Low adds 35 ("moderate",
     * score 65). Three or more Low/Struggling check-ins in the window add 10.
     *
     * @param bool $sharedOnly only count check-ins the volunteer chose to share
     * @return array{latest_mood: ?int, latest_at: ?string, low_checkins_14_days: int, risk_points: int}
     */
    private static function moodIndicator(int $tenantId, int $userId, bool $sharedOnly): array
    {
        $empty = ['latest_mood' => null, 'latest_at' => null, 'low_checkins_14_days' => 0, 'risk_points' => 0];

        try {
            $recent = DB::table('vol_mood_checkins')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('created_at', '>=', now()->subDays(14))
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->get(['mood', 'share_with_team', 'created_at']);
        } catch (\Throwable $e) {
            // The score still means something without this indicator, so a
            // failure degrades it rather than breaking the dashboard — but loudly.
            \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService::moodIndicator failed: ' . $e->getMessage());
            return $empty;
        }

        if ($sharedOnly) {
            // A Low/Struggling check-in the volunteer kept private does not
            // exist for staff. Okay/Good/Great are never "shared", but they
            // still count here: a later better check-in clears a shared alert.
            $recent = $recent->reject(fn ($row) => self::isLowMood((int) $row->mood) && !(int) $row->share_with_team)->values();
        }

        if ($recent->isEmpty()) {
            return $empty;
        }

        $latestMood = (int) $recent->first()->mood;
        if ($sharedOnly && !self::isLowMood($latestMood)) {
            // Feeling better: nothing to report, and nothing to disclose.
            return $empty;
        }
        $lowCount = $recent->filter(fn ($row) => self::isLowMood((int) $row->mood))->count();

        $points = match ($latestMood) {
            1 => 55,
            2 => 35,
            default => 0,
        };
        if ($points > 0 && $lowCount >= 3) {
            $points += 10;
        }

        return [
            'latest_mood' => $latestMood,
            'latest_at' => (string) $recent->first()->created_at,
            'low_checkins_14_days' => $lowCount,
            'risk_points' => $points,
        ];
    }

    /**
     * Record a volunteer's wellbeing check-in, and — when they said they are Low
     * or Struggling AND agreed to it — raise a wellbeing alert and tell the people
     * WellbeingRecipientResolver names: the community's wellbeing contacts, its
     * staff (the volunteer included when they are staff), the organisations they
     * volunteer with, the community above, or as a last resort the community's
     * own contact address.
     *
     * Telling people is limited to once per volunteer per 24 hours, keyed on a
     * check-in that actually reached someone: a day on which nobody could be
     * told does not stop the next check-in from trying again. Every shared
     * check-in still counts towards the alert itself.
     *
     * `team_notified` is honest: true only when at least one person or address
     * was reached. Until 20 Oct 2026 the check-in was marked "told" even when
     * the recipient list was empty, and the volunteer read "someone will be in
     * touch" while nobody had been told.
     *
     * @return array{id: int, mood: int, note: ?string, shared: bool, team_notified: bool, told_count: int, told_at: ?string, outcome: string}
     *   outcome: told | already_told_today | nobody_available | private | not_low
     */
    public static function recordCheckin(int $userId, int $mood, ?string $note, bool $shareWithTeam): array
    {
        $tenantId = TenantContext::getId();
        $low = self::isLowMood($mood);
        $shared = $shareWithTeam && $low;

        $id = (int) DB::table('vol_mood_checkins')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'mood' => $mood,
            'note' => $note,
            'share_with_team' => $shared ? 1 : 0,
            'created_at' => now(),
        ]);

        $teamNotified = false;
        $toldCount = 0;
        $toldAt = null;
        $outcome = !$low ? 'not_low' : (!$shared ? 'private' : 'nobody_available');

        if ($shared) {
            // Refresh the staff-visible alert from shared check-ins only.
            self::detectBurnoutRisk($userId, true);
            $alertId = DB::table('vol_wellbeing_alerts')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('status', 'active')
                ->value('id');
            $alertId = $alertId === null ? null : (int) $alertId;

            $toldToday = DB::table('vol_mood_checkins')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->whereNotNull('team_notified_at')
                ->where('team_notified_at', '>=', now()->subDay())
                ->orderByDesc('team_notified_at')
                ->first(['id', 'team_notified_at']);

            if ($toldToday) {
                $outcome = 'already_told_today';
                $toldAt = (string) $toldToday->team_notified_at;
                $toldCount = self::peopleToldFor($tenantId, (int) $toldToday->id);
            } else {
                $result = self::notifyOfLowMood($tenantId, $userId, $mood, $id, $alertId);
                if ($result['told'] > 0) {
                    $teamNotified = true;
                    $toldCount = $result['told'];
                    $toldAt = now()->toDateTimeString();
                    $outcome = 'told';
                    DB::table('vol_mood_checkins')
                        ->where('id', $id)
                        ->where('tenant_id', $tenantId)
                        ->update(['team_notified_at' => now()]);
                    DB::table('vol_wellbeing_alerts')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->where('status', 'active')
                        ->update(['coordinator_notified' => true, 'updated_at' => now()]);
                }
            }
        }

        return [
            'id' => $id,
            'mood' => $mood,
            'note' => $note,
            'shared' => $shared,
            'team_notified' => $teamNotified,
            'told_count' => $toldCount,
            'told_at' => $toldAt,
            'outcome' => $outcome,
        ];
    }

    /** How many distinct people or addresses a check-in reached (anything not failed). */
    public static function peopleToldFor(int $tenantId, int $checkinId): int
    {
        try {
            return (int) DB::table('vol_wellbeing_alert_notifications')
                ->where('tenant_id', $tenantId)
                ->where('checkin_id', $checkinId)
                ->where('status', '!=', 'failed')
                ->selectRaw("COUNT(DISTINCT COALESCE(recipient_user_id, recipient_email)) as c")
                ->value('c');
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService: told count failed', ['checkin_id' => $checkinId, 'error' => $e->getMessage()]);
            return 0;
        }
    }

    /**
     * Tell everyone WellbeingRecipientResolver names: a bell now (and a device
     * push for curated types), an email on the queue. Every attempt is recorded
     * in vol_wellbeing_alert_notifications, per person and channel, with its
     * outcome — never the note, never the mood. Each recipient renders in their
     * own language.
     *
     * @return array{told: int, bells: int, emails_queued: int} told = distinct people or addresses reached
     */
    private static function notifyOfLowMood(int $tenantId, int $volunteerId, int $mood, int $checkinId, ?int $alertId): array
    {
        $none = ['told' => 0, 'bells' => 0, 'emails_queued' => 0];

        $volunteer = \App\Models\User::where('tenant_id', $tenantId)
            ->where('id', $volunteerId)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'name']);
        if (!$volunteer) {
            return $none;
        }
        // A wellbeing message is about a person, never about the organisation
        // their account represents (production, 20 Oct 2026: "Timebank Ireland
        // said they are feeling low").
        $volunteerName = UserDisplayName::person($volunteer);
        $communityName = (string) (TenantContext::get()['name'] ?? '');

        $resolved = WellbeingRecipientResolver::resolve($tenantId, $volunteerId, self::recentOrganisations($tenantId, $volunteerId));
        $meta = $resolved['users'];
        if ($meta === [] && $resolved['emails'] === []) {
            return $none;
        }

        // The resolver scoped every id to its community (this one or the parent),
        // so the tenant scope is bypassed here on purpose and re-checked below.
        $recipients = $meta === [] ? collect() : \App\Models\User::withoutGlobalScopes()->whereIn('id', array_keys($meta))
            ->where('status', 'active')
            ->get(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name',
                'preferred_language', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'])
            ->filter(fn ($u) => (int) $u->tenant_id === $meta[(int) $u->id]['tenant_id'])
            ->values();

        $othersCount = count($recipients) + count($resolved['emails']);
        $now = now();
        $base = [
            'tenant_id' => $tenantId,
            'alert_id' => $alertId,
            'checkin_id' => $checkinId,
            'volunteer_user_id' => $volunteerId,
            'created_at' => $now,
            'updated_at' => $now,
        ];

        $told = 0;
        $bells = 0;
        $emailRowIds = [];

        foreach ($recipients as $recipient) {
            $m = $meta[(int) $recipient->id];
            $tier = $m['tier'];
            $context = self::lowMoodContext($volunteerId, $volunteerName, $mood, $tier, $m['organization_name'], $recipient, $alertId, $tier === 'self' ? $othersCount - 1 : $othersCount, $communityName);
            $row = $base + [
                'recipient_user_id' => (int) $recipient->id,
                'recipient_tenant_id' => (int) $recipient->tenant_id === $tenantId ? null : (int) $recipient->tenant_id,
                'recipient_email' => null,
                'organization_id' => $m['organization_id'],
                'organization_name' => $m['organization_name'],
                'tier' => $tier,
            ];

            $bellOk = (bool) \App\I18n\LocaleContext::withLocale($recipient, function () use ($recipient, $context, $checkinId) {
                return self::sendLowMoodBell($recipient, $context, $checkinId);
            });
            self::recordNotification($row + ['channel' => 'bell', 'status' => $bellOk ? 'sent' : 'failed', 'error_code' => $bellOk ? null : 'bell_failed']);
            if ($bellOk) {
                $bells++;
            }
            $emailRowId = self::recordNotification($row + ['channel' => 'email', 'status' => 'queued', 'error_code' => null]);
            if ($emailRowId !== null) {
                $emailRowIds[] = $emailRowId;
            }
            $told++;
        }

        foreach ($resolved['emails'] as $address) {
            $emailRowId = self::recordNotification($base + [
                'recipient_user_id' => null,
                'recipient_tenant_id' => null,
                'recipient_email' => $address['email'],
                'organization_id' => null,
                'organization_name' => null,
                'tier' => $address['tier'],
                'channel' => 'email',
                'status' => 'queued',
                'error_code' => null,
            ]);
            if ($emailRowId !== null) {
                $emailRowIds[] = $emailRowId;
                $told++;
            }
        }

        if ($emailRowIds !== []) {
            // Emails on the queue: sent one by one in the request they took seconds,
            // and the volunteer who has just said they are struggling should not be
            // kept waiting (mod_php cannot answer before deferred work finishes).
            $job = new \App\Jobs\SendVolunteerLowMoodEmails($tenantId, $volunteerId, $volunteerName, $mood, $emailRowIds);
            try {
                dispatch($job);
            } catch (\Throwable $e) {
                // The queue is unreachable: a slow request beats an email never sent.
                \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService: low-mood email job could not be queued; sending inline', [
                    'volunteer_id' => $volunteerId,
                    'error' => $e->getMessage(),
                ]);
                $job->handle();
            }
        }

        return ['told' => $told, 'bells' => $bells, 'emails_queued' => count($emailRowIds)];
    }

    /**
     * One row of the notification record. A failure here is logged at error and
     * returns null; it is never turned into "nobody was told".
     *
     * @param array<string, mixed> $row
     */
    private static function recordNotification(array $row): ?int
    {
        try {
            return (int) DB::table('vol_wellbeing_alert_notifications')->insertGetId($row);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService: notification record failed', [
                'tier' => $row['tier'] ?? null,
                'channel' => $row['channel'] ?? null,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /** Staff who open the alert in the admin panel rather than the broker panel. */
    private static function isAdminTier(object $recipient): bool
    {
        return \App\Support\Authorization\AdminTier::allows($recipient);
    }

    /** Anyone who can open the broker or admin panel to read the alert. */
    private static function canOpenAlerts(object $recipient): bool
    {
        return self::isAdminTier($recipient)
            || in_array((string) ($recipient->role ?? ''), \App\Support\Authorization\AdminTier::OPERATIONAL_ROLES, true);
    }

    /**
     * What to say to one recipient, and where to send them.
     *
     * @return array{variant: string, params: array<string, string>, link: ?string, absolute_link: string, can_open: bool}
     *   variant: team | self | contact | org | parent | address
     */
    private static function lowMoodContext(int $volunteerId, string $volunteerName, int $mood, string $tier, ?string $orgName, ?object $recipient, ?int $alertId, int $othersCount, string $communityName): array
    {
        $params = [
            'name' => $volunteerName,
            'mood' => __('emails_misc.volunteer_wellbeing.mood_' . $mood),
            'organisation' => (string) $orgName,
            'community' => $communityName,
            'count' => (string) max(0, $othersCount),
        ];

        $canOpen = $recipient !== null && self::canOpenAlerts($recipient);
        $alertQuery = $alertId !== null ? '?alert=' . $alertId : '';
        $alertsPath = ($recipient !== null && self::isAdminTier($recipient) ? '/admin/volunteering/wellbeing' : '/broker/safeguarding/volunteering') . $alertQuery;
        $profilePath = '/profile/' . $volunteerId;

        $variant = match ($tier) {
            'self' => 'self',
            'organisation' => 'org',
            'parent_staff' => 'parent',
            'contact' => $canOpen ? 'team' : 'contact',
            'contact_email', 'community_contact_email' => 'address',
            default => 'team',
        };

        $path = match ($variant) {
            'org', 'contact' => $profilePath,
            default => $alertsPath,
        };

        // A bell is opened inside the recipient's own app, so a recipient in the
        // community ABOVE gets no bell link (their app would resolve the path
        // against their own community); the email carries the absolute address.
        $link = $variant === 'parent' ? null : $path;

        return [
            'variant' => $variant,
            'params' => $params,
            'link' => $link,
            'absolute_link' => \App\Core\EmailTemplateBuilder::tenantUrl($path),
            'can_open' => $canOpen,
        ];
    }

    /**
     * Bell for one recipient, in their language, plus a device push for the
     * curated `volunteer_wellbeing` type. Idempotent per check-in and recipient.
     *
     * @param array{variant: string, params: array<string, string>, link: ?string} $context
     */
    private static function sendLowMoodBell(object $recipient, array $context, int $checkinId): bool
    {
        $variant = $context['variant'];
        $params = $context['params'];
        $key = match ($variant) {
            'self' => (int) $params['count'] > 0 ? 'bell_self_told' : 'bell_self',
            'org' => 'bell_org',
            'contact' => 'bell_contact',
            'parent' => 'bell_parent',
            default => 'bell_team',
        };
        $message = (string) __('emails_misc.volunteer_wellbeing.' . $key, $params);

        try {
            \App\Models\Notification::createNotificationOnce(
                (int) $recipient->id,
                $message,
                $context['link'],
                'volunteer_wellbeing',
                (int) $recipient->tenant_id,
                'wellbeing:' . $checkinId . ':' . (int) $recipient->id
            );
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService: low-mood bell failed', [
                'user_id' => $recipient->id,
                'error' => $e->getMessage(),
            ]);
            return false;
        }

        try {
            \App\Services\NotificationDispatcher::fanOutPush(
                (int) $recipient->id,
                'volunteer_wellbeing',
                $message,
                $context['link'],
                true,
                [
                    'actor' => $params['name'],
                    'subject' => $params['mood'],
                    'thread_id' => 'wellbeing:' . $checkinId,
                ]
            );
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('VolunteerWellbeingService: low-mood push failed', [
                'user_id' => $recipient->id,
                'error' => $e->getMessage(),
            ]);
        }

        return true;
    }

    /**
     * Email for one recipient, in their language (the caller sets the locale).
     * Never carries the note. Called by the SendVolunteerLowMoodEmails job.
     *
     * @param object $recipient a User, or for an address-only recipient an object with `email`
     * @param int $othersCount how many other people were told (for the volunteer's own copy)
     * @return bool true when the dispatcher accepted the message
     */
    public static function sendLowMoodEmail(object $recipient, int $tenantId, int $volunteerId, string $volunteerName, int $mood, string $tier = 'staff', ?string $orgName = null, ?int $alertId = null, int $othersCount = 0): bool
    {
        if (empty($recipient->email)) {
            return false;
        }
        $communityName = (string) (TenantContext::get()['name'] ?? '');
        $context = self::lowMoodContext($volunteerId, $volunteerName, $mood, $tier, $orgName, isset($recipient->id) ? $recipient : null, $alertId, $othersCount, $communityName);
        $variant = $context['variant'];
        $params = $context['params'];

        try {
            $safe = array_map(fn (string $v) => htmlspecialchars($v, ENT_QUOTES, 'UTF-8'), $params);
            $t = fn (string $key) => __('emails_misc.volunteer_wellbeing.' . $key, $safe);

            $details = [
                __('emails_misc.volunteer_wellbeing.info_card_volunteer') => $safe['name'],
                __('emails_misc.volunteer_wellbeing.info_card_feeling') => htmlspecialchars(__('emails_misc.volunteer_wellbeing.mood_label_' . $mood), ENT_QUOTES, 'UTF-8'),
            ];
            if ($variant === 'org') {
                $details[__('emails_misc.volunteer_wellbeing.info_card_organisation')] = $safe['organisation'];
            }
            if ($variant === 'parent' || $variant === 'address') {
                $details[__('emails_misc.volunteer_wellbeing.info_card_community')] = $safe['community'];
            }

            [$title, $body, $hint, $cta] = match ($variant) {
                'self' => ['self_title', (int) $params['count'] > 0 ? 'self_body_told' : 'self_body_alone', 'team_note_hint', 'team_cta'],
                'org' => ['org_title', 'org_body', 'org_team_told', 'org_cta'],
                'contact' => ['team_title', 'contact_body', 'org_team_told', 'org_cta'],
                'parent' => ['team_title', 'parent_body', 'team_note_hint', 'team_cta'],
                'address' => ['team_title', 'team_body', 'community_contact_intro', 'team_cta'],
                default => ['team_title', 'team_body', 'team_note_hint', 'team_cta'],
            };

            $greeting = isset($recipient->id)
                ? htmlspecialchars(UserDisplayName::resolve($recipient), ENT_QUOTES, 'UTF-8')
                : $safe['community'];

            $builder = \App\Core\EmailTemplateBuilder::make()
                ->theme('warning')
                ->title($t($title))
                ->previewText($t('preview'))
                ->greeting($greeting)
                ->paragraph($t($body))
                ->infoCard($details, __('emails_misc.volunteer_wellbeing.info_card_heading'))
                ->paragraph($t($hint))
                ->button($t($cta), $context['absolute_link']);

            $sent = EmailDispatchService::sendRaw(
                (string) $recipient->email,
                (string) __('emails_misc.volunteer_wellbeing.' . ($variant === 'self' ? 'self_subject' : 'subject'), $params),
                $builder->render(),
                null,
                null,
                null,
                'safeguarding',
                ['tenant_id' => $tenantId]
            );
            if (!$sent) {
                \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService: low-mood email failed to send', [
                    'user_id' => $recipient->id ?? null,
                    'volunteer_id' => $volunteerId,
                ]);
            }

            return (bool) $sent;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('VolunteerWellbeingService: low-mood email exception', [
                'user_id' => $recipient->id ?? null,
                'volunteer_id' => $volunteerId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * Organisations the volunteer has worked with in the last 180 days: an
     * approved application to one of its opportunities, or approved hours
     * logged against it.
     *
     * @return array<int, string> organisation id => name
     */
    private static function recentOrganisations(int $tenantId, int $volunteerId): array
    {
        $since = now()->subDays(180);

        $fromApplications = DB::table('vol_applications as a')
            ->join('vol_opportunities as o', function ($join) {
                $join->on('o.id', '=', 'a.opportunity_id')->on('o.tenant_id', '=', 'a.tenant_id');
            })
            ->where('a.tenant_id', $tenantId)
            ->where('a.user_id', $volunteerId)
            ->where('a.status', 'approved')
            ->where('a.updated_at', '>=', $since)
            ->whereNotNull('o.organization_id')
            ->pluck('o.organization_id');

        $fromHours = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $volunteerId)
            ->where('status', 'approved')
            ->where('date_logged', '>=', $since->toDateString())
            ->whereNotNull('organization_id')
            ->pluck('organization_id');

        $ids = $fromApplications->merge($fromHours)->map(fn ($id) => (int) $id)->unique()->values()->all();
        if ($ids === []) {
            return [];
        }

        return DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ids)
            ->pluck('name', 'id')
            ->mapWithKeys(fn ($name, $id) => [(int) $id => (string) $name])
            ->all();
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
