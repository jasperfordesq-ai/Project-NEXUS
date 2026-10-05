<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\StripeDonationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * DonationPaymentController — Stripe donation payment endpoints.
 *
 * Handles PaymentIntent creation for client-side Stripe Elements,
 * donation receipt retrieval, and admin-initiated refunds.
 */
class DonationPaymentController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Create a Stripe PaymentIntent for a donation.
     *
     * POST /v2/donations/payment-intent
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function createPaymentIntent(Request $request): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $this->rateLimit('donation_payment_intent', 10, 60);

        $validator = Validator::make($request->all(), [
            'amount' => 'required|numeric|min:0.50',
            'currency' => 'required|string|size:3',
            'giving_day_id' => 'nullable|integer|min:1',
            'opportunity_id' => 'nullable|integer|min:1',
            'community_project_id' => 'nullable|integer|min:1',
            'message' => 'nullable|string|max:500',
            'is_anonymous' => 'nullable|boolean',
            'fund_code' => 'nullable|string|max:80',
            'gift_aid_enabled' => 'nullable|boolean',
            'gift_aid.declaration_name' => 'nullable|string|max:160',
            'gift_aid.address_line1' => 'nullable|string|max:190',
            'gift_aid.address_line2' => 'nullable|string|max:190',
            'gift_aid.town' => 'nullable|string|max:120',
            'gift_aid.postcode' => 'nullable|string|max:40',
            'gift_aid.country' => 'nullable|string|size:2',
        ]);

        if ($validator->fails()) {
            $errors = [];
            foreach ($validator->errors()->toArray() as $field => $messages) {
                $errors[] = [
                    'code' => 'VALIDATION_ERROR',
                    'message' => $messages[0],
                    'field' => $field,
                ];
            }
            return $this->respondWithErrors($errors, 422);
        }

        $data = $validator->validated();

        try {
            $result = StripeDonationService::createPaymentIntent($userId, $tenantId, $data);

            return $this->respondWithData([
                'client_secret' => $result['client_secret'],
                'donation_id' => $result['donation_id'],
            ]);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            Log::error('DonationPaymentController: createPaymentIntent failed', [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('PAYMENT_ERROR', __('api.payment_processing_failed'), null, 500);
        }
    }

    /**
     * Get a donation receipt.
     *
     * GET /v2/donations/{id}/receipt
     *
     * @param int $id Donation ID
     * @return JsonResponse
     */
    public function getDonationReceipt(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $receipt = StripeDonationService::getDonationReceipt($id, $userId, $tenantId);

        if ($receipt === null) {
            return $this->respondWithError('NOT_FOUND', __('api.donation_not_found'), null, 404);
        }

        return $this->respondWithData($receipt);
    }

    /**
     * Admin: refund a completed donation.
     *
     * POST /v2/admin/donations/{id}/refund
     *
     * @param int $id Donation ID
     * @return JsonResponse
     */
    public function adminRefund(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $result = StripeDonationService::createRefund($id, $tenantId, $adminId);

            return $this->respondWithData($result);
        } catch (\RuntimeException $e) {
            Log::error('DonationPaymentController: adminRefund failed', [
                'donation_id' => $id,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('REFUND_ERROR', __('api.refund_processing_failed'), null, 500);
        }
    }
}
