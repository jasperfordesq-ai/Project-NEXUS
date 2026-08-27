<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\CommunityFundAccount;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * CommunityFundService — Eloquent/DB query builder service for the community fund.
 *
 * Manages the community fund: a special system account per tenant that holds
 * community-owned time credits. Supports admin deposit/withdraw, member donations,
 * and transaction audit trails.
 */
class CommunityFundService
{
    /**
     * Get or create the community fund for the current tenant.
     */
    public static function getOrCreateFund(): array
    {
        $tenantId = TenantContext::getId();

        $fund = CommunityFundAccount::first();

        if ($fund) {
            return $fund->toArray();
        }

        // Auto-create. Guard against a concurrent first-creation race: the table
        // has a UNIQUE(tenant_id) constraint, so two simultaneous first-time
        // operations (e.g. two donations) would otherwise throw an uncaught 500.
        try {
            $fund = CommunityFundAccount::create([
                'balance' => 0.00,
                'description' => 'Community time credit fund',
            ]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            $existing = CommunityFundAccount::first();
            if ($existing) {
                return $existing->toArray();
            }
            throw $e;
        }

        return [
            'id' => $fund->id,
            'tenant_id' => $tenantId,
            'balance' => 0.00,
            'total_deposited' => 0.00,
            'total_withdrawn' => 0.00,
            'total_donated' => 0.00,
            'description' => 'Community time credit fund',
        ];
    }

    /**
     * Get fund balance and statistics.
     */
    public static function getBalance(): array
    {
        $fund = self::getOrCreateFund();

        return [
            'id' => (int) $fund['id'],
            'balance' => (float) $fund['balance'],
            'total_deposited' => (float) ($fund['total_deposited'] ?? 0),
            'total_withdrawn' => (float) ($fund['total_withdrawn'] ?? 0),
            'total_donated' => (float) ($fund['total_donated'] ?? 0),
            'description' => $fund['description'] ?? '',
        ];
    }

    /**
     * Admin deposits credits into the community fund.
     */
    public static function adminDeposit(int $adminId, float $amount, string $description = ''): array
    {
        if ($amount <= 0) {
            return ['success' => false, 'error' => __('api.amount_must_be_greater_than_0')];
        }

        $tenantId = TenantContext::getId();
        $fund = self::getOrCreateFund();

        DB::beginTransaction();
        try {
            // Lock fund row to get accurate balance_after value
            $lockedFund = DB::table('community_fund_accounts')
                ->where('id', $fund['id'])
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$lockedFund) {
                DB::rollBack();
                return ['success' => false, 'error' => __('api.community_fund_not_found')];
            }

            $newBalance = (float) $lockedFund->balance + $amount;

            DB::statement(
                'UPDATE community_fund_accounts SET balance = balance + ?, total_deposited = total_deposited + ? WHERE id = ? AND tenant_id = ?',
                [$amount, $amount, $fund['id'], $tenantId]
            );

            DB::table('community_fund_transactions')->insert([
                'tenant_id' => $tenantId,
                'fund_id' => $fund['id'],
                'user_id' => $adminId,
                'type' => 'deposit',
                'amount' => $amount,
                'balance_after' => $newBalance,
                'description' => $description ?: 'Admin deposit',
                'admin_id' => $adminId,
                'created_at' => now(),
            ]);

            DB::commit();

            return ['success' => true, 'balance' => $newBalance];
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('CommunityFundService::adminDeposit error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.deposit_failed')];
        }
    }

    /**
     * Admin withdraws credits from the community fund and grants to a member.
     */
    public static function adminWithdraw(int $adminId, int $recipientId, float $amount, string $description = ''): array
    {
        if ($amount <= 0) {
            return ['success' => false, 'error' => __('api.amount_must_be_greater_than_0')];
        }

        $tenantId = TenantContext::getId();
        $fund = self::getOrCreateFund();

        if ((float) $fund['balance'] < $amount) {
            return ['success' => false, 'error' => __('api.insufficient_community_fund_balance')];
        }

        DB::beginTransaction();
        try {
            // Re-read balance under lock to prevent TOCTOU race condition
            $lockedFund = DB::table('community_fund_accounts')
                ->where('id', $fund['id'])
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$lockedFund || (float) $lockedFund->balance < $amount) {
                DB::rollBack();
                return ['success' => false, 'error' => __('api.insufficient_community_fund_balance')];
            }

            $newBalance = (float) $lockedFund->balance - $amount;

            // Deduct from fund
            DB::statement(
                'UPDATE community_fund_accounts SET balance = balance - ?, total_withdrawn = total_withdrawn + ? WHERE id = ? AND tenant_id = ? AND balance >= ?',
                [$amount, $amount, $fund['id'], $tenantId, $amount]
            );

            // Credit the recipient user
            DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', $tenantId)
                ->increment('balance', $amount);

            // Log fund transaction
            DB::table('community_fund_transactions')->insert([
                'tenant_id' => $tenantId,
                'fund_id' => $fund['id'],
                'user_id' => $recipientId,
                'type' => 'withdrawal',
                'amount' => $amount,
                'balance_after' => $newBalance,
                'description' => $description ?: 'Admin grant to member',
                'admin_id' => $adminId,
                'created_at' => now(),
            ]);

            // Log wallet transaction for the recipient (sender_id is NULL — credits come from the fund, not a user)
            DB::table('transactions')->insert([
                'tenant_id' => $tenantId,
                'sender_id' => null,
                'receiver_id' => $recipientId,
                'amount' => $amount,
                'description' => $description ?: 'Community fund grant',
                'transaction_type' => 'community_fund',
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::commit();

            return ['success' => true, 'balance' => $newBalance];
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('CommunityFundService::adminWithdraw error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.withdrawal_failed')];
        }
    }

    /**
     * Get paginated community fund transactions for the current tenant.
     *
     * @param int $limit Max records to return
     * @param int $offset Offset for pagination
     * @return array{items: array, total: int}
     */
    public function getTransactions(int $limit = 20, int $offset = 0): array
    {
        $tenantId = TenantContext::getId();
        $fund = self::getOrCreateFund();

        $total = (int) DB::table('community_fund_transactions')
            ->where('tenant_id', $tenantId)
            ->where('fund_id', $fund['id'])
            ->count();

        $rows = DB::table('community_fund_transactions as cft')
            ->leftJoin('users as u', 'cft.user_id', '=', 'u.id')
            ->leftJoin('users as admin', 'cft.admin_id', '=', 'admin.id')
            ->where('cft.tenant_id', $tenantId)
            ->where('cft.fund_id', $fund['id'])
            ->orderByDesc('cft.created_at')
            ->offset($offset)
            ->limit($limit)
            ->select(
                'cft.id',
                'cft.type',
                'cft.amount',
                'cft.balance_after',
                'cft.description',
                'cft.user_id',
                'cft.admin_id',
                'cft.created_at',
                DB::raw(UserDisplayName::sql('u', 'user_name')),
                'u.avatar_url as user_avatar',
                DB::raw(UserDisplayName::sql('admin', 'admin_name'))
            )
            ->get();

        $items = $rows->map(function ($row) {
            return [
                'id' => (int) $row->id,
                'type' => $row->type,
                'amount' => round((float) $row->amount, 2),
                'balance_after' => round((float) $row->balance_after, 2),
                'description' => $row->description ?? '',
                'user_id' => $row->user_id ? (int) $row->user_id : null,
                'user_name' => trim($row->user_name ?? ''),
                'user_avatar' => $row->user_avatar ?? '',
                'admin_id' => $row->admin_id ? (int) $row->admin_id : null,
                'admin_name' => trim($row->admin_name ?? ''),
                'created_at' => $row->created_at,
            ];
        })->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Member donates credits to the community fund.
     */
    public static function receiveDonation(int $donorId, float $amount, string $message = ''): array
    {
        if ($amount <= 0) {
            return ['success' => false, 'error' => __('api.amount_must_be_greater_than_0')];
        }

        $tenantId = TenantContext::getId();
        $fund = self::getOrCreateFund();

        DB::beginTransaction();
        try {
            // Lock fund row to get accurate balance_after
            $lockedFund = DB::table('community_fund_accounts')
                ->where('id', $fund['id'])
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$lockedFund) {
                DB::rollBack();
                return ['success' => false, 'error' => __('api.community_fund_not_found')];
            }

            $newBalance = (float) $lockedFund->balance + $amount;

            // Atomic deduct from donor (WHERE balance >= amount prevents negative balance)
            $affected = DB::update(
                'UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND balance >= ?',
                [$amount, $donorId, $tenantId, $amount]
            );

            if ($affected === 0) {
                DB::rollBack();
                return ['success' => false, 'error' => __('api.insufficient_balance')];
            }

            // Credit community fund
            DB::statement(
                'UPDATE community_fund_accounts SET balance = balance + ?, total_donated = total_donated + ? WHERE id = ? AND tenant_id = ?',
                [$amount, $amount, $fund['id'], $tenantId]
            );

            // Log fund transaction
            DB::table('community_fund_transactions')->insert([
                'tenant_id' => $tenantId,
                'fund_id' => $fund['id'],
                'user_id' => $donorId,
                'type' => 'donation',
                'amount' => $amount,
                'balance_after' => $newBalance,
                'description' => $message ?: 'Member donation',
                'created_at' => now(),
            ]);

            // Log donation record
            DB::table('credit_donations')->insert([
                'tenant_id' => $tenantId,
                'donor_id' => $donorId,
                'recipient_type' => 'community_fund',
                'amount' => $amount,
                'message' => $message,
                'created_at' => now(),
            ]);

            // Log wallet transaction for the donor (receiver_id is NULL — credits go to the fund, not a user)
            DB::table('transactions')->insert([
                'tenant_id' => $tenantId,
                'sender_id' => $donorId,
                'receiver_id' => null,
                'amount' => $amount,
                'description' => 'Donation to community fund' . ($message ? ": $message" : ''),
                'transaction_type' => 'donation',
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::commit();

            return ['success' => true, 'balance' => $newBalance];
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('CommunityFundService::receiveDonation error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.donation_failed')];
        }
    }
}
