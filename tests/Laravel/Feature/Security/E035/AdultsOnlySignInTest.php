<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AuthenticationConfigurationService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Support\Authorization\MinimumAge;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-160 — the platform is for adults aged 18 and over.
 *
 * An account whose recorded date of birth makes the member under 18 cannot
 * sign in by any door, and a session it already holds is refused on every
 * authenticated request. An account with no date of birth is an adult account.
 */
class AdultsOnlySignInTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        AuthenticationConfigurationService::clearCache($this->testTenantId);
        parent::tearDown();
    }

    private function account(?string $dob, array $overrides = []): array
    {
        $email = 'e035-age-' . uniqid() . '@example.test';
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'email' => $email,
            'password_hash' => Hash::make('correct-password-123'),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ], $overrides));
        DB::table('users')->where('id', $user->id)->update(['date_of_birth' => $dob]);
        TenantContext::setById($this->testTenantId);

        return [$user->fresh(), $email];
    }

    private function under18(): string
    {
        return now()->subYears(17)->addDay()->toDateString();
    }

    private function assertRefusal(\Illuminate\Testing\TestResponse $response): void
    {
        $response->assertStatus(403);
        $this->assertSame(MinimumAge::ACCOUNT_ERROR_CODE, $response->json('errors.0.code'));
        $message = (string) $response->json('errors.0.message');
        $this->assertNotSame('api.account_under_minimum_age', $message, 'refusal message must be translated');
        $this->assertStringContainsString('18', $message);
    }

    public function test_password_sign_in_is_refused_for_an_under_18_account(): void
    {
        [, $email] = $this->account($this->under18());

        $response = $this->apiPost('/auth/login', ['email' => $email, 'password' => 'correct-password-123']);

        $this->assertRefusal($response);
        $this->assertNull($response->json('access_token'));
        $this->assertTrue((bool) $response->json('account_under_minimum_age'));
    }

    public function test_adults_and_accounts_without_a_date_of_birth_still_sign_in(): void
    {
        [, $adultEmail] = $this->account(now()->subYears(18)->toDateString());
        $this->apiPost('/auth/login', ['email' => $adultEmail, 'password' => 'correct-password-123'])
            ->assertStatus(200);

        [, $unknownEmail] = $this->account(null);
        $this->apiPost('/auth/login', ['email' => $unknownEmail, 'password' => 'correct-password-123'])
            ->assertStatus(200);
    }

    public function test_refresh_token_is_refused_for_an_under_18_account(): void
    {
        [$user] = $this->account($this->under18());
        $refresh = app(TokenService::class)->generateRefreshToken((int) $user->id, $this->testTenantId);

        $this->assertRefusal($this->apiPost('/auth/refresh-token', ['refresh_token' => $refresh]));
    }

    public function test_an_existing_session_is_refused_on_authenticated_requests(): void
    {
        [$user] = $this->account($this->under18());

        // Stateful guard (the branch Sanctum::actingAs exercises).
        Sanctum::actingAs($user);
        $this->assertRefusal($this->apiGet('/v2/users/me'));
    }

    public function test_an_existing_bearer_access_token_is_refused(): void
    {
        [$user] = $this->account($this->under18());
        $token = app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId);

        $this->assertRefusal($this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $token]));
    }

    /**
     * Passkey, TOTP / 2FA completion, social sign-in, session restore and
     * impersonation all route through checkLoginGatesForUser(); this pins the
     * gate itself, including for administrators and for callers whose row does
     * not carry the date_of_birth column.
     */
    public function test_the_shared_login_gate_refuses_under_18_accounts_for_every_door(): void
    {
        [$minor] = $this->account($this->under18());
        [$admin] = $this->account($this->under18(), ['role' => 'admin']);
        [$adult] = $this->account(now()->subYears(40)->toDateString());
        $gates = app(TenantSettingsService::class);

        $full = (array) DB::table('users')->where('id', $minor->id)->first();
        $this->assertSame(MinimumAge::ACCOUNT_ERROR_CODE, $gates->checkLoginGatesForUser($full)['code'] ?? null);

        $adminRow = (array) DB::table('users')->where('id', $admin->id)->first();
        $this->assertSame(MinimumAge::ACCOUNT_ERROR_CODE, $gates->checkLoginGatesForUser($adminRow)['code'] ?? null);

        // A narrow SELECT without date_of_birth must not skip the check.
        $narrow = (array) DB::table('users')->where('id', $minor->id)
            ->first(['id', 'tenant_id', 'role', 'status', 'is_approved', 'email_verified_at']);
        $this->assertSame(MinimumAge::ACCOUNT_ERROR_CODE, $gates->checkLoginGatesForUser($narrow)['code'] ?? null);

        $adultRow = (array) DB::table('users')->where('id', $adult->id)->first();
        $this->assertNull($gates->checkLoginGatesForUser($adultRow));
    }
}
