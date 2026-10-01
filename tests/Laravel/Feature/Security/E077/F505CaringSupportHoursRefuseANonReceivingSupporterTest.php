<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E077;

use App\Core\TenantContext;
use App\Services\CaringSupportRelationshipService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\VolunteerService;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-505 (E-077 re-attack, reviewer A's B1) — sibling of F-475 (commit 9d6236d40)
 * and the supporter half of F-384.
 *
 * F-475 added WalletService::canReceiveCredits() under the member's row lock to
 * four volunteering mint arms. The FIFTH mint path in the same family — the
 * caring-support hours route that F-384 hardened for the ORGANISATION
 * (CaringSupportRelationshipService::logHours -> applyOrganizationPayment) —
 * never reads the SUPPORTER's status. A coordinator logging hours for a
 * suspended / banned / rejected supporter is auto-approved and mints.
 *
 * Asserts the CORRECT behaviour, so a red result reproduces the defect. Controls:
 * an active supporter is still paid, and F-475's verifyHours still refuses the
 * same suspended member.
 */
final class F505CaringSupportHoursRefuseANonReceivingSupporterTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    public function test_suspended_supporter_is_not_paid_for_caring_support_hours(): void
    {
        $this->runCase('suspended');
    }

    public function test_banned_supporter_is_not_paid_for_caring_support_hours(): void
    {
        $this->runCase('banned');
    }

    public function test_control_active_supporter_is_paid(): void
    {
        [$result, $supporter] = $this->logFor('active');
        $this->assertTrue($result['success'] ?? false, json_encode($result));
        $this->assertSame(3.0, $this->balanceOf($supporter), 'control: an active supporter is paid');
    }

    public function test_control_sibling_route_f475_refuses_same_suspended_member(): void
    {
        $owner = $this->makeUser('active', 'member');
        $orgId = $this->makeOrganization($owner, 'approved');
        $volunteer = $this->makeUser('suspended', 'member');
        $logId = (int) DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer,
            'organization_id' => $orgId,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => 3.0,
            'description' => 'F505 sibling control',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ok = VolunteerService::verifyHours($logId, $owner, 'approve');
        $this->assertFalse($ok, 'F-475 fix refuses the suspended volunteer on verifyHours');
        $this->assertSame(0.0, $this->balanceOf($volunteer));
    }

    private function runCase(string $status): void
    {
        $this->assertFalse(WalletService::canReceiveCredits($status), 'precondition');
        [$result, $supporter] = $this->logFor($status);

        $this->assertSame(
            0.0,
            $this->balanceOf($supporter),
            "F-505: caring-support hours minted into a {$status} supporter's balance; result=" . json_encode($result)
        );
        $this->assertFalse($result['success'] ?? true, 'the log is refused, not silently left unpaid');
        $this->assertSame('RECIPIENT_NOT_ACTIVE', $result['code'] ?? null);
        $this->assertSame(
            0,
            DB::table('vol_logs')->where('user_id', $supporter)->where('status', 'approved')->count(),
            'F-505: no approved log is left behind for hours that were never paid'
        );
    }

    /** @return array{0: array<string,mixed>, 1: int} */
    private function logFor(string $supporterStatus): array
    {
        $coordinator = $this->makeUser('active', 'admin');
        $owner = $this->makeUser('active', 'member');
        $orgId = $this->makeOrganization($owner, 'approved');
        $supporter = $this->makeUser($supporterStatus, 'member');
        $recipient = $this->makeUser('active', 'member');

        $relId = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter,
            'recipient_id' => $recipient,
            'coordinator_id' => $coordinator,
            'organization_id' => $orgId,
            'title' => 'F505 relationship',
            'frequency' => 'weekly',
            'expected_hours' => 1.0,
            'start_date' => now()->subWeek()->toDateString(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = app(CaringSupportRelationshipService::class)->logHours(
            $this->testTenantId,
            $relId,
            ['date' => now()->subDay()->toDateString(), 'hours' => 3, 'description' => 'F505 visit'],
            $coordinator,
        );

        return [$result, $supporter];
    }

    private function balanceOf(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

    private function makeOrganization(int $ownerId, string $status): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'F505 org ' . bin2hex(random_bytes(4)),
            'slug' => 'f505-' . bin2hex(random_bytes(6)),
            'status' => $status,
            'balance' => 0.00,
            'auto_pay_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeUser(string $status, string $role): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F505 fixture',
            'email' => 'f505-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0.0,
            'role' => $role,
            'status' => $status,
            'is_active' => $status === 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e077-f505',
        );
    }
}
