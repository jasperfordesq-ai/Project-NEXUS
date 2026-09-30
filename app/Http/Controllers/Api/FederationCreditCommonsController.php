<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\CreditCommonsNodeService;
use App\Services\MessageService;
use App\Services\Protocols\CreditCommonsAdapter;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SecurityBounds;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * FederationCreditCommonsController — Credit Commons-compatible endpoints.
 *
 * Implements the CC protocol's REST API so that CC nodes can query NEXUS
 * as a compatible node in the network. Endpoints match the CC OpenAPI spec
 * at https://gitlab.com/credit-commons/cc-php-lib/-/blob/0.9.x/docs/credit-commons-openapi3.yml
 *
 * Authentication: via FederationApiMiddleware (API key, HMAC, JWT, or OAuth2).
 *
 * Endpoints:
 *   GET    /api/v2/federation/cc/about                       — Node metadata
 *   GET    /api/v2/federation/cc/accounts                    — Account autocomplete
 *   GET    /api/v2/federation/cc/account                     — Trading stats (self or specified)
 *   GET    /api/v2/federation/cc/account/{acc_id}            — Trading stats by ID
 *   GET    /api/v2/federation/cc/account/history              — Balance history
 *   GET    /api/v2/federation/cc/account/history/{acc_id}     — Balance history by ID
 *   POST   /api/v2/federation/cc/transaction                 — Propose transaction
 *   GET    /api/v2/federation/cc/transactions                — List/filter transactions
 *   GET    /api/v2/federation/cc/transaction/{uuid}          — Single transaction
 *   PATCH  /api/v2/federation/cc/transaction/{uuid}/{state}  — Change transaction state
 *   GET    /api/v2/federation/cc/entries                     — List entries
 *   GET    /api/v2/federation/cc/entries/{uuid}              — Entries for a transaction
 *   GET    /api/v2/federation/cc/forms                       — Available workflows
 */
class FederationCreditCommonsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * F-345 — fallback monthly ceiling, in hours, on externally-originated
     * credit arriving at this community with no local debit.
     *
     * `federation_credit_agreements.max_monthly_credits` is nullable, and "no
     * number recorded" must not mean "unlimited" — an unbounded inbound credit
     * is counterfeit currency inside the community. An agreement that states a
     * limit always wins over this value.
     */
    private const DEFAULT_MONTHLY_INBOUND_CREDIT_HOURS = 200.0;

    // ─────────────────────────────────────────────────────────────────────────
    // GET /about — Node metadata
    // ─────────────────────────────────────────────────────────────────────────

    public function about(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();

        $nodeConfig = DB::table('federation_cc_node_config')
            ->where('tenant_id', $tenantId)
            ->first();

        $nodeSlug = $nodeConfig->node_slug ?? $this->generateNodeSlug($tenantId);
        $since = $request->query('since');

        // Gather trading stats
        $txQuery = DB::table('transactions')->where('tenant_id', $tenantId);
        if ($since) {
            $txQuery->where('created_at', '>=', $since);
        }

        $stats = $txQuery->selectRaw('
            COUNT(*) as trades,
            COUNT(DISTINCT sender_id) + COUNT(DISTINCT receiver_id) as traders,
            COALESCE(SUM(amount), 0) as volume
        ')->first();

        $accountCount = $this->discoverableFederatedAccountQuery($tenantId)->count('users.id');

        return response()->json([
            'format' => $nodeConfig->currency_format ?? '<quantity> hours',
            'rate' => (float) ($nodeConfig->exchange_rate ?? 1.0),
            'absolute_path' => $nodeConfig
                ? [$nodeConfig->parent_node_slug ?? $nodeSlug, $nodeSlug]
                : [$nodeSlug],
            'validated_window' => (int) ($nodeConfig->validated_window ?? 300),
            'trades' => (int) ($stats->trades ?? 0),
            'traders' => (int) ($stats->traders ?? 0),
            'volume' => (float) ($stats->volume ?? 0),
            'accounts' => $accountCount,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /accounts — Account autocomplete
    // ─────────────────────────────────────────────────────────────────────────

    public function accounts(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $accPath = $request->query('acc_path', '');
        $filterTag = $request->query('filter')['tag'] ?? $request->query('filter_tag');
        $limit = min((int) $request->query('limit', '10'), 50);

        $nodeSlug = $this->getNodeSlug($tenantId);

        $query = $this->discoverableFederatedAccountQuery($tenantId);

        if ($accPath) {
            // Strip node prefix if present
            $search = str_contains($accPath, '/') ? explode('/', $accPath, 2)[1] : $accPath;
            $query->where(function ($q) use ($search) {
                $q->where('users.username', 'LIKE', "{$search}%")
                    ->orWhere('users.name', 'LIKE', "{$search}%");
            });
        }

        if ($filterTag) {
            $query->where(function ($q) use ($filterTag) {
                $q->where('users.tags', 'LIKE', "%{$filterTag}%")
                    ->orWhere('users.skills', 'LIKE', "%{$filterTag}%");
            });
        }

        $users = $query->orderBy('users.username')
            ->limit($limit)
            ->get(['users.id', 'users.username', 'users.name']);

        // Return as array of account paths (CC format)
        $paths = $users->map(function ($user) use ($nodeSlug) {
            $slug = $user->username ?? "user-{$user->id}";
            return "{$nodeSlug}/{$slug}";
        })->all();

        return response()->json($paths);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /account — Trading stats (SummaryStats)
    // ─────────────────────────────────────────────────────────────────────────

    public function accountStats(Request $request, ?string $accId = null): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $since = $request->query('since');

        // Resolve user
        $userId = $accId ? $this->resolveAccountId($accId, $tenantId, true) : null;

        if ($accId && !$userId) {
            return $this->ccError('UnresolvedAccountnameViolation', "Account '{$accId}' not found", 400);
        }

        $query = DB::table('transactions')
            ->where('tenant_id', $tenantId);

        if ($since) {
            $query->where('created_at', '>=', $since);
        }

        if ($userId) {
            $query->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
            });
        }

        $stats = $query->selectRaw("
            COUNT(*) as trades,
            COALESCE(SUM(amount), 0) as volume,
            COALESCE(SUM(CASE WHEN receiver_id = ? THEN amount ELSE 0 END), 0) as gross_in,
            COALESCE(SUM(CASE WHEN sender_id = ? THEN amount ELSE 0 END), 0) as gross_out,
            COUNT(DISTINCT CASE WHEN sender_id = ? THEN receiver_id WHEN receiver_id = ? THEN sender_id END) as partners
        ", [$userId ?? 0, $userId ?? 0, $userId ?? 0, $userId ?? 0])->first();

        // Get balance
        $balance = 0.0;
        if ($userId) {
            $user = DB::table('users')->where('id', $userId)->first(['balance']);
            $balance = (float) ($user->balance ?? 0);
        }

        return response()->json([
            'balance' => $balance,
            'volume' => (float) $stats->volume,
            'gross_in' => (float) $stats->gross_in,
            'gross_out' => (float) $stats->gross_out,
            'partners' => (int) $stats->partners,
            'trades' => (int) $stats->trades,
            'entries' => (int) $stats->trades,  // We generate 1 entry per transaction
            'min' => 0,  // Would need historical tracking for accurate min/max
            'max' => 0,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /account/history — Balance history
    // ─────────────────────────────────────────────────────────────────────────

    public function accountHistory(Request $request, ?string $accId = null): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $userId = $accId ? $this->resolveAccountId($accId, $tenantId, true) : null;

        if ($accId && !$userId) {
            return $this->ccError('UnresolvedAccountnameViolation', "Account '{$accId}' not found", 400);
        }

        if (!$userId) {
            return $this->ccError('MissingParameter', 'Account ID required for history', 400);
        }

        // Build balance history from transactions (running balance reconstruction)
        $transactions = DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('status', 'completed')
            ->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
            })
            ->orderBy('created_at')
            ->get(['sender_id', 'receiver_id', 'amount', 'created_at']);

        $history = [];
        $runningBalance = 0.0;
        $min = 0;
        $max = 0;

        foreach ($transactions as $tx) {
            if ((int) $tx->receiver_id === $userId) {
                $runningBalance += (float) $tx->amount;
            } else {
                $runningBalance -= (float) $tx->amount;
            }
            $history[$tx->created_at] = round($runningBalance, 2);
            $min = min($min, $runningBalance);
            $max = max($max, $runningBalance);
        }

        return response()->json([
            'data' => $history,
            'meta' => [
                'start' => $transactions->first()->created_at ?? null,
                'end' => $transactions->last()->created_at ?? null,
                'points' => count($history),
                'min' => (int) floor($min),
                'max' => (int) ceil($max),
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /transaction — Propose a new transaction
    // ─────────────────────────────────────────────────────────────────────────

    public function createTransaction(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $payload = $request->json()->all();

        $payerPath = $payload['payer'] ?? null;
        $payeePath = $payload['payee'] ?? null;
        $quant = (float) ($payload['quant'] ?? 0);
        $description = $payload['description'] ?? '';
        $workflow = $payload['workflow'] ?? '0|PC-CE=';

        if (!$payerPath || !$payeePath || $quant <= 0) {
            return $this->ccError('MissingParameter', 'Required: payer, payee, quant > 0', 400);
        }

        // Amount bounds validation
        if (!SecurityBounds::isAcceptableHourAmount($quant)) {
            return $this->ccError('MissingParameter', 'Amount exceeds maximum', 400);
        }

        $payerId = $this->resolveAccountId($payerPath, $tenantId, true);
        $payeeId = $this->resolveAccountId($payeePath, $tenantId, true);

        if (!$payerId) {
            return $this->ccError('UnresolvedAccountnameViolation', "Payer account not found", 400);
        }
        if (!$payeeId) {
            return $this->ccError('UnresolvedAccountnameViolation', "Payee account not found", 400);
        }

        if ($blocked = $this->creditCommonsSafeguardingBlock(
            (string) $payerPath,
            (string) $payeePath,
            $tenantId,
            'credit_commons_create',
        )) {
            return $blocked;
        }

        // Idempotency: honour a caller-supplied transaction UUID so a retried
        // request is de-duplicated rather than moving credits a second time.
        $uuid = (is_string($payload['uuid'] ?? null) && $payload['uuid'] !== '')
            ? (string) $payload['uuid']
            : (string) Str::uuid();

        $existingEntry = DB::table('federation_cc_entries')
            ->where('tenant_id', $tenantId)
            ->where('transaction_uuid', $uuid)
            ->first();
        if ($existingEntry) {
            return $this->ccReplayResponse($uuid, $existingEntry);
        }

        $nodeSlug = $this->getNodeSlug($tenantId);

        // A partner's workflow is not the member's authority to debit. Every
        // local-payer transaction starts pending until the payer approves it.
        $initialState = CreditCommonsAdapter::STATE_PENDING;

        $resolvedPayerPath = $this->toAccountPath($payerId, $tenantId);
        $resolvedPayeePath = $this->toAccountPath($payeeId, $tenantId);
        if (!$this->payerMayBeDebited($payerId, $tenantId)) {
            return $this->ccError('PermissionViolation',
                'Payer has not opted into federation; their balance cannot be debited by a federated transaction', 403);
        }

        DB::beginTransaction();
        try {
            $entryId = DB::table('federation_cc_entries')->insertGetId([
                'tenant_id' => $tenantId,
                'transaction_uuid' => $uuid,
                'federation_transaction_id' => null,
                'payer' => $resolvedPayerPath,
                'payee' => $resolvedPayeePath,
                'quant' => $quant,
                'description' => $description,
                'state' => $initialState,
                'workflow' => $workflow,
                'metadata' => json_encode([
                    'local_payer_id' => $payerId,
                    'local_payee_id' => $payeeId,
                    'local_settlement' => false,
                ]),
                'written_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            app(\App\Services\FederationDebitApprovalService::class)->request(
                $tenantId, 'credit_commons', (string) $entryId, $payerId, $payeeId, $resolvedPayeePath, $quant, (string) $description
            );

            DB::commit();
        } catch (\Illuminate\Database\QueryException $e) {
            DB::rollBack();
            // Duplicate (tenant_id, transaction_uuid) — a concurrent retry won;
            // return its result idempotently rather than double-applying.
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                $dup = DB::table('federation_cc_entries')
                    ->where('tenant_id', $tenantId)
                    ->where('transaction_uuid', $uuid)
                    ->first();
                if ($dup) {
                    return $this->ccReplayResponse($uuid, $dup);
                }
            }
            Log::error('[FederationCC] Transaction failed', ['error' => $e->getMessage()]);
            return $this->ccError('Other', 'Transaction processing failed', 500);
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('[FederationCC] Transaction failed', ['error' => $e->getMessage()]);
            return $this->ccError('Other', 'Transaction processing failed', 500);
        }

        return response()->json([
            'data' => [
                'uuid' => $uuid,
                'written' => null,
                'state' => $initialState,
                'workflow' => $workflow,
                'entries' => [
                    [
                        'payer' => $resolvedPayerPath,
                        'payee' => $resolvedPayeePath,
                        'quant' => $quant,
                        'description' => $description,
                        'secs_valid_left' => 0,
                    ],
                ],
            ],
            'meta' => [
                'transitions' => CreditCommonsAdapter::STATE_TRANSITIONS[$initialState] ?? [],
            ],
        ], 201);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /transactions — List/filter transactions
    // ─────────────────────────────────────────────────────────────────────────

    public function transactions(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $limit = min((int) $request->query('limit', '25'), 100);
        $offset = max((int) $request->query('offset', '0'), 0);
        $since = $request->query('since');
        $until = $request->query('until');
        $states = $request->query('states');
        $involving = $request->query('involving');
        $payer = $request->query('payer');
        $payee = $request->query('payee');
        $sort = $request->query('sort', 'written');
        $dir = strtolower($request->query('dir', 'desc')) === 'asc' ? 'asc' : 'desc';

        $nodeSlug = $this->getNodeSlug($tenantId);

        // Query federation_cc_entries directly — this table uses CC state codes
        // (P, V, C, E, X) natively, avoiding the lossy Nexus status mapping that
        // previously collapsed P and V into the same 'pending' bucket.
        $query = DB::table('federation_cc_entries')
            ->where('tenant_id', $tenantId);

        if ($since) $query->where('created_at', '>=', $since);
        if ($until) $query->where('created_at', '<=', $until);

        if ($involving) {
            $query->where(function ($q) use ($involving) {
                $q->where('payer', 'LIKE', "%{$involving}%")
                  ->orWhere('payee', 'LIKE', "%{$involving}%");
            });
        }

        if ($payer) {
            $payerPath = $this->resolveAccountPath($payer, $tenantId);
            if ($payerPath) $query->where('payer', 'LIKE', "%{$payerPath}%");
        }

        if ($payee) {
            $payeePath = $this->resolveAccountPath($payee, $tenantId);
            if ($payeePath) $query->where('payee', 'LIKE', "%{$payeePath}%");
        }

        if ($states) {
            // CC states are single letters concatenated: "PC" = Pending + Completed, "V" = Validated only.
            // Filter by the state column directly — no lossy Nexus mapping, V and P remain distinct.
            $ccStates = str_split(strtoupper($states));
            $query->whereIn('state', $ccStates);
        }

        $orderCol = match ($sort) {
            'written', 'created' => 'created_at',
            'amount', 'quant' => 'quant',
            default => 'created_at',
        };

        $total = $query->count();
        $txs = $query->orderBy($orderCol, $dir)
            ->offset($offset)
            ->limit($limit)
            ->get();

        $results = $txs->map(function ($tx) use ($tenantId, $nodeSlug) {
            $secsValidLeft = isset($tx->validated_until)
                ? max(0, now()->diffInSeconds(Carbon::parse($tx->validated_until), false))
                : 0;
            return [
                'uuid' => $tx->transaction_uuid,
                'written' => $tx->written_at ? substr($tx->written_at, 0, 10) : null,
                'state' => $tx->state,
                'workflow' => $tx->workflow ?? '0|PC-CE=',
                'entries' => [
                    [
                        'payer' => $tx->payer,
                        'payee' => $tx->payee,
                        'quant' => (float) $tx->quant,
                        'description' => $tx->description ?? '',
                        'secs_valid_left' => $secsValidLeft,
                    ],
                ],
            ];
        })->all();

        $currentPage = ($offset / max($limit, 1)) + 1;

        return response()->json([
            'data' => $results,
            'meta' => [
                'number_of_results' => $total,
                'current_page' => (int) $currentPage,
            ],
            'links' => [
                'first' => "?offset=0&limit={$limit}",
                'last' => '?offset=' . max(0, $total - $limit) . "&limit={$limit}",
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /transaction/{uuid} — Single transaction
    // ─────────────────────────────────────────────────────────────────────────

    public function transaction(Request $request, string $uuid): JsonResponse
    {
        $tenantId = TenantContext::getId();

        // Check CC entries table first
        $entry = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$entry) {
            return $this->ccError('DoesNotExist', "Transaction {$uuid} not found", 400);
        }

        $transitions = CreditCommonsAdapter::STATE_TRANSITIONS[$entry->state] ?? [];

        $secsValidLeft = isset($entry->validated_until)
            ? max(0, now()->diffInSeconds(\Carbon\Carbon::parse($entry->validated_until), false))
            : 0;

        return response()->json([
            'data' => [
                'uuid' => $entry->transaction_uuid,
                'written' => $entry->written_at ? substr($entry->written_at, 0, 10) : null,
                'state' => $entry->state,
                'workflow' => $entry->workflow ?? '0|PC-CE=',
                'entries' => [
                    [
                        'payer' => $entry->payer,
                        'payee' => $entry->payee,
                        'quant' => (float) $entry->quant,
                        'description' => $entry->description ?? '',
                        'secs_valid_left' => $secsValidLeft,
                    ],
                ],
            ],
            'meta' => [
                'transitions' => [$uuid => $transitions],
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PATCH /transaction/{uuid}/{state} — Change transaction state
    // ─────────────────────────────────────────────────────────────────────────

    public function transitionTransaction(Request $request, string $uuid, string $destState): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $destState = strtoupper($destState);

        $entry = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$entry) {
            return $this->ccError('DoesNotExist', "Transaction {$uuid} not found", 400);
        }

        if (!CreditCommonsAdapter::isValidTransition($entry->state, $destState)) {
            return $this->ccError('InvalidStateTransition',
                "Cannot transition from {$entry->state} to {$destState}", 400);
        }

        if ($destState === CreditCommonsAdapter::STATE_COMPLETED) {
            return $this->completeTransactionEntry($entry, $tenantId, 201);
        }

        $updates = [
            'state' => $destState,
            'updated_at' => now(),
        ];

        if ($destState === CreditCommonsAdapter::STATE_ERASED) {
            // Only entries with recorded local settlement may change local balances.
            if ($entry->state === CreditCommonsAdapter::STATE_COMPLETED) {
                $accounts = json_decode((string) ($entry->metadata ?? ''), true);
                if (!is_array($accounts) || !array_key_exists('local_payer_id', $accounts)
                    || !array_key_exists('local_payee_id', $accounts)
                    || !is_bool($accounts['local_settlement'] ?? null)) {
                    return $this->ccError('PermissionViolation', 'Transaction requires verified settlement history', 403);
                }
                $locallySettled = $accounts['local_settlement'];
                $reversalPayerId = $accounts['local_payee_id'] === null ? null : (int) $accounts['local_payee_id'];
                $reversalPayeeId = $accounts['local_payer_id'] === null ? null : (int) $accounts['local_payer_id'];
                if (!$locallySettled && ($reversalPayerId || $reversalPayeeId)) {
                    return $this->ccError('PermissionViolation', 'Transaction has no verified local settlement', 403);
                }
                if ($reversalPayerId) {
                    if (!$this->payerMayBeDebited($reversalPayerId, $tenantId)) {
                        return $this->ccError('PermissionViolation', 'Payee has not enabled federated transactions', 403);
                    }
                    app(\App\Services\FederationDebitApprovalService::class)->request(
                        $tenantId, 'credit_commons_reversal', (string) $entry->id,
                        $reversalPayerId, $reversalPayeeId, (string) $entry->payer,
                        (float) $entry->quant, (string) ($entry->description ?? '')
                    );
                }
                DB::beginTransaction();
                try {
                    // Atomically claim C→E first: with two concurrent erases of
                    // the same UUID, only one may reverse balances (the
                    // reversal UPDATEs are unconditional and would double-apply).
                    $claimed = DB::table('federation_cc_entries')
                        ->where('id', $entry->id)
                        ->where('state', CreditCommonsAdapter::STATE_COMPLETED)
                        ->update($updates);
                    if ($claimed === 0) {
                        DB::rollBack();
                        return $this->ccError('InvalidStateTransition',
                            "Cannot transition from {$entry->state} to E (transaction was concurrently transitioned)", 400);
                    }

                    if ($reversalPayerId && !app(\App\Services\FederationDebitApprovalService::class)->consume(
                        $tenantId, 'credit_commons_reversal', (string) $entry->id,
                        $reversalPayerId, $reversalPayeeId, (string) $entry->payer,
                        (float) $entry->quant, (string) ($entry->description ?? '')
                    )) {
                        DB::rollBack();
                        return $this->ccError('PermissionViolation', 'Payee approval is required for this reversal', 403);
                    }

                    if ($reversalPayerId && $reversalPayeeId) {
                        $blocked = $this->creditCommonsSafeguardingBlock(
                            (string) $entry->payee, (string) $entry->payer, $tenantId,
                            'credit_commons_reversal',
                            ['payer' => $reversalPayerId, 'payee' => $reversalPayeeId], true
                        );
                        if ($blocked) {
                            DB::rollBack();
                            return $blocked;
                        }
                    }

                    if ($locallySettled && !$this->reverseTransaction(
                        $entry, $tenantId, $reversalPayeeId, $reversalPayerId
                    )) {
                        DB::rollBack();
                        return $this->ccError('InsufficientBalance', 'Payee has insufficient balance for reversal', 400);
                    }

                    DB::commit();
                } catch (\Throwable $e) {
                    DB::rollBack();
                    return $this->ccError('InternalError', 'Failed to erase transaction: ' . $e->getMessage(), 500);
                }

                return response()->json([
                    'data' => [
                        'uuid' => $uuid,
                        'state' => $destState,
                    ],
                ], 201);
            }
        }

        // Scrub = delete the record entirely
        if ($destState === CreditCommonsAdapter::STATE_SCRUBBED) {
            DB::table('federation_cc_entries')
                ->where('id', $entry->id)
                ->delete();

            return response()->json(null, 204);
        }

        // Conditioned on the state we validated so a concurrent transition
        // can't be silently overwritten (last-writer-wins race).
        $transitioned = DB::table('federation_cc_entries')
            ->where('id', $entry->id)
            ->where('state', $entry->state)
            ->update($updates);
        if ($transitioned === 0) {
            return $this->ccError('InvalidStateTransition',
                "Cannot transition from {$entry->state} to {$destState} (transaction was concurrently transitioned)", 400);
        }

        return response()->json([
            'data' => [
                'uuid' => $uuid,
                'state' => $destState,
            ],
        ], 201);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /entries — List entries (double-entry view)
    // ─────────────────────────────────────────────────────────────────────────

    public function entries(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $limit = min((int) $request->query('limit', '25'), 100);
        $offset = max((int) $request->query('offset', '0'), 0);
        $involving = $request->query('involving');
        $since = $request->query('since');
        $until = $request->query('until');

        $query = DB::table('federation_cc_entries')
            ->where('tenant_id', $tenantId);

        if ($involving) {
            $query->where(function ($q) use ($involving) {
                $q->where('payer', 'LIKE', "%{$involving}%")
                    ->orWhere('payee', 'LIKE', "%{$involving}%");
            });
        }

        if ($since) $query->where('created_at', '>=', $since);
        if ($until) $query->where('created_at', '<=', $until);

        $total = $query->count();
        $rows = $query->orderByDesc('created_at')
            ->offset($offset)
            ->limit($limit)
            ->get();

        $results = $rows->map(function ($entry) {
            $secsValidLeft = isset($entry->validated_until)
                ? max(0, now()->diffInSeconds(Carbon::parse($entry->validated_until), false))
                : 0;
            return [
                'uuid' => $entry->transaction_uuid,
                'payer' => $entry->payer,
                'payee' => $entry->payee,
                'quant' => (float) $entry->quant,
                'description' => $entry->description ?? '',
                'author' => $entry->author ?? $entry->payer,
                'written' => $entry->written_at,
                'workflow' => $entry->workflow ?? '0|PC-CE=',
                'state' => $entry->state,
                'secs_valid_left' => $secsValidLeft,
                'metadata' => $entry->metadata ? json_decode($entry->metadata, true) : null,
            ];
        })->all();

        return response()->json([
            'data' => $results,
            'meta' => [
                'number_of_results' => $total,
                'current_page' => ($offset / max($limit, 1)) + 1,
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /entries/{uuid} — Entries for a specific transaction
    // ─────────────────────────────────────────────────────────────────────────

    public function transactionEntries(Request $request, string $uuid): JsonResponse
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->where('tenant_id', $tenantId)
            ->get();

        if ($rows->isEmpty()) {
            return $this->ccError('DoesNotExist', "No entries for transaction {$uuid}", 400);
        }

        $results = $rows->map(function ($entry) {
            $secsValidLeft = isset($entry->validated_until)
                ? max(0, now()->diffInSeconds(Carbon::parse($entry->validated_until), false))
                : 0;
            return [
                'uuid' => $entry->transaction_uuid,
                'payer' => $entry->payer,
                'payee' => $entry->payee,
                'quant' => (float) $entry->quant,
                'description' => $entry->description ?? '',
                'author' => $entry->author ?? $entry->payer,
                'written' => $entry->written_at,
                'workflow' => $entry->workflow ?? '0|PC-CE=',
                'state' => $entry->state,
                'secs_valid_left' => $secsValidLeft,
                'metadata' => $entry->metadata ? json_decode($entry->metadata, true) : null,
            ];
        })->all();

        return response()->json([
            'data' => $results,
            'meta' => [
                'number_of_results' => count($results),
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /forms — Available transaction workflows
    // ─────────────────────────────────────────────────────────────────────────

    public function forms(Request $request): JsonResponse
    {
        // NEXUS supports a simple payment workflow
        return response()->json([
            '0|PC-CE=' => [
                'label' => 'Standard Payment',
                'summary' => 'Direct payment from payer to payee, immediately completed',
                'code' => '0|PC-CE=',
                'labels' => [
                    'P' => 'Pending',
                    'C' => 'Completed',
                    'E' => 'Erased',
                ],
            ],
            '+|PPC-PE+CE-' => [
                'label' => 'Approved Payment',
                'summary' => 'Payment requires validation before completion',
                'code' => '+|PPC-PE+CE-',
                'labels' => [
                    'P' => 'Pending',
                    'V' => 'Validated',
                    'C' => 'Completed',
                    'E' => 'Erased',
                ],
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /transaction/relay — Relay transaction through the node tree
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * POST /transaction/relay — Receive a relayed transaction from another CC node.
     *
     * CC relay rules:
     *   - If the payee is local, process the transaction locally
     *   - If the payee is remote, forward to the next node in the tree
     *   - Verify the Last-hash header for hashchain integrity
     */
    public function relayTransaction(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $payload = $request->json()->all();

        // Verify hashchain
        $remoteHash = $request->header('Last-hash');
        if (!CreditCommonsNodeService::verifyHash($remoteHash, $tenantId)) {
            return $this->ccError('HashMismatch',
                'Hashchain verification failed — last hashes do not match', 500);
        }

        $payerPath = $payload['payer'] ?? null;
        $payeePath = $payload['payee'] ?? null;
        $quant = (float) ($payload['quant'] ?? 0);
        $description = $payload['description'] ?? '';
        $workflow = $payload['workflow'] ?? '0|PC-CE=';

        if (!$payerPath || !$payeePath || $quant <= 0) {
            return $this->ccError('MissingParameter', 'Required: payer, payee, quant > 0', 400);
        }

        if (!SecurityBounds::isAcceptableHourAmount($quant)) {
            return $this->ccError('MissingParameter', 'Amount exceeds maximum', 400);
        }

        if (CreditCommonsNodeService::isLocalAccount((string) $payerPath, $tenantId)) {
            return $this->ccError('PermissionViolation',
                'Local payer transfers must use a member-approved proposal', 403);
        }

        $payeeIsLocal = CreditCommonsNodeService::isLocalAccount($payeePath, $tenantId);

        if ($payeeIsLocal) {
            // Payee is on this node — process locally
            $payeeId = $this->resolveAccountId(
                CreditCommonsAdapter::extractUsername($payeePath), $tenantId
            );

            if (!$payeeId) {
                return $this->ccError('UnresolvedAccountnameViolation',
                    "Payee '{$payeePath}' not found on this node", 400);
            }
            if (!$this->localAccountCanTransact($payeeId, $tenantId)) {
                return $this->ccError('PermissionViolation',
                    'Payee does not accept federated transactions', 403);
            }

            if ($blocked = $this->creditCommonsSafeguardingBlock(
                (string) $payerPath,
                (string) $payeePath,
                $tenantId,
                'credit_commons_relay',
            )) {
                return $blocked;
            }

            // Idempotency: a relayed transaction carries the originating node's
            // UUID. A repeat delivery of the same UUID must NOT credit the payee
            // again — return the previously recorded result instead of re-applying.
            $uuid = (is_string($payload['uuid'] ?? null) && $payload['uuid'] !== '')
                ? (string) $payload['uuid']
                : (string) Str::uuid();

            $existing = DB::table('federation_cc_entries')
                ->where('tenant_id', $tenantId)
                ->where('transaction_uuid', $uuid)
                ->first();
            if ($existing) {
                return $this->ccReplayResponse($uuid, $existing);
            }

            DB::beginTransaction();
            try {
                // F-345: this branch credits a local member with no local debit
                // — correctly, because the debit belongs to the remote node —
                // so the only thing bounding how much value a partner can
                // introduce is this ceiling. Inside the transaction, because it
                // locks the agreement row to serialise concurrent relays.
                if ($refusal = $this->inboundCreditCeilingRefusal($tenantId, $quant)) {
                    DB::rollBack();
                    return $refusal;
                }

                // Credit the local payee
                DB::update("UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                    [$quant, $payeeId, $tenantId]);
                $this->recordFederatedTransactionLedger($tenantId, null, $payeeId, $quant, $description);

                // Record the CC entry. The UNIQUE(tenant_id, transaction_uuid)
                // index makes a concurrent duplicate delivery fail here (caught
                // below) rather than double-credit.
                DB::table('federation_cc_entries')->insert([
                    'tenant_id' => $tenantId,
                    'transaction_uuid' => $uuid,
                    'payer' => $payerPath,
                    'payee' => $payeePath,
                    'quant' => $quant,
                    'description' => $description,
                    'state' => CreditCommonsAdapter::STATE_COMPLETED,
                    'workflow' => $workflow,
                    'metadata' => json_encode([
                        'local_payer_id' => null,
                        'local_payee_id' => $payeeId,
                        'local_settlement' => true,
                    ]),
                    'author' => $payerPath,
                    'written_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                // Advance hashchain
                $newHash = CreditCommonsNodeService::advanceHashchain(
                    $tenantId, $uuid, $quant, $payerPath, $payeePath
                );

                DB::commit();

                return response()->json([
                    'data' => [
                        'uuid' => $uuid,
                        'written' => now()->format('Y-m-d'),
                        'state' => CreditCommonsAdapter::STATE_COMPLETED,
                        'workflow' => $workflow,
                        'entries' => [[
                            'payer' => $payerPath,
                            'payee' => $payeePath,
                            'quant' => $quant,
                            'description' => $description,
                        ]],
                    ],
                    'meta' => ['transitions' => []],
                ], 201, ['Last-hash' => $newHash]);
            } catch (\Illuminate\Database\QueryException $e) {
                DB::rollBack();
                // Concurrent duplicate delivery hit the unique constraint — the
                // first delivery won; return its result idempotently (no re-credit).
                if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                    $dup = DB::table('federation_cc_entries')
                        ->where('tenant_id', $tenantId)
                        ->where('transaction_uuid', $uuid)
                        ->first();
                    if ($dup) {
                        return $this->ccReplayResponse($uuid, $dup);
                    }
                }
                Log::error('[FederationCC] Relay local processing failed', ['error' => $e->getMessage()]);
                return $this->ccError('Other', 'Relay processing failed', 500);
            } catch (\Throwable $e) {
                DB::rollBack();
                Log::error('[FederationCC] Relay local processing failed', ['error' => $e->getMessage()]);
                return $this->ccError('Other', 'Relay processing failed', 500);
            }
        }

        // Payee is remote — forward to the next node.
        // Idempotency FIRST (mirrors the local-payee branch): a replayed relay
        // must not re-forward downstream — the forward is the side effect.
        $incomingUuid = (is_string($payload['uuid'] ?? null) && $payload['uuid'] !== '')
            ? (string) $payload['uuid']
            : null;
        if ($incomingUuid) {
            $existing = DB::table('federation_cc_entries')
                ->where('tenant_id', $tenantId)
                ->where('transaction_uuid', $incomingUuid)
                ->first();
            if ($existing) {
                return $this->ccReplayResponse($incomingUuid, $existing);
            }
        }

        $relayResult = CreditCommonsNodeService::relayTransaction($payload, $tenantId);

        if (!$relayResult['success']) {
            return $this->ccError('UnavailableNode',
                $relayResult['error'] ?? 'Failed to relay transaction', 500);
        }

        // Record the relay in our entries for audit. A concurrent duplicate
        // delivery hits UNIQUE(tenant_id, transaction_uuid) — answer
        // idempotently instead of surfacing a 500 after the forward fired.
        $uuid = $relayResult['data']['uuid'] ?? ($incomingUuid ?? (string) Str::uuid());
        try {
            DB::table('federation_cc_entries')->insert([
                'tenant_id' => $tenantId,
                'transaction_uuid' => $uuid,
                'payer' => $payerPath,
                'payee' => $payeePath,
                'quant' => $quant,
                'description' => $description,
                'state' => CreditCommonsAdapter::STATE_COMPLETED,
                'workflow' => $workflow,
                'metadata' => json_encode([
                    'local_payer_id' => null,
                    'local_payee_id' => null,
                    'local_settlement' => false,
                ]),
                'author' => $payerPath,
                'written_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) !== 1062) {
                throw $e;
            }
            $dup = DB::table('federation_cc_entries')
                ->where('tenant_id', $tenantId)
                ->where('transaction_uuid', $uuid)
                ->first();
            if ($dup) {
                return $this->ccReplayResponse($uuid, $dup);
            }
        }

        // Advance hashchain for the relay hop
        $newHash = CreditCommonsNodeService::advanceHashchain(
            $tenantId, $uuid, $quant, $payerPath, $payeePath
        );

        $responseData = $relayResult['data'] ?? [];
        return response()->json($responseData, 201, ['Last-hash' => $newHash]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /transactions/propose — External node proposes a pending transaction
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * POST /transactions/propose — Accept a proposed transaction from a remote CC node.
     *
     * Creates a federation_cc_entries row in STATE_PENDING without mutating balances.
     * Returns the proposal UUID. Subsequent calls to /transactions/{uuid}/validate and
     * /transactions/{uuid}/commit advance the state machine.
     */
    public function proposeTransaction(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $payload = $request->json()->all();

        // Optional hashchain verification if a Last-hash header is present
        $remoteHash = $request->header('Last-hash');
        if (!CreditCommonsNodeService::verifyHash($remoteHash, $tenantId)) {
            return $this->ccError('HashMismatch',
                'Hashchain verification failed — last hashes do not match', 500);
        }

        $payerPath = $payload['payer'] ?? null;
        $payeePath = $payload['payee'] ?? null;
        $quant = (float) ($payload['quant'] ?? 0);
        $description = $payload['description'] ?? '';
        $workflow = $payload['workflow'] ?? '+|PPC-PE+CE-';

        if (!$payerPath || !$payeePath || $quant <= 0) {
            return $this->ccError('MissingParameter', 'Required: payer, payee, quant > 0', 400);
        }

        if (!SecurityBounds::isAcceptableHourAmount($quant)) {
            return $this->ccError('MissingParameter', 'Amount exceeds maximum', 400);
        }

        if ($blocked = $this->creditCommonsSafeguardingBlock(
            (string) $payerPath,
            (string) $payeePath,
            $tenantId,
            'credit_commons_propose',
        )) {
            return $blocked;
        }

        $localPayerId = $this->resolveAccountId((string) $payerPath, $tenantId);
        if ($localPayerId && !$this->payerMayBeDebited($localPayerId, $tenantId)) {
            return $this->ccError('PermissionViolation',
                'Payer has not enabled federated transactions', 403);
        }
        $localPayeeId = $this->resolveAccountId((string) $payeePath, $tenantId);
        if (CreditCommonsNodeService::isLocalAccount((string) $payeePath, $tenantId) && !$localPayeeId) {
            return $this->ccError('UnresolvedAccountnameViolation', 'Local payee account not found', 400);
        }

        // Honour a caller-supplied UUID (like createTransaction and relay do)
        // so a replayed propose is idempotent instead of accumulating duplicate
        // independently-committable PENDING proposals.
        $uuid = (is_string($payload['uuid'] ?? null) && $payload['uuid'] !== '')
            ? (string) $payload['uuid']
            : (string) Str::uuid();

        $existing = DB::table('federation_cc_entries')
            ->where('tenant_id', $tenantId)
            ->where('transaction_uuid', $uuid)
            ->first();
        if ($existing) {
            return $this->ccReplayResponse($uuid, $existing);
        }

        try {
            DB::beginTransaction();
            $entryId = DB::table('federation_cc_entries')->insertGetId([
                'tenant_id' => $tenantId,
                'transaction_uuid' => $uuid,
                'federation_transaction_id' => null,
                'payer' => $payerPath,
                'payee' => $payeePath,
                'quant' => $quant,
                'description' => $description,
                'state' => CreditCommonsAdapter::STATE_PENDING,
                'workflow' => $workflow,
                'metadata' => json_encode([
                    'local_payer_id' => $localPayerId,
                    'local_payee_id' => $localPayeeId,
                    'local_settlement' => false,
                ]),
                'author' => $payerPath,
                'written_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $payerId = $this->resolveAccountId((string) $payerPath, $tenantId);
            if ($payerId) {
                $payeeId = $this->resolveAccountId((string) $payeePath, $tenantId);
                app(\App\Services\FederationDebitApprovalService::class)->request(
                    $tenantId, 'credit_commons', (string) $entryId, $payerId, $payeeId,
                    (string) $payeePath, $quant, (string) $description
                );
            }
            DB::commit();
        } catch (\Illuminate\Database\QueryException $e) {
            DB::rollBack();
            if ((int) ($e->errorInfo[1] ?? 0) !== 1062) {
                throw $e;
            }
            $dup = DB::table('federation_cc_entries')
                ->where('tenant_id', $tenantId)
                ->where('transaction_uuid', $uuid)
                ->first();
            if ($dup) {
                return $this->ccReplayResponse($uuid, $dup);
            }
            throw $e;
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return response()->json([
            'data' => [
                'uuid' => $uuid,
                'state' => CreditCommonsAdapter::STATE_PENDING,
                'workflow' => $workflow,
                'entries' => [[
                    'payer' => $payerPath,
                    'payee' => $payeePath,
                    'quant' => $quant,
                    'description' => $description,
                ]],
            ],
            'meta' => [
                'transitions' => CreditCommonsAdapter::STATE_TRANSITIONS[CreditCommonsAdapter::STATE_PENDING] ?? [],
            ],
        ], 201);
    }

    /**
     * POST /transactions/{id}/validate — External node signs/approves the proposal.
     *
     * Transitions from pending (P) → validated (V).
     */
    public function validateTransaction(Request $request, string $uuid): JsonResponse
    {
        $tenantId = TenantContext::getId();

        $entry = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$entry) {
            return $this->ccError('DoesNotExist', "Transaction {$uuid} not found", 400);
        }

        if (!CreditCommonsAdapter::isValidTransition($entry->state, CreditCommonsAdapter::STATE_VALIDATED)) {
            return $this->ccError('InvalidStateTransition',
                "Cannot transition from {$entry->state} to V", 400);
        }

        DB::table('federation_cc_entries')
            ->where('id', $entry->id)
            ->update([
                'state' => CreditCommonsAdapter::STATE_VALIDATED,
                'updated_at' => now(),
            ]);

        return response()->json([
            'data' => [
                'uuid' => $uuid,
                'state' => CreditCommonsAdapter::STATE_VALIDATED,
            ],
        ], 200);
    }

    /**
     * POST /transactions/{id}/commit — Final commit, applies balance changes and
     * advances hashchain. Transitions from validated (V) → completed (C).
     */
    public function commitTransaction(Request $request, string $uuid): JsonResponse
    {
        $tenantId = TenantContext::getId();

        $entry = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$entry) {
            return $this->ccError('DoesNotExist', "Transaction {$uuid} not found", 400);
        }

        if (!CreditCommonsAdapter::isValidTransition($entry->state, CreditCommonsAdapter::STATE_COMPLETED)) {
            return $this->ccError('InvalidStateTransition',
                "Cannot transition from {$entry->state} to C", 400);
        }

        return $this->completeTransactionEntry($entry, $tenantId, 200);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Build a CC error response (CCViolation or CCFailure format).
     */
    private function ccError(string $class, string $detail, int $status): JsonResponse
    {
        $type = $status >= 500 ? 'CCFailure' : 'CCViolation';
        $nodeSlug = $this->getNodeSlug(TenantContext::getId());

        return response()->json([
            'class' => $class,
            'node' => $nodeSlug,
            'detail' => $detail,
        ], $status);
    }

    /**
     * Get or generate the CC node slug for a tenant.
     */
    private function getNodeSlug(int $tenantId): string
    {
        $config = DB::table('federation_cc_node_config')
            ->where('tenant_id', $tenantId)
            ->value('node_slug');

        return $config ?: $this->generateNodeSlug($tenantId);
    }

    /**
     * Generate a CC-compatible node slug from the tenant.
     */
    private function generateNodeSlug(int $tenantId): string
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first(['slug', 'name']);

        if ($tenant && $tenant->slug) {
            return Str::substr(Str::slug($tenant->slug), 0, 15);
        }

        if ($tenant && $tenant->name) {
            return Str::substr(Str::slug($tenant->name), 0, 15);
        }

        return "nexus-t{$tenantId}";
    }

    /**
     * Convert a user ID to a CC account path.
     */
    private function toAccountPath(int $userId, int $tenantId): string
    {
        $nodeSlug = $this->getNodeSlug($tenantId);

        $username = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('username');

        return $nodeSlug . '/' . ($username ?? "user-{$userId}");
    }

    /**
     * Idempotent-replay response for an already-recorded CC transaction.
     * Returned (HTTP 200) when a relay/create is delivered again for a UUID that
     * has already been processed — so no balance change is applied a second time.
     */
    private function ccReplayResponse(string $uuid, object $existing): JsonResponse
    {
        return response()->json([
            'data' => [
                'uuid' => $uuid,
                'state' => $existing->state,
                'workflow' => $existing->workflow,
                'entries' => [[
                    'payer' => $existing->payer,
                    'payee' => $existing->payee,
                    'quant' => (float) $existing->quant,
                    'description' => $existing->description,
                ]],
            ],
            'meta' => ['transitions' => [], 'idempotent_replay' => true],
        ], 200);
    }

    /**
     * Federation consent gate: a local member's balance may only be touched by a
     * federated transaction when they have opted in and enabled federated
     * transactions.
     */
    private function payerMayBeDebited(int $payerId, int $tenantId): bool
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.id', $payerId)
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('fus.federation_optin', 1)
            ->where('fus.transactions_enabled_federated', 1)
            ->exists();
    }

    private function localAccountCanTransact(int $userId, int $tenantId): bool
    {
        return $this->payerMayBeDebited($userId, $tenantId);
    }

    private function discoverableFederatedAccountQuery(int $tenantId)
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->where('fus.transactions_enabled_federated', 1);
    }

    /**
     * Apply the local recipient's safeguarding policy before any Credit
     * Commons description, proposal, ledger entry, or balance movement lands.
     */
    private function creditCommonsSafeguardingBlock(
        string $payerPath,
        string $payeePath,
        int $tenantId,
        string $channel,
        ?array $localAccounts = null,
        bool $locked = false,
    ): ?JsonResponse {
        if ($localAccounts === null && !CreditCommonsNodeService::isLocalAccount($payeePath, $tenantId)) {
            return null;
        }

        $payeeId = $localAccounts === null
            ? $this->resolveAccountId($payeePath, $tenantId)
            : $localAccounts['payee'];
        if ($payeeId === null) {
            return null;
        }

        $policy = app(SafeguardingInteractionPolicy::class);
        if ($localAccounts !== null ? $localAccounts['payer'] !== null : CreditCommonsNodeService::isLocalAccount($payerPath, $tenantId)) {
            $payerId = $localAccounts === null
                ? $this->resolveAccountId($payerPath, $tenantId)
                : $localAccounts['payer'];
            if ($payerId === null) {
                return null;
            }
            $decision = $locked
                ? $policy->evaluateLockedLocalContact($payerId, $payeeId, $tenantId, $channel)
                : $policy->evaluateLocalContact($payerId, $payeeId, $tenantId, $channel);
        } else {
            $decision = $policy->evaluateExternalContact(
                $payeeId,
                $tenantId,
                'credit-commons:' . hash('sha256', $payerPath),
                $channel,
            );
        }

        if ($decision->isAllowed()) {
            return null;
        }

        $error = MessageService::buildSafeguardingError([
            'status' => $decision->status,
            'code' => $decision->code,
            'required_vetting_types' => $decision->requiredAttestationCodes,
            'required_vetting_labels' => $decision->requiredAttestationLabels,
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ]);

        return $this->ccError(
            $decision->code,
            (string) $error['message'],
            $decision->isUnavailable() ? 503 : 403,
        );
    }

    /**
     * Resolve a CC account path or ID to a NEXUS user ID.
     *
     * Accepts: "node-slug/username", "username", or numeric user ID.
     */
    private function resolveAccountId(string $accountRef, int $tenantId, bool $requireFederatedAccount = false): ?int
    {
        $baseQuery = $requireFederatedAccount
            ? $this->discoverableFederatedAccountQuery($tenantId)
            : DB::table('users')
                ->where('users.tenant_id', $tenantId)
                ->where('users.status', 'active');

        // If numeric, treat as user ID
        if (is_numeric($accountRef)) {
            $exists = (clone $baseQuery)
                ->where('users.id', (int) $accountRef)
                ->exists();
            return $exists ? (int) $accountRef : null;
        }

        if (str_contains($accountRef, '/')) {
            [$node, $username] = explode('/', $accountRef, 2);
            if ($node !== $this->getNodeSlug($tenantId)) {
                return null;
            }
        } else {
            $username = $accountRef;
        }

        $user = (clone $baseQuery)
            ->where('users.username', $username)
            ->first(['users.id']);

        return $user ? (int) $user->id : null;
    }

    private function completeTransactionEntry(object $entry, int $tenantId, int $status): JsonResponse
    {
        $uuid = (string) $entry->transaction_uuid;
        $accounts = json_decode((string) ($entry->metadata ?? ''), true);
        if (!is_array($accounts) || !array_key_exists('local_payer_id', $accounts)
            || !array_key_exists('local_payee_id', $accounts) || ($accounts['local_settlement'] ?? null) !== false) {
            return $this->ccError('PermissionViolation', 'Transaction requires a verified local account binding', 403);
        }
        $payerId = $accounts['local_payer_id'] === null ? null : (int) $accounts['local_payer_id'];
        $payeeId = $accounts['local_payee_id'] === null ? null : (int) $accounts['local_payee_id'];
        $quant = (float) $entry->quant;

        if (CreditCommonsNodeService::isLocalAccount((string) $entry->payer, $tenantId) !== ($payerId !== null)
            || CreditCommonsNodeService::isLocalAccount((string) $entry->payee, $tenantId) !== ($payeeId !== null)) {
            return $this->ccError('PermissionViolation', 'Transaction account binding is invalid', 403);
        }

        if (!SecurityBounds::isAcceptableHourAmount($quant)) {
            return $this->ccError('MissingParameter', 'Amount exceeds maximum', 400);
        }

        if (!$payerId && $payeeId) {
            return $this->ccError('PermissionViolation',
                'Remote-only payer cannot credit a local payee without a local debit branch', 403);
        }
        if ($payerId && !$this->payerMayBeDebited($payerId, $tenantId)) {
            return $this->ccError('PermissionViolation',
                'Payer has not enabled federated transactions; their balance cannot be debited by a federated transaction', 403);
        }
        if ($payeeId && !$this->localAccountCanTransact($payeeId, $tenantId)) {
            return $this->ccError('PermissionViolation',
                'Payee does not accept federated transactions', 403);
        }

        if ($blocked = $this->creditCommonsSafeguardingBlock(
            (string) $entry->payer,
            (string) $entry->payee,
            $tenantId,
            'credit_commons_complete',
            ['payer' => $payerId, 'payee' => $payeeId],
        )) {
            return $blocked;
        }

        DB::beginTransaction();
        try {
            $writtenAt = now();
            $claimed = DB::table('federation_cc_entries')
                ->where('id', $entry->id)
                ->where('state', $entry->state)
                ->update([
                    'state' => CreditCommonsAdapter::STATE_COMPLETED,
                    'metadata' => json_encode(array_merge($accounts, ['local_settlement' => true])),
                    'written_at' => $writtenAt,
                    'updated_at' => $writtenAt,
                ]);
            if ($claimed === 0) {
                DB::rollBack();
                return $this->ccError('InvalidStateTransition',
                    "Cannot transition from {$entry->state} to C (transaction was concurrently transitioned)", 400);
            }

            if ($payerId && $payeeId) {
                $blocked = $this->creditCommonsSafeguardingBlock(
                    (string) $entry->payer, (string) $entry->payee, $tenantId,
                    'credit_commons_complete', ['payer' => $payerId, 'payee' => $payeeId], true
                );
                if ($blocked) {
                    DB::rollBack();
                    return $blocked;
                }
            }

            if ($payerId) {
                if (!app(\App\Services\FederationDebitApprovalService::class)->consume(
                    $tenantId, 'credit_commons', (string) $entry->id, $payerId, $payeeId, (string) $entry->payee,
                    $quant, (string) ($entry->description ?? '')
                )) {
                    DB::rollBack();
                    return $this->ccError('PermissionViolation', 'Payer approval is required for this transfer', 403);
                }
                $updated = DB::update(
                    "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND status = 'active' AND balance >= ?",
                    [$quant, $payerId, $tenantId, $quant]
                );
                if ($updated === 0) {
                    DB::rollBack();
                    return $this->ccError('InsufficientBalance', 'Payer has insufficient balance', 400);
                }
            }
            if ($payeeId) {
                $credited = DB::update(
                    "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ? AND status = 'active'",
                    [$quant, $payeeId, $tenantId]
                );
                if ($credited !== 1) {
                    DB::rollBack();
                    return $this->ccError('PermissionViolation', 'Payee is unavailable', 403);
                }
            }

            $this->recordFederatedTransactionLedger(
                $tenantId,
                $payerId,
                $payeeId,
                $quant,
                (string) ($entry->description ?? '')
            );

            $newHash = CreditCommonsNodeService::advanceHashchain(
                $tenantId, $uuid, $quant, (string) $entry->payer, (string) $entry->payee
            );

            DB::commit();

            return response()->json([
                'data' => [
                    'uuid' => $uuid,
                    'state' => CreditCommonsAdapter::STATE_COMPLETED,
                    'written' => $writtenAt->format('Y-m-d'),
                ],
            ], $status, ['Last-hash' => $newHash]);
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('[FederationCC] Completion failed', ['error' => $e->getMessage()]);
            return $this->ccError('Other', 'Completion processing failed', 500);
        }
    }

    /**
     * F-345 — the aggregate ceiling on externally-originated credit.
     *
     * A relayed transfer credits a local member with no matching local debit,
     * so nothing on this installation balances it. `SecurityBounds` caps a
     * single transfer at 24 hours; before this check nothing capped the total,
     * and a partner repeated the call with a fresh UUID.
     *
     * The bound is `federation_credit_agreements` — the same table the other
     * two inbound protocols already use, rather than a new mechanism. The
     * legacy v1 path refuses outright without an active agreement
     * (`FederationController::createTransaction`) and Komunitin derives its
     * published credit limit from `max_monthly_credits` on the row whose
     * `to_tenant_id` is this community (`FederationKomunitinController`).
     * Credit Commons now reads the same row and enforces it as a real monthly
     * total.
     *
     * Scope note: the ceiling is per community, not per partner, because
     * `federation_cc_entries` has no partner column and a community has one
     * Credit Commons parent node. If a second CC partner is ever added this
     * needs a per-partner column to stay meaningful.
     *
     * Only this relay branch can introduce unbacked credit.
     * `completeTransactionEntry()` already refuses a remote-only payer crediting
     * a local payee, so it cannot reach this shape.
     *
     * 🔴 Call with a database transaction open. The agreement row is locked so
     * two concurrent relays cannot both read the same "already credited" total
     * and both pass it.
     */
    private function inboundCreditCeilingRefusal(int $tenantId, float $quant): ?JsonResponse
    {
        $agreement = DB::table('federation_credit_agreements')
            ->where('to_tenant_id', $tenantId)
            ->where('status', 'active')
            ->orderBy('id')
            ->lockForUpdate()
            ->first(['id', 'max_monthly_credits']);

        if (!$agreement) {
            Log::warning('[FederationCC] Inbound credit refused: no active credit agreement', [
                'tenant_id' => $tenantId,
                'quant' => $quant,
            ]);

            return $this->ccError(
                'PermissionViolation',
                'No active credit agreement authorises inbound credit to this community',
                403
            );
        }

        $ceiling = $agreement->max_monthly_credits === null
            ? self::DEFAULT_MONTHLY_INBOUND_CREDIT_HOURS
            : (float) $agreement->max_monthly_credits;

        // Every federated credit this month that carried no local debit — the
        // exact shape recordFederatedTransactionLedger() writes on this path.
        $alreadyCredited = (float) DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('is_federated', 1)
            ->whereNull('sender_id')
            ->where('created_at', '>=', Carbon::now()->startOfMonth())
            ->sum('amount');

        if ($alreadyCredited + $quant > $ceiling) {
            Log::warning('[FederationCC] Inbound credit refused: monthly ceiling reached', [
                'tenant_id' => $tenantId,
                'agreement_id' => (int) $agreement->id,
                'ceiling_hours' => $ceiling,
                'already_credited_hours' => $alreadyCredited,
                'requested_hours' => $quant,
            ]);

            return $this->ccError(
                'PermissionViolation',
                'Inbound credit would exceed this community\'s monthly credit ceiling',
                403
            );
        }

        return null;
    }

    private function recordFederatedTransactionLedger(
        int $tenantId,
        ?int $payerId,
        ?int $payeeId,
        float $quant,
        string $description
    ): void {
        if (!$payerId && !$payeeId) {
            return;
        }

        DB::table('transactions')->insertGetId([
            'tenant_id' => $tenantId,
            'sender_id' => $payerId,
            'receiver_id' => $payeeId,
            'amount' => $quant,
            'description' => $description,
            'status' => 'completed',
            'is_federated' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Resolve a CC account path or partial name to the account path string
     * stored in federation_cc_entries (for LIKE queries).
     *
     * Returns the username portion for building a LIKE pattern, or the full
     * path if already in "node/user" format.
     */
    private function resolveAccountPath(string $accountRef, int $tenantId): ?string
    {
        // Already a full CC path — use as-is
        if (str_contains($accountRef, '/')) {
            return $accountRef;
        }

        // Numeric — look up username
        if (is_numeric($accountRef)) {
            $username = DB::table('users')
                ->where('id', (int) $accountRef)
                ->where('tenant_id', $tenantId)
                ->value('username');
            return $username ?? null;
        }

        // Treat as username directly
        return $accountRef;
    }

    /**
     * Reverse a completed transaction's balance changes.
     */
    private function reverseTransaction(object $entry, int $tenantId, ?int $payerId, ?int $payeeId): bool
    {
        if ($payeeId) {
            $debited = DB::update(
                "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND status = 'active' AND balance >= ?",
                [(float) $entry->quant, $payeeId, $tenantId, (float) $entry->quant]
            );
            if ($debited !== 1) {
                return false;
            }
        }
        if ($payerId) {
            $credited = DB::update("UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ? AND status = 'active'",
                [(float) $entry->quant, $payerId, $tenantId]);
            if ($credited !== 1) {
                return false;
            }
        }
        return true;
    }
}
