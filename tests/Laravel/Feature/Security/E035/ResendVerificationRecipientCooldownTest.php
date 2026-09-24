<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Jobs\SendEmailVerificationResend;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Bus;
use Tests\Laravel\TestCase;

/**
 * E-035 F-171 — the public resend-verification-by-email endpoint had only a
 * per-IP limit, so one inbox could be bombed from many IPs and each send rotated
 * (invalidated) the recipient's previous token. A per-(tenant, address) cooldown
 * now caps how often a resend actually dispatches for a given address, without
 * changing the enumeration-safe generic response.
 */
class ResendVerificationRecipientCooldownTest extends TestCase
{
    use DatabaseTransactions;

    public function test_rapid_repeats_to_same_recipient_dispatch_once(): void
    {
        Bus::fake([SendEmailVerificationResend::class]);
        TenantContext::setById($this->testTenantId);

        $victim = 'e035-victim-' . uniqid() . '@gmail.com';
        $other = 'e035-other-' . uniqid() . '@gmail.com';

        // Two rapid requests for the SAME address, then one for a DIFFERENT one.
        // All three stay within the per-IP limit (3/5min).
        $r1 = $this->apiPost('/auth/resend-verification-by-email', ['email' => $victim]);
        $r2 = $this->apiPost('/auth/resend-verification-by-email', ['email' => $victim]);
        $r3 = $this->apiPost('/auth/resend-verification-by-email', ['email' => $other]);

        // Every response is the identical generic success — never a throttle
        // response that would itself reveal the cooldown state.
        foreach ([$r1, $r2, $r3] as $r) {
            $this->assertSame(200, $r->status());
        }

        // The victim address dispatched exactly once despite two requests; the
        // other address dispatched once. Two total, not three.
        Bus::assertDispatchedTimes(SendEmailVerificationResend::class, 2);
        Bus::assertDispatched(
            SendEmailVerificationResend::class,
            fn (SendEmailVerificationResend $job) => $job->email === $victim
        );
        Bus::assertDispatched(
            SendEmailVerificationResend::class,
            fn (SendEmailVerificationResend $job) => $job->email === $other
        );
    }
}
