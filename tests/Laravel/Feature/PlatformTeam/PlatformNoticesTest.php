<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Models\User;
use App\Services\PlatformTeam\PlatformNoticeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform-wide notices: the platform team writes a short notice once; every
 * community's admins see it as a band in the admin panel; members never do.
 *
 *   platform team   GET/POST /v2/platform-team/notices, PUT …/{id}, POST …/{id}/end
 *   admins          GET /v2/admin/platform-notices, POST …/{id}/dismiss
 */
class PlatformNoticesTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const TEAM = '/v2/platform-team/notices';
    private const ADMIN = '/v2/admin/platform-notices';

    protected function setUp(): void
    {
        parent::setUp();
        // The shared local test database may hold notices from another run;
        // "at most three, newest first" is only testable from a clean slate.
        DB::table('platform_notices')->delete();
    }

    /** @param array<string, mixed> $over */
    private function notice(array $over = []): int
    {
        return (int) DB::table('platform_notices')->insertGetId(array_merge([
            'message' => 'Planned work on Tuesday evening.',
            'kind' => 'planned_work',
            'is_dismissible' => 1,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $over));
    }

    /** @return list<int> the ids an admin is shown, in order */
    private function shownIds(): array
    {
        $items = $this->apiGet(self::ADMIN)->assertStatus(200)->json('data.notices');

        return array_map(static fn (array $n): int => (int) $n['id'], $items);
    }

    // ------------------------------------------------------------------
    // Who may write
    // ------------------------------------------------------------------

    public function test_only_the_platform_team_may_list_them(): void
    {
        $this->assertPlatformTeamOnly('GET', self::TEAM);
    }

    public function test_nobody_below_the_platform_team_can_write_change_or_end_one(): void
    {
        $id = $this->notice();

        $this->assertRefusedBelowPlatformTeam('POST', self::TEAM, ['message' => 'Refused notice']);
        $this->assertRefusedBelowPlatformTeam('PUT', self::TEAM . "/{$id}", ['message' => 'Refused change']);
        $this->assertRefusedBelowPlatformTeam('POST', self::TEAM . "/{$id}/end");

        $row = DB::table('platform_notices')->where('id', $id)->first();
        $this->assertSame('Planned work on Tuesday evening.', $row->message);
        $this->assertSame(1, (int) $row->is_active);
        $this->assertSame(0, DB::table('platform_notices')->where('message', 'Refused notice')->count());
    }

    // ------------------------------------------------------------------
    // Writing
    // ------------------------------------------------------------------

    public function test_the_platform_team_writes_a_notice_and_it_is_recorded_against_them(): void
    {
        $me = $this->actAsPlatformTeam();

        $response = $this->apiPost(self::TEAM, [
            'message' => 'A new release went out today.',
            'kind' => 'info',
            'link_url' => 'https://example.test/changelog',
            'link_label' => 'What changed',
            'is_dismissible' => true,
        ])->assertStatus(201);

        $id = (int) $response->json('data.notice.id');
        $row = DB::table('platform_notices')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('A new release went out today.', $row->message);
        $this->assertSame('info', $row->kind);
        $this->assertSame((int) $me->id, (int) $row->created_by);
        $this->assertSame('live', $response->json('data.notice.state'));
        $this->assertTrue(
            DB::table('activity_log')->where('user_id', $me->id)->where('action', 'platform_notice_created')->exists(),
            'writing a notice is recorded with the account that did it',
        );
    }

    public function test_anything_that_looks_like_code_is_saved_as_plain_text(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::TEAM, [
            'message' => 'Hello <script>alert(1)</script><b>admins</b>',
        ])->assertStatus(201);

        $saved = (string) $response->json('data.notice.message');
        $this->assertStringNotContainsString('<', $saved);
        $this->assertStringNotContainsString('alert', $saved);
        $this->assertStringContainsString('admins', $saved);
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function refusedNotices(): array
    {
        return [
            'no message' => [['message' => '   '], 'message'],
            'message too long' => [['message' => str_repeat('a', 281)], 'message'],
            'a kind that does not exist' => [['message' => 'x', 'kind' => 'celebration'], 'kind'],
            'an http link' => [['message' => 'x', 'link_url' => 'http://example.test/', 'link_label' => 'Go'], 'link_url'],
            'a javascript link' => [['message' => 'x', 'link_url' => 'javascript:alert(1)', 'link_label' => 'Go'], 'link_url'],
            // A page "on this site" means nothing for a notice shown in every community.
            'a link to a path' => [['message' => 'x', 'link_url' => '/admin', 'link_label' => 'Go'], 'link_url'],
            'a link with no words' => [['message' => 'x', 'link_url' => 'https://example.test/'], 'link_label'],
            'an end before the start' => [['message' => 'x', 'starts_at' => '2026-12-02T10:00', 'ends_at' => '2026-12-01T10:00'], 'ends_at'],
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @dataProvider refusedNotices
     */
    public function test_a_notice_that_breaks_a_rule_is_refused_and_not_saved(array $payload, string $field): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::TEAM, $payload)->assertStatus(422);

        $this->assertContains($field, array_column($response->json('errors'), 'field'));
        $this->assertSame(0, DB::table('platform_notices')->count());
    }

    public function test_a_notice_can_be_changed_and_the_change_is_recorded(): void
    {
        $id = $this->notice();
        $me = $this->actAsPlatformTeam();

        $this->apiPut(self::TEAM . "/{$id}", ['message' => 'Planned work moved to Wednesday.'])->assertStatus(200);

        $row = DB::table('platform_notices')->where('id', $id)->first();
        $this->assertSame('Planned work moved to Wednesday.', $row->message);
        $this->assertSame('planned_work', $row->kind, 'a field that was not sent is left alone');
        $this->assertSame((int) $me->id, (int) $row->updated_by);
        $this->assertTrue(DB::table('activity_log')->where('user_id', $me->id)->where('action', 'platform_notice_changed')->exists());
    }

    public function test_ending_a_notice_takes_it_away_from_admins_and_is_recorded(): void
    {
        $id = $this->notice();
        $me = $this->actAsPlatformTeam();

        $this->apiPost(self::TEAM . "/{$id}/end")->assertStatus(200)->assertJsonPath('data.notice.state', 'ended');

        $row = DB::table('platform_notices')->where('id', $id)->first();
        $this->assertSame(0, (int) $row->is_active);
        $this->assertSame((int) $me->id, (int) $row->ended_by);
        $this->assertNotNull($row->ended_at);
        $this->assertTrue(DB::table('activity_log')->where('user_id', $me->id)->where('action', 'platform_notice_ended')->exists());

        $this->actAsCommunityAdmin();
        $this->assertSame([], $this->shownIds());
    }

    /** An ended notice stays ended: changing its words must not bring it back. */
    public function test_changing_an_ended_notice_does_not_bring_it_back(): void
    {
        $id = $this->notice(['is_active' => 0, 'ended_at' => now()]);
        $this->actAsPlatformTeam();

        $this->apiPut(self::TEAM . "/{$id}", ['message' => 'Edited', 'is_active' => true])->assertStatus(200);

        $this->assertSame(0, (int) DB::table('platform_notices')->where('id', $id)->value('is_active'));
    }

    public function test_changing_or_ending_a_notice_that_does_not_exist_is_not_found(): void
    {
        $this->actAsPlatformTeam();

        $this->apiPut(self::TEAM . '/999999999', ['message' => 'x'])->assertStatus(404);
        $this->apiPost(self::TEAM . '/999999999/end')->assertStatus(404);
    }

    public function test_the_list_says_what_state_each_notice_is_in(): void
    {
        $live = $this->notice();
        $scheduled = $this->notice(['starts_at' => now()->addDay()]);
        $expired = $this->notice(['ends_at' => now()->subDay()]);
        $ended = $this->notice(['is_active' => 0, 'ended_at' => now()]);
        $this->actAsPlatformTeam();

        $states = [];
        foreach ($this->apiGet(self::TEAM)->assertStatus(200)->json('data.notices') as $notice) {
            $states[(int) $notice['id']] = $notice['state'];
        }

        $this->assertSame('live', $states[$live]);
        $this->assertSame('scheduled', $states[$scheduled]);
        $this->assertSame('expired', $states[$expired]);
        $this->assertSame('ended', $states[$ended]);
    }

    // ------------------------------------------------------------------
    // Who sees it
    // ------------------------------------------------------------------

    public function test_a_community_admin_sees_live_notices_only_newest_first_three_at_most(): void
    {
        $this->notice(['starts_at' => now()->addDay()]);                    // not yet
        $this->notice(['ends_at' => now()->subMinute()]);                   // over
        $this->notice(['is_active' => 0, 'ended_at' => now()]);             // ended early
        $oldest = $this->notice(['created_at' => now()->subDays(4)]);
        $third = $this->notice(['created_at' => now()->subDays(3)]);
        $second = $this->notice(['created_at' => now()->subDays(2)]);
        $newest = $this->notice(['created_at' => now()->subDay(), 'starts_at' => now()->subHour(), 'ends_at' => now()->addHour()]);
        $this->actAsCommunityAdmin();

        $this->assertSame(PlatformNoticeService::MAX_SHOWN, 3);
        $this->assertSame([$newest, $second, $third], $this->shownIds());
        $this->assertNotContains($oldest, $this->shownIds());
    }

    public function test_an_admin_is_sent_only_what_the_band_shows(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create(['first_name' => 'Planted', 'last_name' => 'Author']);
        $this->notice(['created_by' => $author->id, 'link_url' => 'https://example.test/x', 'link_label' => 'Read more']);
        $this->actAsCommunityAdmin();

        $response = $this->apiGet(self::ADMIN)->assertStatus(200);
        $keys = array_keys($response->json('data.notices.0'));
        sort($keys);

        $this->assertSame(['id', 'is_dismissible', 'kind', 'link_label', 'link_url', 'message'], $keys);
        // Who on the platform team wrote it is not an admin's business.
        $this->assertStringNotContainsString('Planted', $response->getContent());
    }

    public function test_members_and_brokers_are_refused(): void
    {
        $id = $this->notice();

        foreach (['member', 'broker', 'coordinator'] as $role) {
            $this->actAsTier(['role' => $role]);
            $this->apiGet(self::ADMIN)->assertStatus(403);
            $this->apiPost(self::ADMIN . "/{$id}/dismiss")->assertStatus(403);
        }
        $this->assertSame(0, DB::table('platform_notice_dismissals')->where('notice_id', $id)->count());
    }

    // ------------------------------------------------------------------
    // Closing it
    // ------------------------------------------------------------------

    public function test_closing_a_notice_hides_it_for_that_person_only_and_twice_is_fine(): void
    {
        $id = $this->notice();

        $first = $this->actAsCommunityAdmin();
        $this->apiPost(self::ADMIN . "/{$id}/dismiss")->assertStatus(200);
        $this->apiPost(self::ADMIN . "/{$id}/dismiss")->assertStatus(200);
        $this->assertSame([], $this->shownIds());
        $this->assertSame(1, DB::table('platform_notice_dismissals')->where('notice_id', $id)->where('user_id', $first->id)->count());

        // Another admin still sees it.
        $this->actAsCommunityAdmin();
        $this->assertSame([$id], $this->shownIds());
    }

    public function test_a_notice_that_may_not_be_closed_cannot_be_closed(): void
    {
        $id = $this->notice(['is_dismissible' => 0]);
        $this->actAsCommunityAdmin();

        $this->apiPost(self::ADMIN . "/{$id}/dismiss")->assertStatus(422);

        $this->assertSame([$id], $this->shownIds());
        $this->assertSame(0, DB::table('platform_notice_dismissals')->where('notice_id', $id)->count());
    }

    public function test_closing_a_notice_that_does_not_exist_is_not_found(): void
    {
        $this->actAsCommunityAdmin();

        $this->apiPost(self::ADMIN . '/999999999/dismiss')->assertStatus(404);
    }

    public function test_the_list_tells_the_platform_team_how_many_people_closed_a_notice(): void
    {
        $id = $this->notice();
        $this->actAsCommunityAdmin();
        $this->apiPost(self::ADMIN . "/{$id}/dismiss")->assertStatus(200);
        $this->actAsPlatformTeam();

        $notices = $this->apiGet(self::TEAM)->assertStatus(200)->json('data.notices');

        $this->assertSame(1, $notices[0]['closed_count']);
    }
}
