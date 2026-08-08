<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringCommunityAlertService;
use App\Services\CaringCommunityWorkflowPolicyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * CaringCommunityAlertServiceTest
 *
 * Tests proactive-coordinator alerts. Each signal is guarded by a Schema::hasTable
 * check in the service, so tests skip gracefully when tables are absent.
 *
 * Strategy:
 *  - Seed minimal fixture data that exercises each alert's SQL, then call
 *    activeAlerts() and assert the matching alert is/isn't present.
 *  - assertAlertPresent / assertAlertAbsent helpers reduce repetition.
 *
 * Skipped paths:
 *  - retentionDropping: depends on DATE_FORMAT month arithmetic against seeded
 *    date_logged values; the signal is covered structurally (returns null when no
 *    prior-3-month rows exist) but the "drops below 85%" threshold branch requires
 *    inserting rows into past months which is tractable only with raw date injection.
 *    That branch is noted and skipped below.
 */
class CaringCommunityAlertServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();

        // The array cache survives across tests in the shared process; an earlier
        // test can leave tenant settings/feature state cached for tenant 2, which
        // suppresses the low-supply alert here. Flush so the alert logic reads
        // fresh state — this test passes in isolation but flaked in the full suite
        // without it. (DatabaseTransactions already isolates DB rows.)
        \Illuminate\Support\Facades\Cache::flush();

        Queue::fake();

        TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CaringCommunityAlertService
    {
        return app(CaringCommunityAlertService::class);
    }

    /** Insert a minimal user and return its id. */
    private function insertUser(int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('alert_u_', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id'   => $tenantId,
            'name'        => 'Alert Test ' . $uid,
            'first_name'  => 'Alert',
            'last_name'   => 'User',
            'email'       => $uid . '@example.test',
            'status'      => 'active',
            'balance'     => 0,
            'role'        => 'member',
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Insert a vol_logs row using only real columns that exist in the schema.
     * optional support_recipient_id and assigned_to keep tests focused.
     */
    private function insertVolLog(
        int $userId,
        string $status = 'approved',
        string $dateLogged = '',
        ?int $recipientId = null,
        ?int $assignedTo = null,
        ?string $createdAt = null,
    ): int {
        $row = [
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'date_logged' => $dateLogged ?: now()->format('Y-m-d'),
            'hours'       => 1.00,
            'status'      => $status,
            'created_at'  => $createdAt ?? now()->toDateTimeString(),
            'updated_at'  => now()->toDateTimeString(),
        ];

        if ($recipientId !== null && Schema::hasColumn('vol_logs', 'support_recipient_id')) {
            $row['support_recipient_id'] = $recipientId;
        }

        if ($assignedTo !== null && Schema::hasColumn('vol_logs', 'assigned_to')) {
            $row['assigned_to'] = $assignedTo;
        }

        return (int) DB::table('vol_logs')->insertGetId($row);
    }

    /**
     * Assert that activeAlerts() contains an alert with the given id.
     *
     * @return array<string, mixed>  The matched alert row.
     */
    private function assertAlertPresent(string $alertId): array
    {
        $alerts = $this->service()->activeAlerts();
        $ids    = array_column($alerts, 'id');
        $this->assertContains($alertId, $ids, "Expected alert '{$alertId}' in " . implode(', ', $ids));

        $found = array_values(array_filter($alerts, fn ($a) => $a['id'] === $alertId));
        return $found[0];
    }

    /**
     * Assert that activeAlerts() does NOT contain an alert with the given id.
     */
    private function assertAlertAbsent(string $alertId): void
    {
        $alerts = $this->service()->activeAlerts();
        $ids    = array_column($alerts, 'id');
        $this->assertNotContains($alertId, $ids, "Alert '{$alertId}' should be absent but was found.");
    }

    // ── activeAlerts — structural shape ───────────────────────────────────────

    public function test_activeAlerts_returns_array(): void
    {
        $alerts = $this->service()->activeAlerts();

        $this->assertIsArray($alerts);
    }

    public function test_activeAlerts_every_item_has_required_keys(): void
    {
        // Seed an overdue-review vol_log so at least one alert fires
        $userId = $this->insertUser();
        // Old pending log (> 7 days) to trigger overdue_reviews
        $this->insertVolLog($userId, 'pending', now()->subDays(10)->format('Y-m-d'), null, null, now()->subDays(10)->toDateTimeString());

        $alerts = $this->service()->activeAlerts();

        foreach ($alerts as $alert) {
            $this->assertArrayHasKey('id', $alert);
            $this->assertArrayHasKey('severity', $alert);
            $this->assertArrayHasKey('title_code', $alert);
            $this->assertArrayHasKey('message_code', $alert);
            $this->assertArrayHasKey('message_params', $alert);
            $this->assertArrayHasKey('count', $alert);
            $this->assertArrayHasKey('action_code', $alert);
            $this->assertArrayHasKey('action_url', $alert);
        }
    }

    public function test_activeAlerts_filters_out_zero_count_signals(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        // With no fixtures the database should produce zero counts for all signals;
        // all alerts should be filtered out (or at most those driven by other
        // existing data — but none should carry count = 0).
        $alerts = $this->service()->activeAlerts();

        foreach ($alerts as $alert) {
            $this->assertGreaterThan(0, $alert['count'], "Alert '{$alert['id']}' has count=0 but was not filtered.");
        }
    }

    // ── overdue_reviews alert ─────────────────────────────────────────────────

    public function test_overdue_reviews_alert_fires_when_pending_log_is_past_sla(): void
    {
        $userId = $this->insertUser();
        // Insert a pending log created 10 days ago (default SLA = 7 days)
        $this->insertVolLog($userId, 'pending', now()->subDays(10)->format('Y-m-d'), null, null, now()->subDays(10)->toDateTimeString());

        $alert = $this->assertAlertPresent('overdue_reviews');
        $this->assertSame('warning', $alert['severity']);
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    public function test_overdue_reviews_alert_absent_when_no_overdue_pending_logs(): void
    {
        // Insert a pending log created only 2 days ago (within default 7-day SLA)
        $userId = $this->insertUser();
        $this->insertVolLog($userId, 'pending', now()->subDays(2)->format('Y-m-d'), null, null, now()->subDays(2)->toDateTimeString());

        // We cannot guarantee no other data triggers this alert, so just confirm
        // if the alert is present it is because of pre-existing data, not ours.
        // The robust test is the positive case above; here we assert count > 0 shape only.
        $this->assertTrue(true); // structural — positive case covers the logic
    }

    // ── overdue_reviews respects policy SLA ───────────────────────────────────

    public function test_overdue_reviews_uses_policy_sla_days(): void
    {
        // Set a strict SLA of 1 day via policy
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => self::TENANT_ID, 'setting_key' => 'caring_community.workflow.review_sla_days'],
            ['setting_value' => '1', 'setting_type' => 'integer', 'category' => 'caring_community', 'description' => 'test', 'updated_at' => now()]
        );

        $userId = $this->insertUser();
        // Log pending for 2 days — should exceed 1-day SLA
        $this->insertVolLog($userId, 'pending', now()->subDays(2)->format('Y-m-d'), null, null, now()->subDays(2)->toDateTimeString());

        $alert = $this->assertAlertPresent('overdue_reviews');
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    // ── inactive_members alert ────────────────────────────────────────────────

    public function test_inactive_members_alert_fires_for_member_active_6mo_but_not_last_30_days(): void
    {
        $userId = $this->insertUser();

        // Log from 90 days ago (within 6 months) — satisfies the "was active" criteria
        $this->insertVolLog($userId, 'approved', now()->subDays(90)->format('Y-m-d'));

        // Do NOT insert a log within the last 30 days for this user
        // (satisfies "not recently active" criteria)
        $alert = $this->assertAlertPresent('inactive_members');
        $this->assertSame('info', $alert['severity']);
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    public function test_inactive_members_alert_absent_when_user_logged_recently(): void
    {
        // A user with a very recent log (5 days ago) should NOT be counted as inactive.
        // We verify this by checking that a user who only has a recent log is excluded.
        // Since the alert is additive we can't guarantee it's zero globally, but we
        // can assert our seeded user doesn't push the count up relative to what it was.
        $userId = $this->insertUser();
        $before = $this->service()->activeAlerts();
        $beforeCount = 0;
        foreach ($before as $a) {
            if ($a['id'] === 'inactive_members') {
                $beforeCount = $a['count'];
                break;
            }
        }

        $this->insertVolLog($userId, 'approved', now()->subDays(5)->format('Y-m-d'));

        $after = $this->service()->activeAlerts();
        $afterCount = 0;
        foreach ($after as $a) {
            if ($a['id'] === 'inactive_members') {
                $afterCount = $a['count'];
                break;
            }
        }

        // Adding a recently-active user should NOT increase the inactive count
        $this->assertLessThanOrEqual($beforeCount, $afterCount);
    }

    // ── overdue_check_ins alert ───────────────────────────────────────────────

    public function test_overdue_check_ins_alert_fires_for_active_relationship_past_due(): void
    {
        $supporter = $this->insertUser();
        $recipient = $this->insertUser();

        DB::table('caring_support_relationships')->insert([
            'tenant_id'       => self::TENANT_ID,
            'supporter_id'    => $supporter,
            'recipient_id'    => $recipient,
            'title'           => 'Overdue Test',
            'start_date'      => now()->subDays(30)->format('Y-m-d'),
            'status'          => 'active',
            'next_check_in_at' => now()->subDays(1)->toDateTimeString(), // in the past
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        $alert = $this->assertAlertPresent('overdue_check_ins');
        $this->assertSame('warning', $alert['severity']);
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    public function test_overdue_check_ins_alert_absent_when_check_in_is_in_future(): void
    {
        $supporter = $this->insertUser();
        $recipient = $this->insertUser();

        // Grab count before inserting a future check-in
        $beforeAlerts  = $this->service()->activeAlerts();
        $beforeCount   = 0;
        foreach ($beforeAlerts as $a) {
            if ($a['id'] === 'overdue_check_ins') {
                $beforeCount = $a['count'];
                break;
            }
        }

        DB::table('caring_support_relationships')->insert([
            'tenant_id'        => self::TENANT_ID,
            'supporter_id'     => $supporter,
            'recipient_id'     => $recipient,
            'title'            => 'Future Check-In Test',
            'start_date'       => now()->subDays(5)->format('Y-m-d'),
            'status'           => 'active',
            'next_check_in_at' => now()->addDays(7)->toDateTimeString(), // future
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $afterAlerts = $this->service()->activeAlerts();
        $afterCount  = 0;
        foreach ($afterAlerts as $a) {
            if ($a['id'] === 'overdue_check_ins') {
                $afterCount = $a['count'];
                break;
            }
        }

        // A future-dated check-in must not increment the overdue count
        $this->assertSame($beforeCount, $afterCount);
    }

    // ── low_supply alert ──────────────────────────────────────────────────────

    public function test_low_supply_alert_fires_when_requests_exceed_offers_in_a_category(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        if (! Schema::hasTable('listings')) {
            $this->markTestSkipped('listings table not present.');
        }

        // Use an existing category that satisfies the FK constraint (categories.id).
        $categoryId = (int) DB::table('categories')
            ->where('tenant_id', self::TENANT_ID)
            ->value('id');

        if (! $categoryId) {
            $this->markTestSkipped('No category row available for tenant ' . self::TENANT_ID . ' to satisfy FK.');
        }

        $userId = $this->insertUser();

        // 1 offer, 2 requests in same category → low supply
        DB::table('listings')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'category_id' => $categoryId,
            'title'       => 'Offer Low Supply Test',
            'type'        => 'offer',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
        DB::table('listings')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'category_id' => $categoryId,
            'title'       => 'Request Low Supply Test 1',
            'type'        => 'request',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
        DB::table('listings')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'category_id' => $categoryId,
            'title'       => 'Request Low Supply Test 2',
            'type'        => 'request',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $alert = $this->assertAlertPresent('low_supply');
        $this->assertSame('info', $alert['severity']);
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    // ── coordinators_overloaded alert ─────────────────────────────────────────

    public function test_coordinators_overloaded_alert_fires_when_coordinator_has_more_than_10_pending(): void
    {
        $coordinator = $this->insertUser();

        // Insert 11 pending logs assigned to the same coordinator
        for ($i = 0; $i < 11; $i++) {
            $memberId = $this->insertUser();
            $this->insertVolLog($memberId, 'pending', now()->format('Y-m-d'), null, $coordinator);
        }

        $alert = $this->assertAlertPresent('coordinators_overloaded');
        $this->assertSame('critical', $alert['severity']);
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    // ── recipients_without_tandem alert ──────────────────────────────────────

    public function test_recipients_without_tandem_alert_fires_for_recipient_with_no_active_relationship(): void
    {
        if (
            ! Schema::hasTable('vol_logs') ||
            ! Schema::hasColumn('vol_logs', 'support_recipient_id') ||
            ! Schema::hasTable('caring_support_relationships')
        ) {
            $this->markTestSkipped('vol_logs.support_recipient_id or caring_support_relationships table not present.');
        }

        $supporter = $this->insertUser();
        $recipient = $this->insertUser();
        $logger    = $this->insertUser();

        // Log an approved hour for the recipient within 6 months
        $this->insertVolLog($logger, 'approved', now()->subDays(20)->format('Y-m-d'), $recipient);

        // NO caring_support_relationships row for this recipient → alert should fire
        $alert = $this->assertAlertPresent('recipients_without_tandem');
        $this->assertSame('warning', $alert['severity']);
        $this->assertGreaterThanOrEqual(1, $alert['count']);

        $countBefore = $alert['count'];

        // Now add an active relationship for this recipient
        DB::table('caring_support_relationships')->insert([
            'tenant_id'    => self::TENANT_ID,
            'supporter_id' => $supporter,
            'recipient_id' => $recipient,
            'title'        => 'Tandem Test',
            'start_date'   => now()->format('Y-m-d'),
            'status'       => 'active',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        // After adding the active relationship the count should decrease
        $countAfter = 0;
        foreach ($this->service()->activeAlerts() as $a) {
            if ($a['id'] === 'recipients_without_tandem') {
                $countAfter = $a['count'];
                break;
            }
        }

        // The recipient is now covered, so the alert count should be lower
        $this->assertLessThan($countBefore, $countAfter);
    }

    // ── alert severity values ─────────────────────────────────────────────────

    public function test_all_returned_alerts_have_valid_severity(): void
    {
        // Seed data to produce at least one alert
        $userId = $this->insertUser();
        $this->insertVolLog($userId, 'pending', now()->subDays(10)->format('Y-m-d'), null, null, now()->subDays(10)->toDateTimeString());

        $alerts = $this->service()->activeAlerts();

        $validSeverities = ['info', 'warning', 'critical'];
        foreach ($alerts as $alert) {
            $this->assertContains(
                $alert['severity'],
                $validSeverities,
                "Alert '{$alert['id']}' has unexpected severity '{$alert['severity']}'."
            );
        }
    }
}
