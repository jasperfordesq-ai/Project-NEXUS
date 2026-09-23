<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Verein;

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
