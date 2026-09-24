<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 O-061 — a support (impersonation) session is read-only. Public
 * optional-auth endpoints must refuse it for writes, and restore-session must
 * not turn it into an ordinary legacy session.
 */
final class ImpersonationOptionalAuthTest extends TestCase
{
    use DatabaseTransactions;

    private function tokens(): TokenService
    {
        return app(TokenService::class);
    }

    private function impersonationToken(): array
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $actor = DB::table('users')->where('id', $admin->id)->first();
        $jwt = $this->tokens()->generateToken((int) $admin->id, (int) $actor->tenant_id, TwoFactorPolicy::claims('totp'));
        $proof = $this->tokens()->generateImpersonationToken(
            (int) $member->id,
            $this->testTenantId,
            (int) $admin->id,
            $this->tokens()->validateToken($jwt)
        );

        $exchange = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof]);
        $exchange->assertStatus(200);
        $token = $exchange->json('access_token');
        $this->assertIsString($token);
        $this->assertNotEmpty($this->tokens()->validateToken($token)['impersonated_by'] ?? null);

        return [$token, $member];
    }

    public function test_optional_auth_write_refuses_an_impersonation_token(): void
    {
        [$token, $member] = $this->impersonationToken();

        $response = $this->apiPost('/cookie-consent', ['analytics' => true], ['Authorization' => 'Bearer ' . $token]);

        $response->assertStatus(403);
        $this->assertSame('AUTH_INSUFFICIENT_PERMISSIONS', $response->json('errors.0.code'));
        $this->assertSame(0, DB::table('cookie_consents')->where('user_id', $member->id)->count());
    }

    public function test_optional_auth_read_still_accepts_an_impersonation_token(): void
    {
        [$token] = $this->impersonationToken();

        $this->apiGet('/cookie-consent', ['Authorization' => 'Bearer ' . $token])
            ->assertStatus(200);
    }

    public function test_optional_auth_write_still_accepts_an_ordinary_token(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $token = $this->tokens()->generateToken((int) $member->id, $this->testTenantId);

        $this->apiPost('/cookie-consent', ['analytics' => true], ['Authorization' => 'Bearer ' . $token])
            ->assertStatus(200);
    }

    public function test_restore_session_refuses_an_impersonation_token(): void
    {
        [$token] = $this->impersonationToken();

        $previous = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        try {
            $response = $this->apiPost('/auth/restore-session', [], ['Authorization' => 'Bearer ' . $token]);
        } finally {
            if ($previous === null) {
                unset($_SERVER['HTTP_AUTHORIZATION']);
            } else {
                $_SERVER['HTTP_AUTHORIZATION'] = $previous;
            }
        }

        $response->assertStatus(403);
        $this->assertArrayNotHasKey('session_id', (array) $response->json());
        $this->assertEmpty($_SESSION['user_id'] ?? null, 'no legacy session may be created');
    }
}
