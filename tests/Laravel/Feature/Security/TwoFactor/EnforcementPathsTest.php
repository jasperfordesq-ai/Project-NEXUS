<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Services\AuthenticationConfigurationService as Settings;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;

/** P8 — enforcement holds on refresh, on forged claims and on delegated sessions. */
class EnforcementPathsTest extends TwoFactorAuditTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, false, $this->testTenantId);
    }

    public function test_refresh_rotation_refuses_when_policy_flips_to_required_mid_session(): void
    {
        $member = $this->member();
        $login = $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'])->assertOk();
        $refresh = $login->json('refresh_token');
        $this->assertIsString($refresh);

        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $this->apiPost('/auth/refresh-token', ['refresh_token' => $refresh])->assertStatus(401);
    }

    public function test_access_token_minted_from_refresh_carries_the_original_mfa_claims_unchanged(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $session = $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $this->code($secret)])->assertOk();

        $issued = $this->apiPost('/auth/refresh-token', ['refresh_token' => $session->json('refresh_token')])->assertOk();
        $claims = app(TokenService::class)->validateToken((string) $issued->json('access_token'));
        $this->assertIsArray($claims);
        $this->assertSame('totp', $claims['mfa_method']);
        $this->assertLessThanOrEqual(time(), $claims['mfa_verified_at']);
    }

    public function test_forged_mfa_claims_in_an_unsigned_token_are_refused(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $parts = explode('.', app(TokenService::class)->generateToken($admin->id, $admin->tenant_id, []));
        $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true) + TwoFactorPolicy::claims('totp');
        $parts[1] = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');

        $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . implode('.', $parts)])->assertStatus(401);
        // Control: the untampered token is refused for a different reason (no MFA), proving the account is otherwise valid.
        $this->apiGet('/v2/users/me', $this->bearer($admin, true))->assertOk();
    }

    public function test_impersonation_of_a_required_account_needs_actor_mfa_and_stays_read_only(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $this->enrol($admin);
        $target = $this->member();
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $tokens = app(TokenService::class);

        $weak = $tokens->validateToken(substr($this->bearer($admin)['Authorization'], 7));
        try {
            $tokens->generateImpersonationToken($target->id, $target->tenant_id, $admin->id, $weak);
            $this->fail('an actor without verified MFA must not mint an impersonation proof');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('MFA', $e->getMessage());
        }

        $strong = $tokens->validateToken(substr($this->bearer($admin, true)['Authorization'], 7));
        $proof = $tokens->generateImpersonationToken($target->id, $target->tenant_id, $admin->id, $strong);
        $exchange = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])->assertOk();
        $delegated = ['Authorization' => 'Bearer ' . $exchange->json('access_token')];

        $this->apiGet('/v2/users/me', $delegated)->assertOk();
        $this->apiPost('/v2/listings', ['title' => 'Delegated write', 'description' => 'must be refused', 'type' => 'offer'], $delegated)
            ->assertStatus(403)->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');
        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'test-password'], $delegated)->assertStatus(403);
        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => '123456'], $delegated)->assertStatus(403);

        sleep(1);
        $tokens->revokeAllTokensForUser($admin->id, 'audit_test');
        $this->apiGet('/v2/users/me', $delegated)->assertStatus(401);
    }

    public function test_totp_verify_without_a_challenge_token_is_refused(): void
    {
        // The legacy PHP-session completion path answers 403 (CSRF) with no session; either way, no credential.
        foreach ([['code' => '000000'], ['code' => '000000', 'csrf_token' => 'nope']] as $body) {
            $response = $this->apiPost('/totp/verify', $body);
            $this->assertContains($response->status(), [401, 403]);
            $this->assertNull($response->json('access_token'));
        }
    }
}
