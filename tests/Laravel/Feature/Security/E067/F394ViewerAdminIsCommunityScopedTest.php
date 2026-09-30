<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\UserService;
use App\Support\Members\MemberProfileVisibility;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-394 (E-067) — a latent cross-community over-authorisation.
 *
 * MemberProfileVisibility::viewerIsAdmin() and UserService::isViewerAdmin()
 * loaded the viewer without the tenant scope ("so super-admins from other
 * tenants are recognised") and then accepted ANY admin tier, so an ordinary
 * administrator of community A counted as an administrator of community B:
 * past connections-only profile privacy, and shown a member's exact home
 * coordinates and surname by getPublicProfile(). Not reachable over HTTP today
 * — Authenticate refuses a cross-community token — but one route moved to
 * optional authentication would have made it live.
 *
 * Now only platform-level authority (super-admin, god) crosses communities; a
 * community administrator counts only in their own community. Both copies of
 * the predicate are the same function.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/f/F1CrossTenantAdminProfileDisclosureTest.php`,
 * which asserted the bad outcome; those assertions are inverted.
 */
final class F394ViewerAdminIsCommunityScopedTest extends TestCase
{
    use DatabaseTransactions;

    public function test_an_admin_of_another_community_does_not_bypass_connections_only_privacy(): void
    {
        $adminA = $this->user($this->community('A'), ['role' => 'admin']);
        $ownerB = $this->user($communityB = $this->community('B'), ['privacy_profile' => 'connections']);

        TenantContext::setById($communityB);

        $this->assertFalse(MemberProfileVisibility::viewerIsAdmin((int) $adminA->id));
        $this->assertFalse(MemberProfileVisibility::canView((int) $ownerB->id, (int) $adminA->id));
    }

    public function test_an_admin_of_another_community_gets_the_ordinary_member_profile(): void
    {
        $adminA = $this->user($this->community('A2'), ['role' => 'admin']);
        $ownerB = $this->user($communityB = $this->community('B2'), [
            'privacy_profile' => 'public',
            'onboarding_completed' => true,
            'avatar_url' => '/uploads/f394/a.png',
            'bio' => 'F394 synthetic bio long enough to be visible.',
            'last_name' => 'SecretSurname' . random_int(1000, 9999),
            'latitude' => 53.349805,
            'longitude' => -6.260310,
        ]);

        TenantContext::setById($communityB);

        $asForeignAdmin = UserService::getPublicProfile((int) $ownerB->id, (int) $adminA->id);
        $this->assertIsArray($asForeignAdmin, json_encode(UserService::getErrors()));
        $this->assertArrayNotHasKey('last_name', $asForeignAdmin, 'no surname for a foreign-community admin');
        $this->assertNotEquals(53.349805, (float) ($asForeignAdmin['latitude'] ?? 0), 'coordinates are coarsened for them');
    }

    public function test_control_an_admin_of_this_community_is_still_exempt(): void
    {
        $communityB = $this->community('B3');
        $adminB = $this->user($communityB, ['role' => 'admin']);
        $ownerB = $this->user($communityB, ['privacy_profile' => 'connections']);

        TenantContext::setById($communityB);

        $this->assertTrue(MemberProfileVisibility::viewerIsAdmin((int) $adminB->id));
        $this->assertTrue(MemberProfileVisibility::canView((int) $ownerB->id, (int) $adminB->id));
    }

    public function test_control_a_platform_super_admin_is_legitimately_cross_community(): void
    {
        $superAdmin = $this->user($this->community('S'), ['is_super_admin' => true]);
        $ownerB = $this->user($communityB = $this->community('B4'), ['privacy_profile' => 'connections']);

        TenantContext::setById($communityB);

        $this->assertTrue(MemberProfileVisibility::canView((int) $ownerB->id, (int) $superAdmin->id));
    }

    private function community(string $tag): int
    {
        $suffix = substr(bin2hex(random_bytes(4)), 0, 8);

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'F394 ' . $tag . ' ' . $suffix,
            'slug' => 'f394-' . strtolower($tag) . '-' . $suffix,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $attributes */
    private function user(int $tenantId, array $attributes = []): User
    {
        return User::factory()->forTenant($tenantId)->create(array_merge(
            ['status' => 'active', 'is_approved' => true, 'role' => 'member'],
            $attributes
        ));
    }
}
