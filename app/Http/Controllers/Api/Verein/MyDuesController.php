<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Verein;

use App\Support\Payments\CheckoutReturnUrl;
use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\Verein\VereinDuesAuthorizationService;
use App\Services\Verein\VereinDuesService;
use Illuminate\Http\JsonResponse;

/**
 * AG54 — Member-facing endpoints for Verein membership dues.
 *
 * Endpoints:
 *   GET  /v2/me/verein-dues           — list my dues across all my Vereine
 *   GET  /v2/me/verein-dues/{id}      — single dues detail
 *   POST /v2/me/verein-dues/{id}/pay  — create Stripe PaymentIntent
 *   GET  /v2/users/{userId}/verein-membership-status — public-ish renewal badge
 */
class MyDuesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VereinDuesService $duesService,
        private readonly VereinDuesAuthorizationService $duesAuthorization,
    ) {
    }

    public function myDues(): JsonResponse
    {
        $forbidden = $this->guardFeature();
        if ($forbidden) return $forbidden;

        $userId = $this->requireAuth();
        return $this->respondWithData($this->duesService->getMyDues($userId));
    }

    public function showDues(int $duesId): JsonResponse
    {
        $forbidden = $this->guardFeature();
        if ($forbidden) return $forbidden;

        $userId = $this->requireAuth();
        $dues = $this->duesService->getDuesById($duesId, $userId);
        if (!$dues) {
            return $this->respondWithError('NOT_FOUND', __('verein_dues.errors.dues_not_found'), null, 404);
        }
        return $this->respondWithData(['dues' => $dues]);
    }

    public function payDues(int $duesId): JsonResponse
    {
        $forbidden = $this->guardFeature();
        if ($forbidden) return $forbidden;

        $userId = $this->requireAuth();
        try {
            $intent = $this->duesService->createPaymentIntent($duesId, $userId);
            $publicKey = (string) (config('services.stripe.key') ?? env('STRIPE_PUBLISHABLE_KEY', ''));

            return $this->respondWithData([
                'client_secret' => $intent['client_secret'],
                'payment_intent_id' => $intent['payment_intent_id'],
                'public_key' => $publicKey,
            ]);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VEREIN_DUES_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * POST /api/v2/me/verein-dues/{duesId}/checkout
     *
     * The member's own dues on a Stripe-hosted payment page, for the accessible
     * site (no JavaScript). Body: `return_url` (accepted only on this community's
     * website or accessible site). Response: `checkout_url`, or `already_paid`.
     */
    public function checkoutDues(int $duesId): JsonResponse
    {
        $forbidden = $this->guardFeature();
        if ($forbidden) return $forbidden;

        $userId = $this->requireAuth();
        $returnUrl = CheckoutReturnUrl::safe((string) ($this->getAllInput()['return_url'] ?? ''), '/me/verein-dues');

        try {
            $result = $this->duesService->createCheckoutSession(
                $duesId,
                $userId,
                CheckoutReturnUrl::withQuery($returnUrl, ['checkout' => 'success', 'dues' => (string) $duesId, 'session_id' => '{CHECKOUT_SESSION_ID}']),
                CheckoutReturnUrl::withQuery($returnUrl, ['checkout' => 'cancelled', 'dues' => (string) $duesId]),
            );
        } catch (\DomainException $e) {
            return $this->respondWithError('PAYMENT_IN_PROGRESS', __('verein_dues.errors.payment_intent_failed'), null, 409);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VEREIN_DUES_ERROR', $e->getMessage(), null, 422);
        }

        if ($result['already_paid']) {
            return $this->respondWithData(['already_paid' => true]);
        }

        return $this->respondWithData(['checkout_url' => $result['checkout_url']]);
    }

    /**
     * GET /api/v2/me/verein-dues/{duesId}/checkout-status
     *
     * The member's own dues status after the hosted payment page; asks Stripe
     * when the webhook has not arrived yet.
     */
    public function checkoutStatus(int $duesId): JsonResponse
    {
        $forbidden = $this->guardFeature();
        if ($forbidden) return $forbidden;

        $userId = $this->requireAuth();
        $status = $this->duesService->reconcileCheckout($duesId, $userId);
        if ($status === null) {
            return $this->respondWithError('NOT_FOUND', __('verein_dues.errors.dues_not_found'), null, 404);
        }

        return $this->respondWithData(['dues_id' => $duesId, 'status' => $status]);
    }

    public function membershipStatus(int $userId): JsonResponse
    {
        $forbidden = $this->guardFeature();
        if ($forbidden) return $forbidden;

        $actorId = $this->requireAuth();
        $orgId = (int) ($this->getAllInput()['organization_id'] ?? 0);
        if ($orgId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('verein_dues.errors.organization_required'), 'organization_id', 422);
        }

        $currentYear = (string) date('Y');
        $canViewHistory = $actorId === $userId
            || $this->duesAuthorization->canManageDues(TenantContext::getId(), $actorId, $orgId);

        $byYear = null;
        if ($canViewHistory) {
            $byYear = $this->duesService->getMembershipStatus($userId, $orgId);
            $current = $byYear[$currentYear] ?? null;
        } else {
            $current = $this->duesService->getCurrentMembershipStatus($userId, $orgId, (int) $currentYear);
        }

        $data = [
            'user_id' => $userId,
            'organization_id' => $orgId,
            'current_year' => (int) $currentYear,
            'current' => $current,
            'is_current_member' => $current !== null && in_array($current['status'] ?? null, ['paid', 'waived'], true),
        ];

        if ($canViewHistory) {
            $data['history'] = $byYear;
        }

        return $this->respondWithData($data);
    }

    private function guardFeature(): ?JsonResponse
    {
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        return null;
    }
}
