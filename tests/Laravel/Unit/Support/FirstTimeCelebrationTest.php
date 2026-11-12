<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Models\User;
use App\Support\FirstTimeCelebration;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * "Your first offer!" — the note a create response carries in its `meta` when
 * what was just created is the member's very first of its kind in this
 * community (warmth phase 5).
 */
class FirstTimeCelebrationTest extends TestCase
{
    use DatabaseTransactions;

    private function member(?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create();
    }

    private function listing(int $tenantId, int $userId, array $extra = []): void
    {
        DB::table('listings')->insert(array_merge([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'title' => 'Help in the garden',
            'description' => 'An hour of weeding.',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    public function test_the_first_of_its_kind_is_celebrated_and_the_second_is_not(): void
    {
        $member = $this->member();

        $this->listing($this->testTenantId, $member->id);
        $this->assertSame(
            ['celebrate' => 'first_listing'],
            FirstTimeCelebration::metaFor('listing', $this->testTenantId, $member->id),
        );

        $this->listing($this->testTenantId, $member->id);
        $this->assertNull(FirstTimeCelebration::metaFor('listing', $this->testTenantId, $member->id));
    }

    public function test_it_counts_everything_the_member_ever_made_even_if_since_removed(): void
    {
        $member = $this->member();

        // A removed offer still counts: making another is not a first.
        $this->listing($this->testTenantId, $member->id, ['status' => 'closed', 'deleted_at' => now()]);
        $this->listing($this->testTenantId, $member->id);

        $this->assertNull(FirstTimeCelebration::metaFor('listing', $this->testTenantId, $member->id));
    }

    public function test_another_members_and_another_communitys_rows_do_not_count(): void
    {
        $member = $this->member();
        $neighbour = $this->member();

        // The neighbour already has three; this member's first is still a first.
        $this->listing($this->testTenantId, $neighbour->id);
        $this->listing($this->testTenantId, $neighbour->id);
        $this->listing($this->testTenantId, $neighbour->id);
        $this->listing($this->testTenantId, $member->id);

        $this->assertSame(
            ['celebrate' => 'first_listing'],
            FirstTimeCelebration::metaFor('listing', $this->testTenantId, $member->id),
        );

        // The same member id read against another community sees nothing of this one.
        $this->assertNull(FirstTimeCelebration::metaFor('listing', $this->testTenantId + 99999, $member->id));
    }

    public function test_nothing_created_is_nothing_to_celebrate(): void
    {
        $member = $this->member();

        $this->assertNull(FirstTimeCelebration::metaFor('listing', $this->testTenantId, $member->id));
        $this->assertNull(FirstTimeCelebration::metaFor('event', $this->testTenantId, $member->id));
        $this->assertNull(FirstTimeCelebration::metaFor('group', $this->testTenantId, $member->id));
    }

    public function test_an_unknown_kind_is_never_celebrated(): void
    {
        $member = $this->member();

        $this->assertNull(FirstTimeCelebration::metaFor('users; DROP TABLE users', $this->testTenantId, $member->id));
        $this->assertNull(FirstTimeCelebration::metaFor('', $this->testTenantId, $member->id));
    }

    public function test_events_and_groups_use_their_own_owner_columns(): void
    {
        $member = $this->member();

        DB::table('events')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'title' => 'Repair café',
            'description' => 'Bring something broken.',
            'start_time' => now()->addWeek(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame(
            ['celebrate' => 'first_event'],
            FirstTimeCelebration::metaFor('event', $this->testTenantId, $member->id),
        );

        DB::table('groups')->insert([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $member->id,
            'name' => 'Riverside walkers',
            'slug' => 'riverside-walkers-' . $member->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame(
            ['celebrate' => 'first_group'],
            FirstTimeCelebration::metaFor('group', $this->testTenantId, $member->id),
        );
    }
}
