<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Services\SocialValueService;
use App\Services\UserInsightsService;
use App\Support\UserDisplayName;

/**
 * AdminDashboardController -- Admin analytics dashboard endpoints.
 *
 * Provides aggregated stats, trends, activity log, and user insights.
 * All endpoints require admin authentication.
 */
class AdminDashboardController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly UserInsightsService $userInsightsService,
    ) {}

    /**
     * Transaction types that are not a member giving another member their time.
     * Opening balances, admin grants and the community fund are credits the
     * system issued; donations are gifts of credit, not hours worked; reversals
     * and refunds undo an earlier row. SocialValueService owns the first list so
     * the dashboard and the social-value report can never disagree about what
     * counts as an exchange.
     */
    private const NON_EXCHANGE_TYPES = [
        ...SocialValueService::EXCLUDED_TRANSACTION_TYPES,
        'exchange_reversal',
        'marketplace_refund',
    ];

    /** Days of inactivity after which a member stops counting as "active". */
    private const ACTIVE_WINDOW_DAYS = 30;

    /**
     * GET /api/v2/admin/dashboard/stats
     *
     * Returns aggregate counts for the admin dashboard stat cards.
     *
     * Every figure runs in its own guard. A figure that cannot be computed is
     * returned as null and named in `_failed_metrics`, so the dashboard can mark
     * that tile rather than show a confident zero. (The previous version
     * coerced a failed transactions query to 0, which read as "no exchanges".)
     */
    public function stats(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $failed = [];
        $metric = function (string $name, callable $fn) use (&$failed) {
            try {
                return $fn();
            } catch (\Throwable $e) {
                $failed[] = $name;
                Log::warning("[AdminDashboard] stats metric {$name} failed: " . $e->getMessage());
                return null;
            }
        };

        $monthStart = now()->startOfMonth();
        $lastMonthStart = $monthStart->copy()->subMonth();
        $activeSince = now()->subDays(self::ACTIVE_WINDOW_DAYS);

        // Members who have not been deleted or anonymised. A removed account is
        // not a member, and a dashboard that counted them would disagree with
        // the Users page it links to.
        $memberWhere = 'tenant_id = ? AND deleted_at IS NULL AND anonymized_at IS NULL';

        $totalUsers = $metric('total_users', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE {$memberWhere}",
            [$tenantId]
        )->cnt);

        $totalUsersStartOfMonth = $metric('total_users_start_of_month', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE {$memberWhere} AND created_at < ?",
            [$tenantId, $monthStart]
        )->cnt);

        // "Active" = signed in or seen by the presence heartbeat in the last 30
        // days. This used to be `is_approved = 1`, which is nearly every member
        // and told a coordinator nothing. Suspended, banned and rejected accounts
        // are excluded even if they were recently seen.
        $activeUsers = $metric('active_users', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users
             WHERE {$memberWhere}
               AND (status IS NULL OR status NOT IN ('suspended', 'banned', 'rejected'))
               AND (last_active_at >= ? OR last_login_at >= ?)",
            [$tenantId, $activeSince, $activeSince]
        )->cnt);

        $approvedUsers = $metric('approved_users', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE {$memberWhere} AND is_approved = 1",
            [$tenantId]
        )->cnt);

        // Same predicate as AdminBadgeCountService::countPendingUsers and the
        // Users page's `filter=pending`, so the number and the list agree.
        $pendingUsers = $metric('pending_users', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND is_approved = 0",
            [$tenantId]
        )->cnt);

        $totalListings = $metric('total_listings', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ?",
            [$tenantId]
        )->cnt);

        $activeListings = $metric('active_listings', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND status = 'active'",
            [$tenantId]
        )->cnt);

        $pendingListings = $metric('pending_listings', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND status = 'pending'",
            [$tenantId]
        )->cnt);

        // Volunteering organisations awaiting a decision. Registration used to
        // notify nobody, so this queue could build up entirely unseen -- two of
        // them sat pending for seven weeks and one day before anyone noticed.
        // The volunteering module is optional per tenant and the table is absent
        // in some environments, so a missing table is a real zero, not a failure.
        $pendingOrganisations = $metric('pending_organisations', function () use ($tenantId) {
            if (!Schema::hasTable('vol_organizations')) {
                return 0;
            }
            return (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM vol_organizations WHERE tenant_id = ? AND status = 'pending'",
                [$tenantId]
            )->cnt;
        });

        [$exchangeWhere, $exchangeParams] = $this->exchangeWhere($tenantId);

        $allTime = $metric('exchanges_all_time', fn () => DB::selectOne(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as hours FROM transactions WHERE {$exchangeWhere}",
            $exchangeParams
        ));
        $thisMonth = $metric('exchanges_this_month', fn () => DB::selectOne(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as hours FROM transactions
             WHERE {$exchangeWhere} AND created_at >= ?",
            [...$exchangeParams, $monthStart]
        ));
        $lastMonth = $metric('exchanges_last_month', fn () => DB::selectOne(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as hours FROM transactions
             WHERE {$exchangeWhere} AND created_at >= ? AND created_at < ?",
            [...$exchangeParams, $lastMonthStart, $monthStart]
        ));

        $newUsersThisMonth = $metric('new_users_this_month', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE {$memberWhere} AND created_at >= ?",
            [$tenantId, $monthStart]
        )->cnt);
        $newUsersLastMonth = $metric('new_users_last_month', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE {$memberWhere} AND created_at >= ? AND created_at < ?",
            [$tenantId, $lastMonthStart, $monthStart]
        )->cnt);

        $newListingsThisMonth = $metric('new_listings_this_month', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND created_at >= ?",
            [$tenantId, $monthStart]
        )->cnt);
        $newListingsLastMonth = $metric('new_listings_last_month', fn () => (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND created_at >= ? AND created_at < ?",
            [$tenantId, $lastMonthStart, $monthStart]
        )->cnt);

        $count = fn (?object $row): ?int => $row === null ? null : (int) ($row->cnt ?? 0);
        $hours = fn (?object $row): ?float => $row === null ? null : round((float) ($row->hours ?? 0), 1);

        return $this->respondWithData([
            'total_users' => $totalUsers,
            'total_users_start_of_month' => $totalUsersStartOfMonth,
            'members_delta_pct' => $this->deltaPct($totalUsers, $totalUsersStartOfMonth),
            'active_users' => $activeUsers,
            'active_users_window_days' => self::ACTIVE_WINDOW_DAYS,
            'approved_users' => $approvedUsers,
            'pending_users' => $pendingUsers,
            'total_listings' => $totalListings,
            'active_listings' => $activeListings,
            // Listings keep no status history, so "active a month ago" cannot be
            // known. Always null; the card shows no arrow rather than a guess.
            'active_listings_delta_pct' => null,
            'pending_listings' => $pendingListings,
            'pending_organisations' => $pendingOrganisations,
            'total_transactions' => $count($allTime),
            'total_hours_exchanged' => $hours($allTime),
            'exchanges_this_month' => $count($thisMonth),
            'exchanges_last_month' => $count($lastMonth),
            'exchanges_delta_pct' => $this->deltaPct($count($thisMonth), $count($lastMonth)),
            'exchange_hours_this_month' => $hours($thisMonth),
            'exchange_hours_last_month' => $hours($lastMonth),
            'exchange_hours_delta_pct' => $this->deltaPct($hours($thisMonth), $hours($lastMonth)),
            'new_users_this_month' => $newUsersThisMonth,
            'new_users_last_month' => $newUsersLastMonth,
            'new_users_delta_pct' => $this->deltaPct($newUsersThisMonth, $newUsersLastMonth),
            'new_listings_this_month' => $newListingsThisMonth,
            'new_listings_last_month' => $newListingsLastMonth,
            '_partial' => $failed !== [],
            '_failed_metrics' => $failed,
        ]);
    }

    /**
     * The one definition of "an exchange" for every figure on this dashboard:
     * a completed transaction of an exchange type between two different real
     * members. System-issued credit has no real sender -- StartingBalanceService
     * writes sender_id = 0, WalletService::mintToMember and admin adjustments
     * write NULL, and the legacy welcome bonus was a self-transfer -- so the
     * structural checks catch an import even when its type was left at the
     * column default of 'transfer'.
     *
     * @return array{0: string, 1: array<int, mixed>}
     */
    private function exchangeWhere(int $tenantId): array
    {
        $placeholders = implode(',', array_fill(0, count(self::NON_EXCHANGE_TYPES), '?'));

        return [
            "tenant_id = ? AND status = 'completed'
             AND transaction_type NOT IN ({$placeholders})
             AND sender_id IS NOT NULL AND sender_id <> 0
             AND receiver_id IS NOT NULL AND receiver_id <> 0
             AND sender_id <> receiver_id",
            [$tenantId, ...self::NON_EXCHANGE_TYPES],
        ];
    }

    /**
     * Percentage change from $previous to $current, one decimal. Null when
     * either side is unknown or there is no baseline to compare against: a
     * change "from 0" has no honest percentage.
     */
    private function deltaPct(int|float|null $current, int|float|null $previous): ?float
    {
        if ($current === null || $previous === null || $previous <= 0) {
            return null;
        }

        return round((($current - $previous) / $previous) * 100, 1);
    }

    /**
     * GET /api/v2/admin/badge-counts
     *
     * Actionable counts for the admin sidebar badges.
     *
     * 🔴 AdminBadgeCountService has existed, been unit-tested and been
     * registered as a container singleton this whole time, with NOTHING calling
     * it — no route, no controller, no consumer. The sidebar's NavItem type has
     * a `badge` field and a renderer for it, and no code ever set one. So the
     * admin panel showed a "Pending approvals" link with no number on it, and a
     * coordinator had no way to see that somebody was waiting without opening
     * the screen and looking. That was reported from a live community
     * (Minehead & Coast, 2026-08-13) as "no badge alert". This endpoint is the
     * missing wire between the service and the sidebar.
     */
    public function badgeCounts(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData(
            app(\App\Services\AdminBadgeCountService::class)->getCounts()
        );
    }

    /**
     * GET /api/v2/admin/dashboard/trends?months=12
     *
     * One row per calendar month, oldest first: new members, new listings, and
     * exchanges (count and hours, using the same definition as stats()). The
     * window is bound as a first-of-month date so the oldest bucket is a whole
     * month; the old `DATE_SUB(NOW(), INTERVAL n MONTH)` window started mid-month
     * and under-counted it. A series that fails is returned as nulls and named in
     * `meta._failed_metrics`; `data` stays a bare array for the chart.
     */
    public function trends(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $months = $this->queryInt('months', 12, 1, 24);
        $windowStart = now()->startOfMonth()->subMonths($months - 1);

        $failed = [];
        $series = function (string $name, string $sql, array $params) use (&$failed): ?array {
            try {
                $map = [];
                foreach (DB::select($sql, $params) as $row) {
                    $map[$row->month] = $row;
                }
                return $map;
            } catch (\Throwable $e) {
                $failed[] = $name;
                Log::warning("[AdminDashboard] trends series {$name} failed: " . $e->getMessage());
                return null;
            }
        };

        $userMap = $series(
            'users',
            "SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
             FROM users
             WHERE tenant_id = ? AND deleted_at IS NULL AND anonymized_at IS NULL AND created_at >= ?
             GROUP BY month",
            [$tenantId, $windowStart]
        );

        $listingMap = $series(
            'listings',
            "SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
             FROM listings
             WHERE tenant_id = ? AND created_at >= ?
             GROUP BY month",
            [$tenantId, $windowStart]
        );

        [$exchangeWhere, $exchangeParams] = $this->exchangeWhere($tenantId);
        $txMap = $series(
            'transactions',
            "SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count, COALESCE(SUM(amount), 0) as hours
             FROM transactions
             WHERE {$exchangeWhere} AND created_at >= ?
             GROUP BY month",
            [...$exchangeParams, $windowStart]
        );

        $trends = [];
        $cursor = $windowStart->copy();
        for ($i = 0; $i < $months; $i++) {
            $month = $cursor->format('Y-m');
            $trends[] = [
                'month' => $month,
                'users' => $userMap === null ? null : (int) ($userMap[$month]->count ?? 0),
                'listings' => $listingMap === null ? null : (int) ($listingMap[$month]->count ?? 0),
                'transactions' => $txMap === null ? null : (int) ($txMap[$month]->count ?? 0),
                'hours' => $txMap === null ? null : round((float) ($txMap[$month]->hours ?? 0), 1),
            ];
            $cursor->addMonth();
        }

        return $this->respondWithData($trends, [
            'months' => $months,
            '_partial' => $failed !== [],
            '_failed_metrics' => $failed,
        ]);
    }

    /**
     * GET /api/v2/admin/dashboard/activity?page=1&limit=20
     *
     * Returns paginated activity log entries.
     */
    public function activity(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;

        $total = 0;
        $items = [];

        try {
            $total = (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM activity_log al JOIN users u ON al.user_id = u.id WHERE u.tenant_id = ?",
                [$tenantId]
            )->cnt;

            $items = DB::select(
                "SELECT al.*, u.first_name, u.last_name, u.email, u.avatar_url
                 FROM activity_log al
                 JOIN users u ON al.user_id = u.id
                 WHERE u.tenant_id = ?
                 ORDER BY al.created_at DESC
                 LIMIT ? OFFSET ?",
                [$tenantId, $limit, $offset]
            );
        } catch (\Throwable $e) {
            // activity_log table may not exist
        }

        // Format entries
        $formatted = array_map(function ($row) {
            $decodedDetails = $this->decodeActivityDetails((string) ($row->details ?? ''));
            $descriptionCode = is_string($decodedDetails['code'] ?? null)
                ? $decodedDetails['code']
                : null;
            $descriptionParams = is_array($decodedDetails['params'] ?? null)
                ? $decodedDetails['params']
                : [];

            return [
                'id' => (int) $row->id,
                'user_id' => (int) ($row->user_id ?? 0),
                'user_name' => UserDisplayName::resolve($row),
                'user_email' => $row->email ?? '',
                'user_avatar' => $row->avatar_url ?? null,
                'action' => $row->action ?? '',
                // New structured rows are localized by the React consumer.
                // Historical free-form and older structured rows retain their
                // legacy server-rendered description as a compatibility fallback.
                'description' => $descriptionCode === null ? $this->formatActivityDescription($row) : null,
                'description_code' => $descriptionCode,
                'description_params' => $descriptionParams,
                'ip_address' => $row->ip_address ?? null,
                'created_at' => $row->created_at ?? '',
            ];
        }, $items);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    private function formatActivityDescription(object $row): string
    {
        $details = (string) ($row->details ?? '');
        $decoded = $this->decodeActivityDetails($details);

        if ($decoded === null) {
            return $details;
        }

        return match ((string) ($row->action ?? '')) {
            'safeguarding_preferences_updated' => trans_choice(
                'api.activity_log.safeguarding_preferences_updated',
                (int) ($decoded['options_count'] ?? 0),
                ['count' => (int) ($decoded['options_count'] ?? 0)]
            ),
            'safeguarding_consent_revoked' => __(
                'api.activity_log.safeguarding_consent_revoked',
                ['option' => $this->formatOptionReference($decoded['option_id'] ?? null)]
            ),
            'safeguarding_triggers_activated' => $this->formatSafeguardingTriggers($decoded),
            'safeguarding_preferences_list_viewed' => trans_choice(
                'api.activity_log.safeguarding_preferences_list_viewed',
                (int) ($decoded['members_count'] ?? 0),
                ['count' => (int) ($decoded['members_count'] ?? 0)]
            ),
            'safeguarding_member_activity_viewed' => trans_choice(
                'api.activity_log.safeguarding_member_activity_viewed',
                (int) ($decoded['events_count'] ?? 0),
                ['count' => (int) ($decoded['events_count'] ?? 0)]
            ),
            'safeguarding_member_activity_exported' => trans_choice(
                'api.activity_log.safeguarding_member_activity_exported',
                (int) ($decoded['events_count'] ?? 0),
                ['count' => (int) ($decoded['events_count'] ?? 0)]
            ),
            default => __('api.activity_log.structured_details'),
        };
    }

    private function decodeActivityDetails(string $details): ?array
    {
        $trimmed = trim($details);

        if ($trimmed === '' || !str_starts_with($trimmed, '{')) {
            return null;
        }

        $decoded = json_decode($trimmed, true);

        return json_last_error() === JSON_ERROR_NONE && is_array($decoded)
            ? $decoded
            : null;
    }

    private function formatOptionReference(mixed $optionId): string
    {
        $id = (int) $optionId;

        if ($id <= 0) {
            return __('api.activity_log.unknown_option');
        }

        return __('api.activity_log.option_id', ['id' => $id]);
    }

    private function formatSafeguardingTriggers(array $details): string
    {
        $triggers = is_array($details['triggers'] ?? null) ? $details['triggers'] : [];
        $labels = [];

        foreach ([
            'needs_monitoring',
            'needs_broker_approval',
            'requires_vetted_interaction',
            'requires_broker_approval',
            'restricts_messaging',
            'restricts_matching',
            'notify_admin_on_selection',
        ] as $key) {
            $source = array_key_exists($key, $details) ? $details : $triggers;
            if (($source[$key] ?? false) === true) {
                $label = __('api.activity_log.trigger_' . $key);
                $labels[$label] = $label;
            }
        }

        $vettingTypes = $triggers['vetting_types_required'] ?? [];
        if (is_array($vettingTypes) && $vettingTypes !== []) {
            $types = implode(', ', array_map(
                fn ($type) => str_replace('_', ' ', (string) $type),
                $vettingTypes
            ));
            $label = __(
                'api.activity_log.trigger_vetting_types_required',
                ['types' => $types]
            );
            $labels[$label] = $label;
        }

        if ($labels === []) {
            return __('api.activity_log.safeguarding_triggers_none');
        }

        return __('api.activity_log.safeguarding_triggers_active', [
            'triggers' => implode(', ', array_values($labels)),
        ]);
    }

    /**
     * GET /insights
     *
     * Returns user insights data (transaction insights).
     */
    public function apiInsights(): JsonResponse
    {
        $userId = $this->requireAuth();
        $months = $this->queryInt('months', 6, 1, 24);

        return $this->respondWithData([
            'insights' => $this->userInsightsService->getInsights($userId, $months),
            'trends' => $this->userInsightsService->getMonthlyTrends($userId, $months),
            'partnerStats' => $this->userInsightsService->getPartnerStats($userId, $months),
        ]);
    }
}
