<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Core\TotpEncryption;
use App\Core\Csrf;
use App\Models\User;
use App\Services\AuthenticationConfigurationService;
use App\Services\TenantFeatureConfig;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorChallengeManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

/**
 * Feature tests for TotpController — TOTP two-factor verification + status.
 *
 * Routes under test (routes/api.php):
 *   POST /api/totp/verify   — PUBLIC pre-login endpoint (throttle:nexus-route-5-per-1m).
 *                             Verifies a TOTP/backup code against either a
 *                             stateless two_factor_token (cache-backed) or a
 *                             session+CSRF flow, then completes login.
 *   GET  /api/totp/status   — auth:sanctum; reports 2FA enabled/setup state.
 *
 * The happy-path verify is deterministic: we generate a real TOTP secret,
 * persist it encrypted exactly as the app does, mint a challenge token via the
 * same TwoFactorChallengeManager the controller reads, and compute the current
 * code with OTPHP. TotpService::verifyCode() verifies with window=1 (±1 period
 * ≈ ±30s), so the in-process round-trip cannot fall outside the accepted window
 * — no time-boundary flakiness.
 */
class TotpControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // POST /totp/verify is rate-limited two ways for anonymous callers, both
        // keyed by IP and backed by the array cache that is shared across every
        // test in this PHP process:
        //   - the route middleware throttle:nexus-route-5-per-1m
        //   - the controller's internal rateLimit('totp_verify', 5, 300)
        // Flushing the cache between tests guarantees each verify test starts
        // with a clean rate-limit bucket (and no leftover challenge tokens), so
        // the order/number of verify assertions can never trip a 429.
        Cache::flush();
    }

    protected function tearDown(): void
    {
        unset(
            $_SESSION['pending_2fa_user_id'],
            $_SESSION['pending_2fa_tenant_id'],
            $_SESSION['pending_2fa_started_at'],
            $_SESSION['pending_2fa_challenge_token'],
            $_SESSION['pending_2fa_expires']
        );
        AuthenticationConfigurationService::clearCache($this->testTenantId);
        parent::tearDown();
    }

    /**
     * Create an active, approved user in the test tenant and authenticate the
     * Sanctum guard as them (used for the auth-protected /totp/status route).
     */
    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * Persist a user_totp_settings row with an enabled, encrypted secret —
     * mirroring TotpService::completeSetup(). Returns the plaintext secret so
     * the caller can compute valid codes.
     */
    private function enableTotpForUser(int $userId, ?int $tenantId = null): string
    {
        $tenantId ??= $this->testTenantId;
        $secret = TotpService::generateSecret();

        DB::table('user_totp_settings')->insert([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'totp_secret_encrypted' => TotpEncryption::encrypt($secret),
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);

        return $secret;
    }

    private function disableNewTwoFactorEnrollment(): void
    {
        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['two_factor_authentication'] = false;

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
        ]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------------------------
    //  GET /totp/status — auth:sanctum
    // ------------------------------------------------------------------

    public function test_status_requires_auth(): void
    {
        $response = $this->apiGet('/totp/status');

        $response->assertStatus(401);
    }

    public function test_status_returns_disabled_state_for_user_without_2fa(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/totp/status');

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'enabled' => false,
                'backup_codes_remaining' => 0,
                'trusted_devices' => 0,
            ]);
    }

    public function test_status_reports_enabled_when_2fa_configured(): void
    {
        $user = $this->authenticatedUser();
        $this->enableTotpForUser((int) $user->id);

        $response = $this->apiGet('/totp/status');

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'enabled' => true,
            ]);
    }

    // ------------------------------------------------------------------
    //  POST /totp/verify — PUBLIC pre-login endpoint
    // ------------------------------------------------------------------

    public function test_verify_is_public_not_401_for_anonymous(): void
    {
        // A public pre-login endpoint must not gate on Sanctum auth. The request
        // still fails (no valid challenge token / CSRF), but never with 401 from
        // the auth middleware — the controller produces the rejection instead.
        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => 'definitely-not-a-real-token',
            'code' => '123456',
        ]);

        // Invalid/expired challenge token => AUTH_2FA_TOKEN_EXPIRED (401 from the
        // controller, not from auth:sanctum). The key assertion is that the route
        // is reachable anonymously and the controller — not the auth layer —
        // decides the outcome. Error responses use the {errors:[{code,message}]}
        // envelope from BaseApiController::respondWithError().
        $response->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');
    }

    public function test_verify_rejects_expired_or_unknown_challenge_token(): void
    {
        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => 'token-that-was-never-issued',
            'code' => '123456',
        ]);

        $response->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');
    }

    public function test_verify_requires_a_code_when_token_is_valid(): void
    {
        $user = $this->authenticatedUser();
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);

        // Valid challenge token but no code => VALIDATION_REQUIRED_FIELD (400).
        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => '',
        ]);

        $response->assertStatus(400)
            ->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD');
    }

    public function test_verify_rejects_when_2fa_not_set_up(): void
    {
        // User has a valid challenge token but no user_totp_settings row, so
        // TotpService::verifyLogin() reports "2FA not enabled" => 401.
        $user = $this->authenticatedUser();
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);

        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => '123456',
        ]);

        // verifyLogin() returns success=false ("2FA not enabled") => the
        // controller maps that to AUTH_2FA_INVALID (401).
        $response->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_INVALID');
    }

    public function test_verify_rejects_invalid_code_with_enabled_2fa(): void
    {
        $user = $this->authenticatedUser();
        $this->enableTotpForUser((int) $user->id);
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);

        // A non-numeric code can never match a real 6-digit TOTP, so this is a
        // deterministic invalid-code rejection regardless of the current period.
        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => 'abcdef',
        ]);

        $response->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_INVALID');
    }

    public function test_verify_succeeds_with_valid_code_and_token(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $secret = $this->enableTotpForUser((int) $user->id);
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);

        // Compute the current valid code from the same secret. verifyCode() uses
        // window=1, so the ±1-period tolerance absorbs any sub-second drift
        // between generating the code here and verifying it in the controller.
        $code = TOTP::createFromSecret($secret)->now();

        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => $code,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'token_type' => 'Bearer',
            ])
            ->assertJsonStructure([
                'success',
                'user' => ['id', 'email'],
                'access_token',
                'refresh_token',
            ]);

        // The user_totp_settings row should record the successful verification.
        $this->assertDatabaseHas('user_totp_settings', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'is_enabled' => 1,
        ]);
    }

    public function test_verify_rejects_challenge_started_before_global_session_revocation(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $secret = $this->enableTotpForUser((int) $user->id);
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);

        $this->assertGreaterThanOrEqual(
            1,
            app(TokenService::class)->revokeAllTokensForUser((int) $user->id, 'password_changed')
        );

        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => TOTP::createFromSecret($secret)->now(),
            'trust_device' => true,
        ]);

        $response->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');

        $this->assertDatabaseMissing('refresh_token_sessions', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertDatabaseMissing('user_trusted_devices', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'is_revoked' => 0,
        ]);
    }

    public function test_session_and_stateless_completion_share_one_single_use_challenge(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $secret = $this->enableTotpForUser((int) $user->id);
        $authenticationStartedAt = time();
        $token = app(TwoFactorChallengeManager::class)->create(
            (int) $user->id,
            ['totp', 'backup_code'],
            $this->testTenantId,
            $authenticationStartedAt
        );
        $csrfToken = Csrf::generate();
        $_SESSION['pending_2fa_user_id'] = (int) $user->id;
        $_SESSION['pending_2fa_tenant_id'] = $this->testTenantId;
        $_SESSION['pending_2fa_started_at'] = $authenticationStartedAt;
        $_SESSION['pending_2fa_challenge_token'] = $token;
        $_SESSION['pending_2fa_expires'] = time() + 300;

        $code = TOTP::createFromSecret($secret)->now();
        $this->apiPost('/totp/verify', [
            'csrf_token' => $csrfToken,
            'code' => $code,
        ])->assertOk()->assertJsonPath('success', true);

        $this->assertNull(app(TwoFactorChallengeManager::class)->get($token));
        $this->assertArrayNotHasKey('pending_2fa_challenge_token', $_SESSION);
        $this->assertSame(
            1,
            DB::table('refresh_token_sessions')
                ->where('user_id', $user->id)
                ->where('tenant_id', $this->testTenantId)
                ->count()
        );

        $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => $code,
        ])->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');

        $this->assertSame(
            1,
            DB::table('refresh_token_sessions')
                ->where('user_id', $user->id)
                ->where('tenant_id', $this->testTenantId)
                ->count()
        );
    }

    public function test_verify_uses_tenant_bound_to_challenge_instead_of_request_tenant(): void
    {
        $user = User::factory()->forTenant(999)->create([
            'role' => 'god',
            'is_god' => true,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $secret = $this->enableTotpForUser((int) $user->id, 999);
        $token = app(TwoFactorChallengeManager::class)->create(
            (int) $user->id,
            ['totp', 'backup_code'],
            999
        );

        $this->assertSame($this->testTenantId, TenantContext::getId());

        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => TOTP::createFromSecret($secret)->now(),
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('user.id', (int) $user->id)
            ->assertJsonPath('user.tenant_id', 999)
            ->assertJsonPath('expires_in', 900)
            ->assertJsonPath('sanctum_token', null);

        $accessToken = (string) $response->json('access_token');
        $refreshToken = (string) $response->json('refresh_token');
        $this->assertNotSame('', $accessToken);
        $this->assertNotSame('', $refreshToken);
        $this->assertSame($accessToken, $response->json('token'));

        $tokenService = app(TokenService::class);
        $accessPayload = $tokenService->validateToken($accessToken);
        $refreshPayload = $tokenService->validateRefreshToken($refreshToken);
        $this->assertNotNull($accessPayload);
        $this->assertNotNull($refreshPayload);
        $this->assertSame(999, (int) $accessPayload['tenant_id']);
        $this->assertSame(999, (int) $refreshPayload['tenant_id']);
        $this->assertSame(900, (int) $accessPayload['exp'] - (int) $accessPayload['nbf']);

        $this->assertDatabaseMissing('personal_access_tokens', [
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
        ]);

        $this->assertDatabaseHas('totp_verification_attempts', [
            'user_id' => $user->id,
            'tenant_id' => 999,
            'is_successful' => 1,
        ]);
        $this->assertArrayNotHasKey('user_id', $_SESSION ?? []);
        $this->assertSame($this->testTenantId, TenantContext::getId());
    }

    public function test_existing_two_factor_login_still_verifies_without_issuing_trust_when_both_options_are_disabled(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $secret = $this->enableTotpForUser((int) $user->id);
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);
        $this->disableNewTwoFactorEnrollment();
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
            false,
            $this->testTenantId
        );

        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => TOTP::createFromSecret($secret)->now(),
            'trust_device' => true,
        ]);

        $response->assertOk()->assertJsonPath('success', true);
        $this->assertArrayNotHasKey('trusted_device_token', $response->json());
        $this->assertSame(0, DB::table('user_trusted_devices')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    public function test_browser_trusted_device_uses_httponly_cookie_not_json_token(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $secret = $this->enableTotpForUser((int) $user->id);
        $token = app(TwoFactorChallengeManager::class)->create((int) $user->id);
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
            true,
            $this->testTenantId,
        );

        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $token,
            'code' => TOTP::createFromSecret($secret)->now(),
            'trust_device' => true,
        ]);

        $response->assertOk()->assertJsonMissingPath('trusted_device_token');
        $cookie = collect($response->headers->getCookies())
            ->first(fn ($candidate) => $candidate->getName() === TotpService::trustedDeviceCookieName($this->testTenantId, (int) $user->id));
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
    }
}
