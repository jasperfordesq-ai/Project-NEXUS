<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Services\CronJobRunner;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The nightly sweep that keeps historical guardian-consent rows accurate.
 *
 * Guardian consent was retired with the adults-only decision (E-035 F-160) and
 * GuardianConsentService was removed on 7 Oct 2026 as unreachable code. The rows
 * stay for GDPR export and retention, so the expiry sweep moved into
 * CronJobRunner. These two tests came from GuardianConsentLifecycleTest, which
 * pinned the real column names after a phantom-column bug (2026-06-12).
 */
class GuardianConsentExpirySweepTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    private function insertConsent(array $overrides = []): int
    {
        return (int) DB::table('vol_guardian_consents')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'minor_user_id' => 1,
            'guardian_name' => 'Test Guardian',
            'guardian_email' => 'guardian@example.com',
            'relationship' => 'parent',
            'consent_token' => bin2hex(random_bytes(32)),
            'status' => 'pending',
            'expires_at' => now()->addDays(30)->format('Y-m-d H:i:s'),
            'created_at' => now(),
        ], $overrides));
    }

    public function test_overdue_pending_and_active_rows_are_marked_expired(): void
    {
        $pendingOverdue = $this->insertConsent(['expires_at' => now()->subDay()->format('Y-m-d H:i:s')]);
        $activeOverdue = $this->insertConsent([
            'status' => 'active',
            'expires_at' => now()->subDay()->format('Y-m-d H:i:s'),
        ]);
        $pendingFresh = $this->insertConsent();

        $this->assertGreaterThanOrEqual(2, CronJobRunner::expireLapsedGuardianConsents());

        $this->assertSame('expired', DB::table('vol_guardian_consents')->where('id', $pendingOverdue)->value('status'));
        $this->assertSame('expired', DB::table('vol_guardian_consents')->where('id', $activeOverdue)->value('status'));
        $this->assertSame('pending', DB::table('vol_guardian_consents')->where('id', $pendingFresh)->value('status'));
    }

    public function test_the_sweep_covers_every_community(): void
    {
        // Run once for the whole platform, whatever tenant the worker points at.
        $otherTenantRow = $this->insertConsent([
            'tenant_id' => 1,
            'expires_at' => now()->subDay()->format('Y-m-d H:i:s'),
        ]);

        CronJobRunner::expireLapsedGuardianConsents();

        $this->assertSame('expired', DB::table('vol_guardian_consents')->where('id', $otherTenantRow)->value('status'));
    }
}
