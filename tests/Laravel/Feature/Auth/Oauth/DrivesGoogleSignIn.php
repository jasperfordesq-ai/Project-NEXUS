<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth\Oauth;

use App\Services\TenantSettingsService;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;

/**
 * Drives a Google sign-in through the real redirect, callback and exchange
 * endpoints (E-121). Socialite's own test double stands in for Google, so
 * nothing leaves the machine; everything after Google is the real code.
 *
 * Call enableGoogleSignIn() in setUp() and restoreGoogleSignIn() in tearDown().
 */
trait DrivesGoogleSignIn
{
    protected const GOOGLE_BROWSER_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    protected const GOOGLE_BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    /** @var array{env: string|false, env_array: mixed, server: mixed} */
    private array $previousOauthEnabled;

    protected function enableGoogleSignIn(): void
    {
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
    }

    protected function restoreGoogleSignIn(): void
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
    }

    protected function googleUser(string $id, string $email, string $name = 'Gail Google'): SocialiteUser
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

    /** Start a sign-in (or a ticked sign-up) and come back from Google as $googleUser. */
    protected function signInWithGoogle(SocialiteUser $googleUser, string $intent = 'login'): TestResponse
    {
        Socialite::fake('google', $googleUser);

        $query = ['intent' => $intent, 'browser_challenge' => self::GOOGLE_BROWSER_CHALLENGE];
        if ($intent === 'register') {
            $query['terms_accepted'] = '1';
        }
        $redirect = $this->apiGet('/v2/auth/oauth/google/redirect?' . http_build_query($query));
        $redirect->assertOk();

        return $this->get('/api/v2/auth/oauth/google/callback?' . http_build_query([
            'state' => (string) $redirect->json('state'),
            'code' => 'provider-code',
        ]), $this->withTenantHeader());
    }

    /** The one-time code the callback hands to the website, or '' if none. */
    protected function callbackCodeFrom(TestResponse $callback): string
    {
        parse_str((string) parse_url((string) $callback->headers->get('Location'), PHP_URL_QUERY), $query);

        return isset($query['code']) && is_string($query['code']) ? $query['code'] : '';
    }

    /** What the website's exchange step receives for that code. */
    protected function exchangeGoogleCode(string $code, string $verifier = self::GOOGLE_BROWSER_VERIFIER): TestResponse
    {
        return $this->apiPost('/v2/auth/oauth/exchange', ['code' => $code, 'browser_verifier' => $verifier]);
    }

    protected function seedRegistrationMode(string $mode): void
    {
        $generalMode = $mode === 'closed' ? 'closed' : 'open';
        $policyMode = $mode === 'closed' ? 'open' : $mode;
        foreach (['general.registration_mode', 'registration_mode'] as $settingKey) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $settingKey],
                ['setting_value' => $generalMode, 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => $policyMode,
                'verification_provider' => null,
                'verification_level' => 'none',
                'post_verification' => $policyMode === 'open_with_approval' ? 'admin_approval' : 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 0,
                'provider_config' => null,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }
}
