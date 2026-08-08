<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\ResidencyVerificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class ResidencyVerificationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_A = 2;
    private const TENANT_B = 999;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById(self::TENANT_A);
    }

    private function makeUser(int $tenantId, string $email): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'first_name' => 'Res',
            'last_name'  => 'User',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . $tenantId . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_submit_declaration_creates_pending_record(): void
    {
        $userId = $this->makeUser(self::TENANT_A, 'res.' . uniqid() . '@example.com');
        $service = new ResidencyVerificationService();

        $result = $service->submitDeclaration(self::TENANT_A, $userId, [
            'declared_municipality' => 'Zurich',
            'declared_postcode'     => '8001',
            'declared_address'      => '12 Bahnhofstrasse',
            'evidence_note'         => 'Lease attached.',
        ]);

        $this->assertSame('pending', $result['status']);
        $this->assertSame('Zurich', $result['declared_municipality']);
        $this->assertSame((int) self::TENANT_A, (int) $result['tenant_id']);
        $this->assertSame($userId, (int) $result['user_id']);
    }

    public function test_resubmit_supersedes_prior_pending_declaration(): void
    {
        $userId = $this->makeUser(self::TENANT_A, 'res2.' . uniqid() . '@example.com');
        $service = new ResidencyVerificationService();

        $first = $service->submitDeclaration(self::TENANT_A, $userId, [
            'declared_municipality' => 'Bern',
            'declared_postcode'     => '3000',
        ]);
        $second = $service->submitDeclaration(self::TENANT_A, $userId, [
            'declared_municipality' => 'Bern',
            'declared_postcode'     => '3001',
        ]);

        $firstRow = DB::table('member_residency_verifications')->where('id', $first['id'])->first();
        $this->assertSame('rejected', (string) $firstRow->status);

        $secondRow = DB::table('member_residency_verifications')->where('id', $second['id'])->first();
        $this->assertSame('pending', (string) $secondRow->status);
    }

    public function test_status_for_user_returns_not_submitted_when_no_record(): void
    {
        $userId = $this->makeUser(self::TENANT_A, 'res3.' . uniqid() . '@example.com');
        $service = new ResidencyVerificationService();

        $status = $service->statusForUser(self::TENANT_A, $userId);

        $this->assertSame('not_submitted', $status['status']);
        $this->assertNull($status['verification']);
        $this->assertFalse($status['badge']['verified']);
    }

    public function test_attest_approved_marks_record_and_sets_attestor(): void
    {
        $userId  = $this->makeUser(self::TENANT_A, 'res4.' . uniqid() . '@example.com');
        $adminId = $this->makeUser(self::TENANT_A, 'adm.' . uniqid() . '@example.com');
        $service = new ResidencyVerificationService();

        $sub = $service->submitDeclaration(self::TENANT_A, $userId, [
            'declared_municipality' => 'Geneva',
            'declared_postcode'     => '1201',
        ]);

        $result = $service->attest(self::TENANT_A, $sub['id'], $adminId, 'approved');

        $this->assertSame('approved', $result['status']);
        $this->assertSame($adminId, (int) $result['attested_by']);
        $this->assertNotNull($result['attested_at']);

        // statusForUser reflects approval
        $status = $service->statusForUser(self::TENANT_A, $userId);
        $this->assertSame('approved', $status['status']);
        $this->assertTrue($status['badge']['verified']);
    }

    public function test_attest_rejected_records_reason(): void
    {
        $userId  = $this->makeUser(self::TENANT_A, 'res5.' . uniqid() . '@example.com');
        $adminId = $this->makeUser(self::TENANT_A, 'adm2.' . uniqid() . '@example.com');
        $service = new ResidencyVerificationService();

        $sub = $service->submitDeclaration(self::TENANT_A, $userId, [
            'declared_municipality' => 'Lausanne',
            'declared_postcode'     => '1003',
        ]);

        $result = $service->attest(self::TENANT_A, $sub['id'], $adminId, 'rejected', 'Address could not be verified');

        $this->assertSame('rejected', $result['status']);
        $this->assertSame('Address could not be verified', $result['rejection_reason']);
    }

    public function test_cross_tenant_isolation_admin_cannot_attest_other_tenants_record(): void
    {
        $service = new ResidencyVerificationService();

        $userB  = $this->makeUser(self::TENANT_B, 'tb.' . uniqid() . '@example.com');
        $adminA = $this->makeUser(self::TENANT_A, 'ax.' . uniqid() . '@example.com');

        $subB = $service->submitDeclaration(self::TENANT_B, $userB, [
            'declared_municipality' => 'Basel',
            'declared_postcode'     => '4001',
        ]);

        // Admin from tenant A tries to attest tenant B's submission
        $service->attest(self::TENANT_A, $subB['id'], $adminA, 'approved');

        $row = DB::table('member_residency_verifications')->where('id', $subB['id'])->first();
        $this->assertSame('pending', (string) $row->status, 'Tenant A admin must not affect Tenant B record');
        $this->assertNull($row->attested_by);
    }

    public function test_list_for_admin_returns_only_own_tenant_records(): void
    {
        $service = new ResidencyVerificationService();
        $userA = $this->makeUser(self::TENANT_A, 'la.' . uniqid() . '@example.com');
        $userB = $this->makeUser(self::TENANT_B, 'lb.' . uniqid() . '@example.com');

        $service->submitDeclaration(self::TENANT_A, $userA, [
            'declared_municipality' => 'Zug',
            'declared_postcode'     => '6300',
        ]);
        $service->submitDeclaration(self::TENANT_B, $userB, [
            'declared_municipality' => 'Lugano',
            'declared_postcode'     => '6900',
        ]);

        $listA = $service->listForAdmin(self::TENANT_A);
        foreach ($listA as $row) {
            $this->assertSame((int) self::TENANT_A, (int) $row['tenant_id']);
        }
        $this->assertGreaterThanOrEqual(1, count($listA));
    }
}
