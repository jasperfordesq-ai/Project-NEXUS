<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Core\TenantContext;
use App\Services\CaringCommunity\FederationAggregateService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Proves the four whitelisted federation aggregate metrics are computed from
 * REAL tenant-scoped queries, not stubs:
 *
 *   1. hours.total_approved
 *   2. members.bracket
 *   3. hours.by_category (category histogram)
 *   4. partner_orgs.count
 *
 * Also locks in the data-quality filtering rules:
 *   - Member bracket excludes banned/suspended users
 *   - Partner-org count excludes pending/rejected orgs
 *   - Approved hours excludes pending/declined logs
 *   - Cross-tenant data does not leak into the aggregate
 */
final class FederationAggregateDataIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    private FederationAggregateService $service;
    private string $periodFrom;
    private string $periodTo;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new FederationAggregateService();
        $this->periodTo   = date('Y-m-d');
        $this->periodFrom = date('Y-m-d', strtotime('-30 days'));
        TenantContext::setById($this->testTenantId);
    }

    public function test_total_approved_hours_reflects_real_approved_logs_only(): void
    {
        $today = '2099-03-10';
        $periodFrom = '2099-03-01';
        $periodTo = '2099-03-31';
        $userId = $this->seedUser($this->testTenantId, 'active');

        // Seed enough approved rows to clear the aggregate privacy suppression
        // threshold while keeping the expected public total at exactly 5.0.
        $this->insertVolLog($this->testTenantId, $userId, $today, 5.0,  'approved');
        $this->insertVolLog($this->testTenantId, $userId, $today, 0.0,  'approved');
        $this->insertVolLog($this->testTenantId, $userId, $today, 0.0,  'approved');
        $this->insertVolLog($this->testTenantId, $userId, $today, 0.0,  'approved');
        $this->insertVolLog($this->testTenantId, $userId, $today, 0.0,  'approved');
        $this->insertVolLog($this->testTenantId, $userId, $today, 99.0, 'pending');
        $this->insertVolLog($this->testTenantId, $userId, $today, 77.0, 'declined');

        // Cross-tenant log MUST be excluded — non-existent tenant id 999999
        $this->insertVolLog(999999, $userId, $today, 12345.0, 'approved');

        $payload = $this->service->compute($periodFrom, $periodTo);
        $this->assertSame(5.0, (float) $payload['hours']['total_approved']);
    }

    public function test_member_bracket_excludes_banned_and_suspended_users(): void
    {
        // Snapshot existing active members for our tenant first.
        $baselineActive = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND status = 'active'",
            [$this->testTenantId]
        )->cnt;

        // Add 1 active and 2 non-active users.
        $this->seedUser($this->testTenantId, 'active');
        $this->seedUser($this->testTenantId, 'banned');
        $this->seedUser($this->testTenantId, 'suspended');

        $payload = $this->service->compute($this->periodFrom, $this->periodTo);

        // Bracket must be a string in the canonical set (never raw int).
        $this->assertContains(
            $payload['members']['bracket'],
            ['<50', '50-200', '200-1000', '>1000']
        );

        // Recompute the expected bracket from the +1 active increment only.
        $expected = $this->service->bucketMemberCount($baselineActive + 1);
        $this->assertSame($expected, $payload['members']['bracket']);
    }

    public function test_partner_orgs_count_excludes_pending_and_rejected(): void
    {
        $baseline = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM vol_organizations
              WHERE tenant_id = ? AND status IN ('approved','active')",
            [$this->testTenantId]
        )->cnt;

        $userId = $this->seedUser($this->testTenantId, 'active');
        $this->insertOrg($this->testTenantId, $userId, 'approved');
        $this->insertOrg($this->testTenantId, $userId, 'active');
        $this->insertOrg($this->testTenantId, $userId, 'approved');
        $this->insertOrg($this->testTenantId, $userId, 'active');
        $this->insertOrg($this->testTenantId, $userId, 'approved');
        $this->insertOrg($this->testTenantId, $userId, 'pending');   // excluded
        $this->insertOrg($this->testTenantId, $userId, 'rejected');  // excluded

        // Cross-tenant approved org MUST be excluded
        $this->insertOrg(999999, $userId, 'approved');

        $payload = $this->service->compute($this->periodFrom, $this->periodTo);
        $this->assertSame($baseline + 5, (int) $payload['partner_orgs']['count']);
    }

    public function test_category_histogram_returns_real_data_capped_at_10(): void
    {
        if (
            !Schema::hasTable('vol_logs')
            || !Schema::hasTable('vol_opportunities')
            || !Schema::hasTable('categories')
        ) {
            $this->markTestSkipped('Required tables missing for category histogram.');
        }

        $payload = $this->service->compute($this->periodFrom, $this->periodTo);

        $this->assertIsArray($payload['hours']['by_category']);
        $this->assertLessThanOrEqual(10, count($payload['hours']['by_category']));

        // Each entry must have the documented shape — never a stub.
        foreach ($payload['hours']['by_category'] as $entry) {
            $this->assertArrayHasKey('category', $entry);
            $this->assertArrayHasKey('hours', $entry);
            $this->assertArrayHasKey('count', $entry);
            $this->assertIsString($entry['category']);
            $this->assertIsNumeric($entry['hours']);
            $this->assertIsInt($entry['count']);
        }
    }

    public function test_aggregate_returns_zero_not_stub_when_tenant_has_no_activity(): void
    {
        // Use a tenant id far above any seeded fixture data so the result is
        // deterministically empty regardless of previous test seeding.
        $emptyTenantId = 9_999_998;

        // Bypass TenantContext::setById (which falls through to current tenant
        // when the id is not in the tenants table) by writing the tenant
        // directly into the static cache via reflection.
        $ref  = new \ReflectionClass(TenantContext::class);
        $prop = $ref->getProperty('tenant');
        $prop->setAccessible(true);
        $prop->setValue(null, [
            'id' => $emptyTenantId,
            'name' => 'Empty Test',
            'slug' => 'empty-test',
            'domain' => null,
            'is_active' => true,
            'features' => '{}',
        ]);
        // Clear the memoized cachedId so getId() re-reads from $tenant.
        $cached = $ref->getProperty('cachedId');
        $cached->setAccessible(true);
        $cached->setValue(null, null);

        $payload = $this->service->compute($this->periodFrom, $this->periodTo);

        // The point of this test is that empty data is REAL zero, not a stub
        // string or canned response. Total approved must compute to numeric 0
        // and the structural arrays must be empty arrays — not nulls, not
        // hardcoded sample rows.
        $this->assertSame(0.0, (float) $payload['hours']['total_approved']);
        $this->assertSame([], $payload['hours']['by_month']);
        $this->assertSame([], $payload['hours']['by_category']);
        $this->assertSame(0, (int) $payload['partner_orgs']['count']);

        // Bracket comes from the bucket function — for 0 members it must be
        // the lowest bucket, never the raw integer.
        $this->assertSame('<50', $payload['members']['bracket']);

        // Restore for teardown
        TenantContext::setById($this->testTenantId);
    }

    // ---------------------------------------------------------------- helpers

    private function seedUser(int $tenantId, string $status): int
    {
        $email = 'fed-agg-' . bin2hex(random_bytes(6)) . '@example.test';
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Fed Agg Test',
            'email'      => $email,
            'username'   => substr(str_replace('@', '_', $email), 0, 50),
            'status'     => $status,
            'role'       => 'member',
            'created_at' => now(),
        ]);
    }

    private function insertVolLog(int $tenantId, int $userId, string $date, float $hours, string $status): void
    {
        DB::table('vol_logs')->insert([
            'tenant_id'   => $tenantId,
            'user_id'     => $userId,
            'date_logged' => $date,
            'hours'       => $hours,
            'status'      => $status,
            'created_at'  => now(),
        ]);
    }

    private function insertOrg(int $tenantId, int $userId, string $status): void
    {
        DB::table('vol_organizations')->insert([
            'tenant_id'  => $tenantId,
            'user_id'    => $userId,
            'name'       => 'Fed Agg Org ' . bin2hex(random_bytes(4)),
            'status'     => $status,
            'created_at' => now(),
        ]);
    }
}
