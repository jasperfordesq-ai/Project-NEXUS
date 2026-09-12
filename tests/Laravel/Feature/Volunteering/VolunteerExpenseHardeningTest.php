<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use App\Services\VolunteerExpenseService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression tests for the 2026-07-09 volunteering audit fixes:
 *
 *  - VOL-BE-002: expense currency must be the tenant's configured currency,
 *    never a hardcoded euro literal (global platform).
 *  - VOL-BE-001: the monthly-cap read + insert must be serialised under an
 *    atomic lock so concurrent submissions cannot jointly bypass the cap
 *    (check-then-insert TOCTOU). A true parallel race is not reproducible in a
 *    single-process PHPUnit run, so we assert the serialisation guard is wired
 *    and correctly keyed by pre-acquiring the exact lock the service uses.
 *
 * User::factory()->create() resets TenantContext to the default tenant, so
 * each test restores the test tenant before calling the service directly
 * (in production the tenant is resolved per-request by middleware).
 */
class VolunteerExpenseHardeningTest extends TestCase
{
    use DatabaseTransactions;

    private function createApprovedOrgOwnedBy(int $userId): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'name' => 'Expense Hardening Org',
            'status' => 'approved',
            'balance' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_expense_currency_uses_tenant_currency_not_hardcoded_eur(): void
    {
        app(TenantSettingsService::class)->set($this->testTenantId, 'general.default_currency', 'GBP');

        $user = User::factory()->forTenant($this->testTenantId)->create();
        $orgId = $this->createApprovedOrgOwnedBy((int) $user->id);
        TenantContext::setById($this->testTenantId);

        // First-time claimant supplies no currency — previously stored 'EUR'.
        $result = VolunteerExpenseService::submitExpense((int) $user->id, [
            'organization_id' => $orgId,
            'expense_type' => 'travel',
            'amount' => 40.00,
            'description' => 'Bus fare to shift',
        ]);

        $this->assertNotEmpty($result);

        $stored = DB::table('vol_expenses')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('organization_id', $orgId)
            ->orderByDesc('id')
            ->value('currency');

        $this->assertSame('GBP', $stored);
        $this->assertNotSame('EUR', $stored);
    }

    public function test_concurrent_expense_submission_is_serialised_by_cap_lock(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $orgId = $this->createApprovedOrgOwnedBy((int) $user->id);
        TenantContext::setById($this->testTenantId);

        // Simulate a concurrent submission already holding the per-volunteer,
        // per-org, per-month cap lock the service acquires internally.
        $key = sprintf(
            'vol_expense_cap:%d:%d:%d:%s',
            $this->testTenantId,
            $user->id,
            $orgId,
            now()->format('Y-m')
        );
        $held = Cache::lock($key, 10);
        $this->assertTrue($held->get());

        try {
            $this->expectException(\RuntimeException::class);
            $this->expectExceptionCode(429);
            VolunteerExpenseService::submitExpense((int) $user->id, [
                'organization_id' => $orgId,
                'expense_type' => 'travel',
                'amount' => 10.00,
                'description' => 'Concurrent submission',
            ]);
        } finally {
            $held->release();
        }
    }

    public function test_response_loss_retry_returns_original_expense_claim(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $orgId = $this->createApprovedOrgOwnedBy((int) $user->id);
        TenantContext::setById($this->testTenantId);
        $payload = [
            'organization_id' => $orgId,
            'expense_type' => 'travel',
            'amount' => 12.50,
            'description' => 'Return bus ticket',
            'idempotency_key' => 'mobile-expense-retry-1',
        ];

        $first = VolunteerExpenseService::submitExpense((int) $user->id, $payload);
        $replay = VolunteerExpenseService::submitExpense((int) $user->id, $payload);

        $this->assertSame($first['id'], $replay['id']);
        $this->assertSame(1, DB::table('vol_expenses')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('creation_idempotency_key_hash', hash('sha256', 'mobile-expense-retry-1'))
            ->count());
    }
}
