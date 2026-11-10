<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Support\Names\NameAudience;
use App\Support\Names\NameReason;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensure the authenticated user has broker-or-admin privileges.
 *
 * Accepts: role='broker' AND any admin-level role/flag
 * (is_admin, is_super_admin, is_tenant_super_admin, is_god,
 * role in [admin, tenant_admin, super_admin]).
 *
 * Used for /v2/admin/broker/*, /v2/admin/vetting/*, /v2/admin/insurance/*,
 * /v2/admin/safeguarding/* and a small number of broker-relevant
 * /v2/admin/users/* and /v2/admin/crm/* endpoints — all of which the
 * React broker panel calls. Brokers are deliberately denied access to
 * generic /v2/admin/* endpoints (tenants, federation, settings, etc.)
 * which remain on the stricter `admin` middleware.
 */
class EnsureIsBrokerOrAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'errors' => [
                    ['code' => 'auth_required', 'message' => __('api.auth_required')],
                ],
                'success' => false,
            ], 401, [
                'API-Version' => '2.0',
            ]);
        }

        $role = (string) ($user->role ?? '');

        $hasAdminFlag = $user->is_admin
            || $user->is_super_admin
            || $user->is_tenant_super_admin
            || $user->is_god;

        // Role list mirrors BaseApiController::requireBrokerOrAdmin() so the
        // route-level gate and the controller-level helper agree on what
        // counts as admin-tier. 'god' is the platform's break-glass role.
        $hasAdminRole = in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true);

        // 'broker' and 'coordinator' are operational roles that share the
        // same panel as admins. Several notification-recipient queries
        // (NotifyAdminOfNewRegistration, MatchApprovalWorkflowService,
        // notifyAdmins for listing_risk_tagged, etc.) include 'coordinator'
        // — without granting them broker-panel access, every /broker/*
        // notification link bounced them to /dashboard.
        $isBrokerTier = in_array($role, ['broker', 'coordinator'], true);

        if (!$isBrokerTier && !$hasAdminFlag && !$hasAdminRole) {
            return response()->json([
                'errors' => [
                    ['code' => 'forbidden', 'message' => __('api.broker_or_admin_access_required')],
                ],
                'success' => false,
            ], 403, [
                'API-Version' => '2.0',
            ]);
        }

        // E-122: a caller this gate admits sees members' full names on the
        // screen it guards. Does nothing until the surname switch is on.
        NameAudience::grantForRequest($request, NameReason::BROKER_PANEL);

        return $next($request);
    }
}
