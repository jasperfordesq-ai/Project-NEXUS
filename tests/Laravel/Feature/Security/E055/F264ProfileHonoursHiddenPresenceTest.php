<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PresenceService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-055 F-264 (F-088 residual) — a member who switched on "Hide my presence"
 * must not be shown as online on their profile to other members, matching the
 * presence API, messaging and the feed sidebar.
 */
final class F264ProfileHonoursHiddenPresenceTest extends TestCase
{
    use DatabaseTransactions;

    private function recentlyActiveMember(bool $hidePresence): User
    {
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'privacy_profile' => 'public',
        ]);
        TenantContext::setById($this->testTenantId);
        PresenceService::setPrivacy((int) $user->id, $hidePresence);
        DB::table('users')->where('id', $user->id)->update(['last_active_at' => now()->subMinute()]);

        return $user;
    }

    private function viewer(): User
    {
        TenantContext::setById($this->testTenantId);

        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    public function test_hidden_presence_member_is_shown_offline_to_other_members(): void
    {
        $hidden = $this->recentlyActiveMember(hidePresence: true);
        Sanctum::actingAs($this->viewer(), ['*']);

        $profile = $this->apiGet('/v2/users/' . $hidden->id);

        $profile->assertOk();
        $this->assertFalse((bool) $profile->json('data.is_online'));
        $this->assertSame('offline', $profile->json('data.online_status'));
    }

    public function test_control_visible_member_is_still_shown_online(): void
    {
        $visible = $this->recentlyActiveMember(hidePresence: false);
        Sanctum::actingAs($this->viewer(), ['*']);

        $profile = $this->apiGet('/v2/users/' . $visible->id);

        $profile->assertOk();
        $this->assertTrue((bool) $profile->json('data.is_online'));
        $this->assertSame('online', $profile->json('data.online_status'));
    }
}
