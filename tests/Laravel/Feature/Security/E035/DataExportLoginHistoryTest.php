<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\RateLimiter;
use App\Core\TenantContext;
use App\Services\MemberDataExportService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-191 — the member data export's login_history section was always
 * empty: sign-in attempts are stored under a tenant-scoped digest of the email
 * (RateLimiter::scopeLoginIdentifier), but the export looked them up by the
 * raw address. A subject access request therefore under-delivered.
 */
class DataExportLoginHistoryTest extends TestCase
{
    use DatabaseTransactions;

    public function test_export_includes_the_members_recorded_sign_in_attempts(): void
    {
        TenantContext::setById($this->testTenantId);

        $email = 'e035-export-' . uniqid() . '@example.test';
        $userId = DB::table('users')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'name'        => 'Export Member',
            'first_name'  => 'Export',
            'last_name'   => 'Member',
            'email'       => $email,
            'status'      => 'active',
            'role'        => 'member',
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        // Exactly what the sign-in path records.
        RateLimiter::recordAttempt($email, 'email', false);
        RateLimiter::recordAttempt($email, 'email', true);
        // Someone else's attempt must not appear.
        RateLimiter::recordAttempt('someone-else-' . uniqid() . '@example.test', 'email', true);

        $archive = app(MemberDataExportService::class)->buildArchive($userId);
        $history = $archive['login_history'];

        $this->assertCount(1, $history, 'the successful attempt survives (failures are cleared on success)');
        $this->assertTrue($history[0]['success']);
        $this->assertArrayHasKey('ip_address', $history[0]);
        $this->assertArrayHasKey('attempted_at', $history[0]);
        // The internal digest is not member data and is not exported.
        $this->assertArrayNotHasKey('identifier', $history[0]);
    }
}
