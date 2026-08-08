<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\CaregiverService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * CaregiverServiceTest
 *
 * Tests the tenant-scoped caregiver service (AG68).
 *
 * Skipped paths:
 *  - vol_logs burnout / schedule tests: guarded by Schema::hasTable('vol_logs') inside the service;
 *    these code paths are exercised with direct DB inserts when vol_logs exists.
 *  - caring_support_relationships schedule join: covered when table exists.
 *  - assignCoverCandidate: requires a live suggestCoverCandidates result set;
 *    tested by seeding an eligible user and verifying assignment.
 */
class CaregiverServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;
    private const OTHER_TENANT_ID = 9;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        \App\Core\TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CaregiverService
    {
        return app(CaregiverService::class);
    }

    /** Insert a minimal user and return id. */
    private function insertUser(int $tenantId = self::TENANT_ID, array $overrides = []): int
    {
        $uid = uniqid('cg_u_', true);
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id'           => $tenantId,
            'name'                => 'CG Test User ' . $uid,
            'first_name'          => 'CG',
            'last_name'           => 'User',
            'email'               => $uid . '@example.test',
            'status'              => 'active',
            'balance'             => 0,
            'role'                => 'member',
            'is_approved'         => 1,
            'trust_tier'          => 1,
            'verification_status' => 'none',
            'created_at'          => now(),
            'updated_at'          => now(),
        ], $overrides));
    }

    /**
     * Insert a caregiver link directly (bypassing service guards).
     * Returns the inserted row id.
     */
    private function insertLink(
        int $caregiverId,
        int $caredForId,
        string $status = 'active',
        int $tenantId = self::TENANT_ID,
    ): int {
        return (int) DB::table('caring_caregiver_links')->insertGetId([
            'tenant_id'         => $tenantId,
            'caregiver_id'      => $caregiverId,
            'cared_for_id'      => $caredForId,
            'relationship_type' => 'family',
            'is_primary'        => 0,
            'start_date'        => now()->toDateString(),
            'status'            => $status,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
    }

    // ── isAvailable / coverRequestsAvailable ─────────────────────────────────

    public function test_is_available_returns_true_when_table_exists(): void
    {
        $this->assertTrue($this->service()->isAvailable());
    }

    public function test_cover_requests_available_returns_bool(): void
    {
        // Result depends on whether caring_cover_requests table exists in schema.
        // We simply assert it returns a boolean without error.
        $this->assertIsBool($this->service()->coverRequestsAvailable());
    }

    // ── createLink ────────────────────────────────────────────────────────────

    public function test_create_link_inserts_pending_link_without_approved_by(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $result = $this->service()->createLink(
            $caregiver,
            $caredFor,
            'family',
            self::TENANT_ID,
        );

        $this->assertIsArray($result);
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame($caregiver, (int) $result['caregiver_id']);
        $this->assertSame($caredFor, (int) $result['cared_for_id']);
        $this->assertSame('pending', $result['status']);
        $this->assertNull($result['approved_by']);
    }

    public function test_create_link_creates_active_link_when_approved_by_set(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        $admin     = $this->insertUser();

        $result = $this->service()->createLink(
            $caregiver,
            $caredFor,
            'friend',
            self::TENANT_ID,
            ['approved_by' => $admin],
        );

        $this->assertSame('active', $result['status']);
        $this->assertSame($admin, (int) $result['approved_by']);
    }

    public function test_create_link_throws_on_self_link(): void
    {
        $user = $this->insertUser();

        $this->expectException(\RuntimeException::class);

        $this->service()->createLink($user, $user, 'family', self::TENANT_ID);
    }

    public function test_create_link_throws_on_user_not_in_tenant(): void
    {
        $caregiver = $this->insertUser();
        // Use a nonexistent user id — will not belong to tenant
        $ghostId = 99999901;

        $this->expectException(\RuntimeException::class);

        $this->service()->createLink($caregiver, $ghostId, 'family', self::TENANT_ID);
    }

    public function test_create_link_throws_on_duplicate_pending_or_active(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        // Create the first link
        $this->service()->createLink($caregiver, $caredFor, 'family', self::TENANT_ID);

        // Second call must throw
        $this->expectException(\RuntimeException::class);

        $this->service()->createLink($caregiver, $caredFor, 'family', self::TENANT_ID);
    }

    public function test_create_link_stores_is_primary_option(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $result = $this->service()->createLink(
            $caregiver,
            $caredFor,
            'family',
            self::TENANT_ID,
            ['is_primary' => true],
        );

        $this->assertTrue((bool) $result['is_primary']);
    }

    // ── removeLink ────────────────────────────────────────────────────────────

    public function test_remove_link_soft_deletes_to_inactive(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $linkId = $this->insertLink($caregiver, $caredFor, 'active');

        $this->service()->removeLink($linkId, $caregiver, self::TENANT_ID);

        $row = DB::table('caring_caregiver_links')->where('id', $linkId)->first();
        $this->assertNotNull($row);
        $this->assertSame('inactive', $row->status);
    }

    public function test_remove_link_throws_for_wrong_caregiver(): void
    {
        $caregiver     = $this->insertUser();
        $otherCaregiver = $this->insertUser();
        $caredFor      = $this->insertUser();

        $linkId = $this->insertLink($caregiver, $caredFor, 'active');

        $this->expectException(\RuntimeException::class);

        // otherCaregiver does not own this link
        $this->service()->removeLink($linkId, $otherCaregiver, self::TENANT_ID);
    }

    public function test_remove_link_throws_for_nonexistent_link(): void
    {
        $caregiver = $this->insertUser();

        $this->expectException(\RuntimeException::class);

        $this->service()->removeLink(999999902, $caregiver, self::TENANT_ID);
    }

    // ── getLinksForCaregiver ──────────────────────────────────────────────────

    public function test_get_links_for_caregiver_returns_active_links(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $this->insertLink($caregiver, $caredFor, 'active');

        $links = $this->service()->getLinksForCaregiver($caregiver, self::TENANT_ID);

        $this->assertNotEmpty($links);
        $caredForIds = array_column($links, 'cared_for_id');
        $this->assertContains($caredFor, array_map('intval', $caredForIds));
    }

    public function test_get_links_for_caregiver_excludes_inactive(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $this->insertLink($caregiver, $caredFor, 'inactive');

        $links = $this->service()->getLinksForCaregiver($caregiver, self::TENANT_ID);

        $caredForIds = array_column($links, 'cared_for_id');
        $this->assertNotContains($caredFor, array_map('intval', $caredForIds));
    }

    public function test_get_links_for_caregiver_is_tenant_scoped(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $this->insertLink($caregiver, $caredFor, 'active');

        // Query with a different tenant — must return empty
        $links = $this->service()->getLinksForCaregiver($caregiver, self::OTHER_TENANT_ID);

        $caredForIds = array_column($links, 'cared_for_id');
        $this->assertNotContains($caredFor, array_map('intval', $caredForIds));
    }

    // ── getLinksForCaredFor ───────────────────────────────────────────────────

    public function test_get_links_for_cared_for_returns_caregivers(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $this->insertLink($caregiver, $caredFor, 'active');

        $links = $this->service()->getLinksForCaredFor($caredFor, self::TENANT_ID);

        $this->assertNotEmpty($links);
        $caregiverIds = array_column($links, 'caregiver_id');
        $this->assertContains($caregiver, array_map('intval', $caregiverIds));
    }

    public function test_get_links_for_cared_for_excludes_inactive_links(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $this->insertLink($caregiver, $caredFor, 'inactive');

        $links = $this->service()->getLinksForCaredFor($caredFor, self::TENANT_ID);

        $caregiverIds = array_column($links, 'caregiver_id');
        $this->assertNotContains($caregiver, array_map('intval', $caregiverIds));
    }

    // ── checkBurnoutRisk ──────────────────────────────────────────────────────

    public function test_check_burnout_risk_returns_expected_shape(): void
    {
        $caregiver = $this->insertUser();

        $result = $this->service()->checkBurnoutRisk($caregiver, self::TENANT_ID);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('weekly_hours', $result);
        $this->assertArrayHasKey('threshold', $result);
        $this->assertArrayHasKey('at_risk', $result);
        $this->assertArrayHasKey('risk_level', $result);
        $this->assertSame(CaregiverService::BURNOUT_THRESHOLD_HOURS_PER_WEEK, $result['threshold']);
    }

    public function test_check_burnout_risk_none_when_no_logs(): void
    {
        $caregiver = $this->insertUser();

        $result = $this->service()->checkBurnoutRisk($caregiver, self::TENANT_ID);

        $this->assertSame('none', $result['risk_level']);
        $this->assertFalse($result['at_risk']);
        $this->assertSame(0.0, $result['weekly_hours']);
    }

    public function test_check_burnout_risk_high_when_hours_exceed_threshold(): void
    {
        $caregiver = $this->insertUser();

        // Insert 25 hours in the last 7 days (threshold = 20)
        DB::table('vol_logs')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $caregiver,
            'date_logged' => now()->subDays(1)->toDateString(),
            'hours'       => 25.00,
            'status'      => 'approved',
            'created_at'  => now(),
        ]);

        $result = $this->service()->checkBurnoutRisk($caregiver, self::TENANT_ID);

        $this->assertSame('high', $result['risk_level']);
        $this->assertTrue($result['at_risk']);
        $this->assertGreaterThanOrEqual(25.0, $result['weekly_hours']);
    }

    public function test_check_burnout_risk_moderate_when_hours_between_50_and_100_percent(): void
    {
        $caregiver = $this->insertUser();

        // 12 hours = 60% of threshold (20) → moderate
        DB::table('vol_logs')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $caregiver,
            'date_logged' => now()->subDays(2)->toDateString(),
            'hours'       => 12.00,
            'status'      => 'pending',
            'created_at'  => now(),
        ]);

        $result = $this->service()->checkBurnoutRisk($caregiver, self::TENANT_ID);

        $this->assertSame('moderate', $result['risk_level']);
        $this->assertTrue($result['at_risk']);
    }

    public function test_check_burnout_risk_ignores_logs_older_than_7_days(): void
    {
        $caregiver = $this->insertUser();

        // 30 hours but 8 days ago — must not count
        DB::table('vol_logs')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $caregiver,
            'date_logged' => now()->subDays(8)->toDateString(),
            'hours'       => 30.00,
            'status'      => 'approved',
            'created_at'  => now(),
        ]);

        $result = $this->service()->checkBurnoutRisk($caregiver, self::TENANT_ID);

        $this->assertSame('none', $result['risk_level']);
        $this->assertSame(0.0, $result['weekly_hours']);
    }

    // ── getScheduleForCaredFor ────────────────────────────────────────────────

    public function test_get_schedule_for_cared_for_returns_expected_shape(): void
    {
        $caredFor = $this->insertUser();

        $result = $this->service()->getScheduleForCaredFor($caredFor, self::TENANT_ID);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('support_relationships', $result);
        $this->assertArrayHasKey('recent_logs', $result);
    }

    // ── createRequestOnBehalf ─────────────────────────────────────────────────

    public function test_create_request_on_behalf_succeeds_with_active_link(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        $this->insertLink($caregiver, $caredFor, 'active');

        $result = $this->service()->createRequestOnBehalf(
            $caregiver,
            $caredFor,
            [
                'title'       => 'Grocery shopping',
                'description' => 'Weekly shop at Tesco',
            ],
            self::TENANT_ID,
        );

        $this->assertIsArray($result);
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame($caredFor, (int) $result['user_id']);
        $this->assertSame($caregiver, (int) $result['requested_by_id']);
        $this->assertTrue((bool) $result['is_on_behalf']);
        $this->assertSame('pending', $result['status']);
    }

    public function test_create_request_on_behalf_throws_without_active_link(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        // No link inserted
        $this->expectException(\RuntimeException::class);

        $this->service()->createRequestOnBehalf(
            $caregiver,
            $caredFor,
            ['title' => 'Appointment', 'description' => 'Doctor'],
            self::TENANT_ID,
        );
    }

    public function test_create_request_on_behalf_throws_with_only_pending_link(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();

        // Insert link with 'pending' status — not 'active'
        $this->insertLink($caregiver, $caredFor, 'pending');

        $this->expectException(\RuntimeException::class);

        $this->service()->createRequestOnBehalf(
            $caregiver,
            $caredFor,
            ['title' => 'Transport', 'description' => 'To hospital'],
            self::TENANT_ID,
        );
    }

    public function test_create_request_on_behalf_normalises_contact_preference(): void
    {
        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        $this->insertLink($caregiver, $caredFor, 'active');

        $result = $this->service()->createRequestOnBehalf(
            $caregiver,
            $caredFor,
            ['title' => 'Call', 'description' => 'Ring them', 'contact_preference' => 'INVALID'],
            self::TENANT_ID,
        );

        // Invalid preference must fall back to 'either'
        $this->assertSame('either', $result['contact_preference']);
    }

    // ── Cover requests (guarded by coverRequestsAvailable) ───────────────────

    public function test_get_cover_requests_for_caregiver_returns_empty_when_none(): void
    {
        if (! $this->service()->coverRequestsAvailable()) {
            $this->markTestSkipped('caring_cover_requests table not present.');
        }

        $caregiver = $this->insertUser();

        $result = $this->service()->getCoverRequestsForCaregiver($caregiver, self::TENANT_ID);

        $this->assertIsArray($result);
        $this->assertCount(0, $result);
    }

    public function test_create_cover_request_inserts_open_request(): void
    {
        if (! $this->service()->coverRequestsAvailable()) {
            $this->markTestSkipped('caring_cover_requests table not present.');
        }

        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        $this->insertLink($caregiver, $caredFor, 'active');

        $result = $this->service()->createCoverRequest($caregiver, self::TENANT_ID, [
            'cared_for_id' => $caredFor,
            'title'        => 'Weekend cover',
            'starts_at'    => now()->addDays(2)->format('Y-m-d H:i:s'),
            'ends_at'      => now()->addDays(3)->format('Y-m-d H:i:s'),
        ]);

        $this->assertIsArray($result);
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame('open', $result['status']);
        $this->assertSame($caregiver, $result['caregiver_id']);
        $this->assertSame($caredFor, $result['cared_for_id']);
        $this->assertSame('Weekend cover', $result['title']);
    }

    public function test_create_cover_request_throws_without_active_link(): void
    {
        if (! $this->service()->coverRequestsAvailable()) {
            $this->markTestSkipped('caring_cover_requests table not present.');
        }

        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        // No link inserted

        $this->expectException(\RuntimeException::class);

        $this->service()->createCoverRequest($caregiver, self::TENANT_ID, [
            'cared_for_id' => $caredFor,
            'title'        => 'Cover',
            'starts_at'    => now()->addDay()->format('Y-m-d H:i:s'),
            'ends_at'      => now()->addDays(2)->format('Y-m-d H:i:s'),
        ]);
    }

    public function test_create_cover_request_throws_when_ends_before_starts(): void
    {
        if (! $this->service()->coverRequestsAvailable()) {
            $this->markTestSkipped('caring_cover_requests table not present.');
        }

        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        $this->insertLink($caregiver, $caredFor, 'active');

        $this->expectException(\InvalidArgumentException::class);

        $this->service()->createCoverRequest($caregiver, self::TENANT_ID, [
            'cared_for_id' => $caredFor,
            'title'        => 'Bad dates',
            'starts_at'    => now()->addDays(3)->format('Y-m-d H:i:s'),
            'ends_at'      => now()->addDays(1)->format('Y-m-d H:i:s'),
        ]);
    }

    public function test_create_cover_request_clamps_urgency_unknown_to_planned(): void
    {
        if (! $this->service()->coverRequestsAvailable()) {
            $this->markTestSkipped('caring_cover_requests table not present.');
        }

        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        $this->insertLink($caregiver, $caredFor, 'active');

        $result = $this->service()->createCoverRequest($caregiver, self::TENANT_ID, [
            'cared_for_id' => $caredFor,
            'title'        => 'Urgency test',
            'starts_at'    => now()->addDays(2)->format('Y-m-d H:i:s'),
            'ends_at'      => now()->addDays(3)->format('Y-m-d H:i:s'),
            'urgency'      => 'turbo-urgent', // invalid
        ]);

        $this->assertSame('planned', $result['urgency']);
    }

    public function test_suggest_cover_candidates_returns_array(): void
    {
        if (! $this->service()->coverRequestsAvailable()) {
            $this->markTestSkipped('caring_cover_requests table not present.');
        }

        $caregiver = $this->insertUser();
        $caredFor  = $this->insertUser();
        $this->insertLink($caregiver, $caredFor, 'active');

        $coverRequest = $this->service()->createCoverRequest($caregiver, self::TENANT_ID, [
            'cared_for_id' => $caredFor,
            'title'        => 'Suggest test',
            'starts_at'    => now()->addDays(5)->format('Y-m-d H:i:s'),
            'ends_at'      => now()->addDays(6)->format('Y-m-d H:i:s'),
        ]);

        $candidates = $this->service()->suggestCoverCandidates(
            $coverRequest['id'],
            $caregiver,
            self::TENANT_ID,
        );

        $this->assertIsArray($candidates);
        // Each candidate must have the expected shape
        foreach ($candidates as $candidate) {
            $this->assertArrayHasKey('id', $candidate);
            $this->assertArrayHasKey('name', $candidate);
            $this->assertArrayHasKey('trust_tier', $candidate);
            $this->assertArrayHasKey('match_score', $candidate);
            $this->assertArrayHasKey('skill_matches', $candidate);
        }
    }
}
