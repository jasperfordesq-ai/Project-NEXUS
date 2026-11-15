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
 * Left open on purpose (design 6.2, "L2"), and pinned below: the whitelist
 * and the partnership list / suspend / terminate endpoints are also called by
 * the per-community federation page, which stays in the super admin panel;
 * the audit log and the community list are shared with pages that stay too;
 * and the read-only federation overview, which no screen calls, is the tier B
 * control of RegionalPanelIsolationTest.
 */
final class AdminSuperControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            // Federation dashboard — its own endpoints.
            'federation switches' => ['GET', '/v2/admin/super/federation/system-controls'],
            'federation signing key status' => ['GET', '/v2/admin/super/federation/jwt-status'],
            'external federation status' => ['GET', '/v2/admin/super/federation/external-status'],
            'save federation switches' => ['PUT', '/v2/admin/super/federation/system-controls', 'refusal-only'],
            'emergency lockdown' => ['POST', '/v2/admin/super/federation/emergency-lockdown', 'refusal-only'],
            'lift lockdown' => ['POST', '/v2/admin/super/federation/lift-lockdown', 'refusal-only'],
            'reactivate a partnership' => ['POST', '/v2/admin/super/federation/partnerships/999999999/reactivate', 'refusal-only'],

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
        ];
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function leftOpenToAGlobalSuperAdmin(): array
    {
        return [
            // Shared with the per-community federation page (super admin panel).
            'whitelist' => ['GET', '/v2/admin/super/federation/whitelist'],
            'add to the whitelist' => ['POST', '/v2/admin/super/federation/whitelist'],
            'remove from the whitelist' => ['DELETE', '/v2/admin/super/federation/whitelist/999999999'],
            'partnerships' => ['GET', '/v2/admin/super/federation/partnerships'],
            'suspend a partnership' => ['POST', '/v2/admin/super/federation/partnerships/999999999/suspend'],
            'terminate a partnership' => ['POST', '/v2/admin/super/federation/partnerships/999999999/terminate'],
            // No screen calls this read-only summary; RegionalPanelIsolationTest
            // (not to be edited) uses it as its tier B control, so it stays.
            'federation overview' => ['GET', '/v2/admin/super/federation'],
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
     * The two that change an installation-wide switch, as the platform team:
     * the lock test above only proves who is refused.
     */
    public function test_the_platform_team_is_admitted_to_the_federation_switches(): void
    {
        $this->actAsPlatformTeam();

        // An empty save changes nothing and must not be refused.
        $status = $this->apiPut('/v2/admin/super/federation/system-controls', [])->getStatusCode();
        $this->assertNotContains($status, [401, 403], "saving the switches refused the platform team with {$status}");

        // A partnership that does not exist: the lock has been passed if the answer is about the record.
        $status = $this->apiPost('/v2/admin/super/federation/partnerships/999999999/reactivate')->getStatusCode();
        $this->assertNotContains($status, [401, 403], "reactivating refused the platform team with {$status}");
    }
}
