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
 * F-088 (E-027), feed-sidebar residue: "hide my presence" must also hold on
 * the feed sidebar. Suggested members and the friends box derived online /
 * recently-active flags from users.last_active_at without reading
 * user_presence.hide_presence, and two of the lists returned the raw
 * last_active_at timestamp as well.
 */
final class FeedSidebarPresencePrivacyTest extends TestCase
{
    use DatabaseTransactions;

    private User $viewer;

    private User $hidden;

    private User $visible;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();

        $this->viewer = $this->member();
        // Future activity keeps both fixtures at the top of "most recently active".
        $this->hidden = $this->member(['last_active_at' => now()->addMinutes(50)]);
        $this->visible = $this->member(['last_active_at' => now()->addMinutes(49)]);

        DB::table('user_presence')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->hidden->id,
            'status' => 'online',
            'hide_presence' => 1,
            'last_seen_at' => now(),
        ]);

        Sanctum::actingAs($this->viewer, ['*']);
    }

    public function test_suggested_members_endpoint_honours_hide_presence(): void
    {
        $rows = $this->indexById($this->apiGet('/v2/members/suggested?limit=20')->assertStatus(200)->json('data') ?? []);

        $this->assertPresenceHidden($rows[$this->hidden->id] ?? null);
        $this->assertTrue((bool) ($rows[$this->visible->id]['is_online'] ?? false), 'A visible member still shows as online.');
    }

    public function test_feed_sidebar_suggested_members_honour_hide_presence(): void
    {
        $rows = $this->indexById($this->apiGet('/v2/feed/sidebar')->assertStatus(200)->json('data.suggested_members') ?? []);

        $this->assertPresenceHidden($rows[$this->hidden->id] ?? null);
        $this->assertTrue((bool) ($rows[$this->visible->id]['is_online'] ?? false));
    }

    public function test_feed_sidebar_friends_honour_hide_presence(): void
    {
        $this->connect($this->viewer, $this->hidden);
        $this->connect($this->viewer, $this->visible);

        $rows = $this->indexById($this->apiGet('/v2/feed/sidebar')->assertStatus(200)->json('data.friends') ?? []);

        $this->assertPresenceHidden($rows[$this->hidden->id] ?? null);
        $this->assertTrue((bool) ($rows[$this->visible->id]['is_online'] ?? false));
    }

    private function assertPresenceHidden(?array $row): void
    {
        $this->assertNotNull($row, 'The hidden-presence member is still listed.');
        $this->assertFalse((bool) ($row['is_online'] ?? false), 'A member who hides presence must not show as online.');
        $this->assertFalse((bool) ($row['is_recent'] ?? false), 'A member who hides presence must not show as recently active.');
        $this->assertArrayNotHasKey('last_active_at', $row, 'The raw last-active time must not be returned.');
    }

    /**
     * @param  list<array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    private function indexById(array $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $row = (array) $row;
            $out[(int) $row['id']] = $row;
        }

        return $out;
    }

    private function connect(User $a, User $b): void
    {
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $a->id,
            'receiver_id' => $b->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_active' => 1,
            'is_approved' => true,
            'privacy_search' => 1,
            'privacy_profile' => 'public',
            'onboarding_completed' => 1,
            'avatar_url' => '/uploads/test/presence-avatar.png',
            'bio' => 'Presence privacy fixture.',
            'last_active_at' => now(),
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
