<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth\Oauth;

use App\Models\User;
use App\Services\Auth\SocialAuthService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use Tests\Laravel\TestCase;

/**
 * E-121 — a Google sign-up carries the member's own tick in the box every
 * other sign-up has: "I agree to the Terms and Privacy Policy, and I am 18
 * years of age or older".
 *
 * Before this, a Google sign-up showed no box at all, recorded no acceptance
 * and made no age declaration, and the website then ran the whole welcome
 * wizard before the terms appeared. The tick now travels inside the signed
 * sign-in state, an account can only be created when it is there, and a
 * brand-new account records the acceptance as 'registration' — genuine
 * consent, because the member ticked the box.
 *
 * The provider round trip is driven through the real redirect and callback
 * endpoints with Socialite's own test double; nothing contacts Google.
 */
class RegisterTermsConsentTest extends TestCase
{
    use DatabaseTransactions;

    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    /** @var array{env: string|false, env_array: mixed, server: mixed} */
    private array $previousOauthEnabled;

    protected function setUp(): void
    {
        parent::setUp();

        // OAuth is off unless the environment switch AND the community's
        // provider list both allow it (SocialAuthService::enabledProviders).
        $this->previousOauthEnabled = [
            'env' => getenv('OAUTH_ENABLED'),
            'env_array' => $_ENV['OAUTH_ENABLED'] ?? null,
            'server' => $_SERVER['OAUTH_ENABLED'] ?? null,
        ];
        putenv('OAUTH_ENABLED=true');
        $_ENV['OAUTH_ENABLED'] = 'true';
        $_SERVER['OAUTH_ENABLED'] = 'true';

        app(TenantSettingsService::class)->set(
            $this->testTenantId,
            'auth.oauth.enabled_providers',
            json_encode(['google'], JSON_THROW_ON_ERROR),
            'json'
        );
        config(['services.google' => [
            'client_id' => 'test-client-id',
            'client_secret' => 'test-client-secret',
            'redirect' => 'https://api.example.test/api/v2/auth/oauth/google/callback',
        ]]);

        $this->seedOpenRegistration();
    }

    protected function tearDown(): void
    {
        $previous = $this->previousOauthEnabled;
        $previous['env'] === false ? putenv('OAUTH_ENABLED') : putenv('OAUTH_ENABLED=' . $previous['env']);
        if ($previous['env_array'] === null) {
            unset($_ENV['OAUTH_ENABLED']);
        } else {
            $_ENV['OAUTH_ENABLED'] = $previous['env_array'];
        }
        if ($previous['server'] === null) {
            unset($_SERVER['OAUTH_ENABLED']);
        } else {
            $_SERVER['OAUTH_ENABLED'] = $previous['server'];
        }

        parent::tearDown();
    }

    // ── the redirect: no tick, no sign-up ────────────────────────────────────

    public function test_a_google_sign_up_without_the_tick_is_refused(): void
    {
        $response = $this->apiGet('/v2/auth/oauth/google/redirect?' . http_build_query([
            'intent' => 'register',
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ]));

        $response->assertStatus(422);
        $response->assertJsonPath('success', false);
        $response->assertJsonPath('error', 'terms_required');
    }

    public function test_an_unticked_value_is_refused_too(): void
    {
        $response = $this->apiGet('/v2/auth/oauth/google/redirect?' . http_build_query([
            'intent' => 'register',
            'terms_accepted' => '0',
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ]));

        $response->assertStatus(422);
        $response->assertJsonPath('error', 'terms_required');
    }

    public function test_the_tick_travels_inside_the_signed_sign_in_state(): void
    {
        $state = $this->startSignUp();

        $context = app(SocialAuthService::class)->stateContext($state);

        $this->assertNotNull($context);
        $this->assertSame('register', $context['intent']);
        $this->assertTrue($context['terms_accepted']);
    }

    public function test_signing_in_needs_no_tick(): void
    {
        Socialite::fake('google');

        $response = $this->apiGet('/v2/auth/oauth/google/redirect?' . http_build_query([
            'intent' => 'login',
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ]));

        $response->assertOk();
        $context = app(SocialAuthService::class)->stateContext((string) $response->json('state'));
        $this->assertNotNull($context);
        $this->assertFalse($context['terms_accepted']);
    }

    // ── the callback: who may be created, and what is recorded ───────────────

    public function test_a_new_google_account_records_the_members_acceptance_as_registration(): void
    {
        $versionId = $this->seedTermsRequiredAtRegistration();
        $email = 'new.google.' . uniqid() . '@gmail.com';
        $state = $this->startSignUp($this->googleUser('g-new-' . uniqid(), $email));

        $response = $this->get('/api/v2/auth/oauth/google/callback?' . http_build_query([
            'state' => $state,
            'code' => 'provider-code',
        ]), $this->withTenantHeader());

        $this->assertStringContainsString('/auth/oauth/callback?code=', (string) $response->headers->get('Location'));
        $userId = (int) DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->value('id');
        $this->assertGreaterThan(0, $userId, 'The ticked Google sign-up must create the account.');

        $acceptance = DB::table('user_legal_acceptances')
            ->where('user_id', $userId)
            ->where('version_id', $versionId)
            ->first();
        $this->assertNotNull($acceptance, 'The tick the member gave must be recorded against the version in force.');
        $this->assertSame('registration', $acceptance->acceptance_method);
    }

    public function test_sign_in_state_without_the_tick_cannot_create_an_account(): void
    {
        // A state issued before this change (valid for an hour) carries no tick.
        $email = 'old.state.' . uniqid() . '@gmail.com';
        Socialite::fake('google', $this->googleUser('g-old-' . uniqid(), $email));
        $state = $this->buildStateWithoutTick('register');

        $response = $this->get('/api/v2/auth/oauth/google/callback?' . http_build_query([
            'state' => $state,
            'code' => 'provider-code',
        ]), $this->withTenantHeader());

        // Handed over as a refusal (E-121): the exchange says there is no account
        // here yet and issues no session.
        $exchange = $this->apiPost('/v2/auth/oauth/exchange', [
            'code' => substr($this->callbackCodeParam((string) $response->headers->get('Location')), strlen('code=')),
            'browser_verifier' => 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        ]);
        $exchange->assertStatus(403);
        $exchange->assertJsonPath('reason', 'no_account');
        $this->assertNull($exchange->json('token'));
        $this->assertFalse(
            DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->exists(),
            'Without the member\'s tick, no account may be created.'
        );
    }

    public function test_a_ticked_sign_up_that_signs_into_an_existing_account_records_nothing(): void
    {
        $this->seedTermsRequiredAtRegistration();
        $email = 'existing.' . uniqid() . '@gmail.com';
        $existing = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'email_verified_at' => now(),
            'status' => 'active',
            'is_approved' => true,
        ]);
        $state = $this->startSignUp($this->googleUser('g-existing-' . uniqid(), $email));

        $this->get('/api/v2/auth/oauth/google/callback?' . http_build_query([
            'state' => $state,
            'code' => 'provider-code',
        ]), $this->withTenantHeader());

        $this->assertSame(
            0,
            DB::table('user_legal_acceptances')
                ->where('user_id', $existing->id)
                ->where('acceptance_method', 'registration')
                ->count(),
            'Only a newly created account is a sign-up; an existing member\'s acceptance is not rewritten.'
        );
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private function startSignUp(?SocialiteUser $googleUser = null): string
    {
        Socialite::fake('google', $googleUser);

        $response = $this->apiGet('/v2/auth/oauth/google/redirect?' . http_build_query([
            'intent' => 'register',
            'terms_accepted' => '1',
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ]));
        $response->assertOk();

        return (string) $response->json('state');
    }

    private function buildStateWithoutTick(string $intent): string
    {
        $method = new \ReflectionMethod(SocialAuthService::class, 'buildState');
        $method->setAccessible(true);

        return (string) $method->invoke(
            app(SocialAuthService::class),
            $this->testTenantId,
            $intent,
            null,
            self::BROWSER_CHALLENGE
        );
    }

    private function callbackCodeParam(?string $location): string
    {
        parse_str((string) parse_url((string) $location, PHP_URL_QUERY), $query);

        return isset($query['code']) ? 'code=' . $query['code'] : '';
    }

    private function googleUser(string $id, string $email, string $name = 'Gail Google'): SocialiteUser
    {
        return (new SocialiteUser())
            ->setRaw(['sub' => $id, 'email' => $email, 'email_verified' => true, 'name' => $name])
            ->map([
                'id' => $id,
                'name' => $name,
                'email' => $email,
                'avatar' => 'https://lh3.googleusercontent.com/a/example-photo',
            ]);
    }

    private function seedOpenRegistration(): void
    {
        foreach (['general.registration_mode', 'registration_mode'] as $settingKey) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $settingKey],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'open',
                'verification_provider' => null,
                'verification_level' => 'none',
                'post_verification' => 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 0,
                'provider_config' => null,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function seedTermsRequiredAtRegistration(): int
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'Terms',
            'slug' => 'terms-' . uniqid(),
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'registration',
            'notify_on_update' => 0,
            'is_active' => 1,
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '3.1',
            'content' => 'The terms a Google member agreed to by ticking the box.',
            'is_current' => 1,
            'is_draft' => 0,
            'effective_date' => now()->toDateString(),
            'created_by' => $admin->id,
            'published_by' => $admin->id,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('legal_documents')->where('id', $documentId)->update(['current_version_id' => $versionId]);

        return $versionId;
    }
}
