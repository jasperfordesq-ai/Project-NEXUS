<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-185 — the feed sidebar's "suggested listings" checked only status=active,
 * so listings still waiting for (or refused by) moderation were shown, and so
 * were listings from members on the other side of a block.
 */
class FeedSidebarSuggestedListingsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['feed'] = true;
        $features['listings'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_suggested_listings_exclude_unmoderated_and_blocked_owners(): void
    {
        $viewer = $this->member();
        $owner = $this->member();
        $blockedOwner = $this->member();

        $visible = $this->listing($owner->id, 'F185-VISIBLE-' . uniqid(), null, 5);
        $pending = $this->listing($owner->id, 'F185-PENDING-' . uniqid(), 'pending_review', 4);
        $rejected = $this->listing($owner->id, 'F185-REJECTED-' . uniqid(), 'rejected', 3);
        $blocked = $this->listing($blockedOwner->id, 'F185-BLOCKED-' . uniqid(), 'approved', 2);
        BlockUserService::block($blockedOwner->id, $viewer->id);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/feed/sidebar');
        $response->assertStatus(200);

        $titles = array_column((array) $response->json('data.suggested_listings'), 'title');
        $this->assertContains($visible, $titles);
        $this->assertNotContains($pending, $titles);
        $this->assertNotContains($rejected, $titles);
        $this->assertNotContains($blocked, $titles);
    }

    private function listing(int $ownerId, string $title, ?string $moderation, int $minutesAhead): string
    {
        DB::table('listings')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => $title,
            'description' => 'E035 sidebar listing',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => $moderation,
            'created_at' => now()->addMinutes($minutesAhead),
        ]);

        return $title;
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
