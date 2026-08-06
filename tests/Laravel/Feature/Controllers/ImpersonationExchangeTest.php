<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Feature tests for the impersonation session exchange.
 *
 * This is the coverage that was missing while impersonation was broken. The old
 * tests asserted only that the WRONG people were refused a proof; nothing
 * asserted that the proof could actually sign anybody in — and it could not,
 * because no endpoint accepted it. Every test here therefore ends by proving
 * what the resulting credential does when presented to a real endpoint.
 */
class ImpersonationExchangeTest extends TestCase
{
    use DatabaseTransactions;

    private function tokenService(): TokenService
    {
        return app(TokenService::class);
    }

    /** Present a bearer token to an authenticated endpoint. */
    private function meAs(string $token): \Illuminate\Testing\TestResponse
    {
        return $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $token]);
    }

    // =====================================================================
    // The core defect: the proof itself is not a credential
    // =====================================================================

    public function test_the_raw_impersonation_proof_cannot_authenticate_anything(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        // Regression pin. Using the proof directly as a bearer token is what the
        // frontend used to do, and it is why impersonation silently did nothing.
        $this->meAs($proof)->assertStatus(401);
    }

    public function test_exchanged_token_authenticates_as_the_target_member(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        $exchange = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof]);

        $exchange->assertStatus(200);
        $exchange->assertJsonPath('success', true);
        $exchange->assertJsonPath('impersonation.user_id', $member->id);
        $exchange->assertJsonPath('impersonation.admin_id', $admin->id);

        $accessToken = $exchange->json('access_token');
        $this->assertIsString($accessToken);
        $this->assertNotSame($proof, $accessToken);

        // The whole point: this token signs in AS THE MEMBER.
        $me = $this->meAs($accessToken);
        $me->assertStatus(200);
        $this->assertSame($member->id, (int) $me->json('data.id'));
    }

    public function test_exchange_issues_no_refresh_token(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        $exchange = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof]);

        // An impersonated session must not mint a multi-day refresh family
        // against someone else's account.
        $exchange->assertStatus(200);
        $this->assertNull($exchange->json('refresh_token'));
    }

    public function test_exchanged_token_carries_the_impersonator_in_its_claims(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        $accessToken = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])
            ->json('access_token');

        $payload = $this->tokenService()->validateToken($accessToken);

        $this->assertIsArray($payload);
        $this->assertSame($admin->id, (int) $payload['impersonated_by']);
        $this->assertNotEmpty($payload['impersonation_jti']);
    }

    // =====================================================================
    // Refusals
    // =====================================================================

    public function test_proof_is_single_use(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])->assertStatus(200);
        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])->assertStatus(401);
    }

    public function test_garbage_and_missing_proofs_are_refused(): void
    {
        $this->apiPost('/v2/auth/impersonate/exchange', [])->assertStatus(422);
        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => 'not-a-jwt'])->assertStatus(401);
    }

    public function test_an_ordinary_access_token_cannot_be_passed_off_as_a_proof(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $accessToken = $this->tokenService()->generateToken($member->id, $this->testTenantId);

        // Type confusion in the other direction: a normal session token must not
        // be spendable at the exchange to launder itself into an impersonation.
        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $accessToken])
            ->assertStatus(401);
    }

    public function test_proof_for_another_tenant_is_refused(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $otherTenantId = $this->testTenantId + 1000;
        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $otherTenantId,
            $admin->id
        );

        // Signature is valid; the community is not. Spending it here must fail.
        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])
            ->assertStatus(403);
    }

    public function test_target_promoted_to_platform_admin_after_issuance_is_refused(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        // The proof lives five minutes. A promotion inside that window must not
        // become a route into a platform-administrator session.
        DB::table('users')->where('id', $member->id)->update(['is_super_admin' => 1]);

        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])
            ->assertStatus(403);
    }

    public function test_suspended_target_is_refused(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        DB::table('users')->where('id', $member->id)->update(['status' => 'suspended']);

        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])
            ->assertStatus(403);
    }

    public function test_actor_who_lost_admin_rights_after_issuance_is_refused(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );

        DB::table('users')->where('id', $admin->id)->update([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ]);

        $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])
            ->assertStatus(403);
    }

    // =====================================================================
    // Ending the session
    // =====================================================================

    public function test_ending_impersonation_revokes_only_that_session(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $proof = $this->tokenService()->generateImpersonationToken(
            $member->id,
            $this->testTenantId,
            $admin->id
        );
        $impersonated = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])
            ->json('access_token');

        // The member's own session, issued independently.
        $memberOwnToken = $this->tokenService()->generateToken($member->id, $this->testTenantId);

        $this->meAs($impersonated)->assertStatus(200);

        $this->apiPost('/v2/auth/impersonate/end', [], ['Authorization' => 'Bearer ' . $impersonated])
            ->assertStatus(200);

        // Impersonated session is dead...
        $this->meAs($impersonated)->assertStatus(401);
        // ...and the member is still signed in on their own device.
        $this->meAs($memberOwnToken)->assertStatus(200);
    }

    public function test_ending_without_an_impersonated_session_is_refused(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $ordinary = $this->tokenService()->generateToken($member->id, $this->testTenantId);

        // A normal session has no impersonation jti to revoke.
        $this->apiPost('/v2/auth/impersonate/end', [], ['Authorization' => 'Bearer ' . $ordinary])
            ->assertStatus(422);
    }
}
