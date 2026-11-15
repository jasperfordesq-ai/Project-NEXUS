<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Http\Controllers\Api\FeedSidebarController;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A shared community goal (warmth phase 6, D1).
 *
 * The community's admin sets ONE goal on "Make it yours" ("Let's share 500
 * hours by spring"): a title, what counts (hours shared, exchanges, new offers
 * and requests, events held), a target and dates. Members see the community's
 * progress on their dashboard through GET /v2/community/this-month — a total
 * for the whole community, never a figure for one member. Ending a goal, or
 * its end date passing, keeps it as "What we've done together".
 *
 *   PUT    /v2/admin/community-setup/goal
 *   DELETE /v2/admin/community-setup/goal
 */
class CommunityGoalTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 990613;

    protected function setUp(): void
    {
        parent::setUp();
        // A quiet stretch of time nothing else in the test database touches,
        // so every count starts from zero. (TIMESTAMP columns stop in 2038.)
        Carbon::setTestNow(Carbon::create(2037, 3, 15, 12, 0, 0));
        Cache::flush();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['modules' => ['events' => true]]),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        Cache::flush();
        parent::tearDown();
    }

    private function goal(array $overrides = []): array
    {
        return array_merge([
            'title' => "Let's share 500 hours by spring",
            'metric' => 'hours',
            'target' => 500,
            'starts_on' => '2037-03-01',
            'ends_on' => '2037-05-31',
        ], $overrides);
    }

    // ================================================================
    // Who may set it
    // ================================================================

    public function test_only_this_communitys_admin_may_set_or_end_the_goal(): void
    {
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal())->assertStatus(401);
        $this->apiDelete('/v2/admin/community-setup/goal')->assertStatus(401);

        Sanctum::actingAs($this->member());
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal())->assertStatus(403);
        $this->apiDelete('/v2/admin/community-setup/goal')->assertStatus(403);

        Sanctum::actingAs($this->member(['role' => 'broker']));
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal())->assertStatus(403);

        $this->assertArrayNotHasKey('community_goal', $this->config());
    }

    // ================================================================
    // Setting, changing and ending it
    // ================================================================

    public function test_a_goal_is_saved_shown_to_the_admin_and_does_not_move_the_meter(): void
    {
        $this->actAsAdmin();
        $this->apiGet('/v2/admin/community-setup')->assertOk()->assertJsonPath('data.community_goal', null);

        $saved = $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['title' => "  Let's   share 500 hours by spring "]))
            ->assertOk()
            ->json('data.community_goal');

        $this->assertSame("Let's share 500 hours by spring", $saved['title']);
        $this->assertSame('hours', $saved['metric']);
        $this->assertSame(500, $saved['target']);
        $this->assertSame(0, (int) $saved['current']);
        $this->assertFalse($saved['reached']);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{12}$/', $saved['id']);

        $stored = $this->config()['community_goal'];
        $this->assertSame($saved['id'], $stored['id']);
        $this->assertSame('2037-05-31', $stored['ends_on']);

        $setup = $this->apiGet('/v2/admin/community-setup')->assertOk();
        $setup->assertJsonPath('data.community_goal.id', $saved['id'])
            ->assertJsonPath('data.total', 6)
            ->assertJsonPath('data.done', 0);
    }

    public function test_changing_the_goal_keeps_it_and_other_settings_are_left_alone(): void
    {
        $this->actAsAdmin();
        $this->setConfig(['primary_color' => '#A3195B', 'founded_on' => '2015-06-01']);
        $id = $this->apiPut('/v2/admin/community-setup/goal', $this->goal())->assertOk()->json('data.community_goal.id');

        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['target' => 600]))
            ->assertOk()
            ->assertJsonPath('data.community_goal.id', $id)
            ->assertJsonPath('data.community_goal.target', 600);

        $config = $this->config();
        $this->assertSame('#A3195B', $config['primary_color']);
        $this->assertSame('2015-06-01', $config['founded_on']);
        $this->assertArrayNotHasKey('community_goals_done', $config);
    }

    public function test_a_goal_that_is_not_sensible_is_refused_and_nothing_is_stored(): void
    {
        $this->actAsAdmin();

        $cases = [
            'title' => [['title' => ''], ['title' => '   '], ['title' => str_repeat('a', 121)], ['title' => ['x']]],
            'metric' => [['metric' => 'members'], ['metric' => ''], ['metric' => null]],
            'target' => [['target' => 0], ['target' => -5], ['target' => 1000001], ['target' => 2.5], ['target' => 'lots'], ['target' => null]],
            'starts_on' => [
                ['starts_on' => '2037-03-16'],                          // starts after today
                ['starts_on' => '2037-02-30'],                          // no such day
                ['starts_on' => '01/03/2037'],
            ],
            'ends_on' => [
                ['ends_on' => '2037-13-01'],                            // no such month
                ['starts_on' => '2037-03-01', 'ends_on' => '2037-03-14'], // already over
                ['starts_on' => '2037-03-15', 'ends_on' => '2037-03-15'], // must end after it starts
                ['starts_on' => '2035-03-01', 'ends_on' => '2037-03-20'], // longer than two years
            ],
        ];
        foreach ($cases as $field => $variants) {
            foreach ($variants as $bad) {
                $response = $this->apiPut('/v2/admin/community-setup/goal', $this->goal($bad))->assertStatus(422);
                $this->assertSame($field, $response->json('errors.0.field'), json_encode($bad));
                $this->assertNotEmpty($response->json('errors.0.message'));
                $this->assertArrayNotHasKey('community_goal', $this->config(), json_encode($bad));
            }
        }

        // The edges are allowed: 120 characters, a target of 1 and of a million,
        // a goal that starts and ends today-ish, and one exactly two years long.
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['title' => str_repeat('a', 120), 'target' => 1]))->assertOk();
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['target' => 1000000, 'starts_on' => '2037-03-14', 'ends_on' => '2037-03-15']))->assertOk();
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['starts_on' => '2035-03-20', 'ends_on' => '2037-03-20']))->assertOk();
    }

    public function test_the_title_is_kept_as_plain_text(): void
    {
        $this->actAsAdmin();
        $title = '<script>alert(1)</script> & 500 "hours"';

        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['title' => $title]))
            ->assertOk()
            ->assertJsonPath('data.community_goal.title', $title);
        $this->assertSame($title, $this->config()['community_goal']['title']);
    }

    public function test_ending_a_goal_keeps_it_as_something_done_together(): void
    {
        $admin = $this->actAsAdmin();
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['target' => 3]))->assertOk();
        $this->handOver(2.5, '2037-03-10 10:00:00');

        $this->apiDelete('/v2/admin/community-setup/goal')->assertOk()->assertJsonPath('data.community_goal', null);

        $config = $this->config();
        $this->assertArrayNotHasKey('community_goal', $config);
        $this->assertCount(1, $config['community_goals_done']);
        $done = $config['community_goals_done'][0];
        $this->assertSame("Let's share 500 hours by spring", $done['title']);
        $this->assertEqualsWithDelta(2.5, $done['final_count'], 0.001);
        $this->assertSame('2037-03-15', $done['ended_on']);

        // Members now see it in the short "What we've done together" list.
        Sanctum::actingAs($admin);
        $data = $this->thisMonth();
        $this->assertNull($data['community_goal']);
        $this->assertSame("Let's share 500 hours by spring", $data['community_goals_done'][0]['title']);
        $this->assertFalse($data['community_goals_done'][0]['reached']);

        // Ending when there is no goal changes nothing.
        $this->apiDelete('/v2/admin/community-setup/goal')->assertOk();
        $this->assertCount(1, $this->config()['community_goals_done']);
    }

    public function test_at_most_twelve_finished_goals_are_kept_newest_first(): void
    {
        $this->actAsAdmin();
        for ($i = 1; $i <= 14; $i++) {
            $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['title' => "Goal {$i}"]))->assertOk();
            $this->apiDelete('/v2/admin/community-setup/goal')->assertOk();
        }

        $done = $this->config()['community_goals_done'];
        $this->assertCount(12, $done);
        $this->assertSame('Goal 14', $done[0]['title']);
        $this->assertSame('Goal 3', $done[11]['title']);
    }

    // ================================================================
    // What members see (GET /v2/community/this-month)
    // ================================================================

    public function test_nothing_changes_for_a_community_without_a_goal(): void
    {
        Sanctum::actingAs($this->member());
        $data = $this->thisMonth();

        $this->assertNull($data['community_goal']);
        $this->assertSame([], $data['community_goals_done']);
    }

    public function test_hours_shared_count_the_same_way_as_the_month_highlight(): void
    {
        $this->storeGoal($this->goal());
        Sanctum::actingAs($this->member());

        $this->handOver(2.5, '2037-03-02 09:00:00');
        $this->handOver(1, '2037-03-14 09:00:00', 'transfer');
        // Not counted: before the goal started, a grant, a hand-over not yet
        // completed, and another community's hours.
        $this->handOver(9, '2037-02-28 23:00:00');
        $this->handOver(9, '2037-03-05 09:00:00', 'admin_grant');
        $this->handOver(9, '2037-03-05 09:00:00', 'exchange', 'pending');
        $this->handOver(9, '2037-03-05 09:00:00', 'exchange', 'completed', $this->otherTenant());

        $goal = $this->thisMonth()['community_goal'];
        $this->assertEqualsWithDelta(3.5, (float) $goal['current'], 0.001);
        $this->assertSame(500, $goal['target']);
        $this->assertSame(77, $goal['days_left']);
        $this->assertFalse($goal['reached']);
        // Totals only: the goal carries no member.
        $this->assertSame(
            ['id', 'title', 'metric', 'target', 'current', 'starts_on', 'ends_on', 'days_left', 'reached'],
            array_keys($goal),
        );
    }

    public function test_exchanges_count_each_completed_hand_over(): void
    {
        $this->storeGoal($this->goal(['metric' => 'exchanges', 'target' => 2]));
        Sanctum::actingAs($this->member());

        $this->handOver(2.5, '2037-03-02 09:00:00');
        $this->handOver(1, '2037-03-03 09:00:00', 'transfer');
        $this->handOver(1, '2037-03-03 09:00:00', 'exchange', 'pending');

        $goal = $this->thisMonth()['community_goal'];
        $this->assertSame(2, $goal['current']);
        $this->assertTrue($goal['reached']);
    }

    public function test_offers_count_offers_and_requests_posted(): void
    {
        $this->storeGoal($this->goal(['metric' => 'offers', 'target' => 10]));
        $owner = $this->member();
        Sanctum::actingAs($owner);

        foreach (['active', 'completed', 'rejected'] as $status) {
            \App\Models\Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $owner->id, 'status' => $status, 'created_at' => '2037-03-05 10:00:00']);
        }
        \App\Models\Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $owner->id, 'status' => 'active', 'created_at' => '2037-02-20 10:00:00']);

        $this->assertSame(2, $this->thisMonth()['community_goal']['current']);
    }

    public function test_events_count_the_events_held_so_far(): void
    {
        $this->storeGoal($this->goal(['metric' => 'events', 'target' => 4]));
        Sanctum::actingAs($this->member());

        $this->event('2037-03-02 18:00:00');
        $this->event('2037-03-10 18:00:00', ['status' => 'completed']);
        // Not counted: not yet held, before the goal, cancelled, a draft,
        // a recurring template, and another community's event.
        $this->event('2037-03-20 18:00:00');
        $this->event('2037-02-20 18:00:00');
        $this->event('2037-03-05 18:00:00', ['status' => 'cancelled']);
        $this->event('2037-03-05 18:00:00', ['status' => 'draft']);
        $this->event('2037-03-05 18:00:00', ['is_recurring_template' => 1]);
        $this->event('2037-03-05 18:00:00', ['tenant_id' => $this->otherTenant()]);

        $this->assertSame(2, $this->thisMonth()['community_goal']['current']);
    }

    public function test_a_newly_set_goal_shows_at_once_even_though_the_month_is_cached(): void
    {
        Sanctum::actingAs($this->member());
        $this->assertNull($this->thisMonth()['community_goal']);

        $this->storeGoal($this->goal());

        $this->assertSame("Let's share 500 hours by spring", $this->thisMonth()['community_goal']['title']);
    }

    public function test_a_goal_whose_end_date_has_passed_is_shown_as_done(): void
    {
        $this->storeGoal($this->goal(['target' => 2, 'starts_on' => '2037-01-01', 'ends_on' => '2037-02-28']));
        $this->handOver(2, '2037-02-10 09:00:00');
        $this->handOver(5, '2037-03-02 09:00:00'); // after it ended
        Sanctum::actingAs($this->member());

        $data = $this->thisMonth();

        $this->assertNull($data['community_goal']);
        $this->assertCount(1, $data['community_goals_done']);
        $this->assertEqualsWithDelta(2.0, (float) $data['community_goals_done'][0]['final_count'], 0.001);
        $this->assertTrue($data['community_goals_done'][0]['reached']);

        // Setting the next goal files the finished one with its final count.
        $this->actAsAdmin();
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal(['title' => 'Next']))->assertOk();
        $config = $this->config();
        $this->assertSame('Next', $config['community_goal']['title']);
        $this->assertEqualsWithDelta(2.0, (float) $config['community_goals_done'][0]['final_count'], 0.001);
        $this->assertNotSame($config['community_goal']['id'], $config['community_goals_done'][0]['id']);
    }

    public function test_members_see_at_most_three_finished_goals_and_none_with_nothing_done(): void
    {
        $done = [];
        foreach ([5, 0, 4, 3, 2] as $i => $final) {
            $done[] = ['id' => "abc00000000{$i}", 'title' => "Goal {$i}", 'metric' => 'exchanges', 'target' => 4,
                'final_count' => $final, 'starts_on' => '2036-01-01', 'ends_on' => '2036-02-01', 'ended_on' => '2036-02-01'];
        }
        $this->setConfig(['community_goals_done' => $done]);
        Sanctum::actingAs($this->member());

        $shown = $this->thisMonth()['community_goals_done'];

        $this->assertSame(['Goal 0', 'Goal 2', 'Goal 3'], array_column($shown, 'title'));
        $this->assertSame([true, true, false], array_column($shown, 'reached'));
    }

    public function test_another_communitys_goal_is_never_shown(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            [
                'name' => 'Other Goal Timebank',
                'slug' => 'other-goal-timebank-test',
                'parent_id' => null,
                'path' => '/' . self::OTHER_TENANT_ID . '/',
                'depth' => 0,
                'is_active' => true,
                'configuration' => json_encode(['community_goal' => array_merge($this->goal(['title' => 'Somebody else']), ['id' => 'aaaaaaaaaaaa'])]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        Sanctum::actingAs($this->member());

        $this->assertNull($this->thisMonth()['community_goal']);
        $this->actAsAdmin();
        $this->apiGet('/v2/admin/community-setup')->assertOk()->assertJsonPath('data.community_goal', null);
        $this->apiPut('/v2/admin/community-setup/goal', $this->goal())->assertOk();
        $other = json_decode((string) DB::table('tenants')->where('id', self::OTHER_TENANT_ID)->value('configuration'), true);
        $this->assertSame('Somebody else', $other['community_goal']['title']);
    }

    // ================================================================
    // Helpers
    // ================================================================

    private function thisMonth(): array
    {
        return $this->apiGet('/v2/community/this-month')->assertOk()->json('data');
    }

    /** @return array<string, mixed> */
    private function config(): array
    {
        return json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
    }

    private function setConfig(array $values): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(array_merge($this->config(), $values)),
        ]);
    }

    private function storeGoal(array $goal): void
    {
        $this->setConfig(['community_goal' => array_merge(['id' => 'b0a1c2d3e4f5'], $goal)]);
    }

    private function actAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function otherTenant(): int
    {
        $other = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $other, 'This test needs a second community.');

        return $other;
    }

    private function handOver(float $amount, string $when, string $type = 'exchange', string $status = 'completed', ?int $tenantId = null): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'sender_id' => $this->member()->id,
            'receiver_id' => $this->member()->id,
            'amount' => $amount,
            'transaction_type' => $type,
            'status' => $status,
            'created_at' => $when,
            'updated_at' => $when,
        ]);
    }

    private function event(string $start, array $overrides = []): void
    {
        DB::table('events')->insert(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->member()->id,
            'title' => 'Repair cafe',
            'description' => 'Bring something broken',
            'start_time' => $start,
            'status' => 'active',
            'created_at' => '2037-01-01 00:00:00',
        ], $overrides));
    }
}
