<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolOrgWalletService — Manages time credit wallets for volunteer organizations.
 *
 * All balance-mutating operations use DB::transaction() with lockForUpdate()
 * to prevent race conditions. Every mutation records an entry in
 * vol_org_transactions with the resulting balance_after for audit integrity.
 */
class VolOrgWalletService
{
    // =========================================================================
    // READ OPERATIONS
    // =========================================================================

    /**
     * Get wallet balance for a volunteer organization.
     *
     * @return array{balance: float, org_id: int, name: string}
     */
    public static function getBalance(int $volOrgId): array
    {
        $tenantId = TenantContext::getId();
        $org = DB::selectOne(
            "SELECT id, name, balance FROM vol_organizations WHERE id = ? AND tenant_id = ?",
            [$volOrgId, $tenantId]
        );

        if (!$org) {
            return ['balance' => 0, 'org_id' => $volOrgId, 'name' => ''];
        }

        return [
            'balance' => (float) $org->balance,
            'org_id' => (int) $org->id,
            'name' => $org->name,
        ];
    }

    /**
     * Get paginated transaction history for an organization wallet.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getTransactions(int $volOrgId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        // Hard cap at 50 rows to bound the LEFT JOIN users payload per request.
        $requested = (int) ($filters['limit'] ?? 20);
        $limit = max(1, min($requested, 50));
        $cursor = $filters['cursor'] ?? null;

        $params = [$volOrgId, $tenantId];
        $cursorClause = '';
        if ($cursor) {
            $cursorClause = ' AND t.id < ?';
            $params[] = (int) $cursor;
        }

        $typeFilter = '';
        if (!empty($filters['type'])) {
            $typeFilter = ' AND t.type = ?';
            $params[] = $filters['type'];
        }

        $params[] = $limit + 1;

        $rows = DB::select("
            SELECT t.id, t.type, t.amount, t.balance_after, t.description, t.created_at,
                   t.user_id, t.vol_log_id,
                   u.name as user_name, u.avatar_url as user_avatar_url
            FROM vol_org_transactions t
            LEFT JOIN users u ON t.user_id = u.id AND u.tenant_id = t.tenant_id
            WHERE t.vol_organization_id = ? AND t.tenant_id = ?
            {$cursorClause}
            {$typeFilter}
            ORDER BY t.id DESC
            LIMIT ?
        ", $params);

        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }

        $items = array_map(fn ($row) => [
            'id' => (int) $row->id,
            'type' => $row->type,
            'amount' => (float) $row->amount,
            'balance_after' => (float) $row->balance_after,
            'description' => $row->description,
            'created_at' => $row->created_at,
            'vol_log_id' => $row->vol_log_id ? (int) $row->vol_log_id : null,
            'user' => $row->user_id ? [
                'id' => (int) $row->user_id,
                'name' => $row->user_name ?? __('api.unknown_user'),
                'avatar_url' => $row->user_avatar_url,
            ] : null,
        ], $rows);

        $lastItem = end($items);
        $nextCursor = $lastItem ? (string) $lastItem['id'] : null;

        return [
            'items' => $items,
            'cursor' => $hasMore ? $nextCursor : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get wallet summary with aggregate stats.
     *
     * @return array{balance: float, total_deposited: float, total_paid_out: float, transaction_count: int, pending_hours_value: float}
     */
    public static function getWalletSummary(int $volOrgId): array
    {
        $tenantId = TenantContext::getId();

        $org = DB::selectOne(
            "SELECT balance FROM vol_organizations WHERE id = ? AND tenant_id = ?",
            [$volOrgId, $tenantId]
        );

        $stats = DB::selectOne("
            SELECT
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_deposited,
                COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_paid_out,
                COUNT(*) as transaction_count
            FROM vol_org_transactions
            WHERE vol_organization_id = ? AND tenant_id = ?
        ", [$volOrgId, $tenantId]);

        // Calculate pending hours value (hours awaiting approval)
        $pendingHours = DB::selectOne("
            SELECT COALESCE(SUM(hours), 0) as total
            FROM vol_logs
            WHERE organization_id = ? AND tenant_id = ? AND status = 'pending'
        ", [$volOrgId, $tenantId]);

        return [
            'balance' => (float) ($org->balance ?? 0),
            'total_deposited' => (float) $stats->total_deposited,
            'total_paid_out' => (float) $stats->total_paid_out,
            'transaction_count' => (int) $stats->transaction_count,
            'pending_hours_value' => (float) $pendingHours->total,
        ];
    }

    // =========================================================================
    // BALANCE-MUTATING OPERATIONS (all use DB::transaction + lockForUpdate)
    // =========================================================================

    /**
     * User deposits their personal time credits into an org wallet.
     *
     * @return array{success: bool, message: string, new_balance?: float}
     */
    public static function depositFromUser(int $userId, int $volOrgId, float $amount, ?string $note = null, ?string $idempotencyKey = null): array
    {
        if ($amount <= 0) {
            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.amount_must_be_greater_than_zero')];
        }
        // Reject fractional deposits explicitly — the previous silent
        // (int) floor() made "5.75" quietly deposit 5 while the UI implied
        // the full amount moved. users.balance stores whole hours only.
        if (floor($amount) !== $amount) {
            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.deposit_whole_number_required')];
        }
        if ($amount > 1000) {
            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.deposit_cannot_exceed_1000')];
        }

        $tenantId = TenantContext::getId();

        // ── Idempotency / anti-double-submit guard ──
        // Same pattern and reasoning as WalletService::transfer. The row locks
        // below prevent OVER-SPEND, not duplicate INTENT: a double-click or a
        // network retry of an affordable amount would otherwise move the credits
        // twice, both movements looking entirely legitimate in the audit trail.
        // Prefer an explicit client key (24h window); otherwise fall back to a
        // 120s content fingerprint so an accidental double-click is caught even
        // from a client that sends no key. The fingerprint binds the CONTENT in
        // both branches, so a client that wrongly reuses one key for two
        // genuinely different deposits still gets two deposits rather than a
        // silent replay. Fail OPEN on any cache hiccup — never block a real
        // deposit because the cache is unavailable.
        $explicitKey = trim((string) ($idempotencyKey ?? ''));
        $hasExplicitKey = $explicitKey !== '';
        $content = $volOrgId . '|' . (int) $amount . '|' . (string) $note;
        $fingerprint = $hasExplicitKey
            ? sha1('key:' . $explicitKey . '|' . $content)
            : sha1('content:' . $content);
        $idemCacheKey = "volorgdeposit:idem:{$tenantId}:{$userId}:{$fingerprint}";
        $idemTtl = $hasExplicitKey ? 86400 : 120;

        $claimed = true;
        try {
            $claimed = Cache::add($idemCacheKey, ['status' => 'pending'], $idemTtl);
        } catch (\Throwable $cacheEx) {
            $claimed = true;       // cache unavailable → do not block the deposit
            $idemCacheKey = null;  // and do not try to store or forget later
        }
        if (! $claimed) {
            // Duplicate inside the window. If the original already committed,
            // replay its OUTCOME so the member sees the same confirmation and
            // balance rather than a second movement; if it is still in flight,
            // refuse rather than risk a double debit.
            $prior = null;
            try {
                $prior = Cache::get($idemCacheKey);
            } catch (\Throwable $e) {
                $prior = null;
            }
            if (is_array($prior) && array_key_exists('new_balance', $prior)) {
                return [
                    'success' => true,
                    'message' => __('svc_notifications_2.vol_org_wallet.deposit_successful'),
                    'new_balance' => $prior['new_balance'],
                ];
            }

            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.deposit_duplicate')];
        }

        $result = DB::transaction(function () use ($userId, $volOrgId, $amount, $note, $tenantId) {
            // Lock user row to prevent concurrent balance changes
            $user = DB::selectOne(
                "SELECT id, balance, name FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$userId, $tenantId]
            );

            if (!$user) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.user_not_found')];
            }

            // Lock org row BEFORE validating user balance (prevent race condition on org balance_after)
            $org = DB::selectOne(
                "SELECT id, name, balance, status FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$volOrgId, $tenantId]
            );

            if (!$org) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.organization_not_found')];
            }

            // Hard-freeze: a suspended/pending (non-approved) org cannot take on
            // new value movements. Enforced HERE — not only in the React
            // controller — so every caller (accessible frontend included)
            // inherits the block (2026-07-10 audit M2).
            if (!VolunteerService::isApprovedOrganizationStatus($org->status ?? null)) {
                return ['success' => false, 'message' => __('api.volunteer_org_not_active')];
            }

            // Whole-number amounts only (fractional deposits are rejected
            // above): user loses the same INT as the org gains.
            $intAmount = (int) $amount;
            if ($intAmount <= 0) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.amount_must_be_at_least_1')];
            }

            if ((int) $user->balance < $intAmount) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.insufficient_personal_balance')];
            }
            DB::update(
                "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ?",
                [$intAmount, $userId, $tenantId]
            );

            // Credit to org (same INT amount as deducted from user — no phantom credits)
            DB::update(
                "UPDATE vol_organizations SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                [$intAmount, $volOrgId, $tenantId]
            );

            $newBalance = (float) $org->balance + $intAmount;

            // Record both sides of the movement. vol_org_transactions is the
            // organisation's reconciliation ledger; transactions is the
            // member-facing wallet ledger. Keeping both inserts inside this
            // transaction means balances and histories either all commit or all
            // roll back together.
            $orgDescription = $note ?: __('svc_notifications_2.vol_org_wallet.deposit_from_user', ['name' => $user->name]);
            $memberDescription = $note ?: __('emails_misc.vol_org_wallet.deposit_subject', ['org' => $org->name]);

            DB::insert("
                INSERT INTO vol_org_transactions (tenant_id, vol_organization_id, user_id, type, amount, balance_after, description, created_at)
                VALUES (?, ?, ?, 'deposit', ?, ?, ?, NOW())
            ", [$tenantId, $volOrgId, $userId, $intAmount, $newBalance, $orgDescription]);

            DB::insert("
                INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, transaction_type, status, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?, 'volunteer', 'completed', NOW(), NOW())
            ", [$tenantId, $userId, $intAmount, $memberDescription]);

            return ['success' => true, 'message' => __('svc_notifications_2.vol_org_wallet.deposit_successful'), 'new_balance' => $newBalance, '_deposit_user_id' => $userId, '_org_name' => $org->name, '_amount' => $intAmount];
        });

        // Record the outcome so a duplicate replays it, or release the claim so a
        // genuine retry after a REFUSED deposit (wrong org, too little balance)
        // is not blocked by our own guard for the rest of the window.
        if ($idemCacheKey !== null) {
            try {
                if (!empty($result['success'])) {
                    Cache::put($idemCacheKey, ['new_balance' => $result['new_balance'] ?? null], $idemTtl);
                } else {
                    Cache::forget($idemCacheKey);
                }
            } catch (\Throwable $e) {
                // Losing the record only weakens dedup; it must never fail the
                // deposit that already committed.
            }
        }

        // Send deposit confirmation email (outside transaction)
        if (!empty($result['success'])) {
            try {
                $depositor = DB::table('users')->where('id', $userId)->where('tenant_id', TenantContext::getId())->select(['email', 'first_name', 'name', 'preferred_language'])->first();
                if ($depositor && !empty($depositor->email)) {
                    LocaleContext::withLocale($depositor, function () use ($depositor, $result, $userId, $tenantId) {
                        $orgNameSafe  = htmlspecialchars($result['_org_name'] ?? '', ENT_QUOTES, 'UTF-8');
                        $amount       = (int) ($result['_amount'] ?? 0);
                        $walletUrl    = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/wallet';
                        $firstName    = $depositor->first_name ?? $depositor->name ?? __('emails.common.fallback_name');

                        $html = EmailTemplateBuilder::make()
                            ->title(__('emails_misc.vol_org_wallet.deposit_title'))
                            ->previewText(__('emails_misc.vol_org_wallet.deposit_preview', ['amount' => $amount]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_misc.vol_org_wallet.deposit_body', ['amount' => $amount, 'org' => $orgNameSafe]))
                            ->button(__('emails_misc.vol_org_wallet.deposit_cta'), $walletUrl)
                            ->render();

                        $subject = __('emails_misc.vol_org_wallet.deposit_subject', ['org' => $result['_org_name'] ?? '']);
                        if (!\App\Services\EmailDispatchService::sendRaw($depositor->email, $subject, $html, null, null, null, 'vol_org_wallet', ['tenant_id' => $tenantId])) {
                            Log::warning('[VolOrgWalletService] Deposit confirmation email failed', ['user_id' => $userId]);
                        }
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[VolOrgWalletService] depositFromUser email error: ' . $e->getMessage());
            }
            unset($result['_deposit_user_id'], $result['_org_name'], $result['_amount']);
        }

        return $result;
    }

    /**
     * Pay a volunteer from the org wallet (used on hours approval or manual pay).
     *
     * @return array{success: bool, message: string, new_balance?: float}
     */
    public static function payVolunteer(
        int $volOrgId,
        int $volunteerId,
        float $amount,
        int $adminId,
        ?string $note = null,
        ?int $logId = null
    ): array {
        if ($amount <= 0) {
            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.amount_must_be_greater_than_zero')];
        }

        // users.balance is whole hours, so a sub-1.0 amount floors to a 0-hour
        // payment: it would move nothing yet still record a zero-amount
        // transaction and email "0 hours paid" while returning success. Reject it
        // instead of a phantom success. (No production path calls payVolunteer
        // with a fractional amount today — verifyHours() handles real payouts and
        // returns no_whole_hours without inserting — but guard it before wiring.)
        if ((int) floor($amount) < 1) {
            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.amount_must_be_greater_than_zero')];
        }

        $tenantId = TenantContext::getId();

        $result = DB::transaction(function () use ($volOrgId, $volunteerId, $amount, $adminId, $note, $logId, $tenantId) {
            // Lock volunteer user row FIRST — depositFromUser() locks
            // user -> org, so locking org -> user here is a lock-order
            // inversion deadlock when a deposit and a payout race.
            $volunteer = DB::selectOne(
                "SELECT id, name FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$volunteerId, $tenantId]
            );

            if (!$volunteer) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.volunteer_not_found')];
            }

            // Then lock the org row (same order as depositFromUser)
            $org = DB::selectOne(
                "SELECT id, name, balance, user_id FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$volOrgId, $tenantId]
            );

            if (!$org) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.organization_not_found')];
            }

            // users.balance is an INT (whole hours). If the org is paying out
            // a fractional amount, we pay only the integer floor to the
            // volunteer and retain the fractional remainder in the org balance
            // so no hours vanish.
            $intAmount = (int) floor($amount);
            $fractional = round($amount - $intAmount, 4);
            $netOrgDebit = $amount - $fractional; // == $intAmount as float

            // The volunteer org wallet is a reconciliation ledger. Approval
            // mints whole-hour credits to the volunteer and may drive the org
            // balance negative; top-ups reconcile that balance later.
            DB::update(
                "UPDATE vol_organizations SET balance = balance - ? WHERE id = ? AND tenant_id = ?",
                [$netOrgDebit, $volOrgId, $tenantId]
            );

            $newOrgBalance = (float) $org->balance - $netOrgDebit;

            // Credit to volunteer (users.balance is INT)
            if ($intAmount > 0) {
                DB::update(
                    "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                    [$intAmount, $volunteerId, $tenantId]
                );
            }

            // Record in vol_org_transactions
            $description = $note ?: __('svc_notifications_2.vol_org_wallet.payment_to_volunteer', [
                'name' => $volunteer->name,
                'context' => $logId ? __('svc_notifications_2.vol_org_wallet.for_approved_hours') : '',
            ]);
            DB::insert("
                INSERT INTO vol_org_transactions (tenant_id, vol_organization_id, user_id, vol_log_id, type, amount, balance_after, description, created_at)
                VALUES (?, ?, ?, ?, 'volunteer_payment', ?, ?, ?, NOW())
            ", [$tenantId, $volOrgId, $volunteerId, $logId, -$netOrgDebit, $newOrgBalance, $description]);

            // Also record in main transactions table (uses existing 'volunteer' type)
            DB::insert("
                INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, transaction_type, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'volunteer', 'completed', NOW(), NOW())
            ", [$tenantId, (int) $org->user_id, $volunteerId, $intAmount, $description]);

            return ['success' => true, 'message' => __('svc_notifications_2.vol_org_wallet.payment_successful'), 'new_balance' => $newOrgBalance, '_volunteer_id' => $volunteerId, '_org_name' => $org->name, '_amount' => $intAmount];
        });

        // Send payment confirmation email to volunteer (outside transaction)
        if (!empty($result['success'])) {
            $orgNameForBell = $result['_org_name'] ?? '';
            $amountForBell  = (int) ($result['_amount'] ?? 0);

            // In-app bell to the paid volunteer (success path only; rendered in
            // their preferred_language). Wrapped in try/catch so a bell failure
            // never affects the already-committed payment.
            try {
                $bellVolunteer = DB::table('users')->where('id', $volunteerId)->where('tenant_id', TenantContext::getId())->select(['preferred_language'])->first();
                $walletLink = TenantContext::getSlugPrefix() . '/wallet';
                LocaleContext::withLocale($bellVolunteer, function () use ($volunteerId, $amountForBell, $orgNameForBell, $walletLink) {
                    $message = __('svc_notifications_2.vol_org_wallet.volunteer_paid_bell', [
                        'amount' => $amountForBell,
                        'org' => $orgNameForBell,
                    ]);
                    \App\Models\Notification::createNotification(
                        $volunteerId,
                        $message,
                        $walletLink,
                        'volunteer_payment'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($volunteerId), 'volunteer_payment', $message, $walletLink);
                });
            } catch (\Throwable $e) {
                Log::warning('[VolOrgWalletService] payVolunteer bell error: ' . $e->getMessage(), ['volunteer_id' => $volunteerId]);
            }

            try {
                $volunteer = DB::table('users')->where('id', $volunteerId)->where('tenant_id', TenantContext::getId())->select(['email', 'first_name', 'name', 'preferred_language'])->first();
                if ($volunteer && !empty($volunteer->email)) {
                    LocaleContext::withLocale($volunteer, function () use ($volunteer, $result, $volunteerId, $tenantId) {
                        $orgNameSafe = htmlspecialchars($result['_org_name'] ?? '', ENT_QUOTES, 'UTF-8');
                        $amount      = (int) ($result['_amount'] ?? 0);
                        $walletUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/wallet';
                        $firstName   = $volunteer->first_name ?? $volunteer->name ?? __('emails.common.fallback_name');

                        $html = EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title(__('emails_misc.vol_org_wallet.payment_title'))
                            ->previewText(__('emails_misc.vol_org_wallet.payment_preview', ['amount' => $amount]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_misc.vol_org_wallet.payment_body', ['amount' => $amount, 'org' => $orgNameSafe]))
                            ->button(__('emails_misc.vol_org_wallet.payment_cta'), $walletUrl)
                            ->render();

                        $subject = __('emails_misc.vol_org_wallet.payment_subject', ['org' => $result['_org_name'] ?? '']);
                        if (!\App\Services\EmailDispatchService::sendRaw($volunteer->email, $subject, $html, null, null, null, 'vol_org_wallet', ['tenant_id' => $tenantId])) {
                            Log::warning('[VolOrgWalletService] Payment confirmation email failed', ['volunteer_id' => $volunteerId]);
                        }
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[VolOrgWalletService] payVolunteer email error: ' . $e->getMessage());
            }
            unset($result['_volunteer_id'], $result['_org_name'], $result['_amount']);
        }

        return $result;
    }

    /**
     * Admin adjustment (top-up or deduct) on an org wallet.
     *
     * @return array{success: bool, message: string, new_balance?: float}
     */
    public static function adminAdjustment(int $volOrgId, float $amount, int $adminId, string $reason): array
    {
        if ($amount == 0) {
            return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.amount_cannot_be_zero')];
        }

        $tenantId = TenantContext::getId();

        $result = DB::transaction(function () use ($volOrgId, $amount, $adminId, $reason, $tenantId) {
            $org = DB::selectOne(
                "SELECT id, name, balance FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$volOrgId, $tenantId]
            );

            if (!$org) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.organization_not_found')];
            }

            $newBalance = (float) $org->balance + $amount;
            if ($newBalance < 0) {
                return ['success' => false, 'message' => __('svc_notifications_2.vol_org_wallet.adjustment_negative_balance')];
            }

            DB::update(
                "UPDATE vol_organizations SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                [$amount, $volOrgId, $tenantId]
            );

            DB::insert("
                INSERT INTO vol_org_transactions (tenant_id, vol_organization_id, user_id, type, amount, balance_after, description, created_at)
                VALUES (?, ?, ?, 'admin_adjustment', ?, ?, ?, NOW())
            ", [$tenantId, $volOrgId, $adminId, $amount, $newBalance, __('svc_notifications_2.vol_org_wallet.admin_adjustment_description', ['reason' => $reason])]);

            return ['success' => true, 'message' => __('svc_notifications_2.vol_org_wallet.adjustment_applied'), 'new_balance' => $newBalance, '_org_name' => $org->name];
        });

        // In-app bell fan-out to the org's owner/admin members (success path only,
        // after the balance change has committed). Wrapped in try/catch so a bell
        // failure never affects the already-applied adjustment.
        if (!empty($result['success'])) {
            try {
                $orgName = $result['_org_name'] ?? '';

                // Resolve distinct owner/admin members: the org's primary owner
                // (vol_organizations.user_id) plus any active owner/admin in
                // org_members. Load preferred_language for per-recipient locale.
                $recipients = DB::select("
                    SELECT DISTINCT u.id, u.preferred_language
                    FROM users u
                    WHERE u.tenant_id = ?
                      AND (
                            u.id = (SELECT vo.user_id FROM vol_organizations vo WHERE vo.id = ? AND vo.tenant_id = ?)
                            OR u.id IN (
                                SELECT om.user_id FROM org_members om
                                WHERE om.tenant_id = ?
                                  AND om.organization_id = ?
                                  AND om.org_type = 'volunteer'
                                  AND om.status = 'active'
                                  AND om.role IN ('owner', 'admin')
                            )
                          )
                ", [$tenantId, $volOrgId, $tenantId, $tenantId, $volOrgId]);

                $dashboardLink = TenantContext::getSlugPrefix() . '/volunteering/org/' . $volOrgId . '/dashboard';

                foreach ($recipients as $recipient) {
                    // Wrap per-recipient so each owner/admin sees the message in
                    // their own preferred_language.
                    LocaleContext::withLocale($recipient, function () use ($recipient, $amount, $reason, $orgName, $dashboardLink) {
                        if ($amount >= 0) {
                            $message = __('svc_notifications_2.vol_org_wallet.admin_adjustment_credit_bell', [
                                'amount' => (int) round(abs($amount)),
                                'org' => $orgName,
                                'reason' => $reason,
                            ]);
                        } else {
                            $message = __('svc_notifications_2.vol_org_wallet.admin_adjustment_debit_bell', [
                                'amount' => (int) round(abs($amount)),
                                'org' => $orgName,
                                'reason' => $reason,
                            ]);
                        }
                        \App\Models\Notification::createNotification(
                            (int) $recipient->id,
                            $message,
                            $dashboardLink,
                            'admin_adjustment'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $recipient->id), 'admin_adjustment', $message, $dashboardLink);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[VolOrgWalletService] adminAdjustment bell error: ' . $e->getMessage(), ['vol_org_id' => $volOrgId]);
            }

            unset($result['_org_name']);
        }

        return $result;
    }
}
