<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\WarmthPassService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class WarmthPassServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_A = 2;
    private const TENANT_B = 999;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById(self::TENANT_A);
    }

    private function makeUser(int $tenantId, string $email, array $overrides = []): int
    {
        $row = array_merge([
            'tenant_id'  => $tenantId,
            'first_name' => 'Warm',
            'last_name'  => 'Pass',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . $tenantId . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'trust_tier' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        return (int) DB::table('users')->insertGetId($row);
    }

    public function test_pass_not_eligible_for_newcomer(): void
    {
        $service = new WarmthPassService();
        $userId = $this->makeUser(self::TENANT_A, 'wp1.' . uniqid() . '@example.com', ['trust_tier' => 0]);

        $pass = $service->buildPass($userId, self::TENANT_A);

        $this->assertFalse($pass['eligible']);
        $this->assertSame(0, $pass['tier']);
        $this->assertSame('newcomer', $pass['tier_label']);
        $this->assertNull($pass['pass_active_since']);
    }

    public function test_pass_eligible_for_trusted_tier(): void
    {
        $service = new WarmthPassService();
        $userId = $this->makeUser(self::TENANT_A, 'wp2.' . uniqid() . '@example.com', ['trust_tier' => 2]);

        $pass = $service->buildPass($userId, self::TENANT_A);

        $this->assertTrue($pass['eligible']);
        $this->assertSame(2, $pass['tier']);
        $this->assertSame('trusted', $pass['tier_label']);
        $this->assertNotNull($pass['pass_active_since']);
        $this->assertSame('Warm Pass', trim($pass['member_name']));
    }

    public function test_pass_includes_member_since_date(): void
    {
        $service = new WarmthPassService();
        $userId = $this->makeUser(self::TENANT_A, 'wp3.' . uniqid() . '@example.com', ['trust_tier' => 3]);

        $pass = $service->buildPass($userId, self::TENANT_A);

        $this->assertNotNull($pass['member_since']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $pass['member_since']);
    }

    public function test_pass_counts_only_own_tenant_hours(): void
    {
        $service = new WarmthPassService();
        $userId = $this->makeUser(self::TENANT_A, 'wp4.' . uniqid() . '@example.com', ['trust_tier' => 2]);

        // Hours in tenant A — should count
        DB::table('vol_logs')->insert([
            'tenant_id'  => self::TENANT_A,
            'user_id'    => $userId,
            'hours'      => 7.5,
            'status'     => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        // Hours in tenant B — must NOT count toward A pass
        DB::table('vol_logs')->insert([
            'tenant_id'  => self::TENANT_B,
            'user_id'    => $userId,
            'hours'      => 50.0,
            'status'     => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $pass = $service->buildPass($userId, self::TENANT_A);
        $this->assertEqualsWithDelta(7.5, $pass['hours_logged'], 0.001);
    }

    public function test_pass_identity_verified_reflects_user_flag(): void
    {
        $service = new WarmthPassService();

        $verifiedId = $this->makeUser(self::TENANT_A, 'wpv.' . uniqid() . '@example.com', [
            'trust_tier' => 3,
            'is_verified' => 1,
        ]);
        $unverifiedId = $this->makeUser(self::TENANT_A, 'wpu.' . uniqid() . '@example.com', [
            'trust_tier' => 2,
            'is_verified' => 0,
        ]);

        $vp = $service->buildPass($verifiedId, self::TENANT_A);
        $up = $service->buildPass($unverifiedId, self::TENANT_A);

        $this->assertTrue($vp['identity_verified']);
        $this->assertFalse($up['identity_verified']);
    }

    public function test_pass_returns_default_when_user_not_in_tenant(): void
    {
        $service = new WarmthPassService();
        $userB = $this->makeUser(self::TENANT_B, 'wpx.' . uniqid() . '@example.com', ['trust_tier' => 4]);

        // Build pass under TENANT_A scope for a user that lives in TENANT_B —
        // service should not surface tenant B's data
        $pass = $service->buildPass($userB, self::TENANT_A);

        $this->assertFalse($pass['eligible']);
        $this->assertSame(0, $pass['tier']);
        $this->assertSame('', $pass['member_name']);
        $this->assertNull($pass['member_since']);
    }

    public function test_pass_includes_tenant_name(): void
    {
        $service = new WarmthPassService();
        $userId = $this->makeUser(self::TENANT_A, 'wpt.' . uniqid() . '@example.com', ['trust_tier' => 2]);

        $pass = $service->buildPass($userId, self::TENANT_A);

        $this->assertNotEmpty($pass['tenant_name']);
        $this->assertNotSame('Community', $pass['tenant_name'], 'Should pull real tenant name');
    }
}
