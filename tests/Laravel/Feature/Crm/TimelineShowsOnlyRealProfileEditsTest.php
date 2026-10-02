<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Crm;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The CRM Activity Timeline's "Updated their profile" entry used to be
 * `users.updated_at > users.created_at`, so ANY write to a member's row — the
 * leaderboard season job awarding bonus points at midnight, an admin edit, a
 * presence update — was shown as the member editing their profile, at the
 * time of that write. On hour-timebank (2026-10-01) nine members "updated
 * their profile" at 00:00:20, none of whom had signed in.
 *
 * The entry must come from a record written when the member actually saved
 * a change to their own profile, and carry that moment.
 */
class TimelineShowsOnlyRealProfileEditsTest extends TestCase
{
    use DatabaseTransactions;

    private function profileEntriesFor(int $userId): array
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/timeline?days=0&type=profile_updated&user_id=' . $userId);
        $response->assertStatus(200);

        return collect($response->json('data'))
            ->where('activity_type', 'profile_updated')
            ->values()
            ->all();
    }

    public function test_a_system_write_to_the_member_row_is_not_a_profile_edit(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);

        // What the leaderboard season job does: touch the row, not the profile.
        DB::table('users')->where('id', $member->id)->update([
            'xp' => DB::raw('COALESCE(xp, 0) + 50'),
            'updated_at' => now(),
        ]);

        $this->assertSame([], $this->profileEntriesFor($member->id));
    }

    public function test_a_member_saving_their_own_profile_is_shown_at_that_moment(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'bio' => 'Old bio',
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);

        Sanctum::actingAs($member);
        $this->apiPut('/v2/users/me', ['bio' => 'A brand new bio about me'])->assertStatus(200);
        $savedAt = now();

        // A later system write must not move the entry's time.
        DB::table('users')->where('id', $member->id)->update(['updated_at' => now()->addHours(3)]);

        $entries = $this->profileEntriesFor($member->id);
        $this->assertCount(1, $entries);
        $this->assertSame($member->id, (int) $entries[0]['user_id']);
        $this->assertLessThanOrEqual(
            5,
            abs(strtotime((string) $entries[0]['created_at']) - $savedAt->getTimestamp()),
            'The entry must carry the moment the member saved, not a later row write.'
        );
    }

    public function test_a_member_changing_their_photo_is_a_profile_edit(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);

        \App\Services\ProfileEditRecorder::record($member->id, $this->testTenantId, ['avatar_url']);

        $this->assertCount(1, $this->profileEntriesFor($member->id));
    }
}
