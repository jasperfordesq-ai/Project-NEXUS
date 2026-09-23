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
use App\Services\Verein\VereinDuesService;
use Illuminate\Http\JsonResponse;

/**
 * AG54 — Verein admin endpoints for membership fee collection.
 *
 * Access:
 *   - Tenant admins (any of: admin/tenant_admin/super_admin/god flags)
 *   - Or: scoped verein_admin role with verein.dues.manage permission for THIS org
 */
class VereinDuesAdminController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VereinDuesService $duesService,
        private readonly VereinMemberImportService $vereinMemberImportService,
    ) {
    }

    public function getFeeConfig(int $organizationId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        return $this->respondWithData([
            'fee_config' => $this->duesService->getFeeConfig($organizationId),
        ]);
    }

    public function setFeeConfig(int $organizationId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        try {
            $config = $this->duesService->setFeeConfig($organizationId, $this->getAllInput());
            return $this->respondWithData(['fee_config' => $config]);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    public function generateAnnualDues(int $organizationId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        $year = (int) ($this->getAllInput()['year'] ?? (int) date('Y'));
        try {
            $result = $this->duesService->generateAnnualDues($organizationId, $year);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VEREIN_DUES_ERROR', $e->getMessage(), null, 422);
        }
    }

    public function listDues(int $organizationId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        $input = $this->getAllInput();
        $status = isset($input['status']) ? (string) $input['status'] : null;
        $year = isset($input['year']) ? (int) $input['year'] : null;
        $page = max(1, (int) ($input['page'] ?? 1));
        $perPage = max(1, min(100, (int) ($input['per_page'] ?? 25)));

        return $this->respondWithData(
            $this->duesService->listDues($organizationId, $status, $year, $page, $perPage)
        );
    }

    public function listOverdue(int $organizationId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        return $this->respondWithData([
            'items' => $this->duesService->getOverdueDues($organizationId),
        ]);
    }

    public function waiveDues(int $organizationId, int $duesId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        $adminId = $this->requireAuth();
        $reason = trim((string) ($this->getAllInput()['reason'] ?? ''));
        if ($reason === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('verein_dues.errors.waive_reason_required'), 'reason', 422);
        }

        try {
            return $this->respondWithData(
                $this->duesService->waive($organizationId, $duesId, $adminId, $reason)
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }
    }

    public function sendReminder(int $organizationId, int $duesId): JsonResponse
    {
        $forbidden = $this->guard($organizationId);
        if ($forbidden) return $forbidden;

        try {
            return $this->respondWithData(
                $this->duesService->sendReminder($organizationId, $duesId)
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }
    }

    // -----------------------------------------------------------------

    private function guard(int $organizationId): ?JsonResponse
    {
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $actorId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($this->canManageDues($tenantId, $actorId, $organizationId)) {
            return null;
        }

        return $this->respondWithError('FORBIDDEN', __('api.admin_access_required'), null, 403);
    }

    private function canManageDues(int $tenantId, int $actorId, int $organizationId): bool
    {
        $actor = User::query()
            ->where('tenant_id', $tenantId)
            ->where('id', $actorId)
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

        // Scoped verein_admin: any of these AG30 perms grants dues management for now.
        // (Dedicated verein.dues.manage permission seeded by AG54 migration 2026_04_29_201000.)
        foreach (['verein.dues.manage', 'verein.members.manage', 'verein.members.import'] as $perm) {
            if ($this->vereinMemberImportService->userHasPermissionInOrg($tenantId, $actorId, $organizationId, $perm)) {
                return true;
            }
        }

        return false;
    }
}
