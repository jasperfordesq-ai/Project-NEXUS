<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The feed's "Friends" box renders `friend.name` (FriendsWidget.tsx), but the
 * sidebar API sent only first_name / last_name for friends — so every friend
 * showed as "?" with an initials-less avatar. Found 11 Nov 2026 on the show
 * community. The name must follow the same surname rule as every other
 * member-facing name (E-122): a member viewer gets the first name only.
 */
final class FeedSidebarFriendsNameTest extends TestCase
{
    use DatabaseTransactions;

    public function test_friends_carry_a_display_name_without_the_surname_for_members(): void
    {
        Cache::flush();
        $viewer = $this->member('Viewer', 'Person');
        $friend = $this->member('Maeve', 'Brennan');

        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $viewer->id,
            'receiver_id' => $friend->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $friends = $this->apiGet('/v2/feed/sidebar')->assertStatus(200)->json('data.friends') ?? [];

        $row = collect($friends)->firstWhere('id', $friend->id);
        $this->assertNotNull($row, 'The connected member is listed in the friends box.');
        $this->assertSame('Maeve', $row['name'] ?? null, 'Each friend carries the name the widget shows.');
        $this->assertStringNotContainsString('Brennan', json_encode($row) ?: '', 'A member never receives a friend\'s surname.');
    }

    private function member(string $first, string $last): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $first,
            'last_name' => $last,
            'name' => "{$first} {$last}",
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => 1,
            'last_active_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
