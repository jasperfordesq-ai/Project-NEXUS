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
