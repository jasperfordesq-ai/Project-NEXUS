<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Feature tests for PollsController — polls CRUD, voting, ranked choice.
 */
class PollsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v2/polls
    // ------------------------------------------------------------------

    public function test_index_requires_auth(): void
    {
        $response = $this->apiGet('/v2/polls');

        $response->assertStatus(401);
    }

    public function test_index_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/polls');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/polls
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/polls', [
            'question' => 'What should our next event be?',
            'options' => ['Workshop', 'Social', 'Cleanup'],
        ]);

        $response->assertStatus(401);
    }

    public function test_poll_creation_replay_returns_one_ranked_anonymous_poll(): void
    {
        $user = $this->authenticatedUser();
        $payload = [
            'question' => 'Rank the workshop topics',
            'options' => ['Repairs', 'Gardening', 'Cooking'],
            'poll_type' => 'ranked',
            'is_anonymous' => true,
        ];
        $headers = ['Idempotency-Key' => 'poll-create-operation-123'];

        $first = $this->apiPost('/v2/polls', $payload, $headers);
        $replay = $this->apiPost('/v2/polls', $payload, $headers);

        $first->assertCreated()->assertJsonPath('data.poll_type', 'ranked')->assertJsonPath('data.is_anonymous', true);
        $replay->assertOk();
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('polls')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)->where('question', 'Rank the workshop topics')->count());
        $this->assertSame(1, DB::table('poll_creation_receipts')->where('tenant_id', $this->testTenantId)
            ->where('actor_user_id', $user->id)->count());
        $this->assertSame(3, DB::table('poll_options')->where('poll_id', $first->json('data.id'))->count());

        $this->apiPost('/v2/polls', $payload + ['description' => 'Changed'], $headers)->assertStatus(409);
    }

    public function test_store_rejects_unknown_poll_type_and_blank_options(): void
    {
        $this->authenticatedUser();
        $this->apiPost('/v2/polls', [
            'question' => 'Invalid type', 'options' => ['One', 'Two'], 'poll_type' => 'mystery',
        ])->assertStatus(422);
        $this->apiPost('/v2/polls', [
            'question' => 'Blank choice', 'options' => ['One', '   '],
        ])->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  GET /v2/polls/categories
    // ------------------------------------------------------------------

    public function test_categories_requires_auth(): void
    {
        $response = $this->apiGet('/v2/polls/categories');

        $response->assertStatus(401);
    }

    public function test_categories_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/polls/categories');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/polls/{id}
    // ------------------------------------------------------------------

    public function test_show_requires_auth(): void
    {
        $response = $this->apiGet('/v2/polls/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/polls/{id}/vote
    // ------------------------------------------------------------------

    public function test_vote_requires_auth(): void
    {
        $response = $this->apiPost('/v2/polls/1/vote', ['option_id' => 1]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DELETE /v2/polls/{id}
    // ------------------------------------------------------------------

    public function test_destroy_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/polls/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  Voting error paths — must be proper statuses, never a 500.
    //
    //  PollService::vote() throws for an option that does not belong to the
    //  poll and for a poll whose end date has passed. Neither was caught by
    //  the two vote controllers, so both cases answered 500 (with the exception
    //  class and file path in the body under debug). Found by the
    //  same-community access sweep, 2026-09-11.
    // ------------------------------------------------------------------

    public function test_vote_with_an_option_from_another_poll_is_rejected_not_a_server_error(): void
    {
        $this->authenticatedUser();
        [$pollId] = $this->createPollWithOptions();
        [, $foreignOptionId] = $this->createPollWithOptions();

        $response = $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $foreignOptionId]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_INVALID_VALUE');
        $this->assertSame(0, DB::table('poll_votes')->where('poll_id', $pollId)->count(), 'No vote may be recorded for a foreign option.');
    }

    public function test_vote_on_a_closed_poll_is_a_conflict_not_a_server_error(): void
    {
        $this->authenticatedUser();
        [$pollId, $optionId] = $this->createPollWithOptions();
        DB::table('polls')->where('id', $pollId)->update(['end_date' => now()->subDay()->toDateTimeString()]);

        $response = $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionId]);

        $response->assertStatus(409);
        $response->assertJsonPath('errors.0.code', 'RESOURCE_CONFLICT');
        $this->assertSame(0, DB::table('poll_votes')->where('poll_id', $pollId)->count(), 'No vote may be recorded on a closed poll.');
    }

    public function test_vote_replay_returns_committed_choice_without_repeating_xp(): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update(['xp' => 0]);
        [$pollId, $optionId] = $this->createPollWithOptions();

        $first = $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionId]);
        $replay = $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionId]);

        $first->assertOk();
        $replay->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->assertSame($optionId, (int) $replay->json('data.user_vote_option_id'));
        $this->assertSame(1, DB::table('poll_votes')
            ->where('tenant_id', $this->testTenantId)
            ->where('poll_id', $pollId)
            ->where('user_id', $user->id)
            ->count());
        $this->assertSame(1, DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('action', 'vote_poll')
            ->where('source_reference', 'poll:' . $pollId)
            ->count());
    }

    public function test_vote_cannot_replay_as_a_different_choice(): void
    {
        $this->authenticatedUser();
        [$pollId, $optionId] = $this->createPollWithOptions();
        $otherOptionId = (int) DB::table('poll_options')
            ->where('poll_id', $pollId)
            ->where('id', '!=', $optionId)
            ->value('id');

        $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionId])->assertOk();
        $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $otherOptionId])->assertStatus(409);
    }

    public function test_ranked_ballot_replay_is_success_but_a_changed_order_conflicts(): void
    {
        $user = $this->authenticatedUser();
        [$pollId] = $this->createPollWithOptions();
        DB::table('polls')->where('id', $pollId)->update(['poll_type' => 'ranked']);
        $options = DB::table('poll_options')->where('poll_id', $pollId)->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
        $rankings = [
            ['option_id' => $options[1], 'rank' => 1],
            ['option_id' => $options[0], 'rank' => 2],
        ];

        $first = $this->apiPost("/v2/polls/{$pollId}/rank", ['rankings' => $rankings]);
        $replay = $this->apiPost("/v2/polls/{$pollId}/rank", ['rankings' => $rankings]);

        $first->assertOk()->assertJsonPath('data.idempotent_replay', false);
        $replay->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->assertSame(2, DB::table('poll_rankings')->where('tenant_id', $this->testTenantId)
            ->where('poll_id', $pollId)->where('user_id', $user->id)->count());
        $this->assertSame(1, DB::table('user_xp_log')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)->where('action', 'vote_poll')
            ->where('source_reference', 'poll:' . $pollId)->count());
        $this->apiPost("/v2/polls/{$pollId}/rank", ['rankings' => [
            ['option_id' => $options[0], 'rank' => 1],
            ['option_id' => $options[1], 'rank' => 2],
        ]])->assertStatus(409);
    }

    public function test_ranked_results_stay_hidden_from_non_creators_until_close(): void
    {
        $owner = $this->authenticatedUser();
        $created = $this->apiPost('/v2/polls', [
            'question' => 'Rank the community projects',
            'options' => ['Repair cafe', 'Garden'],
            'poll_type' => 'ranked',
            'expires_at' => now()->addDay()->toIso8601String(),
        ])->assertCreated();
        $pollId = (int) $created->json('data.id');
        $optionIds = DB::table('poll_options')->where('poll_id', $pollId)
            ->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();

        $voter = $this->authenticatedUser();
        $submission = $this->apiPost("/v2/polls/{$pollId}/rank", ['rankings' => [
            ['option_id' => $optionIds[1], 'rank' => 1],
            ['option_id' => $optionIds[0], 'rank' => 2],
        ]]);
        $submission->assertOk()
            ->assertJsonPath('data.results_visible', false)
            ->assertJsonPath('data.ranked_results', null);

        $hidden = $this->apiGet("/v2/polls/{$pollId}/ranked-results");
        $hidden->assertOk()
            ->assertJsonPath('data.results_visible', false)
            ->assertJsonPath('data.ranked_results', null);

        Sanctum::actingAs($owner, ['*']);
        $ownerView = $this->apiGet("/v2/polls/{$pollId}/ranked-results");
        $ownerView->assertOk()
            ->assertJsonPath('data.results_visible', true)
            ->assertJsonPath('data.ranked_results.total_voters', 1);

        DB::table('polls')->where('id', $pollId)->update(['is_active' => false]);
        Sanctum::actingAs($voter, ['*']);
        $closed = $this->apiGet("/v2/polls/{$pollId}/ranked-results");
        $closed->assertOk()
            ->assertJsonPath('data.results_visible', true)
            ->assertJsonPath('data.ranked_results.total_voters', 1)
            ->assertJsonPath('data.ranked_results.results.0.votes', 1);
    }

    public function test_ranked_poll_rejects_the_single_choice_vote_endpoint(): void
    {
        $this->authenticatedUser();
        [$pollId, $optionId] = $this->createPollWithOptions();
        DB::table('polls')->where('id', $pollId)->update(['poll_type' => 'ranked']);

        $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionId])->assertStatus(422);
        $this->assertSame(0, DB::table('poll_votes')->where('poll_id', $pollId)->count());
    }

    public function test_anonymous_vote_does_not_disclose_the_voter_in_a_creator_notification(): void
    {
        $owner = $this->authenticatedUser();
        $created = $this->apiPost('/v2/polls', [
            'question' => 'Anonymous choice', 'options' => ['One', 'Two'], 'is_anonymous' => true,
        ])->assertCreated();
        $pollId = (int) $created->json('data.id');
        $optionId = (int) DB::table('poll_options')->where('poll_id', $pollId)->value('id');
        $voter = $this->authenticatedUser();

        $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionId])->assertOk();

        $this->assertSame(0, DB::table('notifications')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $owner->id)->where('type', 'poll_vote')->count());
        $this->assertSame(1, DB::table('poll_votes')->where('poll_id', $pollId)->where('user_id', $voter->id)->count());
    }

    public function test_feed_exposes_ranked_anonymous_mode_and_the_viewers_saved_order(): void
    {
        $this->enablePollsFeature();
        $this->authenticatedUser();
        $created = $this->apiPost('/v2/polls', [
            'question' => 'Rank these community priorities',
            'options' => ['Repair cafe', 'Garden', 'Shared meals'],
            'poll_type' => 'ranked',
            'is_anonymous' => true,
        ])->assertCreated();
        $pollId = (int) $created->json('data.id');
        $optionIds = DB::table('poll_options')->where('poll_id', $pollId)
            ->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
        $rankings = [
            ['option_id' => $optionIds[2], 'rank' => 1],
            ['option_id' => $optionIds[0], 'rank' => 2],
            ['option_id' => $optionIds[1], 'rank' => 3],
        ];
        $this->apiPost("/v2/polls/{$pollId}/rank", ['rankings' => $rankings])->assertOk();

        $feed = $this->apiGet('/v2/feed?type=polls&mode=chronological');

        $feed->assertOk();
        $item = collect($feed->json('data'))->firstWhere('id', $pollId);
        $this->assertNotNull($item, 'The newly created poll must be present in the polls feed.');
        $this->assertSame('ranked', $item['poll_data']['poll_type']);
        $this->assertTrue($item['poll_data']['is_anonymous']);
        $this->assertSame($rankings, $item['poll_data']['user_rankings']);
        $this->assertTrue($item['poll_data']['is_active']);
    }

    public function test_feed_vote_with_an_option_from_another_poll_is_rejected_not_a_server_error(): void
    {
        $this->enablePollsFeature();
        $this->authenticatedUser();
        [$pollId] = $this->createPollWithOptions();
        [, $foreignOptionId] = $this->createPollWithOptions();

        $response = $this->apiPost("/v2/feed/polls/{$pollId}/vote", ['option_id' => $foreignOptionId]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_INVALID_VALUE');
    }

    public function test_feed_vote_on_a_closed_poll_is_a_conflict_not_a_server_error(): void
    {
        $this->enablePollsFeature();
        $this->authenticatedUser();
        [$pollId, $optionId] = $this->createPollWithOptions();
        DB::table('polls')->where('id', $pollId)->update(['end_date' => now()->subDay()->toDateTimeString()]);

        $response = $this->apiPost("/v2/feed/polls/{$pollId}/vote", ['option_id' => $optionId]);

        $response->assertStatus(409);
        $response->assertJsonPath('errors.0.code', 'RESOURCE_CONFLICT');
    }

    public function test_feed_vote_replay_returns_the_committed_choice(): void
    {
        $this->enablePollsFeature();
        $user = $this->authenticatedUser();
        [$pollId, $optionId] = $this->createPollWithOptions();

        $this->apiPost("/v2/feed/polls/{$pollId}/vote", ['option_id' => $optionId])->assertOk();
        $replay = $this->apiPost("/v2/feed/polls/{$pollId}/vote", ['option_id' => $optionId]);

        $replay->assertOk()
            ->assertJsonPath('data.idempotent_replay', true)
            ->assertJsonPath('data.user_vote_option_id', $optionId);
        $this->assertSame(1, DB::table('poll_votes')
            ->where('tenant_id', $this->testTenantId)
            ->where('poll_id', $pollId)
            ->where('user_id', $user->id)
            ->count());
    }

    /**
     * Create a poll through the API and return [poll id, id of its first option].
     *
     * @return array{0:int,1:int}
     */
    private function createPollWithOptions(): array
    {
        $response = $this->apiPost('/v2/polls', [
            'question' => 'Which option? ' . uniqid(),
            'options' => ['Alpha', 'Beta'],
        ]);
        $response->assertStatus(201);
        $pollId = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $pollId, 'Poll creation must return the new id.');

        $optionId = (int) DB::table('poll_options')->where('poll_id', $pollId)->orderBy('id')->value('id');
        $this->assertGreaterThan(0, $optionId, 'The new poll must have options.');

        return [$pollId, $optionId];
    }

    /** The feed poll routes sit behind the `polls` module gate; switch it on for the test tenant. */
    private function enablePollsFeature(): void
    {
        $current = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $decoded = is_string($current) ? json_decode($current, true) : $current;
        $decoded = is_array($decoded) ? $decoded : [];
        $decoded['polls'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($decoded)]);
    }
}
