<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-246 (E-055 H-1 / E-2) — the per-member sub-resources (availability,
 * compatible times, skills, endorsements, appreciations, public collections,
 * verification badges, exchange rating) apply the same gate as the profile
 * route GET /v2/users/{id}: a block in either direction is refused with 403,
 * and the member's "connections only" choice with 404 PROFILE_PRIVATE. The
 * "who is available on day N" directory applies the member directory's
 * discovery rules (search opt-out, onboarding visibility, active status,
 * connections-only, blocks either way) and shows no surname.
 */
final class F246MemberSubresourceVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    private int $tid;

    /** @return array<string, string> */
    private function perMemberPaths(int $id): array
    {
        return [
            'profile' => "/v2/users/{$id}",
            'availability' => "/v2/users/{$id}/availability",
            'compatible' => "/v2/members/availability/compatible?user_id={$id}",
            'skills' => "/v2/users/{$id}/skills",
            'endorsements' => "/v2/members/{$id}/endorsements",
            'appreciations' => "/v2/users/{$id}/appreciations",
            'collections' => "/v2/users/{$id}/public-collections",
            'verification-badges' => "/v2/users/{$id}/verification-badges",
            'rating' => "/v2/users/{$id}/rating",
        ];
    }

    private const MARKERS = ['F246Surname', 'F246-NOTE', 'F246-SKILL', 'F246-ENDORSE', 'F246-APPRECIATE', 'F246-COLLECTION'];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->tid = $this->testTenantId;
    }

    public function test_per_member_subresources_follow_the_profile_gate(): void
    {
        $target = $this->u(['first_name' => 'Wren', 'last_name' => 'F246Surname', 'privacy_profile' => 'connections', 'privacy_search' => 0]);
        $stranger = $this->u();
        $blocked = $this->u();   // the target blocked this member
        $blocker = $this->u();   // this member blocked the target
        $friend = $this->u();
        $this->connect($friend, $target);
        $this->block($target, $blocked);
        $this->block($blocker, $target);
        $this->seedSubresources($target, $friend);

        $paths = $this->perMemberPaths((int) $target->id);
        $viewers = ['guest' => null, 'stranger' => $stranger, 'blocked' => $blocked, 'blocker' => $blocker, 'friend' => $friend, 'self' => $target];

        $rows = [];
        foreach ($viewers as $label => $viewer) {
            $this->actAs($viewer);
            foreach ($paths as $name => $uri) {
                $res = $this->apiGet($uri);
                $body = (string) $res->getContent();
                $rows[$name][$label] = [
                    'status' => $res->status(),
                    'code' => (string) (json_decode($body, true)['errors'][0]['code'] ?? ''),
                    'leaks' => array_values(array_filter(self::MARKERS, fn ($m) => str_contains($body, $m))),
                ];
            }
        }

        foreach ($paths as $name => $_) {
            if ($name === 'profile') {
                continue;
            }
            // A guest never receives any of it.
            self::assertNotSame(200, $rows[$name]['guest']['status'], "$name: guest must be refused");
            self::assertSame([], $rows[$name]['guest']['leaks'], "$name: guest must see no data");

            // Stranger on a connections-only profile: same answer as the profile route.
            self::assertSame($rows['profile']['stranger']['status'], $rows[$name]['stranger']['status'], "$name: stranger status must match the profile route");
            self::assertSame(404, $rows[$name]['stranger']['status'], "$name: stranger must get 404");
            self::assertSame('PROFILE_PRIVATE', $rows[$name]['stranger']['code'], "$name: stranger must get PROFILE_PRIVATE");
            self::assertSame([], $rows[$name]['stranger']['leaks'], "$name: stranger must see no data");

            // Block either way: 403, as the profile route.
            foreach (['blocked', 'blocker'] as $label) {
                self::assertSame(403, $rows['profile'][$label]['status'], "profile control: $label");
                self::assertSame(403, $rows[$name][$label]['status'], "$name: $label must get 403 like the profile route");
                self::assertSame([], $rows[$name][$label]['leaks'], "$name: $label must see no data");
            }

            // Controls: an accepted connection and the owner still get the data.
            self::assertSame(200, $rows[$name]['friend']['status'], "$name: accepted connection must still get 200");
            self::assertSame(200, $rows[$name]['self']['status'], "$name: owner must still get 200");
        }
        self::assertSame(200, $rows['profile']['friend']['status']);

        // The data really is there for the rightful viewers.
        self::assertContains('F246-NOTE', $rows['availability']['friend']['leaks']);
        self::assertContains('F246-NOTE', $rows['availability']['self']['leaks']);
        self::assertContains('F246-SKILL', $rows['skills']['friend']['leaks']);
        self::assertContains('F246-ENDORSE', $rows['endorsements']['friend']['leaks']);
        self::assertContains('F246-APPRECIATE', $rows['appreciations']['friend']['leaks']);
        self::assertContains('F246-COLLECTION', $rows['collections']['friend']['leaks']);
        self::assertContains('F246-COLLECTION', $rows['collections']['self']['leaks']);
    }

    public function test_block_on_a_public_profile_is_refused_like_the_profile_route(): void
    {
        $target = $this->u(['privacy_profile' => 'public']);
        $blocked = $this->u();
        $other = $this->u();
        $this->block($target, $blocked);
        $this->seedSubresources($target, $other);

        foreach ($this->perMemberPaths((int) $target->id) as $name => $uri) {
            $this->actAs($blocked);
            $res = $this->apiGet($uri);
            self::assertSame(403, $res->status(), "$name: blocked viewer of a public profile must get 403");
            self::assertStringNotContainsString('F246-', (string) $res->getContent(), "$name: no data for a blocked viewer");

            $this->actAs($other);
            self::assertSame(200, $this->apiGet($uri)->status(), "$name: unrelated member still sees a public profile");
        }
    }

    public function test_available_members_directory_applies_directory_visibility_and_hides_surnames(): void
    {
        $viewer = $this->u();
        $listed = $this->u(['first_name' => 'Ada', 'last_name' => 'F246ListedSurname', 'privacy_profile' => 'public', 'privacy_search' => 1]);
        $optedOut = $this->u(['privacy_profile' => 'public', 'privacy_search' => 0]);
        $connectionsOnly = $this->u(['privacy_profile' => 'connections', 'privacy_search' => 1]);
        $connectionsOnlyFriend = $this->u(['privacy_profile' => 'connections', 'privacy_search' => 1]);
        $blockedByViewer = $this->u(['privacy_profile' => 'public', 'privacy_search' => 1]);
        $blockedViewer = $this->u(['privacy_profile' => 'public', 'privacy_search' => 1]);
        $suspended = $this->u(['privacy_profile' => 'public', 'privacy_search' => 1, 'status' => 'suspended']);
        $this->connect($viewer, $connectionsOnlyFriend);
        $this->block($viewer, $blockedByViewer);
        $this->block($blockedViewer, $viewer);

        $all = [$listed, $optedOut, $connectionsOnly, $connectionsOnlyFriend, $blockedByViewer, $blockedViewer, $suspended];
        foreach ($all as $u) {
            DB::table('member_availability')->insert([
                'tenant_id' => $this->tid, 'user_id' => (int) $u->id, 'day_of_week' => 3,
                'start_time' => '03:17:00', 'end_time' => '03:59:00', 'is_recurring' => 1,
                'specific_date' => null, 'note' => null, 'created_at' => now(),
            ]);
        }

        $this->actAs($viewer);
        $res = $this->apiGet('/v2/members/availability/available?day=3&time=03:30&limit=100');
        $res->assertStatus(200);
        $ids = array_map(static fn ($r) => (int) $r['user_id'], $res->json('data') ?? []);
        $body = (string) $res->getContent();

        // Controls: a listed member and a connections-only member the viewer is connected to.
        self::assertContains((int) $listed->id, $ids, 'a listed member must still appear');
        self::assertContains((int) $connectionsOnlyFriend->id, $ids, 'a connections-only member must still appear to a connection');

        self::assertNotContains((int) $optedOut->id, $ids, 'member who opted out of search must not be listed');
        self::assertNotContains((int) $connectionsOnly->id, $ids, 'connections-only member must not be listed to a non-connection');
        self::assertNotContains((int) $blockedByViewer->id, $ids, 'member the viewer blocked must not be listed');
        self::assertNotContains((int) $blockedViewer->id, $ids, 'member who blocked the viewer must not be listed');
        self::assertNotContains((int) $suspended->id, $ids, 'non-active member must not be listed');

        // F-084: first name only, as in the member directory.
        self::assertStringNotContainsString('F246ListedSurname', $body, 'surname must not be shown');
        $row = collect($res->json('data'))->firstWhere('user_id', (int) $listed->id);
        self::assertSame('Ada', $row['member_name'] ?? null);
    }

    private function seedSubresources(User $target, User $other): void
    {
        $tid = $this->tid;
        DB::table('member_availability')->insert([
            ['tenant_id' => $tid, 'user_id' => (int) $target->id, 'day_of_week' => 3, 'start_time' => '09:00:00', 'end_time' => '12:00:00', 'is_recurring' => 1, 'specific_date' => null, 'note' => null, 'created_at' => now()],
            ['tenant_id' => $tid, 'user_id' => (int) $target->id, 'day_of_week' => 5, 'start_time' => '14:00:00', 'end_time' => '16:00:00', 'is_recurring' => 0, 'specific_date' => now()->addDays(3)->toDateString(), 'note' => 'F246-NOTE away at the hospital until 4', 'created_at' => now()],
        ]);
        DB::table('user_skills')->insert(['tenant_id' => $tid, 'user_id' => (int) $target->id, 'skill_name' => 'F246-SKILL grief counselling', 'proficiency' => 'expert', 'is_offering' => 1, 'created_at' => now()]);
        DB::table('skill_endorsements')->insert(['tenant_id' => $tid, 'endorser_id' => (int) $other->id, 'endorsed_id' => (int) $target->id, 'skill_name' => 'F246-SKILL grief counselling', 'comment' => 'F246-ENDORSE helped after my loss', 'created_at' => now()]);
        DB::table('appreciations')->insert(['tenant_id' => $tid, 'sender_id' => (int) $other->id, 'receiver_id' => (int) $target->id, 'message' => 'F246-APPRECIATE thank you for the lift', 'is_public' => 1, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('saved_collections')->insert(['tenant_id' => $tid, 'user_id' => (int) $target->id, 'name' => 'F246-COLLECTION support', 'is_public' => 1, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function connect(User $a, User $b): void
    {
        DB::table('connections')->insert(['tenant_id' => $this->tid, 'requester_id' => (int) $a->id, 'receiver_id' => (int) $b->id, 'status' => 'accepted', 'created_at' => now()]);
    }

    private function block(User $blocker, User $blockee): void
    {
        DB::table('user_blocks')->insert(['tenant_id' => $this->tid, 'user_id' => (int) $blocker->id, 'blocked_user_id' => (int) $blockee->id, 'created_at' => now()]);
    }

    private function actAs(?User $viewer): void
    {
        $this->app['auth']->forgetGuards();
        if ($viewer !== null) {
            Sanctum::actingAs($viewer, ['*']);
        }
    }

    private function u(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge(['status' => 'active', 'is_approved' => true], $attrs));
    }
}
