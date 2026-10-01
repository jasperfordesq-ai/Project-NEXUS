<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\AuditLogService;
use App\Services\Auth\SsoOidcService;
use Illuminate\Http\JsonResponse;

/**
 * AdminSsoProvidersController — per-tenant SSO (OIDC) provider
 * management (IT-Sec-05). Admin-only; all reads/writes scoped to the
 * requesting admin's tenant. Client secrets are write-only: stored
 * encrypted, never returned. Changes are audit-logged.
 */
class AdminSsoProvidersController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SsoOidcService $sso,
        private readonly AuditLogService $auditLogService,
    ) {
    }

    /** GET /api/v2/admin/sso/providers */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        return $this->respondWithData([
            'providers' => $this->sso->listForAdmin($tenantId),
            'presets' => SsoOidcService::PRESETS,
        ]);
    }

    /** PUT /api/v2/admin/sso/providers/{providerKey} */
    public function upsert(string $providerKey): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $provider = $this->sso->upsert($tenantId, array_merge(
                (array) request()->json()->all(),
                ['provider_key' => $providerKey],
            ), $adminId);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'provider', 422);
        }

        $this->auditLogService->logAdminAction('sso_provider_updated', $adminId, null, [
            'provider_key' => $provider['provider_key'],
            'issuer_url' => $provider['issuer_url'],
            'is_enabled' => $provider['is_enabled'],
            'auto_provision' => $provider['auto_provision'],
        ]);

        return $this->respondWithData(['provider' => $provider]);
    }

    /** DELETE /api/v2/admin/sso/providers/{providerKey} */
    public function destroy(string $providerKey): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        // F-472: nothing deleted is not a deletion. Refuse before the audit log
        // is written, so the assurance record never carries an action that did
        // not happen. The refusal is identical for a key held by another
        // community and a key held by nobody, so this is not an existence oracle.
        if ($this->sso->delete($tenantId, $providerKey) === 0) {
            return $this->respondWithError('NOT_FOUND', __('api.sso_provider_not_found'), 'provider', 404);
        }

        $this->auditLogService->logAdminAction('sso_provider_deleted', $adminId, null, [
            'provider_key' => $providerKey,
        ]);

        return $this->respondWithData(['deleted' => true]);
    }

    /**
     * POST /api/v2/admin/sso/providers/{providerKey}/test
     *
     * Connectivity probe: runs OIDC discovery against the stored issuer
     * so an admin can confirm the configuration before enabling it.
     */
    public function test(string $providerKey): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $providers = collect($this->sso->listForAdmin($tenantId));
        $provider = $providers->firstWhere('provider_key', $providerKey);
        if (! $provider) {
            return $this->respondWithError('NOT_FOUND', __('api.sso_provider_not_found'), 'provider', 404);
        }

        try {
            $discovery = $this->sso->discover($provider['issuer_url']);
            return $this->respondWithData([
                'ok' => true,
                'issuer' => $discovery['issuer'],
                'authorization_endpoint' => $discovery['authorization_endpoint'],
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithData([
                'ok' => false,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
