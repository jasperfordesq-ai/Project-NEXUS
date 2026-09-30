<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\CaringCommunity\NationalKissDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * NationalKissDashboardController.
 *
 * Cross-tenant super-admin endpoints powering the National KISS Foundation
 * dashboard. Every endpoint requires the `national.kiss_dashboard.view`
 * permission, which today belongs only to:
 *
 *   - platform super-admins (role=super_admin / god / is_super_admin)
 *   - tenants whose user holds the kiss_national_admin role preset
 *     (which has been granted national.kiss_dashboard.view)
 *
 * NOTE: these endpoints intentionally span tenants. They never expose PII.
 */
class NationalKissDashboardController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly NationalKissDashboardService $service,
    ) {
    }

    /**
     * GET /api/v2/admin/national/kiss/cooperatives
     */
    public function cooperatives(): JsonResponse
    {
        $this->authorizeNationalDashboard();

        return $this->respondWithData([
            'cooperatives' => $this->service->listCooperatives(),
        ]);
    }

    /**
     * GET /api/v2/admin/national/kiss/summary?period_from=YYYY-MM-DD&period_to=YYYY-MM-DD
     */
    public function summary(): JsonResponse
    {
        $this->authorizeNationalDashboard();

        [$from, $to] = $this->resolvePeriod();

        return $this->respondWithData($this->service->nationalSummary($from, $to));
    }

    /**
     * GET /api/v2/admin/national/kiss/comparative?period_from=YYYY-MM-DD&period_to=YYYY-MM-DD
     */
    public function comparative(): JsonResponse
    {
        $this->authorizeNationalDashboard();

        [$from, $to] = $this->resolvePeriod();

        return $this->respondWithData([
            'rows' => $this->service->comparativeMetrics($from, $to),
        ]);
    }

    /**
     * GET /api/v2/admin/national/kiss/trend
     */
    public function trend(): JsonResponse
    {
        $this->authorizeNationalDashboard();

        return $this->respondWithData([
            'trend' => $this->service->nationalTrend(),
        ]);
    }

    /**
     * Authorize the caller for the national KISS dashboard.
     *
     * Accepts:
     *   - platform super-admins (super_admin / god / is_super_admin)
     *   - any user holding the `national.kiss_dashboard.view` permission
     *     (granted by the kiss_national_admin role preset)
     *
     * Throws 403 otherwise.
     */
    private function authorizeNationalDashboard(): int
    {
        $userId = $this->requireAuth();
        $user = Auth::user();

        if ($user) {
            $role = $user->role ?? 'member';

            if (in_array($role, ['super_admin', 'god'], true)) {
                return $userId;
            }

            if (($user->is_super_admin ?? false) || ($user->is_god ?? false)) {
                return $userId;
            }
        }

        if ($this->userHasNationalDashboardPermission($userId)) {
            return $userId;
        }

        throw new \Illuminate\Http\Exceptions\HttpResponseException(
            $this->error(
                __('api.admin_access_required'),
                403,
                'AUTH_INSUFFICIENT_PERMISSIONS'
            )
        );
    }

    private function userHasNationalDashboardPermission(int $userId): bool
    {
        if (! Schema::hasTable('user_roles')
            || ! Schema::hasTable('roles')
            || ! Schema::hasTable('role_permissions')
            || ! Schema::hasTable('permissions')
        ) {
            return false;
        }

        // F-371: ur.tenant_id must match the community the request is being made
        // from. Without it a grant made in ONE community satisfied this check from
        // ANY community — and the four routes it guards are the cross-cooperative
        // comparison views. Same missing filter that commit 0cb8be769 added to
        // EnsureIsAdmin. The role itself stays platform-global (r.tenant_id IS
        // NULL); it is the GRANT that must be local.
        $tenantId = \App\Core\TenantContext::getId();
        if ($tenantId <= 0) {
            return false;
        }

        $row = DB::selectOne(
            "SELECT 1 AS ok
             FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id
             JOIN role_permissions rp ON rp.role_id = ur.role_id
             JOIN permissions p ON p.id = rp.permission_id
             WHERE ur.user_id = ?
               AND ur.tenant_id = ?
               AND p.name = 'national.kiss_dashboard.view'
               AND r.name = 'kiss_national_admin'
               AND r.is_system = 1
               AND r.tenant_id IS NULL
               AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
             LIMIT 1",
            [$userId, $tenantId]
        );

        return $row !== null;
    }

    /**
     * @return array{0:string, 1:string}
     */
    private function resolvePeriod(): array
    {
        $from = $this->query('period_from');
        $to = $this->query('period_to');

        if (! is_string($from) || $from === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
            $from = date('Y-m-d', strtotime('-90 days'));
        }
        if (! is_string($to) || $to === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
            $to = date('Y-m-d');
        }

        return [$from, $to];
    }
}
