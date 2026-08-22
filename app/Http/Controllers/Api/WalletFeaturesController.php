<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\TenantContext;
use App\Services\CommunityFundService;
use App\Services\TransactionCategoryService;
use App\Services\ExchangeRatingService;
use App\Services\CreditDonationService;
use App\Services\StartingBalanceService;
use App\Services\TransactionExportService;

/**
 * WalletFeaturesController -- Extended wallet: community fund, categories,
 * ratings, donations, statements.
 *
 * Fully migrated from ob_start() delegation to direct service calls.
 */
class WalletFeaturesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CommunityFundService $communityFundService,
        private readonly CreditDonationService $creditDonationService,
        private readonly ExchangeRatingService $exchangeRatingService,
        private readonly StartingBalanceService $startingBalanceService,
        private readonly TransactionCategoryService $transactionCategoryService,
        private readonly TransactionExportService $transactionExportService,
    ) {}

    // ============================================
    // COMMUNITY FUND (W1)
    // ============================================

    // 🔴 The six gates below ask `hasModule('wallet')`, NOT `hasFeature('wallet')`.
    //
    // `wallet` lives in `TenantFeatureConfig::MODULE_DEFAULTS`, not in `FEATURE_DEFAULTS`.
    // `hasFeature('wallet')` therefore returned false for EVERY tenant on the platform,
    // always — `mergeFeatureDefaults()` starts from the feature defaults, and `wallet` is
    // simply not a key there, so nothing could ever make it true short of a tenant writing
    // a `wallet` key into its `features` JSON by hand. No tenant does.
    //
    // Consequence, found by walking the mobile wallet on 2026-08-22: a member donates a
    // credit, the fund account records it (`community_fund_accounts` balance 1.00,
    // `community_fund_transactions` row written), and the balance endpoint answers
    // `{"balance": 0, "enabled": false}`. The mobile wallet duly shows FUND 0h / DEPOSITED
    // 0h / DONATED 0h, so the member's donation is invisible to them and to everyone else.
    // Deposit, withdraw, the fund's own donate route and the transaction-category endpoints
    // were dead the same way.
    //
    // The member-facing `donate()` at the bottom of this controller is NOT gated, which is
    // why donating worked while seeing the result did not.

    /** GET /api/v2/wallet/community-fund/balance */
    public function communityFundBalance(): JsonResponse
    {
        $this->requireAuth();

        if (!TenantContext::hasModule('wallet')) {
            return $this->respondWithData(['balance' => 0, 'enabled' => false]);
        }

        $data = $this->communityFundService->getBalance();

        return $this->respondWithData($data);
    }

    /** GET /api/v2/wallet/community-fund/transactions */
    public function communityFundTransactions(): JsonResponse
    {
        $this->requireAuth();

        if (!TenantContext::hasModule('wallet')) {
            return $this->respondWithData(['balance' => 0, 'enabled' => false]);
        }

        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = $this->queryInt('offset', 0, 0);

        $result = $this->communityFundService->getTransactions($limit, $offset);

        return $this->respondWithData($result['items'], ['total' => $result['total']]);
    }

    /** POST /api/v2/wallet/community-fund/deposit */
    public function communityFundDeposit(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->requireAdmin();

        if (!TenantContext::hasModule('wallet')) {
            return $this->respondWithData(['balance' => 0, 'enabled' => false]);
        }

        $data = $this->getAllInput();

        if (empty($data['amount']) || (float) $data['amount'] <= 0) {
            return $this->error(__('api.amount_gt_zero'), 400);
        }

        $result = $this->communityFundService->adminDeposit(
            $userId,
            (float) $data['amount'],
            $data['description'] ?? ''
        );

        if (!$result['success']) {
            return $this->error($result['error'], 400);
        }

        return $this->respondWithData(
            ['balance' => $result['balance']],
            null,
            200
        );
    }

    /** POST /api/v2/wallet/community-fund/withdraw */
    public function communityFundWithdraw(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->requireAdmin();

        if (!TenantContext::hasModule('wallet')) {
            return $this->respondWithData(['balance' => 0, 'enabled' => false]);
        }

        $data = $this->getAllInput();

        if (empty($data['recipient_id'])) {
            return $this->error('recipient_id is required', 400);
        }

        if (empty($data['amount']) || (float) $data['amount'] <= 0) {
            return $this->error(__('api.amount_gt_zero'), 400);
        }

        $result = $this->communityFundService->adminWithdraw(
            $userId,
            (int) $data['recipient_id'],
            (float) $data['amount'],
            $data['description'] ?? ''
        );

        if (!$result['success']) {
            return $this->error($result['error'], 400);
        }

        return $this->respondWithData(['balance' => $result['balance']]);
    }

    /** POST /api/v2/wallet/community-fund/donate */
    public function communityFundDonate(): JsonResponse
    {
        $userId = $this->requireAuth();
        // Same guards as donate(): rate limit, cap, and double-submit lock —
        // this is the same irreversible credit transfer under a second route.
        $this->rateLimit('wallet_donate', 10, 60);

        if (!TenantContext::hasModule('wallet')) {
            return $this->respondWithData(['balance' => 0, 'enabled' => false]);
        }

        $data = $this->getAllInput();

        if (empty($data['amount']) || (float) $data['amount'] <= 0) {
            return $this->error(__('api.amount_gt_zero'), 400);
        }
        if ((float) $data['amount'] > 1000) {
            return $this->error(__('api.amount_out_of_range'), 400);
        }

        $lock = \Illuminate\Support\Facades\Cache::lock(
            sprintf('wallet_donate:%d:%d', TenantContext::getId(), $userId),
            10
        );
        if (! $lock->get()) {
            return $this->respondWithError('DUPLICATE_REQUEST', __('api.wallet_transfer_duplicate'), null, 429);
        }

        try {
            $result = $this->creditDonationService->donateToCommunityFund(
                $userId,
                (float) $data['amount'],
                $data['message'] ?? ''
            );
        } finally {
            $lock->release();
        }

        if (!$result['success']) {
            return $this->error($result['error'], 400);
        }

        return $this->respondWithData(['message' => __('api_controllers_2.wallet.donation_successful')]);
    }

    // ============================================
    // TRANSACTION CATEGORIES (W8)
    // ============================================

    /** GET /api/v2/wallet/categories */
    public function listCategories(): JsonResponse
    {
        $this->requireAuth();

        if (!TenantContext::hasModule('wallet')) {
            return $this->respondWithData(['balance' => 0, 'enabled' => false]);
        }

        $categories = $this->transactionCategoryService->getAll();

        return $this->respondWithData($categories);
    }

    /** POST /api/v2/wallet/categories */
    public function createCategory(): JsonResponse
    {
        $this->requireAuth();
        $this->requireAdmin();

        $data = $this->getAllInput();

        if (empty($data['name'])) {
            return $this->error(__('api_controllers_2.wallet.name_required'), 400);
        }

        $id = $this->transactionCategoryService->create($data);

        if (!$id) {
            return $this->error(__('api_controllers_2.wallet.create_category_failed'), 500);
        }

        $category = $this->transactionCategoryService->getById($id);

        return $this->respondWithData($category, null, 201);
    }

    /** PUT /api/v2/wallet/categories/{id} */
    public function updateCategory(int $id): JsonResponse
    {
        $this->requireAuth();
        $this->requireAdmin();

        $data = $this->getAllInput();

        $success = $this->transactionCategoryService->update($id, $data);

        if (!$success) {
            return $this->error(__('api_controllers_2.wallet.update_category_failed'), 400);
        }

        $category = $this->transactionCategoryService->getById($id);

        return $this->respondWithData($category);
    }

    /** DELETE /api/v2/wallet/categories/{id} */
    public function deleteCategory(int $id): JsonResponse
    {
        $this->requireAuth();
        $this->requireAdmin();

        $success = $this->transactionCategoryService->delete($id);

        if (!$success) {
            return $this->error(__('api_controllers_2.wallet.cannot_delete_category'), 400);
        }

        return $this->respondWithData(['message' => __('api_controllers_2.wallet.category_deleted')]);
    }

    // ============================================
    // EXCHANGE RATINGS (W10)
    // ============================================

    /** POST /api/v2/wallet/exchanges/{eid}/rate */
    public function rateExchange(int $eid): JsonResponse
    {
        $userId = $this->requireAuth();

        $data = $this->getAllInput();

        if (empty($data['rating'])) {
            return $this->error(__('api_controllers_2.wallet.rating_required'), 400);
        }

        try {
            $result = $this->exchangeRatingService->submitRating(
                $eid,
                $userId,
                (int) $data['rating'],
                $data['comment'] ?? null
            );
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$result['success']) {
            return $this->error($result['error'], 400);
        }

        $ratings = $this->exchangeRatingService->getRatingsForExchange($eid);

        return $this->respondWithData($ratings, null, 201);
    }

    /** GET /api/v2/wallet/exchanges/{eid}/ratings */
    public function exchangeRatings(int $eid): JsonResponse
    {
        $this->requireAuth();

        $ratings = $this->exchangeRatingService->getRatingsForExchange($eid);
        $hasRated = $this->exchangeRatingService->hasRated($eid, $this->getUserId());

        return $this->respondWithData([
            'ratings' => $ratings,
            'has_rated' => $hasRated,
        ]);
    }

    /** GET /api/v2/wallet/users/{userId}/rating */
    public function userRating(int $userId): JsonResponse
    {
        $this->requireAuth();

        $rating = $this->exchangeRatingService->getUserRating($userId);

        return $this->respondWithData($rating);
    }

    // ============================================
    // CREDIT DONATIONS (W6)
    // ============================================

    /** POST /api/v2/wallet/donate */
    public function donate(): JsonResponse
    {
        $userId = $this->requireAuth();
        // Irreversible credit transfer: rate-limited (parity with the Stripe
        // donation path), amount-capped (parity with the accessible-frontend
        // donation cap and the org-wallet deposit cap), and double-submit
        // guarded — a double-clicked donate button must not transfer twice.
        $this->rateLimit('wallet_donate', 10, 60);

        $data = $this->getAllInput();

        if (empty($data['amount']) || (float) $data['amount'] <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.amount_gt_zero'), 'amount', 400);
        }
        if ((float) $data['amount'] > 1000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.amount_out_of_range'), 'amount', 400);
        }

        $lock = \Illuminate\Support\Facades\Cache::lock(
            sprintf('wallet_donate:%d:%d', TenantContext::getId(), $userId),
            10
        );
        if (! $lock->get()) {
            return $this->respondWithError('DUPLICATE_REQUEST', __('api.wallet_transfer_duplicate'), null, 429);
        }

        try {
            $recipientType = $data['recipient_type'] ?? 'community_fund';

            if ($recipientType === 'user') {
                if (empty($data['recipient_id'])) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.recipient_id_required_for_user'), 'recipient_id', 400);
                }

                $result = $this->creditDonationService->donateToMember(
                    $userId,
                    (int) $data['recipient_id'],
                    (float) $data['amount'],
                    $data['message'] ?? ''
                );
            } else {
                $result = $this->creditDonationService->donateToCommunityFund(
                    $userId,
                    (float) $data['amount'],
                    $data['message'] ?? ''
                );
            }
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } finally {
            $lock->release();
        }

        if (!$result['success']) {
            return $this->respondWithError('DONATION_FAILED', $result['error'], null, 400);
        }

        return $this->respondWithData(['message' => __('api_controllers_2.wallet.donation_successful')], null, 201);
    }

    /** GET /api/v2/wallet/donation-history */
    public function donationHistory(): JsonResponse
    {
        $userId = $this->requireAuth();

        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = $this->queryInt('offset', 0, 0);

        $result = $this->creditDonationService->getDonationHistory($userId, $limit, $offset);

        return $this->respondWithData($result['items'], ['total' => $result['total']]);
    }

    // ============================================
    // STARTING BALANCES (W7)
    // ============================================

    /** GET /api/v2/wallet/starting-balance */
    public function getStartingBalance(): JsonResponse
    {
        $this->requireAuth();

        $amount = $this->startingBalanceService->getStartingBalance();

        return $this->respondWithData(['starting_balance' => $amount]);
    }

    /** POST /api/v2/wallet/starting-balance */
    public function setStartingBalance(): JsonResponse
    {
        $this->requireAuth();
        $this->requireAdmin();

        $data = $this->getAllInput();

        if (!isset($data['amount'])) {
            return $this->error(__('api_controllers_2.wallet.amount_required'), 400);
        }

        $amount = max(0, (float) $data['amount']);

        try {
            $this->startingBalanceService->setStartingBalance($amount);
        } catch (\Exception $e) {
            return $this->error(__('api_controllers_2.wallet.starting_balance_failed'), 500);
        }

        return $this->respondWithData([
            'starting_balance' => $amount,
            'message' => __('api_controllers_2.wallet.starting_balance_updated'),
        ]);
    }

    // ============================================
    // TRANSACTION STATEMENTS (W5)
    // ============================================

    /** GET /api/v2/wallet/statement */
    public function statement(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('wallet_statement', 10, 60);

        $filters = [
            'startDate' => $this->query('start_date'),
            'endDate' => $this->query('end_date'),
            'type' => $this->query('type'),
        ];

        $filters = array_filter($filters, function ($v) {
            return $v !== null && $v !== '';
        });

        $result = $this->transactionExportService->exportPersonalStatementCSV($userId, $filters);

        if (!$result['success']) {
            return $this->error($result['message'] ?? __('errors.generic.export_failed'), 400);
        }

        // Send CSV download directly (bypasses JSON response)
        $this->transactionExportService->sendCSVDownload($result['csv'], $result['filename']);

        // This line won't be reached in production (sendCSVDownload exits),
        // but provides a fallback for testing environments
        return $this->respondWithData(['message' => __('api_controllers_2.wallet.statement_exported')]);
    }
}
