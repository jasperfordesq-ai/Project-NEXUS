<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-074 (E-027) — the feed sidebar's "upcoming events" box listed every event
 * in the community with a future start time: unpublished drafts, cancelled
 * events and events that belong to a private or secret group the viewer is not
 * in. The events page and search already apply EventSearchVisibility.
 */
class FeedSidebarEventAudienceTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
        $this->owner = $this->user();
    }

    public function test_upcoming_events_exclude_drafts_and_other_peoples_private_group_events(): void
    {
        $privateGroup = $this->group('private');
        $draft = $this->event('Sidebar draft', null, 1, ['publication_status' => 'draft', 'status' => 'draft']);
        $private = $this->event('Sidebar private', $privateGroup, 2);
        $open = $this->event('Sidebar open', null, 3);

        Sanctum::actingAs($this->user(), ['*']);
        $ids = $this->upcomingIds();

        $this->assertNotContains($draft, $ids, 'A draft event must not be advertised.');
        $this->assertNotContains($private, $ids, 'A private group event must not be shown to a non-member.');
        $this->assertContains($open, $ids, 'A published open event is still listed.');
    }

    public function test_group_member_still_sees_their_private_group_event(): void
    {
        $privateGroup = $this->group('private');
        $private = $this->event('Sidebar member private', $privateGroup, 1);
        $member = $this->user();
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $privateGroup,
            'user_id' => $member->id,
            'role' => 'member',
            'status' => 'active',
        ]);

        Sanctum::actingAs($member, ['*']);
        $this->assertContains($private, $this->upcomingIds());
    }

    // ------------------------------------------------------------------

    /** @return list<int> */
    private function upcomingIds(): array
    {
        $rows = $this->apiGet('/v2/feed/sidebar')->assertStatus(200)->json('data.upcoming_events') ?? [];

        return array_values(array_map(static fn ($r): int => (int) ((array) $r)['id'], $rows));
    }

    private function user(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function group(string $visibility): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->owner->id,
            'name' => 'Sidebar ' . $visibility . ' group ' . bin2hex(random_bytes(3)),
            'description' => 'Sidebar audience fixture',
            'visibility' => $visibility,
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function event(string $title, ?int $groupId, int $secondsFromNow, array $overrides = []): int
    {
        // Start within seconds so the fixtures sort ahead of any other
        // upcoming event already in the shared test community (limit 3).
        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->owner->id,
            'group_id' => $groupId,
            'title' => $title,
            'description' => $title,
            'location' => 'Community hall',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'is_recurring_template' => 0,
            'start_time' => now()->addSeconds(30 + $secondsFromNow),
            'end_time' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
