<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Core\TotpEncryption;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

/**
 * Shared fixture for the two-factor security review (register engagement E-004).
 *
 * Every test here is adversarial: it pins a property the MFA design promises
 * (see .local-docs-archive/security-audit-2fa-2026-09-12/PLAN.md, Section B)
 * so a later change that weakens it fails loudly.
 */
abstract class TwoFactorAuditTestCase extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // Members are optional-MFA unless a test says otherwise. CI's seeded tenant
        // may carry the opposite setting, which turned two member-bearer tests into
        // 401 AUTH_MFA_REQUIRED there while they passed locally.
        \App\Services\AuthenticationConfigurationService::set(
            \App\Services\AuthenticationConfigurationService::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS,
            false,
            $this->testTenantId
        );
    }

    protected function member(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
            'password_hash' => Hash::make('test-password'),
        ], $attributes));
    }

    /** @return array<string,string> */
    protected function bearer(User $user, bool $mfa = false, array $extra = []): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            array_merge($mfa ? TwoFactorPolicy::claims('totp') : [], $extra)
        )];
    }

    /** Enrol a real secret so the test can mint valid codes with OTPHP. */
    protected function enrol(User $user): string
    {
        $secret = TotpService::generateSecret();
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => $user->tenant_id,
            'totp_secret_encrypted' => TotpEncryption::encrypt($secret),
            'is_enabled' => 1,
            'is_pending_setup' => 0,
            'setup_revocation_version' => 0,
        ]);
        DB::table('users')->where('id', $user->id)->where('tenant_id', $user->tenant_id)
            ->update(['totp_enabled' => 1, 'totp_setup_required' => 0]);

        return $secret;
    }

    /** The test tenant ships with optional enrolment switched off; turn it on for member flows. */
    protected function allowEnrollment(): void
    {
        $features = \App\Services\TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['two_factor_authentication'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        \App\Core\TenantContext::reset();
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    /** Force a live challenge past its deadline without waiting (PHP time() ignores Carbon travel). */
    protected function expireChallenge(string $token): void
    {
        $key = '2fa_challenge:' . $token;
        $data = Cache::get($key);
        $this->assertIsArray($data, 'challenge should exist before being expired');
        $data['expires_at'] = time() - 1;
        Cache::put($key, $data, 60);
    }

    protected function code(string $secret, int $offsetSteps = 0): string
    {
        $totp = TOTP::createFromSecret($secret);

        return $totp->at(time() + $offsetSteps * $totp->getPeriod());
    }

    /** Password step of login; returns the opaque challenge token. */
    protected function challenge(User $user, array $headers = []): string
    {
        $login = $this->apiPost('/auth/login', ['email' => $user->email, 'password' => 'test-password'], $headers);
        $login->assertOk();
        $token = $login->json('two_factor_token');
        $this->assertIsString($token, 'login should have answered with a two-factor challenge');

        return $token;
    }
}
