<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-308 (E-062 F-3): three doors lead to irreversible erasure. `DELETE
 * /v2/users/me` and `POST /gdpr/delete-account` require and verify the
 * password; `POST /v2/users/me/gdpr-request {type: erasure}` required
 * nothing but the bearer token and revoked no sessions. It must now match
 * `POST /gdpr/delete-account`: password required and verified, every session
 * revoked once the request is recorded.
 */
class F308ErasureRequestRequiresPasswordTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        // UserFactory sets password_hash = bcrypt('password').
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function erasureRows(int $userId): int
    {
        return DB::table('gdpr_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('request_type', 'erasure')
            ->count();
    }

    private function sessionsRevoked(int $userId): bool
    {
        return DB::table('revoked_tokens')
            ->where('user_id', $userId)
            ->where('jti', 'global_revoke_' . $userId)
            ->exists();
    }

    public function test_an_erasure_request_without_a_password_is_refused(): void
    {
        $user = $this->member();
        Sanctum::actingAs($user, ['*']);

        $this->apiPost('/v2/users/me/gdpr-request', ['type' => 'erasure'])->assertStatus(400);

        $this->assertSame(0, $this->erasureRows((int) $user->id));
        $this->assertFalse($this->sessionsRevoked((int) $user->id));
    }

    public function test_an_erasure_request_with_the_wrong_password_is_refused(): void
    {
        $user = $this->member();
        Sanctum::actingAs($user, ['*']);

        $this->apiPost('/v2/users/me/gdpr-request', ['type' => 'erasure', 'password' => 'not-the-password'])
            ->assertStatus(403);

        $this->assertSame(0, $this->erasureRows((int) $user->id));
        $this->assertFalse($this->sessionsRevoked((int) $user->id));
    }

    public function test_control_the_right_password_records_the_request_and_signs_every_session_out(): void
    {
        $user = $this->member();
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/v2/users/me/gdpr-request', ['type' => 'erasure', 'password' => 'password']);
        $response->assertStatus(201);
        $response->assertJsonPath('data.logout_required', true);

        $this->assertSame(1, $this->erasureRows((int) $user->id));
        $this->assertTrue($this->sessionsRevoked((int) $user->id), 'every session is revoked, as on POST /gdpr/delete-account');
    }

    public function test_control_other_request_types_still_need_no_password(): void
    {
        $user = $this->member();
        Sanctum::actingAs($user, ['*']);

        $this->apiPost('/v2/users/me/gdpr-request', ['type' => 'rectification'])->assertStatus(201);

        $this->assertFalse($this->sessionsRevoked((int) $user->id), 'a non-erasure request does not sign the member out');
    }
}
