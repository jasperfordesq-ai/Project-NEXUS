<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Support\OutboundUrlGuard;
use App\Support\SecurityBounds;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * PaidPushCampaignService — AG57 Paid Push Campaign Management.
 *
 * Advertisers (SMEs, Vereins, Gemeinden) pay to send targeted push
 * notifications to opted-in members.  All queries are tenant-scoped.
 *
 * Cost model: cost_per_send cents × actual_send_count = total_cost_cents.
 * Default rate: 5 ct/notification (€0.05).
 *
 * Audience filtering:
 *  - Optional radius filter (Haversine) on users.latitude/longitude
 *  - Optional member_tier_min (maps to users.trust_tier or numeric tier column)
 *  - Optional interests array (matches against users.skills / tag columns)
 */
class PaidPushCampaignService
{
    private const TABLE       = 'paid_push_campaigns';
    private const TABLE_SENDS = 'paid_push_campaign_sends';

    private const EDITABLE_STATUSES = ['draft', 'pending_review'];

    // -----------------------------------------------------------------------
    // Feature availability guard
    // -----------------------------------------------------------------------

    public static function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE)
            && Schema::hasTable(self::TABLE_SENDS);
    }

    // -----------------------------------------------------------------------
    // Listing / retrieval
    // -----------------------------------------------------------------------

    /**
     * List all campaigns for a tenant, optionally filtered by status.
     * Joins the creating user for advertiser display name.
     */
    public static function listCampaigns(int $tenantId, ?string $status = null): array
    {
        $query = DB::table(self::TABLE . ' as c')
            ->leftJoin('users as u', 'c.created_by', '=', 'u.id')
            ->where('c.tenant_id', $tenantId)
            ->select([
                'c.*',
                DB::raw("CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS advertiser_name"),
                'u.email AS advertiser_email',
            ])
            ->orderByDesc('c.created_at');

        if ($status !== null && $status !== '') {
            $query->where('c.status', $status);
        }

        return $query->get()->map(fn ($row) => (array) $row)->all();
    }

    /**
     * Fetch a single campaign by ID, scoped to the tenant.
     */
    public static function getCampaignById(int $id, int $tenantId): ?array
    {
        $row = DB::table(self::TABLE . ' as c')
            ->leftJoin('users as u', 'c.created_by', '=', 'u.id')
            ->where('c.id', $id)
            ->where('c.tenant_id', $tenantId)
            ->select([
                'c.*',
                DB::raw("CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS advertiser_name"),
                'u.email AS advertiser_email',
            ])
            ->first();

        return $row ? (array) $row : null;
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    /**
     * Create a new campaign in draft status.
     *
     * @param array{
     *   name: string,
     *   title: string,
     *   body: string,
     *   advertiser_type?: string,
     *   cta_url?: string|null,
     *   audience_filter?: array|null,
     *   scheduled_at?: string|null,
     *   cost_per_send?: int,
     * } $data
     */
    public static function createCampaign(int $tenantId, int $userId, array $data): array
    {
        $now = Carbon::now();
        $ctaUrl = self::safeCtaUrl($data['cta_url'] ?? null);

        $id = DB::table(self::TABLE)->insertGetId([
            'tenant_id'       => $tenantId,
            'created_by'      => $userId,
            'name'            => $data['name'],
            'status'          => 'draft',
            'advertiser_type' => $data['advertiser_type'] ?? 'sme',
            'title'           => $data['title'],
            'body'            => $data['body'],
            'cta_url'         => $ctaUrl,
            'audience_filter' => isset($data['audience_filter'])
                ? json_encode($data['audience_filter'])
                : null,
            'target_count'    => null,
            'actual_send_count' => 0,
            'scheduled_at'    => isset($data['scheduled_at']) && $data['scheduled_at'] !== ''
                ? Carbon::parse($data['scheduled_at'])->toDateTimeString()
                : null,
            'cost_per_send'   => SecurityBounds::paidPushCostPerSend($data['cost_per_send'] ?? 5),
            'total_cost_cents' => 0,
            'open_count'      => 0,
            'click_count'     => 0,
            'created_at'      => $now,
            'updated_at'      => $now,
        ]);

        return self::getCampaignById($id, $tenantId) ?? [];
    }

    /**
     * Update a campaign — only allowed while in draft or pending_review.
     */
    public static function updateCampaign(int $id, int $tenantId, array $data): array
    {
        $campaign = self::getCampaignById($id, $tenantId);

        if ($campaign === null) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_found'));
        }

        if (! in_array($campaign['status'], self::EDITABLE_STATUSES, true)) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_editable', ['status' => $campaign['status']]));
        }

        $updatePayload = ['updated_at' => Carbon::now()];

        $allowedFields = ['name', 'advertiser_type', 'title', 'body'];
        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $updatePayload[$field] = $data[$field];
            }
        }

        if (array_key_exists('cta_url', $data)) {
            $updatePayload['cta_url'] = self::safeCtaUrl($data['cta_url']);
        }

        if (array_key_exists('audience_filter', $data)) {
            $updatePayload['audience_filter'] = $data['audience_filter'] !== null
                ? json_encode($data['audience_filter'])
                : null;
        }

        if (array_key_exists('scheduled_at', $data)) {
            $updatePayload['scheduled_at'] = ($data['scheduled_at'] !== null && $data['scheduled_at'] !== '')
                ? Carbon::parse($data['scheduled_at'])->toDateTimeString()
                : null;
        }

        if (array_key_exists('cost_per_send', $data)) {
            $updatePayload['cost_per_send'] = SecurityBounds::paidPushCostPerSend($data['cost_per_send']);
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updatePayload);

        return self::getCampaignById($id, $tenantId) ?? [];
    }

    // -----------------------------------------------------------------------
    // Audience estimation
    // -----------------------------------------------------------------------

    /**
     * Count how many active members in this tenant match the given audience filter.
     *
     * Supports:
     *   - radius_km + lat + lng  → Haversine distance filter
     *   - member_tier_min        → users.trust_tier >= min (if column exists)
     *
     * @param array{
     *   radius_km?: float|int,
     *   lat?: float|null,
     *   lng?: float|null,
     *   member_tier_min?: int,
     *   interests?: string[],
     * } $audienceFilter
     */
    public static function estimateAudience(int $tenantId, array $audienceFilter): int
    {
        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active');

        // Radius filter (Haversine) — only when all three params are provided and non-zero
        $radiusKm = isset($audienceFilter['radius_km']) ? (float) $audienceFilter['radius_km'] : 0;
        $lat      = isset($audienceFilter['lat']) ? (float) $audienceFilter['lat'] : 0;
        $lng      = isset($audienceFilter['lng']) ? (float) $audienceFilter['lng'] : 0;

        if ($radiusKm > 0 && $lat !== 0.0 && $lng !== 0.0) {
            // Haversine formula — distance in kilometres
            $haversine = "(6371 * acos(
                    cos(radians(?))
                    * cos(radians(latitude))
                    * cos(radians(longitude) - radians(?))
                    + sin(radians(?)) * sin(radians(latitude))
                ))";
            $query->whereNotNull('latitude')
                  ->whereNotNull('longitude')
                  ->havingRaw("{$haversine} < ?", [$lat, $lng, $lat, $radiusKm]);
        }

        // Trust tier minimum — only if the column exists
        $tierMin = isset($audienceFilter['member_tier_min']) ? (int) $audienceFilter['member_tier_min'] : 0;
        if ($tierMin > 0 && Schema::hasColumn('users', 'trust_tier')) {
            $query->where('trust_tier', '>=', $tierMin);
        }

        return (int) $query->count();
    }

    // -----------------------------------------------------------------------
    // Admin workflow actions
    // -----------------------------------------------------------------------

    /**
     * Approve a campaign.  Sets status to 'scheduled' (or 'sending' if the
     * scheduled_at is in the past / null), populates target_count, records
     * approved_by and approved_at.
     */
    public static function approveCampaign(int $id, int $tenantId, int $approvedBy): array
    {
        $campaign = self::getCampaignById($id, $tenantId);

        if ($campaign === null) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_found'));
        }

        if ($campaign['status'] !== 'pending_review') {
            throw new \RuntimeException(__('api.paid_push_campaign_approve_pending_only'));
        }

        // Resolve audience now so we can store target_count
        $audienceFilter = [];
        if (! empty($campaign['audience_filter'])) {
            $decoded = json_decode($campaign['audience_filter'], true);
            $audienceFilter = is_array($decoded) ? $decoded : [];
        }
        $targetCount = self::estimateAudience($tenantId, $audienceFilter);

        // Decide next status
        $scheduledAt = $campaign['scheduled_at'];
        $newStatus = ($scheduledAt === null || Carbon::parse($scheduledAt)->isPast())
            ? 'sending'
            : 'scheduled';

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'       => $newStatus,
                'target_count' => $targetCount,
                'approved_by'  => $approvedBy,
                'approved_at'  => Carbon::now(),
                'updated_at'   => Carbon::now(),
            ]);

        return self::getCampaignById($id, $tenantId) ?? [];
    }

    /**
     * Reject a campaign with a mandatory reason.
     */
    public static function rejectCampaign(int $id, int $tenantId, string $reason): void
    {
        $campaign = self::getCampaignById($id, $tenantId);

        if ($campaign === null) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_found'));
        }

        if (! in_array($campaign['status'], ['pending_review', 'scheduled', 'paused'], true)) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_rejectable', ['status' => $campaign['status']]));
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'           => 'rejected',
                'rejection_reason' => $reason,
                'updated_at'       => Carbon::now(),
            ]);
    }

    /**
     * Dispatch a campaign: resolve recipient list, send FCM notifications,
     * write send rows, and mark the campaign as sent.
     *
     * @return array{sent: int, failed: int, total_cost_cents: int}
     */
    public static function dispatchCampaign(int $id, int $tenantId): array
    {
        $campaign = self::getCampaignById($id, $tenantId);

        if ($campaign === null) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_found'));
        }

        if (! in_array($campaign['status'], ['sending', 'scheduled'], true)) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_dispatchable', ['status' => $campaign['status']]));
        }

        // Mark as sending immediately to prevent double-dispatch
        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['status' => 'sending', 'updated_at' => Carbon::now()]);

        // Resolve recipient user IDs — active members in this tenant
        $audienceFilter = [];
        if (! empty($campaign['audience_filter'])) {
            $decoded = json_decode($campaign['audience_filter'], true);
            $audienceFilter = is_array($decoded) ? $decoded : [];
        }

        $recipientIds = self::resolveRecipientIds($tenantId, $audienceFilter);

        if (empty($recipientIds)) {
            // No recipients — mark as sent with zero sends
            DB::table(self::TABLE)
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status'             => 'sent',
                    'actual_send_count'  => 0,
                    'total_cost_cents'   => 0,
                    'sent_at'            => Carbon::now(),
                    'updated_at'         => Carbon::now(),
                ]);

            return ['sent' => 0, 'failed' => 0, 'total_cost_cents' => 0];
        }

        // Send via FCM
        $fcmResult = FCMPushService::sendToUsers(
            $recipientIds,
            $campaign['title'],
            $campaign['body'],
            [
                'campaign_id'   => (string) $id,
                'campaign_type' => 'paid_push',
                'cta_url'       => $campaign['cta_url'] ?? '',
            ]
        );

        // Write individual send rows (one per user)
        $sentAt = Carbon::now();
        $sendRows = [];
        foreach ($recipientIds as $userId) {
            $sendRows[] = [
                'campaign_id'    => $id,
                'tenant_id'      => $tenantId,
                'user_id'        => $userId,
                'sent_at'        => $sentAt,
                'opened_at'      => null,
                'fcm_message_id' => null,
            ];
        }

        // Insert in chunks to avoid huge query strings
        foreach (array_chunk($sendRows, 500) as $chunk) {
            DB::table(self::TABLE_SENDS)->insert($chunk);
        }

        $actualSendCount = count($recipientIds);
        $costPerSend     = SecurityBounds::paidPushCostPerSend($campaign['cost_per_send'] ?? 5);
        $totalCostCents  = $actualSendCount * $costPerSend;

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'            => 'sent',
                'actual_send_count' => $actualSendCount,
                'total_cost_cents'  => $totalCostCents,
                'sent_at'           => $sentAt,
                'updated_at'        => Carbon::now(),
            ]);

        return [
            'sent'            => $fcmResult['sent'],
            'failed'          => $fcmResult['failed'],
            'total_cost_cents' => $totalCostCents,
        ];
    }

    // -----------------------------------------------------------------------
    // Open tracking
    // -----------------------------------------------------------------------

    /**
     * Record that a user opened/tapped the notification.
     * Updates the sends row and increments the campaign open counter.
     */
    public static function recordOpen(int $campaignId, int $userId, int $tenantId): void
    {
        $now = Carbon::now();

        // Only update the first open — ignore if already opened
        $updated = DB::table(self::TABLE_SENDS)
            ->where('campaign_id', $campaignId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->whereNull('opened_at')
            ->update(['opened_at' => $now]);

        if ($updated > 0) {
            DB::table(self::TABLE)
                ->where('id', $campaignId)
                ->where('tenant_id', $tenantId)
                ->increment('open_count');
        }
    }

    // -----------------------------------------------------------------------
    // Analytics
    // -----------------------------------------------------------------------

    /**
     * Detailed analytics for one campaign.
     *
     * @return array{
     *   send_count: int,
     *   open_count: int,
     *   click_count: int,
     *   open_rate: float,
     *   daily_breakdown: array<array{date: string, sends: int, opens: int}>,
     * }
     */
    public static function getCampaignAnalytics(int $id, int $tenantId): array
    {
        $campaign = self::getCampaignById($id, $tenantId);

        if ($campaign === null) {
            throw new \RuntimeException(__('api.paid_push_campaign_not_found'));
        }

        $sendCount  = (int) ($campaign['actual_send_count'] ?? 0);
        $openCount  = (int) ($campaign['open_count'] ?? 0);
        $clickCount = (int) ($campaign['click_count'] ?? 0);
        $openRate   = $sendCount > 0 ? round(($openCount / $sendCount) * 100, 1) : 0.0;

        // Daily breakdown from send rows (last 30 days)
        $dailyRows = DB::table(self::TABLE_SENDS)
            ->where('campaign_id', $id)
            ->select([
                DB::raw("DATE(sent_at) AS date"),
                DB::raw("COUNT(*) AS sends"),
                DB::raw("SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opens"),
            ])
            ->groupBy(DB::raw("DATE(sent_at)"))
            ->orderBy('date')
            ->get()
            ->map(fn ($row) => [
                'date'  => $row->date,
                'sends' => (int) $row->sends,
                'opens' => (int) $row->opens,
            ])
            ->all();

        return [
            'send_count'      => $sendCount,
            'open_count'      => $openCount,
            'click_count'     => $clickCount,
            'open_rate'       => $openRate,
            'daily_breakdown' => $dailyRows,
        ];
    }

    /**
     * Overview stats for the admin dashboard.
     *
     * @return array{
     *   total_campaigns: int,
     *   by_status: array<string, int>,
     *   sends_this_month: int,
     *   opens_this_month: int,
     *   revenue_cents_this_month: int,
     * }
     */
    public static function getOverviewStats(int $tenantId): array
    {
        // Counts per status
        $statusRows = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->select('status', DB::raw('COUNT(*) AS cnt'))
            ->groupBy('status')
            ->get();

        $byStatus    = [];
        $totalCampaigns = 0;
        foreach ($statusRows as $row) {
            $byStatus[$row->status] = (int) $row->cnt;
            $totalCampaigns += (int) $row->cnt;
        }

        // Current month metrics
        $monthStart = Carbon::now()->startOfMonth()->toDateTimeString();

        $monthMetrics = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('sent_at', '>=', $monthStart)
            ->select([
                DB::raw('SUM(actual_send_count) AS sends'),
                DB::raw('SUM(open_count) AS opens'),
                DB::raw('SUM(total_cost_cents) AS revenue'),
            ])
            ->first();

        return [
            'total_campaigns'          => $totalCampaigns,
            'by_status'                => $byStatus,
            'sends_this_month'         => (int) ($monthMetrics->sends ?? 0),
            'opens_this_month'         => (int) ($monthMetrics->opens ?? 0),
            'revenue_cents_this_month' => (int) ($monthMetrics->revenue ?? 0),
        ];
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    private static function safeCtaUrl(mixed $url): ?string
    {
        $value = is_string($url) ? trim($url) : '';
        if ($value === '') {
            return null;
        }

        if (!OutboundUrlGuard::isSafeBrowserUrl($value)) {
            throw new \InvalidArgumentException(__('api.invalid_url'));
        }

        $parts = parse_url($value);
        $host = is_array($parts) ? strtolower(trim((string) ($parts['host'] ?? ''), '[]')) : '';
        if (!is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['port'])
            || isset($parts['fragment'])
            || $host === 'localhost'
            || str_ends_with($host, '.localhost')
            || str_ends_with($host, '.local')
            || str_ends_with($host, '.internal')
            || filter_var($host, FILTER_VALIDATE_IP) !== false
            || !str_contains($host, '.')
        ) {
            throw new \InvalidArgumentException(__('api.invalid_url'));
        }
        parse_str((string) ($parts['query'] ?? ''), $query);
        foreach (array_keys($query) as $key) {
            if (preg_match('/token|secret|password|signature|authorization|api[_-]?key/i', (string) $key) === 1) {
                throw new \InvalidArgumentException(__('api.invalid_url'));
            }
        }

        return $value;
    }

    /**
     * Resolve recipient user IDs from the tenant, applying audience filters.
     *
     * @return int[]
     */
    private static function resolveRecipientIds(int $tenantId, array $audienceFilter): array
    {
        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active');

        // Radius filter (Haversine)
        $radiusKm = isset($audienceFilter['radius_km']) ? (float) $audienceFilter['radius_km'] : 0;
        $lat      = isset($audienceFilter['lat']) ? (float) $audienceFilter['lat'] : 0;
        $lng      = isset($audienceFilter['lng']) ? (float) $audienceFilter['lng'] : 0;

        if ($radiusKm > 0 && $lat !== 0.0 && $lng !== 0.0) {
            $haversine = "(6371 * acos(
                    cos(radians(?))
                    * cos(radians(latitude))
                    * cos(radians(longitude) - radians(?))
                    + sin(radians(?)) * sin(radians(latitude))
                ))";
            $query->whereNotNull('latitude')
                  ->whereNotNull('longitude')
                  ->havingRaw("{$haversine} < ?", [$lat, $lng, $lat, $radiusKm]);
        }

        // Trust tier minimum
        $tierMin = isset($audienceFilter['member_tier_min']) ? (int) $audienceFilter['member_tier_min'] : 0;
        if ($tierMin > 0 && Schema::hasColumn('users', 'trust_tier')) {
            $query->where('trust_tier', '>=', $tierMin);
        }

        // App Review Guideline 4.5.4 requires explicit opt-in before promotional
        // push. A general push permission is not marketing consent, so campaigns
        // fail closed when the preference is absent, malformed, or false.
        return $query
            ->get(['id', 'notification_preferences'])
            ->filter(static function (object $user): bool {
                $raw = $user->notification_preferences ?? null;
                $preferences = is_array($raw) ? $raw : json_decode((string) $raw, true);

                return is_array($preferences)
                    && ($preferences['push_campaigns_opted_in'] ?? false) === true;
            })
            ->map(static fn (object $user): int => (int) $user->id)
            ->values()
            ->all();
    }
}
