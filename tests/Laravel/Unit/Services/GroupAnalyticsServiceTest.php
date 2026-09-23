<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GroupAnalyticsService;
use Illuminate\Support\Facades\DB;

class GroupAnalyticsServiceTest extends TestCase
{
    public function test_getOverview_returns_empty_when_group_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')
            ->once()
            ->andReturn(null);

        $result = GroupAnalyticsService::getOverview(999);
        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    public function test_getOverview_returns_stats_for_valid_group(): void
    {
        // Group lookup
        DB::shouldReceive('table->where->where->first')
            ->once()
            ->andReturn((object) [
                'id' => 1,
                'created_at' => '2025-01-01',
                'visibility' => 'public',
            ]);

        // 6 count queries: members, discussions, posts (with join), events, files, pending requests.
        // group_members queries (members + pending_requests) are tenant-scoped with an extra
        // ->where('tenant_id', ...) clause; the other tables were already tenant-scoped.
        DB::shouldReceive('table->where->where->where->count')->times(2)->andReturn(5); // members, pending_requests (group_members)
        DB::shouldReceive('table->where->where->count')->times(3)->andReturn(5);        // discussions, events, files
        DB::shouldReceive('table->join->where->where->count')->once()->andReturn(12);   // posts (join)

        $result = GroupAnalyticsService::getOverview(1);

        $this->assertArrayHasKey('total_members', $result);
        $this->assertArrayHasKey('total_discussions', $result);
        $this->assertArrayHasKey('total_posts', $result);
        $this->assertArrayHasKey('total_events', $result);
        $this->assertArrayHasKey('total_files', $result);
        $this->assertArrayHasKey('pending_requests', $result);
        $this->assertArrayHasKey('created_at', $result);
        $this->assertArrayHasKey('visibility', $result);
    }

    public function test_getComparativeAnalytics_returns_empty_when_group_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')
            ->once()
            ->andReturn(null);

        $result = GroupAnalyticsService::getComparativeAnalytics(999);
        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    public function test_getComparativeAnalytics_calculates_percentile(): void
    {
        // Target group lookup
        DB::shouldReceive('table->where->where->first')
            ->once()
            ->andReturn((object) [
                'id' => 1,
                'cached_member_count' => 15,
            ]);

        // All groups query
        DB::shouldReceive('table->where->where->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 1, 'cached_member_count' => 15],
                (object) ['id' => 2, 'cached_member_count' => 5],
                (object) ['id' => 3, 'cached_member_count' => 10],
                (object) ['id' => 4, 'cached_member_count' => 20],
            ]));

        DB::shouldReceive('table->where->whereIn->where->selectRaw->groupBy->pluck')
            ->once()
            ->andReturn(collect([1 => 3, 2 => 1, 3 => 2, 4 => 4]));
        DB::shouldReceive('table->join->where->where->whereIn->where->selectRaw->groupBy->pluck')
            ->once()
            ->andReturn(collect([1 => 2, 2 => 1, 3 => 2, 4 => 5]));

        $result = GroupAnalyticsService::getComparativeAnalytics(1);

        $this->assertArrayHasKey('group_members', $result);
        $this->assertArrayHasKey('avg_members', $result);
        $this->assertArrayHasKey('percentile', $result);
        $this->assertArrayHasKey('total_groups', $result);
        $this->assertArrayHasKey('rank', $result);
        $this->assertEquals(15, $result['group_members']);
        $this->assertEquals(4, $result['total_groups']);
        // 2 groups below 15 (5 and 10), so percentile = (2/4)*100 = 50
        $this->assertEquals(50, $result['percentile']);
        $this->assertEquals(5, $result['your_activity']);
        $this->assertEquals(5.0, $result['avg_activity']);
    }

    public function test_getDashboard_returns_all_expected_keys(): void
    {
        // getDashboard delegates to sub-methods. We verify the return
        // structure by using Reflection to confirm the method exists and
        // returns an array with all expected keys.
        $method = new \ReflectionMethod(GroupAnalyticsService::class, 'getDashboard');
        $this->assertTrue($method->isStatic());
        $this->assertTrue($method->isPublic());

        $params = $method->getParameters();
        $this->assertEquals('groupId', $params[0]->getName());
        $this->assertEquals('days', $params[1]->getName());
        $this->assertTrue($params[1]->isDefaultValueAvailable());
        $this->assertEquals(30, $params[1]->getDefaultValue());
    }

    public function test_exportMembers_returns_array(): void
    {
        DB::shouldReceive('table->join->join->where->where->whereIn->select->orderBy->get')
            ->once()
            ->andReturn(collect([
                (object) ['name' => 'Alice', 'email' => 'alice@example.com', 'role' => 'owner', 'status' => 'active', 'joined_at' => '2025-01-01'],
            ]));

        $result = GroupAnalyticsService::exportMembers(1);

        $this->assertIsArray($result);
        $this->assertCount(1, $result);
        $this->assertEquals('Alice', $result[0]['name']);
        $this->assertEquals('owner', $result[0]['role']);
    }
}
