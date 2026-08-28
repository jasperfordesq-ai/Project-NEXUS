<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\AchievementCampaignService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Real-DB tests for AchievementCampaignService.
 *
 * Previously six of nine methods were markTestIncomplete ("static Eloquent
 * model calls cannot be mocked without DB"). They are now real assertions
 * against nexus_test — the service drives admin gamification campaigns and
 * must be guarded, not stubbed.
 *
 * Ground-truth notes (verified against the live nexus_test schema before
 * writing these):
 *
 *  - createCampaign() reads $data['name'] and $data['badge_key'] WITHOUT a
 *    null-coalesce, and the app converts the resulting "Undefined array key"
 *    warning into an ErrorException which createCampaign() catches and turns
 *    into a null return. Every successful create here therefore passes BOTH
 *    'name' and 'badge_key' (an empty 'badge_key' is stored as NULL via the
 *    service's `?: null`).
 *
 *  - The `status` column is an enum('draft','scheduled','running','completed',
 *    'cancelled') — it has NO 'active'/'paused' members. activateCampaign()
 *    writes status='active' and pauseCampaign() writes status='paused'; under
 *    the Laravel connection's (non-strict-escalating) error mode these do NOT
 *    throw, but MariaDB truncates the value to ''. So the reliable, asserted
 *    signal for activation is the `activated_at` timestamp it also sets, and
 *    for pause it is that the call completes and the row still exists. We do
 *    NOT assert status='active'/'paused' because the schema cannot store them.
 *
 *  - All reads/writes are tenant-scoped (HasTenantScope global scope + the
 *    DB::table('achievement_campaigns')->where('tenant_id', ...) cron query),
 *    so TenantContext is re-pinned to $this->testTenantId immediately before
 *    every service call — factory creates and prior service calls drift it.
 */
class AchievementCampaignServiceTest extends TestCase
{
    use DatabaseTransactions;

    private AchievementCampaignService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new AchievementCampaignService();
    }

    /**
     * Build the minimal valid $data for a successful createCampaign().
     * 'name' and 'badge_key' must always be present (see class docblock).
     */
    private function campaignData(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Test Campaign ' . uniqid('', true),
            'description' => 'A test campaign',
            'type' => 'one_time',
            'badge_key' => '',
            'xp_amount' => 0,
            'target_audience' => 'all_users',
            'audience_config' => [],
        ], $overrides);
    }

    // --- Pure static-data assertions (kept; already real) ---

    public function test_constants_defined(): void
    {
        $this->assertNotEmpty(AchievementCampaignService::TYPES);
        $this->assertNotEmpty(AchievementCampaignService::AUDIENCES);
        $this->assertArrayHasKey('one_time', AchievementCampaignService::TYPES);
        $this->assertArrayHasKey('all_users', AchievementCampaignService::AUDIENCES);
        $this->assertSame('one_time', AchievementCampaignService::TYPES['one_time']);
        $this->assertSame('all_users', AchievementCampaignService::AUDIENCES['all_users']);
    }

    public function test_type_to_db_mapping_works(): void
    {
        // Type mapping: one_time -> badge_award, recurring -> xp_bonus, triggered -> challenge
        $this->assertArrayHasKey('one_time', AchievementCampaignService::TYPES);
        $this->assertArrayHasKey('recurring', AchievementCampaignService::TYPES);
        $this->assertArrayHasKey('triggered', AchievementCampaignService::TYPES);
    }

    // --- Real-DB behaviour (converted from markTestIncomplete) ---

    public function test_createCampaign_persists_and_maps_type(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'Created Campaign',
            'type' => 'one_time',
            'badge_key' => 'early-bird',
            'xp_amount' => 50,
        ]));

        $this->assertNotNull($id, 'createCampaign should return the new id');

        $row = DB::table('achievement_campaigns')->where('id', $id)->first();
        $this->assertNotNull($row, 'Campaign row must exist in the DB');
        $this->assertSame((int) $this->testTenantId, (int) $row->tenant_id, 'tenant_id auto-set from TenantContext');
        $this->assertSame('Created Campaign', $row->name);
        // one_time -> badge_award (typeToDbMap)
        $this->assertSame('badge_award', $row->campaign_type);
        $this->assertSame('early-bird', $row->badge_key);
        $this->assertSame(50, (int) $row->xp_amount);
        // New campaigns are created in 'draft' status.
        $this->assertSame('draft', $row->status);
    }

    public function test_createCampaign_maps_recurring_and_triggered_types(): void
    {
        TenantContext::setById($this->testTenantId);
        $recId = $this->service->createCampaign($this->campaignData([
            'name' => 'Recurring Campaign',
            'type' => 'recurring',
        ]));
        $this->assertNotNull($recId);
        $this->assertSame(
            'xp_bonus',
            DB::table('achievement_campaigns')->where('id', $recId)->value('campaign_type')
        );

        TenantContext::setById($this->testTenantId);
        $trigId = $this->service->createCampaign($this->campaignData([
            'name' => 'Triggered Campaign',
            'type' => 'triggered',
        ]));
        $this->assertNotNull($trigId);
        $this->assertSame(
            'challenge',
            DB::table('achievement_campaigns')->where('id', $trigId)->value('campaign_type')
        );
    }

    public function test_getCampaign_returns_array_with_mapped_type(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'Fetch Me',
            'type' => 'recurring',
            'badge_key' => 'streaker',
        ]));
        $this->assertNotNull($id);

        TenantContext::setById($this->testTenantId);
        $campaign = $this->service->getCampaign((int) $id);

        $this->assertIsArray($campaign);
        $this->assertSame('Fetch Me', $campaign['name']);
        $this->assertSame((int) $id, (int) $campaign['id']);
        // DB stores xp_bonus; the service maps it back to the friendly 'recurring' type.
        $this->assertSame('xp_bonus', $campaign['campaign_type']);
        $this->assertSame('recurring', $campaign['type']);
        $this->assertArrayHasKey('status', $campaign);
        $this->assertArrayHasKey('badge_key', $campaign);
    }

    public function test_getCampaign_returns_null_when_not_found(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->assertNull($this->service->getCampaign(99999999));
    }

    public function test_getCampaigns_returns_created_campaign(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'In The List',
            'type' => 'one_time',
            'badge_key' => 'lister',
        ]));
        $this->assertNotNull($id);

        TenantContext::setById($this->testTenantId);
        $all = $this->service->getCampaigns();

        $this->assertIsArray($all);
        $found = array_values(array_filter($all, fn ($c) => (int) $c['id'] === (int) $id));
        $this->assertCount(1, $found, 'getCampaigns must include the campaign we just created');
        // Every returned campaign carries the mapped friendly type.
        $this->assertArrayHasKey('type', $found[0]);
        $this->assertSame('one_time', $found[0]['type']);
    }

    public function test_getCampaigns_filters_by_status(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'Draft Filter Target',
            'type' => 'one_time',
            'badge_key' => 'drafter',
        ]));
        $this->assertNotNull($id);

        TenantContext::setById($this->testTenantId);
        $drafts = $this->service->getCampaigns('draft');

        $this->assertIsArray($drafts);
        // The status filter must only return rows in the requested status.
        foreach ($drafts as $c) {
            $this->assertSame('draft', $c['status']);
        }
        // And our freshly-created draft must be present.
        $ids = array_map(fn ($c) => (int) $c['id'], $drafts);
        $this->assertContains((int) $id, $ids);
    }

    public function test_activateCampaign_sets_activated_at(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'To Activate',
            'badge_key' => 'activator',
        ]));
        $this->assertNotNull($id);
        $this->assertNull(
            DB::table('achievement_campaigns')->where('id', $id)->value('activated_at'),
            'activated_at should be null before activation'
        );

        TenantContext::setById($this->testTenantId);
        $this->service->activateCampaign((int) $id);

        $this->assertNotNull(
            DB::table('achievement_campaigns')->where('id', $id)->value('activated_at'),
            'activateCampaign must stamp activated_at'
        );

        // 🔴 This assertion is the point of the test. It used to read "the
        // 'status' enum cannot hold 'active', so we assert the reliable
        // side-effect" — a test written AROUND the bug instead of catching it.
        // Writing 'active' put the row outside its own enum, and the cron scans
        // for 'running', so an activated campaign was never eligible and no
        // member was ever awarded anything.
        $this->assertSame(
            'running',
            DB::table('achievement_campaigns')->where('id', $id)->value('status'),
            'activateCampaign must store the enum value the scheduler scans for'
        );

        // …while the admin UI still sees its own vocabulary.
        TenantContext::setById($this->testTenantId);
        $this->assertSame('active', $this->service->getCampaign((int) $id)['status']);
    }

    public function test_pauseCampaign_runs_and_row_survives(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'To Pause',
            'badge_key' => 'pauser',
        ]));
        $this->assertNotNull($id);

        TenantContext::setById($this->testTenantId);
        $this->service->activateCampaign((int) $id);
        $this->service->pauseCampaign((int) $id);

        $this->assertSame(
            1,
            (int) DB::table('achievement_campaigns')->where('id', $id)->count(),
            'pauseCampaign must update (not remove) the campaign row'
        );

        // 'paused' became a real enum value on 2026-08-28; before that this
        // write fell outside the enum and the comment here read "the 'status'
        // enum has no 'paused' member".
        $row = DB::table('achievement_campaigns')->where('id', $id)->first();
        $this->assertSame('paused', $row->status);
        $this->assertNotNull(
            $row->activated_at,
            'pausing must not erase the fact that the campaign was once activated'
        );

        // A paused campaign must not be picked up by the scheduler.
        TenantContext::setById($this->testTenantId);
        $ran = array_map(
            static fn (array $r): int => (int) $r['campaign_id'],
            $this->service->processRecurringCampaigns(),
        );
        $this->assertNotContains((int) $id, $ran, 'a paused campaign must never be delivered');
    }

    public function test_deleteCampaign_removes_record(): void
    {
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'To Delete',
            'badge_key' => 'deleter',
        ]));
        $this->assertNotNull($id);
        $this->assertSame(1, (int) DB::table('achievement_campaigns')->where('id', $id)->count());

        TenantContext::setById($this->testTenantId);
        $this->service->deleteCampaign((int) $id);

        $this->assertSame(
            0,
            (int) DB::table('achievement_campaigns')->where('id', $id)->count(),
            'deleteCampaign must remove the row'
        );

        TenantContext::setById($this->testTenantId);
        $this->assertNull(
            $this->service->getCampaign((int) $id),
            'getCampaign must return null after delete'
        );
    }

    public function test_processRecurringCampaigns_stamps_eligible_campaign(): void
    {
        // Create a recurring (xp_bonus) campaign and force it into the eligible
        // state the cron scans for: status='running', null last_run_at.
        TenantContext::setById($this->testTenantId);
        $id = $this->service->createCampaign($this->campaignData([
            'name' => 'Recurring To Run',
            'type' => 'recurring',
            'badge_key' => 'runner',
        ]));
        $this->assertNotNull($id);

        DB::table('achievement_campaigns')->where('id', $id)->update([
            'status' => 'running',
            'recurrence_pattern' => 'daily',
            'last_run_at' => null,
        ]);
        $this->assertNull(
            DB::table('achievement_campaigns')->where('id', $id)->value('last_run_at'),
            'last_run_at must be null before the first tick'
        );

        TenantContext::setById($this->testTenantId);
        $result = $this->service->processRecurringCampaigns();

        // Return shape: one entry per campaign actually run, carrying which
        // campaign it was and how many members it paid. `awarded` is 0 here
        // because this fixture has xp_amount = 0 — a campaign that specifies no
        // reward must pay nobody rather than silently award zero XP to everyone.
        $this->assertIsArray($result);
        $this->assertGreaterThanOrEqual(1, count($result), 'At least our eligible campaign is processed');

        $ours = array_values(array_filter(
            $result,
            static fn (array $r): bool => (int) $r['campaign_id'] === (int) $id,
        ));
        $this->assertCount(1, $ours, 'our eligible campaign must appear in the results');
        $this->assertSame(0, $ours[0]['awarded']);

        // The eligible campaign's last_run_at must now be stamped.
        $this->assertNotNull(
            DB::table('achievement_campaigns')->where('id', $id)->value('last_run_at'),
            'processRecurringCampaigns must stamp last_run_at on the eligible campaign'
        );
    }
}
