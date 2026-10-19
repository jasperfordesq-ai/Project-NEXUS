<?php
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\Database;
use App\Core\TenantContext;
use App\Services\ShiftGroupReservationService;
use App\Services\ShiftSwapService;
use App\Services\VolunteerCheckInService;
use App\Services\VolunteerService;
use Tests\Laravel\TestCase;

class VolunteerSecurityRegressionTest extends \Tests\Laravel\TestCase
{
    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
    }

    public function testGetOrganizationByIdHidesPendingByDefault(): void
    {
        $ownerId = $this->createUser('org-owner');
        $orgId = $this->createOrganization($ownerId, 'pending');

        $publicView = VolunteerService::getOrganizationById($orgId);
        $ownerView = VolunteerService::getOrganizationById($orgId, true);
        $publicBritishView = VolunteerService::getOrganisationById($orgId);
        $ownerBritishView = VolunteerService::getOrganisationById($orgId, true);

        $this->assertNull($publicView);
        $this->assertNotNull($ownerView);
        $this->assertSame($orgId, $ownerView['id']);
        $this->assertNull($publicBritishView);
        $this->assertNotNull($ownerBritishView);
        $this->assertSame($orgId, $ownerBritishView['id']);
    }

    public function testLogHoursRejectsNonApprovedOrganizations(): void
    {
        $ownerId = $this->createUser('suspended-org-owner');
        $volunteerId = $this->createUser('suspended-org-volunteer');
        $orgId = $this->createOrganization($ownerId, 'suspended');

        Database::query(
            "INSERT INTO org_members (tenant_id, organization_id, org_type, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'volunteer', ?, 'member', 'active', NOW(), NOW())",
            [self::TENANT_ID, $orgId, $volunteerId]
        );

        $logId = VolunteerService::logHours($volunteerId, [
            'organization_id' => $orgId,
            'date' => date('Y-m-d'),
            'hours' => 1,
            'description' => 'Attempted suspended organisation log',
        ]);

        $this->assertNull($logId);
        $errors = VolunteerService::getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('NOT_FOUND', $errors[0]['code']);
    }

    public function testOrganizationDetailHelpersSharePublicStatsContract(): void
    {
        $ownerId = $this->createUser('stats-owner');
        $volunteerId = $this->createUser('stats-volunteer');
        $orgId = $this->createOrganization($ownerId, 'approved');

        Database::query(
            "INSERT INTO vol_opportunities (tenant_id, organization_id, created_by, title, description, location, status, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 1, NOW())",
            [self::TENANT_ID, $orgId, $ownerId, 'Stats opportunity', 'Volunteer stats test', 'Remote']
        );
        $openOpportunityId = (int)Database::getInstance()->lastInsertId();

        Database::query(
            "INSERT INTO vol_opportunities (tenant_id, organization_id, created_by, title, description, location, status, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 'closed', 1, NOW())",
            [self::TENANT_ID, $orgId, $ownerId, 'Closed opportunity', 'Not public', 'Remote']
        );

        Database::query(
            "INSERT INTO vol_applications (tenant_id, opportunity_id, user_id, status, created_at) VALUES (?, ?, ?, 'approved', NOW())",
            [self::TENANT_ID, $openOpportunityId, $volunteerId]
        );

        Database::query(
            "INSERT INTO vol_logs (tenant_id, user_id, organization_id, opportunity_id, date_logged, hours, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NOW())",
            [self::TENANT_ID, $volunteerId, $orgId, $openOpportunityId, date('Y-m-d'), 2.5, 'Stats hours']
        );

        Database::query(
            "INSERT INTO vol_reviews (tenant_id, reviewer_id, target_type, target_id, rating, comment, created_at) VALUES (?, ?, 'organization', ?, 5, 'Great', NOW()), (?, ?, 'organization', ?, 3, 'Good', NOW())",
            [self::TENANT_ID, $volunteerId, $orgId, self::TENANT_ID, $ownerId, $orgId]
        );

        $legacy = VolunteerService::getOrganizationById($orgId);
        $modern = VolunteerService::getOrganisationById($orgId);

        $this->assertIsArray($legacy);
        $this->assertIsArray($modern);
        foreach (['opportunity_count', 'volunteer_count', 'total_hours', 'review_count', 'average_rating'] as $key) {
            $this->assertSame($modern[$key], $legacy[$key], "{$key} differs between organization detail helpers");
        }
        $this->assertSame(1, $legacy['opportunity_count']);
        $this->assertSame(1, $legacy['volunteer_count']);
        $this->assertSame(2.5, $legacy['total_hours']);
        $this->assertSame(2, $legacy['review_count']);
        $this->assertSame(4.0, $legacy['average_rating']);
        $this->assertSame(1, $legacy['stats']['volunteer_count']);
    }

    public function testGenerateTokenRequiresApprovedShiftAssignment(): void
    {
        $this->requireTables(['vol_shift_checkins']);

        $ownerId = $this->createUser('checkin-owner');
        $volunteerId = $this->createUser('checkin-volunteer');

        [, $shiftId] = $this->createOpportunityAndShift($ownerId);

        $token = VolunteerCheckInService::generateToken($shiftId, $volunteerId);

        $this->assertNull($token);
        $errors = VolunteerCheckInService::getTokenErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('FORBIDDEN', $errors[0]['code']);

        // Ensure no check-in row was created.
        $count = (int)Database::query(
            'SELECT COUNT(*) FROM vol_shift_checkins WHERE tenant_id = ? AND shift_id = ? AND user_id = ?',
            [self::TENANT_ID, $shiftId, $volunteerId]
        )->fetchColumn();
        $this->assertSame(0, $count);
    }

    public function testShiftCheckInsDoesNotExposeQrToken(): void
    {
        $this->requireTables(['vol_shift_checkins']);

        $ownerId = $this->createUser('checkins-owner');
        $volunteerId = $this->createUser('checkins-volunteer');

        [$opportunityId, $shiftId] = $this->createOpportunityAndShift($ownerId);

        Database::query(
            "INSERT INTO vol_applications (tenant_id, opportunity_id, user_id, shift_id, status, created_at) VALUES (?, ?, ?, ?, 'approved', NOW())",
            [self::TENANT_ID, $opportunityId, $volunteerId, $shiftId]
        );

        $token = VolunteerCheckInService::generateToken($shiftId, $volunteerId);
        $this->assertNotNull($token);

        $checkins = app(VolunteerCheckInService::class)->getShiftCheckIns($shiftId);
        $this->assertNotEmpty($checkins);
        $this->assertArrayNotHasKey('qr_token', $checkins[0]);
    }

    public function testGroupReservationRequiresGroupLeaderOrAdmin(): void
    {
        $this->requireTables(['vol_shift_group_reservations', 'vol_shift_group_members']);

        $groupOwnerId = $this->createUser('group-owner');
        $outsiderId = $this->createUser('group-outsider');

        [, $shiftId] = $this->createOpportunityAndShift($groupOwnerId);
        $groupId = $this->createGroup($groupOwnerId);

        $reservationId = ShiftGroupReservationService::reserve($shiftId, $groupId, $outsiderId, 2, 'security test');

        $this->assertNull($reservationId);
        $errors = ShiftGroupReservationService::getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('FORBIDDEN', $errors[0]['code']);
    }

    public function testSwapApprovalFailsAtomicallyWhenOneAssignmentIsMissing(): void
    {
        $this->requireTables(['vol_shift_swap_requests']);

        $ownerId = $this->createUser('swap-owner');
        $fromUserId = $this->createUser('swap-from');
        $toUserId = $this->createUser('swap-to');

        [$opportunityId, $fromShiftId] = $this->createOpportunityAndShift($ownerId);
        Database::query(
            'INSERT INTO vol_shifts (tenant_id, opportunity_id, start_time, end_time, capacity, created_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 4 DAY), DATE_ADD(DATE_ADD(NOW(), INTERVAL 4 DAY), INTERVAL 2 HOUR), 5, NOW())',
            [self::TENANT_ID, $opportunityId]
        );
        $toShiftId = (int)Database::getInstance()->lastInsertId();

        Database::query(
            "INSERT INTO vol_applications (tenant_id, opportunity_id, user_id, shift_id, status, created_at) VALUES (?, ?, ?, ?, 'approved', NOW())",
            [self::TENANT_ID, $opportunityId, $fromUserId, $fromShiftId]
        );
        $fromAppId = (int)Database::getInstance()->lastInsertId();

        Database::query(
            "INSERT INTO vol_applications (tenant_id, opportunity_id, user_id, shift_id, status, created_at) VALUES (?, ?, ?, ?, 'approved', NOW())",
            [self::TENANT_ID, $opportunityId, $toUserId, $toShiftId]
        );
        $toAppId = (int)Database::getInstance()->lastInsertId();

        Database::query(
            "INSERT INTO vol_shift_swap_requests (tenant_id, from_user_id, to_user_id, from_shift_id, to_shift_id, status, requires_admin_approval, message, created_at) VALUES (?, ?, ?, ?, ?, 'admin_pending', 1, 'regression-test', NOW())",
            [self::TENANT_ID, $fromUserId, $toUserId, $fromShiftId, $toShiftId]
        );
        $swapId = (int)Database::getInstance()->lastInsertId();

        // Simulate stale state: target volunteer no longer assigned at approval time.
        Database::query(
            'UPDATE vol_applications SET shift_id = NULL WHERE id = ? AND tenant_id = ?',
            [$toAppId, self::TENANT_ID]
        );

        $result = ShiftSwapService::adminDecision($swapId, $ownerId, 'approve');
        $this->assertFalse($result);
        $errors = ShiftSwapService::getErrors();
        $this->assertNotEmpty($errors);
        // Since 19 Oct 2026 a request whose volunteer has left the shift is retired
        // as `expired` before the admin's decision is applied, and the refusal says
        // so (DECISION_CONFLICT) rather than failing mid-execution (VALIDATION_ERROR).
        // The property this test protects is unchanged: nothing moves.
        $this->assertSame('DECISION_CONFLICT', $errors[0]['code']);

        $fromShiftAfter = (int)Database::query(
            'SELECT shift_id FROM vol_applications WHERE id = ? AND tenant_id = ?',
            [$fromAppId, self::TENANT_ID]
        )->fetchColumn();
        $this->assertSame($fromShiftId, $fromShiftAfter);

        $swapStatus = (string)Database::query(
            'SELECT status FROM vol_shift_swap_requests WHERE id = ? AND tenant_id = ?',
            [$swapId, self::TENANT_ID]
        )->fetchColumn();
        $this->assertSame('expired', $swapStatus, 'a request that cannot complete is retired, never left for the admin to retry');
    }

    private function createUser(string $prefix): int
    {
        $uniq = $prefix . '-' . str_replace('.', '', (string)microtime(true)) . '-' . random_int(1000, 9999);
        Database::query(
            'INSERT INTO users (tenant_id, email, username, first_name, last_name, name, balance, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())',
            [self::TENANT_ID, $uniq . '@example.test', $uniq, 'Test', 'User', 'Test User', 0]
        );

        return (int)Database::getInstance()->lastInsertId();
    }

    private function createOrganization(int $ownerId, string $status = 'approved'): int
    {
        $uniq = 'org-' . str_replace('.', '', (string)microtime(true)) . '-' . random_int(1000, 9999);
        Database::query(
            'INSERT INTO vol_organizations (tenant_id, user_id, name, description, contact_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [self::TENANT_ID, $ownerId, $uniq, 'Security test organization description', $uniq . '@example.test', $status]
        );

        return (int)Database::getInstance()->lastInsertId();
    }

    /**
     * @return array{0:int,1:int}
     */
    private function createOpportunityAndShift(int $ownerId): array
    {
        $orgId = $this->createOrganization($ownerId, 'approved');
        $uniq = 'opp-' . str_replace('.', '', (string)microtime(true)) . '-' . random_int(1000, 9999);

        Database::query(
            "INSERT INTO vol_opportunities (tenant_id, organization_id, created_by, title, description, location, status, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 1, NOW())",
            [self::TENANT_ID, $orgId, $ownerId, $uniq, 'Security test opportunity', 'Remote']
        );
        $opportunityId = (int)Database::getInstance()->lastInsertId();

        Database::query(
            'INSERT INTO vol_shifts (tenant_id, opportunity_id, start_time, end_time, capacity, created_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 3 DAY), DATE_ADD(DATE_ADD(NOW(), INTERVAL 3 DAY), INTERVAL 2 HOUR), 5, NOW())',
            [self::TENANT_ID, $opportunityId]
        );
        $shiftId = (int)Database::getInstance()->lastInsertId();

        return [$opportunityId, $shiftId];
    }

    private function createGroup(int $ownerId): int
    {
        $uniq = 'grp-' . str_replace('.', '', (string)microtime(true)) . '-' . random_int(1000, 9999);
        Database::query(
            "INSERT INTO `groups` (tenant_id, owner_id, name, description, visibility, is_active, created_at) VALUES (?, ?, ?, ?, 'public', 1, NOW())",
            [self::TENANT_ID, $ownerId, $uniq, 'Security test group']
        );

        return (int)Database::getInstance()->lastInsertId();
    }

    /**
     * @param string[] $tables
     */
    private function requireTables(array $tables): void
    {
        foreach ($tables as $table) {
            $exists = (int)Database::query(
                'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
                [$table]
            )->fetchColumn();

            if ($exists === 0) {
                $this->markTestSkipped("Required table not present in test DB: {$table}");
            }
        }
    }
}
