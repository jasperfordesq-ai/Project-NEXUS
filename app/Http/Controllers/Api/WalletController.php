<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\WalletService;
use App\Support\Authorization\AdminTier;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

/**
 * WalletController - Time-credit wallet operations.
 *
 * Endpoints (v2):
 *   GET    /api/v2/wallet/config               config()
 *   GET    /api/v2/wallet/balance              balance()
 *   GET    /api/v2/wallet/transactions         transactions()
 *   GET    /api/v2/wallet/transactions/{id}    showTransaction()
 *   POST   /api/v2/wallet/transfer             transfer()
 *   DELETE /api/v2/wallet/transactions/{id}    destroyTransaction()
 *   GET    /api/v2/wallet/user-search          userSearch()
 *   GET    /api/v2/wallet/pending-count        pendingCount()
 */
class WalletController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly WalletService $walletService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/wallet/config
    // -----------------------------------------------------------------

    /**
     * Get wallet configuration for the current tenant (e.g. transfer limits).
     */
    public function config(): JsonResponse
    {
        $this->requireAuth();
        $this->rateLimit('wallet_config', 60, 60);

        // Single source of truth: the same effective cap transfer() enforces, so
        // the UI never advertises a limit the server does not apply.
        return $this->respondWithData([
            'max_transfer' => (int) $this->walletService->maxTransferAmount($this->getTenantId()),
        ]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/wallet/balance
    // -----------------------------------------------------------------

    /**
     * Get the current user's time-credit balance with summary stats.
     */
    public function balance(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_balance', 60, 60);

        $balance = $this->walletService->getBalance($userId);

        return $this->respondWithData($balance);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/wallet/transactions
    // -----------------------------------------------------------------

    /**
     * List transaction history for the authenticated user.
     *
     * Query params: type (all|sent|received), cursor, per_page (default 20, max 100).
     */
    public function transactions(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_transactions', 30, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('type')) {
            $filters['type'] = $this->query('type');
        }

        $result = $this->walletService->getTransactions($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'] ?? null,
            $filters['limit'],
            $result['has_more'] ?? false
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/wallet/transactions/{id}
    // -----------------------------------------------------------------

    /**
     * Get a single transaction by ID.
     */
    public function showTransaction(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_transactions', 60, 60);

        // Negative ids encode federation_transactions rows (see WalletService::getFederationTransactions)
        if ($id < 0) {
            $transaction = $this->walletService->getFederationTransaction(abs($id), $userId);
        } else {
            $transaction = $this->walletService->getTransaction($id, $userId);
        }

        if ($transaction === null) {
            return $this->respondWithError('NOT_FOUND', __('api.transaction_not_found'), null, 404);
        }

        return $this->respondWithData($transaction);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/wallet/transfer
    // -----------------------------------------------------------------

    /**
     * Transfer time credits to another user.
     *
     * Body: recipient (user_id, username, or email), amount, description.
     */
    public function transfer(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_transfer', 10, 60);

        // Anti-double-submit: forward a client Idempotency-Key (header or body)
        // into the service so a double-click / network retry collapses to ONE
        // debit (WalletService::transfer replays the original transaction).
        $input = $this->getAllInput();
        $idemKey = request()->header('Idempotency-Key');
        if (is_string($idemKey) && $idemKey !== '' && empty($input['idempotency_key'])) {
            $input['idempotency_key'] = $idemKey;
        }

        try {
            $result = $this->walletService->transfer($userId, $input);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 400);
        } catch (\RuntimeException $e) {
            $code = 'TRANSFER_FAILED';
            $status = 422;
            $msg = $e->getMessage();

            if ($msg === __('api.wallet_transfer_recipient_not_found')) {
                $code = 'NOT_FOUND';
                $status = 404;
            } elseif ($msg === __('api.wallet_transfer_insufficient_balance')) {
                $code = 'INSUFFICIENT_FUNDS';
                $status = 400;
            } elseif ($msg === __('api.wallet_transfer_self_forbidden')) {
                $code = 'VALIDATION_ERROR';
                $status = 400;
            } elseif ($msg === __('api.wallet_transfer_duplicate')) {
                // A concurrent in-flight duplicate of this transfer (the original
                // hasn't committed yet). 409 so the client can stop retrying.
                $code = 'DUPLICATE_TRANSACTION';
                $status = 409;
            }

            return $this->respondWithError($code, $msg, null, $status);
        }

        // TransactionCompleted is dispatched inside WalletService::transfer()
        // so it fires for all callers (controller, admin bulk ops, etc.).

        return $this->respondWithData($result, null, 201);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/wallet/transactions/{id}
    // -----------------------------------------------------------------

    /**
     * Hide a transaction from the user's history (soft delete).
     */
    public function destroyTransaction(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_delete', 20, 60);

        // Federation transactions (negative ids) are not user-hideable — they're an
        // audit trail of external transfers. Return 404 so the frontend doesn't show
        // a delete affordance for them.
        if ($id < 0) {
            return $this->respondWithError('NOT_FOUND', __('api.transaction_not_found'), null, 404);
        }

        $success = $this->walletService->deleteTransaction($id, $userId);

        if (! $success) {
            return $this->respondWithError('NOT_FOUND', __('api.transaction_not_found'), null, 404);
        }

        return $this->noContent();
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/wallet/user-search
    // -----------------------------------------------------------------

    /**
     * Search users for wallet transfer autocomplete.
     *
     * Query params: q (search term), limit (default 10, max 20).
     */
    public function userSearch(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_user_search', 30, 60);

        $query = trim($this->query('q', ''));
        $limit = $this->queryInt('limit', 10, 1, 20);

        // Surnames are private to non-admin viewers everywhere else on the
        // platform; this endpoint must not be the way around that.
        $revealSurnames = AdminTier::allows(Auth::user());

        $users = $this->walletService->searchUsers($userId, $query, $limit, $revealSurnames);

        return $this->respondWithData(['users' => $users]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/wallet/pending-count
    // -----------------------------------------------------------------

    /**
     * Get count of pending wallet transactions (for badge updates).
     * Currently all transactions are instant, so this returns 0.
     */
    public function pendingCount(): JsonResponse
    {
        $this->requireAuth();
        $this->rateLimit('wallet_pending', 60, 60);

        return $this->respondWithData(['count' => 0]);
    }
}
