<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** P6, P7 — removing a second factor is a session boundary and an audited, tiered action. */
class FactorRemovalTest extends TwoFactorAuditTestCase
{
    /**
     * Owner decision, 12 September 2026 (register §7, O-007): turning the factor
     * off needs the account password AND a current, single-use authenticator
     * code — a stolen browser session plus the password is no longer enough.
     */
    public function test_disable_requires_password_and_a_fresh_code_refuses_required_accounts_and_revokes_every_session(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $headers = $this->bearer($member, true);
        sleep(1); // the revocation cutoff is second-granular; the token must be strictly older than it

        // The endpoint allows three attempts per hour per account and five per
        // minute on the route. This test makes more than that on purpose, so both
        // counters (they live in the cache) are cleared before each call; the
        // limits themselves are not the property under test here.
        $disable = function (array $body) use ($headers) {
            Cache::flush();
            return $this->apiPost('/v2/auth/2fa/disable', $body, $headers);
        };

        $disable([])->assertStatus(400);
        $disable(['password' => 'test-password'])->assertStatus(422)->assertJsonPath('errors.0.field', 'code');
        $disable(['password' => 'test-password', 'code' => '12345'])->assertStatus(422);

        // A wrong password is refused before the code is even looked at, so the
        // code's 30-second step is not spent by a failed attempt.
        $code = $this->code($secret);
        $disable(['password' => 'wrong-password', 'code' => $code])
            ->assertStatus(403)->assertJsonPath('errors.0.field', 'password');
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $member->id)->count(), 'a wrong password must not touch the factor');

        $disable(['password' => 'test-password', 'code' => '000000'])
            ->assertStatus(403)->assertJsonPath('errors.0.field', 'code');
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $member->id)->count(), 'a wrong code must not touch the factor');
        $this->apiGet('/v2/users/me', $headers)->assertOk();

        // A code already spent on another proof (recovery-code regeneration) is
        // refused here too: the step is single-use across every consumer.
        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $code], $headers)->assertOk();
        $disable(['password' => 'test-password', 'code' => $code])->assertStatus(403)->assertJsonPath('errors.0.field', 'code');
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $member->id)->count(), 'a replayed code must not touch the factor');

        $disable(['password' => 'test-password', 'code' => $this->code($secret, 1)])->assertOk();
        $this->assertSame(0, DB::table('user_totp_settings')->where('user_id', $member->id)->count());
        $this->apiGet('/v2/users/me', $headers)->assertStatus(401);

        $admin = $this->member(['role' => 'admin']);
        $adminSecret = $this->enrol($admin);
        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'test-password', 'code' => $this->code($adminSecret)], $this->bearer($admin, true))
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
