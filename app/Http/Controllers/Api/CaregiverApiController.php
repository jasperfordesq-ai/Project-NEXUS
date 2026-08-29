<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\CaringCommunity\CaregiverService;
use Illuminate\Http\JsonResponse;

/**
 * AG68 — Caregiver/Angehörigen Support Flow
 *
 * All endpoints are scoped to the authenticated user and current tenant.
 * Gated behind the `caring_community` feature.
 */
class CaregiverApiController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CaregiverService $service,
    ) {
    }

    // -------------------------------------------------------------------------
    // Feature guard helper
    // -------------------------------------------------------------------------

    private function guardFeature(): ?JsonResponse
    {
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        if (!$this->service->isAvailable()) {
            return $this->respondWithError('FEATURE_UNAVAILABLE', __('api.service_unavailable'), null, 503);
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Caregiver links
    // -------------------------------------------------------------------------

    /**
     * GET /v2/caring-community/caregiver/links
     * Returns all caregiver-link lifecycle states for the authenticated user.
     */
    public function myLinks(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        return $this->respondWithData($this->service->getLinksForCaregiver($userId, $tenantId, null));
    }

    /**
     * POST /v2/caring-community/caregiver/links
     * Request a new caregiver link.
     */
    public function addLink(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        $caredForId = $this->inputInt('cared_for_id');
        if ($caredForId === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'cared_for_id']), 'cared_for_id', 422);
        }

        $relationshipType = (string) ($this->input('relationship_type') ?? '');
        $allowedTypes     = ['family', 'friend', 'neighbour', 'professional'];
        if (!in_array($relationshipType, $allowedTypes, true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.caring_caregiver_relationship_invalid', ['values' => implode(', ', $allowedTypes)]),
                'relationship_type',
                422
            );
        }

        $startDate = (string) ($this->input('start_date') ?? '');
        if ($startDate === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'start_date']), 'start_date', 422);
        }

        try {
            $link = $this->service->createLink(
                $userId,
                $caredForId,
                $relationshipType,
                $tenantId,
                [
                    'start_date' => $startDate,
                    'notes'      => $this->input('notes'),
                    'is_primary' => $this->inputBool('is_primary'),
                ],
            );
        } catch (\RuntimeException $e) {
            return $this->respondWithError('CONFLICT', $e->getMessage(), null, 409);
        }

        return $this->respondWithData($link, null, 202);
    }

    public function incomingLinks(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        if ($guard = $this->guardFeature()) return $guard;

        return $this->respondWithData($this->service->getIncomingLinks($userId, $tenantId));
    }

    public function confirmIncomingLink(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        if ($guard = $this->guardFeature()) return $guard;

        try {
            return $this->respondWithData($this->service->confirmLinkByRecipient($id, $userId, $tenantId));
        } catch (\RuntimeException $e) {
            return $this->respondNotFound($e->getMessage());
        }
    }

    public function rejectIncomingLink(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        if ($guard = $this->guardFeature()) return $guard;

        try {
            return $this->respondWithData($this->service->rejectLink(
                $id,
                $tenantId,
                $userId,
                (string) ($this->input('reason') ?? ''),
                false,
            ));
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'reason', 422);
        } catch (\RuntimeException $e) {
            return $this->respondNotFound($e->getMessage());
        }
    }

    /**
     * DELETE /v2/caring-community/caregiver/links/{id}
     * Remove (deactivate) a caregiver link.
     */
    public function removeLink(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        try {
            $this->service->removeLink($id, $userId, $tenantId);
        } catch (\RuntimeException $e) {
            return $this->respondNotFound($e->getMessage());
        }

        return $this->noContent();
    }

    // -------------------------------------------------------------------------
    // Care schedule
    // -------------------------------------------------------------------------

    /**
     * GET /v2/caring-community/caregiver/schedule/{caredForId}
     * Returns upcoming support activities for a cared-for person.
     * Requires an active caregiver link.
     */
    public function caregiverSchedule(int $caredForId): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        // Guard: must have an active link to this cared-for person
        $links = $this->service->getLinksForCaregiver($userId, $tenantId);
        $hasLink = false;
        foreach ($links as $link) {
            if ((int) $link['cared_for_id'] === $caredForId) {
                $hasLink = true;
                break;
            }
        }

        if (!$hasLink) {
            return $this->respondForbidden(__('api.caring_caregiver_active_link_required'));
        }

        return $this->respondWithData($this->service->getScheduleForCaredFor($caredForId, $tenantId));
    }

    // -------------------------------------------------------------------------
    // Burnout check
    // -------------------------------------------------------------------------

    /**
     * GET /v2/caring-community/caregiver/burnout-check
     * Returns the burnout risk assessment for the authenticated caregiver.
     */
    public function burnoutCheck(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        return $this->respondWithData($this->service->checkBurnoutRisk($userId, $tenantId));
    }

    // -------------------------------------------------------------------------
    // On-behalf requests
    // -------------------------------------------------------------------------

    /**
     * POST /v2/caring-community/caregiver/request-on-behalf
     * Create a help request on behalf of a linked cared-for person.
     */
    public function requestOnBehalf(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        $caredForId = $this->inputInt('cared_for_id');
        if ($caredForId === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'cared_for_id']), 'cared_for_id', 422);
        }

        $title = (string) ($this->input('title') ?? '');
        if ($title === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'title']), 'title', 422);
        }

        try {
            $request = $this->service->createRequestOnBehalf(
                $userId,
                $caredForId,
                [
                    'title'              => $title,
                    'description'        => $this->input('description'),
                    'when_needed'        => $this->input('when_needed'),
                    'contact_preference' => $this->input('contact_preference'),
                ],
                $tenantId,
            );
        } catch (\RuntimeException $e) {
            return $this->respondForbidden($e->getMessage());
        }

        return $this->respondWithData($request, null, 201);
    }

    // -------------------------------------------------------------------------
    // AG73 — Substitute / cover-care services
    // -------------------------------------------------------------------------

    public function coverRequests(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        try {
            return $this->respondWithData($this->service->getCoverRequestsForCaregiver($userId, $tenantId));
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_UNAVAILABLE', $e->getMessage(), null, 503);
        }
    }

    public function createCoverRequest(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        try {
            $coverRequest = $this->service->createCoverRequest($userId, $tenantId, $this->getAllInput());
            return $this->respondWithData($coverRequest, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        }
    }

    public function coverCandidates(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        try {
            return $this->respondWithData($this->service->suggestCoverCandidates($id, $userId, $tenantId));
        } catch (\RuntimeException $e) {
            return $this->respondNotFound($e->getMessage());
        }
    }

    public function assignCoverCandidate(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($guard = $this->guardFeature()) {
            return $guard;
        }

        $supporterId = $this->inputInt('supporter_id');
        if ($supporterId === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'supporter_id']), 'supporter_id', 422);
        }

        try {
            return $this->respondWithData($this->service->assignCoverCandidate($id, $userId, $tenantId, $supporterId));
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondNotFound($e->getMessage());
        }
    }
}
