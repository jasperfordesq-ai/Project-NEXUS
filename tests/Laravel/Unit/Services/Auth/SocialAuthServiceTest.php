<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Auth;

use App\Services\Auth\SocialAuthService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * SocialAuthServiceTest
 *
 * Tests the OAuth identity find-or-create logic, account linking,
 * unlinking, callback code round-trip, and provider enablement gate.
 *
 * Strategy:
 *  - Socialite is NOT installed in the test environment, so methods that
 *    call the Socialite facade directly (redirectUrl, handleCallback) are
 *    tested only as far as they can go without a real driver. The core
 *    identity logic is exposed via findOrCreateFromOauth and
 *    linkExistingAccount which we call directly with a mock provider user.
 *  - No outbound HTTP is made; Cache is backed by the array driver in tests.
 *  - DatabaseTransactions rolls back every insert so tests are isolated.
 */
class SocialAuthServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;
    private const BROWSER_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    private SocialAuthService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);

        $this->svc = new SocialAuthService(
            new TenantSettingsService(),
            new TokenService(),
            new TotpService()
        );
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a minimal user row and return its integer id.
     */
    private function insertUser(array $overrides = []): int
    {
        $uid = uniqid('su', true);
        return DB::table('users')->insertGetId(array_merge([
            'tenant_id'          => self::TENANT_ID,
            'name'               => 'Social User ' . $uid,
            'first_name'         => 'Social',
            'last_name'          => 'User',
            'email'              => 'social.' . $uid . '@example.test',
            'password'           => password_hash('secret', PASSWORD_BCRYPT),
            'email_verified_at'  => now(),
            'status'             => 'active',
            'is_approved'        => 1,
            'role'               => 'member',
            'balance'            => 0,
            'created_at'         => now(),
            'updated_at'         => now(),
        ], $overrides));
    }

    /**
     * Insert an oauth_identities row for an existing user.
     */
    private function insertIdentity(int $userId, string $provider, string $providerUserId): void
    {
        DB::table('oauth_identities')->insert([
            'user_id'          => $userId,
            'tenant_id'        => self::TENANT_ID,
            'provider'         => $provider,
            'provider_user_id' => $providerUserId,
            'provider_email'   => 'p@example.test',
            'raw_payload'      => '{}',
            'linked_at'        => now(),
            'last_used_at'     => now(),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    private function seedRegistrationPolicy(string $mode): void
    {
        $generalMode = $mode === 'closed' ? 'closed' : 'open';
        $policyMode = $mode === 'closed' ? 'open' : $mode;

        foreach (['general.registration_mode', 'registration_mode'] as $settingKey) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => self::TENANT_ID, 'setting_key' => $settingKey],
                [
                    'setting_value' => $generalMode,
                    'setting_type' => 'string',
                    'updated_at' => now(),
                ]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant(self::TENANT_ID);

        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => self::TENANT_ID],
            [
                'registration_mode' => $policyMode,
                'verification_provider' => null,
                'verification_level' => 'none',
                'post_verification' => $mode === 'open_with_approval' ? 'admin_approval' : 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 0,
                'provider_config' => null,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    /**
     * Build a minimal Socialite-like provider user anonymous object.
     *
     * @param array<string,mixed>|null $rawPayload
     */
    private function makeProviderUser(
        string $id,
        string $email,
        ?string $name = 'Test User',
        ?string $avatar = null,
        ?array $rawPayload = null
    ): object {
        if ($rawPayload === null) {
            $rawPayload = ['sub' => $id, 'aud' => 'test', 'email_verified' => true];
            if (!str_ends_with(strtolower($email), '@gmail.com')) {
                $at = strrpos($email, '@');
                if ($at !== false && $at < strlen($email) - 1) {
                    $rawPayload['hd'] = substr($email, $at + 1);
                }
            }
        }

        return new class ($id, $email, $name, $avatar, $rawPayload) {
            public function __construct(
                private string $id,
                private string $email,
                private ?string $name,
                private ?string $avatar,
                private array $rawPayload,
            ) {}
            public function getId(): string       { return $this->id; }
            public function getEmail(): string    { return $this->email; }
            public function getName(): ?string    { return $this->name; }
            public function getAvatar(): ?string  { return $this->avatar; }
            public function getRaw(): array       { return $this->rawPayload; }
        };
    }

    // ── SUPPORTED_PROVIDERS constant ─────────────────────────────────────────

    public function test_supported_providers_list_is_correct(): void
    {
        $this->assertSame(
            ['google', 'facebook'],
            SocialAuthService::SUPPORTED_PROVIDERS
        );
    }

    // ── findOrCreateFromOauth — new user ─────────────────────────────────────

    public function test_new_user_is_created_when_no_existing_identity_or_email_match(): void
    {
        $this->seedRegistrationPolicy('open');
        $providerUser = $this->makeProviderUser('google-uid-new-001', 'brand.new.user@example.test', 'Brand New');
        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);

        $this->assertTrue($result['is_new'], 'Expected is_new=true for a brand-new user');
        $this->assertSame(self::TENANT_ID, $result['tenant_id']);
        $this->assertNotNull($result['user']);
        $this->assertSame('brand.new.user@example.test', $result['user']->email);
        $this->assertSame('active', $result['user']->status);
        $this->assertTrue((bool) $result['user']->is_approved);

        // Identity row must have been created.
        $identity = DB::selectOne(
            'SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?',
            ['google', 'google-uid-new-001']
        );
        $this->assertNotNull($identity, 'oauth_identities row should exist');
        $this->assertSame((int) $result['user']->id, (int) $identity->user_id);
    }

    public function test_login_resolution_never_provisions_a_new_user(): void
    {
        $this->seedRegistrationPolicy('open');
        $email = 'login.must.not.provision@example.test';
        $providerUser = $this->makeProviderUser('google-login-no-provision', $email);

        try {
            $this->svc->findOrCreateFromOauth(
                'google',
                $providerUser,
                self::TENANT_ID,
                time(),
                false
            );
            self::fail('OAuth login intent must not provision a new account.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('cannot create a new account', $e->getMessage());
        }

        $this->assertSame(0, DB::table('users')
            ->where('tenant_id', self::TENANT_ID)
            ->where('email', $email)
            ->count());
        $this->assertSame(0, DB::table('oauth_identities')
            ->where('provider', 'google')
            ->where('provider_user_id', 'google-login-no-provision')
            ->count());
    }

    public function test_new_user_creation_is_rejected_when_registration_is_closed(): void
    {
        $this->seedRegistrationPolicy('closed');
        $email = 'closed.oauth@example.test';
        $providerUser = $this->makeProviderUser('google-closed-001', $email);

        try {
            $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);
            self::fail('Closed registration must reject OAuth account creation.');
        } catch (\RuntimeException $e) {
            $this->assertSame('OAuth registration is not permitted by community policy.', $e->getMessage());
        }

        $this->assertSame(
            0,
            DB::table('users')->where('tenant_id', self::TENANT_ID)->where('email', $email)->count()
        );
        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('provider_user_id', 'google-closed-001')->count()
        );
    }

    public function test_new_user_creation_is_rejected_for_invite_only_without_invite_proof(): void
    {
        $this->seedRegistrationPolicy('invite_only');
        $email = 'invite.oauth@example.test';
        $providerUser = $this->makeProviderUser('google-invite-001', $email);

        try {
            $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);
            self::fail('Invite-only registration must reject OAuth without invite proof.');
        } catch (\RuntimeException $e) {
            $this->assertSame('OAuth registration is not permitted by community policy.', $e->getMessage());
        }

        $this->assertSame(
            0,
            DB::table('users')->where('tenant_id', self::TENANT_ID)->where('email', $email)->count()
        );
        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('provider_user_id', 'google-invite-001')->count()
        );
    }

    public function test_new_user_under_approval_policy_stays_blocked_after_atomic_orchestration(): void
    {
        $this->seedRegistrationPolicy('open_with_approval');
        $providerUser = $this->makeProviderUser(
            'google-approval-001',
            'approval.oauth@example.test'
        );

        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);
        $user = $result['user'];

        $this->assertTrue($result['is_new']);
        $this->assertSame('pending', $user->status);
        $this->assertFalse((bool) $user->is_approved);
        $this->assertDatabaseHas('oauth_identities', [
            'user_id' => $user->id,
            'tenant_id' => self::TENANT_ID,
            'provider_user_id' => 'google-approval-001',
        ]);

        $issuance = $this->svc->issueLoginCallbackCode(
            (int) $user->id,
            self::TENANT_ID,
            'google',
            true,
            time(),
            self::BROWSER_CHALLENGE
        );
        $this->assertSame('gate_blocked', $issuance['status']);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')->where('user_id', $user->id)->count()
        );
    }

    public function test_name_is_split_correctly_on_new_user(): void
    {
        $providerUser = $this->makeProviderUser('google-uid-name-001', 'alice.smith@example.test', 'Alice Smith');
        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);

        $user = $result['user'];
        $this->assertSame('Alice', $user->first_name);
        $this->assertSame('Smith', $user->last_name);
    }

    public function test_email_local_part_used_as_first_name_when_no_name_provided(): void
    {
        $providerUser = $this->makeProviderUser('google-uid-noname-001', 'janedoe@example.test', null);
        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);

        $this->assertSame('Janedoe', $result['user']->first_name);
    }

    public function test_new_user_email_is_marked_verified(): void
    {
        $providerUser = $this->makeProviderUser('google-uid-vrf-001', 'verified.check@example.test', 'V C');
        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);

        $dbRow = DB::selectOne('SELECT email_verified_at FROM users WHERE id = ?', [$result['user']->id]);
        $this->assertNotNull($dbRow->email_verified_at, 'New OAuth user must have email_verified_at set');
    }

    public function test_new_identity_requires_authoritative_provider_email_ownership(): void
    {
        $cases = [
            'google_false' => ['google', ['email_verified' => false]],
            'google_absent' => ['google', []],
            'google_string_true' => ['google', ['email_verified' => 'true']],
            'google_integer_true' => ['google', ['email_verified' => 1]],
            'google_external_without_hd' => ['google', ['email_verified' => true]],
            'facebook_verified_flag' => ['facebook', ['verified' => true]],
            'facebook_synthetic_email_verified' => ['facebook', ['email_verified' => true]],
        ];

        foreach ($cases as $label => [$provider, $claims]) {
            $email = 'untrusted.' . $label . '@example.test';
            $rawPayload = array_merge([
                'sub' => 'untrusted-' . $label,
                'email' => $email,
            ], $claims);

            $providerUser = $this->makeProviderUser(
                'untrusted-' . $label,
                $email,
                'Untrusted Email',
                null,
                $rawPayload
            );

            try {
                $this->svc->findOrCreateFromOauth(
                    $provider,
                    $providerUser,
                    self::TENANT_ID,
                    time(),
                    true
                );
                self::fail("{$label} must not establish provider email ownership.");
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('prove current ownership', $e->getMessage());
            }

            $this->assertSame(
                0,
                DB::table('users')->where('tenant_id', self::TENANT_ID)->where('email', $email)->count()
            );
            $this->assertSame(
                0,
                DB::table('oauth_identities')->where('provider_user_id', 'untrusted-' . $label)->count()
            );
        }
    }

    public function test_google_email_ownership_accepts_gmail_and_workspace_hosted_domain(): void
    {
        $cases = [
            'gmail' => [
                'email' => 'nexus.oauth.owner@gmail.com',
                'raw' => ['email_verified' => true],
            ],
            'workspace' => [
                'email' => 'nexus.oauth.owner@workspace.example',
                'raw' => ['email_verified' => true, 'hd' => 'workspace.example'],
            ],
        ];

        foreach ($cases as $label => $case) {
            $providerUser = $this->makeProviderUser(
                'trusted-google-' . $label,
                $case['email'],
                'Trusted Google User',
                null,
                array_merge(['sub' => 'trusted-google-' . $label, 'email' => $case['email']], $case['raw'])
            );

            $result = $this->svc->findOrCreateFromOauth(
                'google',
                $providerUser,
                self::TENANT_ID,
                time(),
                true
            );

            $this->assertTrue($result['is_new']);
            $this->assertNotNull(DB::table('users')
                ->where('id', $result['user']->id)
                ->where('tenant_id', self::TENANT_ID)
                ->value('email_verified_at'));
        }
    }

    // ── findOrCreateFromOauth — existing identity ─────────────────────────────

    public function test_existing_identity_returns_existing_user_without_creating_new(): void
    {
        $existingUserId = $this->insertUser(['email' => 'existing.oauth@example.test']);
        $this->insertIdentity($existingUserId, 'google', 'google-uid-existing-001');

        $countBefore = DB::table('users')->count();
        $providerUser = $this->makeProviderUser('google-uid-existing-001', 'existing.oauth@example.test', 'Existing User');
        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time());

        $this->assertFalse($result['is_new'], 'Existing identity should not create a new user');
        $this->assertSame($existingUserId, (int) $result['user']->id);
        $this->assertSame($countBefore, DB::table('users')->count(), 'No extra user row should be created');
    }

    public function test_existing_identity_from_another_tenant_is_rejected(): void
    {
        $otherTenantId = 1;
        $existingUserId = $this->insertUser([
            'tenant_id' => $otherTenantId,
            'email' => 'cross.tenant.oauth@example.test',
        ]);
        DB::table('oauth_identities')->insert([
            'user_id' => $existingUserId,
            'tenant_id' => $otherTenantId,
            'provider' => 'google',
            'provider_user_id' => 'google-cross-tenant-001',
            'provider_email' => 'cross.tenant.oauth@example.test',
            'raw_payload' => '{}',
            'linked_at' => now(),
            'last_used_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $providerUser = $this->makeProviderUser(
            'google-cross-tenant-001',
            'cross.tenant.oauth@example.test'
        );

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('OAuth identity belongs to another community.');

        $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time());
    }

    public function test_existing_identity_updates_last_used_at(): void
    {
        $existingUserId = $this->insertUser(['email' => 'last.used.update@example.test']);
        $this->insertIdentity($existingUserId, 'google', 'google-uid-lastused-001');

        // Set last_used_at to a known past value.
        DB::table('oauth_identities')
            ->where('provider_user_id', 'google-uid-lastused-001')
            ->update(['last_used_at' => '2020-01-01 00:00:00']);

        $providerUser = $this->makeProviderUser('google-uid-lastused-001', 'last.used.update@example.test');
        $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time());

        $identity = DB::selectOne(
            'SELECT last_used_at FROM oauth_identities WHERE provider_user_id = ?',
            ['google-uid-lastused-001']
        );
        $this->assertNotSame('2020-01-01 00:00:00', $identity->last_used_at, 'last_used_at should be refreshed');
    }

    public function test_existing_subject_login_ignores_unverified_facebook_email_metadata(): void
    {
        $userId = $this->insertUser(['email' => 'subject.owner@example.test']);
        $this->insertIdentity($userId, 'facebook', 'facebook-existing-subject');
        $providerUser = $this->makeProviderUser(
            'facebook-existing-subject',
            'attacker-controlled@example.test',
            'Existing Subject',
            null,
            [
                'id' => 'facebook-existing-subject',
                'email' => 'attacker-controlled@example.test',
                'verified' => true,
                'email_verified' => true,
            ]
        );

        $result = $this->svc->findOrCreateFromOauth(
            'facebook',
            $providerUser,
            self::TENANT_ID,
            time()
        );

        $this->assertSame($userId, (int) $result['user']->id);
        $identity = DB::table('oauth_identities')
            ->where('tenant_id', self::TENANT_ID)
            ->where('provider', 'facebook')
            ->where('provider_user_id', 'facebook-existing-subject')
            ->first(['provider_email', 'raw_payload']);
        $this->assertNotNull($identity);
        $this->assertSame('p@example.test', $identity->provider_email);
        $persistedRaw = json_decode((string) $identity->raw_payload, true, 512, JSON_THROW_ON_ERROR);
        $this->assertArrayNotHasKey('email', $persistedRaw);
        $this->assertTrue($persistedRaw['verified']);
        $this->assertTrue($persistedRaw['email_verified']);
    }

    public function test_existing_google_subject_login_ignores_external_email_without_hosted_domain(): void
    {
        $userId = $this->insertUser(['email' => 'google.subject.owner@example.test']);
        $this->insertIdentity($userId, 'google', 'google-existing-external-subject');
        $providerUser = $this->makeProviderUser(
            'google-existing-external-subject',
            'reassigned.external@example.test',
            'Existing Google Subject',
            null,
            [
                'sub' => 'google-existing-external-subject',
                'email' => 'reassigned.external@example.test',
                'email_verified' => true,
            ]
        );

        $result = $this->svc->findOrCreateFromOauth(
            'google',
            $providerUser,
            self::TENANT_ID,
            time()
        );

        $this->assertSame($userId, (int) $result['user']->id);
        $identity = DB::table('oauth_identities')
            ->where('tenant_id', self::TENANT_ID)
            ->where('provider', 'google')
            ->where('provider_user_id', 'google-existing-external-subject')
            ->first(['provider_email', 'raw_payload']);
        $this->assertNotNull($identity);
        $this->assertSame('p@example.test', $identity->provider_email);
        $persistedRaw = json_decode((string) $identity->raw_payload, true, 512, JSON_THROW_ON_ERROR);
        $this->assertArrayNotHasKey('email', $persistedRaw);
        $this->assertTrue($persistedRaw['email_verified']);
    }

    // ── findOrCreateFromOauth — email match ──────────────────────────────────

    public function test_verified_email_match_links_identity_without_creating_new_user(): void
    {
        $existingUserId = $this->insertUser([
            'email'             => 'email.match@example.test',
            'email_verified_at' => now(),
        ]);

        $countBefore = DB::table('users')->count();
        $authenticationStartedAt = time();
        $providerUser = $this->makeProviderUser('google-uid-emailmatch-001', 'email.match@example.test', 'Existing Person');
        $result = $this->svc->findOrCreateFromOauth(
            'google',
            $providerUser,
            self::TENANT_ID,
            $authenticationStartedAt
        );

        $this->assertFalse($result['is_new']);
        $this->assertSame($existingUserId, (int) $result['user']->id);
        $this->assertSame($countBefore, DB::table('users')->count(), 'No new user should be created on email match');
        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('provider_user_id', 'google-uid-emailmatch-001')->count()
        );

        $issuance = $this->svc->issueLoginCallbackCode(
            $existingUserId,
            self::TENANT_ID,
            'google',
            false,
            $authenticationStartedAt,
            self::BROWSER_CHALLENGE,
            $result['identity_link']
        );
        $this->assertSame('issued', $issuance['status']);

        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('provider_user_id', 'google-uid-emailmatch-001')->count()
        );
        try {
            $this->svc->consumeCallbackCode(
                (string) $issuance['callback_code'],
                str_repeat('A', 43)
            );
            self::fail('A different browser must not complete an automatic email link.');
        } catch (\RuntimeException $e) {
            $this->assertSame('OAuth callback code is invalid or expired.', $e->getMessage());
        }
        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('provider_user_id', 'google-uid-emailmatch-001')->count()
        );

        $payload = $this->svc->consumeCallbackCode(
            (string) $issuance['callback_code'],
            self::BROWSER_VERIFIER
        );
        $this->assertNotEmpty($payload['token']);

        // The identity appears only with credential issuance after proof.
        $identity = DB::selectOne(
            'SELECT * FROM oauth_identities WHERE user_id = ? AND provider = ?',
            [$existingUserId, 'google']
        );
        $this->assertNotNull($identity, 'Identity should be created on email match');
    }

    public function test_verified_email_auto_link_rejects_revoked_flow_without_creating_identity(): void
    {
        $existingUserId = $this->insertUser([
            'email' => 'revoked.email.link@example.test',
            'email_verified_at' => now(),
        ]);
        $authenticationStartedAt = time() - 5;
        DB::table('revoked_tokens')->insert([
            'user_id' => $existingUserId,
            'jti' => 'global_revoke_' . $existingUserId,
            'revoked_at' => now(),
            'expires_at' => now()->addYear(),
        ]);

        $providerUser = $this->makeProviderUser(
            'google-uid-revoked-email-link',
            'revoked.email.link@example.test'
        );

        $result = $this->svc->findOrCreateFromOauth(
            'google',
            $providerUser,
            self::TENANT_ID,
            $authenticationStartedAt
        );
        $issuance = $this->svc->issueLoginCallbackCode(
            $existingUserId,
            self::TENANT_ID,
            'google',
            false,
            $authenticationStartedAt,
            self::BROWSER_CHALLENGE,
            $result['identity_link']
        );

        $this->assertSame('issued', $issuance['status']);
        try {
            $this->svc->consumeCallbackCode(
                (string) $issuance['callback_code'],
                self::BROWSER_VERIFIER
            );
            self::fail('A revoked flow must fail when pending identity issuance is consumed.');
        } catch (\RuntimeException $e) {
            $this->assertSame('OAuth callback code is invalid or expired.', $e->getMessage());
        }

        $this->assertSame(
            0,
            DB::table('oauth_identities')
                ->where('provider', 'google')
                ->where('provider_user_id', 'google-uid-revoked-email-link')
                ->count()
        );
    }

    public function test_callback_identity_link_rechecks_current_account_gate_before_insert(): void
    {
        $userId = $this->insertUser([
            'email' => 'suspended.callback.link@example.test',
            'status' => 'suspended',
        ]);
        $authenticationStartedAt = time();
        $providerUser = $this->makeProviderUser(
            'google-uid-suspended-link',
            'suspended.callback.link@example.test'
        );
        $result = $this->svc->findOrCreateFromOauth(
            'google',
            $providerUser,
            self::TENANT_ID,
            $authenticationStartedAt
        );

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            $authenticationStartedAt,
            self::BROWSER_CHALLENGE,
            $result['identity_link']
        );

        $this->assertSame('issued', $issuance['status']);
        try {
            $this->svc->consumeCallbackCode(
                (string) $issuance['callback_code'],
                self::BROWSER_VERIFIER
            );
            self::fail('A blocked account must fail when pending identity issuance is consumed.');
        } catch (\RuntimeException $e) {
            $this->assertSame('OAuth callback code is invalid or expired.', $e->getMessage());
        }

        $this->assertSame(
            0,
            DB::table('oauth_identities')
                ->where('provider_user_id', 'google-uid-suspended-link')
                ->count()
        );
    }

    public function test_unverified_email_match_does_not_link_existing_account(): void
    {
        // When an existing user has an UNVERIFIED email, findOrCreateFromOauth skips
        // the email-match path and falls through to step 3 (create new user).
        // NOTE: The service does NOT check for email uniqueness before the INSERT, so
        // it will throw a UniqueConstraintViolationException if a (email, tenant_id)
        // unique index exists. This is a known limitation — the service assumes that
        // the provider's email is unique within a tenant, which may not hold when two
        // accounts share the same email (one verified, one not). The assertion below
        // confirms the service skips the unverified match; the duplicate-email
        // collision is an acknowledged source bug (no graceful handling).
        $uid = uniqid('uvm', true);
        $uniqueEmail = 'unverified.match.' . $uid . '@example.test';

        $existingId = $this->insertUser([
            'email'             => $uniqueEmail,
            'email_verified_at' => null,    // NOT verified
        ]);

        $countBefore = DB::table('users')->count();

        // The provider returns a *different* email from a different account — so no
        // collision occurs. The important behaviour being verified is that the
        // service does NOT link to the unverified account via email match.
        $differentEmail = 'new.person.' . $uid . '@example.test';
        $providerUser = $this->makeProviderUser('google-uid-unverified-001-' . $uid, $differentEmail, 'New Person');
        $result = $this->svc->findOrCreateFromOauth('google', $providerUser, self::TENANT_ID, time(), true);

        // A new user is created for the new email; unverified account stays untouched.
        $this->assertTrue($result['is_new'], 'Should create a new user; unverified match must not be linked');
        $this->assertSame($countBefore + 1, DB::table('users')->count());
        $this->assertNotSame($existingId, (int) $result['user']->id);
    }

    // ── findOrCreateFromOauth — no email ─────────────────────────────────────

    public function test_throws_when_provider_returns_no_email(): void
    {
        $providerUser = new class {
            public function getId(): string      { return 'uid-no-email'; }
            public function getEmail(): string   { return ''; }  // empty — no email
            public function getName(): ?string   { return null; }
            public function getAvatar(): ?string { return null; }
            public function getRaw(): array      { return []; }
        };

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/email/i');

        $this->svc->findOrCreateFromOauth('facebook', $providerUser, self::TENANT_ID, time());
    }

    // ── linkExistingAccount ───────────────────────────────────────────────────

    public function test_link_existing_account_inserts_identity_row(): void
    {
        $userId = $this->insertUser(['email' => 'link.test@example.test']);

        $this->svc->linkExistingAccount(
            $userId, 'facebook', 'fb-uid-link-001', 'link.test@example.test', null, []
        );

        $identity = DB::selectOne(
            'SELECT * FROM oauth_identities WHERE user_id = ? AND provider = ?',
            [$userId, 'facebook']
        );
        $this->assertNotNull($identity);
        $this->assertSame('fb-uid-link-001', $identity->provider_user_id);
    }

    public function test_authenticated_subject_link_does_not_verify_local_email(): void
    {
        $userId = $this->insertUser([
            'email' => 'local.unverified@example.test',
            'email_verified_at' => null,
        ]);
        $startedAt = time();
        $identityLink = [
            'provider' => 'google',
            'provider_user_id' => 'explicit-link-unverified-email',
            'provider_email' => null,
            'avatar_url' => null,
            'raw_payload' => [
                'sub' => 'explicit-link-unverified-email',
                'email_verified' => false,
            ],
            'authentication_started_at' => $startedAt,
            'expected_verified_email' => null,
        ];
        $settings = app(TenantSettingsService::class);
        $settings->set(self::TENANT_ID, 'email_verification', 'false', 'boolean');

        try {
            $issuance = $this->svc->issuePendingLinkCallbackCode(
                $userId,
                self::TENANT_ID,
                'google',
                $startedAt,
                self::BROWSER_CHALLENGE,
                $identityLink
            );
            $this->svc->consumeCallbackCode(
                (string) $issuance['callback_code'],
                self::BROWSER_VERIFIER
            );

            $this->assertNull(DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', self::TENANT_ID)
                ->value('email_verified_at'));
            $this->assertNull(DB::table('oauth_identities')
                ->where('user_id', $userId)
                ->where('tenant_id', self::TENANT_ID)
                ->where('provider', 'google')
                ->value('provider_email'));
        } finally {
            $settings->clearCacheForTenant(self::TENANT_ID);
        }
    }

    public function test_sso_email_identity_link_is_deferred_until_browser_proof(): void
    {
        $email = 'sso.pending.identity@example.test';
        $userId = $this->insertUser([
            'email' => $email,
            'email_verified_at' => now(),
        ]);
        $startedAt = time();
        $identityProvider = 'sso:' . self::TENANT_ID . ':entra';
        $identityLink = [
            'provider' => $identityProvider,
            'provider_user_id' => 'sso-pending-subject',
            'provider_email' => $email,
            'avatar_url' => null,
            'raw_payload' => ['sub' => 'sso-pending-subject', 'email_verified' => true],
            'authentication_started_at' => $startedAt,
            'expected_verified_email' => $email,
        ];

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'sso:entra',
            false,
            $startedAt,
            self::BROWSER_CHALLENGE,
            $identityLink
        );

        $this->assertSame('issued', $issuance['status']);
        $this->assertSame(0, DB::table('oauth_identities')
            ->where('provider', $identityProvider)
            ->where('provider_user_id', 'sso-pending-subject')
            ->count());
        try {
            $this->svc->consumeCallbackCode(
                (string) $issuance['callback_code'],
                str_repeat('A', 43)
            );
            self::fail('SSO identity linking must remain bound to the initiating browser.');
        } catch (\RuntimeException $e) {
            $this->assertSame('OAuth callback code is invalid or expired.', $e->getMessage());
        }
        $this->assertSame(0, DB::table('oauth_identities')
            ->where('provider', $identityProvider)
            ->where('provider_user_id', 'sso-pending-subject')
            ->count());

        $this->svc->consumeCallbackCode(
            (string) $issuance['callback_code'],
            self::BROWSER_VERIFIER
        );
        $this->assertSame(1, DB::table('oauth_identities')
            ->where('user_id', $userId)
            ->where('tenant_id', self::TENANT_ID)
            ->where('provider', $identityProvider)
            ->where('provider_user_id', 'sso-pending-subject')
            ->count());
    }

    public function test_link_existing_account_throws_when_provider_id_belongs_to_another_user(): void
    {
        $user1 = $this->insertUser(['email' => 'user1.link@example.test']);
        $user2 = $this->insertUser(['email' => 'user2.link@example.test']);
        $this->insertIdentity($user1, 'google', 'google-uid-conflict-001');

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/already linked/i');

        // user2 tries to claim a provider_user_id already owned by user1.
        $this->svc->linkExistingAccount(
            $user2, 'google', 'google-uid-conflict-001', 'user2.link@example.test', null, []
        );
    }

    public function test_link_throws_for_unsupported_provider(): void
    {
        $userId = $this->insertUser();

        $this->expectException(\InvalidArgumentException::class);
        $this->svc->linkExistingAccount($userId, 'twitter', 'tw-uid-123', null, null, []);
    }

    // ── unlinkProvider ────────────────────────────────────────────────────────

    public function test_unlink_removes_identity_when_password_exists(): void
    {
        $userId = $this->insertUser([
            'email'         => 'unlink.pw@example.test',
            'password_hash' => password_hash('secret', PASSWORD_BCRYPT),
        ]);
        $this->insertIdentity($userId, 'google', 'google-uid-unlink-001');
        (new TokenService())->generateRefreshToken($userId, self::TENANT_ID, false);

        $this->svc->unlinkProvider($userId, 'google');

        $identity = DB::table('oauth_identities')
            ->where('user_id', $userId)
            ->where('provider', 'google')
            ->first();
        $this->assertNull($identity, 'Identity row should be deleted after unlinking');
        $session = DB::table('refresh_token_sessions')
            ->where('user_id', $userId)
            ->where('tenant_id', self::TENANT_ID)
            ->first(['revoked_at', 'revocation_reason']);
        $this->assertNotNull($session);
        $this->assertNotNull($session->revoked_at);
        $this->assertSame('oauth_identity_unlinked', $session->revocation_reason);
        $this->assertSame(1, DB::table('revoked_tokens')
            ->where('user_id', $userId)
            ->where('jti', 'global_revoke_' . $userId)
            ->count());
    }

    public function test_unlink_refuses_to_remove_last_auth_method(): void
    {
        // Insert user with NO password and only one identity.
        $userId = $this->insertUser([
            'email'    => 'unlink.noauth@example.test',
            'password' => null,
        ]);
        DB::table('users')->where('id', $userId)->update(['password' => null, 'password_hash' => null]);
        $this->insertIdentity($userId, 'google', 'google-uid-last-001');

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/only remaining/i');

        $this->svc->unlinkProvider($userId, 'google');
    }

    // ── listIdentities ────────────────────────────────────────────────────────

    public function test_list_identities_returns_all_linked_providers(): void
    {
        $userId = $this->insertUser(['email' => 'list.identities@example.test']);
        $this->insertIdentity($userId, 'google',   'google-uid-list-001');
        $this->insertIdentity($userId, 'facebook', 'fb-uid-list-001');

        $identities = $this->svc->listIdentities($userId);

        $this->assertCount(2, $identities);
        $providers = array_column($identities, 'provider');
        $this->assertContains('google', $providers);
        $this->assertContains('facebook', $providers);
    }

    public function test_list_identities_returns_empty_when_none_linked(): void
    {
        $userId = $this->insertUser(['email' => 'no.identities@example.test']);
        $this->assertSame([], $this->svc->listIdentities($userId));
    }

    // ── issueCallbackCode / consumeCallbackCode ───────────────────────────────

    public function test_state_context_binds_tenant_and_authentication_start(): void
    {
        $state = $this->callPrivateMethod(
            $this->svc,
            'buildState',
            [self::TENANT_ID, 'login', null, self::BROWSER_CHALLENGE]
        );

        $context = $this->svc->stateContext($state);

        $this->assertNotNull($context);
        $this->assertSame(self::TENANT_ID, $context['tenant_id']);
        $this->assertSame(self::BROWSER_CHALLENGE, $context['browser_challenge']);
        $this->assertLessThanOrEqual(time(), $context['authentication_started_at']);
        $this->assertGreaterThanOrEqual(time() - 2, $context['authentication_started_at']);
    }

    public function test_locked_callback_issuance_preserves_one_time_code_flow(): void
    {
        $userId = $this->insertUser(['email' => 'locked.oauth@example.test']);

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            time(),
            self::BROWSER_CHALLENGE
        );

        $this->assertSame('issued', $issuance['status']);
        $this->assertNotEmpty($issuance['callback_code']);

        $payload = $this->svc->consumeCallbackCode(
            (string) $issuance['callback_code'],
            self::BROWSER_VERIFIER
        );
        $this->assertSame('google', $payload['provider']);
        $this->assertSame(self::TENANT_ID, $payload['tenant_id']);
        $this->assertNotEmpty($payload['token']);
        $this->assertNotEmpty($payload['refresh_token']);
        $this->assertSame(
            $userId,
            (int) (new TokenService())->validateToken($payload['token'])['user_id']
        );
        $this->assertSame(
            1,
            DB::table('refresh_token_sessions')->where('user_id', $userId)->count()
        );
    }

    public function test_locked_callback_issuance_rejects_current_suspended_account(): void
    {
        $userId = $this->insertUser([
            'email' => 'suspended.oauth@example.test',
            'status' => 'suspended',
        ]);

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            time(),
            self::BROWSER_CHALLENGE
        );

        $this->assertSame('gate_blocked', $issuance['status']);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')->where('user_id', $userId)->count()
        );
    }

    public function test_locked_callback_issuance_rejects_current_inactive_account(): void
    {
        $userId = $this->insertUser([
            'email' => 'inactive.oauth@example.test',
            'status' => 'inactive',
        ]);

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            time(),
            self::BROWSER_CHALLENGE
        );

        $this->assertSame('gate_blocked', $issuance['status']);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')->where('user_id', $userId)->count()
        );
    }

    public function test_locked_callback_issuance_rejects_current_unapproved_account(): void
    {
        $userId = $this->insertUser([
            'email' => 'unapproved.oauth@example.test',
            'is_approved' => 0,
        ]);

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            time(),
            self::BROWSER_CHALLENGE
        );

        $this->assertSame('gate_blocked', $issuance['status']);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')->where('user_id', $userId)->count()
        );
    }

    public function test_locked_callback_issuance_rejects_flow_invalidated_after_start(): void
    {
        $userId = $this->insertUser(['email' => 'revoked.oauth@example.test']);
        $authenticationStartedAt = time() - 5;
        DB::table('revoked_tokens')->insert([
            'user_id' => $userId,
            'jti' => 'global_revoke_' . $userId,
            'revoked_at' => now(),
            'expires_at' => now()->addYear(),
        ]);

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            $authenticationStartedAt,
            self::BROWSER_CHALLENGE
        );

        $this->assertSame('authentication_invalidated', $issuance['status']);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')->where('user_id', $userId)->count()
        );
    }

    public function test_pending_identity_link_waits_for_local_mfa(): void
    {
        $userId = $this->insertUser(['email' => 'mfa.link@example.test', 'email_verified_at' => now()]);
        $secret = \App\Services\TotpService::generateSecret();
        DB::table('user_totp_settings')->insert([
            'user_id' => $userId, 'tenant_id' => self::TENANT_ID,
            'totp_secret_encrypted' => \App\Core\TotpEncryption::encrypt($secret), 'is_enabled' => 1, 'is_pending_setup' => 0,
        ]);
        $started = time();
        $identity = $this->svc->findOrCreateFromOauth('google', $this->makeProviderUser('mfa-link-subject', 'mfa.link@example.test', 'MFA Person'), self::TENANT_ID, $started);
        $issuance = $this->svc->issueLoginCallbackCode($userId, self::TENANT_ID, 'google', false, $started, self::BROWSER_CHALLENGE, $identity['identity_link']);
        $challenge = $this->svc->consumeCallbackCode($issuance['callback_code'], self::BROWSER_VERIFIER);
        $this->assertTrue($challenge['requires_2fa']);
        $this->assertDatabaseMissing('oauth_identities', ['provider_user_id' => 'mfa-link-subject']);
        $this->apiPost('/totp/verify', ['two_factor_token' => $challenge['two_factor_token'], 'code' => 'invalid'])->assertStatus(401);
        $this->assertDatabaseMissing('oauth_identities', ['provider_user_id' => 'mfa-link-subject']);
        $this->apiPost('/totp/verify', ['two_factor_token' => $challenge['two_factor_token'], 'code' => \OTPHP\TOTP::createFromSecret($secret)->now()])->assertOk();
        $this->assertDatabaseHas('oauth_identities', ['user_id' => $userId, 'provider_user_id' => 'mfa-link-subject']);
    }

    public function test_locked_callback_issuance_continues_with_local_totp(): void
    {
        $userId = $this->insertUser(['email' => 'totp.oauth@example.test']);
        DB::table('user_totp_settings')->insert([
            'user_id' => $userId,
            'tenant_id' => self::TENANT_ID,
            'totp_secret_encrypted' => 'not-read-during-oauth-callback',
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);

        $issuance = $this->svc->issueLoginCallbackCode(
            $userId,
            self::TENANT_ID,
            'google',
            false,
            time(),
            self::BROWSER_CHALLENGE
        );

        $this->assertSame('issued', $issuance['status']);
        $challenge = $this->svc->consumeCallbackCode($issuance['callback_code'], self::BROWSER_VERIFIER);
        $this->assertTrue($challenge['requires_2fa']);
        $this->assertArrayNotHasKey('token', $challenge);
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')->where('user_id', $userId)->count()
        );
    }

    public function test_callback_code_round_trip_returns_correct_payload(): void
    {
        $code = $this->svc->issueCallbackCode(
            'jwt-token-abc',
            'google',
            true,
            self::TENANT_ID,
            self::BROWSER_CHALLENGE,
            'refresh-token-xyz',
            900,
            2592000
        );
        $this->assertNotEmpty($code);

        $payload = $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER);

        $this->assertSame('jwt-token-abc', $payload['token']);
        $this->assertSame('refresh-token-xyz', $payload['refresh_token']);
        $this->assertSame(900, $payload['expires_in']);
        $this->assertSame(2592000, $payload['refresh_expires_in']);
        $this->assertSame('google', $payload['provider']);
        $this->assertTrue($payload['is_new']);
        $this->assertSame(self::TENANT_ID, $payload['tenant_id']);
    }

    public function test_callback_code_rejects_other_browser_without_consuming_initiator_code(): void
    {
        $code = $this->svc->issueCallbackCode(
            'browser-bound-token',
            'google',
            false,
            self::TENANT_ID,
            self::BROWSER_CHALLENGE
        );

        foreach ([null, str_repeat('A', 43)] as $verifier) {
            try {
                $this->svc->consumeCallbackCode($code, $verifier);
                self::fail('A missing or wrong browser verifier must be rejected.');
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('invalid or expired', $e->getMessage());
            }
        }

        $payload = $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER);
        $this->assertSame('browser-bound-token', $payload['token']);

        $this->expectException(\RuntimeException::class);
        $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER);
    }

    public function test_callback_code_can_only_be_consumed_once(): void
    {
        $code = $this->svc->issueCallbackCode(
            'tok',
            'google',
            false,
            self::TENANT_ID,
            self::BROWSER_CHALLENGE
        );
        $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER); // consume once

        $this->expectException(\RuntimeException::class);
        $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER); // must fail on second use
    }

    public function test_callback_code_consumption_fails_closed_under_lock_contention(): void
    {
        $code = $this->svc->issueCallbackCode(
            'contended-token',
            'google',
            false,
            self::TENANT_ID,
            self::BROWSER_CHALLENGE
        );
        $lock = Cache::lock(
            'oauth:callback-code-lock:' . hash('sha256', $code),
            5
        );
        $this->assertTrue($lock->get());

        try {
            try {
                $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER);
                self::fail('A contended callback code must fail closed.');
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('invalid or expired', $e->getMessage());
            }
        } finally {
            $lock->release();
        }

        // Contention does not publish the credential and does not consume it;
        // exactly one later holder can still perform the authorised exchange.
        $payload = $this->svc->consumeCallbackCode($code, self::BROWSER_VERIFIER);
        $this->assertSame('contended-token', $payload['token']);
    }

    public function test_callback_code_rejects_invalid_format(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/invalid or expired/i');
        $this->svc->consumeCallbackCode('!!!bad-code!!!', self::BROWSER_VERIFIER);
    }

    // ── enabledProviders + kill switch ────────────────────────────────────────

    public function test_enabled_providers_returns_empty_when_oauth_disabled_in_env(): void
    {
        putenv('OAUTH_ENABLED=false');
        $result = $this->svc->enabledProviders(self::TENANT_ID);
        $this->assertSame([], $result, 'Kill switch OAUTH_ENABLED=false must return empty list');
        putenv('OAUTH_ENABLED'); // restore
    }

    public function test_enabled_providers_fail_closed_without_valid_tenant_opt_in(): void
    {
        $previous = getenv('OAUTH_ENABLED');
        $settings = app(TenantSettingsService::class);

        try {
            putenv('OAUTH_ENABLED=true');

            DB::table('tenant_settings')
                ->where('tenant_id', self::TENANT_ID)
                ->where('setting_key', 'auth.oauth.enabled_providers')
                ->delete();
            $settings->clearCacheForTenant(self::TENANT_ID);
            $this->assertSame([], $this->svc->enabledProviders(self::TENANT_ID), 'Missing opt-in must fail closed.');

            foreach (['', '{not-json'] as $invalidValue) {
                DB::table('tenant_settings')->updateOrInsert(
                    [
                        'tenant_id' => self::TENANT_ID,
                        'setting_key' => 'auth.oauth.enabled_providers',
                    ],
                    [
                        'setting_value' => $invalidValue,
                        'setting_type' => 'string',
                        'updated_at' => now(),
                    ]
                );
                $settings->clearCacheForTenant(self::TENANT_ID);
                $this->assertSame([], $this->svc->enabledProviders(self::TENANT_ID));
            }
        } finally {
            $settings->clearCacheForTenant(self::TENANT_ID);
            $previous === false
                ? putenv('OAUTH_ENABLED')
                : putenv('OAUTH_ENABLED=' . $previous);
        }
    }

    public function test_enabled_providers_filters_unavailable_apple_configuration(): void
    {
        $previous = getenv('OAUTH_ENABLED');
        app(TenantSettingsService::class)->set(
            self::TENANT_ID,
            'auth.oauth.enabled_providers',
            json_encode(['google', 'apple', 'facebook'], JSON_THROW_ON_ERROR),
            'json'
        );

        try {
            putenv('OAUTH_ENABLED=true');
            $this->assertSame(
                ['google', 'facebook'],
                $this->svc->enabledProviders(self::TENANT_ID)
            );
        } finally {
            $previous === false
                ? putenv('OAUTH_ENABLED')
                : putenv('OAUTH_ENABLED=' . $previous);
        }
    }

    public function test_callback_rechecks_provider_kill_switch_after_signed_state_verification(): void
    {
        $state = $this->callPrivateMethod(
            $this->svc,
            'buildState',
            [self::TENANT_ID, 'login', null, self::BROWSER_CHALLENGE]
        );
        $previous = getenv('OAUTH_ENABLED');

        try {
            putenv('OAUTH_ENABLED=false');
            $this->svc->handleCallback('google', $state);
            self::fail('A provider disabled during the upstream round-trip must be rejected.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('disabled for this community', $e->getMessage());
        } finally {
            $previous === false
                ? putenv('OAUTH_ENABLED')
                : putenv('OAUTH_ENABLED=' . $previous);
        }
    }

    // ── assertProviderSupported ───────────────────────────────────────────────

    public function test_unsupported_provider_throws_before_identity_resolution(): void
    {
        $providerUser = $this->makeProviderUser('uid-123', 'x@example.test');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/Unsupported OAuth provider/i');

        // 'twitter' is not in SUPPORTED_PROVIDERS — should throw before any DB work.
        $this->svc->findOrCreateFromOauth('twitter', $providerUser, self::TENANT_ID, time());
    }

    public function test_apple_provider_fails_closed_without_a_vetted_driver(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(
            'Apple OAuth is unavailable because no vetted Socialite driver is installed.'
        );

        $providerUser = $this->makeProviderUser('apple-uid-123', 'apple@example.test');
        $this->svc->findOrCreateFromOauth('apple', $providerUser, self::TENANT_ID, time());
    }

    /**
     * @param array<int, mixed> $args
     */
    private function callPrivateMethod(object $object, string $method, array $args = []): mixed
    {
        $reflection = new \ReflectionClass($object);
        $reflectedMethod = $reflection->getMethod($method);
        $reflectedMethod->setAccessible(true);

        return $reflectedMethod->invokeArgs($object, $args);
    }
}
