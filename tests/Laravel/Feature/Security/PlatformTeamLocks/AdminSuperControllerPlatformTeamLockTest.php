<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * The platform-wide half of the super admin panel is the platform team's
 * (owner, 15 Nov 2026: "Yes, move it"): the Federation dashboard with its
 * kill switches, and platform billing and revenue.
 *
 * Until phase 2 the federation endpoints admitted any global super admin.
 * The billing endpoints already asked for `is_god` AND super admin as two
 * separate checks; they now ask the one shared question, so their rows here
 * pin behaviour that did not change.
 *
 * Left open on purpose (design 6.2, "L2"), and pinned below: the audit log
 * and the community list, which are shared with pages that stay in the super
 * admin panel.
 *
 * The federation whitelist and the partnership list / suspend / reactivate /
 * terminate endpoints were left open here too, because the per-community
 * federation page called them. Owner decision 17 Nov 2026 (closes O-292):
 * they are the platform team's. That page now reads its own scoped request
 * (`federation/tenant/{id}/features`) and shows the whitelist status and the
 * partnerships read-only, so they moved into `locked()` below.
 * (The read-only federation overview was left open for a few hours on 15 Nov
 * 2026 because RegionalPanelIsolationTest used it as its tier B control; the
 * owner said to lock it. That control used the whitelist until 17 Nov 2026
 * and now uses the audit log.)
 */
final class AdminSuperControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            // Federation dashboard — its own endpoints.
            'federation overview' => ['GET', '/v2/admin/super/federation'],
            'federation switches' => ['GET', '/v2/admin/super/federation/system-controls'],
            'federation signing key status' => ['GET', '/v2/admin/super/federation/jwt-status'],
            'external federation status' => ['GET', '/v2/admin/super/federation/external-status'],
            'save federation switches' => ['PUT', '/v2/admin/super/federation/system-controls', 'refusal-only'],
            'emergency lockdown' => ['POST', '/v2/admin/super/federation/emergency-lockdown', 'refusal-only'],
            'lift lockdown' => ['POST', '/v2/admin/super/federation/lift-lockdown', 'refusal-only'],

            // Federation whitelist and partnerships (owner decision 17 Nov 2026).
            'whitelist' => ['GET', '/v2/admin/super/federation/whitelist'],
            'add to the whitelist' => ['POST', '/v2/admin/super/federation/whitelist', 'refusal-only'],
            'remove from the whitelist' => ['DELETE', '/v2/admin/super/federation/whitelist/999999999', 'refusal-only'],
            'partnerships' => ['GET', '/v2/admin/super/federation/partnerships'],
            'suspend a partnership' => ['POST', '/v2/admin/super/federation/partnerships/999999999/suspend', 'refusal-only'],
            'reactivate a partnership' => ['POST', '/v2/admin/super/federation/partnerships/999999999/reactivate', 'refusal-only'],
            'terminate a partnership' => ['POST', '/v2/admin/super/federation/partnerships/999999999/terminate', 'refusal-only'],

            // Platform billing and revenue.
            'billing snapshot' => ['GET', '/v2/admin/super/billing/snapshot'],
            'revenue' => ['GET', '/v2/admin/super/billing/revenue'],
            'billing export' => ['GET', '/v2/admin/super/billing/export'],
            'assign a plan' => ['POST', '/v2/admin/super/billing/assign-plan', 'refusal-only'],
            'grant a billing delegate' => ['POST', '/v2/admin/super/billing/delegate/grant', 'refusal-only'],
            'revoke a billing delegate' => ['POST', '/v2/admin/super/billing/delegate/revoke', 'refusal-only'],
            'pause billing' => ['POST', '/v2/admin/super/billing/pause', 'refusal-only'],
            'resume billing' => ['POST', '/v2/admin/super/billing/resume', 'refusal-only'],
            'billing grace period' => ['POST', '/v2/admin/super/billing/grace-period', 'refusal-only'],
            // Pausing a community for non-payment (20 Nov 2026). Refusal-only:
            // the success path changes a community's standing.
            'pause a community' => ['POST', '/v2/admin/super/billing/standing/suspend', 'refusal-only'],
            'restore a community' => ['POST', '/v2/admin/super/billing/standing/restore', 'refusal-only'],
            'exempt a community' => ['POST', '/v2/admin/super/billing/standing/exempt', 'refusal-only'],
            // The daily check's controls (Stage 3c). Saving settings and
            // setting a date are refusal-only: their success path changes
            // what every community is told, or one community's standing.
            'daily check settings' => ['GET', '/v2/admin/super/billing/settings'],
            'save daily check settings' => ['PUT', '/v2/admin/super/billing/settings', 'refusal-only'],
            'what would happen today' => ['GET', '/v2/admin/super/billing/standing/preview'],
            'set a paid-until date' => ['POST', '/v2/admin/super/billing/standing/paid-until', 'refusal-only'],
        ];
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function leftOpenToAGlobalSuperAdmin(): array
    {
        return [
            // Shared with the super admin audit log and community pages.
            'audit log' => ['GET', '/v2/admin/super/audit'],
            'community list' => ['GET', '/v2/admin/super/tenants'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('leftOpenToAGlobalSuperAdmin')]
    public function test_a_global_super_admin_who_is_not_on_the_team_still_reaches(string $method, string $uri): void
    {
        $this->actAsGlobalSuperAdminNotOnTeam();
        $status = $this->requestAs($method, $uri)->getStatusCode();

        $this->assertNotContains($status, [401, 403], "{$method} {$uri} must stay open to a global super admin, got {$status}");
    }

    /**
     * The whitelist and the partnership list are platform-wide (every
     * community's, not one branch's), so a tenant super admin — whose reach
     * is its own branch only — must never read them. Named on its own because
     * `requireSuperAdmin()`, which these two used until 17 Nov 2026, admits
     * `is_tenant_super_admin`.
     */
    public function test_a_tenant_super_admin_cannot_read_the_whitelist_or_the_partnerships(): void
    {
        foreach (['/v2/admin/super/federation/whitelist', '/v2/admin/super/federation/partnerships'] as $uri) {
            $this->actAsTier(['role' => 'admin', 'is_tenant_super_admin' => true]);
            $status = $this->apiGet($uri)->getStatusCode();

            $this->assertSame(403, $status, "GET {$uri} must refuse a tenant super admin, got {$status}");
        }
    }

    /**
     * Saving the installation-wide switches, as the platform team: the lock
     * test above only proves who is refused.
     */
    public function test_the_platform_team_is_admitted_to_the_federation_switches(): void
    {
        $this->actAsPlatformTeam();

        // An empty save changes nothing and must not be refused.
        $status = $this->apiPut('/v2/admin/super/federation/system-controls', [])->getStatusCode();
        $this->assertNotContains($status, [401, 403], "saving the switches refused the platform team with {$status}");
    }
}
