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
use App\Services\FundraisingHistoryService as FundraisingHistory;
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
        ], self::donationRoutingColumns(), self::organisationColumn('vol_donations'));

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

        // Name the campaign on each row. The member-facing list used to show
        // only the id, so a donor could not tell which appeal a gift went to
        // once the campaign had closed and dropped out of the giving-days list.
        // One grouped lookup, tenant-scoped, instead of a query per row.
        $givingDayIds = $rows->pluck('giving_day_id')->filter()->unique()->values();
        $titles = $givingDayIds->isEmpty()
            ? collect()
            : VolGivingDay::where('tenant_id', TenantContext::getId())
                ->whereIn('id', $givingDayIds)
                ->pluck('title', 'id');
        $organisationNames = self::organisationNames($rows->pluck('organization_id'));

        return [
            'items' => $rows->map(function ($row) use ($titles, $organisationNames) {
                $item = $row->toArray();
                $item['giving_day_title'] = $row->giving_day_id !== null
                    ? ($titles[(int) $row->giving_day_id] ?? null)
                    : null;
                $item['organization_id'] = $row->organization_id !== null ? (int) $row->organization_id : null;
                $item['organization_name'] = $item['organization_id'] !== null
                    ? ($organisationNames[$item['organization_id']] ?? null)
                    : null;
                return $item;
            })->values()->toArray(),
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

        // Which organisation the gift benefits is decided here, from the
        // campaign (or opportunity) - never taken from the client.
        $organisation = self::resolveDonationOrganisation($tenantId, $givingDayId, $opportunityId);

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
            $isAnonymous, $status, $now, $keyHash, $requestHash, $organisation
            ) {
            $attributes = [
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
            ];
            if (self::organisationColumn('vol_donations') !== []) {
                $attributes['organization_id'] = $organisation['id'] ?? null;
            }
            $donation = VolDonation::create($attributes);
            FundraisingHistory::record($tenantId, 'donation_started', FundraisingHistory::ACTOR_MEMBER, $userId, [
                'giving_day_id' => $givingDayId,
                'donation_id' => (int) $donation->id,
                'organization_id' => $organisation['id'] ?? null,
            ], $amount, $currency, ['payment_method' => $paymentMethod]);

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
            'organization_id' => $donation->organization_id !== null ? (int) $donation->organization_id : null,
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
    public static function markCompleted(int $donationId, int $tenantId, ?int $actorUserId = null): array
    {
        return DB::transaction(function () use ($donationId, $tenantId, $actorUserId) {
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

            FundraisingHistory::record($tenantId, 'donation_paid', FundraisingHistory::ACTOR_COMMUNITY_ADMIN, $actorUserId, [
                'giving_day_id' => $donation->giving_day_id !== null ? (int) $donation->giving_day_id : null,
                'donation_id' => (int) $donation->id,
                'organization_id' => ($donation->organization_id ?? null) !== null ? (int) $donation->organization_id : null,
            ], (float) $donation->amount, $donation->currency, ['payment_method' => $donation->payment_method]);

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
            ->get(array_merge([
                'id', 'title', 'description', 'start_date', 'end_date',
                'goal_amount', 'raised_amount', 'is_active', 'created_at',
            ], self::organisationColumn('vol_giving_days')));

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
        $organisationNames = self::organisationNames($rows->pluck('organization_id'));

        return $rows->map(function ($row) use ($donorCounts, $organisationNames) {
            $day = $row->toArray();
            $day['donor_count'] = (int) ($donorCounts[$row->id] ?? 0);
            return self::formatGivingDay(self::withOrganisationName($day, $organisationNames));
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
            ->get(array_merge([
                'id', 'title', 'description', 'start_date', 'end_date',
                'goal_amount', 'raised_amount', 'target_hours', 'is_active', 'created_at',
            ], self::organisationColumn('vol_giving_days'), self::updatedColumns()));

        if ($rows->isEmpty()) {
            return [];
        }

        // Campaigns referenced by ANY donation (any status) — their
        // organisation is locked, and the admin picker says so.
        $withDonations = VolDonation::whereIn('giving_day_id', $rows->pluck('id'))
            ->where('tenant_id', TenantContext::getId())
            ->distinct()
            ->pluck('giving_day_id')
            ->map(fn ($id) => (int) $id)
            ->flip();

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
        $organisationNames = self::organisationNames($rows->pluck('organization_id'));

        return $rows->map(function ($row) use ($statsByDay, $organisationNames, $withDonations) {
            $day = $row->toArray();
            $stats = $statsByDay->get($row->id);
            $day['donor_count'] = (int) ($stats->donor_count ?? 0);
            $day['donation_count'] = (int) ($stats->total_donations ?? 0);
            $day['has_donations'] = $withDonations->has((int) $row->id);
            // raised_amount deliberately serves the STORED vol_giving_days
            // counter — the same source of truth the public getGivingDays()
            // and getGivingDayStats() paths use. The counter is maintained
            // transactionally across the full donation lifecycle: incremented
            // on completion (markCompleted / Stripe payment_intent.succeeded)
            // and decremented on refund (StripeDonationService::
            // handleChargeRefunded and ::createRefund). Recomputing
            // SUM(amount) here made the admin total silently diverge from the
            // totals members see.
            return self::formatGivingDay(self::withOrganisationName($day, $organisationNames));
        })->toArray();
    }

    /**
     * Create a new giving day.
     *
     * @param array $data Must include: title, start_date, end_date, goal_amount. Optional: description,
     *                    organization_id, created_by (the actor recorded in the history).
     * @param int $tenantId
     * @param string $actorKind Who is acting: a community admin (admin screen) or an
     *                          organisation admin (organisation dashboard).
     * @return array|false The created giving day record, or false on failure
     */
    public static function createGivingDay(
        array $data,
        int $tenantId,
        string $actorKind = FundraisingHistory::ACTOR_COMMUNITY_ADMIN,
    ): array|false
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
        $organisation = self::organisationFromInput($data['organization_id'] ?? null, $tenantId);

        $now = now();

        // The campaign and its history entries commit together: a campaign
        // whose creation was not recorded must not exist.
        $givingDay = DB::transaction(function () use (
            $tenantId, $title, $description, $startDate, $endDate, $goalAmount, $targetHours,
            $organisation, $data, $now, $actorKind
        ) {
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
                'organization_id' => $organisation['id'] ?? null,
                'created_by' => $data['created_by'] ?? null,
                'created_at' => $now,
            ]);

            $actorId = isset($data['created_by']) ? (int) $data['created_by'] : null;
            $orgId = $organisation['id'] ?? null;
            $refs = ['giving_day_id' => (int) $givingDay->id, 'organization_id' => $orgId];
            FundraisingHistory::record($tenantId, 'campaign_created', $actorKind, $actorId, $refs, null, null, [
                'title' => $title,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'goal_amount' => number_format($goalAmount, 2, '.', ''),
            ]);
            if ($orgId !== null) {
                FundraisingHistory::record($tenantId, 'campaign_organisation_set', $actorKind, $actorId, $refs, null, null, [
                    'changes' => ['organization_id' => ['from' => null, 'to' => $orgId]],
                ]);
            }

            return $givingDay;
        });

        return self::formatGivingDay([
            'id' => $givingDay->id,
            'organization_id' => $organisation['id'] ?? null,
            'organization_name' => $organisation['name'] ?? null,
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
            ], self::donationRoutingColumns(), self::organisationColumn('vol_donations')));

        if (!empty($filters['opportunity_id'])) {
            $query->where('opportunity_id', (int) $filters['opportunity_id']);
        }
        if (!empty($filters['organization_id']) && self::organisationColumn('vol_donations') !== []) {
            $query->where('organization_id', (int) $filters['organization_id']);
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

        $rows = $query->orderByDesc('created_at')->get();
        $hasOrganisation = self::organisationColumn('vol_donations') !== [];
        $organisationNames = $hasOrganisation ? self::organisationNames($rows->pluck('organization_id')) : [];

        return $rows
            ->map(function ($row) use ($hasOrganisation, $organisationNames) {
                $item = $row->toArray();
                if ($hasOrganisation) {
                    $orgId = $row->organization_id !== null ? (int) $row->organization_id : null;
                    $item['organization_id'] = $orgId;
                    $item['organization_name'] = $orgId !== null ? ($organisationNames[$orgId] ?? null) : null;
                }
                return $item;
            })
            ->toArray();
    }

    /**
     * Update a giving day by ID.
     *
     * @param int $givingDayId
     * Every real change is recorded in the fundraising history (who, when,
     * before → after). Pausing, resuming and ending are recorded as their own
     * events. A campaign's organisation is locked once any donation references
     * the campaign, so a past gift can never appear to have gone elsewhere.
     *
     * @param array $data Fields to update: title, description, start_date, end_date, goal_amount, is_active
     * @param int $tenantId
     * @param int|null $actorUserId Who made the change (stored as updated_by and in the history)
     * @param string $actorKind community_admin or org_admin
     * @return bool True if the campaign exists and the update was applied (or changed nothing)
     * @throws \InvalidArgumentException On invalid input or a locked organisation
     */
    public static function updateGivingDay(
        int $givingDayId,
        array $data,
        int $tenantId,
        ?int $actorUserId = null,
        string $actorKind = FundraisingHistory::ACTOR_COMMUNITY_ADMIN,
    ): bool {
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
        // array_key_exists, not isset: an explicit null (or empty string) moves
        // the campaign back to "the whole community".
        if (array_key_exists('organization_id', $data) && self::organisationColumn('vol_giving_days') !== []) {
            $organisation = self::organisationFromInput($data['organization_id'], $tenantId);
            $updates['organization_id'] = $organisation['id'] ?? null;
        }

        if (empty($updates)) {
            return false;
        }

        return DB::transaction(function () use ($givingDay, $updates, $tenantId, $actorUserId, $actorKind) {
            $locked = DB::table('vol_giving_days')
                ->where('id', $givingDay->id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (!$locked) {
                return false;
            }

            $changes = [];
            foreach ($updates as $column => $value) {
                $normalise = static fn ($v) => match ($column) {
                    'goal_amount' => $v === null ? null : number_format((float) $v, 2, '.', ''),
                    'target_hours' => $v === null ? null : number_format((float) $v, 1, '.', ''),
                    'is_active', 'organization_id' => $v === null ? null : (int) $v,
                    default => $v === null ? null : (string) $v,
                };
                $before = $normalise($locked->{$column} ?? null);
                $after = $normalise($value);
                if ($before !== $after) {
                    $changes[$column] = ['from' => $before, 'to' => $after];
                }
            }
            if ($changes === []) {
                return true;
            }

            if (array_key_exists('organization_id', $changes) && self::campaignHasDonations($tenantId, (int) $locked->id)) {
                throw new \InvalidArgumentException(__('fundraising.organisation_locked'));
            }

            DB::table('vol_giving_days')
                ->where('id', $locked->id)
                ->where('tenant_id', $tenantId)
                ->update(array_merge(
                    array_intersect_key($updates, $changes),
                    ['updated_at' => now(), 'updated_by' => $actorUserId],
                ));

            $orgAfter = array_key_exists('organization_id', $changes)
                ? $changes['organization_id']['to']
                : ($locked->organization_id !== null ? (int) $locked->organization_id : null);
            $refs = ['giving_day_id' => (int) $locked->id, 'organization_id' => $orgAfter];

            if (array_key_exists('organization_id', $changes)) {
                FundraisingHistory::record($tenantId, 'campaign_organisation_set', $actorKind, $actorUserId, $refs,
                    null, null, ['changes' => ['organization_id' => $changes['organization_id']]]);
                unset($changes['organization_id']);
            }
            if (array_key_exists('is_active', $changes)) {
                $endPassed = \Carbon\Carbon::parse($updates['end_date'] ?? $locked->end_date)->endOfDay()->isPast();
                $event = $changes['is_active']['to'] === 1
                    ? 'campaign_resumed'
                    : ($endPassed ? 'campaign_ended' : 'campaign_paused');
                FundraisingHistory::record($tenantId, $event, $actorKind, $actorUserId, $refs);
                unset($changes['is_active']);
            }
            if ($changes !== []) {
                FundraisingHistory::record($tenantId, 'campaign_updated', $actorKind, $actorUserId, $refs,
                    null, null, ['changes' => $changes]);
            }

            return true;
        });
    }

    /**
     * Whether any donation (any status) references this campaign. Once one
     * does, the campaign's organisation can no longer change.
     */
    public static function campaignHasDonations(int $tenantId, int $givingDayId): bool
    {
        return DB::table('vol_donations')
            ->where('tenant_id', $tenantId)
            ->where('giving_day_id', $givingDayId)
            ->exists();
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
            // Inactive before its end date = paused (it can be resumed);
            // inactive after it = ended.
            $day['status'] = !$day['is_active']
                ? (($end && $end->lt($today)) ? 'ended' : 'paused')
                : (($start && $start->gt($today)) ? 'upcoming' : (($end && $end->lt($today)) ? 'ended' : 'active'));
        }

        return $day;
    }

    /**
     * The organisation a donation benefits.
     *
     * A campaign that names an organisation wins; otherwise a gift made against
     * an opportunity goes to the opportunity's organisation; otherwise it is a
     * gift to the whole community (null). Every lookup is tenant-scoped, and an
     * organisation that is no longer public (pending / declined / suspended)
     * resolves to null rather than to a stale attribution.
     *
     * Used by both the pledge path and StripeDonationService, so the
     * organisation on the donation row and in the PaymentIntent metadata can
     * never disagree.
     *
     * @return array{id:int,name:string}|null
     */
    public static function resolveDonationOrganisation(int $tenantId, ?int $givingDayId, ?int $opportunityId): ?array
    {
        $organisationId = null;

        if ($givingDayId !== null && self::organisationColumn('vol_giving_days') !== []) {
            $organisationId = VolGivingDay::where('tenant_id', $tenantId)
                ->where('id', $givingDayId)
                ->value('organization_id');
        }

        if ($organisationId === null && $opportunityId !== null) {
            $organisationId = VolOpportunity::where('tenant_id', $tenantId)
                ->where('id', $opportunityId)
                ->value('organization_id');
        }

        if ($organisationId === null) {
            return null;
        }

        $organisation = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $organisationId)
            ->whereIn('status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES)
            ->first(['id', 'name']);

        return $organisation ? ['id' => (int) $organisation->id, 'name' => (string) $organisation->name] : null;
    }

    /**
     * Validate an admin-supplied organisation for a campaign. Empty means "the
     * whole community"; anything else must be a public organisation in this
     * community.
     *
     * @return array{id:int,name:string}|null
     * @throws \InvalidArgumentException
     */
    private static function organisationFromInput(mixed $value, int $tenantId): ?array
    {
        if ($value === null || $value === '' || $value === 0 || $value === '0') {
            return null;
        }
        if (!is_numeric($value) || (int) $value < 1) {
            throw new \InvalidArgumentException(__('api.organization_not_found'));
        }

        $organisation = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $value)
            ->whereIn('status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES)
            ->first(['id', 'name']);

        if (!$organisation) {
            throw new \InvalidArgumentException(__('api.organization_not_found'));
        }

        return ['id' => (int) $organisation->id, 'name' => (string) $organisation->name];
    }

    /**
     * Names for a set of organisation ids, in ONE tenant-scoped query. Names
     * are shown whatever the organisation's current status: a past gift still
     * went to that organisation.
     *
     * @param iterable<mixed> $ids
     * @return array<int, string>
     */
    private static function organisationNames(iterable $ids): array
    {
        $ids = collect($ids)->filter()->map(fn ($id) => (int) $id)->unique()->values();
        if ($ids->isEmpty()) {
            return [];
        }

        return DB::table('vol_organizations')
            ->where('tenant_id', TenantContext::getId())
            ->whereIn('id', $ids->all())
            ->pluck('name', 'id')
            ->mapWithKeys(fn ($name, $id) => [(int) $id => (string) $name])
            ->all();
    }

    /**
     * @param array<string, mixed> $day
     * @param array<int, string>   $organisationNames
     * @return array<string, mixed>
     */
    private static function withOrganisationName(array $day, array $organisationNames): array
    {
        $orgId = isset($day['organization_id']) ? (int) $day['organization_id'] : null;
        $day['organization_id'] = $orgId;
        $day['organization_name'] = $orgId !== null ? ($organisationNames[$orgId] ?? null) : null;

        return $day;
    }

    /**
     * vol_giving_days.updated_at / updated_by, schema-guarded like the
     * organisation column.
     *
     * @return array<int, string>
     */
    private static function updatedColumns(): array
    {
        static $present = null;
        $present ??= Schema::hasColumn('vol_giving_days', 'updated_at');

        return $present ? ['updated_at', 'updated_by'] : [];
    }

    /**
     * The organisation column, schema-guarded like the routing columns so the
     * code stays safe on a database that has not run the migration yet.
     *
     * @return array<int, string>
     */
    private static function organisationColumn(string $table): array
    {
        static $present = [];
        $present[$table] ??= Schema::hasColumn($table, 'organization_id');

        return $present[$table] ? ['organization_id'] : [];
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
