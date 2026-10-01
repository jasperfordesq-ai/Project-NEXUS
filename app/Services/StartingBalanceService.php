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
 * StartingBalanceService — native DB query builder implementation.
 *
 * Manages the starting balance (initial time credits) granted to new members
 * of a tenant. The default amount is stored in tenant_settings under the key
 * 'wallet.starting_balance'. When a user is approved/joins, applyToNewUser()
 * credits their wallet once (idempotent).
 */
class StartingBalanceService
{
    private const SETTING_KEY = 'wallet.starting_balance';

    /**
     * Legacy key written by the general admin Settings page
     * (AdminSettingsController / AdminConfigController 'welcome_credits').
     */
    private const LEGACY_SETTING_KEY = 'general.welcome_credits';

    /**
     * Platform-wide default when a tenant has never saved the setting.
     * MUST match AdminUsersController::grantWelcomeCredits so self-serve
     * (email verification) and admin-approval tenants behave identically.
     * A tenant that wants no welcome credits sets the value to 0 explicitly.
     */
    private const DEFAULT_BALANCE = 5;

    /**
     * Get the configured starting balance for the current tenant.
     *
     * Reads the canonical 'wallet.starting_balance' key first (written by the
     * wallet admin endpoints), then falls back to the legacy
     * 'general.welcome_credits' key (written by the general admin Settings
     * page) so tenants configured via either surface behave the same.
     * Unset on both keys = the platform default (5). Explicit 0 = no grant.
     *
     * @return float Always >= 0.
     */
    public static function getStartingBalance(): float
    {
        $tenantId = TenantContext::getId();
        $settings = app(TenantSettingsService::class);
        $value = $settings->get($tenantId, self::SETTING_KEY);
        if ($value === null) {
            $value = $settings->get($tenantId, self::LEGACY_SETTING_KEY, (string) self::DEFAULT_BALANCE);
        }

        return max(0.0, (float) $value);
    }

    /**
     * Set the default starting balance for the current tenant.
     *
     * @param float $amount Will be clamped to >= 0.
     */
    public static function setStartingBalance(float $amount): void
    {
        $tenantId = TenantContext::getId();
        $amount = max(0.0, $amount);

        app(TenantSettingsService::class)->set($tenantId, self::SETTING_KEY, (string) $amount, 'float');
    }

    /**
     * Apply the starting balance to a new user. Idempotent — if a
     * starting_balance transaction already exists for this user, it is a no-op.
     *
     * @param int $userId The user to credit.
     * @return array{success: bool, amount: float, source: string}
     */
    public static function applyToNewUser(int $userId): array
    {
        $tenantId = TenantContext::getId();
        $amount = static::getStartingBalance();

        // If starting balance is zero, nothing to do
        if ($amount <= 0.0) {
            return [
                'success' => true,
                'amount' => 0.0,
                'source' => 'none',
            ];
        }

        // Fast-path idempotency check (no lock) — covers BOTH this service's
        // 'starting_balance' transactions and the admin-approval path's
        // '[Welcome Bonus]' grants (AdminUsersController::grantWelcomeCredits)
        // so the two mechanisms can never double-credit the same user.
        if (static::alreadyGranted($tenantId, $userId)) {
            return [
                'success' => true,
                'amount' => 0.0,
                'source' => 'already_applied',
            ];
        }

        try {
            DB::beginTransaction();

            // Lock the user row to serialise concurrent grant attempts
            // (registration retries / double-submitted verification), then
            // re-check idempotency under the lock. The pre-transaction check
            // above alone is racy: two concurrent calls could both pass it.
            $userRow = DB::selectOne(
                "SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$userId, $tenantId]
            );

            if (!$userRow) {
                DB::rollBack();
                Log::warning('[StartingBalanceService] applyToNewUser: user not found in tenant', [
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                ]);

                return [
                    'success' => false,
                    'amount' => 0.0,
                    'source' => 'user_not_found',
                ];
            }

            if (static::alreadyGranted($tenantId, $userId)) {
                DB::rollBack();

                return [
                    'success' => true,
                    'amount' => 0.0,
                    'source' => 'already_applied',
                ];
            }

            // Create the starting_balance transaction (sender_id=0 for system)
            DB::insert(
                "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, status, transaction_type, created_at, updated_at)
                 VALUES (?, 0, ?, ?, 'Starting balance credit', 'completed', 'starting_balance', NOW(), NOW())",
                [$tenantId, $userId, $amount]
            );

            // Credit the user's balance
            DB::update(
                "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                [$amount, $userId, $tenantId]
            );

            DB::commit();

            return [
                'success' => true,
                'amount' => $amount,
                'source' => 'starting_balance',
            ];
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('[StartingBalanceService] applyToNewUser failed for user ' . $userId . ': ' . $e->getMessage());

            return [
                'success' => false,
                'amount' => 0.0,
                'source' => 'error',
            ];
        }
    }

    /**
     * Whether this user has already received a welcome grant via EITHER
     * mechanism: this service ('starting_balance' transaction type) or the
     * admin-approval flow (which also writes 'starting_balance' today, and
     * before commit 5eb2cacce wrote a SELF-transfer carrying a
     * '[Welcome Bonus]…' description and no transaction type — see
     * AdminUsersController::grantWelcomeCredits).
     *
     * F-474: the description arm is matched ONLY on a self-transfer row. The
     * description of an ordinary member-to-member transfer is free text the
     * sender supplies verbatim (WalletService::transfer), so a prefix match on
     * it alone let any member deny a new member's welcome credits with one
     * 0.01-credit transfer. WalletService::transfer refuses a self-transfer
     * outright, so no member-reachable path can write a row that satisfies the
     * legacy arm, while every legacy row still does.
     */
    private static function alreadyGranted(int $tenantId, int $userId): bool
    {
        $existing = DB::selectOne(
            "SELECT id FROM transactions
             WHERE tenant_id = ? AND receiver_id = ?
               AND (transaction_type = 'starting_balance'
                    OR (description LIKE '[Welcome Bonus]%' AND sender_id = receiver_id))
             LIMIT 1",
            [$tenantId, $userId]
        );

        return $existing !== null;
    }
}
