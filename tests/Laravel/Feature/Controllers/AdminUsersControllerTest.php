<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminUsersController.
 *
 * Covers index, show, store, update, destroy, approve, suspend, ban,
 * reactivate, reset2fa, addBadge, removeBadge, impersonate,
 * setSuperAdmin, recheckBadges, getConsents, setPassword,
 * sendPasswordReset, sendWelcomeEmail.
 */
class AdminUsersControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // INDEX — GET /v2/admin/users
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/users');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/users');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/users');

        $response->assertStatus(401);
    }

    public function test_index_includes_email_activation_timestamp(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $verifiedAt = now()->subDay()->setMicrosecond(0);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'activated-member-' . uniqid('', true) . '@example.test',
            'email_verified_at' => $verifiedAt,
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/users?search=' . urlencode($user->email));

        $response->assertStatus(200);
        $this->assertSame($verifiedAt->toDateTimeString(), $response->json('data.0.email_verified_at'));
    }

    // ================================================================
    // SHOW — GET /v2/admin/users/{id}
    // ================================================================

    public function test_show_returns_200_for_existing_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/users/' . $user->id);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_show_returns_badges_using_current_schema_columns(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('badges')->insertOrIgnore([
            'tenant_id' => $this->testTenantId,
            'badge_key' => 'welcome-helper',
            'name' => 'Welcome Helper',
            'description' => 'Completed the welcome helper path.',
            'icon' => 'fa-award',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_badges')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'badge_key' => 'welcome-helper',
            'name' => 'Legacy Welcome Helper',
            'title' => 'Legacy Welcome Helper',
            'icon' => 'fa-star',
            'awarded_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/users/' . $user->id);

        $response->assertStatus(200);
        $response->assertJsonPath('data.badges.0.slug', 'welcome-helper');
        $response->assertJsonPath('data.badges.0.name', 'Welcome Helper');
        $response->assertJsonPath('data.badges.0.description', 'Completed the welcome helper path.');
        $response->assertJsonPath('data.badges.0.icon', 'fa-award');
    }

    public function test_show_returns_404_for_nonexistent_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/users/99999');

        $response->assertStatus(404);
    }

    public function test_show_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/users/1');

        $response->assertStatus(403);
    }

    // ================================================================
    // APPROVE — POST /v2/admin/users/{id}/approve
    // ================================================================

    public function test_approve_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/users/1/approve');

        $response->assertStatus(403);
    }

    public function test_approve_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/users/1/approve');

        $response->assertStatus(401);
    }

    public function test_approve_lifts_registration_pending_status_so_login_gate_passes(): void
    {
        // Registration on an approval-required tenant leaves status='pending'.
        // The login gate rejects that status before it ever reads is_approved,
        // so approval must flip BOTH — or the member gets the welcome email
        // and stays locked out.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $pending = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending',
            'is_approved' => false,
            'email_verified_at' => now(),
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $pending->id . '/approve');

        $response->assertStatus(200);
        $row = DB::table('users')->where('id', $pending->id)->first(['status', 'is_approved']);
        $this->assertSame('active', strtolower((string) $row->status));
        $this->assertSame(1, (int) $row->is_approved);

        $gate = app(\App\Services\TenantSettingsService::class)->checkLoginGatesForUser(
            (array) DB::table('users')->where('id', $pending->id)->first()
        );
        $this->assertNull($gate, 'approved member must pass the login gates');
    }

    // ================================================================
    // REJECT — POST /v2/admin/users/{id}/reject
    //
    // 🔴 There was no way to reject an applicant at all. A community could
    // approve, suspend, ban or hard-delete, and nothing else — so a declined
    // registration was left pending indefinitely, invisibly and unreasoned, and
    // `users` had nowhere to record why. `users.status` did not even have a
    // 'rejected' value, though RegistrationService already wrote one on a lost
    // invite-code race; under this database's STRICT_TRANS_TABLES that threw,
    // so the invite race 500'd instead of returning its intended 422.
    // ================================================================

    public function test_reject_marks_a_pending_applicant_with_a_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $pending = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending',
            'is_approved' => false,
            'email_verified_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $pending->id . '/reject', [
            'reason' => 'Outside the area this community covers',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.rejected', true);

        $row = DB::table('users')->where('id', $pending->id)
            ->first(['status', 'is_approved', 'rejection_reason', 'rejected_at', 'rejected_by']);

        // The 'rejected' enum value must actually persist — this database runs
        // STRICT_TRANS_TABLES, so before the migration this write threw.
        $this->assertSame('rejected', strtolower((string) $row->status));
        $this->assertSame(0, (int) $row->is_approved);
        // The reason lives on the row, not only in a log.
        $this->assertSame('Outside the area this community covers', $row->rejection_reason);
        $this->assertNotNull($row->rejected_at);
        $this->assertEquals($admin->id, (int) $row->rejected_by);

        // The applicant is told, rather than left wondering.
        $this->assertDatabaseHas('notifications', ['user_id' => $pending->id]);

        // And it is durably audited.
        $audit = DB::table('org_audit_log')
            ->where('action', 'member_registration_rejected')
            ->where('target_user_id', $pending->id)
            ->first();
        $this->assertNotNull($audit, 'Rejecting an applicant must be audited.');
    }

    public function test_reject_requires_a_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $pending = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending', 'is_approved' => false,
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/users/' . $pending->id . '/reject', ['reason' => '   '])
            ->assertStatus(400);

        $this->assertSame(
            'pending',
            strtolower((string) DB::table('users')->where('id', $pending->id)->value('status'))
        );
    }

    public function test_reject_refuses_an_already_approved_member(): void
    {
        // Rejecting is a decision about an APPLICANT. Removing an active member is
        // suspension or a ban — different decisions with different consequences.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/users/' . $member->id . '/reject', ['reason' => 'Changed my mind'])
            ->assertStatus(400);

        $this->assertSame(
            'active',
            strtolower((string) DB::table('users')->where('id', $member->id)->value('status'))
        );
    }

    public function test_reject_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiPost('/v2/admin/users/1/reject', ['reason' => 'Nope'])->assertStatus(403);
    }

    public function test_approving_a_rejected_applicant_clears_the_rejection(): void
    {
        // A community must be able to change its mind without the applicant having
        // to register again.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $rejected = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending',
            'is_approved' => false,
            'email_verified_at' => now(),
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/users/' . $rejected->id . '/reject', ['reason' => 'Rejected in error'])
            ->assertStatus(200);

        $this->apiPost('/v2/admin/users/' . $rejected->id . '/approve')->assertStatus(200);

        $row = DB::table('users')->where('id', $rejected->id)
            ->first(['status', 'is_approved', 'rejection_reason', 'rejected_at', 'rejected_by']);

        $this->assertSame('active', strtolower((string) $row->status));
        $this->assertSame(1, (int) $row->is_approved);
        $this->assertNull($row->rejection_reason, 'Approving must clear the earlier rejection.');
        $this->assertNull($row->rejected_at);
        $this->assertNull($row->rejected_by);
    }

    public function test_approve_repairs_already_approved_account_stuck_on_pending_status(): void
    {
        // Accounts approved by the pre-fix endpoint ended up is_approved=1
        // with status still 'pending' (locked out). Re-approving must repair
        // them without re-granting welcome credits.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $stuck = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $stuck->id . '/approve');

        $response->assertStatus(200);
        $response->assertJsonPath('data.already_approved', true);
        $this->assertSame(
            'active',
            strtolower((string) DB::table('users')->where('id', $stuck->id)->value('status'))
        );
    }

    public function test_bulk_approve_lifts_registration_pending_status(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $pending = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending',
            'is_approved' => false,
            'email_verified_at' => now(),
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/bulk-approve', [
            'user_ids' => [$pending->id],
        ]);

        $response->assertStatus(200);
        $row = DB::table('users')->where('id', $pending->id)->first(['status', 'is_approved']);
        $this->assertSame('active', strtolower((string) $row->status));
        $this->assertSame(1, (int) $row->is_approved);
    }

    // ================================================================
    // SUSPEND — POST /v2/admin/users/{id}/suspend
    // ================================================================

    public function test_suspend_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/users/1/suspend');

        $response->assertStatus(403);
    }

    public function test_bulk_suspend_notifies_each_suspended_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $first = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $second = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/bulk-suspend', [
            'user_ids' => [$first->id, $second->id],
            'reason' => 'Policy review',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.success', 2);
        $this->assertCount(2, $mailer->calls);
        $this->assertEqualsCanonicalizing(
            [$first->email, $second->email],
            array_column($mailer->calls, 'to')
        );
        foreach ($mailer->calls as $call) {
            $this->assertSame('admin_user_status', $call['options']['category']);
            $this->assertSame($this->testTenantId, $call['options']['tenant_id']);
        }
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $first->id)
            ->where('type', 'system')
            ->count());
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $second->id)
            ->where('type', 'system')
            ->count());
    }

    // ================================================================
    // BAN — POST /v2/admin/users/{id}/ban
    // ================================================================

    public function test_ban_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/users/1/ban');

        $response->assertStatus(403);
    }

    public function test_ban_pending_user_is_reported_as_banned(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'is_approved' => false,
            'status' => 'active',
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $user->id . '/ban');

        $response->assertStatus(200);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'status' => 'banned',
        ]);

        $this->apiGet('/v2/admin/users/' . $user->id)
            ->assertStatus(200)
            ->assertJsonPath('data.status', 'banned');
    }

    public function test_update_can_move_active_user_back_to_pending(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'is_approved' => true,
            'status' => 'active',
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/users/' . $user->id, [
            'status' => 'pending',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'pending');
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'status' => 'pending',
            'is_approved' => false,
        ]);
    }

    // ================================================================
    // REACTIVATE — POST /v2/admin/users/{id}/reactivate
    // ================================================================

    public function test_reactivate_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/users/1/reactivate');

        $response->assertStatus(403);
    }

    // ================================================================
    // DELETE — DELETE /v2/admin/users/{id}
    // ================================================================

    public function test_destroy_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiDelete('/v2/admin/users/1');

        $response->assertStatus(403);
    }

    public function test_destroy_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiDelete('/v2/admin/users/1');

        $response->assertStatus(401);
    }

    public function test_destroy_routes_through_gdpr_erasure_not_hard_delete(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'erase-target-' . uniqid() . '@example.test',
            'status' => 'active',
        ]);
        TenantContext::setById($this->testTenantId);

        // A volunteering review the target authored — GDPR erasure deletes it.
        DB::table('vol_reviews')->insert([
            'tenant_id' => $this->testTenantId,
            'reviewer_id' => $target->id,
            'target_type' => 'user',
            'target_id' => $admin->id,
            'rating' => 5,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->apiDelete("/v2/admin/users/{$target->id}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted', true);

        // Anonymised IN PLACE, not hard-deleted: the row survives (so child
        // tables are not orphaned) but is deactivated with PII wiped.
        $row = DB::table('users')->where('id', $target->id)->first();
        $this->assertNotNull($row, 'user row must survive as an anonymised record');
        $this->assertSame('inactive', $row->status);
        $this->assertStringContainsString('@anonymized.local', (string) $row->email);

        // Volunteering PII was actually cleaned (proves the erasure ran, not a raw delete).
        $this->assertSame(0, DB::table('vol_reviews')->where('reviewer_id', $target->id)->where('tenant_id', $this->testTenantId)->count());
    }

    // ================================================================
    // IMPORT TEMPLATE — GET /v2/admin/users/import/template
    // ================================================================

    public function test_import_template_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/users/import/template');

        $response->assertStatus(200);
    }

    public function test_import_template_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/users/import/template');

        $response->assertStatus(403);
    }

    // ================================================================
    // CONSENTS — GET /v2/admin/users/{id}/consents
    // ================================================================

    public function test_consents_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/users/1/consents');

        $response->assertStatus(403);
    }

    // ================================================================
    // RESET 2FA — POST /v2/admin/users/{id}/reset-2fa
    // ================================================================

    public function test_reset_2fa_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/users/1/reset-2fa');

        $response->assertStatus(403);
    }

    public function test_set_password_rolls_back_when_session_revocation_fails(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $oldPassword = 'old-admin-managed-password';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'admin-password-failure-' . uniqid('', true) . '@example.test',
            'password_hash' => Hash::make($oldPassword),
        ]);
        Sanctum::actingAs($admin);

        $tokens = \Mockery::mock(TokenService::class);
        $tokens->shouldReceive('revokeAllTokensForUser')
            ->once()
            ->with((int) $user->id, 'admin_password_change')
            ->andReturn(0);
        app()->instance(TokenService::class, $tokens);

        $this->apiPost('/v2/admin/users/' . $user->id . '/password', [
            'password' => 'new-admin-managed-password',
        ])->assertStatus(500);

        $this->assertTrue(Hash::check(
            $oldPassword,
            (string) DB::table('users')->where('id', $user->id)->value('password_hash')
        ));
    }

    public function test_peer_admin_security_mutations_are_denied_for_legacy_admin_flags(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $oldPassword = 'peer-admin-old-password';
        $peer = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'peer-admin-' . uniqid('', true) . '@example.test',
            'password_hash' => Hash::make($oldPassword),
            'role' => 'member',
            'is_admin' => true,
            'is_approved' => false,
            'status' => 'suspended',
        ]);
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/users/' . $peer->id, [
            'email' => 'attacker-controlled@example.test',
        ])->assertStatus(403);
        $this->apiPost('/v2/admin/users/' . $peer->id . '/password', [
            'password' => 'peer-admin-replacement-password',
        ])->assertStatus(403);
        $this->apiPost('/v2/admin/users/' . $peer->id . '/suspend')->assertStatus(403);
        $this->apiPost('/v2/admin/users/' . $peer->id . '/ban')->assertStatus(403);
        $this->apiPost('/v2/admin/users/' . $peer->id . '/reactivate')->assertStatus(403);
        $this->apiPost('/v2/admin/users/' . $peer->id . '/approve')->assertStatus(403);
        $this->apiPost('/v2/admin/users/' . $peer->id . '/impersonate')->assertStatus(403);
        $this->apiDelete('/v2/admin/users/' . $peer->id)->assertStatus(403);

        $stored = DB::table('users')->where('id', $peer->id)->first();
        $this->assertNotNull($stored);
        $this->assertSame($peer->email, $stored->email);
        $this->assertSame('suspended', $stored->status);
        $this->assertSame(0, (int) $stored->is_approved);
        $this->assertTrue(Hash::check($oldPassword, (string) $stored->password_hash));
    }

    public function test_set_password_invalidates_only_the_targets_tenant_reset_links(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'admin-reset-invalidate-' . uniqid('', true) . '@example.test',
            'password_hash' => Hash::make('old-password-123'),
        ]);
        foreach ([$this->testTenantId, 999] as $tenantId) {
            DB::table('password_resets')->insert([
                'email' => $user->email,
                'tenant_id' => $tenantId,
                'token' => hash('sha256', 'admin-set-password-' . $tenantId),
                'created_at' => now(),
            ]);
        }
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/users/' . $user->id . '/password', [
            'password' => 'new-admin-managed-password',
        ])->assertOk();

        $this->assertSame(0, DB::table('password_resets')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $user->email)
            ->count());
        $this->assertSame(1, DB::table('password_resets')
            ->where('tenant_id', 999)
            ->where('email', $user->email)
            ->count());
        $this->assertTrue(Hash::check(
            'new-admin-managed-password',
            (string) DB::table('users')->where('id', $user->id)->value('password_hash')
        ));
    }

    public function test_send_password_reset_preserves_existing_token_when_email_send_fails(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'admin-reset-preserve-' . uniqid('', true) . '@example.test',
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make('old-password-123'),
        ]);
        $oldToken = hash('sha256', 'previous-admin-reset-token');
        DB::table('password_resets')->insert([
            'email' => $user->email,
            'tenant_id' => $this->testTenantId,
            'token' => $oldToken,
            'created_at' => now(),
        ]);
        app()->instance(EmailDispatchService::class, new AdminUsersFailingEmailDispatchService());
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $user->id . '/send-password-reset');

        $response->assertStatus(500);
        $this->assertSame(1, DB::table('password_resets')
            ->where('email', $user->email)
            ->where('tenant_id', $this->testTenantId)
            ->count());
        $this->assertSame($oldToken, DB::table('password_resets')
            ->where('email', $user->email)
            ->where('tenant_id', $this->testTenantId)
            ->value('token'));
    }

    public function test_send_password_reset_rotates_token_only_after_email_send_acceptance(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'admin-reset-rotate-' . uniqid('', true) . '@example.test',
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make('old-password-123'),
        ]);
        $oldToken = hash('sha256', 'previous-admin-reset-token');
        DB::table('password_resets')->insert([
            'email' => $user->email,
            'tenant_id' => $this->testTenantId,
            'token' => $oldToken,
            'created_at' => now(),
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $user->id . '/send-password-reset');

        $response->assertStatus(200);
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($user->email, $mailer->calls[0]['to']);
        $this->assertSame('password_reset', $mailer->calls[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->calls[0]['options']['tenant_id']);
        $this->assertSame(1, DB::table('password_resets')
            ->where('email', $user->email)
            ->where('tenant_id', $this->testTenantId)
            ->count());
        $this->assertNotSame($oldToken, DB::table('password_resets')
            ->where('email', $user->email)
            ->where('tenant_id', $this->testTenantId)
            ->value('token'));
    }

    public function test_send_verification_email_creates_token_for_unverified_user(): void
    {
        $this->ensureEmailVerificationTokenTable();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'admin-verify-resend-' . uniqid('', true) . '@example.test',
            'email_verified_at' => null,
            'is_verified' => false,
            'preferred_language' => 'en',
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $user->id . '/send-verification-email');

        $response->assertStatus(200);
        $response->assertJsonPath('data.sent', true);
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($user->email, $mailer->calls[0]['to']);
        $this->assertSame('email_verification', $mailer->calls[0]['options']['category']);
        $this->assertSame(1, DB::table('email_verification_tokens')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    public function test_send_verification_email_skips_already_verified_user(): void
    {
        $this->ensureEmailVerificationTokenTable();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'admin-verify-already-' . uniqid('', true) . '@example.test',
            'email_verified_at' => now(),
            'is_verified' => true,
        ]);
        $mailer = new AdminUsersSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/users/' . $user->id . '/send-verification-email');

        $response->assertStatus(200);
        $response->assertJsonPath('data.already_verified', true);
        $this->assertCount(0, $mailer->calls);
        $this->assertSame(0, DB::table('email_verification_tokens')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    private function ensureEmailVerificationTokenTable(): void
    {
        DB::statement("
            CREATE TABLE IF NOT EXISTS `email_verification_tokens` (
                `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                `user_id` INT UNSIGNED NOT NULL,
                `tenant_id` INT(11) NOT NULL,
                `token` VARCHAR(255) NOT NULL,
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                `expires_at` TIMESTAMP NOT NULL,
                INDEX `idx_user_id` (`user_id`),
                INDEX `idx_tenant_id` (`tenant_id`),
                INDEX `idx_tenant_user` (`tenant_id`, `user_id`),
                INDEX `idx_expires_at` (`expires_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }
}

class AdminUsersFailingEmailDispatchService extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return false;
    }
}

class AdminUsersSuccessfulEmailDispatchService extends EmailDispatchService
{
    public array $calls = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return true;
    }
}
