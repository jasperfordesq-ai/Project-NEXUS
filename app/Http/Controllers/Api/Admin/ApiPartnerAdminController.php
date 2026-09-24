<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\PartnerApi\PartnerApiAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * AG60 — Admin CRUD for Partner API integrations.
 *
 * Tenant admins use these endpoints to:
 *   - Create / update / suspend partner records
 *   - Generate or rotate client credentials (returned ONCE in plaintext)
 *   - View the call log
 *   - Inspect webhook subscription health
 */
class ApiPartnerAdminController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * F-175: scopes that can mint or move time credits. Granting these is a
     * platform-level decision — a tenant admin must never be able to create a
     * partner integration that can write to the wallet.
     */
    private const CREDIT_WRITING_SCOPES = ['wallet.write'];

    /**
     * F-175: the Partner API is a per-community opt-in feature (default OFF in
     * TenantFeatureConfig). A tenant admin may only manage partner records when
     * their community has the `partner_api` feature enabled. This is distinct
     * from the platform-wide kill switch (EnsurePartnerApiEnabled): the flag was
     * declared but enforced nowhere, so any tenant admin could create bearer-token
     * partners against their members and wallet.
     *
     * @throws \Illuminate\Http\Exceptions\HttpResponseException
     */
    private function requirePartnerApiFeature(): void
    {
        if (! TenantContext::hasFeature('partner_api')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->error(__('api.partner_api.disabled'), 403, 'PARTNER_API_DISABLED')
            );
        }
    }

    /**
     * F-175: reject any attempt by a non-platform-super-admin to grant a
     * credit-writing scope. Returns an error response to bubble up, or null when
     * the requested scopes are acceptable for the caller.
     *
     * @param array<int,mixed> $requestedScopes
     */
    private function rejectReservedScopes(array $requestedScopes): ?JsonResponse
    {
        $reserved = array_intersect(
            array_map(static fn ($s): string => (string) $s, $requestedScopes),
            self::CREDIT_WRITING_SCOPES
        );

        if (! empty($reserved) && ! $this->isPlatformSuperAdmin()) {
            return $this->respondWithError(
                'SCOPE_NOT_ALLOWED',
                __('api.super_admin_required'),
                'allowed_scopes',
                403
            );
        }

        return null;
    }

    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $partners = DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->orderBy('id', 'desc')
            ->get()
            ->map(fn ($p) => $this->serializePartner((array) $p))
            ->all();

        return $this->respondWithData(['partners' => $partners]);
    }

    public function show(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $partner = DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        if (! $partner) {
            return $this->respondNotFound(__('api.federation.partner_not_found'), 'PARTNER_NOT_FOUND');
        }

        $credentials = DB::table('api_partner_credentials')
            ->where('partner_id', $id)
            ->where('tenant_id', $tenantId)
            ->orderBy('id', 'desc')
            ->get(['id', 'client_id', 'last_used_at', 'revoked_at', 'created_at'])
            ->all();

        return $this->respondWithData([
            'partner' => $this->serializePartner((array) $partner),
            'credentials' => $credentials,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $name = trim((string) $request->input('name', ''));
        if ($name === '') {
            return $this->respondWithError('invalid_request', __('api.name_required'), 'name', 422);
        }

        $slug = trim((string) $request->input('slug', ''));
        if ($slug === '') {
            $slug = Str::slug($name) . '-' . Str::lower(Str::random(6));
        }

        $allowedScopes = $request->input('allowed_scopes', []);
        if (! is_array($allowedScopes)) {
            $allowedScopes = [];
        }

        // F-175: a plain tenant admin cannot grant wallet-writing scopes.
        if ($reject = $this->rejectReservedScopes($allowedScopes)) {
            return $reject;
        }

        $allowedCidrs = $request->input('allowed_ip_cidrs', []);
        if (! is_array($allowedCidrs)) {
            $allowedCidrs = [];
        }

        $id = DB::table('api_partners')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'slug' => $slug,
            'description' => $request->input('description'),
            'contact_email' => $request->input('contact_email'),
            'status' => 'pending',
            'is_sandbox' => (bool) $request->input('is_sandbox', true),
            'allowed_scopes' => json_encode(array_values($allowedScopes)),
            'allowed_ip_cidrs' => json_encode(array_values($allowedCidrs)),
            'rate_limit_per_minute' => (int) $request->input('rate_limit_per_minute', 60),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Auto-issue first credential pair so the partner can start integrating.
        $creds = PartnerApiAuthService::issueClientCredentials($id);

        return $this->respondWithData([
            'partner_id' => $id,
            'credentials' => $creds, // shown ONCE
        ], null, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $partner = DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (! $partner) {
            return $this->respondNotFound(__('api.federation.partner_not_found'), 'PARTNER_NOT_FOUND');
        }

        $update = ['updated_at' => now()];
        foreach (['name', 'description', 'contact_email'] as $f) {
            if ($request->has($f)) {
                $update[$f] = $request->input($f);
            }
        }
        if ($request->has('allowed_scopes')) {
            $requestedScopes = array_values((array) $request->input('allowed_scopes', []));
            // F-175: a plain tenant admin cannot grant wallet-writing scopes.
            if ($reject = $this->rejectReservedScopes($requestedScopes)) {
                return $reject;
            }
            $update['allowed_scopes'] = json_encode($requestedScopes);
        }
        if ($request->has('allowed_ip_cidrs')) {
            $update['allowed_ip_cidrs'] = json_encode(array_values((array) $request->input('allowed_ip_cidrs', [])));
        }
        if ($request->has('rate_limit_per_minute')) {
            $update['rate_limit_per_minute'] = max(1, (int) $request->input('rate_limit_per_minute'));
        }
        if ($request->has('is_sandbox')) {
            $update['is_sandbox'] = (bool) $request->input('is_sandbox');
        }

        DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update($update);

        return $this->respondWithData(['partner_id' => $id]);
    }

    public function activate(int $id): JsonResponse
    {
        return $this->setStatus($id, 'active');
    }

    public function suspend(int $id): JsonResponse
    {
        return $this->setStatus($id, 'suspended');
    }

    private function setStatus(int $id, string $status): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $updated = DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update(['status' => $status, 'updated_at' => now()]);

        if ($updated === 0) {
            return $this->respondNotFound(__('api.federation.partner_not_found'), 'PARTNER_NOT_FOUND');
        }

        return $this->respondWithData(['partner_id' => $id, 'status' => $status]);
    }

    public function regenerateCredentials(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $partner = DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (! $partner) {
            return $this->respondNotFound(__('api.federation.partner_not_found'), 'PARTNER_NOT_FOUND');
        }

        // Revoke all existing credentials AND outstanding tokens.
        PartnerApiAuthService::revokeCredentials($id);
        DB::table('api_oauth_tokens')
            ->where('partner_id', $id)
            ->where('tenant_id', $tenantId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        $creds = PartnerApiAuthService::issueClientCredentials($id);

        return $this->respondWithData(['credentials' => $creds], null, 201);
    }

    public function callLog(Request $request, int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->requirePartnerApiFeature();
        $tenantId = TenantContext::getId();

        $partner = DB::table('api_partners')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (! $partner) {
            return $this->respondNotFound(__('api.federation.partner_not_found'), 'PARTNER_NOT_FOUND');
        }

        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(200, max(1, (int) $request->query('per_page', 50)));
        $offset = ($page - 1) * $perPage;

        $rows = DB::table('api_call_log')
            ->where('partner_id', $id)
            ->where('tenant_id', $tenantId)
            ->orderBy('id', 'desc')
            ->offset($offset)
            ->limit($perPage)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $total = (int) DB::table('api_call_log')
            ->where('partner_id', $id)
            ->where('tenant_id', $tenantId)
            ->count();

        return $this->respondWithPaginatedCollection($rows, $total, $page, $perPage);
    }

    private function serializePartner(array $p): array
    {
        $decode = static function ($v): array {
            if (is_string($v)) {
                $d = json_decode($v, true);
                return is_array($d) ? $d : [];
            }
            return is_array($v) ? $v : [];
        };

        return [
            'id' => (int) $p['id'],
            'name' => $p['name'],
            'slug' => $p['slug'],
            'description' => $p['description'] ?? null,
            'contact_email' => $p['contact_email'] ?? null,
            'status' => $p['status'],
            'is_sandbox' => (bool) ($p['is_sandbox'] ?? 0),
            'allowed_scopes' => $decode($p['allowed_scopes'] ?? null),
            'allowed_ip_cidrs' => $decode($p['allowed_ip_cidrs'] ?? null),
            'rate_limit_per_minute' => (int) ($p['rate_limit_per_minute'] ?? 60),
            'created_at' => $p['created_at'] ?? null,
            'updated_at' => $p['updated_at'] ?? null,
        ];
    }
}
