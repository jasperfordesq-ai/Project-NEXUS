<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E117;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-607 (E-117) — F-084 residue. The member spotlight
 * (`GET /v2/gamification/member-spotlight`) and the current season leaderboard
 * (`GET /v2/gamification/seasons/current`) gave every signed-in member other
 * members' surnames. The spotlight also featured suspended members, profiles
 * visible to connections only, and members who opted out of member search,
 * with the first 120 characters of their bio.
 *
 * `last_name` stays in the payload as null rather than being removed: removing
 * it broke the store mobile app's schema once already (F-591).
 */
final class F607SpotlightAndSeasonSurnamesTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // Only this test's members may qualify for the spotlight or the season
        // fallback ranking, so every eligible member is returned (rolled back).
        $ids = DB::table('users')->where('tenant_id', $this->testTenantId)->pluck('id');
        DB::table('users')->whereIn('id', $ids)->update(['xp' => 0]);
        DB::table('user_badges')->whereIn('user_id', $ids)->delete();
    }

    private function member(string $last, array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'first_name' => 'Spot',
            'last_name' => $last,
            'status' => 'active',
            'is_approved' => true,
            'xp' => 500,
            'privacy_profile' => 'public',
            'privacy_search' => 1,
        ], $overrides));
    }

    public function test_spotlight_shows_members_first_names_only_and_respects_privacy(): void
    {
        $viewer = $this->member('Viewerzyx', ['xp' => 0]);
        $shown = $this->member('Shownzyx');
        $connectionsOnly = $this->member('Privatezyx', ['privacy_profile' => 'connections']);
        $optedOut = $this->member('Optoutzyx', ['privacy_search' => 0]);
        $suspended = $this->member('Suspendedzyx', ['status' => 'suspended']);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet('/v2/gamification/member-spotlight?limit=10');

        $response->assertStatus(200);
        $this->assertStringNotContainsString('zyx', (string) $response->getContent(), 'no surname may reach an ordinary member');
        $ids = array_map('intval', array_column($response->json('data') ?? [], 'id'));
        $this->assertContains((int) $shown->id, $ids, 'control: an ordinary public member is featured');
        $this->assertNotContains((int) $connectionsOnly->id, $ids, 'a connections-only profile is not featured to strangers');
        $this->assertNotContains((int) $optedOut->id, $ids, 'a member who opted out of member search is not featured');
        $this->assertNotContains((int) $suspended->id, $ids, 'a suspended member is not featured');
        $row = collect($response->json('data'))->firstWhere('id', $shown->id);
        $this->assertArrayHasKey('last_name', $row, 'the key stays for client schemas (F-591)');
        $this->assertNull($row['last_name']);
        $this->assertSame('Spot', $row['first_name']);
    }

    public function test_season_leaderboard_shows_other_members_first_names_only(): void
    {
        $viewer = $this->member('Viewerzyx');
        $other = $this->member('Otherzyx', ['xp' => 900]);
        $suspended = $this->member('Suspendedzyx', ['status' => 'suspended', 'xp' => 950]);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet('/v2/gamification/seasons/current');

        $response->assertStatus(200);
        $rows = collect($response->json('data.leaderboard') ?? []);
        $otherRow = $rows->firstWhere('user_id', $other->id);
        $this->assertNotNull($otherRow, 'control: the other member is ranked');
        $this->assertNull($otherRow['last_name'], 'another member\'s surname is withheld');
        $this->assertSame('Viewerzyx', $rows->firstWhere('user_id', $viewer->id)['last_name'] ?? null, 'a member still sees their own surname');
        $this->assertNull($rows->firstWhere('user_id', $suspended->id), 'a suspended member is not ranked');
        $this->assertStringNotContainsString('Otherzyx', (string) $response->getContent());
    }

    public function test_an_administrator_still_sees_surnames(): void
    {
        $admin = $this->member('Adminzyx', ['role' => 'admin', 'xp' => 0]);
        $shown = $this->member('Shownzyx');
        Sanctum::actingAs($admin, ['*']);

        $spotlight = collect($this->apiGet('/v2/gamification/member-spotlight?limit=10')->json('data'));
        $this->assertSame('Shownzyx', $spotlight->firstWhere('id', $shown->id)['last_name'] ?? null);

        $season = collect($this->apiGet('/v2/gamification/seasons/current')->json('data.leaderboard'));
        $this->assertSame('Shownzyx', $season->firstWhere('user_id', $shown->id)['last_name'] ?? null);
    }
}
