<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api\Concerns;

use App\Core\ApiErrorCodes;
use App\Core\SuperPanelAccess;

/**
 * The super admin panel's own requireSuperAdmin(): after the base check it
 * resets and re-reads SuperPanelAccess for the caller and refuses with
 * SUPER_PANEL_ACCESS_DENIED when access is not granted. Shared by
 * AdminSuperController and the Branch payments and Branch plans
 * controllers, which were moved out of it on 23 November 2026 unchanged.
 */
trait RequiresSuperPanelAccess
{
    /**
     * Override requireSuperAdmin for stateless JWT API auth.
     *
     * Passes the JWT user ID directly to SuperPanelAccess::getAccess($userId),
     * completely bypassing $_SESSION dependency. This is critical because
     * session_start() can fail silently in containerized/Docker environments,
     * causing all super admin API calls to return 403.
     *
     * Also syncs to $_SESSION as a fallback for any code that still reads it.
     */
    protected function requireSuperAdmin(): int
    {
        $userId = parent::requireSuperAdmin();

        // Reset any stale cached access from earlier in this request
        SuperPanelAccess::reset();

        // Pass user ID directly — no session dependency
        $access = SuperPanelAccess::getAccess($userId);

        if (!$access['granted']) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_panel_access_denied', ['reason' => $access['reason'] ?? __('api.unknown_reason')]),
                    null,
                    403
                )
            );
        }

        // Best-effort session sync for any legacy code that reads session data
        try {
            $session = request()->session();
            $session->put('user_id', $userId);
            $session->put('tenant_id', $access['tenant_id']);
            $session->put('user_role', 'admin');
            // Mirror the tier the caller actually holds. This wrote
            // is_super_admin = 1 for every admitted caller, so a tenant super
            // admin's session claimed the platform tier (E-103, 12 Oct 2026).
            $isPlatform = ($access['level'] ?? null) === 'master';
            $session->put('is_super_admin', $isPlatform ? 1 : 0);
            $session->put('is_tenant_super_admin', $isPlatform ? 0 : 1);
        } catch (\Throwable $e) {
            // Session sync is best-effort — API works without it
        }

        return $userId;
    }
}
