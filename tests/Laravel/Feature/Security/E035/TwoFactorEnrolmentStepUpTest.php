<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-170 — enrolling a new TOTP authenticator on an already-authenticated
 * session (bearer token, not the first-login two_factor_token challenge) must
 * present a fresh security confirmation, exactly as passkey registration does
 * (F-056). A stolen bearer alone must not be enough to enrol an authenticator
 * and lock the owner out.
 */
class TwoFactorEnrolmentStepUpTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // This test drives the endpoints with REAL bearer tokens, not
        // Sanctum::actingAs, so the admin-MFA test shim must stay out of the way.
        \Tests\Laravel\Support\ActingAsVerifiedAdministrator::$disabled = true;
    }

    /** An admin whose MFA baseline is satisfied at the token level (first-time setup scenario). */
    private function admin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'admin', 'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
        return $u->refresh();
    }

    private function bearer(User $u): string
    {
        return app(TokenService::class)->generateToken(
            (int) $u->id,
            $this->testTenantId,
            TwoFactorPolicy::claims('totp')
        );
    }

    private function headers(string $token): array
    {
        return ['Authorization' => 'Bearer ' . $token];
    }

    public function test_authenticated_setup_without_confirmation_is_refused(): void
    {
        TenantContext::setById($this->testTenantId);
        $admin = $this->admin();
        $token = $this->bearer($admin);

        $res = $this->apiPost('/v2/auth/2fa/setup', [], $this->headers($token));

        $this->assertSame(403, $res->status(), 'setup proceeded without a fresh security confirmation');
        $res->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED');
    }

    public function test_authenticated_setup_with_fresh_confirmation_is_allowed(): void
    {
        TenantContext::setById($this->testTenantId);
        $admin = $this->admin();
        $token = $this->bearer($admin);
        $confirmation = app(TokenService::class)->generateSecurityConfirmationToken(
            (int) $admin->id,
            $this->testTenantId,
            'password'
        );

        $res = $this->apiPost('/v2/auth/2fa/setup', [
            'security_confirmation_token' => $confirmation,
        ], $this->headers($token));

        // The confirmation gate is passed: the response is NOT the step-up refusal.
        $this->assertNotSame(
            'SECURITY_CONFIRMATION_REQUIRED',
            $res->json('errors.0.code'),
            'a valid fresh confirmation was still refused'
        );
        $this->assertSame(200, $res->status(), 'enrolment did not start with a valid confirmation');
        $this->assertNotNull($res->json('data.qr_code_url'));
    }
}
