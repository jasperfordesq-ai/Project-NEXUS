<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\VolDonation;
use App\Models\VolGivingDay;
use App\Models\VolOpportunity;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * VolunteerDonationService — manages monetary donations linked to volunteer
 * opportunities and giving-day fundraising campaigns.
 *
 * Supports cursor-based pagination, giving-day progress tracking,
 * and CSV export for admin reporting.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait on models.
 */
class VolunteerDonationService
{
    /** Default page size for paginated queries */
    private const DEFAULT_LIMIT = 20;

    /** Maximum page size */
    private const MAX_LIMIT = 100;

    /** Valid donation statuses for filtering */
    private const VALID_STATUSES = ['pending', 'completed', 'refunded', 'failed'];

    public function __construct()
    {
    }

    /**
     * Get paginated donations for the current tenant.
     *
     * Uses cursor-based pagination (keyset on id DESC). Optionally filters
     * by opportunity_id, community_project_id and/or giving_day_id.
     *
     * @param array $filters Keys: user_id, opportunity_id, community_project_id, giving_day_id, cursor, limit
     * @return array{items: array, next_cursor: int|null}
     */
    public static function getDonations(array $filters = []): array
    {
        $limit = max(1, min((int) ($filters['limit'] ?? self::DEFAULT_LIMIT), self::MAX_LIMIT));
        $cursor = isset($filters['cursor']) ? (int) $filters['cursor'] : null;

        $select = array_merge([
            'id', 'user_id', 'opportunity_id', 'giving_day_id',
            'amount', 'currency', 'payment_method', 'payment_reference',
            'message', 'is_anonymous', 'status', 'created_at',
        ], self::donationRoutingColumns());

        // community_project_id was added after the base table shipped, so it is
        // schema-guarded like the Stripe routing columns above.
        $hasCommunityProject = Schema::hasColumn('vol_donations', 'community_project_id');
        if ($hasCommunityProject) {
            $select[] = 'community_project_id';
        }

        $query = VolDonation::query()->select($select);

        if (!empty($filters['user_id'])) {
            $query->where('user_id', (int) $filters['user_id']);
        }

        if (!empty($filters['opportunity_id'])) {
            $query->where('opportunity_id', (int) $filters['opportunity_id']);
        }

        if (!empty($filters['community_project_id']) && $hasCommunityProject) {
            $query->where('community_project_id', (int) $filters['community_project_id']);
        }

        if (!empty($filters['giving_day_id'])) {
            $query->where('giving_day_id', (int) $filters['giving_day_id']);
        }

        if ($cursor !== null) {
            $query->where('id', '<', $cursor);
        }

        $rows = $query->orderByDesc('id')
            ->limit($limit + 1)
            ->get();

        $nextCursor = null;
        if ($rows->count() > $limit) {
            $rows->pop();
            $nextCursor = $rows->last()->id;
        }

        return [
            'items' => $rows->map(fn ($row) => $row->toArray())->values()->toArray(),
            'next_cursor' => $nextCursor,
        ];
    }

    /**
     * Create a donation.
     *
     * If a giving_day_id is provided and valid, the giving day's
     * raised_amount is atomically incremented within the same transaction.
     *
     * @param int   $userId Donor user ID
     * @param array $data   Keys: amount, currency, payment_method, payment_reference,
     *                      message, is_anonymous, opportunity_id, giving_day_id
     * @return array The created donation record
     * @throws \InvalidArgumentException On validation failure
     */
    public static function createDonation(int $userId, array $data): array
    {
        $tenantId = TenantContext::getId();

        $amount = (float) ($data['amount'] ?? 0);
        // Offline/manual donations are recorded in the community's configured
        // currency (same resolution as StripeDonationService::createPaymentIntent).
        // Giving-day raised_amount sums the raw numeric amount with no FX
        // conversion, so accepting a client-supplied foreign currency would let
        // a donor inflate totals with a cheap currency. If the caller explicitly
        // supplies a DIFFERENT currency we reject rather than silently
        // relabelling the donation.
        $tenantCurrency = strtoupper(trim((string) TenantContext::runForTenant($tenantId, fn () => TenantContext::getCurrency())));
        $suppliedCurrency = strtoupper(trim((string) ($data['currency'] ?? '')));
        $currency = $suppliedCurrency === '' ? $tenantCurrency : $suppliedCurrency;
        $paymentMethod = trim($data['payment_method'] ?? '');
        $paymentReference = trim($data['payment_reference'] ?? '');
        $message = trim($data['message'] ?? '');
        $isAnonymous = !empty($data['is_anonymous']) ? 1 : 0;
        $opportunityId = isset($data['opportunity_id']) ? (int) $data['opportunity_id'] : null;
        $givingDayId = isset($data['giving_day_id']) ? (int) $data['giving_day_id'] : null;
        // Donations always start as 'pending' — only payment webhooks or admin actions
        // should mark them 'completed'. Allowing caller-controlled status would let
        // users bypass payment verification and inflate giving-day totals.
        $status = 'pending';

        if ($amount <= 0) {
            throw new \InvalidArgumentException(__('api.vol_donation_amount_positive'));
        }
        if ($amount > 1000000) {
            throw new \InvalidArgumentException(__('api.vol_donation_amount_max'));
        }
        if (strlen($currency) !== 3) {
            throw new \InvalidArgumentException(__('api.vol_donation_currency_invalid'));
        }
        if ($currency !== $tenantCurrency) {
            throw new \InvalidArgumentException(__('api.vol_donation_currency_mismatch', ['currency' => $tenantCurrency]));
        }
        if ($paymentMethod === '') {
            throw new \InvalidArgumentException(__('api.vol_donation_payment_method_required'));
        }

        if ($opportunityId !== null) {
            $opportunityExists = VolOpportunity::where('tenant_id', $tenantId)
                ->where('id', $opportunityId)
                ->exists();
            if (!$opportunityExists) {
                throw new \InvalidArgumentException(__('api.vol_opportunity_not_found'));
            }
        }

        if ($givingDayId !== null) {
            $givingDayExists = VolGivingDay::where('tenant_id', $tenantId)
                ->where('id', $givingDayId)
                ->exists();
            if (!$givingDayExists) {
                throw new \InvalidArgumentException(__('api.vol_giving_day_not_found'));
            }
        }

        $idempotencyKey = trim((string) ($data['idempotency_key'] ?? ''));
        $keyHash = null;
        $requestHash = null;
        if ($idempotencyKey !== '') {
            if (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 191) {
                throw new \InvalidArgumentException(__('api.validation_failed'));
            }
            $keyHash = hash('sha256', $idempotencyKey);
            $requestHash = hash('sha256', json_encode([
                'opportunity_id' => $opportunityId,
                'giving_day_id' => $givingDayId,
                'amount' => number_format($amount, 2, '.', ''),
                'currency' => $currency,
                'payment_method' => $paymentMethod,
                'payment_reference' => $paymentReference,
                'message' => $message,
                'is_anonymous' => $isAnonymous,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $replay = VolDonation::where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('creation_idempotency_key_hash', $keyHash)
                ->first();
            if ($replay) {
                if (!hash_equals((string) $replay->creation_request_hash, $requestHash)) {
                    throw new \RuntimeException(__('event_registration.idempotency_conflict'), 409);
                }
                return self::donationResponse($replay);
            }
        }

        $now = now();

        try {
            $donation = DB::transaction(function () use (
            $tenantId, $userId, $opportunityId, $givingDayId, $amount,
            $currency, $paymentMethod, $paymentReference, $message,
            $isAnonymous, $status, $now, $keyHash, $requestHash
            ) {
            $donation = VolDonation::create([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'creation_idempotency_key_hash' => $keyHash,
                'creation_request_hash' => $requestHash,
                'opportunity_id' => $opportunityId,
                'giving_day_id' => $givingDayId,
                'amount' => $amount,
                'currency' => $currency,
                'payment_method' => $paymentMethod,
                'payment_reference' => $paymentReference,
                'message' => $message,
                'is_anonymous' => $isAnonymous,
                'status' => $status,
                'created_at' => $now,
            ]);

            // Increment giving day raised_amount only for completed donations
            if ($givingDayId !== null && $status === 'completed') {
                VolGivingDay::where('tenant_id', $tenantId)
                    ->where('id', $givingDayId)
                    ->increment('raised_amount', $amount);
            }

            return $donation;
            });
        } catch (\Illuminate\Database\QueryException $e) {
            if ($keyHash === null) {
                throw $e;
            }
            $winner = VolDonation::where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('creation_idempotency_key_hash', $keyHash)
                ->first();
            if (!$winner || !hash_equals((string) $winner->creation_request_hash, (string) $requestHash)) {
                throw $e;
            }
            $donation = $winner;
        }

        return self::donationResponse($donation);
    }

    /** @return array<string, mixed> */
    private static function donationResponse(VolDonation $donation): array
    {
        return [
            'id' => (int) $donation->id,
            'tenant_id' => (int) $donation->tenant_id,
            'user_id' => (int) $donation->user_id,
            'opportunity_id' => $donation->opportunity_id !== null ? (int) $donation->opportunity_id : null,
            'giving_day_id' => $donation->giving_day_id !== null ? (int) $donation->giving_day_id : null,
            'amount' => number_format((float) $donation->amount, 2, '.', ''),
            'currency' => (string) $donation->currency,
            'payment_method' => (string) $donation->payment_method,
            'payment_reference' => (string) ($donation->payment_reference ?? ''),
            'message' => (string) ($donation->message ?? ''),
            'is_anonymous' => (int) $donation->is_anonymous,
            'status' => (string) $donation->status,
            'created_at' => $donation->created_at?->toDateTimeString() ?? (string) $donation->getRawOriginal('created_at'),
        ];
    }

    /**
     * Admin: mark a pending offline donation (cash / bank transfer / PayPal)
     * as completed and credit the linked giving day's raised total.
     *
     * Stripe donations are excluded — they complete via the payment webhook
     * only, otherwise an admin completion racing a later payment failure
     * would leave totals inflated.
     *
     * Lock-guarded and idempotent: the giving-day increment fires exactly
     * once per donation even under concurrent calls.
     *
     * @return array{id: int, status: string, already_completed: bool}
     * @throws \RuntimeException         If the donation does not exist for this tenant
     * @throws \InvalidArgumentException If the donation cannot be completed manually
     */
    public static function markCompleted(int $donationId, int $tenantId): array
    {
        return DB::transaction(function () use ($donationId, $tenantId) {
            $donation = DB::table('vol_donations')
                ->where('id', $donationId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$donation) {
                throw new \RuntimeException(__('api.donation_not_found'));
            }

            if ($donation->payment_method === 'stripe') {
                throw new \InvalidArgumentException(__('api.vol_donation_stripe_complete_via_webhook'));
            }

            if ($donation->status === 'completed') {
                return ['id' => (int) $donation->id, 'status' => 'completed', 'already_completed' => true];
            }

            if ($donation->status !== 'pending') {
                throw new \InvalidArgumentException(__('api.vol_donation_only_pending_completable'));
            }

            DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $tenantId)
                ->update(['status' => 'completed']);

            if (!empty($donation->giving_day_id)) {
                DB::table('vol_giving_days')
                    ->where('id', $donation->giving_day_id)
                    ->where('tenant_id', $tenantId)
                    ->increment('raised_amount', (float) $donation->amount);
            }

            return ['id' => (int) $donation->id, 'status' => 'completed', 'already_completed' => false];
        });
    }

    /**
     * List active giving days for the current tenant.
     */
    public static function getGivingDays(): array
    {
        $rows = VolGivingDay::where('is_active', true)
            ->orderByDesc('start_date')
            ->get([
                'id', 'title', 'description', 'start_date', 'end_date',
                'goal_amount', 'raised_amount', 'is_active', 'created_at',
            ]);

        if ($rows->isEmpty()) {
            return [];
        }

        // Resolve donor counts for every giving day in ONE grouped query instead
        // of a COUNT per row (N+1).
        $donorCounts = VolDonation::whereIn('giving_day_id', $rows->pluck('id'))
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'completed')
            ->groupBy('giving_day_id')
            ->selectRaw('giving_day_id, COUNT(DISTINCT user_id) as donor_count')
            ->pluck('donor_count', 'giving_day_id');

        return $rows->map(function ($row) use ($donorCounts) {
            $day = $row->toArray();
            $day['donor_count'] = (int) ($donorCounts[$row->id] ?? 0);
            return self::formatGivingDay($day);
        })->toArray();
    }

    /**
     * Get statistics for a giving day.
     *
     * @param int $givingDayId Giving day ID (tenant-scoped)
     * @return array Keys: total_raised, donor_count, goal_amount, progress_percent
     * @throws \RuntimeException If the giving day is not found
     */
    public static function getGivingDayStats(int $givingDayId): array
    {
        $givingDay = VolGivingDay::where('tenant_id', TenantContext::getId())->find($givingDayId);

        if (!$givingDay) {
            throw new \RuntimeException(__('api.vol_giving_day_not_found'));
        }

        $donorCount = VolDonation::where('giving_day_id', $givingDayId)
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'completed')
            ->distinct('user_id')
            ->count('user_id');

        $goalAmount = (float) $givingDay->goal_amount;
        $totalRaised = (float) $givingDay->raised_amount;
        $progress = $goalAmount > 0
            ? min(round(($totalRaised / $goalAmount) * 100, 2), 100.00)
            : 0.00;

        return [
            'total_raised' => number_format($totalRaised, 2, '.', ''),
            'donor_count' => $donorCount,
            'goal_amount' => number_format($goalAmount, 2, '.', ''),
            'progress_percent' => $progress,
        ];
    }

    /**
     * List all giving days (active and inactive) for admin view.
     */
    public static function adminGetGivingDays(): array
    {
        $rows = VolGivingDay::orderByDesc('created_at')
            ->get([
                'id', 'title', 'description', 'start_date', 'end_date',
                'goal_amount', 'raised_amount', 'target_hours', 'is_active', 'created_at',
            ]);

        if ($rows->isEmpty()) {
            return [];
        }

        // Resolve per-day aggregates in ONE grouped query instead of a query
        // per row (N+1). Days with no completed donations are absent from the
        // result and fall back to zeroes.
        $statsByDay = VolDonation::whereIn('giving_day_id', $rows->pluck('id'))
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'completed')
            ->groupBy('giving_day_id')
            ->selectRaw('giving_day_id, COUNT(*) as total_donations, COUNT(DISTINCT COALESCE(user_id, id)) as donor_count')
            ->get()
            ->keyBy('giving_day_id');

        return $rows->map(function ($row) use ($statsByDay) {
            $day = $row->toArray();
            $stats = $statsByDay->get($row->id);
            $day['donor_count'] = (int) ($stats->donor_count ?? 0);
            $day['donation_count'] = (int) ($stats->total_donations ?? 0);
            // raised_amount deliberately serves the STORED vol_giving_days
            // counter — the same source of truth the public getGivingDays()
            // and getGivingDayStats() paths use. The counter is maintained
            // transactionally across the full donation lifecycle: incremented
            // on completion (markCompleted / Stripe payment_intent.succeeded)
            // and decremented on refund (StripeDonationService::
            // handleChargeRefunded and ::createRefund). Recomputing
            // SUM(amount) here made the admin total silently diverge from the
            // totals members see.
            return self::formatGivingDay($day);
        })->toArray();
    }

    /**
     * Create a new giving day.
     *
     * @param array $data Must include: title, start_date, end_date, goal_amount. Optional: description.
     * @param int $tenantId
     * @return array|false The created giving day record, or false on failure
     */
    public static function createGivingDay(array $data, int $tenantId): array|false
    {
        $title = trim($data['title'] ?? $data['name'] ?? '');
        $description = trim($data['description'] ?? '');
        $startDate = trim($data['start_date'] ?? '');
        $endDate = trim($data['end_date'] ?? '');
        $goalAmount = (float) ($data['goal_amount'] ?? $data['target_amount'] ?? 0);
        $targetHours = isset($data['target_hours']) ? (float) $data['target_hours'] : 0.0;

        if ($title === '') {
            throw new \InvalidArgumentException(__('api.vol_giving_day_title_required'));
        }
        if ($startDate === '' || $endDate === '') {
            throw new \InvalidArgumentException(__('api.vol_giving_day_dates_required'));
        }
        if (strtotime($endDate) <= strtotime($startDate)) {
            throw new \InvalidArgumentException(__('api.vol_giving_day_end_after_start'));
        }
        if ($goalAmount <= 0) {
            throw new \InvalidArgumentException(__('api.vol_giving_day_goal_positive'));
        }

        $now = now();

        $givingDay = VolGivingDay::create([
            'tenant_id' => $tenantId,
            'title' => $title,
            'description' => $description,
            'start_date' => $startDate,
            'end_date' => $endDate,
            'goal_amount' => $goalAmount,
            'raised_amount' => 0.00,
            'target_hours' => $targetHours,
            'is_active' => 1,
            'created_by' => $data['created_by'] ?? null,
            'created_at' => $now,
        ]);

        return self::formatGivingDay([
            'id' => $givingDay->id,
            'title' => $title,
            'description' => $description,
            'start_date' => $startDate,
            'end_date' => $endDate,
            'goal_amount' => number_format($goalAmount, 2, '.', ''),
            'raised_amount' => '0.00',
            'target_hours' => $targetHours,
            'is_active' => 1,
            'created_at' => $now->toDateTimeString(),
        ]);
    }

    /**
     * Export donations as an array of rows for CSV generation.
     *
     * @param int $tenantId
     * @param array|null $filters Optional: opportunity_id, giving_day_id, status
     * @return array Array of associative arrays (one per donation row)
     */
    public static function exportDonations(int $tenantId, ?array $filters): array
    {
        $query = VolDonation::query()
            ->where('tenant_id', $tenantId)
            ->select(array_merge([
                'id', 'user_id', 'opportunity_id', 'giving_day_id',
                'amount', 'currency', 'payment_method', 'payment_reference',
                'message', 'is_anonymous', 'status', 'created_at',
            ], self::donationRoutingColumns()));

        if (!empty($filters['opportunity_id'])) {
            $query->where('opportunity_id', (int) $filters['opportunity_id']);
        }
        if (!empty($filters['giving_day_id'])) {
            $query->where('giving_day_id', (int) $filters['giving_day_id']);
        }
        if (!empty($filters['status']) && in_array($filters['status'], self::VALID_STATUSES, true)) {
            $query->where('status', $filters['status']);
        }
        if (!empty($filters['date_from'])) {
            $query->where('created_at', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->where('created_at', '<=', $filters['date_to']);
        }

        return $query->orderByDesc('created_at')
            ->get()
            ->map(fn ($row) => $row->toArray())
            ->toArray();
    }

    /**
     * Update a giving day by ID.
     *
     * @param int $givingDayId
     * @param array $data Fields to update: title, description, start_date, end_date, goal_amount, is_active
     * @param int $tenantId
     * @return bool True if a row was updated
     */
    public static function updateGivingDay(int $givingDayId, array $data, int $tenantId): bool
    {
        $givingDay = VolGivingDay::where('tenant_id', $tenantId)->find($givingDayId);

        if (!$givingDay) {
            return false;
        }

        $updates = [];

        if (isset($data['title']) || isset($data['name'])) {
            $updates['title'] = trim($data['title'] ?? $data['name']);
        }
        if (isset($data['description'])) {
            $updates['description'] = trim($data['description']);
        }
        if (isset($data['start_date'])) {
            $updates['start_date'] = trim($data['start_date']);
        }
        if (isset($data['end_date'])) {
            $updates['end_date'] = trim($data['end_date']);
        }
        if (isset($data['goal_amount']) || isset($data['target_amount'])) {
            $goalAmount = (float) ($data['goal_amount'] ?? $data['target_amount']);
            if ($goalAmount <= 0) {
                throw new \InvalidArgumentException(__('api.vol_giving_day_goal_positive'));
            }
            $updates['goal_amount'] = $goalAmount;
        }
        if (isset($data['target_hours'])) {
            $updates['target_hours'] = max(0, (float) $data['target_hours']);
        }
        if (isset($data['is_active'])) {
            $updates['is_active'] = $data['is_active'] ? 1 : 0;
        }

        if (empty($updates)) {
            return false;
        }

        return $givingDay->update($updates);
    }

    /**
     * Add frontend-compatible aliases to the canonical giving-day fields.
     *
     * @param array<string, mixed> $day
     * @return array<string, mixed>
     */
    private static function formatGivingDay(array $day): array
    {
        $goalAmount = (float) ($day['goal_amount'] ?? 0);

        $day['name'] = $day['name'] ?? ($day['title'] ?? '');
        $day['target_amount'] = (float) ($day['target_amount'] ?? $goalAmount);
        $day['target_hours'] = (float) ($day['target_hours'] ?? 0);
        $day['raised_amount'] = (float) ($day['raised_amount'] ?? 0);
        $day['donor_count'] = (int) ($day['donor_count'] ?? 0);

        if (!isset($day['status'])) {
            $today = now()->startOfDay();
            $start = !empty($day['start_date']) ? \Carbon\Carbon::parse($day['start_date'])->startOfDay() : null;
            $end = !empty($day['end_date']) ? \Carbon\Carbon::parse($day['end_date'])->endOfDay() : null;
            $day['status'] = !$day['is_active']
                ? 'ended'
                : (($start && $start->gt($today)) ? 'upcoming' : (($end && $end->lt($today)) ? 'ended' : 'active'));
        }

        return $day;
    }

    /**
     * @return array<int, string>
     */
    private static function donationRoutingColumns(): array
    {
        return array_values(array_filter(
            ['payment_route', 'stripe_account_id', 'stripe_payment_intent_id'],
            static fn (string $column): bool => Schema::hasColumn('vol_donations', $column),
        ));
    }
}
