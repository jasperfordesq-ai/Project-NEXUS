<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * InactiveMemberService — Detects and flags members who have been inactive
 * across all engagement dimensions: login, transactions, posts, and event attendance.
 *
 * Flag types: inactive, dormant, at_risk. All methods are tenant-scoped.
 */
class InactiveMemberService
{
    /**
     * Detect inactive members and update flags.
     */
    public function detectInactive(int $tenantId, int $thresholdDays = 90): array
    {
        $cutoffInactive = now()->subDays($thresholdDays)->toDateTimeString();
        $cutoffDormant = now()->subDays($thresholdDays * 2)->toDateTimeString();

        $users = DB::table('users as u')
            ->where('u.tenant_id', $tenantId)
            ->where('u.status', 'active')
            ->select(['u.id as user_id', 'u.last_login_at', 'u.created_at as member_since'])
            ->selectRaw(
                "(SELECT MAX(t.created_at) FROM transactions t WHERE (t.sender_id = u.id OR t.receiver_id = u.id) AND t.tenant_id = ? AND t.status = 'completed') as last_transaction_at,
                 (SELECT MAX(fp.created_at) FROM feed_posts fp WHERE fp.user_id = u.id AND fp.tenant_id = ?) as last_post_at,
                 (SELECT MAX(er.created_at) FROM event_rsvps er WHERE er.user_id = u.id AND er.tenant_id = ? AND er.status = 'going') as last_event_at",
                [$tenantId, $tenantId, $tenantId]
            )
            ->get();

        $flagged = 0;
        $dormant = 0;
        $resolved = 0;

        foreach ($users as $user) {
            $userId = (int) $user->user_id;

            $lastActivities = array_filter([
                $user->last_login_at,
                $user->last_transaction_at,
                $user->last_post_at,
                $user->last_event_at,
            ]);

            $lastActivity = !empty($lastActivities) ? max($lastActivities) : $user->member_since;

            if ($lastActivity < $cutoffDormant) {
                $flagType = 'dormant';
                $dormant++;
                $flagged++;
            } elseif ($lastActivity < $cutoffInactive) {
                $flagType = 'inactive';
                $flagged++;
            } else {
                // User is active — resolve any existing flag
                $this->resolveFlag($userId, $tenantId);
                $resolved++;
                continue;
            }

            $this->upsertFlag($userId, $tenantId, [
                'last_activity_at' => $lastActivity,
                'last_login_at' => $user->last_login_at,
                'last_transaction_at' => $user->last_transaction_at,
                'last_post_at' => $user->last_post_at,
                'last_event_at' => $user->last_event_at,
                'flag_type' => $flagType,
            ]);
        }

        return [
            'tenant_id' => $tenantId,
            'threshold_days' => $thresholdDays,
            'flagged_inactive' => $flagged - $dormant,
            'flagged_dormant' => $dormant,
            'total_flagged' => $flagged,
            'resolved' => $resolved,
            'run_at' => now()->toDateTimeString(),
        ];
    }

    /**
     * Get inactive members list with filtering.
     */
    public function getInactiveMembers(int $tenantId, int $days = 90, ?string $flagType = null, int $limit = 50, int $offset = 0): array
    {
        $limit = min(200, max(1, $limit));
        $offset = max(0, $offset);
        $cutoff = now()->subDays($days)->toDateTimeString();

        $query = DB::table('member_activity_flags as f')
            ->where('f.tenant_id', $tenantId)
            ->whereNull('f.resolved_at');

        if ($flagType && in_array($flagType, ['inactive', 'dormant', 'at_risk'], true)) {
            $query->where('f.flag_type', $flagType);
        }

        if ($days > 0) {
            $query->where(function ($q) use ($cutoff) {
                $q->whereNull('f.last_activity_at')
                  ->orWhere('f.last_activity_at', '<', $cutoff);
            });
        }

        $total = (int) (clone $query)->count();

        $rows = (clone $query)
            ->join('users as u', 'f.user_id', '=', 'u.id')
            ->select(
                'f.*',
                'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.email', 'u.avatar_url',
                'u.created_at as member_since'
            )
            ->orderBy('f.last_activity_at')
            ->limit($limit)
            ->offset($offset)
            ->get();

        $members = $rows->map(function ($row) {
            return [
                'id' => (int) $row->user_id,
                'name' => UserDisplayName::resolve($row),
                'email' => $row->email,
                'profile_image_url' => $row->avatar_url,
                'flag_type' => $row->flag_type,
                'last_activity_at' => $row->last_activity_at,
                'last_login_at' => $row->last_login_at,
                'last_transaction_at' => $row->last_transaction_at,
                'last_post_at' => $row->last_post_at,
                'last_event_at' => $row->last_event_at,
                'flagged_at' => $row->flagged_at,
                'notified_at' => $row->notified_at,
                'member_since' => $row->member_since,
                'days_inactive' => $row->last_activity_at
                    ? (int) ((time() - strtotime($row->last_activity_at)) / 86400)
                    : null,
            ];
        })->all();

        return [
            'members' => $members,
            'total' => $total,
            'threshold_days' => $days,
        ];
    }

    /**
     * Get inactivity summary statistics.
     */
    public function getInactivityStats(int $tenantId): array
    {
        $stats = DB::table('member_activity_flags')
            ->where('tenant_id', $tenantId)
            ->whereNull('resolved_at')
            ->select([
                DB::raw('COUNT(*) as total_flagged'),
                DB::raw("SUM(CASE WHEN flag_type = 'inactive' THEN 1 ELSE 0 END) as inactive_count"),
                DB::raw("SUM(CASE WHEN flag_type = 'dormant' THEN 1 ELSE 0 END) as dormant_count"),
                DB::raw("SUM(CASE WHEN flag_type = 'at_risk' THEN 1 ELSE 0 END) as at_risk_count"),
                DB::raw('SUM(CASE WHEN notified_at IS NOT NULL THEN 1 ELSE 0 END) as notified_count'),
            ])
            ->first();

        $totalActive = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->count();

        $totalFlagged = (int) ($stats->total_flagged ?? 0);

        return [
            'total_active_members' => $totalActive,
            'total_flagged' => $totalFlagged,
            'inactive_count' => (int) ($stats->inactive_count ?? 0),
            'dormant_count' => (int) ($stats->dormant_count ?? 0),
            'at_risk_count' => (int) ($stats->at_risk_count ?? 0),
            'notified_count' => (int) ($stats->notified_count ?? 0),
            'inactivity_rate' => $totalActive > 0 ? round($totalFlagged / $totalActive, 3) : 0,
        ];
    }

    /**
     * Mark inactive members as notified and dispatch a re-engagement email to each.
     */
    public function markNotified(int $tenantId, array $userIds): int
    {
        if (empty($userIds)) {
            return 0;
        }

        $notified = 0;

        // Send re-engagement emails
        $previousTenantId = TenantContext::currentId();
        try {
            TenantContext::setById($tenantId);

            $users = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $userIds)
                ->where('status', 'active')
                ->whereNotNull('email')
                ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
                ->get();

            $communityName  = TenantContext::getSetting('site_name', 'Project NEXUS');
            $safeCommunity  = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');
            $feedUrl        = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/feed';
            foreach ($users as $user) {
                try {
                    // Re-engagement emails are cron-dispatched → render in recipient's language.
                    $sent = LocaleContext::withLocale($user, function () use ($user, $tenantId, $safeCommunity, $communityName, $feedUrl) {
                        $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');

                        $html = EmailTemplateBuilder::make()
                            ->title(__('emails_misc.inactive_member.title'))
                            ->previewText(__('emails_misc.inactive_member.preview'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_misc.inactive_member.body', ['community' => $safeCommunity]))
                            ->button(__('emails_misc.inactive_member.cta'), $feedUrl)
                            ->render();

                        $subject = __('emails_misc.inactive_member.subject', ['community' => $communityName]);
                        if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'inactive_member', ['tenant_id' => $tenantId])) {
                            Log::warning('[InactiveMemberService] Re-engagement email failed', ['user_id' => $user->id]);
                            return false;
                        }

                        return true;
                    });
                    if ($sent) {
                        $updated = DB::table('member_activity_flags')
                            ->where('tenant_id', $tenantId)
                            ->where('user_id', $user->id)
                            ->whereNull('resolved_at')
                            ->update(['notified_at' => now()]);
                        $notified += (int) $updated;
                    }
                } catch (\Throwable $e) {
                    Log::warning('[InactiveMemberService] markNotified email error for user ' . $user->id . ': ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[InactiveMemberService] markNotified email batch failed: ' . $e->getMessage());
        } finally {
            if (app()->runningInConsole()) {
                TenantContext::reset();
            } elseif ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return $notified;
    }

    private function upsertFlag(int $userId, int $tenantId, array $data): void
    {
        try {
            DB::statement(
                "INSERT INTO member_activity_flags
                    (user_id, tenant_id, last_activity_at, last_login_at, last_transaction_at, last_post_at, last_event_at, flag_type, flagged_at, resolved_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
                 ON DUPLICATE KEY UPDATE
                    last_activity_at = VALUES(last_activity_at),
                    last_login_at = VALUES(last_login_at),
                    last_transaction_at = VALUES(last_transaction_at),
                    last_post_at = VALUES(last_post_at),
                    last_event_at = VALUES(last_event_at),
                    flag_type = VALUES(flag_type),
                    flagged_at = CASE WHEN resolved_at IS NOT NULL THEN NOW() ELSE flagged_at END,
                    resolved_at = NULL",
                [
                    $userId,
                    $tenantId,
                    $data['last_activity_at'],
                    $data['last_login_at'],
                    $data['last_transaction_at'],
                    $data['last_post_at'],
                    $data['last_event_at'],
                    $data['flag_type'],
                ]
            );
        } catch (\Exception $e) {
            Log::warning("InactiveMemberService::upsertFlag failed for user {$userId}: " . $e->getMessage());
        }
    }

    private function resolveFlag(int $userId, int $tenantId): void
    {
        try {
            DB::table('member_activity_flags')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->whereNull('resolved_at')
                ->update(['resolved_at' => now()]);
        } catch (\Exception $e) {
            // Table may not exist yet
        }
    }
}
