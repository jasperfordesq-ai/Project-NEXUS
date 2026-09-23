<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Verein;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Models\User;
use App\Services\CaringCommunity\VereinMemberImportService;
use App\Services\Verein\VereinFederationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

/**
 * AG55 — Verein admin endpoints for federation consent + event sharing.
 */
class VereinFederationAdminController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VereinFederationService $service,
        private readonly VereinMemberImportService $vereinMemberImportService,
    ) {
    }

    public function getConsent(int $organizationId): JsonResponse
    {
        if ($guard = $this->guard($organizationId)) return $guard;
        return $this->respondWithData($this->service->getConsent($organizationId));
    }

    public function updateConsent(Request $request, int $organizationId): JsonResponse
    {
        if ($guard = $this->guard($organizationId)) return $guard;

        $scope = (string) $request->input('sharing_scope', 'none');
        $municipalityCode = $request->input('municipality_code');
        $municipalityCode = is_string($municipalityCode) && $municipalityCode !== '' ? $municipalityCode : null;
        $userId = $this->requireAuth();

        try {
            $consent = $this->service->setConsent($organizationId, $scope, $municipalityCode, $userId);
            return $this->respondWithData($consent);
        } catch (InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    public function getNetwork(int $organizationId): JsonResponse
    {
        if ($guard = $this->guard($organizationId)) return $guard;
        return $this->respondWithData($this->service->getNetworkVereine($organizationId));
    }

    public function shareEvent(Request $request, int $organizationId): JsonResponse
    {
        if ($guard = $this->guard($organizationId)) return $guard;

        $eventId = (int) $request->input('event_id');
        $targets = $request->input('target_organization_ids', []);
        if (!is_array($targets) || $targets === []) {
            return $this->respondWithError('VALIDATION_ERROR', __('verein_federation.targets_required'), null, 422);
        }

        try {
            $result = $this->service->shareEvent(
                $eventId,
                $targets,
                $organizationId,
                $this->requireAuth(),
            );
            return $this->respondWithData($result);
        } catch (InvalidArgumentException | RuntimeException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }

    public function listSharedEvents(Request $request, int $organizationId): JsonResponse
    {
        if ($guard = $this->guard($organizationId)) return $guard;

        $direction = (string) $request->query('direction', 'incoming');
        if (!in_array($direction, ['incoming', 'outgoing'], true)) {
            $direction = 'incoming';
        }

        return $this->respondWithData($this->service->getSharedEvents($organizationId, $direction));
    }

    public function withdrawShare(int $organizationId, int $shareId): JsonResponse
    {
        if ($guard = $this->guard($organizationId)) return $guard;

        $ok = $this->service->withdrawEventShare($shareId, $organizationId);
        if (!$ok) {
            return $this->respondWithError('NOT_FOUND', __('verein_federation.share_not_found'), null, 404);
        }
        return $this->respondWithData(['withdrawn' => true]);
    }

    private function guard(int $organizationId): ?JsonResponse
    {
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $userId = $this->requireAuth();
        if (!$this->canAdministerVerein($userId, $organizationId)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.admin_access_required'), null, 403);
        }
        return null;
    }

    private function canAdministerVerein(int $userId, int $organizationId): bool
    {
        $tenantId = TenantContext::getId();
        $actor = User::query()
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($actor && (
            in_array((string) $actor->role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || (int) ($actor->is_admin ?? 0) === 1
            || (int) ($actor->is_super_admin ?? 0) === 1
            || (int) ($actor->is_tenant_super_admin ?? 0) === 1
            || (int) ($actor->is_god ?? 0) === 1
        )) {
            return true;
        }

        return $this->vereinMemberImportService->userHasPermissionInOrg(
            $tenantId,
            $userId,
            $organizationId,
            'verein.members.manage'
        );
    }
}
