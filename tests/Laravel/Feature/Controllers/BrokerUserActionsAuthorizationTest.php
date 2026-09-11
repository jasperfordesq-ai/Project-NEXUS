<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Authorization contract for the member-management endpoints the broker panel
 * shares with the admin panel.
 *
 * The broker panel gained parity with the admin Users area (bulk approve/
 * suspend, 2FA reset, verification/password emails, balance adjustment, safe
 * profile edits, consent read). This test pins the security boundary: brokers
 * MUST be able to do the operational actions but MUST NOT be able to escalate
 * privileges, change identities, ban, delete, or create users — those stay
 * admin-only. See routes/api.php (broker-or-admin users group) and
 * AdminUsersController@update's field guard.
 */
class BrokerUserActionsAuthorizationTest extends TestCase
{
    use DatabaseTransactions;

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create($attrs);
    }

    // ================================================================
    // Brokers CAN — operational member management
    // ================================================================

    public function test_broker_can_edit_safe_profile_fields(): void
    {
        $target = $this->member(['first_name' => 'Old']);
        Sanctum::actingAs($this->broker());

        $response = $this->apiPut("/v2/admin/users/{$target->id}", [
            'first_name' => 'NewName',
            'phone' => '+1 555 123 4567',
            'bio' => 'Updated by broker',
        ]);

        $response->assertStatus(200);
    }

    public function test_broker_can_bulk_approve_pending_members(): void
    {
        $pending = $this->member(['status' => 'pending', 'is_approved' => 0]);
        Sanctum::actingAs($this->broker());

        $response = $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [$pending->id]]);

        $this->assertNotSame(403, $response->getStatusCode(), 'Broker must be allowed to bulk-approve.');
    }

    public function test_broker_can_bulk_suspend_members(): void
    {
        $active = $this->member(['status' => 'active', 'is_approved' => 1]);
        Sanctum::actingAs($this->broker());

        $response = $this->apiPost('/v2/admin/users/bulk-suspend', ['user_ids' => [$active->id]]);

        $this->assertNotSame(403, $response->getStatusCode(), 'Broker must be allowed to bulk-suspend.');
    }

    public function test_broker_can_reset_member_2fa(): void
    {
        $target = $this->member();
        // Resetting someone's second factor needs the actor's OWN second factor,
        // verified within the last five minutes (E-004 property P7). A broker is
        // not forced to enrol, so the shared test fixture does not upgrade them;
        // this broker has enrolled voluntarily and holds the bearer that proves it.
        $broker = $this->broker();
        $headers = ['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $broker->id,
            $broker->tenant_id,
            [...\App\Services\TwoFactorPolicy::claims('totp'), 'role' => 'broker']
        )];

        $response = $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => 'Member locked out; identity checked by phone'], $headers);

        $this->assertNotSame(403, $response->getStatusCode(), 'Broker must be allowed to reset a member 2FA.');
    }

    public function test_broker_can_send_password_reset_email(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        $response = $this->apiPost("/v2/admin/users/{$target->id}/send-password-reset");

        $this->assertNotSame(403, $response->getStatusCode(), 'Broker must be allowed to send a password reset.');
    }

    public function test_broker_can_read_member_consents(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        $response = $this->apiGet("/v2/admin/users/{$target->id}/consents");

        $this->assertNotSame(403, $response->getStatusCode(), 'Broker must be allowed to read member consents.');
    }

    public function test_broker_can_adjust_member_balance(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        // nexus_test balance columns are int — use a whole-hour amount.
        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $target->id,
            'amount' => 5,
            'reason' => 'Manual correction by broker',
        ]);

        $this->assertNotSame(403, $response->getStatusCode(), 'Broker must be allowed to adjust a member balance.');
    }

    public function test_broker_cannot_adjust_their_own_balance(): void
    {
        $broker = $this->broker();
        Sanctum::actingAs($broker);

        // Self-dealing guard — a broker minting themselves time credits is blocked.
        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $broker->id,
            'amount' => 10,
            'reason' => 'Trying to credit myself',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // Brokers CANNOT — privilege escalation / identity / destructive
    // ================================================================

    public function test_broker_cannot_change_member_role(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        $response = $this->apiPut("/v2/admin/users/{$target->id}", ['role' => 'admin']);

        $response->assertStatus(403);
        // The role must be unchanged in the database.
        $this->assertSame('member', $target->fresh()->role);
    }

    public function test_broker_cannot_change_member_status(): void
    {
        $target = $this->member(['status' => 'active', 'is_approved' => 1]);
        Sanctum::actingAs($this->broker());

        $response = $this->apiPut("/v2/admin/users/{$target->id}", ['status' => 'banned']);

        $response->assertStatus(403);
    }

    public function test_broker_cannot_change_member_email(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        $response = $this->apiPut("/v2/admin/users/{$target->id}", ['email' => 'hijacked@example.com']);

        $response->assertStatus(403);
    }

    public function test_broker_cannot_ban_member(): void
    {
        $target = $this->member(['status' => 'active']);
        Sanctum::actingAs($this->broker());

        $response = $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'x']);

        $response->assertStatus(403);
    }

    public function test_broker_cannot_delete_member(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        $response = $this->apiDelete("/v2/admin/users/{$target->id}");

        $response->assertStatus(403);
    }

    public function test_broker_cannot_create_user(): void
    {
        Sanctum::actingAs($this->broker());

        $response = $this->apiPost('/v2/admin/users', [
            'first_name' => 'New', 'last_name' => 'User', 'email' => 'new@example.com',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // Admins retain full access (the guard only restricts brokers)
    // ================================================================

    public function test_admin_can_change_member_role(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->admin());

        $response = $this->apiPut("/v2/admin/users/{$target->id}", ['role' => 'broker']);

        $response->assertStatus(200);
    }

    // ================================================================
    // Regular members are rejected outright
    // ================================================================

    public function test_regular_member_cannot_edit_users(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->member());

        $response = $this->apiPut("/v2/admin/users/{$target->id}", ['first_name' => 'Nope']);

        $response->assertStatus(403);
    }
}
