<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringCommunityForecastService;
use App\Services\CaringCommunity\CaringNudgeService;
use App\Services\CaringTandemMatchingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Tests for CaringNudgeService.
 *
 * Strategy:
 *  - Allocate a fresh isolated high-ID tenant per test class (setUp) so live
 *    tenant-2 data never contaminates results and the LIMIT-20 idle-user
 *    in coordinatorTargets is controlled.
 *  - Use DatabaseTransactions so every row is rolled back after each test.
 *  - Mock CaringTandemMatchingService (injected dependency) via Mockery so
 *    tandem suggestion DB paths are controlled without needing caring_profiles.
 *  - forecastService left null (so lowCoverageSubRegionCandidates returns [])
 *    in most tests; a few tests inject a partial mock where needed.
 *  - MAIL_MAILER=array env var keeps the dispatchDue path free from SMTP.
 *  - OpenAI / push are fire-and-forget; no assertions on HTTP.
 *
 * Skipped/deferred paths (documented inline):
 *  - Low-coverage sub-region trigger: requires a live ForecastService with real
 *    caring_sub_regions data; tested structurally (no-op when forecastService=null).
 *  - dispatchDue duplicate-key idempotency: dispatch_key UNIQUE constraint race
 *    requires two concurrent transactions; not reproducible single-process.
 *  - analytics() markConversions branch: needs caring_support_relationships rows
 *    that match nudge pairs; covered structurally (returns stats array shape).
 */
class CaringNudgeServiceTest extends TestCase
{
    use DatabaseTransactions;

    /** Fresh isolated tenant per test class run. */
    private int $thisTenant;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Allocate a unique high-range tenant so no live data bleeds in.
        $this->thisTenant = (int) DB::table('tenants')->insertGetId([
            'name'              => 'NudgeSvc Test ' . uniqid(),
            'slug'              => 'nudge-svc-' . uniqid(),
            'domain'            => null,
            'is_active'         => true,
            'depth'             => 0,
            'allows_subtenants' => false,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        TenantContext::setById($this->thisTenant);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Build a CaringNudgeService with a mocked tandem matching service
     * that returns $suggestions (default: empty array).
     *
     * @param  list<array<string,mixed>>  $suggestions
     */
    private function makeService(
        array $suggestions = [],
        ?CaringCommunityForecastService $forecastService = null,
    ): CaringNudgeService {
        $tandem = \Mockery::mock(CaringTandemMatchingService::class);
        $tandem->shouldReceive('suggestTandems')
            ->andReturn($suggestions)
            ->byDefault();

        return new CaringNudgeService($tandem, $forecastService);
    }

    /** Insert a minimal user and return its id. */
    private function insertUser(
        string $role = 'member',
        ?string $notificationPreferences = null,
        string $status = 'active',
    ): int {
        $uid = uniqid('nu_', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id'               => $this->thisTenant,
            'name'                    => 'Nudge User ' . $uid,
            'first_name'              => 'Nudge',
            'last_name'               => 'User',
            'email'                   => $uid . '@example.test',
            'role'                    => $role,
            'status'                  => $status,
            'balance'                 => 0,
            'is_approved'             => 1,
            'preferred_language'      => 'en',
            'notification_preferences' => $notificationPreferences,
            'created_at'              => now(),
            'updated_at'              => now(),
        ]);
    }

    /** Insert a vol_log row and return its id. */
    private function insertVolLog(
        int $userId,
        string $dateLogged,
        string $status = 'approved',
    ): int {
        return (int) DB::table('vol_logs')->insertGetId([
            'tenant_id'   => $this->thisTenant,
            'user_id'     => $userId,
            'date_logged' => $dateLogged,
            'hours'       => 1.00,
            'status'      => $status,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /** Enable nudges for this tenant via tenant_settings. */
    private function enableNudges(int $tenantId): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id'   => $tenantId,
                'setting_key' => 'caring_community.nudges.enabled',
            ],
            [
                'setting_value' => '1',
                'setting_type'  => 'boolean',
                'category'      => 'caring_community',
                'updated_at'    => now(),
            ],
        );
    }

    /** Insert a caring_smart_nudge row and return its id. */
    private function insertNudge(
        int $targetId,
        ?int $relatedId = null,
        string $sourceType = 'tandem_candidate',
        string $status = 'sent',
        string $sentAt = '',
        ?string $dispatchKey = null,
    ): int {
        $row = [
            'tenant_id'      => $this->thisTenant,
            'target_user_id' => $targetId,
            'related_user_id' => $relatedId,
            'source_type'    => $sourceType,
            'score'          => 0.700,
            'signals'        => json_encode([]),
            'notification_id' => null,
            'status'         => $status,
            'sent_at'        => $sentAt ?: now()->toDateTimeString(),
            'created_at'     => now(),
            'updated_at'     => now(),
        ];
        if ($dispatchKey !== null && Schema::hasColumn('caring_smart_nudges', 'dispatch_key')) {
            $row['dispatch_key'] = $dispatchKey;
        }
        return (int) DB::table('caring_smart_nudges')->insertGetId($row);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // config() — defaults & persistence
    // ─────────────────────────────────────────────────────────────────────────

    public function test_config_returns_defaults_when_no_settings_stored(): void
    {
        $svc    = $this->makeService();
        $config = $svc->config($this->thisTenant);

        $this->assertSame(false,  $config['enabled']);
        $this->assertEqualsWithDelta(0.55, $config['min_score'], 0.001);
        $this->assertSame(14,     $config['cooldown_days']);
        $this->assertSame(25,     $config['daily_limit']);
    }

    public function test_config_has_required_keys(): void
    {
        $svc    = $this->makeService();
        $config = $svc->config($this->thisTenant);

        $this->assertArrayHasKey('enabled',       $config);
        $this->assertArrayHasKey('min_score',     $config);
        $this->assertArrayHasKey('cooldown_days', $config);
        $this->assertArrayHasKey('daily_limit',   $config);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // updateConfig()
    // ─────────────────────────────────────────────────────────────────────────

    public function test_updateConfig_persists_enabled_true(): void
    {
        $svc    = $this->makeService();
        $result = $svc->updateConfig($this->thisTenant, ['enabled' => true]);

        $this->assertTrue($result['enabled']);

        // Verify it round-trips through a fresh service instance.
        $fresh = $this->makeService();
        $this->assertTrue($fresh->config($this->thisTenant)['enabled']);
    }

    public function test_updateConfig_clamps_min_score_to_range(): void
    {
        $svc = $this->makeService();

        // Below floor should clamp to 0.4.
        $low = $svc->updateConfig($this->thisTenant, ['min_score' => 0.1]);
        $this->assertEqualsWithDelta(0.4, $low['min_score'], 0.001);

        // Above ceiling should clamp to 0.95.
        $high = $svc->updateConfig($this->thisTenant, ['min_score' => 1.5]);
        $this->assertEqualsWithDelta(0.95, $high['min_score'], 0.001);
    }

    public function test_updateConfig_clamps_cooldown_days(): void
    {
        $svc = $this->makeService();

        $result = $svc->updateConfig($this->thisTenant, ['cooldown_days' => 0]);
        $this->assertSame(1, $result['cooldown_days']); // min 1

        $result2 = $svc->updateConfig($this->thisTenant, ['cooldown_days' => 999]);
        $this->assertSame(90, $result2['cooldown_days']); // max 90
    }

    public function test_updateConfig_clamps_daily_limit(): void
    {
        $svc = $this->makeService();

        $result = $svc->updateConfig($this->thisTenant, ['daily_limit' => 0]);
        $this->assertSame(1, $result['daily_limit']); // min 1

        $result2 = $svc->updateConfig($this->thisTenant, ['daily_limit' => 9999]);
        $this->assertSame(250, $result2['daily_limit']); // max 250
    }

    // ─────────────────────────────────────────────────────────────────────────
    // dispatchDue() — disabled config no-op
    // ─────────────────────────────────────────────────────────────────────────

    public function test_dispatchDue_returns_disabled_result_when_not_enabled(): void
    {
        // Nudges NOT enabled (default).
        $svc    = $this->makeService();
        $result = $svc->dispatchDue($this->thisTenant);

        $this->assertFalse($result['enabled']);
        $this->assertSame(0, $result['candidates']);
        $this->assertSame(0, $result['sent']);
        $this->assertSame([], $result['items']);
    }

    public function test_dispatchDue_result_has_required_keys(): void
    {
        $svc    = $this->makeService();
        $result = $svc->dispatchDue($this->thisTenant);

        $this->assertArrayHasKey('enabled',    $result);
        $this->assertArrayHasKey('dry_run',    $result);
        $this->assertArrayHasKey('candidates', $result);
        $this->assertArrayHasKey('sent',       $result);
        $this->assertArrayHasKey('skipped',    $result);
        $this->assertArrayHasKey('items',      $result);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // dispatchDue() — dry_run flag
    // ─────────────────────────────────────────────────────────────────────────

    public function test_dispatchDue_dry_run_does_not_write_nudge_rows(): void
    {
        $this->enableNudges($this->thisTenant);

        // Create an admin coordinator to receive the nudge.
        $admin = $this->insertUser('admin');

        // Create a pending help request older than 7 days (unfulfilled trigger).
        $requester = $this->insertUser('member');
        DB::table('caring_help_requests')->insert([
            'tenant_id'          => $this->thisTenant,
            'user_id'            => $requester,
            'what'               => 'Test help request',
            'when_needed'        => 'anytime',
            'contact_preference' => 'either',
            'status'             => 'pending',
            'created_at'         => now()->subDays(10)->toDateTimeString(),
            'updated_at'         => now()->toDateTimeString(),
        ]);

        $countBefore = DB::table('caring_smart_nudges')
            ->where('tenant_id', $this->thisTenant)
            ->count();

        $svc    = $this->makeService();
        $result = $svc->dispatchDue($this->thisTenant, null, true); // dryRun=true

        $countAfter = DB::table('caring_smart_nudges')
            ->where('tenant_id', $this->thisTenant)
            ->count();

        $this->assertTrue($result['dry_run']);
        $this->assertSame($countBefore, $countAfter, 'dry_run=true must not write nudge rows');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // previewCandidates() — helper_at_risk trigger
    // ─────────────────────────────────────────────────────────────────────────

    public function test_previewCandidates_returns_empty_when_caring_smart_nudges_table_missing(): void
    {
        if (Schema::hasTable('caring_smart_nudges')) {
            // Table exists in this environment — skip this structural test.
            $this->markTestSkipped('caring_smart_nudges table exists; skip missing-table guard test.');
        }

        $svc = $this->makeService();
        $this->assertSame([], $svc->previewCandidates($this->thisTenant));
    }

    public function test_helperAtRisk_candidate_emitted_for_lapsed_helper(): void
    {
        $helper = $this->insertUser('member');

        // Active in the prior window (60 days before the 21-day lapse cutoff).
        // That means between 81 and 21 days ago.
        $this->insertVolLog($helper, now()->subDays(40)->format('Y-m-d'), 'approved');

        // No log in the last 21 days → at risk.

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $sources = array_column($candidates, 'source_type');
        $this->assertContains('helper_at_risk', $sources, 'Expected helper_at_risk candidate');

        $candidate = array_values(array_filter($candidates, fn ($c) => $c['source_type'] === 'helper_at_risk'))[0];
        $this->assertSame($helper, (int) $candidate['target_user']['id']);
        $this->assertEqualsWithDelta(0.7, $candidate['score'], 0.001);
        $this->assertSame('/caring-community', $candidate['notification_url']);
    }

    public function test_helperAtRisk_candidate_not_emitted_when_still_active(): void
    {
        $helper = $this->insertUser('member');

        // Active both in prior window AND recently (within 21 days) → NOT at risk.
        $this->insertVolLog($helper, now()->subDays(40)->format('Y-m-d'), 'approved');
        $this->insertVolLog($helper, now()->subDays(5)->format('Y-m-d'),  'approved');

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $helperAtRisk = array_filter($candidates, fn ($c) => $c['source_type'] === 'helper_at_risk' && (int) $c['target_user']['id'] === $helper);
        $this->assertCount(0, $helperAtRisk, 'Helper with recent log should NOT be flagged at-risk');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // previewCandidates() — unfulfilled_help_request trigger
    // ─────────────────────────────────────────────────────────────────────────

    public function test_unfulfilledHelpRequest_candidate_emitted_for_old_pending_request(): void
    {
        // Need a coordinator so coordinatorTargets() returns a non-empty list.
        $admin = $this->insertUser('admin');

        $requester = $this->insertUser('member');
        DB::table('caring_help_requests')->insert([
            'tenant_id'          => $this->thisTenant,
            'user_id'            => $requester,
            'what'               => 'Need shopping help',
            'when_needed'        => 'anytime',
            'contact_preference' => 'either',
            'status'             => 'pending',
            'created_at'         => now()->subDays(10)->toDateTimeString(),
            'updated_at'         => now()->toDateTimeString(),
        ]);

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $sources = array_column($candidates, 'source_type');
        $this->assertContains('unfulfilled_help_request', $sources);

        $candidate = array_values(array_filter($candidates, fn ($c) => $c['source_type'] === 'unfulfilled_help_request'))[0];
        $this->assertSame($admin,     (int) $candidate['target_user']['id']);
        $this->assertSame($requester, (int) $candidate['related_user']['id']);
        $this->assertEqualsWithDelta(0.85, $candidate['score'], 0.001);
        $this->assertSame('/admin/caring-community/workflow', $candidate['notification_url']);
    }

    public function test_unfulfilledHelpRequest_candidate_not_emitted_for_fresh_pending_request(): void
    {
        $admin     = $this->insertUser('admin');
        $requester = $this->insertUser('member');

        // Created only 2 days ago — below the 7-day threshold.
        DB::table('caring_help_requests')->insert([
            'tenant_id'          => $this->thisTenant,
            'user_id'            => $requester,
            'what'               => 'Need help with transport',
            'when_needed'        => 'flexible',
            'contact_preference' => 'either',
            'status'             => 'pending',
            'created_at'         => now()->subDays(2)->toDateTimeString(),
            'updated_at'         => now()->toDateTimeString(),
        ]);

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $unf = array_filter($candidates, fn ($c) => $c['source_type'] === 'unfulfilled_help_request' && (int) $c['related_user']['id'] === $requester);
        $this->assertCount(0, $unf, 'A 2-day-old pending request is within threshold and must NOT emit a candidate');
    }

    public function test_unfulfilledHelpRequest_candidate_not_emitted_when_no_coordinators(): void
    {
        // No admin/coordinator user in this tenant.
        $requester = $this->insertUser('member');

        DB::table('caring_help_requests')->insert([
            'tenant_id'          => $this->thisTenant,
            'user_id'            => $requester,
            'what'               => 'Lonely request',
            'when_needed'        => 'soon',
            'contact_preference' => 'either',
            'status'             => 'pending',
            'created_at'         => now()->subDays(10)->toDateTimeString(),
            'updated_at'         => now()->toDateTimeString(),
        ]);

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $unf = array_filter($candidates, fn ($c) => $c['source_type'] === 'unfulfilled_help_request');
        $this->assertCount(0, $unf, 'Without a coordinator target there should be no unfulfilled_help_request candidate');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // previewCandidates() — cooldown / dedup guard
    // ─────────────────────────────────────────────────────────────────────────

    public function test_helperAtRisk_candidate_suppressed_by_cooldown(): void
    {
        $helper = $this->insertUser('member');
        $this->insertVolLog($helper, now()->subDays(40)->format('Y-m-d'), 'approved');

        // Insert an existing nudge within cooldown window (5 days ago, cooldown=14 days).
        $this->insertNudge($helper, null, 'helper_at_risk', 'sent', now()->subDays(5)->toDateTimeString());

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $helperAtRisk = array_filter($candidates, fn ($c) => $c['source_type'] === 'helper_at_risk' && (int) $c['target_user']['id'] === $helper);
        $this->assertCount(0, $helperAtRisk, 'Candidate within cooldown window must be suppressed');
    }

    public function test_helperAtRisk_candidate_not_suppressed_when_cooldown_expired(): void
    {
        $helper = $this->insertUser('member');
        $this->insertVolLog($helper, now()->subDays(40)->format('Y-m-d'), 'approved');

        // Previous nudge 20 days ago — past the 14-day default cooldown.
        $this->insertNudge($helper, null, 'helper_at_risk', 'sent', now()->subDays(20)->toDateTimeString());

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $helperAtRisk = array_filter($candidates, fn ($c) => $c['source_type'] === 'helper_at_risk' && (int) $c['target_user']['id'] === $helper);
        $this->assertCount(1, $helperAtRisk, 'Candidate past cooldown must be re-eligible');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // previewCandidates() — opt-out guard
    // ─────────────────────────────────────────────────────────────────────────

    public function test_helperAtRisk_candidate_suppressed_for_opted_out_member(): void
    {
        // User with caring_smart_nudges opted OUT (false).
        $helper = $this->insertUser(
            role: 'member',
            notificationPreferences: json_encode(['caring_smart_nudges' => false]),
        );
        $this->insertVolLog($helper, now()->subDays(40)->format('Y-m-d'), 'approved');

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $helperAtRisk = array_filter($candidates, fn ($c) => $c['source_type'] === 'helper_at_risk' && (int) $c['target_user']['id'] === $helper);
        $this->assertCount(0, $helperAtRisk, 'Opted-out member must be excluded from candidates');
    }

    public function test_helperAtRisk_candidate_included_when_opted_in(): void
    {
        // Explicit opt-in.
        $helper = $this->insertUser(
            role: 'member',
            notificationPreferences: json_encode(['caring_smart_nudges' => true]),
        );
        $this->insertVolLog($helper, now()->subDays(40)->format('Y-m-d'), 'approved');

        $svc        = $this->makeService();
        $candidates = $svc->previewCandidates($this->thisTenant);

        $helperAtRisk = array_filter($candidates, fn ($c) => $c['source_type'] === 'helper_at_risk' && (int) $c['target_user']['id'] === $helper);
        $this->assertCount(1, $helperAtRisk, 'Opted-in member must appear as candidate');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // previewCandidates() — low_coverage_subregion trigger (structural no-op)
    // ─────────────────────────────────────────────────────────────────────────

    public function test_lowCoverageSubregion_returns_empty_when_forecastService_is_null(): void
    {
        // Service constructed without a forecastService (null).
        $svc        = $this->makeService([], null);
        $candidates = $svc->previewCandidates($this->thisTenant);

        $lowCov = array_filter($candidates, fn ($c) => $c['source_type'] === 'low_coverage_subregion');
        $this->assertCount(0, $lowCov, 'low_coverage_subregion trigger must be no-op when forecastService is null');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // dispatchDue() — persists nudge rows and increments sent counter
    // ─────────────────────────────────────────────────────────────────────────

    public function test_dispatchDue_persists_nudge_row_and_increments_sent(): void
    {
        $this->enableNudges($this->thisTenant);

        $admin     = $this->insertUser('admin');
        $requester = $this->insertUser('member');

        DB::table('caring_help_requests')->insert([
            'tenant_id'          => $this->thisTenant,
            'user_id'            => $requester,
            'what'               => 'Help with meals',
            'when_needed'        => 'anytime',
            'contact_preference' => 'either',
            'status'             => 'pending',
            'created_at'         => now()->subDays(10)->toDateTimeString(),
            'updated_at'         => now()->toDateTimeString(),
        ]);

        $svc    = $this->makeService();
        $result = $svc->dispatchDue($this->thisTenant);

        $this->assertTrue($result['enabled']);
        $this->assertGreaterThanOrEqual(1, $result['sent']);
        $this->assertGreaterThanOrEqual(1, $result['candidates']);

        // A row must have been persisted in caring_smart_nudges.
        $row = DB::table('caring_smart_nudges')
            ->where('tenant_id', $this->thisTenant)
            ->where('target_user_id', $admin)
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($row, 'Expected caring_smart_nudges row for the admin target');
        $this->assertSame('sent', $row->status);
        $this->assertSame($requester, (int) $row->related_user_id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // dispatchDue() — daily_limit cap
    // ─────────────────────────────────────────────────────────────────────────

    public function test_dispatchDue_respects_daily_limit(): void
    {
        $this->enableNudges($this->thisTenant);

        // Set daily_limit=1 so at most one nudge fires.
        $svc = $this->makeService();
        $svc->updateConfig($this->thisTenant, ['daily_limit' => 1]);

        // Need a coordinator.
        $admin = $this->insertUser('admin');

        // Insert 3 old pending help requests → 3 potential candidates for the coordinator.
        for ($i = 0; $i < 3; $i++) {
            $requester = $this->insertUser('member');
            DB::table('caring_help_requests')->insert([
                'tenant_id'          => $this->thisTenant,
                'user_id'            => $requester,
                'what'               => "Help request {$i}",
                'when_needed'        => 'anytime',
                'contact_preference' => 'either',
                'status'             => 'pending',
                'created_at'         => now()->subDays(10 + $i)->toDateTimeString(),
                'updated_at'         => now()->toDateTimeString(),
            ]);
        }

        // Re-instantiate so fresh config is loaded.
        $svc2   = $this->makeService();
        $result = $svc2->dispatchDue($this->thisTenant, 1); // explicit limit=1

        $this->assertLessThanOrEqual(1, $result['sent'] + ($result['skipped'] ?? 0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // analytics() — structural shape
    // ─────────────────────────────────────────────────────────────────────────

    public function test_analytics_returns_required_keys(): void
    {
        $svc    = $this->makeService();
        $result = $svc->analytics($this->thisTenant);

        $this->assertArrayHasKey('config',               $result);
        $this->assertArrayHasKey('stats',                $result);
        $this->assertArrayHasKey('recent',               $result);
        $this->assertArrayHasKey('eligible_candidates',  $result);

        $stats = $result['stats'];
        $this->assertArrayHasKey('sent_total',           $stats);
        $this->assertArrayHasKey('sent_30d',             $stats);
        $this->assertArrayHasKey('converted_total',      $stats);
        $this->assertArrayHasKey('converted_30d',        $stats);
        $this->assertArrayHasKey('conversion_rate_30d',  $stats);
        $this->assertArrayHasKey('opted_out_members',    $stats);
    }

    public function test_analytics_recent_nudges_reflect_inserted_rows(): void
    {
        $targetUser  = $this->insertUser('member');
        $relatedUser = $this->insertUser('member');

        $this->insertNudge($targetUser, $relatedUser, 'tandem_candidate', 'sent');

        $svc    = $this->makeService();
        $result = $svc->analytics($this->thisTenant);

        $recentTargetIds = array_column(array_column($result['recent'], 'target_user'), 'id');
        $this->assertContains($targetUser, $recentTargetIds, 'Inserted nudge row must appear in analytics recent list');
    }

    public function test_analytics_opted_out_members_count_is_non_negative_integer(): void
    {
        $svc    = $this->makeService();
        $result = $svc->analytics($this->thisTenant);

        $this->assertIsInt($result['stats']['opted_out_members']);
        $this->assertGreaterThanOrEqual(0, $result['stats']['opted_out_members']);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // analytics() — opted_out_members counts correctly
    // ─────────────────────────────────────────────────────────────────────────

    public function test_analytics_opted_out_count_increments_for_opted_out_user(): void
    {
        $svc = $this->makeService();

        $countBefore = $svc->analytics($this->thisTenant)['stats']['opted_out_members'];

        // Insert one opted-out user.
        $this->insertUser(
            role: 'member',
            notificationPreferences: json_encode(['caring_smart_nudges' => false]),
        );

        // Fresh service instance clears opt-out cache.
        $fresh       = $this->makeService();
        $countAfter  = $fresh->analytics($this->thisTenant)['stats']['opted_out_members'];

        $this->assertSame($countBefore + 1, $countAfter, 'Opted-out user must increment opted_out_members count by 1');
    }
}
