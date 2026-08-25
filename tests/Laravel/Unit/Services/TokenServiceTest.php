<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

class TokenServiceTest extends TestCase
{
    use DatabaseTransactions;

    private TokenService $service;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.key' => 'base64:' . base64_encode(str_repeat('a', 32))]);
        $this->service = new TokenService();
    }

    public function test_generateToken_returns_jwt_format(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $parts = explode('.', $token);
        $this->assertCount(3, $parts);
    }

    public function test_validateToken_returns_payload_for_valid_token(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $payload = $this->service->validateToken($token);

        $this->assertNotNull($payload);
        $this->assertEquals(1, $payload['user_id']);
        $this->assertEquals(2, $payload['tenant_id']);
        $this->assertEquals('access', $payload['type']);
    }

    public function test_validateToken_rejects_refresh_token_when_used_as_bearer_access_token(): void
    {
        $user = $this->makeSessionUser();
        $token = $this->service->generateRefreshToken((int) $user->id, $this->testTenantId, false);

        $this->assertNull($this->service->validateToken($token));
    }

    public function test_validateToken_returns_null_for_invalid_token(): void
    {
        $this->assertNull($this->service->validateToken('invalid.token.here'));
    }

    public function test_validateToken_returns_null_for_malformed_token(): void
    {
        $this->assertNull($this->service->validateToken('not-a-jwt'));
    }

    public function test_getAccessTokenExpiry_returns_web_expiry(): void
    {
        $expiry = $this->service->getAccessTokenExpiry(false);
        $this->assertEquals(900, $expiry);
    }

    public function test_getAccessTokenExpiry_returns_mobile_expiry(): void
    {
        $expiry = $this->service->getAccessTokenExpiry(true);
        $this->assertEquals(900, $expiry);
    }

    public function test_local_certification_can_use_a_seconds_scale_access_token_lifetime(): void
    {
        config(['auth.test_access_token_expiry_seconds' => 5]);

        $this->assertSame(5, $this->service->getAccessTokenExpiry(false));
        $token = $this->service->generateToken(1, 2, [], false);
        $payload = json_decode(base64_decode(strtr(explode('.', $token)[1], '-_', '+/')), true);
        $this->assertSame(5, (int) $payload['exp'] - (int) $payload['nbf']);
    }

    public function test_out_of_range_certification_override_cannot_widen_the_access_token_lifetime(): void
    {
        config(['auth.test_access_token_expiry_seconds' => 86400]);

        $this->assertSame(900, $this->service->getAccessTokenExpiry(false));
    }

    public function test_getRefreshTokenExpiry_returns_web_expiry(): void
    {
        $expiry = $this->service->getRefreshTokenExpiry(false);
        $this->assertEquals(2592000, $expiry);
    }

    public function test_getRefreshTokenExpiry_returns_mobile_expiry(): void
    {
        $expiry = $this->service->getRefreshTokenExpiry(true);
        $this->assertEquals(2592000, $expiry);
    }

    public function test_isExpired_returns_false_for_fresh_token(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $this->assertFalse($this->service->isExpired($token));
    }

    public function test_isExpired_returns_true_for_malformed(): void
    {
        $this->assertTrue($this->service->isExpired('bad-token'));
    }

    public function test_getUserIdFromToken_extracts_user_id(): void
    {
        $token = $this->service->generateToken(42, 2, [], false);

        $this->assertEquals(42, $this->service->getUserIdFromToken($token));
    }

    public function test_getUserIdFromToken_returns_null_for_invalid(): void
    {
        $this->assertNull($this->service->getUserIdFromToken('bad'));
    }

    public function test_getExpiration_returns_timestamp(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $exp = $this->service->getExpiration($token);
        $this->assertIsInt($exp);
        $this->assertGreaterThan(time(), $exp);
    }

    public function test_needsRefresh_returns_false_for_fresh_token(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $this->assertFalse($this->service->needsRefresh($token));
    }

    public function test_generateRefreshToken_has_refresh_type(): void
    {
        $user = $this->makeSessionUser();
        $token = $this->service->generateRefreshToken((int) $user->id, $this->testTenantId, false);

        $payload = $this->service->validateRefreshToken($token);

        $this->assertEquals('refresh', $payload['type']);
        $this->assertNotEmpty($payload['jti']);
        $this->assertSame(2, $payload['refresh_version']);
        $this->assertNotEmpty($payload['family_id']);
    }

    public function test_validateRefreshToken_rejects_access_token(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $this->assertNull($this->service->validateRefreshToken($token));
    }

    public function test_generateImpersonationToken_has_correct_claims(): void
    {
        $token = $this->service->generateImpersonationToken(1, 2, 99);
        $parts = explode('.', $token);
        $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);

        $this->assertEquals('impersonation', $payload['type']);
        $this->assertEquals(99, $payload['impersonated_by']);
        $this->assertEquals(1, $payload['user_id']);
        $this->assertNull($this->service->validateToken($token));
    }

    public function test_getTimeRemaining_returns_positive_for_fresh_token(): void
    {
        $token = $this->service->generateToken(1, 2, [], false);

        $remaining = $this->service->getTimeRemaining($token);
        $this->assertGreaterThan(0, $remaining);
    }

    public function test_getTimeRemaining_returns_negative_one_for_invalid(): void
    {
        $this->assertEquals(-1, $this->service->getTimeRemaining('bad'));
    }

    public function test_global_revocation_invalidates_tokens_issued_in_the_same_second(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $token = $this->service->generateToken(
            (int) $user->id,
            $this->testTenantId,
            [],
            false
        );
        $parts = explode('.', $token);
        $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true, 512, JSON_THROW_ON_ERROR);

        DB::table('revoked_tokens')->insert([
            'user_id' => $user->id,
            'jti' => 'global_revoke_' . $user->id,
            'revoked_at' => date('Y-m-d H:i:s', (int) $payload['iat']),
            'expires_at' => now()->addYear(),
        ]);

        $this->assertNull($this->service->validateToken($token));
    }

    public function test_authentication_start_and_api_session_window_fail_after_global_revocation(): void
    {
        $user = $this->makeSessionUser();
        $userId = (int) $user->id;
        $access = $this->service->generateToken($userId, $this->testTenantId);
        $payload = $this->decodeJwt($access);
        $authenticationStartedAt = time();

        $this->assertTrue(
            $this->service->isAuthenticationStartValid($userId, $authenticationStartedAt)
        );
        $this->assertTrue($this->service->validateApiSessionWindow(
            $userId,
            $this->testTenantId,
            (int) $payload['iat'],
            (int) $payload['exp']
        ));

        $this->assertGreaterThan(0, $this->service->revokeAllTokensForUser($userId));

        $this->assertFalse(
            $this->service->isAuthenticationStartValid($userId, $authenticationStartedAt)
        );
        $this->assertFalse($this->service->validateApiSessionWindow(
            $userId,
            $this->testTenantId,
            (int) $payload['iat'],
            (int) $payload['exp']
        ));
    }

    public function test_tokens_issued_immediately_after_global_revocation_remain_valid(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $userId = (int) $user->id;
        $accessBeforeRevocation = $this->service->generateToken(
            $userId,
            $this->testTenantId,
            [],
            false
        );
        $refreshBeforeRevocation = $this->service->generateRefreshToken(
            $userId,
            $this->testTenantId,
            false
        );

        $this->assertGreaterThan(0, $this->service->revokeAllTokensForUser($userId));

        $accessAfterRevocation = $this->service->generateToken(
            $userId,
            $this->testTenantId,
            [],
            false
        );
        $refreshAfterRevocation = $this->service->generateRefreshToken(
            $userId,
            $this->testTenantId,
            false
        );

        $this->assertNull($this->service->validateToken($accessBeforeRevocation));
        $this->assertNull($this->service->validateRefreshToken($refreshBeforeRevocation));
        $this->assertNotNull($this->service->validateToken($accessAfterRevocation));
        $this->assertNotNull($this->service->validateRefreshToken($refreshAfterRevocation));

        $parts = explode('.', $accessAfterRevocation);
        $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(900, (int) $payload['exp'] - (int) $payload['nbf']);
    }

    public function test_repeated_same_second_global_revocation_advances_the_cutoff(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $userId = (int) $user->id;

        $this->assertGreaterThan(0, $this->service->revokeAllTokensForUser($userId));
        $tokenAfterFirstRevocation = $this->service->generateToken(
            $userId,
            $this->testTenantId,
            [],
            false
        );
        $this->assertNotNull($this->service->validateToken($tokenAfterFirstRevocation));

        $this->assertGreaterThan(0, $this->service->revokeAllTokensForUser($userId));
        $tokenAfterSecondRevocation = $this->service->generateToken(
            $userId,
            $this->testTenantId,
            [],
            false
        );

        $this->assertNull($this->service->validateToken($tokenAfterFirstRevocation));
        $this->assertNotNull($this->service->validateToken($tokenAfterSecondRevocation));
    }

    public function test_platform_spoofing_cannot_extend_token_lifetimes(): void
    {
        $user = $this->makeSessionUser();
        request()->headers->set('X-Nexus-Mobile', '1');

        $mobileClaimedAccess = $this->service->generateToken(
            (int) $user->id,
            $this->testTenantId,
            [],
            true
        );
        $webAccess = $this->service->generateToken(
            (int) $user->id,
            $this->testTenantId,
            [],
            false
        );

        $mobilePayload = $this->decodeJwt($mobileClaimedAccess);
        $webPayload = $this->decodeJwt($webAccess);
        $this->assertSame(900, (int) $mobilePayload['exp'] - (int) $mobilePayload['nbf']);
        $this->assertSame(900, (int) $webPayload['exp'] - (int) $webPayload['nbf']);
        $this->assertSame(
            $this->service->getRefreshTokenExpiry(true),
            $this->service->getRefreshTokenExpiry(false)
        );
    }

    public function test_refresh_state_persists_only_hashed_identifiers(): void
    {
        $user = $this->makeSessionUser();
        $token = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );
        $payload = $this->decodeJwt($token);

        $this->assertDatabaseHas('refresh_token_sessions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'jti_hash' => hash('sha256', (string) $payload['jti']),
            'family_hash' => hash('sha256', (string) $payload['family_id']),
        ]);
        $this->assertDatabaseMissing('refresh_token_sessions', [
            'jti_hash' => $payload['jti'],
        ]);
        $this->assertDatabaseMissing('refresh_token_sessions', [
            'family_hash' => $payload['family_id'],
        ]);
    }

    public function test_immediate_reuse_returns_credential_free_superseded_outcome_and_preserves_successor(): void
    {
        $user = $this->makeSessionUser();
        $token = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );

        $firstRequest = $this->service->rotateRefreshToken($token);
        $this->assertNotNull($firstRequest);
        $successor = $firstRequest['refresh_token'];
        $this->assertNotNull($this->service->validateRefreshToken($successor));

        // A separate service instance observes the already-consumed parent,
        // matching the state a request that lost the row-lock race receives.
        $secondRequest = (new TokenService())->rotateRefreshToken($token);
        $this->assertIsArray($secondRequest);
        $this->assertSame(
            TokenService::REFRESH_ROTATION_OUTCOME_RECENTLY_CONSUMED,
            $secondRequest['outcome'] ?? null
        );
        $this->assertArrayNotHasKey('refresh_token', $secondRequest);
        $this->assertArrayNotHasKey('payload', $secondRequest);
        $this->assertNotNull($this->service->validateRefreshToken($successor));

        $payload = $this->decodeJwt($token);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')
                ->where('family_hash', hash('sha256', (string) $payload['family_id']))
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('revocation_reason', 'reuse_detected')
                ->count()
        );
    }

    public function test_reuse_outside_grace_revokes_its_successor_family(): void
    {
        $user = $this->makeSessionUser();
        $token = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );
        $payload = $this->decodeJwt($token);

        $firstRequest = $this->service->rotateRefreshToken($token);
        $this->assertNotNull($firstRequest);
        $successor = $firstRequest['refresh_token'];

        DB::table('refresh_token_sessions')
            ->where('jti_hash', hash('sha256', (string) $payload['jti']))
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->update(['consumed_at' => now()->subSeconds(6)]);

        $this->assertNull((new TokenService())->rotateRefreshToken($token));
        $this->assertNull($this->service->validateRefreshToken($successor));
        $this->assertSame(
            2,
            DB::table('refresh_token_sessions')
                ->where('family_hash', hash('sha256', (string) $payload['family_id']))
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('revocation_reason', 'reuse_detected')
                ->count()
        );
    }

    public function test_reuse_with_consumed_direct_successor_revokes_the_family(): void
    {
        $user = $this->makeSessionUser();
        $root = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );
        $rootPayload = $this->decodeJwt($root);

        $firstRotation = $this->service->rotateRefreshToken($root);
        $this->assertNotNull($firstRotation);
        $secondRotation = $this->service->rotateRefreshToken($firstRotation['refresh_token']);
        $this->assertNotNull($secondRotation);

        $this->assertNull((new TokenService())->rotateRefreshToken($root));
        $this->assertNull(
            $this->service->validateRefreshToken($secondRotation['refresh_token'])
        );
        $this->assertSame(
            3,
            DB::table('refresh_token_sessions')
                ->where('family_hash', hash('sha256', (string) $rootPayload['family_id']))
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('revocation_reason', 'reuse_detected')
                ->count()
        );
    }

    public function test_revoked_family_cannot_receive_the_concurrency_grace(): void
    {
        $user = $this->makeSessionUser();
        $root = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );
        $rotation = $this->service->rotateRefreshToken($root);
        $this->assertNotNull($rotation);
        $this->assertTrue(
            $this->service->revokeToken($rotation['refresh_token'], (int) $user->id)
        );

        $this->assertNull((new TokenService())->rotateRefreshToken($root));
        $this->assertSame(
            2,
            DB::table('refresh_token_sessions')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('revocation_reason', 'user_logout')
                ->count()
        );
    }

    public function test_database_expiry_fails_closed_before_rotation(): void
    {
        $user = $this->makeSessionUser();
        $token = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );
        $payload = $this->decodeJwt($token);

        DB::table('refresh_token_sessions')
            ->where('jti_hash', hash('sha256', (string) $payload['jti']))
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->update(['expires_at' => now()->subSecond()]);

        $this->assertNull($this->service->validateRefreshToken($token));
        $this->assertNull($this->service->rotateRefreshToken($token));
        $this->assertDatabaseHas('refresh_token_sessions', [
            'jti_hash' => hash('sha256', (string) $payload['jti']),
            'revocation_reason' => 'expired',
        ]);
    }

    public function test_logout_all_revokes_refresh_access_and_sanctum_sessions(): void
    {
        $user = $this->makeSessionUser();
        $access = $this->service->generateToken(
            (int) $user->id,
            $this->testTenantId
        );
        $refresh = $this->service->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );
        $user->createToken('refresh-containment-test');
        DB::table('user_trusted_devices')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'device_token_hash' => hash('sha256', 'logout-all-trusted-device'),
            'device_name' => 'Logout all regression device',
            'ip_address' => '127.0.0.1',
            'expires_at' => now()->addMonth(),
            'is_revoked' => 0,
        ]);
        $this->assertGreaterThan(0, $user->tokens()->count());

        $this->assertGreaterThan(0, $this->service->revokeAllTokensForUser((int) $user->id));

        $this->assertNull($this->service->validateToken($access));
        $this->assertNull($this->service->validateRefreshToken($refresh));
        $this->assertSame(0, $user->tokens()->count());
        $this->assertDatabaseHas('refresh_token_sessions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'revocation_reason' => 'logout_all',
        ]);
        $this->assertDatabaseHas('user_trusted_devices', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'is_revoked' => 1,
            'revoked_reason' => 'logout_all',
        ]);
    }

    public function test_pre_rotation_legacy_refresh_tokens_are_invalidated(): void
    {
        $user = $this->makeSessionUser();
        $createToken = new \ReflectionMethod(TokenService::class, 'createToken');
        $createToken->setAccessible(true);
        $legacy = (string) $createToken->invoke($this->service, [
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'type' => 'refresh',
            'jti' => bin2hex(random_bytes(16)),
        ], 63072000);

        $this->assertNull($this->service->validateRefreshToken($legacy));
        $this->assertNull($this->service->inspectRefreshTokenForRotation($legacy));
        $this->assertNull($this->service->rotateRefreshToken($legacy));
    }

    public function test_legacy_and_overlong_access_tokens_are_invalidated(): void
    {
        $user = $this->makeSessionUser();
        $createToken = new \ReflectionMethod(TokenService::class, 'createToken');
        $createToken->setAccessible(true);

        $legacy = (string) $createToken->invoke($this->service, [
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'type' => 'access',
            'platform' => 'mobile',
        ], 2592000);
        $overlongCurrentVersion = (string) $createToken->invoke($this->service, [
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'type' => 'access',
            'access_version' => 2,
            'platform' => 'mobile',
        ], 2592000);

        $this->assertNull($this->service->validateToken($legacy));
        $this->assertNull($this->service->validateToken($overlongCurrentVersion));
    }

    private function makeSessionUser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function decodeJwt(string $token): array
    {
        $parts = explode('.', $token);

        return json_decode(
            base64_decode(strtr($parts[1], '-_', '+/')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
    }
}
