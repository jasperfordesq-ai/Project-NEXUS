<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * E-055 F-247 — the API accepted an `auth_token` cookie as a bearer credential.
 * No supported client sets that cookie (React, web-uk and the mobile app all send
 * an Authorization header), so the fallback only served session planting: a
 * sibling host able to write a parent-domain cookie could sign a browser in as
 * someone else. Only the Authorization header authenticates.
 */
final class F247CookieIsNotABearerCredentialTest extends TestCase
{
    use DatabaseTransactions;

    private function tokenFor(User $user): string
    {
        return app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => 1,
        ]);
    }

    public function test_auth_token_cookie_alone_does_not_authenticate(): void
    {
        $token = $this->tokenFor($this->member());

        $this->withCredentials()
            ->withUnencryptedCookie('auth_token', $token)
            ->apiGet('/v2/users/me')
            ->assertStatus(401);
    }

    public function test_control_the_same_token_as_a_bearer_header_authenticates(): void
    {
        $user = $this->member();
        $token = $this->tokenFor($user);

        $response = $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $token]);

        $response->assertStatus(200);
        $this->assertSame((int) $user->id, (int) ($response->json('data.id') ?? $response->json('id')));
    }
}
