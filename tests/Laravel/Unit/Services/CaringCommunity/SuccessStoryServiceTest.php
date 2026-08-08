<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\SuccessStoryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class SuccessStoryServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId = 2;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        TenantContext::setById($this->tenantId);

        // Clean up any leftover stories for our tenant from a prior test run.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->where('setting_key', SuccessStoryService::SETTING_KEY)
            ->delete();
    }

    private function service(): SuccessStoryService
    {
        return app(SuccessStoryService::class);
    }

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'title'           => 'Test Story Title',
            'narrative'       => 'A short test narrative for the story.',
            'metric_source'   => 'manual',
            'metric_key'      => null,
            'before_value'    => 100.0,
            'after_value'     => 70.0,
            'unit'            => '%',
            'audience'        => 'municipality',
            'method_caveat'   => 'Illustrative only; not measured on this tenant.',
            'evidence_source' => 'Peer municipality report',
            'is_demo'         => false,
            'is_published'    => false,
        ], $overrides);
    }

    // -------------------------------------------------------------------------
    // listStories
    // -------------------------------------------------------------------------

    public function test_list_stories_returns_empty_when_no_stories_exist(): void
    {
        $result = $this->service()->listStories($this->tenantId);

        $this->assertIsArray($result);
        $this->assertCount(0, $result);
    }

    public function test_list_stories_returns_all_items_including_unpublished(): void
    {
        $svc = $this->service();
        $svc->createStory($this->tenantId, $this->validPayload(['is_published' => false]));
        $svc->createStory($this->tenantId, $this->validPayload(['title' => 'Story Two', 'is_published' => true]));

        $all = $svc->listStories($this->tenantId, false);
        $this->assertCount(2, $all);
    }

    public function test_list_stories_published_only_filters_correctly(): void
    {
        $svc = $this->service();
        $svc->createStory($this->tenantId, $this->validPayload(['is_published' => false]));
        $svc->createStory($this->tenantId, $this->validPayload(['title' => 'Published Story', 'is_published' => true]));

        $published = $svc->listStories($this->tenantId, true);
        $this->assertCount(1, $published);
        $this->assertSame('Published Story', $published[0]['title']);
    }

    // -------------------------------------------------------------------------
    // createStory
    // -------------------------------------------------------------------------

    public function test_create_story_returns_story_with_generated_id_and_expected_fields(): void
    {
        $result = $this->service()->createStory($this->tenantId, $this->validPayload());

        $this->assertArrayHasKey('story', $result);
        $story = $result['story'];
        $this->assertStringStartsWith('story_', (string) $story['id']);
        $this->assertSame('Test Story Title', $story['title']);
        $this->assertSame('manual', $story['metric_source']);
        $this->assertSame(100.0, $story['before_value']);
        $this->assertSame(70.0, $story['after_value']);
        $this->assertSame('%', $story['unit']);
        $this->assertFalse($story['is_published']);
        $this->assertFalse($story['is_demo']);
        $this->assertArrayHasKey('created_at', $story);
        $this->assertArrayHasKey('updated_at', $story);
    }

    public function test_create_story_persists_to_tenant_settings(): void
    {
        $this->service()->createStory($this->tenantId, $this->validPayload());

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->where('setting_key', SuccessStoryService::SETTING_KEY)
            ->first();

        $this->assertNotNull($row);
        $decoded = json_decode($row->setting_value, true);
        $this->assertCount(1, $decoded['items']);
    }

    public function test_create_story_fails_validation_when_title_missing(): void
    {
        $payload = $this->validPayload(['title' => '']);
        $result = $this->service()->createStory($this->tenantId, $payload);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('title', $fields);
    }

    public function test_create_story_fails_validation_when_title_too_long(): void
    {
        $payload = $this->validPayload(['title' => str_repeat('x', 201)]);
        $result = $this->service()->createStory($this->tenantId, $payload);

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('VALIDATION_LENGTH', $codes);
    }

    public function test_create_story_fails_validation_when_narrative_missing(): void
    {
        $payload = $this->validPayload(['narrative' => '']);
        $result = $this->service()->createStory($this->tenantId, $payload);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('narrative', $fields);
    }

    public function test_create_story_fails_validation_when_metric_source_invalid(): void
    {
        $payload = $this->validPayload(['metric_source' => 'blockchain']);
        $result = $this->service()->createStory($this->tenantId, $payload);

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('VALIDATION_ENUM', $codes);
    }

    public function test_create_story_fails_validation_when_method_caveat_missing(): void
    {
        $payload = $this->validPayload(['method_caveat' => '']);
        $result = $this->service()->createStory($this->tenantId, $payload);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('method_caveat', $fields);
    }

    public function test_create_story_fails_validation_when_evidence_source_missing(): void
    {
        $payload = $this->validPayload(['evidence_source' => '']);
        $result = $this->service()->createStory($this->tenantId, $payload);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('evidence_source', $fields);
    }

    // -------------------------------------------------------------------------
    // getStory
    // -------------------------------------------------------------------------

    public function test_get_story_returns_null_for_unknown_id(): void
    {
        $result = $this->service()->getStory($this->tenantId, 'story_does_not_exist');

        $this->assertNull($result);
    }

    public function test_get_story_returns_correct_story_by_id(): void
    {
        $svc = $this->service();
        $created = $svc->createStory($this->tenantId, $this->validPayload())['story'];

        $fetched = $svc->getStory($this->tenantId, $created['id']);
        $this->assertNotNull($fetched);
        $this->assertSame($created['id'], $fetched['id']);
        $this->assertSame('Test Story Title', $fetched['title']);
    }

    // -------------------------------------------------------------------------
    // updateStory
    // -------------------------------------------------------------------------

    public function test_update_story_returns_error_for_unknown_id(): void
    {
        $result = $this->service()->updateStory($this->tenantId, 'story_ghost', ['title' => 'New']);

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('not_found', $result['error']);
    }

    public function test_update_story_partial_merge_preserves_unchanged_fields(): void
    {
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload())['story']['id'];

        $result = $svc->updateStory($this->tenantId, $id, ['title' => 'Updated Title']);

        $this->assertArrayHasKey('story', $result);
        $story = $result['story'];
        $this->assertSame('Updated Title', $story['title']);
        // narrative must be preserved
        $this->assertSame('A short test narrative for the story.', $story['narrative']);
    }

    public function test_update_story_can_publish_a_story(): void
    {
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload(['is_published' => false]))['story']['id'];

        $result = $svc->updateStory($this->tenantId, $id, ['is_published' => true]);

        $this->assertTrue($result['story']['is_published']);
    }

    public function test_update_story_partial_title_validation_still_enforced(): void
    {
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload())['story']['id'];

        // Empty title in partial update should fail validation
        $result = $svc->updateStory($this->tenantId, $id, ['title' => '   ']);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('title', $fields);
    }

    // -------------------------------------------------------------------------
    // deleteStory
    // -------------------------------------------------------------------------

    public function test_delete_story_returns_error_for_unknown_id(): void
    {
        $result = $this->service()->deleteStory($this->tenantId, 'story_ghost');

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('not_found', $result['error']);
    }

    public function test_delete_story_removes_item_from_envelope(): void
    {
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload())['story']['id'];

        $deleted = $svc->deleteStory($this->tenantId, $id);
        $this->assertTrue($deleted['ok']);

        $this->assertNull($svc->getStory($this->tenantId, $id));
        $this->assertCount(0, $svc->listStories($this->tenantId));
    }

    public function test_delete_story_only_removes_targeted_story(): void
    {
        $svc = $this->service();
        $id1 = $svc->createStory($this->tenantId, $this->validPayload(['title' => 'Story One']))['story']['id'];
        $id2 = $svc->createStory($this->tenantId, $this->validPayload(['title' => 'Story Two']))['story']['id'];

        $svc->deleteStory($this->tenantId, $id1);

        $remaining = $svc->listStories($this->tenantId);
        $this->assertCount(1, $remaining);
        $this->assertSame($id2, $remaining[0]['id']);
    }

    // -------------------------------------------------------------------------
    // seedDemoStories
    // -------------------------------------------------------------------------

    public function test_seed_demo_stories_creates_three_items_when_empty(): void
    {
        $result = $this->service()->seedDemoStories($this->tenantId);

        $this->assertArrayHasKey('items', $result);
        $this->assertCount(3, $result['items']);
    }

    public function test_seed_demo_stories_marks_all_as_demo_and_published(): void
    {
        $items = $this->service()->seedDemoStories($this->tenantId)['items'];

        foreach ($items as $item) {
            $this->assertTrue($item['is_demo'], "Story '{$item['title']}' should be is_demo=true");
            $this->assertTrue($item['is_published'], "Story '{$item['title']}' should be is_published=true");
        }
    }

    public function test_seed_demo_stories_returns_error_when_stories_already_exist(): void
    {
        $svc = $this->service();
        $svc->seedDemoStories($this->tenantId);

        $result = $svc->seedDemoStories($this->tenantId);

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('already_seeded', $result['error']);
    }

    // -------------------------------------------------------------------------
    // refreshLiveMetrics
    // -------------------------------------------------------------------------

    public function test_refresh_live_metrics_returns_not_found_for_missing_story(): void
    {
        $result = $this->service()->refreshLiveMetrics($this->tenantId, 'story_ghost');

        $this->assertSame('not_found', $result['error']);
    }

    public function test_refresh_live_metrics_returns_manual_metric_error_for_manual_source(): void
    {
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload(['metric_source' => 'manual']))['story']['id'];

        $result = $svc->refreshLiveMetrics($this->tenantId, $id);

        $this->assertSame('manual_metric', $result['error']);
    }

    public function test_refresh_live_metrics_returns_manual_metric_error_when_metric_key_null(): void
    {
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload([
            'metric_source' => 'municipal_roi',
            'metric_key'    => null,
        ]))['story']['id'];

        $result = $svc->refreshLiveMetrics($this->tenantId, $id);

        $this->assertSame('manual_metric', $result['error']);
    }

    public function test_refresh_live_metrics_municipal_roi_returns_hourly_rate(): void
    {
        // Regression: fetchMunicipalRoiMetric() previously queried the non-existent
        // `recipient_user_id` column on `caring_support_relationships` (the real column
        // is `recipient_id`), which raised SQLSTATE[42S22] for ANY municipal_roi metric
        // key because that distinct-count sub-query runs before the match() return. With
        // the column fixed, the `hourly_rate_chf` key resolves to the flat 35.0 CHF rate.
        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload([
            'metric_source' => 'municipal_roi',
            'metric_key'    => 'hourly_rate_chf',
        ]))['story']['id'];

        $result = $svc->refreshLiveMetrics($this->tenantId, $id);

        $this->assertArrayHasKey('story', $result);
        $this->assertSame(35.0, $result['story']['after_value']);
    }

    public function test_refresh_live_metrics_municipal_roi_computes_formal_care_offset(): void
    {
        // Regression: same root cause as the test above — the `recipient_id` column fix
        // lets the caring_support_relationships distinct-count run, so the formal-care
        // offset can be computed from approved volunteer hours.
        // vol_logs requires a real user_id FK, so a real user must be created before inserting rows.
        $uid = uniqid('sss_u_', true);
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->tenantId,
            'name'       => 'SuccessStory Test ' . $uid,
            'first_name' => 'Story',
            'last_name'  => 'Tester',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0,
            'role'       => 'member',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // fetchMunicipalRoiMetric() sums ALL approved vol_logs for the tenant, and
        // DatabaseTransactions only rolls back THIS test's writes — not seed rows already
        // in the DB. So capture the tenant's existing approved hours and assert relative to
        // that baseline; a hardcoded 350.0 would yield a false failure on any database that
        // already has approved hours for this tenant.
        $baselineHours = (float) DB::table('vol_logs')
            ->where('tenant_id', $this->tenantId)
            ->where('status', 'approved')
            ->sum('hours');

        // Insert 10 approved hours and 5 pending (pending should be ignored per intent).
        DB::table('vol_logs')->insert([
            ['tenant_id' => $this->tenantId, 'user_id' => $userId, 'date_logged' => '2026-01-01', 'hours' => 10.00, 'status' => 'approved', 'created_at' => now()],
            ['tenant_id' => $this->tenantId, 'user_id' => $userId, 'date_logged' => '2026-01-02', 'hours' => 5.00,  'status' => 'pending',  'created_at' => now()],
        ]);

        $svc = $this->service();
        $id = $svc->createStory($this->tenantId, $this->validPayload([
            'metric_source' => 'municipal_roi',
            'metric_key'    => 'formal_care_offset_chf',
        ]))['story']['id'];

        // Our 10 approved hours add 10 × 35.0 = 350.0 CHF on top of the baseline; the 5
        // pending hours are excluded. Mirrors fetchMunicipalRoiMetric()'s round(hours × 35, 2).
        $expectedOffset = round(($baselineHours + 10.0) * 35.0, 2);
        $result = $svc->refreshLiveMetrics($this->tenantId, $id);

        $this->assertArrayHasKey('story', $result);
        $this->assertSame($expectedOffset, $result['story']['after_value']);
    }
}
