<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Models\User;
use App\Services\GroupAnalyticsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupAnalyticsBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private int $groupId;

    protected function setUp(): void
    {
        parent::setUp();

        // Keep search-index jobs out of analytics assertions. The sync queue's
        // worker isolation hooks reset TenantContext by design in console mode.
        Queue::fake();

        $this->owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->owner->id,
            'name' => 'Analytics boundary ' . uniqid('', true),
            'description' => 'Deterministic analytics boundary fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->membership((int) $this->owner->id, now());
        Sanctum::actingAs($this->owner, ['*']);
    }

    public function test_controller_and_service_clamp_unbounded_ranges(): void
    {
        $response = $this->apiGet("/v2/groups/{$this->groupId}/analytics?days=999999")
            ->assertStatus(200);
        self::assertCount(GroupAnalyticsService::MAX_DAYS, $response->json('data.member_growth'));

        $retention = $this->apiGet("/v2/groups/{$this->groupId}/analytics/retention?months=999999")
            ->assertStatus(200);
        self::assertCount(GroupAnalyticsService::MAX_MONTHS, $retention->json('data'));

        self::assertCount(
            GroupAnalyticsService::MAX_DAYS,
            GroupAnalyticsService::getMemberGrowth($this->groupId, PHP_INT_MAX),
        );
        self::assertCount(
            GroupAnalyticsService::MIN_DAYS,
            GroupAnalyticsService::getMemberGrowth($this->groupId, PHP_INT_MIN),
        );
    }

    public function test_current_month_retention_counts_recently_active_members(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->membership((int) $member->id, now()->startOfMonth()->addDay());
        $discussionId = (int) DB::table('group_discussions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->groupId,
            'user_id' => $member->id,
            'title' => 'Current-month retention activity',
            'is_pinned' => false,
            'is_locked' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_posts')->insert([
            'tenant_id' => $this->testTenantId,
            'discussion_id' => $discussionId,
            'user_id' => $member->id,
            'content' => 'Recent activity must count in the current cohort.',
            'created_at' => now(),
        ]);

        $cohort = GroupAnalyticsService::getRetentionMetrics($this->groupId, 1)[0];

        self::assertSame(now()->format('Y-m'), $cohort['month']);
        self::assertSame(2, $cohort['joined']);
        self::assertSame(1, $cohort['still_active']);
        self::assertSame(50.0, $cohort['retention_rate']);
        self::assertSame(50.0, $cohort['retention_pct']);
    }

    public function test_retention_query_count_does_not_grow_with_cohort_or_member_count(): void
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        GroupAnalyticsService::getRetentionMetrics($this->groupId, 1);
        $smallQueryCount = count(DB::getQueryLog());

        DB::disableQueryLog();
        foreach (range(1, 25) as $index) {
            $member = User::factory()->forTenant($this->testTenantId)->create([
                'status' => 'active',
                'is_approved' => true,
            ]);
            $this->membership((int) $member->id, now()->subMonths($index % 12));
        }

        DB::flushQueryLog();
        DB::enableQueryLog();
        GroupAnalyticsService::getRetentionMetrics($this->groupId, 24);
        $largeQueryCount = count(DB::getQueryLog());
        DB::disableQueryLog();

        self::assertSame(2, $smallQueryCount);
        self::assertSame($smallQueryCount, $largeQueryCount);
    }

    public function test_authenticated_csv_export_is_authorized_downloadable_and_formula_safe(): void
    {
        // The hostile value must go in a NAME PART. Passing it as `name` alone let
        // UserObserver::saving() overwrite it with the faker's first/last, so the row
        // reaching the CSV was harmless and this formula-injection guard was asserting
        // against a payload that was never present.
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => '=HYPERLINK("https://attacker.example")',
            'last_name' => '',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->membership((int) $member->id, now());

        $download = $this->apiGet("/v2/groups/{$this->groupId}/analytics/export/members")
            ->assertOk()
            ->assertHeader('content-type', 'text/csv; charset=UTF-8');
        $disposition = (string) $download->headers->get('content-disposition');
        self::assertStringContainsString("group-{$this->groupId}-members.csv", $disposition);

        $csv = $download->streamedContent();
        self::assertStringContainsString("'=HYPERLINK", $csv);
        self::assertStringNotContainsString("\n=HYPERLINK", $csv);

        $outsider = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($outsider, ['*']);
        $this->apiGet("/v2/groups/{$this->groupId}/analytics/export/members")
            ->assertForbidden();
    }

    private function membership(int $userId, \DateTimeInterface $createdAt): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->groupId,
            'user_id' => $userId,
            'role' => $userId === (int) $this->owner->id ? 'owner' : 'member',
            'status' => 'active',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
    }
}
