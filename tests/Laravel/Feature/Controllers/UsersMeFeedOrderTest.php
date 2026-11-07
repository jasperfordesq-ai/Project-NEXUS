<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The accessible website's settings page reads "Show the feed newest first"
 * from GET /v2/users/me. That answer never carried it, so the box always
 * showed unticked, and saving any other personalisation setting on that page
 * switched a member's newest-first feed off.
 */
final class UsersMeFeedOrderTest extends TestCase
{
    use DatabaseTransactions;

    public function test_the_member_profile_says_whether_the_feed_is_newest_first(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('users')->where('id', $user->id)->update(['prefers_chronological_feed' => 1]);
        Sanctum::actingAs($user, ['*']);

        $this->apiGet('/v2/users/me')
            ->assertOk()
            ->assertJsonPath('data.prefers_chronological_feed', true);
    }

    public function test_it_is_false_when_the_member_has_not_chosen_it(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($user, ['*']);

        $this->apiGet('/v2/users/me')
            ->assertOk()
            ->assertJsonPath('data.prefers_chronological_feed', false);
    }
}
