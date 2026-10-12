<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Models\User;
use App\Services\TokenService;

/**
 * The owner's journey, 12 Oct 2026: a tenant super admin in its OWN community,
 * authenticator enrolled, signed in on a device remembered for 30 days, tries
 * to delete a member. The server asks for a fresh code; the code box must be
 * offered, the code must be accepted, and the delete must then go through.
 */
class RememberedDeviceStepUpTest extends TwoFactorAuditTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    private function tenantSuperAdmin(): User
    {
        return $this->member(['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1]);
    }

    /** @return array<string,string> */
    private function rememberedDeviceSession(User $user): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            ['mfa_method' => 'trusted_device', 'mfa_verified_at' => time() - 3 * 86400]
        )];
    }

    public function test_status_offers_the_authenticator_on_a_remembered_device(): void
    {
        $admin = $this->tenantSuperAdmin();
        $this->enrol($admin);

        $this->apiGet('/webauthn/status', $this->rememberedDeviceSession($admin))
            ->assertOk()
            ->assertJsonPath('data.confirmation_methods.totp', true);
    }

    public function test_remembered_device_admin_confirms_with_a_code_and_deletes_a_member(): void
    {
        $admin = $this->tenantSuperAdmin();
        $secret = $this->enrol($admin);
        $target = $this->member();
        $session = $this->rememberedDeviceSession($admin);

        $this->apiDelete("/v2/admin/users/{$target->id}", [], $session)
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');

        $confirm = $this->apiPost('/webauthn/security-confirm', ['totp_code' => $this->code($secret)], $session);
        $confirm->assertOk();
        $proof = $confirm->json('data.security_confirmation_token') ?? $confirm->json('security_confirmation_token');
        $this->assertIsString($proof);

        $response = $this->apiDelete("/v2/admin/users/{$target->id}", [], $session + ['X-Security-Confirmation' => $proof]);
        $this->assertNotSame('AUTH_STEP_UP_REQUIRED', $response->json('errors.0.code'));
        $response->assertOk();
    }
}
