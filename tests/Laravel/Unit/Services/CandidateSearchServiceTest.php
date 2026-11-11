<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\CandidateSearchService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

class CandidateSearchServiceTest extends TestCase
{
    private CandidateSearchService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new CandidateSearchService();
    }

    // ── search — structure & defaults ────────────────────────────────

    public function test_search_returns_items_and_total_keys(): void
    {
        $query = $this->mockSearchQuery(collect([]), 0);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->search([], $this->testTenantId);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertSame(0, $result['total']);
        $this->assertSame([], $result['items']);
    }

    public function test_search_scopes_by_tenant_searchable_and_active(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('tenant_id', $this->testTenantId)->once()->andReturnSelf();
        $query->shouldReceive('where')->with('resume_searchable', 1)->once()->andReturnSelf();
        $query->shouldReceive('where')->with('status', 'active')->once()->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search([], $this->testTenantId);
    }

    public function test_search_uses_default_limit_20_and_offset_0(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->with(0)->once()->andReturnSelf();
        $query->shouldReceive('limit')->with(20)->once()->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search([], $this->testTenantId);
    }

    // ── search — pagination ──────────────────────────────────────────

    public function test_search_respects_custom_limit_and_offset(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('count')->andReturn(50);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->with(10)->once()->andReturnSelf();
        $query->shouldReceive('limit')->with(5)->once()->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->search(['limit' => 5, 'offset' => 10], $this->testTenantId);

        $this->assertSame(50, $result['total']);
    }

    public function test_search_clamps_limit_to_100(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->andReturnSelf();
        $query->shouldReceive('limit')->with(100)->once()->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search(['limit' => 500], $this->testTenantId);
    }

    public function test_search_clamps_negative_offset_to_zero(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->with(0)->once()->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search(['offset' => -5], $this->testTenantId);
    }

    // ── search — filters ─────────────────────────────────────────────

    public function test_search_applies_keyword_filter_closure(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('tenant_id', Mockery::any())->andReturnSelf();
        $query->shouldReceive('where')->with('resume_searchable', Mockery::any())->andReturnSelf();
        $query->shouldReceive('where')->with('status', Mockery::any())->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        // Keywords filter invokes ->where(Closure)
        $query->shouldReceive('where')->with(Mockery::type('Closure'))->once()->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search(['keywords' => 'laravel'], $this->testTenantId);
    }

    public function test_search_applies_skills_filter_closure(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('tenant_id', Mockery::any())->andReturnSelf();
        $query->shouldReceive('where')->with('resume_searchable', Mockery::any())->andReturnSelf();
        $query->shouldReceive('where')->with('status', Mockery::any())->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        // Skills filter invokes ->where(Closure)
        $query->shouldReceive('where')->with(Mockery::type('Closure'))->once()->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search(['skills' => ['PHP', 'React']], $this->testTenantId);
    }

    public function test_search_applies_location_filter(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('tenant_id', Mockery::any())->andReturnSelf();
        $query->shouldReceive('where')->with('resume_searchable', Mockery::any())->andReturnSelf();
        $query->shouldReceive('where')->with('status', Mockery::any())->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('where')->with('location', 'LIKE', '%Berlin%')->once()->andReturnSelf();
        $query->shouldReceive('count')->andReturn(0);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));

        DB::shouldReceive('table')->with('users')->andReturn($query);

        $this->service->search(['location' => 'Berlin'], $this->testTenantId);
    }

    // ── search — result mapping ──────────────────────────────────────

    public function test_search_maps_rows_to_expected_format(): void
    {
        $row = (object) [
            'id' => 42,
            'first_name' => 'Jane',
            'last_name' => 'Doe',
            'avatar_url' => 'https://example.com/avatar.jpg',
            'resume_headline' => 'Senior Engineer',
            'skills' => 'PHP, Laravel, React',
            'location' => 'Berlin, Germany',
            'last_login_at' => '2027-01-15 10:00:00',
            'bio' => 'Experienced developer.',
        ];

        $query = $this->mockSearchQuery(collect([$row]), 1);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->search([], $this->testTenantId);

        $this->assertCount(1, $result['items']);
        $item = $result['items'][0];
        $this->assertSame(42, $item['id']);
        $this->assertSame('Jane', $item['first_name']);
        $this->assertSame('Doe', $item['last_name']);
        // E-122: a job poster is not staff, so the display name is the first
        // name. (The raw `last_name` key above is a later stage of E-122.)
        $this->assertSame('Jane', $item['name']);
        $this->assertSame('https://example.com/avatar.jpg', $item['avatar_url']);
        $this->assertSame('Senior Engineer', $item['headline']);
        $this->assertSame(['PHP', 'Laravel', 'React'], $item['skills']);
        $this->assertSame('Berlin, Germany', $item['location']);
        $this->assertSame('2027-01-15 10:00:00', $item['last_active']);
    }

    public function test_search_parses_empty_skills_as_empty_array(): void
    {
        $row = $this->makeUserRow(['skills' => '']);
        $query = $this->mockSearchQuery(collect([$row]), 1);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->search([], $this->testTenantId);
        $this->assertSame([], $result['items'][0]['skills']);
    }

    public function test_search_parses_null_skills_as_empty_array(): void
    {
        $row = $this->makeUserRow(['skills' => null]);
        $query = $this->mockSearchQuery(collect([$row]), 1);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->search([], $this->testTenantId);
        $this->assertSame([], $result['items'][0]['skills']);
    }

    // ── getCandidateProfile ──────────────────────────────────────────

    public function test_getCandidateProfile_returns_full_profile_when_found(): void
    {
        $user = (object) [
            'id' => 42,
            'first_name' => 'Jane',
            'last_name' => 'Doe',
            'avatar_url' => 'https://example.com/avatar.jpg',
            'resume_headline' => 'Senior Engineer',
            'resume_summary' => 'I build things.',
            'skills' => 'PHP, React, TypeScript',
            'location' => 'Berlin, Germany',
            'bio' => 'A bio here.',
            'last_login_at' => '2027-01-15 10:00:00',
            'created_at' => '2025-06-01 00:00:00',
        ];

        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('first')->andReturn($user);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->getCandidateProfile(42, $this->testTenantId);

        $this->assertNotNull($result);
        $this->assertSame(42, $result['id']);
        // E-122: a job poster is not staff, so the display name is the first name.
        $this->assertSame('Jane', $result['name']);
        $this->assertSame('Senior Engineer', $result['headline']);
        $this->assertSame('I build things.', $result['summary']);
        $this->assertSame(['PHP', 'React', 'TypeScript'], $result['skills']);
        $this->assertSame('Berlin, Germany', $result['location']);
        $this->assertSame('A bio here.', $result['bio']);
        $this->assertSame('2027-01-15 10:00:00', $result['last_active']);
        $this->assertSame('2025-06-01 00:00:00', $result['member_since']);
    }

    public function test_getCandidateProfile_returns_null_when_not_found(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('first')->andReturnNull();
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->getCandidateProfile(999, $this->testTenantId);
        $this->assertNull($result);
    }

    public function test_getCandidateProfile_returns_null_when_not_searchable(): void
    {
        // resume_searchable=0 means the DB query won't find the user
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('id', 42)->andReturnSelf();
        $query->shouldReceive('where')->with('tenant_id', $this->testTenantId)->andReturnSelf();
        $query->shouldReceive('where')->with('resume_searchable', 1)->andReturnSelf();
        $query->shouldReceive('where')->with('status', 'active')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('first')->andReturnNull();
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->getCandidateProfile(42, $this->testTenantId);
        $this->assertNull($result);
    }

    public function test_getCandidateProfile_returns_null_for_wrong_tenant(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('id', 42)->andReturnSelf();
        $query->shouldReceive('where')->with('tenant_id', 999)->andReturnSelf();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('first')->andReturnNull();
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->getCandidateProfile(42, 999);
        $this->assertNull($result);
    }

    public function test_getCandidateProfile_trims_skills(): void
    {
        $user = (object) [
            'id' => 1,
            'first_name' => 'A',
            'last_name' => 'B',
            'avatar_url' => null,
            'resume_headline' => null,
            'resume_summary' => null,
            'skills' => '  PHP , Laravel ,  React  ',
            'location' => null,
            'bio' => null,
            'last_login_at' => null,
            'created_at' => null,
        ];

        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('first')->andReturn($user);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->getCandidateProfile(1, $this->testTenantId);
        $this->assertSame(['PHP', 'Laravel', 'React'], $result['skills']);
    }

    // ── updateResumeVisibility ───────────────────────────────────────

    public function test_updateResumeVisibility_enables_searchability(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('id', 42)->andReturnSelf();
        $query->shouldReceive('where')->with('tenant_id', $this->testTenantId)->andReturnSelf();
        $query->shouldReceive('update')->with(['resume_searchable' => 1])->once()->andReturn(1);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->updateResumeVisibility(42, $this->testTenantId, true);
        $this->assertTrue($result);
    }

    public function test_updateResumeVisibility_disables_searchability(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('id', 42)->andReturnSelf();
        $query->shouldReceive('where')->with('tenant_id', $this->testTenantId)->andReturnSelf();
        $query->shouldReceive('update')->with(['resume_searchable' => 0])->once()->andReturn(1);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        $result = $this->service->updateResumeVisibility(42, $this->testTenantId, false);
        $this->assertTrue($result);
    }

    public function test_updateResumeVisibility_returns_false_on_exception(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('update')->andThrow(new \RuntimeException('DB error'));
        DB::shouldReceive('table')->with('users')->andReturn($query);
        Log::shouldReceive('error')->once()->with(Mockery::pattern('/updateResumeVisibility failed/'));

        $result = $this->service->updateResumeVisibility(42, $this->testTenantId, true);
        $this->assertFalse($result);
    }

    public function test_updateResumeVisibility_scopes_update_by_tenant(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->with('id', 42)->once()->andReturnSelf();
        $query->shouldReceive('where')->with('tenant_id', 999)->once()->andReturnSelf();
        $query->shouldReceive('update')->with(['resume_searchable' => 1])->once()->andReturn(0);
        DB::shouldReceive('table')->with('users')->andReturn($query);

        // Returns true even if 0 rows affected (no exception = success)
        $result = $this->service->updateResumeVisibility(42, 999, true);
        $this->assertTrue($result);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /**
     * Create a mock query builder that returns given rows and total.
     */
    private function mockSearchQuery($rows, int $total): Mockery\MockInterface
    {
        $query = Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('select')->andReturnSelf();
        $query->shouldReceive('count')->andReturn($total);
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('offset')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn($rows);

        return $query;
    }

    /**
     * Create a stdClass user row with defaults.
     */
    private function makeUserRow(array $overrides = []): \stdClass
    {
        return (object) array_merge([
            'id' => 1,
            'first_name' => 'Test',
            'last_name' => 'User',
            'avatar_url' => null,
            'resume_headline' => null,
            'skills' => null,
            'location' => null,
            'last_login_at' => null,
            'bio' => null,
        ], $overrides);
    }
}
