<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Laravel\TestCase;

/**
 * Two-factor can only be set up on an account that is active.
 *
 * New members are offered two-factor in the welcome wizard, after approval,
 * precisely because an account waiting for approval (or one that was
 * suspended) must not be able to store an authenticator secret. This pins
 * that refusal, which had no test of its own (6 Nov 2026).
 */
class InactiveAccountEnrolmentTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public static function inactiveStatuses(): array
    {
        return [['pending'], ['suspended']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('inactiveStatuses')]
    public function test_an_inactive_account_cannot_start_two_factor_setup(string $status): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => $status,
            'is_approved' => $status !== 'pending',
            'email_verified_at' => now(),
            'password_hash' => Hash::make('test-password'),
        ]);
        $headers = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken($user->id, $user->tenant_id)];

        $response = $this->apiPost('/v2/auth/2fa/setup', ['security_confirmation_token' => 'irrelevant'], $headers);

        $this->assertContains($response->getStatusCode(), [401, 403]);
        $this->assertNull($response->json('data.secret'));
        $this->assertFalse(
            DB::table('user_totp_settings')->where('user_id', $user->id)->whereNotNull('totp_secret_encrypted')->exists(),
            'No authenticator secret may be stored for an inactive account.'
        );
    }
}
