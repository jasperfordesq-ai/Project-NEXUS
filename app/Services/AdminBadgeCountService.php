<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\Members\PendingApproval;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AdminBadgeCountService — Provides badge counts for admin sidebar navigation.
 *
 * Counts pending approvals, alerts, and other actionable items for the current tenant.
 * Results are cached for the request lifetime.
 */
class AdminBadgeCountService
{
    private ?array $cachedCounts = null;

    /** Whose counts $cachedCounts holds — some counts depend on the viewer. */
    private ?int $cachedViewerId = null;

    /**
     * Get all badge counts for the current tenant.
     * Results are cached for the request lifetime.
     *
     * @param int|null $viewerId The admin looking at the badges. Queues that
     *                           hide the viewer's own rows (unreviewed_messages)
     *                           must hide them from the count too.
     */
    public function getCounts(?int $viewerId = null): array
    {
        if ($this->cachedCounts !== null && $this->cachedViewerId === $viewerId) {
            return $this->cachedCounts;
        }

        $tenantId = TenantContext::getId();
        $counts = [];

        try {
            $counts['pending_users'] = $this->countPendingUsers($tenantId);
            $counts['pending_listings'] = $this->countPendingListings($tenantId);
            $counts['pending_orgs'] = $this->countPendingOrganizations($tenantId);
            $counts['fraud_alerts'] = $this->countFraudAlerts($tenantId);
            $counts['gdpr_requests'] = $this->countGdprRequests($tenantId);
            $counts['404_errors'] = $this->count404Errors();
            $counts['pending_exchanges'] = $this->countPendingExchanges($tenantId);
            $counts['unreviewed_messages'] = $this->countUnreviewedMessages($tenantId, $viewerId);
            $counts = array_merge($counts, $this->getVolunteeringAttention($tenantId));
        } catch (\Exception $e) {
            Log::warning('AdminBadgeCountService error: ' . $e->getMessage());
        }

        $this->cachedCounts = $counts;
        $this->cachedViewerId = $viewerId;
        return $counts;
    }

    /**
     * The volunteering queues an admin has to work through, for the sidebar
     * badges and the Overview's "Needs your attention" row (2026-10-18). One
     * place, so the two never disagree.
     *
     * 🔴 Each count must match the list its badge opens: Applications =
     * `vol_applications.status = 'pending'` (VolunteerApprovals, pending
     * tab); Hours = `vol_logs.status = 'pending'` (VolunteerHoursAudit);
     * Expenses = `vol_expenses.status = 'pending'`; Community projects =
     * proposals not yet decided (`proposed` or `under_review`); Swap
     * requests = `vol_shift_swap_requests.status = 'admin_pending'`, which
     * only exist when the community has switched on "swaps need admin
     * approval" — with it off the count is always 0 and the sidebar shows
     * no badge, matching the empty page.
     *
     * @return array{pending_vol_applications: int, pending_vol_hours: int, pending_vol_expenses: int, pending_vol_projects: int, pending_vol_swaps: int}
     */
    public function getVolunteeringAttention(?int $tenantId = null): array
    {
        $tenantId ??= TenantContext::getId();

        $swapsNeedAdmin = (bool) VolunteeringConfigurationService::getForTenant(
            $tenantId,
            VolunteeringConfigurationService::CONFIG_SWAP_REQUIRES_ADMIN
        );

        return [
            'pending_vol_applications' => $this->countRows('vol_applications', $tenantId, ['pending']),
            'pending_vol_hours' => $this->countRows('vol_logs', $tenantId, ['pending']),
            'pending_vol_expenses' => $this->countRows('vol_expenses', $tenantId, ['pending']),
            'pending_vol_projects' => $this->countRows('vol_community_projects', $tenantId, ['proposed', 'under_review']),
            'pending_vol_swaps' => $swapsNeedAdmin
                ? $this->countRows('vol_shift_swap_requests', $tenantId, ['admin_pending'])
                : 0,
        ];
    }

    /** @param list<string> $statuses */
    private function countRows(string $table, int $tenantId, array $statuses): int
    {
        try {
            return (int) DB::table($table)
                ->where('tenant_id', $tenantId)
                ->whereIn('status', $statuses)
                ->count();
        } catch (\Exception $e) {
            Log::warning("[AdminBadgeCount] Failed to count {$table}: " . $e->getMessage());
            return 0;
        }
    }

    /**
     * Get a specific badge count.
     */
    public function getCount(string $key): int
    {
        $counts = $this->getCounts();
        return $counts[$key] ?? 0;
    }

    /**
     * Clear cached counts (useful after an action that changes counts).
     */
    public function clearCache(): void
    {
        $this->cachedCounts = null;
        $this->cachedViewerId = null;
    }

    /**
     * 🔴 Must match the list the badge sends the admin to, exactly.
     *
     * This counted `status = 'pending'`, but the "Pending approvals" screen it
     * links to (AdminUsersController, filter=pending) selects on
     * `is_approved = 0`. Those two can disagree — the same controller carries a
     * repair for approvals that left `status` stuck at 'pending' — so a badge
     * saying "1" could open a screen showing nothing, which is worse than no
     * badge at all. Both now read App\Support\Members\PendingApproval.
     */
    private function countPendingUsers(int $tenantId): int
    {
        try {
            return (int) PendingApproval::apply(
                DB::table('users')->where('tenant_id', $tenantId)
            )->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count pending users: ' . $e->getMessage());
            return 0;
        }
    }

    private function countPendingListings(int $tenantId): int
    {
        try {
            return (int) DB::table('listings')
                ->where('tenant_id', $tenantId)
                ->where(function ($query) {
                    $query->where('status', 'pending')
                          ->orWhereNull('status')
                          ->orWhere('status', '');
                })
                ->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count pending listings: ' . $e->getMessage());
            return 0;
        }
    }

    private function countPendingOrganizations(int $tenantId): int
    {
        try {
            return (int) DB::table('vol_organizations')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count pending organizations: ' . $e->getMessage());
            return 0;
        }
    }

    private function countFraudAlerts(int $tenantId): int
    {
        // F-318: count the queue the Fraud Alerts screen (/admin/timebanking/alerts,
        // AdminTimebankingController::alerts) actually shows — `abuse_alerts`,
        // written by AbuseDetectionService — using the same "open" predicate as
        // AdminTimebankingController's active_alerts stat. This used to count
        // `fraud_alerts` with status 'new', a value outside that table's
        // enum('open','investigating','resolved','dismissed'); nothing in app/
        // writes `fraud_alerts`, so the badge could never be anything but 0.
        try {
            return (int) DB::table('abuse_alerts')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['new', 'reviewing'])
                ->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count fraud alerts: ' . $e->getMessage());
            return 0;
        }
    }

    private function countGdprRequests(int $tenantId): int
    {
        try {
            return (int) DB::table('gdpr_requests')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count GDPR requests: ' . $e->getMessage());
            return 0;
        }
    }

    private function count404Errors(): int
    {
        try {
            $query = DB::table('error_404_log')
                ->where('resolved', 0)
                ->where('last_seen_at', '>', DB::raw('DATE_SUB(NOW(), INTERVAL 7 DAY)'));

            // Scope by tenant_id if the column exists (cross-tenant data leak fix)
            if (\Illuminate\Support\Facades\Schema::hasColumn('error_404_log', 'tenant_id')) {
                $query->where('tenant_id', TenantContext::getId());
            }

            return (int) $query->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count 404 errors: ' . $e->getMessage());
            return 0;
        }
    }

    private function countPendingExchanges(int $tenantId): int
    {
        try {
            return (int) DB::table('exchange_requests')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending_broker')
                ->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count pending exchanges: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * 🔴 Must match the queue the badge opens (/broker/messages?status=unreviewed,
     * AdminBrokerController::messages with filter=unreviewed), which applies
     * F-436: a viewer's own conversations are not in their queue, because
     * nobody reviews their own messages. This counted every unreviewed copy,
     * so an admin who was a party to copied messages saw a number the queue
     * could never reach — reported from Timebank Ireland on 2026-10-17 as "7"
     * over an empty list, all seven being the admin's own conversations.
     */
    private function countUnreviewedMessages(int $tenantId, ?int $viewerId): int
    {
        try {
            $query = DB::table('broker_message_copies')
                ->where('tenant_id', $tenantId)
                ->whereNull('reviewed_at');

            if ($viewerId !== null) {
                $query->where('sender_id', '<>', $viewerId)
                    ->where('receiver_id', '<>', $viewerId);
            }

            return (int) $query->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count unreviewed messages: ' . $e->getMessage());
            return 0;
        }
    }
}
