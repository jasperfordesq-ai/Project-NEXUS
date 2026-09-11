<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use Illuminate\Support\Facades\DB;

/** P6, P7 — removing a second factor is a session boundary and an audited, tiered action. */
class FactorRemovalTest extends TwoFactorAuditTestCase
{
    public function test_disable_requires_the_password_refuses_required_accounts_and_revokes_every_session(): void
    {
        $member = $this->member();
        $this->enrol($member);
        $headers = $this->bearer($member, true);
        sleep(1); // the revocation cutoff is second-granular; the token must be strictly older than it

        $this->apiPost('/v2/auth/2fa/disable', [], $headers)->assertStatus(400);
        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'wrong-password'], $headers)->assertStatus(403);
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $member->id)->count(), 'a wrong password must not touch the factor');

        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'test-password'], $headers)->assertOk();
        $this->assertSame(0, DB::table('user_totp_settings')->where('user_id', $member->id)->count());
        $this->apiGet('/v2/users/me', $headers)->assertStatus(401);

        $admin = $this->member(['role' => 'admin']);
        $this->enrol($admin);
        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'test-password'], $this->bearer($admin, true))
            ->assertStatus(403)->assertJsonPath('errors.0.code', 'MFA_REQUIRED');
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $admin->id)->count());
    }

    public function test_broker_cannot_reset_an_administrators_factor(): void
    {
        $target = $this->member(['role' => 'admin']);
        $this->enrol($target);
        $broker = $this->member(['role' => 'broker']);
        $this->enrol($broker);

        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => 'Identity verified by phone call today'], $this->bearer($broker, true))
            ->assertStatus(403);
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $target->id)->count());
        $this->assertSame(0, DB::table('totp_admin_overrides')->where('user_id', $target->id)->count());
    }

    public function test_admin_reset_needs_fresh_proof_a_reason_and_leaves_an_audit_row(): void
    {
        $target = $this->member();
        $this->enrol($target);
        $targetHeaders = $this->bearer($target, true);
        $admin = $this->member(['role' => 'admin']);
        $this->enrol($admin);
        $reason = 'Identity verified by phone call today';

        $stale = $this->bearer($admin, false, ['mfa_method' => 'totp', 'mfa_verified_at' => time() - 301]);
        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => $reason], $stale)->assertStatus(403);
        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => $reason], $this->bearer($admin, false))->assertStatus(401);
        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => 'too short'], $this->bearer($admin, true))->assertStatus(422);
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $target->id)->count());

        sleep(1);
        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => $reason], $this->bearer($admin, true))->assertOk();
        $this->assertSame(0, DB::table('user_totp_settings')->where('user_id', $target->id)->count());
        $this->assertDatabaseHas('totp_admin_overrides', ['user_id' => $target->id, 'admin_id' => $admin->id, 'tenant_id' => $this->testTenantId, 'action_type' => 'reset']);
        $this->apiGet('/v2/users/me', $targetHeaders)->assertStatus(401);
    }

    public function test_member_cannot_reset_anyone(): void
    {
        $target = $this->member();
        $this->enrol($target);
        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", ['reason' => 'Identity verified by phone call today'], $this->bearer($this->member(), true))
            ->assertStatus(403);
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $target->id)->count());
    }
}
