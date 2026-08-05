<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * WalletService — Laravel DI-based service for time credit wallet operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class WalletService
{
    /**
     * Hard platform ceiling on a single transfer (anti-abuse safety cap). A
     * tenant setting may lower the effective cap but never raise it above this.
     */
    private const PLATFORM_MAX_TRANSFER = 1000;

    public function __construct(
        private readonly Transaction $transaction,
        private readonly User $user,
    ) {}

    /**
     * The effective single-transfer cap (in time credits) for a tenant.
     *
     * Resolves the tenant's configured `wallet.max_transfer` setting when it is
     * set to a positive number, clamped to the platform safety ceiling — a
     * tenant setting can only make the cap STRICTER, never raise a transfer
     * above the anti-abuse ceiling. This is the SINGLE source of truth for the
     * limit: both transfer() (enforcement) and WalletController::config() (what
     * the UI advertises) call it, so the two can no longer diverge (previously
     * config() read the tenant setting while transfer() hardcoded the ceiling,
     * so a stricter tenant cap was advertised but silently not enforced).
     */
    /**
     * Mint time credits to a member against the community, with no payer.
     *
     * This is the existing "system credit" shape made callable: a transaction
     * with `sender_id IS NULL`, exactly like `starting_balance`,
     * `community_fund` and `admin_grant`, which the wallet UI already renders.
     * It is NOT a transfer — nobody is debited — so it deliberately does not go
     * through transfer() and is not subject to the peer-transfer cap. Callers
     * own the policy question of whether a mint is authorised at all.
     *
     * The caller must already hold a database transaction if it needs the mint
     * and its own bookkeeping to be atomic.
     *
     * @return int The transaction id.
     */
    public function mintToMember(
        int $tenantId,
        int $recipientId,
        float $amount,
        string $transactionType,
        string $description,
    ): int {
        if ($amount <= 0) {
            throw new \InvalidArgumentException('Mint amount must be positive.');
        }

        // One transaction for the balance write AND its ledger row, matching
        // transfer(). Without this, a failure between the two statements left
        // the balance permanently incremented with no transactions row — and
        // because the caller records such failures as retryable, the retry
        // minted AGAIN: a silent double-credit with a single ledger entry.
        return (int) DB::transaction(function () use ($tenantId, $recipientId, $amount, $transactionType, $description): int {
            // Lock the recipient row before incrementing, matching transfer()'s
            // ordering so a mint and a transfer touching the same member cannot
            // interleave into a lost update.
            DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            $updated = DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', $tenantId)
                ->increment('balance', $amount);

            if ($updated !== 1) {
                throw new \RuntimeException('Mint recipient not found in this tenant.');
            }

            return (int) DB::table('transactions')->insertGetId([
                'tenant_id' => $tenantId,
                'sender_id' => null,
                'receiver_id' => $recipientId,
                'amount' => $amount,
                'description' => $description,
                'transaction_type' => $transactionType,
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }

    /**
     * Return previously minted credits from a member to the community.
     *
     * The exact mirror of mintToMember(): sender is the member, receiver is
     * NULL (the community). Used by admin-initiated reversals of attendance
     * rewards. The balance is allowed to go negative — a member may have spent
     * the reward before an admin reverses it, and the reversal must still be
     * recordable. vol_organizations.balance already carries the same
     * may-go-negative semantics for organisation wallets.
     */
    public function reclaimFromMember(
        int $tenantId,
        int $memberId,
        float $amount,
        string $transactionType,
        string $description,
    ): int {
        if ($amount <= 0) {
            throw new \InvalidArgumentException('Reclaim amount must be positive.');
        }

        // Atomic for the same reason as mintToMember(): the balance change and
        // its ledger row must commit together or not at all.
        return (int) DB::transaction(function () use ($tenantId, $memberId, $amount, $transactionType, $description): int {
            // Same lock ordering as mintToMember()/transfer(), so a reclaim
            // cannot interleave with either into a lost update.
            DB::table('users')
                ->where('id', $memberId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            $updated = DB::table('users')
                ->where('id', $memberId)
                ->where('tenant_id', $tenantId)
                ->decrement('balance', $amount);

            if ($updated !== 1) {
                throw new \RuntimeException('Reclaim member not found in this tenant.');
            }

            return (int) DB::table('transactions')->insertGetId([
                'tenant_id' => $tenantId,
                'sender_id' => $memberId,
                'receiver_id' => null,
                'amount' => $amount,
                'description' => $description,
                'transaction_type' => $transactionType,
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }

    public function maxTransferAmount(?int $tenantId = null): float
    {
        $tenantId ??= TenantContext::getId();

        $configured = app(TenantSettingsService::class)->get((int) $tenantId, 'wallet.max_transfer');
        if ($configured === null || ! is_numeric($configured) || (float) $configured <= 0) {
            return (float) self::PLATFORM_MAX_TRANSFER;
        }

        return min((float) $configured, (float) self::PLATFORM_MAX_TRANSFER);
    }

    /**
     * Get wallet balance and summary for a user.
     *
     * @return array{balance: float, total_earned: float, total_spent: float, transaction_count: int, currency: string}
     */
    public function getBalance(int $userId): array
    {
        /** @var User|null $user */
        $user = $this->user->newQuery()->find($userId);

        // Single query to compute all balance aggregates (replaces 5 separate queries)
        $stats = $this->transaction->newQuery()
            ->where(fn (Builder $q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            ->selectRaw(
                "SUM(CASE WHEN receiver_id = ? AND status = 'completed' THEN amount ELSE 0 END) as total_earned,
                 SUM(CASE WHEN sender_id = ? AND status = 'completed' THEN amount ELSE 0 END) as total_spent,
                 SUM(CASE WHEN receiver_id = ? AND status = 'pending' THEN amount ELSE 0 END) as pending_incoming,
                 SUM(CASE WHEN sender_id = ? AND status = 'pending' THEN amount ELSE 0 END) as pending_outgoing,
                 COUNT(CASE WHEN status = 'completed' THEN 1 END) as tx_count",
                [$userId, $userId, $userId, $userId]
            )
            ->first();

        $totalEarned = (float) ($stats->total_earned ?? 0);
        $totalSpent = (float) ($stats->total_spent ?? 0);
        $pendingIncoming = (float) ($stats->pending_incoming ?? 0);
        $pendingOutgoing = (float) ($stats->pending_outgoing ?? 0);
        $txCount = (int) ($stats->tx_count ?? 0);

        // Include federation inbound transactions in earnings/count totals
        try {
            $fedStats = DB::table('federation_transactions')
                ->where('receiver_user_id', $userId)
                ->where('receiver_tenant_id', TenantContext::getId())
                ->where('status', 'completed')
                ->selectRaw('COALESCE(SUM(amount), 0) as fed_earned, COUNT(*) as fed_count')
                ->first();
            if ($fedStats) {
                $totalEarned += (float) $fedStats->fed_earned;
                $txCount += (int) $fedStats->fed_count;
            }
        } catch (\Throwable $e) {
            // federation_transactions table may not exist in older tenants — ignore
        }

        // Internal (same-platform) federated inbound credits: the canonical ledger
        // row lives in the SENDER's tenant (transactions.tenant_id = sender tenant),
        // so the tenant-scoped stats query above can never count them for the receiver.
        $internalFed = DB::table('transactions')
            ->where('is_federated', 1)
            ->where('receiver_id', $userId)
            ->where('receiver_tenant_id', TenantContext::getId())
            ->whereColumn('tenant_id', '!=', 'receiver_tenant_id')
            ->where('status', 'completed')
            ->selectRaw('COALESCE(SUM(amount), 0) as fed_earned, COUNT(*) as fed_count')
            ->first();
        if ($internalFed) {
            $totalEarned += (float) $internalFed->fed_earned;
            $txCount += (int) $internalFed->fed_count;
        }

        return [
            'balance'           => (float) ($user->balance ?? 0),
            'total_earned'      => $totalEarned,
            'total_spent'       => $totalSpent,
            'transaction_count' => $txCount,
            'currency'          => 'hours',
            'pending_incoming'  => $pendingIncoming,
            'pending_outgoing'  => $pendingOutgoing,
            // Aliases for frontend compatibility
            'pending_in'        => $pendingIncoming,
            'pending_out'       => $pendingOutgoing,
        ];
    }

    /**
     * Get transaction history with cursor-based pagination.
     *
     * @param array{type?: string, cursor?: string|null, limit?: int} $filters
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getTransactions(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $type = $filters['type'] ?? 'all';
        $cursor = $filters['cursor'] ?? null;

        $query = $this->transaction->newQuery()
            ->with([
                'sender:id,first_name,last_name,avatar_url,organization_name,profile_type',
                'receiver:id,first_name,last_name,avatar_url,organization_name,profile_type',
            ])
            ->completed();

        // Filter by type and respect soft-delete flags
        if ($type === 'sent') {
            $query->where('sender_id', $userId)
                  ->where('deleted_for_sender', false);
        } elseif ($type === 'received') {
            $query->where('receiver_id', $userId)
                  ->where('deleted_for_receiver', false);
        } else {
            $query->where(function (Builder $q) use ($userId) {
                $q->where(function (Builder $q2) use ($userId) {
                    $q2->where('sender_id', $userId)->where('deleted_for_sender', false);
                })->orWhere(function (Builder $q2) use ($userId) {
                    $q2->where('receiver_id', $userId)->where('deleted_for_receiver', false);
                });
            });
        }

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('id');

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        // Format each transaction into the standard API shape expected by the frontend
        $formatted = $items->map(fn (Transaction $txn) => $this->formatTransaction($txn, $userId))->all();

        // Merge federated inbound credits on the first page only: external partner
        // rows from federation_transactions AND internal cross-tenant rows recorded
        // in the sender's tenant (invisible to the tenant-scoped native query above).
        // Cursor pagination stays keyed to the native transactions table; federation rows
        // appear as an overlay on page 1, re-sorted by created_at so they interleave correctly.
        if ($cursor === null && $type !== 'sent') {
            $fedItems = array_merge(
                $this->getFederationTransactions($userId, $limit),
                $this->getInternalFederatedInbound($userId, $limit)
            );
            if (!empty($fedItems)) {
                $merged = array_merge($formatted, $fedItems);
                usort($merged, static function (array $a, array $b): int {
                    return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
                });
                $formatted = array_slice($merged, 0, $limit);
            }
        }

        return [
            'items'    => $formatted,
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Fetch inbound federation transactions (from external partners like TimeOverflow)
     * for display alongside native transactions. These are already credited to the
     * user's balance by the federation webhook handler.
     *
     * @return array<int, array<string, mixed>>
     */
    /**
     * Fetch a single inbound federation transaction formatted for display.
     * Used by WalletController::showTransaction() when id is negative.
     */
    public function getFederationTransaction(int $federationTransactionId, int $userId): ?array
    {
        try {
            $tenantId = TenantContext::getId();
            $r = DB::table('federation_transactions as ft')
                ->leftJoin('federation_external_partners as ep', 'ep.id', '=', 'ft.external_partner_id')
                ->where('ft.id', $federationTransactionId)
                ->where('ft.receiver_user_id', $userId)
                ->where('ft.receiver_tenant_id', $tenantId)
                ->first([
                    'ft.id',
                    'ft.amount',
                    'ft.description',
                    'ft.status',
                    'ft.created_at',
                    'ft.external_partner_id',
                    'ft.external_receiver_name',
                    'ep.name as partner_name',
                ]);

            if (!$r) {
                return null;
            }

            $senderName = $r->external_receiver_name ?: __('api.external_user_fallback');
            $partnerName = $r->partner_name ?: __('api.external_partner_fallback');
            $createdAt = $r->created_at ? \Carbon\Carbon::parse($r->created_at)->toIso8601String() : null;

            return [
                'id'               => -1 * (int) $r->id,
                'source'           => 'federation',
                'type'             => 'credit',
                'status'           => $r->status ?? 'completed',
                'amount'           => (float) $r->amount,
                'description'      => $r->description,
                'transaction_type' => 'federation',
                'sender'           => ['id' => 0, 'name' => $senderName . ' (' . $partnerName . ')', 'avatar' => null],
                'receiver'         => ['id' => $userId, 'name' => '', 'avatar' => null],
                'other_user'      => ['id' => 0, 'name' => $senderName . ' (' . $partnerName . ')', 'avatar' => null],
                'balance_after'    => null,
                'created_at'       => $createdAt,
                'federation'       => [
                    'transaction_id' => (int) $r->id,
                    'partner_id' => (int) $r->external_partner_id,
                    'partner_name' => $partnerName,
                    'external_sender_name' => $senderName,
                ],
            ];
        } catch (\Throwable $e) {
            \Log::warning('Failed to fetch federation transaction', ['error' => $e->getMessage()]);
            return null;
        }
    }

    private function getFederationTransactions(int $userId, int $limit): array
    {
        try {
            $tenantId = TenantContext::getId();
            $rows = DB::table('federation_transactions as ft')
                ->leftJoin('federation_external_partners as ep', 'ep.id', '=', 'ft.external_partner_id')
                ->where('ft.receiver_user_id', $userId)
                ->where('ft.receiver_tenant_id', $tenantId)
                ->where('ft.status', 'completed')
                ->orderByDesc('ft.created_at')
                ->limit($limit)
                ->get([
                    'ft.id',
                    'ft.amount',
                    'ft.description',
                    'ft.status',
                    'ft.created_at',
                    'ft.external_partner_id',
                    'ft.external_receiver_name',
                    'ep.name as partner_name',
                ]);

            $items = [];
            foreach ($rows as $r) {
                $senderName = $r->external_receiver_name ?: __('api.external_user_fallback');
                $partnerName = $r->partner_name ?: __('api.external_partner_fallback');
                $createdAt = $r->created_at ? \Carbon\Carbon::parse($r->created_at)->toIso8601String() : null;
                // Use a large negative int so id stays numeric (matches TS Transaction.id: number)
                // AND can never collide with native transaction ids. Callers detect federation
                // rows via the `source` field rather than by id.
                $syntheticId = -1 * (int) $r->id;
                $items[] = [
                    'id'               => $syntheticId,
                    'source'           => 'federation',
                    'type'             => 'credit',
                    'status'           => $r->status ?? 'completed',
                    'amount'           => (float) $r->amount,
                    'description'      => $r->description,
                    'transaction_type' => 'federation',
                    'sender'           => [
                        'id' => 0,
                        'name' => $senderName . ' (' . $partnerName . ')',
                        'avatar' => null,
                    ],
                    'receiver'         => ['id' => $userId, 'name' => '', 'avatar' => null],
                    'other_user'       => [
                        'id' => 0,
                        'name' => $senderName . ' (' . $partnerName . ')',
                        'avatar' => null,
                    ],
                    'balance_after'    => null,
                    'created_at'       => $createdAt,
                    'federation'       => [
                        'transaction_id' => (int) $r->id,
                        'partner_id' => (int) $r->external_partner_id,
                        'partner_name' => $partnerName,
                        'external_sender_name' => $senderName,
                    ],
                ];
            }
            return $items;
        } catch (\Throwable $e) {
            \Log::warning('Failed to fetch federation transactions for wallet', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Fetch internal (same-platform, cross-tenant) federated inbound credits for
     * the receiver's wallet. The canonical ledger row for an internal federated
     * transfer lives in the SENDER's tenant (transactions.tenant_id = sender
     * tenant, is_federated = 1 — see FederationInternalLedgerService), so the
     * receiver's tenant-scoped native query can never surface it. This overlay
     * deliberately bypasses the Transaction model's tenant scope but stays
     * receiver-scoped via receiver_tenant_id = the viewer's tenant.
     *
     * @return array<int, array<string, mixed>>
     */
    private function getInternalFederatedInbound(int $userId, int $limit, ?int $onlyId = null): array
    {
        try {
            $tenantId = TenantContext::getId();
            $query = DB::table('transactions as tx')
                ->leftJoin('users as su', function ($join) {
                    $join->on('su.id', '=', 'tx.sender_id')
                         ->on('su.tenant_id', '=', 'tx.sender_tenant_id');
                })
                ->leftJoin('tenants as st', 'st.id', '=', 'tx.sender_tenant_id')
                ->where('tx.is_federated', 1)
                ->where('tx.receiver_id', $userId)
                ->where('tx.receiver_tenant_id', $tenantId)
                ->whereColumn('tx.tenant_id', '!=', 'tx.receiver_tenant_id')
                ->where('tx.status', 'completed')
                ->where('tx.deleted_for_receiver', false);

            if ($onlyId !== null) {
                $query->where('tx.id', $onlyId);
            }

            $rows = $query->orderByDesc('tx.created_at')
                ->limit($limit)
                ->get([
                    'tx.id',
                    'tx.amount',
                    'tx.description',
                    'tx.status',
                    'tx.created_at',
                    'tx.sender_id',
                    'tx.sender_tenant_id',
                    'su.first_name',
                    'su.last_name',
                    'su.organization_name',
                    'su.profile_type',
                    'su.avatar_url',
                    'st.name as partner_name',
                ]);

            $items = [];
            foreach ($rows as $r) {
                $senderName = (($r->profile_type ?? null) === 'organisation' && !empty($r->organization_name))
                    ? (string) $r->organization_name
                    : trim(((string) ($r->first_name ?? '')) . ' ' . ((string) ($r->last_name ?? '')));
                if ($senderName === '') {
                    $senderName = __('api.external_user_fallback');
                }
                $partnerName = $r->partner_name ?: __('api.external_partner_fallback');
                $createdAt = $r->created_at ? \Carbon\Carbon::parse($r->created_at)->toIso8601String() : null;
                $senderParty = [
                    'id'     => (int) ($r->sender_id ?? 0),
                    'name'   => $senderName . ' (' . $partnerName . ')',
                    'avatar' => $r->avatar_url ?? null,
                ];
                // Positive native transactions id — showTransaction() resolves it via
                // the internal-federated fallback when the tenant-scoped lookup misses.
                $items[] = [
                    'id'               => (int) $r->id,
                    'source'           => 'federation',
                    'type'             => 'credit',
                    'status'           => $r->status ?? 'completed',
                    'amount'           => (float) $r->amount,
                    'description'      => $r->description,
                    'transaction_type' => 'federation',
                    'sender'           => $senderParty,
                    'receiver'         => ['id' => $userId, 'name' => '', 'avatar' => null],
                    'other_user'       => $senderParty,
                    'balance_after'    => null,
                    'created_at'       => $createdAt,
                    'federation'       => [
                        'transaction_id'       => (int) $r->id,
                        'partner_id'           => (int) $r->sender_tenant_id,
                        'partner_name'         => $partnerName,
                        'external_sender_name' => $senderName,
                    ],
                ];
            }
            return $items;
        } catch (\Throwable $e) {
            \Log::warning('Failed to fetch internal federated inbound transactions for wallet', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Transfer time credits from one user to another.
     *
     * Accepts a flexible input array with recipient specified as
     * user_id, username, email, or generic "recipient" field.
     *
     * @param int   $senderId Sender user ID
     * @param array $data     Transfer data: recipient, amount, description
     * @return array Created transaction data
     *
     * @throws \InvalidArgumentException On validation failure
     * @throws \RuntimeException On insufficient balance or self-transfer
     */
    /**
     * Move credits from $senderId to a recipient.
     *
     * @param int|null $actingUserId When a linked-account carer/guardian is
     *        spending the sender's balance on their behalf, the carer's id. NULL
     *        (the default, and every ordinary transfer) means the sender acted
     *        themselves. Recorded on the ledger row as `acting_user_id` — the
     *        owner of the credits stays the sender either way, but a proxy debit
     *        must never be indistinguishable from the member's own.
     */
    public function transfer(int $senderId, array $data, ?int $actingUserId = null): array
    {
        $recipient = $data['recipient'] ?? $data['user_id'] ?? $data['username'] ?? $data['email'] ?? null;
        $amount = (float) ($data['amount'] ?? 0);
        $description = trim($data['description'] ?? '');

        if (empty($recipient)) {
            throw new \InvalidArgumentException(__('api.wallet_transfer_recipient_required'));
        }

        if ($amount <= 0) {
            throw new \InvalidArgumentException(__('api.wallet_transfer_amount_positive'));
        }

        // Cap the transfer amount. The effective cap is the tenant's configured
        // wallet.max_transfer (clamped to the platform ceiling), resolved via the
        // single source of truth so the enforced limit matches what
        // WalletController::config() advertises to the UI.
        $maxTransferAmount = $this->maxTransferAmount();
        if ($amount > $maxTransferAmount) {
            throw new \InvalidArgumentException(__('api.wallet_transfer_amount_max', ['max' => (int) $maxTransferAmount]));
        }

        // Enforce reasonable decimal precision (max 2 decimal places)
        if (round($amount, 2) != $amount) {
            throw new \InvalidArgumentException(__('api.wallet_transfer_amount_precision'));
        }

        $tenantId = TenantContext::getId();

        // Resolve recipient: ID, email, or username
        $receiver = null;
        if (is_numeric($recipient)) {
            $receiver = $this->user->newQuery()
                ->where('tenant_id', $tenantId)
                ->find((int) $recipient);
        } elseif (filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            $receiver = $this->user->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('email', $recipient)
                ->first();
        } else {
            $receiver = $this->user->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('username', $recipient)
                ->first();
        }

        if (! $receiver) {
            throw new \RuntimeException(__('api.wallet_transfer_recipient_not_found'));
        }

        if ($senderId === $receiver->id) {
            throw new \RuntimeException(__('api.wallet_transfer_self_forbidden'));
        }

        // Reject transfers to banned, suspended, or inactive accounts
        if (in_array($receiver->status, ['banned', 'suspended', 'inactive', 'deactivated'], true)) {
            throw new \RuntimeException(__('api.wallet_transfer_recipient_inactive'));
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $senderId,
            (int) $receiver->id,
            $tenantId,
            'wallet_transfer',
        );

        // ── Idempotency / anti-double-submit guard ──
        // Re-implements the federation H6 pattern (see
        // FederationV2Controller::sendTransaction). The lockForUpdate below
        // prevents over-spend below zero, NOT duplicate INTENT: a double-click or
        // network retry of a sufficient-balance amount would otherwise create two
        // real, legitimate-looking debits. Claim a short-lived fingerprint; on a
        // duplicate, replay the ORIGINAL transaction instead of debiting again.
        // Prefer an explicit client Idempotency-Key (24h window); otherwise fall
        // back to a 120s content fingerprint so an accidental double-click is
        // caught even without a client key. Fail OPEN on any cache hiccup — never
        // block a legitimate transfer on cache flakiness.
        $explicitKey = trim((string) ($data['idempotency_key'] ?? ''));
        $hasExplicitKey = $explicitKey !== '';
        // Bind the fingerprint to the request content in BOTH branches. An
        // explicit key that omitted recipient/amount would collapse two
        // genuinely-different transfers that (wrongly) reuse one key: the second
        // would replay the first's transaction and return success while moving no
        // credits to the real recipient. Folding content in means an identical
        // retry still dedups (double-submit protection intact) while a different
        // recipient/amount is treated as the distinct transfer it is.
        // `acting_user_id` is folded in so a carer's proxy transfer can never
        // replay (and be credited against) the member's own identical transfer, or
        // vice versa — they are genuinely different actions.
        $fingerprint = $hasExplicitKey
            ? sha1('key:' . $explicitKey . '|' . $receiver->id . '|' . $amount . '|' . $description . '|' . ($actingUserId ?? 0))
            : sha1('content:' . $receiver->id . '|' . $amount . '|' . $description . '|' . ($actingUserId ?? 0));
        $idemCacheKey = "wallettx:idem:{$tenantId}:{$senderId}:{$fingerprint}";
        $idemTtl = $hasExplicitKey ? 86400 : 120;

        $claimed = true;
        try {
            $claimed = Cache::add($idemCacheKey, ['status' => 'pending'], $idemTtl);
        } catch (\Throwable $cacheEx) {
            $claimed = true;       // cache unavailable → do not block the transfer
            $idemCacheKey = null;  // and don't try to forget/store later
        }
        if (! $claimed) {
            // Duplicate within the window. If the original already committed,
            // replay it (no second debit); otherwise it's a concurrent in-flight
            // twin we must reject rather than risk a double-debit.
            $prior = null;
            try {
                $prior = Cache::get($idemCacheKey);
            } catch (\Throwable $e) {
                $prior = null;
            }
            if (is_array($prior) && isset($prior['transaction_id'])) {
                $original = $this->transaction->newQuery()
                    ->with(['sender', 'receiver'])
                    ->find((int) $prior['transaction_id']);
                if ($original) {
                    return $this->formatTransaction($original, $senderId);
                }
            }
            throw new \RuntimeException(__('api.wallet_transfer_duplicate'));
        }

        try {
            $txn = DB::transaction(function () use ($senderId, $receiver, $amount, $description, $tenantId, $actingUserId) {
                // Lock both user rows in consistent ID order to prevent deadlocks
                // when two users transfer to each other simultaneously
                $minId = min($senderId, $receiver->id);
                $maxId = max($senderId, $receiver->id);
                $this->user->newQuery()->where('tenant_id', $tenantId)->lockForUpdate()->findOrFail($minId);
                $this->user->newQuery()->where('tenant_id', $tenantId)->lockForUpdate()->findOrFail($maxId);

                /** @var User $sender */
                $sender = $this->user->newQuery()->where('tenant_id', $tenantId)->findOrFail($senderId);

                if ((float) $sender->balance < $amount) {
                    throw new \RuntimeException(__('api.wallet_transfer_insufficient_balance'));
                }

                $txn = $this->transaction->newInstance([
                    'sender_id'   => $senderId,
                    'receiver_id' => $receiver->id,
                    // NULL for an ordinary transfer the sender made themselves.
                    // Populated only when a linked-account carer/guardian sent it
                    // on the sender's behalf, so a proxy debit of someone else's
                    // balance is always attributable to the person who did it.
                    'acting_user_id' => $actingUserId,
                    'amount'      => $amount,
                    'description' => $description,
                    'status'      => 'completed',
                ]);
                $txn->save();

                $sender->decrement('balance', $amount);
                $receiver->increment('balance', $amount);

                return $txn->fresh(['sender', 'receiver']);
            });
        } catch (\Throwable $e) {
            // Release the idempotency claim so a legitimate retry of a FAILED
            // transfer (e.g. a transient error) is not blocked by a stale claim.
            if ($idemCacheKey !== null) {
                try {
                    Cache::forget($idemCacheKey);
                } catch (\Throwable $ignore) {
                    // best-effort
                }
            }
            throw $e;
        }

        // Record the committed result against the idempotency key so a replay
        // returns the SAME transaction instead of debiting a second time.
        if ($idemCacheKey !== null) {
            try {
                Cache::put($idemCacheKey, [
                    'transaction_id' => $txn->id,
                    'status'         => 'completed',
                    'amount'         => $amount,
                ], $idemTtl);
            } catch (\Throwable $e) {
                // best-effort — a failed cache write only weakens replay-dedup
            }
        }

        // Fire low-balance / empty-balance alert after transaction completes
        try {
            $tenantId = TenantContext::getId();
            $newBalance = (float) DB::table('users')
                ->where('id', $senderId)
                ->where('tenant_id', $tenantId)
                ->value('balance');
            WalletAlertService::checkAndSendLowBalanceAlert($tenantId, $senderId, $newBalance);
        } catch (\Throwable $e) {
            Log::warning('WalletService: balance alert failed: ' . $e->getMessage());
        }

        // Dispatch TransactionCompleted so federation push, XP awards, and
        // real-time wallet updates all fire regardless of which caller invoked
        // this method (WalletController, admin bulk ops, etc.).
        try {
            $senderModel   = $this->user->newQuery()->find($senderId);
            $receiverModel = $this->user->newQuery()->find($txn->receiver_id);
            if ($senderModel && $receiverModel) {
                event(new TransactionCompleted($txn, $senderModel, $receiverModel, TenantContext::getId()));
            }
        } catch (\Throwable $e) {
            Log::warning('WalletService: TransactionCompleted dispatch failed: ' . $e->getMessage());
        }

        return $this->formatTransaction($txn, $senderId);
    }

    /**
     * Get a single transaction by ID for a specific user.
     *
     * @return array|null Transaction data or null if not found / not authorized
     */
    public function getTransaction(int $transactionId, int $userId): ?array
    {
        /** @var Transaction|null $txn */
        $txn = $this->transaction->newQuery()
            ->with([
                'sender:id,first_name,last_name,avatar_url,organization_name,profile_type',
                'receiver:id,first_name,last_name,avatar_url,organization_name,profile_type',
            ])
            ->where('id', $transactionId)
            ->where(function (Builder $q) use ($userId) {
                $q->where(function (Builder $q2) use ($userId) {
                    $q2->where('sender_id', $userId)->where('deleted_for_sender', false);
                })->orWhere(function (Builder $q2) use ($userId) {
                    $q2->where('receiver_id', $userId)->where('deleted_for_receiver', false);
                });
            })
            ->first();

        if (! $txn) {
            // Internal federated inbound rows are recorded in the sender's tenant
            // and invisible to the tenant-scoped query above — resolve them for
            // the receiver via the receiver-scoped overlay.
            $items = $this->getInternalFederatedInbound($userId, 1, $transactionId);

            return $items[0] ?? null;
        }

        return $this->formatTransaction($txn, $userId);
    }

    /**
     * Hide (soft-delete) a transaction from a user's history.
     *
     * @return bool True on success, false if not found/not authorized
     */
    public function deleteTransaction(int $transactionId, int $userId): bool
    {
        /** @var Transaction|null $txn */
        $txn = $this->transaction->newQuery()
            ->where('id', $transactionId)
            ->where(fn (Builder $q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            ->first();

        if (! $txn) {
            return false;
        }

        if ($txn->sender_id === $userId) {
            $txn->deleted_for_sender = true;
        }
        if ($txn->receiver_id === $userId) {
            $txn->deleted_for_receiver = true;
        }

        $txn->save();

        return true;
    }

    /**
     * Search users for wallet transfer autocomplete.
     *
     * @return array Array of user summaries
     */
    public function searchUsers(int $excludeUserId, string $query, int $limit = 10): array
    {
        if (strlen($query) < 1) {
            return [];
        }

        $like = '%' . $query . '%';

        return $this->user->newQuery()
            ->where('id', '!=', $excludeUserId)
            ->where('status', '!=', 'banned')
            // Deleted accounts can't log in — credits sent to one are
            // irrecoverable, so never offer them as transfer recipients
            ->whereNull('deleted_at')
            ->where(function (Builder $q) use ($like) {
                $q->where('first_name', 'LIKE', $like)
                  ->orWhere('last_name', 'LIKE', $like)
                  ->orWhere('username', 'LIKE', $like)
                  ->orWhere('organization_name', 'LIKE', $like)
                  ->orWhereRaw("CONCAT(first_name, ' ', last_name) LIKE ?", [$like]);
            })
            ->select('id', 'first_name', 'last_name', 'username', 'avatar_url', 'organization_name', 'profile_type')
            ->limit($limit)
            ->get()
            ->map(function (User $u) {
                $name = ($u->profile_type === 'organisation' && $u->organization_name)
                    ? $u->organization_name
                    : trim($u->first_name . ' ' . $u->last_name);

                return [
                    'id'         => $u->id,
                    'username'   => $u->username,
                    'name'       => $name,
                    'first_name' => $u->first_name,
                    'last_name'  => $u->last_name,
                    'avatar'     => $u->avatar_url,
                ];
            })
            ->all();
    }

    /**
     * Format a Transaction model into the standard API response shape.
     */
    private function formatTransaction(Transaction $txn, int $userId): array
    {
        $isSender = $txn->sender_id === $userId;
        // If sender_id is null (community fund grant), the user is always the receiver
        if ($txn->sender_id === null) {
            $isSender = false;
        }
        $sender = $txn->sender;
        $receiver = $txn->receiver;

        $txnType = $txn->transaction_type ?? 'transfer';

        $formatUser = function (?User $u) use ($txnType): array {
            if (! $u) {
                // Use a meaningful label for system transactions
                $label = match ($txnType) {
                    'donation'         => __('api.wallet_counterparty_community_fund'),
                    'community_fund'   => __('api.wallet_counterparty_community_fund'),
                    'starting_balance' => __('api.wallet_counterparty_system'),
                    'admin_grant'      => __('api.wallet_counterparty_admin'),
                    'event_attendance_reward' => __('api.wallet_counterparty_community_fund'),
                    'event_attendance_reversal' => __('api.wallet_counterparty_community_fund'),
                    default            => __('api.wallet_counterparty_unknown'),
                };
                return ['id' => 0, 'name' => $label, 'avatar' => null];
            }
            $name = ($u->profile_type === 'organisation' && $u->organization_name)
                ? $u->organization_name
                : trim($u->first_name . ' ' . $u->last_name);
            return [
                'id'         => $u->id,
                'name'       => $name,
                'avatar'     => $u->avatar_url,
            ];
        };

        return [
            'id'               => $txn->id,
            'type'             => $isSender ? 'debit' : 'credit',
            'status'           => $txn->status ?? 'completed',
            'amount'           => (float) $txn->amount,
            'description'      => $txn->description,
            'transaction_type' => $txn->transaction_type ?? 'transfer',
            'sender'           => $formatUser($sender),
            'receiver'         => $formatUser($receiver),
            'other_user'       => $formatUser($isSender ? $receiver : $sender),
            'balance_after'    => null,
            'created_at'       => $txn->created_at?->toIso8601String(),
        ];
    }
}
