<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Services\GuardianConsentService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-160 — a minor must not be able to name their own account's email as
 * the guardian on a volunteering guardian-consent request (self-approval).
 * The events path already refuses the minor's own address; this brings the
 * volunteering path to parity.
 */
class GuardianConsentSelfEmailTest extends TestCase
{
    use DatabaseTransactions;

    private function makeMinor(string $email): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Minor Test',
            'first_name' => 'Minor',
            'last_name' => 'Test',
            'email' => $email,
            'password' => password_hash('x', PASSWORD_BCRYPT),
            'date_of_birth' => now()->subYears(14)->format('Y-m-d'),
            'status' => 'active',
            'role' => 'member',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_minor_cannot_name_their_own_email_as_guardian(): void
    {
        TenantContext::setById($this->testTenantId);
        $email = 'e035-minor-' . uniqid() . '@example.test';
        $minorId = $this->makeMinor($email);

        $this->assertTrue(GuardianConsentService::isMinor($minorId));

        // Case-varied to prove normalisation, not just an exact-string check.
        $threw = false;
        try {
            GuardianConsentService::requestConsent($minorId, [
                'guardian_name' => 'Not A Real Guardian',
                'guardian_email' => strtoupper($email),
                'relationship' => 'parent',
            ]);
        } catch (\InvalidArgumentException) {
            $threw = true;
        }
        $this->assertTrue($threw, 'requestConsent accepted the minor\'s own email as the guardian');

        // Control: a genuinely different address is still accepted.
        $ok = GuardianConsentService::requestConsent($minorId, [
            'guardian_name' => 'Real Guardian',
            'guardian_email' => 'e035-guardian-' . uniqid() . '@example.test',
            'relationship' => 'parent',
        ]);
        $this->assertArrayHasKey('id', $ok);
        $this->assertSame('pending', $ok['status']);
    }
}
