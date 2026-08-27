<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;

class CaringRegionalPointService
{
    private const PREFIX = 'caring_community.regional_points.';
    private const MAX_POINTS_PER_REDEMPTION = 100000.0;

    private const DEFAULTS = [
        'enabled' => false,
        'label' => '',
        'symbol' => 'pts',
        'auto_issue_enabled' => false,
        'points_per_approved_hour' => 0,
        'member_transfers_enabled' => false,
        'marketplace_redemption_enabled' => false,
    ];

    private const TYPES = [
        'enabled' => 'boolean',
        'label' => 'string',
        'symbol' => 'string',
        'auto_issue_enabled' => 'boolean',
        'points_per_approved_hour' => 'float',
        'member_transfers_enabled' => 'boolean',
        'marketplace_redemption_enabled' => 'boolean',
    ];

    public function isEnabled(?int $tenantId = null): bool
    {
        $tenantId ??= TenantContext::getId();

        return $this->tenantHasCaringFeature($tenantId)
            && Schema::hasTable('caring_regional_point_accounts')
            && Schema::hasTable('caring_regional_point_transactions')
            && (bool) $this->getConfig($tenantId)['enabled'];
    }

    public function getConfig(int $tenantId): array
    {
        if (!Schema::hasTable('tenant_settings')) {
            return $this->withDisplayMetadata(self::DEFAULTS);
        }

        $rows = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->whereIn('setting_key', array_map(
                fn (string $key): string => self::PREFIX . $key,
                array_keys(self::DEFAULTS)
            ))
            ->pluck('setting_value', 'setting_key')
            ->all();

        $config = self::DEFAULTS;
        foreach (self::DEFAULTS as $key => $default) {
            $settingKey = self::PREFIX . $key;
            if (array_key_exists($settingKey, $rows)) {
                $config[$key] = $this->castValue($rows[$settingKey], self::TYPES[$key], $default);
            }
        }

        return $this->withDisplayMetadata($this->normaliseConfig($config));
    }

    public function updateConfig(int $tenantId, array $input): array
    {
        $config = $this->normaliseConfig(array_merge(
            array_intersect_key($this->getConfig($tenantId), self::DEFAULTS),
            array_intersect_key($input, self::DEFAULTS)
        ));

        if (!Schema::hasTable('tenant_settings')) {
            return $this->withDisplayMetadata($config);
        }

        foreach (self::DEFAULTS as $key => $_default) {
            $value = $config[$key];
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $tenantId, 'setting_key' => self::PREFIX . $key],
                [
                    'setting_value' => $this->serialiseValue($value),
                    'setting_type' => self::TYPES[$key],
                    'category' => 'caring_community',
                    'description' => 'Caring community regional points setting.',
                    'updated_by' => Auth::id(),
                    'updated_at' => now(),
                ]
            );
        }

        return $this->getConfig($tenantId);
    }

    public function memberSummary(int $userId): array
    {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);

        $account = $this->ensureAccount($tenantId, $userId);

        return [
            'enabled' => true,
            'config' => $this->publicConfig($tenantId),
            'account' => [
                'user_id' => $userId,
                'balance' => round((float) $account->balance, 2),
                'lifetime_earned' => round((float) $account->lifetime_earned, 2),
                'lifetime_spent' => round((float) $account->lifetime_spent, 2),
            ],
        ];
    }

    public function memberHistory(int $userId, int $limit = 50): array
    {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);

        $limit = max(1, min(200, $limit));
        $this->ensureAccount($tenantId, $userId);

        return DB::table('caring_regional_point_transactions')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn ($row): array => $this->formatTransaction($row))
            ->all();
    }

    public function tenantLedger(int $limit = 100): array
    {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);

        $limit = max(1, min(500, $limit));

        return DB::table('caring_regional_point_transactions as t')
            ->leftJoin('users as u', function ($join) {
                $join->on('u.id', '=', 't.user_id')
                    ->on('u.tenant_id', '=', 't.tenant_id');
            })
            ->leftJoin('users as actor', function ($join) {
                $join->on('actor.id', '=', 't.actor_user_id')
                    ->on('actor.tenant_id', '=', 't.tenant_id');
            })
            ->where('t.tenant_id', $tenantId)
            ->orderByDesc('t.created_at')
            ->orderByDesc('t.id')
            ->limit($limit)
            ->select([
                't.*',
                'u.name as user_name',
                'u.first_name as user_first_name',
                'u.last_name as user_last_name', 'u.profile_type as user_profile_type', 'u.organization_name as user_organization_name',
                'u.email as user_email',
                'actor.name as actor_name',
                'actor.first_name as actor_first_name',
                'actor.last_name as actor_last_name', 'actor.profile_type as actor_profile_type', 'actor.organization_name as actor_organization_name',
            ])
            ->get()
            ->map(fn ($row): array => $this->formatTransaction($row) + [
                'user_name' => $this->displayName($row, 'user'),
                'user_email' => $row->user_email,
                'actor_name' => $this->displayName($row, 'actor'),
            ])
            ->all();
    }

    public function tenantStats(): array
    {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);

        $accounts = DB::table('caring_regional_point_accounts')
            ->where('tenant_id', $tenantId);

        $issued = DB::table('caring_regional_point_transactions')
            ->where('tenant_id', $tenantId)
            ->where('direction', 'credit')
            ->sum('points');

        $spent = DB::table('caring_regional_point_transactions')
            ->where('tenant_id', $tenantId)
            ->where('direction', 'debit')
            ->sum('points');

        return [
            'accounts_count' => (int) (clone $accounts)->count(),
            'circulating_points' => round((float) (clone $accounts)->sum('balance'), 2),
            'total_issued' => round((float) $issued, 2),
            'total_spent' => round((float) $spent, 2),
        ];
    }

    public function issue(int $userId, float $points, string $description, int $actorId): array
    {
        return $this->credit(
            userId: $userId,
            points: $points,
            type: 'admin_issue',
            description: $description,
            actorId: $actorId
        );
    }

    public function adjust(int $userId, float $pointsDelta, string $description, int $actorId): array
    {
        if ($pointsDelta === 0.0) {
            throw new InvalidArgumentException(__('api.caring_regional_points_nonzero'));
        }

        if ($pointsDelta > 0) {
            return $this->credit($userId, $pointsDelta, 'admin_adjustment', $description, $actorId);
        }

        return $this->debit($userId, abs($pointsDelta), 'admin_adjustment', $description, $actorId);
    }

    public function awardForApprovedHours(
        int $tenantId,
        int $userId,
        int $volLogId,
        float $hours,
        ?int $actorId = null
    ): ?array {
        $config = $this->getConfig($tenantId);
        if (
            !$this->isEnabled($tenantId)
            || !(bool) $config['auto_issue_enabled']
            || (float) $config['points_per_approved_hour'] <= 0
            || $hours <= 0
            || $volLogId <= 0
        ) {
            return null;
        }

        $points = $this->normalisePoints(round($hours * (float) $config['points_per_approved_hour'], 2));
        $this->assertTenantUser($tenantId, $userId);

        return DB::transaction(function () use ($tenantId, $userId, $volLogId, $hours, $points, $actorId): ?array {
            $existing = DB::table('caring_regional_point_transactions')
                ->where('tenant_id', $tenantId)
                ->where('reference_type', 'vol_log')
                ->where('reference_id', $volLogId)
                ->where('type', 'earned_for_hours')
                ->lockForUpdate()
                ->first();

            if ($existing) {
                return [
                    'transaction_id' => (int) $existing->id,
                    'user_id' => $userId,
                    'points' => round((float) $existing->points, 2),
                    'balance' => round((float) $existing->balance_after, 2),
                    'already_awarded' => true,
                ];
            }

            $account = $this->lockAccount($tenantId, $userId);
            $newBalance = round((float) $account->balance + $points, 2);

            DB::table('caring_regional_point_accounts')
                ->where('id', $account->id)
                ->update([
                    'balance' => $newBalance,
                    'lifetime_earned' => round((float) $account->lifetime_earned + $points, 2),
                    'updated_at' => now(),
                ]);

            $transactionId = $this->insertTransaction(
                tenantId: $tenantId,
                accountId: (int) $account->id,
                userId: $userId,
                actorId: $actorId,
                type: 'earned_for_hours',
                direction: 'credit',
                points: $points,
                balanceAfter: $newBalance,
                description: __('api.caring_regional_points_hours_award', ['hours' => round($hours, 2)]),
                referenceType: 'vol_log',
                referenceId: $volLogId,
                metadata: ['hours' => round($hours, 2)]
            );

            return [
                'transaction_id' => $transactionId,
                'user_id' => $userId,
                'points' => $points,
                'balance' => $newBalance,
                'already_awarded' => false,
            ];
        });
    }

    /**
     * Reverse any auto-issued regional points previously awarded for a vol_log
     * whose status has changed away from `approved`. Idempotent: a vol_log that
     * already has a recorded reversal is a no-op.
     *
     * Creates a `vol_log_reversal` debit transaction for each prior
     * `earned_for_hours` credit on the same vol_log_id. The member's balance is
     * decremented even if it would go negative — they may have already spent
     * the points, in which case we don't claw back from third parties; the
     * negative balance is logged and surfaces to the coordinator.
     *
     * Tenant-scoped via TenantContext::getId(); operates inside a DB
     * transaction with lockForUpdate on the account row.
     *
     * @param int    $volLogId  The vol_log whose points should be reversed.
     * @param string $reason    Audit reason (status transition description).
     *
     * @return bool True if at least one reversal transaction was created.
     */
    public function reverseFromVolLog(int $volLogId, string $reason): bool
    {
        if ($volLogId <= 0) {
            return false;
        }

        if (!Schema::hasTable('caring_regional_point_transactions')
            || !Schema::hasTable('caring_regional_point_accounts')
        ) {
            return false;
        }

        $tenantId = TenantContext::getId();
        if ($tenantId <= 0) {
            return false;
        }

        return DB::transaction(function () use ($tenantId, $volLogId, $reason): bool {
            // Find prior auto-issue transactions for this vol_log that have not
            // already been reversed.
            $originalIssues = DB::table('caring_regional_point_transactions')
                ->where('tenant_id', $tenantId)
                ->where('reference_type', 'vol_log')
                ->where('reference_id', $volLogId)
                ->where('type', 'earned_for_hours')
                ->where('direction', 'credit')
                ->lockForUpdate()
                ->get();

            if ($originalIssues->isEmpty()) {
                return false;
            }

            // Skip any issues that already have a matching reversal.
            $alreadyReversedIds = DB::table('caring_regional_point_transactions')
                ->where('tenant_id', $tenantId)
                ->where('reference_type', 'vol_log_reversal')
                ->where('reference_id', $volLogId)
                ->lockForUpdate()
                ->pluck('metadata')
                ->map(function ($meta) {
                    if (!is_string($meta) || $meta === '') {
                        return null;
                    }
                    $decoded = json_decode($meta, true);
                    return is_array($decoded) ? ($decoded['original_transaction_id'] ?? null) : null;
                })
                ->filter()
                ->map(fn ($v): int => (int) $v)
                ->all();

            $createdAny = false;

            foreach ($originalIssues as $issue) {
                $issueId = (int) $issue->id;
                if (in_array($issueId, $alreadyReversedIds, true)) {
                    continue;
                }

                $userId = (int) $issue->user_id;
                $points = round((float) $issue->points, 2);
                if ($points <= 0 || $userId <= 0) {
                    continue;
                }

                $account = DB::table('caring_regional_point_accounts')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->lockForUpdate()
                    ->first();

                if (!$account) {
                    continue;
                }

                $currentBalance = (float) $account->balance;
                $newBalance = round($currentBalance - $points, 2);

                if ($newBalance < 0) {
                    \Illuminate\Support\Facades\Log::warning(
                        'caring_regional_points.vol_log_reversal_negative_balance',
                        [
                            'tenant_id'      => $tenantId,
                            'user_id'        => $userId,
                            'vol_log_id'     => $volLogId,
                            'original_id'    => $issueId,
                            'points'         => $points,
                            'prior_balance'  => $currentBalance,
                            'new_balance'    => $newBalance,
                            'reason'         => $reason,
                        ]
                    );
                }

                DB::table('caring_regional_point_accounts')
                    ->where('id', $account->id)
                    ->update([
                        'balance'         => $newBalance,
                        'lifetime_earned' => max(0.0, round((float) $account->lifetime_earned - $points, 2)),
                        'updated_at'      => now(),
                    ]);

                $description = mb_substr(
                    'Regional points reversed: ' . trim($reason),
                    0,
                    500
                );

                $this->insertTransaction(
                    tenantId: $tenantId,
                    accountId: (int) $account->id,
                    userId: $userId,
                    actorId: null,
                    type: 'reversal',
                    direction: 'debit',
                    points: $points,
                    balanceAfter: $newBalance,
                    description: $description,
                    referenceType: 'vol_log_reversal',
                    referenceId: $volLogId,
                    metadata: [
                        'original_transaction_id' => $issueId,
                        'reason'                  => mb_substr(trim($reason), 0, 500),
                    ]
                );

                $createdAny = true;
            }

            return $createdAny;
        });
    }

    public function transferBetweenMembers(int $senderId, int $recipientId, float $points, ?string $message = null): array
    {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig($tenantId);
        $this->assertEnabled($tenantId);

        if (!(bool) $config['member_transfers_enabled']) {
            throw new RuntimeException(__('api.caring_regional_points_transfers_disabled'));
        }
        if ($senderId === $recipientId) {
            throw new InvalidArgumentException(__('api.caring_regional_points_transfer_self'));
        }

        $points = $this->normalisePoints($points);
        $this->assertTenantUser($tenantId, $senderId);
        $this->assertTenantUser($tenantId, $recipientId);
        app(\App\Services\SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $senderId,
            $recipientId,
            $tenantId,
            'caring_regional_point_transfer',
        );

        return DB::transaction(function () use ($tenantId, $senderId, $recipientId, $points, $message): array {
            $this->ensureAccount($tenantId, $senderId);
            $this->ensureAccount($tenantId, $recipientId);

            $lockedAccounts = DB::table('caring_regional_point_accounts')
                ->where('tenant_id', $tenantId)
                ->whereIn('user_id', [$senderId, $recipientId])
                ->orderBy('user_id')
                ->lockForUpdate()
                ->get()
                ->keyBy('user_id');

            $senderAccount = $lockedAccounts->get($senderId);
            $recipientAccount = $lockedAccounts->get($recipientId);
            if (!$senderAccount || !$recipientAccount) {
                throw new RuntimeException(__('api.user_not_found'));
            }

            $senderBalance = (float) $senderAccount->balance;
            if ($senderBalance < $points) {
                throw new RuntimeException(__('api.caring_regional_points_insufficient'));
            }

            $senderNewBalance = round($senderBalance - $points, 2);
            $recipientNewBalance = round((float) $recipientAccount->balance + $points, 2);
            $cleanMessage = trim((string) $message);
            $description = $cleanMessage !== ''
                ? mb_substr($cleanMessage, 0, 500)
                : __('api.caring_regional_points_member_transfer');

            DB::table('caring_regional_point_accounts')
                ->where('id', $senderAccount->id)
                ->update([
                    'balance' => $senderNewBalance,
                    'lifetime_spent' => round((float) $senderAccount->lifetime_spent + $points, 2),
                    'updated_at' => now(),
                ]);

            DB::table('caring_regional_point_accounts')
                ->where('id', $recipientAccount->id)
                ->update([
                    'balance' => $recipientNewBalance,
                    'lifetime_earned' => round((float) $recipientAccount->lifetime_earned + $points, 2),
                    'updated_at' => now(),
                ]);

            $debitId = $this->insertTransaction(
                tenantId: $tenantId,
                accountId: (int) $senderAccount->id,
                userId: $senderId,
                actorId: $senderId,
                type: 'transfer_out',
                direction: 'debit',
                points: $points,
                balanceAfter: $senderNewBalance,
                description: $description,
                metadata: ['recipient_user_id' => $recipientId]
            );

            $creditId = $this->insertTransaction(
                tenantId: $tenantId,
                accountId: (int) $recipientAccount->id,
                userId: $recipientId,
                actorId: $senderId,
                type: 'transfer_in',
                direction: 'credit',
                points: $points,
                balanceAfter: $recipientNewBalance,
                description: $description,
                referenceType: 'regional_point_transfer',
                referenceId: $debitId,
                metadata: ['sender_user_id' => $senderId]
            );

            DB::table('caring_regional_point_transactions')
                ->where('id', $debitId)
                ->update([
                    'reference_type' => 'regional_point_transfer',
                    'reference_id' => $creditId,
                ]);

            return [
                'sender_transaction_id' => $debitId,
                'recipient_transaction_id' => $creditId,
                'sender_user_id' => $senderId,
                'recipient_user_id' => $recipientId,
                'points' => $points,
                'sender_balance' => $senderNewBalance,
                'recipient_balance' => $recipientNewBalance,
            ];
        });
    }

    public function calculateMarketplaceDiscount(int $memberId, int $sellerId, ?int $listingId, float $orderTotalChf): array
    {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig($tenantId);

        $base = [
            'accepts' => false,
            'member_points' => 0.0,
            'regional_points_per_chf' => 0.0,
            'max_discount_pct' => 0,
            'max_points_usable' => 0.0,
            'max_discount_chf' => 0.0,
        ];

        if (!$this->isEnabled($tenantId) || !(bool) $config['marketplace_redemption_enabled']) {
            return $base + ['reason' => 'feature_disabled'];
        }

        if (!Schema::hasTable('marketplace_seller_regional_point_settings')) {
            return $base + ['reason' => 'feature_unavailable'];
        }

        if ($orderTotalChf <= 0) {
            return $base + ['reason' => 'invalid_order_total'];
        }

        if (!$this->tenantUserExists($tenantId, $memberId) || !$this->tenantUserExists($tenantId, $sellerId)) {
            return $base + ['reason' => 'member_or_seller_unavailable'];
        }

        if ($listingId !== null && !$this->marketplaceListingBelongsToSeller($tenantId, $listingId, $sellerId)) {
            return $base + ['reason' => 'listing_unavailable'];
        }

        $settings = DB::table('marketplace_seller_regional_point_settings')
            ->where('tenant_id', $tenantId)
            ->where('seller_user_id', $sellerId)
            ->first();

        if (!$settings || !(int) $settings->accepts_regional_points) {
            return $base + ['reason' => 'merchant_disabled'];
        }

        $pointsPerChf = (float) $settings->regional_points_per_chf;
        $maxPct = (int) $settings->regional_points_max_discount_pct;
        if ($pointsPerChf <= 0 || $maxPct <= 0) {
            return $base + ['reason' => 'merchant_misconfigured'];
        }

        $account = $this->ensureAccount($tenantId, $memberId);
        $memberPoints = round((float) $account->balance, 2);
        $maxDiscountChf = round(($orderTotalChf * $maxPct) / 100, 2);
        $maxPointsByPolicy = round($maxDiscountChf * $pointsPerChf, 2);
        $maxPointsUsable = max(0.0, round(min($memberPoints, $maxPointsByPolicy, self::MAX_POINTS_PER_REDEMPTION), 2));
        $effectiveDiscountChf = round($maxPointsUsable / $pointsPerChf, 2);

        return [
            'accepts' => true,
            'member_points' => $memberPoints,
            'regional_points_per_chf' => round($pointsPerChf, 2),
            'max_discount_pct' => $maxPct,
            'max_points_usable' => $maxPointsUsable,
            'max_discount_chf' => $effectiveDiscountChf,
        ];
    }

    public function redeemForMarketplaceDiscount(
        int $memberId,
        int $sellerId,
        ?int $listingId,
        float $pointsToUse,
        float $orderTotalChf
    ): array {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig($tenantId);
        $this->assertEnabled($tenantId);

        if (!(bool) $config['marketplace_redemption_enabled']) {
            throw new RuntimeException(__('api.caring_regional_points_marketplace_disabled'));
        }
        if (!Schema::hasTable('marketplace_seller_regional_point_settings')) {
            throw new RuntimeException(__('api.caring_regional_points_marketplace_unavailable'));
        }
        if ($memberId === $sellerId) {
            throw new RuntimeException(__('api.caring_regional_points_marketplace_self'));
        }
        if ($orderTotalChf <= 0) {
            throw new InvalidArgumentException(__('api.caring_regional_points_order_total_positive'));
        }

        $pointsToUse = $this->normalisePoints($pointsToUse);
        if ($pointsToUse > self::MAX_POINTS_PER_REDEMPTION) {
            throw new InvalidArgumentException(__('api.caring_regional_points_redemption_too_many'));
        }

        $this->assertTenantUser($tenantId, $memberId);
        $this->assertTenantUser($tenantId, $sellerId);
        if ($listingId !== null && !$this->marketplaceListingBelongsToSeller($tenantId, $listingId, $sellerId)) {
            throw new RuntimeException(__('api.caring_regional_points_listing_unavailable'));
        }

        return DB::transaction(function () use ($tenantId, $memberId, $sellerId, $listingId, $pointsToUse, $orderTotalChf): array {
            $settings = DB::table('marketplace_seller_regional_point_settings')
                ->where('tenant_id', $tenantId)
                ->where('seller_user_id', $sellerId)
                ->lockForUpdate()
                ->first();

            if (!$settings || !(int) $settings->accepts_regional_points) {
                throw new RuntimeException(__('api.caring_regional_points_merchant_disabled'));
            }

            $pointsPerChf = (float) $settings->regional_points_per_chf;
            $maxPct = (int) $settings->regional_points_max_discount_pct;
            if ($pointsPerChf <= 0 || $maxPct <= 0) {
                throw new RuntimeException(__('api.caring_regional_points_merchant_invalid'));
            }

            $discountChf = round($pointsToUse / $pointsPerChf, 2);
            $maxDiscountChf = round(($orderTotalChf * $maxPct) / 100, 2);
            if ($discountChf > $maxDiscountChf + 0.005) {
                throw new RuntimeException(__('api.caring_regional_points_discount_too_large'));
            }

            $account = $this->lockAccount($tenantId, $memberId);
            $currentBalance = (float) $account->balance;
            if ($currentBalance < $pointsToUse) {
                throw new RuntimeException(__('api.caring_regional_points_insufficient'));
            }

            $newBalance = round($currentBalance - $pointsToUse, 2);
            DB::table('caring_regional_point_accounts')
                ->where('id', $account->id)
                ->update([
                    'balance' => $newBalance,
                    'lifetime_spent' => round((float) $account->lifetime_spent + $pointsToUse, 2),
                    'updated_at' => now(),
                ]);

            $transactionId = $this->insertTransaction(
                tenantId: $tenantId,
                accountId: (int) $account->id,
                userId: $memberId,
                actorId: $memberId,
                type: 'redemption',
                direction: 'debit',
                points: $pointsToUse,
                balanceAfter: $newBalance,
                description: __('api.caring_regional_points_marketplace_redemption'),
                referenceType: $listingId !== null ? 'marketplace_listing' : 'marketplace_seller',
                referenceId: $listingId ?? $sellerId,
                metadata: [
                    'seller_user_id' => $sellerId,
                    'marketplace_listing_id' => $listingId,
                    'order_total_chf' => round($orderTotalChf, 2),
                    'discount_chf' => $discountChf,
                    'regional_points_per_chf' => round($pointsPerChf, 2),
                    'max_discount_pct' => $maxPct,
                ]
            );

            return [
                'transaction_id' => $transactionId,
                'seller_user_id' => $sellerId,
                'marketplace_listing_id' => $listingId,
                'points_used' => $pointsToUse,
                'discount_chf' => $discountChf,
                'new_regional_point_balance' => $newBalance,
            ];
        });
    }

    public function getMarketplaceSellerSettings(int $sellerId): array
    {
        $tenantId = TenantContext::getId();
        $defaults = [
            'seller_user_id' => $sellerId,
            'accepts_regional_points' => false,
            'regional_points_per_chf' => 10.0,
            'regional_points_max_discount_pct' => 25,
        ];

        if (!Schema::hasTable('marketplace_seller_regional_point_settings')) {
            return $defaults;
        }

        $row = DB::table('marketplace_seller_regional_point_settings')
            ->where('tenant_id', $tenantId)
            ->where('seller_user_id', $sellerId)
            ->first();

        if (!$row) {
            return $defaults;
        }

        return [
            'seller_user_id' => (int) $row->seller_user_id,
            'accepts_regional_points' => (bool) $row->accepts_regional_points,
            'regional_points_per_chf' => round((float) $row->regional_points_per_chf, 2),
            'regional_points_max_discount_pct' => (int) $row->regional_points_max_discount_pct,
        ];
    }

    public function updateMarketplaceSellerSettings(
        int $sellerId,
        bool $acceptsRegionalPoints,
        float $pointsPerChf,
        int $maxDiscountPct
    ): array {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);

        if (!Schema::hasTable('marketplace_seller_regional_point_settings')) {
            throw new RuntimeException(__('api.caring_regional_points_marketplace_unavailable'));
        }

        $this->assertTenantUser($tenantId, $sellerId);
        $pointsPerChf = round($pointsPerChf, 2);
        if ($pointsPerChf <= 0 || $pointsPerChf > 100000) {
            throw new InvalidArgumentException(__('api.caring_regional_points_per_chf_invalid'));
        }
        if ($maxDiscountPct < 1 || $maxDiscountPct > 100) {
            throw new InvalidArgumentException(__('api.caring_regional_points_discount_pct_invalid'));
        }

        DB::table('marketplace_seller_regional_point_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'seller_user_id' => $sellerId],
            [
                'accepts_regional_points' => $acceptsRegionalPoints,
                'regional_points_per_chf' => $pointsPerChf,
                'regional_points_max_discount_pct' => $maxDiscountPct,
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );

        return $this->getMarketplaceSellerSettings($sellerId);
    }

    public function publicConfig(int $tenantId): array
    {
        $config = $this->getConfig($tenantId);

        return [
            'label' => $config['label'],
            'label_code' => $config['label_code'],
            'symbol' => $config['symbol'],
            'member_transfers_enabled' => $config['member_transfers_enabled'],
            'marketplace_redemption_enabled' => $config['marketplace_redemption_enabled'],
        ];
    }

    private function credit(int $userId, float $points, string $type, string $description, int $actorId): array
    {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);
        $points = $this->normalisePoints($points);
        $this->assertTenantUser($tenantId, $userId);

        return DB::transaction(function () use ($tenantId, $userId, $points, $type, $description, $actorId): array {
            $account = $this->lockAccount($tenantId, $userId);
            $newBalance = round((float) $account->balance + $points, 2);

            DB::table('caring_regional_point_accounts')
                ->where('id', $account->id)
                ->update([
                    'balance' => $newBalance,
                    'lifetime_earned' => round((float) $account->lifetime_earned + $points, 2),
                    'updated_at' => now(),
                ]);

            $transactionId = $this->insertTransaction(
                tenantId: $tenantId,
                accountId: (int) $account->id,
                userId: $userId,
                actorId: $actorId,
                type: $type,
                direction: 'credit',
                points: $points,
                balanceAfter: $newBalance,
                description: $description
            );

            return [
                'transaction_id' => $transactionId,
                'user_id' => $userId,
                'points' => $points,
                'balance' => $newBalance,
            ];
        });
    }

    private function debit(int $userId, float $points, string $type, string $description, int $actorId): array
    {
        $tenantId = TenantContext::getId();
        $this->assertEnabled($tenantId);
        $points = $this->normalisePoints($points);
        $this->assertTenantUser($tenantId, $userId);

        return DB::transaction(function () use ($tenantId, $userId, $points, $type, $description, $actorId): array {
            $account = $this->lockAccount($tenantId, $userId);
            $currentBalance = (float) $account->balance;
            if ($currentBalance < $points) {
                throw new RuntimeException(__('api.caring_regional_points_insufficient'));
            }

            $newBalance = round($currentBalance - $points, 2);

            DB::table('caring_regional_point_accounts')
                ->where('id', $account->id)
                ->update([
                    'balance' => $newBalance,
                    'lifetime_spent' => round((float) $account->lifetime_spent + $points, 2),
                    'updated_at' => now(),
                ]);

            $transactionId = $this->insertTransaction(
                tenantId: $tenantId,
                accountId: (int) $account->id,
                userId: $userId,
                actorId: $actorId,
                type: $type,
                direction: 'debit',
                points: $points,
                balanceAfter: $newBalance,
                description: $description
            );

            return [
                'transaction_id' => $transactionId,
                'user_id' => $userId,
                'points' => -$points,
                'balance' => $newBalance,
            ];
        });
    }

    private function ensureAccount(int $tenantId, int $userId): object
    {
        $this->assertTenantUser($tenantId, $userId);

        $existing = DB::table('caring_regional_point_accounts')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if ($existing) {
            return $existing;
        }

        DB::table('caring_regional_point_accounts')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'balance' => 0,
            'lifetime_earned' => 0,
            'lifetime_spent' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('caring_regional_point_accounts')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();
    }

    private function lockAccount(int $tenantId, int $userId): object
    {
        $this->ensureAccount($tenantId, $userId);

        return DB::table('caring_regional_point_accounts')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->lockForUpdate()
            ->first();
    }

    private function insertTransaction(
        int $tenantId,
        int $accountId,
        int $userId,
        ?int $actorId,
        string $type,
        string $direction,
        float $points,
        float $balanceAfter,
        string $description,
        ?string $referenceType = null,
        ?int $referenceId = null,
        ?array $metadata = null,
    ): int {
        return (int) DB::table('caring_regional_point_transactions')->insertGetId([
            'tenant_id' => $tenantId,
            'account_id' => $accountId,
            'user_id' => $userId,
            'actor_user_id' => $actorId > 0 ? $actorId : null,
            'type' => $type,
            'direction' => $direction,
            'points' => $points,
            'balance_after' => $balanceAfter,
            'reference_type' => $referenceType,
            'reference_id' => $referenceId,
            'description' => trim($description) !== '' ? mb_substr(trim($description), 0, 500) : null,
            'metadata' => $metadata !== null ? json_encode($metadata) : null,
            'created_at' => now(),
        ]);
    }

    private function assertEnabled(int $tenantId): void
    {
        if (!$this->isEnabled($tenantId)) {
            throw new RuntimeException(__('api.caring_regional_points_disabled'));
        }
    }

    private function tenantHasCaringFeature(int $tenantId): bool
    {
        $featuresJson = DB::table('tenants')->where('id', $tenantId)->value('features');
        $features = is_string($featuresJson) && $featuresJson !== ''
            ? json_decode($featuresJson, true)
            : [];

        if (!is_array($features)) {
            $features = [];
        }

        return array_key_exists('caring_community', $features)
            ? (bool) $features['caring_community']
            : false;
    }

    private function assertTenantUser(int $tenantId, int $userId): void
    {
        if ($userId <= 0) {
            throw new InvalidArgumentException(__('api.user_not_found'));
        }

        if (!$this->tenantUserExists($tenantId, $userId)) {
            throw new InvalidArgumentException(__('api.user_not_found'));
        }
    }

    private function tenantUserExists(int $tenantId, int $userId): bool
    {
        if ($userId <= 0) {
            return false;
        }

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->exists();
    }

    private function marketplaceListingBelongsToSeller(int $tenantId, int $listingId, int $sellerId): bool
    {
        if ($listingId <= 0 || !Schema::hasTable('marketplace_listings')) {
            return false;
        }

        return DB::table('marketplace_listings')
            ->where('tenant_id', $tenantId)
            ->where('id', $listingId)
            ->where('user_id', $sellerId)
            ->exists();
    }

    private function normaliseConfig(array $config): array
    {
        $config['enabled'] = (bool) $config['enabled'];
        $config['label'] = trim((string) $config['label']) !== '' ? mb_substr(trim((string) $config['label']), 0, 80) : '';
        $config['symbol'] = trim((string) $config['symbol']) !== '' ? mb_substr(trim((string) $config['symbol']), 0, 12) : self::DEFAULTS['symbol'];
        $config['auto_issue_enabled'] = (bool) $config['auto_issue_enabled'];
        $config['points_per_approved_hour'] = max(0.0, min(10000.0, round((float) $config['points_per_approved_hour'], 2)));
        $config['member_transfers_enabled'] = (bool) $config['member_transfers_enabled'];
        $config['marketplace_redemption_enabled'] = (bool) $config['marketplace_redemption_enabled'];

        if (!$config['enabled']) {
            $config['auto_issue_enabled'] = false;
            $config['member_transfers_enabled'] = false;
            $config['marketplace_redemption_enabled'] = false;
        }

        return $config;
    }

    private function withDisplayMetadata(array $config): array
    {
        $config['label_code'] = $config['label'] === '' ? 'default' : null;

        return $config;
    }

    private function normalisePoints(float $points): float
    {
        $points = round($points, 2);
        if ($points <= 0) {
            throw new InvalidArgumentException(__('api.caring_regional_points_positive'));
        }
        if ($points > 1000000) {
            throw new InvalidArgumentException(__('api.caring_regional_points_too_many'));
        }

        return $points;
    }

    private function castValue(mixed $value, string $type, mixed $default): mixed
    {
        if ($value === null) {
            return $default;
        }

        return match ($type) {
            'boolean' => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            'float' => (float) $value,
            default => (string) $value,
        };
    }

    private function serialiseValue(mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        return (string) $value;
    }

    private function formatTransaction(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'user_id' => (int) $row->user_id,
            'actor_user_id' => $row->actor_user_id !== null ? (int) $row->actor_user_id : null,
            'type' => (string) $row->type,
            'direction' => (string) $row->direction,
            'points' => round((float) $row->points, 2),
            'balance_after' => round((float) $row->balance_after, 2),
            'description' => $row->description,
            'created_at' => $row->created_at,
        ];
    }

    private function displayName(object $row, string $prefix): ?string
    {
        $name = $row->{$prefix . '_name'} ?? null;
        if (is_string($name) && trim($name) !== '') {
            return $name;
        }

        $first = trim((string) ($row->{$prefix . '_first_name'} ?? ''));
        $last = trim((string) ($row->{$prefix . '_last_name'} ?? ''));
        $full = trim($first . ' ' . $last);

        return $full !== '' ? $full : null;
    }
}
