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
 * AdminBadgeCountService — Provides badge counts for admin sidebar navigation.
 *
 * Counts pending approvals, alerts, and other actionable items for the current tenant.
 * Results are cached for the request lifetime.
 */
class AdminBadgeCountService
{
    private ?array $cachedCounts = null;

    /**
     * Get all badge counts for the current tenant.
     * Results are cached for the request lifetime.
     */
    public function getCounts(): array
    {
        if ($this->cachedCounts !== null) {
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
            $counts['unreviewed_messages'] = $this->countUnreviewedMessages($tenantId);
        } catch (\Exception $e) {
            Log::warning('AdminBadgeCountService error: ' . $e->getMessage());
        }

        $this->cachedCounts = $counts;
        return $counts;
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
    }

    /**
     * 🔴 Must match the list the badge sends the admin to, exactly.
     *
     * This counted `status = 'pending'`, but the "Pending approvals" screen it
     * links to (AdminUsersController, filter=pending) selects on
     * `is_approved = 0`. Those two can disagree — the same controller carries a
     * repair for approvals that left `status` stuck at 'pending' — so a badge
     * saying "1" could open a screen showing nothing, which is worse than no
     * badge at all. Keep this predicate identical to that filter; if the filter
     * changes, change this in the same commit.
     */
    private function countPendingUsers(int $tenantId): int
    {
        try {
            return (int) DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('is_approved', 0)
                ->count();
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
        try {
            return (int) DB::table('fraud_alerts')
                ->where('tenant_id', $tenantId)
                ->where('status', 'new')
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

    private function countUnreviewedMessages(int $tenantId): int
    {
        try {
            return (int) DB::table('broker_message_copies')
                ->where('tenant_id', $tenantId)
                ->whereNull('reviewed_at')
                ->count();
        } catch (\Exception $e) {
            Log::warning('[AdminBadgeCount] Failed to count unreviewed messages: ' . $e->getMessage());
            return 0;
        }
    }
}
