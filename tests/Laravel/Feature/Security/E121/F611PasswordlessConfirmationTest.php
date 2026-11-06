<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E121;

use App\Core\TenantContext;
use App\Http\Middleware\RequireRecentSecondFactor;
use App\Models\User;
use App\Services\Auth\SocialAuthService;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Laravel\TestCase;

/**
 * F-611 (E-121) — a member who joined with Google has no password, and the
 * route meant for them ("a recent Google or SSO sign-in counts as confirming
 * it's you", WebAuthnController::confirmSecurityAction) could never succeed:
 * it looked for Sanctum token names (oauth-/sso-/oidc-) that nothing creates.
 * The staff step-up check still listed that route's method, federated_login,
 * as a second factor.
 *
 * Owner decision (6 Nov 2026): such a member adds a password first ("Set a
 * password", the existing reset email). So the dead route is removed, a Google
 * sign-in alone keeps confirming nothing, and the status call tells the website
 * which members have no password so it can offer the way out.
 */
class F611PasswordlessConfirmationTest extends TestCase
{
    use DatabaseTransactions;

    private const BROWSER_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    private function googleOnlyMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        // Exactly what a Google sign-up stores: a random value in `password`,
        // nothing in `password_hash` (SocialAuthService::findOrCreateFromOauth).
        DB::table('users')->where('id', $user->id)->update([
            'password_hash' => null,
            'password' => password_hash(bin2hex(random_bytes(24)), PASSWORD_BCRYPT),
        ]);

        return $user->fresh();
    }

    /** A real session issued by the Google sign-in path, not a stand-in. */
    private function signInWithGoogle(User $user): string
    {
        $social = app(SocialAuthService::class);
        $issuance = $social->issueLoginCallbackCode(
            (int) $user->id,
            $this->testTenantId,
            'google',
            false,
            time(),
            self::BROWSER_CHALLENGE
        );
        $this->assertSame('issued', $issuance['status']);

        $payload = $social->consumeCallbackCode((string) $issuance['callback_code'], self::BROWSER_VERIFIER);
        $this->assertNotEmpty($payload['token']);

        return (string) $payload['token'];
    }

    public function test_a_federated_confirmation_never_passes_the_staff_step_up(): void
    {
        $staff = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $tokens = app(TokenService::class);

        $federated = $tokens->generateSecurityConfirmationToken((int) $staff->id, $this->testTenantId, 'federated_login');
        $this->assertFalse(
            RequireRecentSecondFactor::passes($this->stepUpRequest((int) $staff->id, $federated)),
            'A sign-in through a provider is not a second factor.'
        );

        // Control: the check itself still works for a real second factor.
        $totp = $tokens->generateSecurityConfirmationToken((int) $staff->id, $this->testTenantId, 'totp');
        $this->assertTrue(RequireRecentSecondFactor::passes($this->stepUpRequest((int) $staff->id, $totp)));
    }

    public function test_a_fresh_google_sign_in_alone_confirms_nothing(): void
    {
        $member = $this->googleOnlyMember();
        $token = $this->signInWithGoogle($member);

        $response = $this->apiPost('/webauthn/security-confirm', [], ['Authorization' => 'Bearer ' . $token]);

        $this->assertContains($response->getStatusCode(), [400, 401, 403, 422]);
        $this->assertNull($response->json('data.security_confirmation_token'));
    }

    public function test_status_tells_the_website_when_a_member_has_no_password(): void
    {
        $member = $this->googleOnlyMember();
        $token = $this->signInWithGoogle($member);

        $response = $this->apiGet('/webauthn/status', ['Authorization' => 'Bearer ' . $token]);

        $response->assertOk();
        $this->assertFalse($response->json('data.confirmation_methods.password'));
        $this->assertFalse($response->json('data.confirmation_methods.totp'));
    }

    public function test_status_reports_a_password_once_the_member_has_one(): void
    {
        $member = $this->googleOnlyMember();
        DB::table('users')->where('id', $member->id)->update(['password_hash' => Hash::make('a-long-new-password-2026')]);
        $token = $this->signInWithGoogle($member);

        $response = $this->apiGet('/webauthn/status', ['Authorization' => 'Bearer ' . $token]);

        $response->assertOk();
        $this->assertTrue($response->json('data.confirmation_methods.password'));
    }

    private function stepUpRequest(int $userId, string $confirmation): Request
    {
        $request = Request::create('/api/v2/admin/anything', 'POST');
        $request->attributes->set('verified_auth_claims', ['user_id' => $userId]);
        $request->headers->set('X-Security-Confirmation', $confirmation);

        return $request;
    }
}
