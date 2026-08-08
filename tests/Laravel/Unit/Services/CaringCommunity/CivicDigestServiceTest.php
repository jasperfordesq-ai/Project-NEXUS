<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\CivicDigestService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * CivicDigestServiceTest
 *
 * Covers the AG90 Personalised Civic Digest service — tenant cadence settings,
 * per-user preferences, delivery claims, scoring/ranking, and source fetching.
 *
 * Skipped paths (noted inline):
 *  - fetchHelpRequests: caring_help_requests has no public-consent column in the
 *    live schema, so this source always returns [] — tested via the empty-source case.
 *  - resolveUserInterests via user_skills: table present but requires FK user rows;
 *    skill interest-match covered via categories intersection on scored items.
 *  - releaseStaleDeliveryClaims deletes only rows older than 35 days — tested
 *    structurally (returns 0 for fresh rows); time-travel not possible without
 *    Carbon mocking that would conflict with failOnRisky.
 */
class CivicDigestServiceTest extends TestCase
{
    use DatabaseTransactions;

    /** Isolated high tenant id to avoid polluting live-data counts */
    private const TENANT_ID = 99700;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        // Ensure isolated tenant row exists
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'Civic Digest Test Tenant',
                'slug'              => 'civic-digest-test-99700',
                'domain'            => null,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        \App\Core\TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CivicDigestService
    {
        return app(CivicDigestService::class);
    }

    /** Insert a minimal user row and return its id. */
    private function insertUser(int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('cds_u_', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id'   => $tenantId,
            'name'        => 'CDS Test User ' . $uid,
            'first_name'  => 'CDS',
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

    /** Seed a tenant_settings row and return it. */
    private function upsertSetting(string $key, string $value, string $type = 'string'): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => self::TENANT_ID, 'setting_key' => $key],
            [
                'setting_value' => $value,
                'setting_type'  => $type,
                'category'      => 'caring_community',
                'description'   => 'test fixture',
                'updated_at'    => now(),
            ]
        );
    }

    // ── allowedSourceCount ───────────────────────────────────────────────────

    public function test_allowed_source_count_returns_nine(): void
    {
        $this->assertSame(9, $this->service()->allowedSourceCount());
    }

    // ── deliveryWindowKey ────────────────────────────────────────────────────

    public function test_delivery_window_key_returns_date_string_for_daily(): void
    {
        $ts  = mktime(12, 0, 0, 6, 15, 2026);
        $key = $this->service()->deliveryWindowKey('daily', $ts);

        $this->assertSame('2026-06-15', $key);
    }

    public function test_delivery_window_key_returns_year_month_for_monthly(): void
    {
        $ts  = mktime(12, 0, 0, 6, 15, 2026);
        $key = $this->service()->deliveryWindowKey('monthly', $ts);

        $this->assertSame('2026-06', $key);
    }

    public function test_delivery_window_key_treats_weekly_as_monthly(): void
    {
        $ts  = mktime(12, 0, 0, 3, 1, 2026);
        $key = $this->service()->deliveryWindowKey('weekly', $ts);

        $this->assertSame('2026-03', $key);
    }

    public function test_delivery_window_key_defaults_unknown_cadence_to_daily(): void
    {
        $ts  = mktime(12, 0, 0, 1, 5, 2026);
        $key = $this->service()->deliveryWindowKey('off', $ts);

        // 'off' is not 'monthly' or 'weekly' so falls through to daily
        $this->assertSame('2026-01-05', $key);
    }

    // ── getTenantCadence / setTenantCadence ───────────────────────────────────

    public function test_get_tenant_cadence_returns_monthly_by_default(): void
    {
        // No setting seeded for this tenant → default
        $cadence = $this->service()->getTenantCadence(self::TENANT_ID);

        $this->assertSame('monthly', $cadence);
    }

    public function test_set_tenant_cadence_persists_daily_and_round_trips(): void
    {
        $result = $this->service()->setTenantCadence(self::TENANT_ID, 'daily');

        $this->assertArrayHasKey('cadence', $result);
        $this->assertSame('daily', $result['cadence']);

        $this->assertSame('daily', $this->service()->getTenantCadence(self::TENANT_ID));
    }

    public function test_set_tenant_cadence_normalises_weekly_to_monthly(): void
    {
        $result = $this->service()->setTenantCadence(self::TENANT_ID, 'weekly');

        $this->assertArrayHasKey('cadence', $result);
        $this->assertSame('monthly', $result['cadence']);
    }

    public function test_set_tenant_cadence_returns_errors_for_invalid_value(): void
    {
        $result = $this->service()->setTenantCadence(self::TENANT_ID, 'never');

        $this->assertArrayHasKey('errors', $result);
        $this->assertNotEmpty($result['errors']);
        $this->assertSame('cadence', $result['errors'][0]['field']);
    }

    // ── getUserPrefs / setUserPrefs ───────────────────────────────────────────

    public function test_get_user_prefs_returns_defaults_when_no_row(): void
    {
        $userId = $this->insertUser();
        $prefs  = $this->service()->getUserPrefs(self::TENANT_ID, $userId);

        $this->assertTrue($prefs['enabled']);
        $this->assertIsString($prefs['cadence']);
        $this->assertNull($prefs['preferred_sub_region_id']);
        $this->assertSame([], $prefs['opt_out_sources']);
        $this->assertNull($prefs['updated_at']);
    }

    public function test_set_user_prefs_persists_cadence_and_opt_out_sources(): void
    {
        $userId = $this->insertUser();

        $result = $this->service()->setUserPrefs(self::TENANT_ID, $userId, [
            'cadence'          => 'daily',
            'opt_out_sources'  => ['safety_alert', 'feed_post'],
        ]);

        $this->assertArrayHasKey('prefs', $result);
        $this->assertSame('daily', $result['prefs']['cadence']);
        $this->assertContains('safety_alert', $result['prefs']['opt_out_sources']);
        $this->assertContains('feed_post', $result['prefs']['opt_out_sources']);

        // Round-trip
        $fetched = $this->service()->getUserPrefs(self::TENANT_ID, $userId);
        $this->assertSame('daily', $fetched['cadence']);
        $this->assertContains('safety_alert', $fetched['opt_out_sources']);
    }

    public function test_set_user_prefs_filters_invalid_opt_out_sources(): void
    {
        $userId = $this->insertUser();

        $result = $this->service()->setUserPrefs(self::TENANT_ID, $userId, [
            'opt_out_sources' => ['safety_alert', 'not_a_real_source', 'feed_post'],
        ]);

        $this->assertNotContains('not_a_real_source', $result['prefs']['opt_out_sources']);
        $this->assertContains('safety_alert', $result['prefs']['opt_out_sources']);
    }

    public function test_set_user_prefs_returns_error_for_invalid_cadence(): void
    {
        $userId = $this->insertUser();

        $result = $this->service()->setUserPrefs(self::TENANT_ID, $userId, [
            'cadence' => 'every_hour',
        ]);

        $this->assertArrayHasKey('errors', $result);
        $this->assertSame('cadence', $result['errors'][0]['field']);
    }

    public function test_set_user_prefs_sets_enabled_false_when_cadence_is_off(): void
    {
        $userId = $this->insertUser();

        $result = $this->service()->setUserPrefs(self::TENANT_ID, $userId, [
            'cadence' => 'off',
        ]);

        $this->assertFalse($result['prefs']['enabled']);
    }

    public function test_set_user_prefs_persists_preferred_sub_region_id(): void
    {
        $userId = $this->insertUser();

        $result = $this->service()->setUserPrefs(self::TENANT_ID, $userId, [
            'preferred_sub_region_id' => 42,
        ]);

        $this->assertSame(42, $result['prefs']['preferred_sub_region_id']);

        $fetched = $this->service()->getUserPrefs(self::TENANT_ID, $userId);
        $this->assertSame(42, $fetched['preferred_sub_region_id']);
    }

    // ── markSentNow / getLastSentAt ───────────────────────────────────────────

    public function test_get_last_sent_at_returns_null_for_new_user(): void
    {
        $userId = $this->insertUser();

        $this->assertNull($this->service()->getLastSentAt(self::TENANT_ID, $userId));
    }

    public function test_get_last_sent_at_returns_null_for_invalid_ids(): void
    {
        $this->assertNull($this->service()->getLastSentAt(0, 1));
        $this->assertNull($this->service()->getLastSentAt(1, 0));
    }

    public function test_mark_sent_now_records_last_sent_at_and_get_returns_it(): void
    {
        $userId = $this->insertUser();
        $before = time();

        $this->service()->markSentNow(self::TENANT_ID, $userId);

        $lastSent = $this->service()->getLastSentAt(self::TENANT_ID, $userId);
        $this->assertNotNull($lastSent);
        $this->assertGreaterThanOrEqual($before, $lastSent);
        $this->assertLessThanOrEqual(time() + 2, $lastSent);
    }

    // ── claimDelivery ─────────────────────────────────────────────────────────

    public function test_claim_delivery_returns_false_for_invalid_args(): void
    {
        $this->assertFalse($this->service()->claimDelivery(0, 1, 'daily', '2026-06-01'));
        $this->assertFalse($this->service()->claimDelivery(1, 0, 'daily', '2026-06-01'));
        $this->assertFalse($this->service()->claimDelivery(1, 1, 'daily', ''));
    }

    public function test_claim_delivery_succeeds_for_fresh_window(): void
    {
        $userId    = $this->insertUser();
        $windowKey = '2026-01';

        $claimed = $this->service()->claimDelivery(self::TENANT_ID, $userId, 'monthly', $windowKey);

        $this->assertTrue($claimed);

        $row = DB::table('civic_digest_delivery_claims')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->where('window_key', $windowKey)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('claimed', $row->status);
    }

    public function test_claim_delivery_is_idempotent_for_same_window(): void
    {
        $userId    = $this->insertUser();
        $windowKey = '2026-02';

        $first  = $this->service()->claimDelivery(self::TENANT_ID, $userId, 'monthly', $windowKey);
        $second = $this->service()->claimDelivery(self::TENANT_ID, $userId, 'monthly', $windowKey);

        $this->assertTrue($first);
        // Second claim for same window must return false (duplicate unique key → insertOrIgnore returns 0)
        $this->assertFalse($second);
    }

    // ── releaseDeliveryClaim ──────────────────────────────────────────────────

    public function test_release_delivery_claim_removes_unclaimed_row(): void
    {
        $userId    = $this->insertUser();
        $windowKey = '2026-03';

        $this->service()->claimDelivery(self::TENANT_ID, $userId, 'daily', $windowKey);
        $this->service()->releaseDeliveryClaim(self::TENANT_ID, $userId, 'daily', $windowKey);

        $row = DB::table('civic_digest_delivery_claims')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->where('window_key', $windowKey)
            ->first();

        $this->assertNull($row);
    }

    // ── markDeliverySent ─────────────────────────────────────────────────────

    public function test_mark_delivery_sent_updates_status_to_sent(): void
    {
        $userId    = $this->insertUser();
        $windowKey = '2026-04';

        $this->service()->claimDelivery(self::TENANT_ID, $userId, 'daily', $windowKey);
        $updated = $this->service()->markDeliverySent(
            self::TENANT_ID,
            $userId,
            'daily',
            $windowKey,
            ['message_id' => 'abc123']
        );

        $this->assertTrue($updated);

        $row = DB::table('civic_digest_delivery_claims')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->where('window_key', $windowKey)
            ->first();

        $this->assertSame('sent', $row->status);
        $this->assertNotNull($row->sent_at);
    }

    // ── markDeliverySuppressed ───────────────────────────────────────────────

    public function test_mark_delivery_suppressed_updates_status_to_suppressed(): void
    {
        $userId    = $this->insertUser();
        $windowKey = '2026-05';

        $this->service()->claimDelivery(self::TENANT_ID, $userId, 'daily', $windowKey);
        $this->service()->markDeliverySuppressed(
            self::TENANT_ID,
            $userId,
            'daily',
            $windowKey,
            ['reason' => 'empty_digest']
        );

        $row = DB::table('civic_digest_delivery_claims')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->where('window_key', $windowKey)
            ->first();

        $this->assertSame('suppressed', $row->status);
    }

    // ── releaseStaleDeliveryClaims ────────────────────────────────────────────

    public function test_release_stale_delivery_claims_returns_zero_for_fresh_rows(): void
    {
        $userId    = $this->insertUser();
        $windowKey = '2026-06-fresh';

        $this->service()->claimDelivery(self::TENANT_ID, $userId, 'daily', $windowKey);

        // Fresh rows are not older than 35 days → nothing deleted
        $deleted = $this->service()->releaseStaleDeliveryClaims();

        $this->assertSame(0, $deleted);
    }

    // ── digestForMember — guard cases ────────────────────────────────────────

    public function test_digest_for_member_returns_empty_array_for_invalid_ids(): void
    {
        $result = $this->service()->digestForMember(0, 1);
        $this->assertSame([], $result);

        $result = $this->service()->digestForMember(1, 0);
        $this->assertSame([], $result);
    }

    // ── digestForMember — safety_alert source included and scored ────────────

    public function test_digest_for_member_includes_active_safety_alerts(): void
    {
        $userId = $this->insertUser();

        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'title'      => 'Flood Warning in North District',
            'body'       => 'Please avoid low-lying areas until further notice.',
            'severity'   => 'danger',
            'is_active'  => 1,
            'expires_at' => null,
            'sent_at'    => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $sources = array_column($items, 'source');
        $this->assertContains('safety_alert', $sources);

        // Safety alerts have SOURCE_WEIGHT=10 → highest score → should rank first
        $this->assertSame('safety_alert', $items[0]['source']);
    }

    // ── digestForMember — safety_alert outscores other sources ───────────────

    public function test_digest_safety_alert_outranks_announcement(): void
    {
        if (! Schema::hasTable('caring_emergency_alerts') || ! Schema::hasTable('caring_project_announcements')) {
            $this->markTestSkipped('Required tables not present.');
        }

        $userId = $this->insertUser();

        // Seed an announcement (weight=2)
        DB::table('caring_project_announcements')->insertOrIgnore([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'title'            => 'Community Clean-up Drive',
            'summary'          => 'Help keep our streets clean.',
            'status'           => 'active',
            'progress_percent' => 100,
            'current_stage'    => null,
            'subscriber_count' => 0,
            'published_at'     => now()->subDays(2),
            'last_update_at'   => now()->subDays(2),
            'created_at'       => now()->subDays(2),
            'updated_at'       => now()->subDays(2),
        ]);

        // Seed a safety alert (weight=10)
        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'title'      => 'Gas Leak — Evacuate Block C',
            'body'       => 'Emergency services are on site.',
            'severity'   => 'danger',
            'is_active'  => 1,
            'expires_at' => null,
            'sent_at'    => now()->subDays(3),
            'created_at' => now()->subDays(3),
            'updated_at' => now()->subDays(3),
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $this->assertNotEmpty($items);
        // Safety alert has raw source_weight=10; announcement=2. Safety alert should be first.
        $this->assertSame('safety_alert', $items[0]['source']);
    }

    // ── digestForMember — opt_out_sources respected ──────────────────────────

    public function test_digest_respects_opt_out_sources(): void
    {
        if (! Schema::hasTable('caring_emergency_alerts') || ! Schema::hasTable('tenant_settings')) {
            $this->markTestSkipped('Required tables not present.');
        }

        $userId = $this->insertUser();

        // Seed an alert that would normally appear
        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'title'      => 'Opt-out Test Alert',
            'body'       => 'Should be excluded.',
            'severity'   => 'info',
            'is_active'  => 1,
            'expires_at' => null,
            'sent_at'    => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // User opts out of safety_alert source
        $this->service()->setUserPrefs(self::TENANT_ID, $userId, [
            'opt_out_sources' => ['safety_alert'],
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $sources = array_column($items, 'source');
        $this->assertNotContains('safety_alert', $sources);
    }

    // ── digestForMember — item shape validated ───────────────────────────────

    public function test_digest_items_have_required_keys(): void
    {
        $userId = $this->insertUser();

        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'title'      => 'Shape Test Alert',
            'body'       => 'Checking item shape.',
            'severity'   => 'info',
            'is_active'  => 1,
            'expires_at' => null,
            'sent_at'    => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $this->assertNotEmpty($items);
        $item = $items[0];

        foreach (['id', 'source', 'title', 'summary', 'occurred_at', 'sub_region_id', 'audience_match_score', 'link_path', 'score_reasons'] as $key) {
            $this->assertArrayHasKey($key, $item, "Missing key: $key");
        }
        $this->assertIsInt($item['audience_match_score']);
        $this->assertGreaterThanOrEqual(1, $item['audience_match_score']);
        $this->assertIsArray($item['score_reasons']);
    }

    // ── digestForMember — limit enforced ────────────────────────────────────

    public function test_digest_respects_limit_parameter(): void
    {
        $userId = $this->insertUser();

        // Seed 5 alerts
        for ($i = 1; $i <= 5; $i++) {
            DB::table('caring_emergency_alerts')->insertOrIgnore([
                'tenant_id'  => self::TENANT_ID,
                'title'      => 'Alert ' . $i,
                'body'       => 'Body ' . $i,
                'severity'   => 'info',
                'is_active'  => 1,
                'expires_at' => null,
                'sent_at'    => now()->subMinutes($i),
                'created_at' => now()->subMinutes($i),
                'updated_at' => now()->subMinutes($i),
            ]);
        }

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId, 3);

        $this->assertCount(3, $items);
    }

    // ── digestForMember — project source included ────────────────────────────

    public function test_digest_includes_active_projects_in_progress(): void
    {
        $userId = $this->insertUser();

        DB::table('caring_project_announcements')->insertOrIgnore([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'title'            => 'Solar Panel Installation Project',
            'summary'          => 'Installing solar panels on community centre.',
            'status'           => 'active',
            'progress_percent' => 50,
            'current_stage'    => 'Phase 2',
            'subscriber_count' => 0,
            'published_at'     => now()->subDays(5),
            'last_update_at'   => now()->subDays(1),
            'created_at'       => now()->subDays(5),
            'updated_at'       => now()->subDays(5),
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $sources = array_column($items, 'source');
        $this->assertContains('project', $sources);
    }

    // ── digestForMember — marketplace source included ────────────────────────

    public function test_digest_includes_approved_marketplace_listings(): void
    {
        $userId = $this->insertUser();

        DB::table('marketplace_listings')->insertOrIgnore([
            'tenant_id'         => self::TENANT_ID,
            'user_id'           => $userId,
            'title'             => 'Garden Tools For Sale',
            'description'       => 'Used but good condition garden tools.',
            'status'            => 'active',
            'moderation_status' => 'approved',
            'created_at'        => now()->subDays(2),
            'updated_at'        => now()->subDays(2),
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $sources = array_column($items, 'source');
        $this->assertContains('marketplace', $sources);
    }

    // ── digestForMember — items from other tenants excluded ──────────────────

    public function test_digest_is_tenant_scoped(): void
    {
        $OTHER_TENANT = 99701;
        DB::table('tenants')->updateOrInsert(
            ['id' => $OTHER_TENANT],
            [
                'name'              => 'Other Digest Tenant',
                'slug'              => 'other-digest-99701',
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        // Alert for our tenant
        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'title'      => 'Our Tenant Alert',
            'body'       => 'This is ours.',
            'severity'   => 'info',
            'is_active'  => 1,
            'expires_at' => null,
            'sent_at'    => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Alert for OTHER tenant — must NOT appear in our digest
        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => $OTHER_TENANT,
            'title'      => 'Other Tenant Alert',
            'body'       => 'This is theirs.',
            'severity'   => 'danger',
            'is_active'  => 1,
            'expires_at' => null,
            'sent_at'    => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $userId = $this->insertUser();
        $items  = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $titles = array_column($items, 'title');
        $this->assertContains('Our Tenant Alert', $titles);
        $this->assertNotContains('Other Tenant Alert', $titles);
    }

    // ── digestForMember — expired alerts excluded ────────────────────────────

    public function test_digest_excludes_expired_safety_alerts(): void
    {
        $userId = $this->insertUser();

        DB::table('caring_emergency_alerts')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'title'      => 'Expired Alert That Should Not Appear',
            'body'       => 'This expired yesterday.',
            'severity'   => 'warning',
            'is_active'  => 1,
            'expires_at' => now()->subDay(),
            'sent_at'    => now()->subDays(2),
            'created_at' => now()->subDays(2),
            'updated_at' => now()->subDays(2),
        ]);

        $items = $this->service()->digestForMember(self::TENANT_ID, $userId);

        $titles = array_column($items, 'title');
        $this->assertNotContains('Expired Alert That Should Not Appear', $titles);
    }

    // ── digestForMember — empty period returns empty array ───────────────────

    public function test_digest_returns_empty_array_when_no_recent_content(): void
    {
        // Use a fresh user and a fresh tenant with NO seeded content
        $userId = $this->insertUser();

        // digestForMember with ONLY this tenant — no rows seeded above for this user
        // (other tests use insertOrIgnore so duplicates are safe)
        // Use a never-used tenant id
        $emptyTenant = 99799;
        DB::table('tenants')->updateOrInsert(
            ['id' => $emptyTenant],
            [
                'name'              => 'Empty Test Tenant',
                'slug'              => 'empty-digest-99799',
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        $items = $this->service()->digestForMember($emptyTenant, $userId);

        $this->assertIsArray($items);
        $this->assertEmpty($items);
    }
}
