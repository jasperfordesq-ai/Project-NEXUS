<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AuthenticationConfigurationService;
use App\Services\TenantFeatureConfig;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\WebAuthnCeremonyVerifier;
use App\Services\WebAuthnChallengeStore;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Security-focused feature tests for WebAuthnController.
 *
 * Authentication ceremonies are public, while registration and credential
 * management require an authenticated user plus recent factor confirmation.
 */
class WebAuthnControllerTest extends TestCase
{
    use DatabaseTransactions;

    private string $challengeDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->challengeDirectory = sys_get_temp_dir()
            . DIRECTORY_SEPARATOR
            . 'nexus-webauthn-controller-'
            . bin2hex(random_bytes(8));

        config([
            'webauthn.authentication_enabled' => true,
            'webauthn.rp_id' => 'localhost',
            'webauthn.allowed_origins' => [],
            'webauthn.challenge_store.driver' => 'file',
            'webauthn.challenge_store.file_path' => $this->challengeDirectory,
        ]);

        $this->setBiometricLoginEnabled(true);
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED,
            true,
            $this->testTenantId
        );
    }

    protected function tearDown(): void
    {
        if (isset($this->challengeDirectory)) {
            $this->app->make('files')->deleteDirectory($this->challengeDirectory);
        }

        parent::tearDown();
    }

    /** @param array<string, mixed> $attributes */
    private function eligibleUser(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'verification_status' => 'none',
            'is_approved' => true,
            'email_verified_at' => now(),
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function authenticatedUser(array $attributes = []): User
    {
        $user = $this->eligibleUser($attributes);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function securityConfirmationToken(User $user): string
    {
        return $this->app->make(TokenService::class)->generateSecurityConfirmationToken(
            (int) $user->id,
            $this->testTenantId,
            'test_existing_factor'
        );
    }

    private function setBiometricLoginEnabled(bool $enabled): void
    {
        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['biometric_login'] = $enabled;

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    /**
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function credentialFor(User $user, array $overrides = []): array
    {
        $rawCredentialId = random_bytes(32);
        $rawUserHandle = random_bytes(32);
        $row = array_merge([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $this->base64UrlEncode($rawCredentialId),
            'public_key' => 'test-public-key',
            'sign_count' => 1,
            'transports' => json_encode(['internal'], JSON_THROW_ON_ERROR),
            'device_name' => 'Test passkey',
            'authenticator_type' => 'platform',
            'attestation_type' => 'none',
            'rp_id' => 'localhost',
            'registration_origin' => 'http://localhost',
            'user_handle' => $this->base64UrlEncode($rawUserHandle),
            'aaguid' => null,
            'backup_eligible' => 0,
            'backup_state' => 0,
            'user_verified' => 1,
            'credential_discoverable' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        DB::table('webauthn_credentials')->insert($row);

        return array_merge($row, [
            'raw_credential_id' => $rawCredentialId,
            'raw_user_handle' => $rawUserHandle,
        ]);
    }

    /**
     * @param array<string, mixed> $credential
     * @return array<string, mixed>
     */
    private function assertionPayload(
        array $credential,
        string $challenge,
        string $challengeId,
        string $origin = 'http://localhost',
        ?string $userHandle = null,
        int $flags = 0x05
    ): array {
        $clientData = json_encode([
            'type' => 'webauthn.get',
            'challenge' => $challenge,
            'origin' => $origin,
            'crossOrigin' => false,
        ], JSON_THROW_ON_ERROR);
        $authenticatorData = str_repeat("\0", 32) . chr($flags) . pack('N', 1);

        $response = [
            'clientDataJSON' => $this->base64UrlEncode($clientData),
            'authenticatorData' => $this->base64UrlEncode($authenticatorData),
            'signature' => $this->base64UrlEncode('test-signature'),
        ];
        if ($userHandle !== null) {
            $response['userHandle'] = $userHandle;
        }

        return [
            'id' => $credential['credential_id'],
            'rawId' => $credential['credential_id'],
            'type' => 'public-key',
            'challenge_id' => $challengeId,
            'response' => $response,
        ];
    }

    /** @return array{challenge: string, challenge_id: string, rpId: string} */
    private function issueAuthenticationChallenge(
        array $input = [],
        string $origin = 'http://localhost'
    ): array {
        $response = $this->apiPost(
            '/webauthn/auth-challenge',
            $input,
            ['Origin' => $origin]
        );

        $response->assertOk();

        return [
            'challenge' => (string) $response->json('data.challenge'),
            'challenge_id' => (string) $response->json('data.challenge_id'),
            'rpId' => (string) $response->json('data.rpId'),
        ];
    }

    /** @return array{challenge: string, challenge_id: string, rp_id: string, confirmation: string} */
    private function issueRegistrationChallenge(User $user, string $origin = 'http://localhost'): array
    {
        $confirmation = $this->securityConfirmationToken($user);
        $response = $this->apiPost('/webauthn/register-challenge', [
            'security_confirmation_token' => $confirmation,
        ], ['Origin' => $origin]);

        $response->assertOk();

        return [
            'challenge' => (string) $response->json('data.challenge'),
            'challenge_id' => (string) $response->json('data.challenge_id'),
            'rp_id' => (string) $response->json('data.rp.id'),
            'confirmation' => $confirmation,
        ];
    }

    /** @return array<string, mixed> */
    private function registrationPayload(array $challenge, string $rawCredentialId): array
    {
        $clientData = json_encode([
            'type' => 'webauthn.create',
            'challenge' => $challenge['challenge'],
            'origin' => 'http://localhost',
            'crossOrigin' => false,
        ], JSON_THROW_ON_ERROR);
        $credentialId = $this->base64UrlEncode($rawCredentialId);

        return [
            'id' => $credentialId,
            'rawId' => $credentialId,
            'type' => 'public-key',
            'challenge_id' => $challenge['challenge_id'],
            'security_confirmation_token' => $challenge['confirmation'],
            'device_name' => 'Test device',
            'authenticatorAttachment' => 'platform',
            'response' => [
                'clientDataJSON' => $this->base64UrlEncode($clientData),
                'attestationObject' => $this->base64UrlEncode('test-attestation-object'),
                'transports' => ['internal'],
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function verifiedRegistration(string $rawCredentialId, array $overrides = []): array
    {
        return array_merge([
            'credential_id' => $rawCredentialId,
            'public_key' => 'registered-public-key',
            'sign_count' => 0,
            'attestation_format' => 'none',
            'aaguid' => null,
            'user_verified' => true,
            'backup_eligible' => false,
            'backup_state' => false,
        ], $overrides);
    }

    private function verifierMock(): MockInterface
    {
        $verifier = Mockery::mock(WebAuthnCeremonyVerifier::class);
        $this->app->instance(WebAuthnCeremonyVerifier::class, $verifier);

        return $verifier;
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    // ------------------------------------------------------------------
    // Public challenges, feature gates, and ceremony policy
    // ------------------------------------------------------------------

    public function test_auth_challenge_is_public_and_returns_passkey_options(): void
    {
        $this->apiPost('/webauthn/auth-challenge', [], ['Origin' => 'http://localhost'])
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonStructure([
                'data' => [
                    'challenge',
                    'challenge_id',
                    'rpId',
                    'timeout',
                    'userVerification',
                ],
            ])
            ->assertJsonPath('data.userVerification', 'required');
    }

    public function test_signed_out_email_challenge_remains_discoverable_and_account_agnostic(): void
    {
        $user = $this->eligibleUser();
        $this->credentialFor($user);

        $response = $this->apiPost('/webauthn/auth-challenge', [
            'email' => $user->email,
        ], ['Origin' => 'http://localhost']);

        $response
            ->assertOk()
            ->assertJsonMissingPath('data.allowCredentials');
        $stored = $this->app->make(WebAuthnChallengeStore::class)->get(
            (string) $response->json('data.challenge_id')
        );
        $this->assertNotNull($stored);
        $this->assertNull($stored['user_id']);
        $this->assertFalse($stored['metadata']['account_bound']);
        $this->assertTrue($stored['metadata']['discoverable']);
        $this->assertSame([], $stored['metadata']['allowed_credential_ids']);
        $this->assertIsInt($stored['metadata']['authentication_started_at']);
        $this->assertLessThanOrEqual(
            (int) $stored['created_at'],
            $stored['metadata']['authentication_started_at']
        );
    }

    public function test_challenges_require_uv_and_registration_requires_a_resident_key(): void
    {
        $this->apiPost('/webauthn/auth-challenge', [], ['Origin' => 'http://localhost'])
            ->assertOk()
            ->assertJsonPath('data.userVerification', 'required');

        $user = $this->authenticatedUser();
        $this->apiPost('/webauthn/register-challenge', [
            'security_confirmation_token' => $this->securityConfirmationToken($user),
        ], ['Origin' => 'http://localhost'])
            ->assertOk()
            ->assertJsonPath('data.authenticatorSelection.userVerification', 'required')
            ->assertJsonPath('data.authenticatorSelection.residentKey', 'required')
            ->assertJsonPath('data.authenticatorSelection.requireResidentKey', true);
    }

    public function test_full_biometric_feature_switch_blocks_both_public_authentication_endpoints(): void
    {
        $this->setBiometricLoginEnabled(false);

        $this->apiPost('/webauthn/auth-challenge', [], ['Origin' => 'http://localhost'])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->apiPost('/webauthn/auth-verify', [])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_platform_emergency_switch_blocks_both_public_authentication_endpoints(): void
    {
        config(['webauthn.authentication_enabled' => false]);

        $this->apiPost('/webauthn/auth-challenge', [], ['Origin' => 'http://localhost'])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->apiPost('/webauthn/auth-verify', [])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_auth_verify_is_public_but_rejects_an_empty_assertion(): void
    {
        $this->apiPost('/webauthn/auth-verify', [])
            ->assertStatus(400)
            ->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD');
    }

    public function test_auth_challenge_rejects_an_unrecognised_origin_even_under_the_platform_rp_id(): void
    {
        config(['webauthn.rp_id' => 'project-nexus.ie']);

        $this->apiPost(
            '/webauthn/auth-challenge',
            [],
            ['Origin' => 'https://evil.project-nexus.ie']
        )
            ->assertStatus(400)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED');
    }

    public function test_challenge_is_bound_to_the_exact_allowed_origin(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'members.example.test',
            'accessible_domain' => 'accessible.example.test',
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $verifier = $this->verifierMock();
        $verifier->shouldNotReceive('verifyAuthentication');

        $challenge = $this->issueAuthenticationChallenge(
            [],
            'https://members.example.test'
        );
        $fakeCredential = ['credential_id' => $this->base64UrlEncode(random_bytes(32))];
        $payload = $this->assertionPayload(
            $fakeCredential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'https://accessible.example.test',
            $this->base64UrlEncode(random_bytes(32))
        );

        $this->apiPost(
            '/webauthn/auth-verify',
            $payload,
            ['Origin' => 'https://accessible.example.test']
        )
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED');
    }

    // ------------------------------------------------------------------
    // RP ID derivation for tenant and platform origins
    // ------------------------------------------------------------------

    public function test_auth_challenge_uses_tenant_custom_domain_as_rp_id(): void
    {
        config(['webauthn.rp_id' => 'project-nexus.ie']);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'hour-timebank.ie',
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->apiPost(
            '/webauthn/auth-challenge',
            [],
            ['Origin' => 'https://hour-timebank.ie']
        );

        $response->assertOk();
        $this->assertSame('hour-timebank.ie', $response->json('data.rpId'));
    }

    public function test_auth_challenge_uses_multi_label_custom_domain_as_rp_id(): void
    {
        config(['webauthn.rp_id' => 'project-nexus.ie']);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'uk.timebank.global',
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->apiPost(
            '/webauthn/auth-challenge',
            [],
            ['Origin' => 'https://uk.timebank.global']
        );

        $response->assertOk();
        $this->assertSame('uk.timebank.global', $response->json('data.rpId'));
    }

    public function test_auth_challenge_sub_tenant_inherits_parent_domain_rp_id(): void
    {
        config(['webauthn.rp_id' => 'project-nexus.ie']);
        DB::table('tenants')->where('id', 999)->update([
            'domain' => 'uk.timebank.global',
        ]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => null,
            'parent_id' => 999,
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->apiPost(
            '/webauthn/auth-challenge',
            [],
            ['Origin' => 'https://uk.timebank.global']
        );

        $response->assertOk();
        $this->assertSame('uk.timebank.global', $response->json('data.rpId'));
    }

    public function test_auth_challenge_uses_platform_rp_id_on_an_exact_platform_origin(): void
    {
        config([
            'webauthn.rp_id' => 'project-nexus.ie',
            'webauthn.allowed_origins' => ['https://app.project-nexus.ie'],
        ]);

        $response = $this->apiPost(
            '/webauthn/auth-challenge',
            [],
            ['Origin' => 'https://app.project-nexus.ie']
        );

        $response->assertOk();
        $this->assertSame('project-nexus.ie', $response->json('data.rpId'));
    }

    public function test_loopback_origins_are_rejected_outside_local_and_test_environments(): void
    {
        $originalEnvironment = $this->app->environment();
        $this->app->instance('env', 'production');

        try {
            $this->apiPost('/webauthn/auth-challenge', [], ['Origin' => 'http://localhost'])
                ->assertStatus(400)
                ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED');
        } finally {
            $this->app->instance('env', $originalEnvironment);
        }
    }

    public function test_register_challenge_uses_tenant_custom_domain_as_rp_id(): void
    {
        config(['webauthn.rp_id' => 'project-nexus.ie']);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'hour-timebank.ie',
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $user = $this->authenticatedUser();

        $this->apiPost('/webauthn/register-challenge', [
            'security_confirmation_token' => $this->securityConfirmationToken($user),
        ], ['Origin' => 'https://hour-timebank.ie'])
            ->assertOk()
            ->assertJsonPath('data.rp.id', 'hour-timebank.ie');
    }

    // ------------------------------------------------------------------
    // Registration authentication, confirmation, and payload validation
    // ------------------------------------------------------------------

    public function test_register_challenge_requires_auth(): void
    {
        $this->apiPost('/webauthn/register-challenge')
            ->assertUnauthorized();
    }

    public function test_registration_endpoints_are_blocked_when_biometric_authentication_is_disabled(): void
    {
        $user = $this->authenticatedUser();
        $confirmation = $this->securityConfirmationToken($user);
        $this->setBiometricLoginEnabled(false);

        $this->apiPost('/webauthn/register-challenge', [
            'security_confirmation_token' => $confirmation,
        ])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->apiPost('/webauthn/register-verify', [
            'security_confirmation_token' => $confirmation,
        ])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_register_verify_requires_auth(): void
    {
        $this->apiPost('/webauthn/register-verify', [])
            ->assertUnauthorized();
    }

    public function test_register_verify_rejects_malformed_payload_after_valid_confirmation(): void
    {
        $user = $this->authenticatedUser();
        $verifier = $this->verifierMock();
        $verifier->shouldNotReceive('verifyRegistration');

        $this->apiPost('/webauthn/register-verify', [
            'security_confirmation_token' => $this->securityConfirmationToken($user),
            'challenge_id' => str_repeat('a', 64),
            'id' => 'not+base64url',
            'rawId' => 'not+base64url',
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => 'bad+alphabet',
                'attestationObject' => 'bad+alphabet',
            ],
        ])
            ->assertStatus(400)
            ->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD');
    }

    public function test_successful_registration_persists_hardened_credential_metadata(): void
    {
        $user = $this->authenticatedUser();
        $challenge = $this->issueRegistrationChallenge($user);
        $rawCredentialId = random_bytes(32);
        $payload = $this->registrationPayload($challenge, $rawCredentialId);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyRegistration')
            ->once()
            ->andReturn($this->verifiedRegistration($rawCredentialId));

        $this->apiPost('/webauthn/register-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertOk()
            ->assertJsonStructure(['data' => ['message']]);

        $this->assertDatabaseHas('webauthn_credentials', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $this->base64UrlEncode($rawCredentialId),
            'rp_id' => 'localhost',
            'registration_origin' => 'http://localhost',
            'user_verified' => 1,
            'backup_eligible' => 0,
            'backup_state' => 0,
        ]);
    }

    public function test_registration_revalidates_confirmation_after_revocation_during_ceremony(): void
    {
        $user = $this->authenticatedUser();
        $challenge = $this->issueRegistrationChallenge($user);
        $rawCredentialId = random_bytes(32);
        $tokenService = $this->app->make(TokenService::class);
        $revokedSessions = 0;
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyRegistration')
            ->once()
            ->andReturnUsing(function () use (
                $tokenService,
                $user,
                $rawCredentialId,
                &$revokedSessions
            ): array {
                // Deterministically exercise the race window after the request's
                // first confirmation check but before its persistence lock.
                $revokedSessions = $tokenService->revokeAllTokensForUser(
                    (int) $user->id,
                    'password_change'
                );

                return $this->verifiedRegistration($rawCredentialId);
            });

        $this->apiPost(
            '/webauthn/register-verify',
            $this->registrationPayload($challenge, $rawCredentialId),
            ['Origin' => 'http://localhost']
        )
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED');

        $this->assertGreaterThan(0, $revokedSessions);
        $this->assertDatabaseMissing('webauthn_credentials', [
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $this->base64UrlEncode($rawCredentialId),
        ]);
    }

    public function test_registration_rejects_a_challenge_after_tenant_routing_changes(): void
    {
        $user = $this->authenticatedUser();
        $challenge = $this->issueRegistrationChallenge($user);
        $rawCredentialId = random_bytes(32);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyRegistration')
            ->once()
            ->andReturn($this->verifiedRegistration($rawCredentialId));

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'parent_id' => 999,
            'updated_at' => now()->addSecond(),
        ]);

        $this->apiPost(
            '/webauthn/register-verify',
            $this->registrationPayload($challenge, $rawCredentialId),
            ['Origin' => 'http://localhost']
        )
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');

        $this->assertDatabaseMissing('webauthn_credentials', [
            'credential_id' => $this->base64UrlEncode($rawCredentialId),
        ]);
    }

    public function test_registration_rechecks_credential_limit_inside_the_persistence_transaction(): void
    {
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS,
            1,
            $this->testTenantId
        );
        $user = $this->authenticatedUser();
        $challenge = $this->issueRegistrationChallenge($user);

        // Simulate a second ceremony completing after this challenge was issued.
        $this->credentialFor($user);
        $rawCredentialId = random_bytes(32);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyRegistration')
            ->once()
            ->andReturn($this->verifiedRegistration($rawCredentialId));

        $this->apiPost(
            '/webauthn/register-verify',
            $this->registrationPayload($challenge, $rawCredentialId),
            ['Origin' => 'http://localhost']
        )
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'WEBAUTHN_CREDENTIAL_LIMIT');

        $this->assertSame(1, DB::table('webauthn_credentials')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    public function test_registration_rejects_backup_state_without_backup_eligibility(): void
    {
        $user = $this->authenticatedUser();
        $challenge = $this->issueRegistrationChallenge($user);
        $rawCredentialId = random_bytes(32);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyRegistration')
            ->once()
            ->andReturn($this->verifiedRegistration($rawCredentialId, [
                'backup_eligible' => false,
                'backup_state' => true,
            ]));

        $this->apiPost(
            '/webauthn/register-verify',
            $this->registrationPayload($challenge, $rawCredentialId),
            ['Origin' => 'http://localhost']
        )
            ->assertStatus(400)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');

        $this->assertDatabaseMissing('webauthn_credentials', [
            'credential_id' => $this->base64UrlEncode($rawCredentialId),
        ]);
    }

    public function test_auth_verify_rejects_malformed_assertion_payloads_before_verification(): void
    {
        $verifier = $this->verifierMock();
        $verifier->shouldNotReceive('verifyAuthentication');

        $credentialId = $this->base64UrlEncode('credential');
        $valid = [
            'id' => $credentialId,
            'rawId' => $credentialId,
            'type' => 'public-key',
            'challenge_id' => str_repeat('a', 64),
            'response' => [
                'clientDataJSON' => $this->base64UrlEncode('{}'),
                'authenticatorData' => $this->base64UrlEncode(str_repeat("\0", 37)),
                'signature' => $this->base64UrlEncode('signature'),
            ],
        ];

        $cases = [
            array_replace($valid, ['id' => 'bad+alphabet']),
            array_replace($valid, ['rawId' => $this->base64UrlEncode('different')]),
            array_replace($valid, ['type' => 'not-public-key']),
            array_replace_recursive($valid, [
                'response' => ['authenticatorData' => $this->base64UrlEncode('short')],
            ]),
            array_replace($valid, ['response' => 'not-an-array']),
        ];

        foreach ($cases as $payload) {
            $this->apiPost('/webauthn/auth-verify', $payload)
                ->assertStatus(400)
                ->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD');
        }
    }

    // ------------------------------------------------------------------
    // Assertion binding, account gates, replay, and successful update
    // ------------------------------------------------------------------

    public function test_successful_assertion_updates_credential_and_replay_fails(): void
    {
        $user = $this->eligibleUser();
        $credential = $this->credentialFor($user, [
            'backup_eligible' => 1,
            'registration_origin' => 'http://localhost:5173',
        ]);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')
            ->once()
            ->withArgs(static function (
                string $rpName,
                string $rpId,
                string $clientDataJson,
                string $authenticatorData,
                string $signature,
                string $publicKey,
                string $challenge,
                int $previousSignCount
            ): bool {
                return $rpName !== ''
                    && $rpId === 'localhost'
                    && $clientDataJson !== ''
                    && strlen($authenticatorData) === 37
                    && $signature === 'test-signature'
                    && $publicKey === 'test-public-key'
                    && strlen($challenge) === 32
                    && $previousSignCount === 1;
            })
            ->andReturn(7);

        $challenge = $this->issueAuthenticationChallenge();
        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle'],
            0x1D
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('user.id', (int) $user->id)
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonPath('sanctum_token', null)
            ->assertJsonStructure([
                'access_token',
                'refresh_token',
                'security_confirmation_token',
                'security_confirmation_expires_in',
            ]);

        $updated = DB::table('webauthn_credentials')
            ->where('credential_id', $credential['credential_id'])
            ->first();
        $this->assertNotNull($updated);
        $this->assertSame(7, (int) $updated->sign_count);
        $this->assertSame(1, (int) $updated->backup_eligible);
        $this->assertSame(1, (int) $updated->backup_state);
        $this->assertSame(1, (int) $updated->user_verified);
        $this->assertSame('localhost', $updated->rp_id);
        $this->assertSame('http://localhost:5173', $updated->registration_origin);
        $this->assertNotNull($updated->last_used_at);
        $this->assertNotNull(
            DB::table('users')->where('id', $user->id)->value('last_login_at')
        );
        $this->assertSame(0, DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->count());

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_CHALLENGE_EXPIRED');
    }

    public function test_global_revocation_after_challenge_prevents_valid_passkey_token_issuance(): void
    {
        $user = $this->eligibleUser();
        $credential = $this->credentialFor($user);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')->once()->andReturn(2);

        $challenge = $this->issueAuthenticationChallenge();
        $tokenService = $this->app->make(TokenService::class);
        $this->assertGreaterThan(
            0,
            $tokenService->revokeAllTokensForUser((int) $user->id, 'password_change')
        );

        $issuanceGuard = Mockery::mock(TokenService::class)->makePartial();
        $issuanceGuard->shouldNotReceive('generateToken');
        $issuanceGuard->shouldNotReceive('generateRefreshToken');
        $issuanceGuard->shouldNotReceive('generateSecurityConfirmationToken');
        $this->app->instance(TokenService::class, $issuanceGuard);

        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle']
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED')
            ->assertJsonMissingPath('access_token')
            ->assertJsonMissingPath('refresh_token');

        $this->assertDatabaseMissing('refresh_token_sessions', [
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertSame(1, (int) DB::table('webauthn_credentials')
            ->where('credential_id', $credential['credential_id'])
            ->value('sign_count'));
    }

    /**
     * @return array<string, array{array<string, mixed>, string}>
     */
    public static function blockedAccountProvider(): array
    {
        return [
            'suspended account' => [
                ['status' => 'suspended'],
                'AUTH_ACCOUNT_SUSPENDED',
            ],
            'banned account' => [
                ['status' => 'banned'],
                'AUTH_ACCOUNT_SUSPENDED',
            ],
            'inactive account' => [
                ['status' => 'inactive'],
                'AUTH_ACCOUNT_SUSPENDED',
            ],
            'pending account' => [
                ['status' => 'pending'],
                'AUTH_ACCOUNT_PENDING_APPROVAL',
            ],
            'pending identity verification' => [
                ['status' => 'active', 'verification_status' => 'pending'],
                'AUTH_PENDING_VERIFICATION',
            ],
            'failed identity verification' => [
                ['status' => 'active', 'verification_status' => 'failed'],
                'AUTH_VERIFICATION_FAILED',
            ],
        ];
    }

    /** @param array<string, mixed> $attributes */
    #[DataProvider('blockedAccountProvider')]
    public function test_blocked_account_and_verification_states_cannot_use_passkeys(
        array $attributes,
        string $expectedCode
    ): void {
        $user = $this->eligibleUser($attributes);
        $credential = $this->credentialFor($user);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')->once()->andReturn(2);
        $challenge = $this->issueAuthenticationChallenge();

        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle']
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', $expectedCode);
    }

    public function test_required_email_verification_gate_receives_the_users_tenant_id(): void
    {
        app(TenantSettingsService::class)->set(
            $this->testTenantId,
            'email_verification',
            'true',
            'boolean'
        );
        $user = $this->eligibleUser(['email_verified_at' => null]);
        $credential = $this->credentialFor($user);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')->once()->andReturn(2);
        $challenge = $this->issueAuthenticationChallenge();

        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle']
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'AUTH_EMAIL_NOT_VERIFIED');
    }

    public function test_invalid_assertion_never_reveals_a_blocked_account_gate(): void
    {
        $user = $this->eligibleUser(['status' => 'suspended']);
        $credential = $this->credentialFor($user);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')
            ->once()
            ->andThrow(new \RuntimeException('Invalid signature'));
        $challenge = $this->issueAuthenticationChallenge([
            'email' => $user->email,
        ]);

        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle']
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');

        $this->assertSame(1, (int) DB::table('webauthn_credentials')
            ->where('credential_id', $credential['credential_id'])
            ->value('sign_count'));
    }

    public function test_authentication_rejects_a_change_to_the_backup_eligibility_flag(): void
    {
        $user = $this->eligibleUser();
        $credential = $this->credentialFor($user, ['backup_eligible' => 0]);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')->once()->andReturn(2);
        $challenge = $this->issueAuthenticationChallenge();
        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle'],
            0x0D
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');

        $this->assertSame(1, (int) DB::table('webauthn_credentials')
            ->where('credential_id', $credential['credential_id'])
            ->value('sign_count'));
    }

    public function test_authentication_rejects_backup_state_without_backup_eligibility(): void
    {
        $user = $this->eligibleUser();
        $credential = $this->credentialFor($user, ['backup_eligible' => 0]);
        $verifier = $this->verifierMock();
        $verifier->shouldReceive('verifyAuthentication')->once()->andReturn(2);
        $challenge = $this->issueAuthenticationChallenge();
        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            (string) $credential['user_handle'],
            0x15
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');
    }

    public function test_account_bound_challenge_rejects_credential_outside_allow_credentials(): void
    {
        $boundUser = $this->authenticatedUser();
        $otherUser = $this->eligibleUser();
        $this->credentialFor($boundUser);
        $otherCredential = $this->credentialFor($otherUser);
        $verifier = $this->verifierMock();
        $verifier->shouldNotReceive('verifyAuthentication');

        $challenge = $this->issueAuthenticationChallenge();
        $payload = $this->assertionPayload(
            $otherCredential,
            $challenge['challenge'],
            $challenge['challenge_id']
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');
    }

    public function test_account_bound_challenge_rejects_a_different_credential_owner(): void
    {
        $boundUser = $this->eligibleUser();
        $otherUser = $this->eligibleUser();
        $otherCredential = $this->credentialFor($otherUser);
        $verifier = $this->verifierMock();
        $verifier->shouldNotReceive('verifyAuthentication');

        $challenge = $this->base64UrlEncode(random_bytes(32));
        $challengeId = $this->app->make(WebAuthnChallengeStore::class)->create(
            $challenge,
            (int) $boundUser->id,
            'authenticate',
            [
                'origin' => 'http://localhost',
                'rp_id' => 'localhost',
                'allowed_credential_ids' => [$otherCredential['credential_id']],
                'account_bound' => true,
                'discoverable' => false,
            ]
        );
        $payload = $this->assertionPayload(
            $otherCredential,
            $challenge,
            $challengeId
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');
    }

    public function test_discoverable_assertion_rejects_a_mismatched_user_handle(): void
    {
        $user = $this->eligibleUser();
        $credential = $this->credentialFor($user);
        $verifier = $this->verifierMock();
        $verifier->shouldNotReceive('verifyAuthentication');
        $challenge = $this->issueAuthenticationChallenge();

        $payload = $this->assertionPayload(
            $credential,
            $challenge['challenge'],
            $challenge['challenge_id'],
            'http://localhost',
            $this->base64UrlEncode(random_bytes(32))
        );

        $this->apiPost('/webauthn/auth-verify', $payload, ['Origin' => 'http://localhost'])
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_FAILED');
    }

    // ------------------------------------------------------------------
    // Credential management authentication and mutation safeguards
    // ------------------------------------------------------------------

    public function test_remove_requires_auth(): void
    {
        $this->apiPost('/webauthn/remove', ['credential_id' => 'abc'])
            ->assertUnauthorized();
    }

    public function test_rename_requires_auth(): void
    {
        $this->apiPost('/webauthn/rename', [
            'credential_id' => 'abc',
            'device_name' => 'My Passkey',
        ])->assertUnauthorized();
    }

    public function test_remove_all_requires_auth(): void
    {
        $this->apiPost('/webauthn/remove-all')
            ->assertUnauthorized();
    }

    public function test_credentials_requires_auth(): void
    {
        $this->apiGet('/webauthn/credentials')
            ->assertUnauthorized();
    }

    public function test_credentials_returns_data(): void
    {
        $user = $this->authenticatedUser();
        $modern = $this->credentialFor($user, ['credential_discoverable' => 1]);
        $legacy = $this->credentialFor($user, ['credential_discoverable' => null]);

        $response = $this->apiGet('/webauthn/credentials')
            ->assertOk()
            ->assertJsonPath('data.count', 2);
        $credentials = collect($response->json('data.credentials'))->keyBy('credential_id');
        $this->assertTrue($credentials[$modern['credential_id']]['credential_discoverable']);
        $this->assertNull($credentials[$legacy['credential_id']]['credential_discoverable']);
    }

    public function test_existing_passkeys_remain_visible_and_manageable_when_authentication_is_disabled(): void
    {
        $user = $this->authenticatedUser();
        $credential = $this->credentialFor($user, [
            'device_name' => 'Existing passkey',
        ]);
        $confirmation = $this->securityConfirmationToken($user);
        $this->setBiometricLoginEnabled(false);

        $this->apiGet('/webauthn/credentials')
            ->assertOk()
            ->assertJsonPath('data.count', 1)
            ->assertJsonPath('data.credentials.0.device_name', 'Existing passkey');

        $this->apiGet('/webauthn/status')
            ->assertOk()
            ->assertJsonPath('data.registered', true)
            ->assertJsonPath('data.enrollment_allowed', false);

        $this->apiPost('/webauthn/rename', [
            'credential_id' => $credential['credential_id'],
            'device_name' => 'Renamed passkey',
            'security_confirmation_token' => $confirmation,
        ])
            ->assertOk()
            ->assertJsonPath('data.device_name', 'Renamed passkey');

        $this->apiPost('/webauthn/remove', [
            'credential_id' => $credential['credential_id'],
            'security_confirmation_token' => $confirmation,
        ])->assertOk();

        $this->assertDatabaseMissing('webauthn_credentials', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $credential['credential_id'],
        ]);
    }

    public function test_recent_user_verified_passkey_login_satisfies_security_confirmation(): void
    {
        $user = $this->eligibleUser();
        $accessToken = $this->app->make(TokenService::class)->generateToken(
            (int) $user->id,
            $this->testTenantId,
            [
                'amr' => ['passkey', 'user_verification'],
                'acr' => 'urn:nexus:aal2',
            ]
        );

        $response = $this->apiPost('/webauthn/security-confirm', [], [
            'Authorization' => 'Bearer ' . $accessToken,
        ]);
        $response
            ->assertOk()
            ->assertJsonPath('data.expires_in', 300)
            ->assertJsonStructure(['data' => ['security_confirmation_token']]);

        $payload = $this->app->make(TokenService::class)->validateSecurityConfirmationToken(
            (string) $response->json('data.security_confirmation_token'),
            (int) $user->id,
            $this->testTenantId
        );
        $this->assertSame('passkey_uv', $payload['method'] ?? null);
    }

    public function test_password_security_confirmation_holds_the_tenant_user_issuance_lock(): void
    {
        $password = 'CurrentSecurityPassword123!';
        $user = $this->authenticatedUser([
            'password_hash' => password_hash($password, PASSWORD_ARGON2ID),
        ]);
        $queries = [];
        DB::listen(static function ($query) use (&$queries): void {
            $queries[] = strtolower((string) $query->sql);
        });

        $response = $this->apiPost('/webauthn/security-confirm', [
            'current_password' => $password,
        ])->assertOk()
            ->assertJsonStructure(['data' => ['security_confirmation_token']]);

        $this->assertTrue(
            collect($queries)->contains(static fn (string $sql): bool =>
                str_contains($sql, 'from `users`')
                && str_contains($sql, 'for update')
            ),
            'Security confirmation must lock the tenant user through factor verification and token issuance.'
        );

        $tokenService = $this->app->make(TokenService::class);
        $confirmation = (string) $response->json('data.security_confirmation_token');
        $this->assertNotNull($tokenService->validateSecurityConfirmationToken(
            $confirmation,
            (int) $user->id,
            $this->testTenantId
        ));
        $this->assertGreaterThan(0, $tokenService->revokeAllTokensForUser((int) $user->id, 'test_password_change'));
        $this->assertNull($tokenService->validateSecurityConfirmationToken(
            $confirmation,
            (int) $user->id,
            $this->testTenantId
        ));
    }

    public function test_passkey_login_without_user_verification_does_not_satisfy_security_confirmation(): void
    {
        $user = $this->eligibleUser();
        $accessToken = $this->app->make(TokenService::class)->generateToken(
            (int) $user->id,
            $this->testTenantId,
            [
                'amr' => ['passkey'],
                'acr' => 'urn:nexus:aal1',
            ]
        );

        $this->apiPost('/webauthn/security-confirm', [], [
            'Authorization' => 'Bearer ' . $accessToken,
        ])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED');
    }

    public function test_last_passkey_cannot_be_removed_without_another_sign_in_method(): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update([
            'password' => null,
            'password_hash' => null,
        ]);
        $credential = $this->credentialFor($user, [
            'device_name' => 'Only sign-in passkey',
        ]);
        $confirmation = $this->securityConfirmationToken($user);

        $this->apiPost('/webauthn/remove', [
            'credential_id' => $credential['credential_id'],
            'security_confirmation_token' => $confirmation,
        ])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'LAST_SIGN_IN_METHOD');

        $this->apiPost('/webauthn/remove-all', [
            'security_confirmation_token' => $confirmation,
        ])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'LAST_SIGN_IN_METHOD');

        $this->assertDatabaseHas('webauthn_credentials', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $credential['credential_id'],
        ]);
    }

    public function test_passkey_removal_revokes_existing_jwt_and_sanctum_sessions(): void
    {
        $user = $this->authenticatedUser();
        $credential = $this->credentialFor($user);
        $tokenService = $this->app->make(TokenService::class);
        $accessToken = $tokenService->generateToken(
            (int) $user->id,
            $this->testTenantId
        );
        $user->createToken('passkey-removal-regression');

        $this->apiPost('/webauthn/remove', [
            'credential_id' => $credential['credential_id'],
            'security_confirmation_token' => $this->securityConfirmationToken($user),
        ])
            ->assertOk()
            ->assertJsonPath('data.sessions_revoked', true);

        $this->assertNull($tokenService->validateToken($accessToken));
        $this->assertDatabaseMissing('personal_access_tokens', [
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
        ]);
    }

    public function test_passkey_removal_rolls_back_when_session_revocation_fails(): void
    {
        $user = $this->authenticatedUser();
        $credential = $this->credentialFor($user);
        $tokenService = Mockery::mock(TokenService::class);
        $tokenService->shouldReceive('validateSecurityConfirmationToken')
            ->once()
            ->andReturn([
                'user_id' => (int) $user->id,
                'tenant_id' => $this->testTenantId,
                'type' => 'security_confirmation',
            ]);
        $tokenService->shouldReceive('validateSecurityConfirmationTokenUnderUserLock')
            ->once()->andReturn(['user_id' => (int) $user->id, 'tenant_id' => $this->testTenantId, 'type' => 'security_confirmation']);
        $tokenService->shouldReceive('revokeAllTokensForUser')
            ->once()
            ->with((int) $user->id)
            ->andReturn(0);
        $this->app->instance(TokenService::class, $tokenService);

        $this->apiPost('/webauthn/remove', [
            'credential_id' => $credential['credential_id'],
            'security_confirmation_token' => 'valid-test-confirmation',
        ])
            ->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'AUTH_WEBAUTHN_UNAVAILABLE');

        $this->assertDatabaseHas('webauthn_credentials', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $credential['credential_id'],
        ]);
    }

    public function test_passkey_removal_rechecks_confirmation_after_user_lock(): void
    {
        foreach (['/webauthn/remove', '/webauthn/remove-all'] as $route) {
            $user = $this->authenticatedUser();
            $credential = $this->credentialFor($user);
            $confirmation = $this->securityConfirmationToken($user);
            $armed = true;
            DB::listen(function ($query) use (&$armed, $user): void {
                if ($armed && str_contains(strtolower($query->sql), 'for update')
                    && str_contains($query->sql, '`users`') && in_array($user->id, $query->bindings)) {
                    $armed = false;
                    app(TokenService::class)->revokeAllTokensForUser($user->id);
                }
            });
            $this->apiPost($route, ['credential_id' => $credential['credential_id'],
                'security_confirmation_token' => $confirmation])->assertStatus(403);
            $this->assertFalse($armed);
            $this->assertDatabaseHas('webauthn_credentials', ['user_id' => $user->id,
                'credential_id' => $credential['credential_id']]);
        }
    }

    public function test_status_requires_auth(): void
    {
        $this->apiGet('/webauthn/status')
            ->assertUnauthorized();
    }

    public function test_status_returns_data(): void
    {
        $this->authenticatedUser();

        $this->apiGet('/webauthn/status')
            ->assertOk()
            ->assertJsonPath('data.current_rp_id', 'localhost')
            ->assertJsonPath('data.max_credentials', 10);
    }
}
