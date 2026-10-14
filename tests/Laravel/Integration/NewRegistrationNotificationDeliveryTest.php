<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Events\UserRegistered;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Real listener and notification persistence, with no order-dependent alias mocks.
 * Reserved .example addresses are refused before any outbound mail provider call.
 */
class NewRegistrationNotificationDeliveryTest extends TestCase
{
    use DatabaseTransactions;

    protected int $testTenantId = 997;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->testTenantId = $this->seedTenant();
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    public function test_real_fanout_reaches_each_eligible_staff_member_once_and_stays_in_tenant(): void
    {
        $otherTenantId = $this->seedTenant();
        $registrant = $this->seedUser(['role' => 'member']);
        $roleAdmin = $this->seedUser(['role' => 'admin']);
        $flagAdmin = $this->seedUser(['role' => 'member', 'is_tenant_super_admin' => 1]);
        $coordinator = $this->seedUser(['role' => 'coordinator']);
        $ordinaryMember = $this->seedUser(['role' => 'member']);
        $inactiveAdmin = $this->seedUser(['role' => 'admin', 'status' => 'suspended']);
        $foreignAdmin = $this->seedUser(['role' => 'admin'], $otherTenantId);

        $user = new User();
        $user->id = $registrant;
        $listener = new NotifyAdminOfNewRegistration();
        $event = new UserRegistered($user, $this->testTenantId);
        $listener->handle($event);
        $listener->handle($event); // done-key suppresses a repeated event
        Cache::forget('notify_admin_new_registration:done:' . $this->testTenantId . ':' . $registrant);
        $listener->handle($event); // forced replay still cannot duplicate bells

        $rows = DB::table('notifications')
            ->where('type', 'new_user_registered')
            ->whereIn('user_id', [$roleAdmin, $flagAdmin, $coordinator, $ordinaryMember, $inactiveAdmin, $foreignAdmin])
            ->orderBy('user_id')
            ->get(['user_id', 'tenant_id', 'link']);

        $this->assertCount(3, $rows);
        $this->assertSame(
            [$roleAdmin, $flagAdmin, $coordinator],
            $rows->pluck('user_id')->map(static fn ($id): int => (int) $id)->all()
        );
        $this->assertSame([$this->testTenantId], $rows->pluck('tenant_id')->unique()->map(static fn ($id): int => (int) $id)->all());
        $this->assertSame('/admin/users?filter=pending', $rows[0]->link);
        $this->assertSame('/admin/users?filter=pending', $rows[1]->link);
        $this->assertSame('/broker/members', $rows[2]->link);
    }

    private function seedTenant(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Synthetic registration alert tenant',
            'slug' => 'reg-delivery-' . uniqid('', true),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedUser(array $overrides = [], ?int $tenantId = null): int
    {
        $unique = uniqid('reg_', true);
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'name' => 'Synthetic User ' . $unique,
            'first_name' => 'Synthetic',
            'last_name' => 'User',
            'email' => $unique . '@example.com',
            'role' => 'member',
            'status' => 'active',
            'preferred_language' => 'en',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
