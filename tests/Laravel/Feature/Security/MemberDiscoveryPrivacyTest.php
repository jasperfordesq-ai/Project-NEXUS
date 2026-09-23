<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CommentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-080 (E-027) — "Don't show me in member search" (`users.privacy_search`)
 * and the community's listing requirements are enforced by
 * MemberDirectoryVisibility on the directory, but the other places one member
 * DISCOVERS another ignored them: the feed sidebar's suggested members, the
 * "People you may know" connection suggestions, @mention autocomplete (new and
 * legacy) and members-by-skill. Those surfaces also showed surnames, which the
 * directory hides from everyone but administrators.
 */
class MemberDiscoveryPrivacyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    // ------------------------------------------------------------------
    //  Feed sidebar suggested members
    // ------------------------------------------------------------------

    public function test_suggested_members_exclude_opted_out_members_and_hide_surnames(): void
    {
        $viewer = $this->member();
        $listed = $this->member(['last_name' => 'Listedsurname', 'last_active_at' => now()->addMinutes(30)]);
        $optedOut = $this->member(['privacy_search' => 0, 'last_active_at' => now()->addMinutes(31)]);
        Sanctum::actingAs($viewer, ['*']);

        $rows = $this->apiGet('/v2/members/suggested?limit=20')->assertStatus(200)->json('data');
        $byId = $this->indexById($rows);

        $this->assertArrayNotHasKey($optedOut->id, $byId, 'An opted-out member must not be suggested.');
        $this->assertArrayHasKey($listed->id, $byId, 'A listed member is still suggested.');
        $this->assertSurnameHidden($byId[$listed->id], $listed);
    }

    public function test_feed_sidebar_suggested_members_exclude_opted_out_members_and_hide_surnames(): void
    {
        $viewer = $this->member();
        $listed = $this->member(['last_name' => 'Sidebarsurname', 'last_active_at' => now()->addMinutes(40)]);
        $optedOut = $this->member(['privacy_search' => 0, 'last_active_at' => now()->addMinutes(41)]);
        Sanctum::actingAs($viewer, ['*']);

        $rows = $this->apiGet('/v2/feed/sidebar')->assertStatus(200)->json('data.suggested_members');
        $byId = $this->indexById($rows ?? []);

        $this->assertArrayNotHasKey($optedOut->id, $byId);
        $this->assertArrayHasKey($listed->id, $byId);
        $this->assertSurnameHidden($byId[$listed->id], $listed);
    }

    // ------------------------------------------------------------------
    //  Connection suggestions
    // ------------------------------------------------------------------

    public function test_connection_suggestions_exclude_opted_out_members_and_hide_surname_and_full_bio(): void
    {
        $viewer = $this->member();
        $friend = $this->member();
        $longBio = str_repeat('A long biography sentence. ', 20);
        $listed = $this->member(['last_name' => 'Suggestsurname', 'name' => 'Suggest Suggestsurname', 'bio' => $longBio]);
        $optedOut = $this->member(['privacy_search' => 0]);
        $this->connect($viewer, $friend);
        $this->connect($listed, $friend);
        $this->connect($optedOut, $friend);
        Sanctum::actingAs($viewer, ['*']);

        $rows = $this->apiGet('/v2/connections/suggestions?limit=20')->assertStatus(200)->json('data.suggestions');
        $byId = $this->indexById($rows ?? []);

        $this->assertArrayNotHasKey($optedOut->id, $byId);
        $this->assertArrayHasKey($listed->id, $byId);
        $this->assertSurnameHidden($byId[$listed->id], $listed);
        $this->assertLessThanOrEqual(120, mb_strlen((string) ($byId[$listed->id]['bio'] ?? '')));
    }

    // ------------------------------------------------------------------
    //  Mention autocomplete
    // ------------------------------------------------------------------

    public function test_mention_search_excludes_opted_out_members_and_hides_surnames(): void
    {
        $needle = 'Mdp' . substr(md5(uniqid('', true)), 0, 8);
        $viewer = $this->member();
        $listed = $this->member(['first_name' => $needle, 'last_name' => 'Mentionsurname', 'name' => $needle . ' Mentionsurname']);
        $optedOut = $this->member(['first_name' => $needle, 'name' => $needle . ' Hidden', 'privacy_search' => 0]);
        $suspended = $this->member(['first_name' => $needle, 'name' => $needle . ' Suspended', 'status' => 'suspended']);
        Sanctum::actingAs($viewer, ['*']);

        $byId = $this->indexById($this->apiGet('/v2/mentions/search?q=' . $needle)->assertStatus(200)->json('data') ?? []);
        $this->assertArrayNotHasKey($optedOut->id, $byId);
        $this->assertArrayNotHasKey($suspended->id, $byId);
        $this->assertArrayHasKey($listed->id, $byId);
        $this->assertSurnameHidden($byId[$listed->id], $listed);

        $legacy = $this->indexById(CommentService::searchUsersForMention($needle, $this->testTenantId, 10, $viewer->id));
        $this->assertArrayNotHasKey($optedOut->id, $legacy);
        $this->assertArrayNotHasKey($suspended->id, $legacy, 'The legacy route must only suggest active members.');
        $this->assertArrayHasKey($listed->id, $legacy);
        $this->assertSurnameHidden($legacy[$listed->id], $listed);
    }

    public function test_admin_still_sees_surnames_in_mention_search(): void
    {
        $needle = 'Mda' . substr(md5(uniqid('', true)), 0, 8);
        $admin = $this->member(['role' => 'admin']);
        $listed = $this->member(['first_name' => $needle, 'last_name' => 'Adminseen', 'name' => $needle . ' Adminseen']);
        Sanctum::actingAs($admin, ['*']);

        $byId = $this->indexById($this->apiGet('/v2/mentions/search?q=' . $needle)->assertStatus(200)->json('data') ?? []);

        $this->assertArrayHasKey($listed->id, $byId);
        $this->assertStringContainsString('Adminseen', (string) $byId[$listed->id]['name']);
    }

    // ------------------------------------------------------------------
    //  Members by skill
    // ------------------------------------------------------------------

    public function test_members_with_skill_exclude_opted_out_and_blocked_members_and_hide_surnames(): void
    {
        $skill = 'Skill' . substr(md5(uniqid('', true)), 0, 8);
        $viewer = $this->member();
        $listed = $this->member(['last_name' => 'Skillsurname']);
        $optedOut = $this->member(['privacy_search' => 0]);
        $blocked = $this->member();
        foreach ([$listed, $optedOut, $blocked] as $member) {
            DB::table('user_skills')->insert([
                'user_id' => $member->id,
                'tenant_id' => $this->testTenantId,
                'skill_name' => $skill,
                'proficiency' => 'expert',
            ]);
        }
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $blocked->id,
            'blocked_user_id' => $viewer->id,
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $byId = $this->indexById($this->apiGet('/v2/skills/members?skill=' . $skill)->assertStatus(200)->json('data') ?? []);

        $this->assertArrayNotHasKey($optedOut->id, $byId);
        $this->assertArrayNotHasKey($blocked->id, $byId);
        $this->assertArrayHasKey($listed->id, $byId);
        $this->assertArrayNotHasKey('last_name', $byId[$listed->id]);
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    /** @param array<string, mixed> $row */
    private function assertSurnameHidden(array $row, User $member): void
    {
        $this->assertTrue(
            !array_key_exists('last_name', $row) || $row['last_name'] === null || $row['last_name'] === '',
            'A surname must not be returned to a non-admin viewer.'
        );
        $this->assertStringNotContainsString((string) $member->last_name, (string) ($row['name'] ?? ''));
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
            'avatar_url' => '/uploads/test/discovery-avatar.png',
            'bio' => 'Member discovery privacy fixture.',
            'last_active_at' => now(),
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
