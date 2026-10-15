<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Models\User;
use App\Services\TokenService;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;

/**
 * A staff account working in a community other than its own home community
 * (the platform owner anywhere; a tenant super admin below its home) must be
 * able to confirm a high-risk action with ITS OWN authenticator.
 *
 * Until 12 Oct 2026 both GET /webauthn/status and POST /webauthn/security-confirm
 * looked the actor up with `tenant_id = <current community>`. The actor's row
 * and its authenticator live in its home community, so the status answered
 * "no authenticator" and the confirmation refused every code: the owner could
 * not delete a member on hour-timebank.ie despite having two-factor enabled.
 */
class CrossTenantStepUpTest extends TwoFactorAuditTestCase
{
    use MakesNetworkAdminHierarchy;

    private const HOME = 997;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        // HOME becomes a root with the shared test community below it.
        $this->makeHomeTenantOversee(self::HOME, $this->testTenantId);
    }

    private function platformOwner(): User
    {
        return User::factory()->forTenant(self::HOME)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 1,
            'is_god' => 1,
        ]);
    }

    /** A session whose second factor is long past the step-up window. */
    private function staleSession(User $user): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            ['mfa_method' => 'totp', 'mfa_verified_at' => time() - 86400]
        )];
    }

    public function test_status_reports_the_visiting_owners_own_authenticator(): void
    {
        $owner = $this->platformOwner();
        $this->enrol($owner);

        $this->apiGet('/webauthn/status', $this->staleSession($owner))
            ->assertOk()
            ->assertJsonPath('data.confirmation_methods.totp', true);
    }

    public function test_visiting_owner_confirms_with_own_code_and_bans_a_member_here(): void
    {
        $owner = $this->platformOwner();
        $secret = $this->enrol($owner);
        $target = $this->member();
        $session = $this->staleSession($owner);

        $confirm = $this->apiPost('/webauthn/security-confirm', ['totp_code' => $this->code($secret)], $session);
        $confirm->assertOk();
        $proof = $confirm->json('data.security_confirmation_token') ?? $confirm->json('security_confirmation_token');
        $this->assertIsString($proof);

        $this->apiPost(
            "/v2/admin/users/{$target->id}/ban",
            ['reason' => 'Repeated abuse of members'],
            $session + ['X-Security-Confirmation' => $proof]
        )->assertOk();
        $this->assertSame('banned', User::query()->whereKey($target->id)->value('status'));
    }

    public function test_a_wrong_code_is_still_refused_for_a_visiting_owner(): void
    {
        $owner = $this->platformOwner();
        $secret = $this->enrol($owner);

        $this->apiPost('/webauthn/security-confirm', ['totp_code' => $this->code($secret, 5)], $this->staleSession($owner))
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED');
    }

    private function tenantSuperAdminAbove(): User
    {
        return User::factory()->forTenant(self::HOME)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
            'role' => 'admin',
            'is_admin' => 1,
            'is_tenant_super_admin' => 1,
        ]);
    }

    public function test_a_tenant_super_admin_from_above_confirms_with_own_code_and_deletes_a_member(): void
    {
        $tsa = $this->tenantSuperAdminAbove();
        $secret = $this->enrol($tsa);
        $target = $this->member();
        $session = $this->staleSession($tsa);

        $this->apiGet('/webauthn/status', $session)
            ->assertOk()
            ->assertJsonPath('data.confirmation_methods.totp', true);

        $this->apiDelete("/v2/admin/users/{$target->id}", [], $session)
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');

        $confirm = $this->apiPost('/webauthn/security-confirm', ['totp_code' => $this->code($secret)], $session);
        $confirm->assertOk();
        $proof = $confirm->json('data.security_confirmation_token') ?? $confirm->json('security_confirmation_token');
        $this->assertIsString($proof);

        $this->apiDelete("/v2/admin/users/{$target->id}", [], $session + ['X-Security-Confirmation' => $proof])
            ->assertOk();
    }

    public function test_a_tenant_super_admin_from_above_still_cannot_manage_its_passkeys_from_below(): void
    {
        // Only the two step-up calls are admitted, not the rest of /webauthn.
        // Refused as a visit since E-107 (15 Oct 2026): a manager from above
        // may look around the member side here, but /webauthn is not part of it.
        $tsa = $this->tenantSuperAdminAbove();

        $this->apiGet('/webauthn/credentials', $this->staleSession($tsa))
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', \App\Support\Authorization\CrossTenantEntry::VISITOR_READ_ONLY_CODE);
    }

    public function test_a_code_from_a_member_of_another_community_mints_nothing_here(): void
    {
        // An ordinary member elsewhere is not admitted to this community, so
        // looking the actor up by id must not let its code confirm anything.
        $outsider = User::factory()->forTenant(self::HOME)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $secret = $this->enrol($outsider);

        $response = $this->apiPost('/webauthn/security-confirm', ['totp_code' => $this->code($secret)], $this->staleSession($outsider));
        $this->assertContains($response->status(), [401, 403]);
        $this->assertNull($response->json('data.security_confirmation_token'));
        $this->assertNull($response->json('security_confirmation_token'));
    }
}
