<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-473 (E-075) — DELETE /v2/admin/users/{id}/verification-badges/{type} must
 * refuse a member of another community, exactly as its read sibling does.
 *
 * `MemberVerificationBadgeController::revokeBadge()` never checked that `{id}`
 * is a member of the caller's community, so it answered 200 with an ordinary
 * success payload. Nothing was revoked — `MemberVerificationBadgeService` is
 * community-scoped — but an operator or an automation was told the revocation
 * succeeded. `getAdminBadgeList()` three methods below it was given exactly
 * that check on 2026-09-10 (CrossCommunityAccessSweepTest); the revoke sibling
 * was missed.
 *
 * Adapted from
 * `.local-docs-archive/security-log/E-075/repro/c/C5UnverifiedAdminDeleteReportsSuccessTest.php`,
 * which asserted the bad outcome.
 */
final class F473VerificationBadgeRevokeRefusesForeignMemberTest extends TestCase
{
    use DatabaseTransactions;

    private const HOME = 2;    // victim community
    private const OTHER = 999; // caller's own community

    private function member(int $tenant, array $extra = []): User
    {
        return User::factory()->forTenant($tenant)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $extra));
    }

    private function seedBadge(int $tenant, int $userId, int $grantedBy): int
    {
        return (int) DB::table('member_verification_badges')->insertGetId([
            'user_id' => $userId,
            'tenant_id' => $tenant,
            'badge_type' => 'id_verified',
            'verified_by' => $grantedBy,
            'granted_at' => now(),
        ]);
    }

    /**
     * CORRECT BEHAVIOUR — the write path refuses the foreign member id with the
     * same 404 the read path already gives, and nothing is revoked.
     */
    public function test_revoking_a_badge_from_a_member_of_another_community_is_refused(): void
    {
        $this->withTenant(self::HOME);
        $victim = $this->member(self::HOME);
        $homeAdmin = $this->member(self::HOME, ['role' => 'admin']);
        $badgeId = $this->seedBadge(self::HOME, (int) $victim->id, (int) $homeAdmin->id);

        $stranger = $this->member(self::OTHER, ['role' => 'admin']);
        Sanctum::actingAs($stranger, ['*']);
        $this->withTenant(self::OTHER);

        $revoke = $this->deleteJson(
            '/api/v2/admin/users/' . $victim->id . '/verification-badges/id_verified',
            [],
            ['X-Tenant-ID' => (string) self::OTHER, 'Accept' => 'application/json']
        );

        $revoke->assertStatus(404);
        self::assertSame('NOT_FOUND', $revoke->json('errors.0.code'));

        $this->withTenant(self::OTHER);
        self::assertNull(
            DB::table('member_verification_badges')->where('id', $badgeId)->value('revoked_at'),
            'the badge is untouched — the service layer is community-scoped'
        );

        // The read sibling in the same controller refuses the same id the same
        // way; the two must now agree.
        $read = $this->getJson(
            '/api/v2/admin/users/' . $victim->id . '/verification-badges',
            ['X-Tenant-ID' => (string) self::OTHER, 'Accept' => 'application/json']
        );
        $read->assertStatus(404);
        self::assertSame(
            $read->json('errors.0.code'),
            $revoke->json('errors.0.code'),
            'the read and write siblings must refuse a foreign member id identically'
        );
    }

    /**
     * CONTROL — the owning community's administrator's identical call still
     * really revokes the badge.
     */
    public function test_control_the_owning_administrator_still_really_revokes_the_badge(): void
    {
        $this->withTenant(self::HOME);
        $victim = $this->member(self::HOME);
        $admin = $this->member(self::HOME, ['role' => 'admin']);
        $badgeId = $this->seedBadge(self::HOME, (int) $victim->id, (int) $admin->id);

        Sanctum::actingAs($admin, ['*']);
        $this->withTenant(self::HOME);

        $resp = $this->deleteJson(
            '/api/v2/admin/users/' . $victim->id . '/verification-badges/id_verified',
            [],
            ['X-Tenant-ID' => (string) self::HOME, 'Accept' => 'application/json']
        );

        $resp->assertStatus(200);
        $this->withTenant(self::HOME);
        self::assertNotNull(
            DB::table('member_verification_badges')->where('id', $badgeId)->value('revoked_at'),
            'control: the owning administrator really revokes the badge'
        );
    }
}
