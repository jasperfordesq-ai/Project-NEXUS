<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\RedisCache;
use App\Services\SiteAnnouncementService;
use App\Support\SiteAnnouncementStyle;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * SiteAnnouncementService — which announcement a community's member website
 * shows now, and that one community can never read or change another's.
 */
class SiteAnnouncementServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 990412;

    private SiteAnnouncementService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(SiteAnnouncementService::class);

        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            [
                'name' => 'Other Announcement Service Timebank',
                'slug' => 'other-announcement-service-test',
                'parent_id' => null,
                'path' => '/' . self::OTHER_TENANT_ID . '/',
                'depth' => 0,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    protected function tearDown(): void
    {
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        app(RedisCache::class)->delete('tenant_bootstrap', self::OTHER_TENANT_ID);
        parent::tearDown();
    }

    /** @param array<string, mixed> $overrides */
    private function insertRow(int $tenantId, array $overrides = []): int
    {
        return (int) DB::table('site_announcements')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'message' => 'A notice',
            'style' => 'info',
            'link_url' => null,
            'link_label' => null,
            'starts_at' => null,
            'ends_at' => null,
            'is_dismissible' => 1,
            'is_active' => 1,
            'created_by' => null,
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ], $overrides));
    }

    // ----------------------------------------------------------------
    // currentForTenant
    // ----------------------------------------------------------------

    public function test_current_is_null_when_the_community_has_none(): void
    {
        $this->assertNull($this->service->currentForTenant($this->testTenantId));
    }

    public function test_current_hides_inactive_not_yet_started_and_ended_rows(): void
    {
        $this->insertRow($this->testTenantId, ['message' => 'Switched off', 'is_active' => 0]);
        $this->insertRow($this->testTenantId, ['message' => 'Not yet', 'starts_at' => now()->addHour()]);
        $this->insertRow($this->testTenantId, ['message' => 'Over', 'ends_at' => now()->subMinute()]);
        $this->insertRow($this->testTenantId, [
            'message' => 'Over, with a start',
            'starts_at' => now()->subDays(3),
            'ends_at' => now()->subDay(),
        ]);

        $this->assertNull($this->service->currentForTenant($this->testTenantId));
    }

    public function test_current_never_returns_another_communitys_announcement(): void
    {
        $this->insertRow(self::OTHER_TENANT_ID, ['message' => 'Theirs']);

        $this->assertNull($this->service->currentForTenant($this->testTenantId));

        $theirs = $this->service->currentForTenant(self::OTHER_TENANT_ID);
        $this->assertNotNull($theirs);
        $this->assertSame('Theirs', $theirs['message']);
    }

    public function test_current_returns_the_public_shape_and_no_staff_details(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $id = $this->insertRow($this->testTenantId, [
            'message' => 'Open day on Sunday',
            'style' => 'celebration',
            'link_url' => '/events',
            'link_label' => 'Events',
            'starts_at' => '2026-01-01 09:00:00',
            'ends_at' => '2099-01-01 00:00:00',
            'is_dismissible' => 0,
            'created_by' => $author->id,
            'updated_at' => '2026-01-02 08:30:00',
        ]);

        $current = $this->service->currentForTenant($this->testTenantId);

        $this->assertSame([
            'id' => $id,
            'message' => 'Open day on Sunday',
            'style' => 'celebration',
            'link_url' => '/events',
            'link_label' => 'Events',
            'is_dismissible' => false,
            'starts_at' => '2026-01-01T09:00:00+00:00',
            'ends_at' => '2099-01-01T00:00:00+00:00',
            'updated_at' => '2026-01-02T08:30:00+00:00',
        ], $current);
    }

    public function test_current_prefers_the_newest_start_then_the_newest_created(): void
    {
        $this->insertRow($this->testTenantId, ['message' => 'Older start', 'starts_at' => now()->subDays(5)]);
        $this->insertRow($this->testTenantId, ['message' => 'Newer start', 'starts_at' => now()->subDay()]);
        $this->insertRow($this->testTenantId, ['message' => 'No start, made long ago', 'created_at' => now()->subDays(9)]);

        $this->assertSame('Newer start', $this->service->currentForTenant($this->testTenantId)['message']);

        $this->insertRow($this->testTenantId, ['message' => 'No start, made just now', 'created_at' => now()]);

        $this->assertSame('No start, made just now', $this->service->currentForTenant($this->testTenantId)['message']);
    }

    public function test_current_never_publishes_a_style_or_link_that_is_not_allowed(): void
    {
        // A row written some other way (import, hand edit) must not reach the page.
        $this->insertRow($this->testTenantId, [
            'style' => 'x" onload="alert(1)',
            'link_url' => 'javascript:alert(1)',
            'link_label' => 'Click',
        ]);

        $current = $this->service->currentForTenant($this->testTenantId);

        $this->assertSame(SiteAnnouncementStyle::DEFAULT, $current['style']);
        $this->assertNull($current['link_url']);
        $this->assertNull($current['link_label']);
    }

    // ----------------------------------------------------------------
    // Tenant scoping on writes
    // ----------------------------------------------------------------

    public function test_update_and_delete_treat_another_communitys_id_as_not_found(): void
    {
        $theirs = $this->insertRow(self::OTHER_TENANT_ID, ['message' => 'Theirs']);

        $this->assertSame(['error' => 'not_found'], $this->service->update($this->testTenantId, $theirs, ['message' => 'Mine now']));
        $this->assertFalse($this->service->delete($this->testTenantId, $theirs));

        $this->assertSame('Theirs', DB::table('site_announcements')->where('id', $theirs)->value('message'));
        $this->assertSame([], $this->service->listForTenant($this->testTenantId));
        $this->assertCount(1, $this->service->listForTenant(self::OTHER_TENANT_ID));
    }

    public function test_create_saves_against_the_given_community_and_author(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $result = $this->service->create($this->testTenantId, (int) $author->id, [
            'message' => 'Hello',
            // Neither of these may be chosen by the caller.
            'tenant_id' => self::OTHER_TENANT_ID,
            'created_by' => 1,
        ]);

        $this->assertArrayHasKey('announcement', $result);
        $row = DB::table('site_announcements')->where('id', $result['announcement']['id'])->first();
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame((int) $author->id, (int) $row->created_by);
    }

    public function test_every_write_clears_the_cached_bootstrap_of_that_community_only(): void
    {
        $cache = app(RedisCache::class);
        $author = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $cache->set('tenant_bootstrap', ['stale' => true], 600, $this->testTenantId);
        $cache->set('tenant_bootstrap', ['stale' => true], 600, self::OTHER_TENANT_ID);
        $id = $this->service->create($this->testTenantId, (int) $author->id, ['message' => 'Hello'])['announcement']['id'];
        $this->assertNull($cache->get('tenant_bootstrap', $this->testTenantId));
        $this->assertNotNull($cache->get('tenant_bootstrap', self::OTHER_TENANT_ID));

        $cache->set('tenant_bootstrap', ['stale' => true], 600, $this->testTenantId);
        $this->service->update($this->testTenantId, $id, ['message' => 'Hello again']);
        $this->assertNull($cache->get('tenant_bootstrap', $this->testTenantId));

        $cache->set('tenant_bootstrap', ['stale' => true], 600, $this->testTenantId);
        $this->assertTrue($this->service->delete($this->testTenantId, $id));
        $this->assertNull($cache->get('tenant_bootstrap', $this->testTenantId));
    }

    // ----------------------------------------------------------------
    // Style allow-list
    // ----------------------------------------------------------------

    public function test_style_normalise_accepts_only_the_listed_styles(): void
    {
        $this->assertSame('info', SiteAnnouncementStyle::normalise('info'));
        $this->assertSame('celebration', SiteAnnouncementStyle::normalise(' Celebration '));
        $this->assertSame('important', SiteAnnouncementStyle::normalise('IMPORTANT'));
        $this->assertNull(SiteAnnouncementStyle::normalise('danger'));
        $this->assertNull(SiteAnnouncementStyle::normalise(''));
        $this->assertNull(SiteAnnouncementStyle::normalise(null));
        $this->assertNull(SiteAnnouncementStyle::normalise(['info']));
    }
}
