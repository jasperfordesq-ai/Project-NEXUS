<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\TrustTierService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class TrustTierServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_A = 2;
    private const TENANT_B = 999;

    protected function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('caring_trust_tier_config') || !Schema::hasColumn('users', 'trust_tier')) {
            $this->markTestSkipped('Trust tier schema not present.');
        }

        TenantContext::setById(self::TENANT_A);
    }

    private function makeUser(int $tenantId, string $email, array $overrides = []): int
    {
        $row = array_merge([
            'tenant_id'  => $tenantId,
            'first_name' => 'TT',
            'last_name'  => 'User',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . $tenantId . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        return (int) DB::table('users')->insertGetId($row);
    }

    public function test_get_config_returns_defaults_for_new_tenant(): void
    {
        $service = new TrustTierService();

        // Ensure no override exists for tenant A
        DB::table('caring_trust_tier_config')->where('tenant_id', self::TENANT_A)->delete();

        $config = $service->getConfig(self::TENANT_A);

        $this->assertSame(TrustTierService::DEFAULT_CRITERIA, $config);
    }

    public function test_update_config_persists_per_tenant(): void
    {
        $service = new TrustTierService();
        $custom = TrustTierService::DEFAULT_CRITERIA;
        $custom['trusted']['hours_logged'] = 25;

        $service->updateConfig(self::TENANT_A, $custom);

        $loaded = $service->getConfig(self::TENANT_A);
        $this->assertSame(25, (int) $loaded['trusted']['hours_logged']);

        // Tenant B still has defaults
        DB::table('caring_trust_tier_config')->where('tenant_id', self::TENANT_B)->delete();
        $loadedB = $service->getConfig(self::TENANT_B);
        $this->assertSame(
            (int) TrustTierService::DEFAULT_CRITERIA['trusted']['hours_logged'],
            (int) $loadedB['trusted']['hours_logged']
        );
    }

    public function test_compute_tier_newcomer_when_no_signals(): void
    {
        $service = new TrustTierService();
        $userId = $this->makeUser(self::TENANT_A, 'tt1.' . uniqid() . '@example.com');

        $this->assertSame(TrustTierService::TIER_NEWCOMER, $service->computeTier($userId, self::TENANT_A));
    }

    public function test_compute_tier_member_when_one_hour_logged(): void
    {
        $service = new TrustTierService();
        $userId = $this->makeUser(self::TENANT_A, 'tt2.' . uniqid() . '@example.com');

        DB::table('vol_logs')->insert([
            'tenant_id'  => self::TENANT_A,
            'user_id'    => $userId,
            'hours'      => 2.0,
            'status'     => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame(TrustTierService::TIER_MEMBER, $service->computeTier($userId, self::TENANT_A));
    }

    public function test_recompute_for_user_persists_tier(): void
    {
        $service = new TrustTierService();
        $userId = $this->makeUser(self::TENANT_A, 'tt3.' . uniqid() . '@example.com', ['trust_tier' => 0]);

        $newTier = $service->recomputeForUser($userId, self::TENANT_A);
        $stored = (int) DB::table('users')->where('id', $userId)->value('trust_tier');

        $this->assertSame($newTier, $stored);
    }

    public function test_cross_tenant_isolation_recompute_does_not_affect_other_tenant_users(): void
    {
        $service = new TrustTierService();
        $userA = $this->makeUser(self::TENANT_A, 'ttx.' . uniqid() . '@example.com', ['trust_tier' => 0]);
        $userB = $this->makeUser(self::TENANT_B, 'tty.' . uniqid() . '@example.com', ['trust_tier' => 3]);

        // Recompute under tenant A scope must not touch tenant B user
        $service->recomputeForUser($userB, self::TENANT_A);

        $bTier = (int) DB::table('users')->where('id', $userB)->value('trust_tier');
        $this->assertSame(3, $bTier, 'Tenant A scope must not modify Tenant B user trust_tier');
    }

    public function test_compute_tier_does_not_count_other_tenants_hours(): void
    {
        $service = new TrustTierService();
        $userId = $this->makeUser(self::TENANT_A, 'ttz.' . uniqid() . '@example.com');

        // Hours logged under TENANT_B should not count toward TENANT_A tier
        DB::table('vol_logs')->insert([
            'tenant_id'  => self::TENANT_B,
            'user_id'    => $userId,
            'hours'      => 100.0,
            'status'     => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame(
            TrustTierService::TIER_NEWCOMER,
            $service->computeTier($userId, self::TENANT_A),
            'vol_logs from another tenant must not count toward this tenant tier'
        );
    }

    public function test_compute_breakdown_returns_signals_and_progress(): void
    {
        $service = new TrustTierService();
        $userId = $this->makeUser(self::TENANT_A, 'ttb.' . uniqid() . '@example.com');

        $breakdown = $service->computeBreakdownForUser($userId, self::TENANT_A);

        $this->assertArrayHasKey('tier', $breakdown);
        $this->assertArrayHasKey('signals', $breakdown);
        $this->assertCount(3, $breakdown['signals']);
        $this->assertGreaterThanOrEqual(0.0, $breakdown['progress_pct']);
        $this->assertLessThanOrEqual(100.0, $breakdown['progress_pct']);
    }

    public function test_get_tier_label_returns_string_label(): void
    {
        $service = new TrustTierService();

        $this->assertSame('newcomer', $service->getTierLabel(0));
        $this->assertSame('coordinator', $service->getTierLabel(4));
        $this->assertSame('newcomer', $service->getTierLabel(99)); // out-of-range fallback
    }
}
