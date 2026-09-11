<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

/** P3 — an authenticator code is accepted once, by whichever consumer sees it first (F-009). */
class TotpReplayTest extends TwoFactorAuditTestCase
{
    public function test_a_code_used_for_login_is_refused_for_recovery_regeneration_and_security_confirmation(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $code = $this->code($secret);

        $session = $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $code])->assertOk();
        $headers = ['Authorization' => 'Bearer ' . $session->json('access_token')];

        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $code], $headers)->assertStatus(422);
        $this->apiPost('/webauthn/security-confirm', ['totp_code' => $code], $headers)
            ->assertStatus(403)->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED');
    }

    public function test_a_code_used_for_security_confirmation_cannot_then_complete_a_login(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $code = $this->code($secret);

        $this->apiPost('/webauthn/security-confirm', ['totp_code' => $code], $this->bearer($member, true))->assertOk();
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $code])->assertStatus(401);
    }

    public function test_previous_step_is_refused_after_a_later_step_was_accepted(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);

        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $this->code($secret, +1)])->assertOk();
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $this->code($secret, 0)])->assertStatus(401);
    }

    public function test_two_steps_of_drift_are_refused_in_both_directions(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);

        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $this->code($secret, -2)])->assertStatus(401);
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $this->code($secret, +2)])->assertStatus(401);
        // Control: one step of drift is still accepted, so the refusals above are about the window, not the fixture.
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $this->code($secret, -1)])->assertOk();
    }
}
