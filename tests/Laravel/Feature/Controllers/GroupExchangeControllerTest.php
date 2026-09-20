<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for GroupExchangeController — group time exchanges.
 *
 * Covers the full end-to-end lifecycle over HTTP (create → list → show → start →
 * confirm → complete → wallet), plus the response-contract regressions that made
 * the whole module non-functional in production even though the old unit tests
 * (which mocked an imagined contract) stayed green:
 *   - index() double-nested the envelope, so the React list was ALWAYS empty.
 *   - "Start" went through PUT {status}, which the update allow-list drops, so the
 *     exchange was stuck in draft forever and could never be confirmed/completed.
 *   - show()/list() omitted organizer_name + participant user_name, so names and
 *     avatars rendered blank.
 */
class GroupExchangeControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // Keep the real API/ledger journey, but isolate external notification delivery.
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        $this->mock(\App\Services\WebPushService::class, fn ($mock) => $mock->shouldReceive('sendToUser')->andReturn(true));
        \Illuminate\Support\Facades\Http::fake();
    }

    private function makeUser(float $balance = 0.0): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
            'balance'     => $balance,
        ]);
    }

    private function authenticatedUser(): User
    {
        $user = $this->makeUser();
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  Auth guards
    // ------------------------------------------------------------------

    public function test_index_requires_auth(): void
    {
        $this->apiGet('/v2/group-exchanges')->assertStatus(401);
    }

    public function test_store_requires_auth(): void
    {
        $this->apiPost('/v2/group-exchanges', ['title' => 'Group session'])->assertStatus(401);
    }

    public function test_show_requires_auth(): void
    {
        $this->apiGet('/v2/group-exchanges/1')->assertStatus(401);
    }

    public function test_update_requires_auth(): void
    {
        $this->apiPut('/v2/group-exchanges/1', ['title' => 'Updated'])->assertStatus(401);
    }

    public function test_destroy_requires_auth(): void
    {
        $this->apiDelete('/v2/group-exchanges/1')->assertStatus(401);
    }

    public function test_start_requires_auth(): void
    {
        $this->apiPost('/v2/group-exchanges/1/start')->assertStatus(401);
    }

    public function test_confirm_requires_auth(): void
    {
        $this->apiPost('/v2/group-exchanges/1/confirm')->assertStatus(401);
    }

    public function test_complete_requires_auth(): void
    {
        $this->apiPost('/v2/group-exchanges/1/complete')->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  Store validation
    // ------------------------------------------------------------------

    public function test_store_requires_title_and_positive_hours(): void
    {
        $this->authenticatedUser();

        $this->apiPost('/v2/group-exchanges', ['total_hours' => 5])->assertStatus(400);
        $this->apiPost('/v2/group-exchanges', ['title' => 'No hours', 'total_hours' => 0])->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  Response contract
    // ------------------------------------------------------------------

    public function test_index_returns_a_top_level_array_with_organizer_and_count(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser();
        $receiver  = $this->makeUser();

        $id = $this->createExchange($organizer, $provider, $receiver);

        $index = $this->apiGet('/v2/group-exchanges');
        $index->assertStatus(200);

        // Regression: data MUST be a flat array (was nested under data.data → the
        // client unwrapped once and Array.isArray failed → list always empty).
        $data = $index->json('data');
        $this->assertIsArray($data);
        $this->assertArrayNotHasKey('data', $data, 'list payload must not be double-nested');

        $item = collect($data)->firstWhere('id', $id);
        $this->assertNotNull($item, 'created exchange must appear in the list');
        $this->assertArrayHasKey('organizer_name', $item);
        $this->assertSame(2, $item['participant_count']);
        $this->assertTrue($index->json('meta.has_more') === false || $index->json('meta.has_more') === null);
    }

    public function test_show_returns_frontend_field_names_and_flat_split(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser();
        $receiver  = $this->makeUser();

        $id = $this->createExchange($organizer, $provider, $receiver);

        $show = $this->apiGet("/v2/group-exchanges/{$id}");
        $show->assertStatus(200);

        $show->assertJsonPath('data.organizer_id', $organizer->id);
        $this->assertNotEmpty($show->json('data.organizer_name'));

        // Participants must expose user_name (the React detail page reads user_name,
        // not name) and the split must be a flat per-participant list.
        $this->assertArrayHasKey('user_name', $show->json('data.participants.0'));
        $this->assertIsArray($show->json('data.calculated_split'));
        $this->assertArrayHasKey('role', $show->json('data.calculated_split.0'));
    }

    // ------------------------------------------------------------------
    //  Start transition (regression F2)
    // ------------------------------------------------------------------

    public function test_start_moves_draft_to_pending_confirmation(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser();
        $receiver  = $this->makeUser();

        $id = $this->createExchange($organizer, $provider, $receiver);
        $this->assertSame('draft', (string) DB::table('group_exchanges')->where('id', $id)->value('status'));

        $start = $this->apiPost("/v2/group-exchanges/{$id}/start");
        $start->assertStatus(200);
        $start->assertJsonPath('data.status', 'pending_confirmation');

        // Starting must notify each participant that they need to confirm.
        foreach ([$provider->id, $receiver->id] as $participantId) {
            $this->assertSame(
                1,
                (int) DB::table('notifications')
                    ->where('user_id', $participantId)
                    ->where('link', "/group-exchanges/{$id}")
                    ->where('type', 'group_exchange')
                    ->count(),
                "participant {$participantId} should get a start/confirm notification"
            );
        }
        // The organizer (not a participant) is not spammed.
        $this->assertSame(0, (int) DB::table('notifications')
            ->where('user_id', $organizer->id)
            ->where('link', "/group-exchanges/{$id}")
            ->count());
    }

    public function test_start_rejects_non_organizer(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser();
        $receiver  = $this->makeUser();
        $id = $this->createExchange($organizer, $provider, $receiver);

        Sanctum::actingAs($provider, ['*']);
        $this->apiPost("/v2/group-exchanges/{$id}/start")->assertStatus(403);
    }

    public function test_start_requires_a_provider_and_a_receiver(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser();

        // Provider only — no receiver.
        $create = $this->apiPost('/v2/group-exchanges', [
            'title'        => 'Lopsided',
            'total_hours'  => 4,
            'split_type'   => 'equal',
            'participants' => [
                ['user_id' => $provider->id, 'role' => 'provider'],
            ],
        ]);
        $create->assertStatus(201);
        $id = $create->json('data.id');

        $this->apiPost("/v2/group-exchanges/{$id}/start")->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  Full lifecycle → wallet settlement
    // ------------------------------------------------------------------

    public function test_full_lifecycle_settles_wallets(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser(0);
        $receiver  = $this->makeUser(10);

        $id = $this->createExchange($organizer, $provider, $receiver, totalHours: 6);

        $this->apiPost("/v2/group-exchanges/{$id}/start")->assertStatus(200);

        // Each participant confirms.
        Sanctum::actingAs($provider, ['*']);
        $this->apiPost("/v2/group-exchanges/{$id}/confirm")->assertStatus(200);
        Sanctum::actingAs($receiver, ['*']);
        $this->apiPost("/v2/group-exchanges/{$id}/confirm")->assertStatus(200);

        // Organizer completes.
        Sanctum::actingAs($organizer, ['*']);
        $this->apiPost("/v2/group-exchanges/{$id}/complete")->assertStatus(200);

        // Provider +6, receiver −6 (10 → 4); conserved.
        $this->assertEqualsWithDelta(6, (float) DB::table('users')->where('id', $provider->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(4, (float) DB::table('users')->where('id', $receiver->id)->value('balance'), 0.001);
        $this->assertSame('completed', (string) DB::table('group_exchanges')->where('id', $id)->value('status'));

        // A stale organiser cancellation must not relabel an already settled ledger.
        $this->apiDelete("/v2/group-exchanges/{$id}")->assertStatus(400);
        $this->assertSame('completed', (string) DB::table('group_exchanges')->where('id', $id)->value('status'));
        $this->assertEqualsWithDelta(6, (float) DB::table('users')->where('id', $provider->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(4, (float) DB::table('users')->where('id', $receiver->id)->value('balance'), 0.001);
    }

    public function test_cancellation_is_repeatable_and_prevents_completion(): void
    {
        $organizer = $this->authenticatedUser();
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(10);
        $id = $this->createExchange($organizer, $provider, $receiver, totalHours: 6);

        $this->apiDelete("/v2/group-exchanges/{$id}")->assertStatus(200);
        $this->apiDelete("/v2/group-exchanges/{$id}")->assertStatus(200);
        $this->apiPost("/v2/group-exchanges/{$id}/complete")->assertStatus(400);
        $this->assertSame('cancelled', (string) DB::table('group_exchanges')->where('id', $id)->value('status'));
        $this->assertEqualsWithDelta(0, (float) DB::table('users')->where('id', $provider->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(10, (float) DB::table('users')->where('id', $receiver->id)->value('balance'), 0.001);
    }

    public function test_changed_hours_or_split_require_fresh_confirmation_before_settlement(): void
    {
        foreach ([['total_hours' => 8], ['split_type' => 'weighted']] as $change) {
            $organizer = $this->authenticatedUser();
            $provider = $this->makeUser(0);
            $receiver = $this->makeUser(10);
            $id = $this->createExchange($organizer, $provider, $receiver, totalHours: 6);
            $this->apiPost("/v2/group-exchanges/{$id}/start")->assertStatus(200);
            foreach ([$provider, $receiver] as $member) {
                Sanctum::actingAs($member, ['*']);
                $this->apiPost("/v2/group-exchanges/{$id}/confirm")->assertStatus(200);
            }
            Sanctum::actingAs($organizer, ['*']);
            $this->apiPut("/v2/group-exchanges/{$id}", ['title' => 'Updated title', 'total_hours' => '6.00', 'split_type' => 'equal'])->assertStatus(200);
            $participants = DB::table('group_exchange_participants')->where('group_exchange_id', $id);
            $this->assertSame(2, (clone $participants)->where('confirmed', 1)->count(), 'unchanged terms preserve confirmation');

            $this->apiPut("/v2/group-exchanges/{$id}", $change)->assertStatus(200);
            $this->assertSame(2, (clone $participants)->where('confirmed', 0)->whereNull('confirmed_at')->count());
            $this->apiPost("/v2/group-exchanges/{$id}/complete")->assertStatus(400);
            $this->assertSame(0.0, (float) DB::table('users')->where('id', $provider->id)->value('balance'));
            $this->assertSame(10.0, (float) DB::table('users')->where('id', $receiver->id)->value('balance'));

            foreach ([$provider, $receiver] as $member) {
                Sanctum::actingAs($member, ['*']);
                $this->apiPost("/v2/group-exchanges/{$id}/confirm")->assertStatus(200);
            }
            Sanctum::actingAs($organizer, ['*']);
            $this->apiPost("/v2/group-exchanges/{$id}/complete")->assertStatus(200);
            $hours = (float) ($change['total_hours'] ?? 6);
            $this->assertSame($hours, (float) DB::table('users')->where('id', $provider->id)->value('balance'));
            $this->assertSame(10 - $hours, (float) DB::table('users')->where('id', $receiver->id)->value('balance'));
        }
    }

    public function test_complete_blocked_until_all_confirmed(): void
    {
        $organizer = $this->authenticatedUser();
        $provider  = $this->makeUser(0);
        $receiver  = $this->makeUser(10);

        $id = $this->createExchange($organizer, $provider, $receiver, totalHours: 6);
        $this->apiPost("/v2/group-exchanges/{$id}/start")->assertStatus(200);

        // Only the provider confirms.
        Sanctum::actingAs($provider, ['*']);
        $this->apiPost("/v2/group-exchanges/{$id}/confirm")->assertStatus(200);

        Sanctum::actingAs($organizer, ['*']);
        $this->apiPost("/v2/group-exchanges/{$id}/complete")->assertStatus(400);

        // No money moved.
        $this->assertEqualsWithDelta(0, (float) DB::table('users')->where('id', $provider->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(10, (float) DB::table('users')->where('id', $receiver->id)->value('balance'), 0.001);
    }

    public function test_terminal_exchange_keeps_participants_when_removal_is_requested(): void
    {
        foreach (['completed', 'cancelled'] as $status) {
            $organizer = $this->authenticatedUser();
            $provider = $this->makeUser();
            $receiver = $this->makeUser(10);
            $id = $this->createExchange($organizer, $provider, $receiver);
            DB::table('group_exchanges')->where('id', $id)->update(['status' => $status]);
            $before = DB::table('group_exchange_participants')->where('group_exchange_id', $id)->orderBy('id')->get()->toArray();

            $this->apiDelete("/v2/group-exchanges/{$id}/participants/{$provider->id}")->assertStatus(400);

            $this->assertEquals($before, DB::table('group_exchange_participants')->where('group_exchange_id', $id)->orderBy('id')->get()->toArray());
        }
    }

    public function test_confirmation_requires_an_exchange_awaiting_confirmation(): void
    {
        foreach (['draft', 'pending_participants', 'pending_broker', 'active', 'completed', 'cancelled', 'disputed'] as $status) {
            $organizer = $this->authenticatedUser();
            $provider = $this->makeUser();
            $receiver = $this->makeUser(10);
            $id = $this->createExchange($organizer, $provider, $receiver);
            DB::table('group_exchanges')->where('id', $id)->update(['status' => $status]);
            Sanctum::actingAs($provider, ['*']);
            $this->apiPost("/v2/group-exchanges/{$id}/confirm")->assertStatus(400);
            $participant = DB::table('group_exchange_participants')->where('group_exchange_id', $id)->where('user_id', $provider->id)->first();
            $this->assertSame(0, (int) $participant->confirmed, $status);
            $this->assertNull($participant->confirmed_at, $status);
        }
    }

    public function test_terminal_exchange_cannot_add_participants(): void
    {
        foreach (['completed', 'cancelled'] as $status) {
            $organizer = $this->authenticatedUser();
            $provider = $this->makeUser();
            $receiver = $this->makeUser(10);
            $extra = $this->makeUser();
            $id = $this->createExchange($organizer, $provider, $receiver);
            DB::table('group_exchanges')->where('id', $id)->update(['status' => $status]);

            $this->apiPost("/v2/group-exchanges/{$id}/participants", ['user_id' => $extra->id, 'role' => 'provider'])->assertStatus(400);

            $this->assertSame(2, DB::table('group_exchange_participants')->where('group_exchange_id', $id)->count());
        }
    }

    public function test_open_exchange_can_add_and_remove_participants_and_repeat_removal(): void
    {
        $organizer = $this->authenticatedUser();
        $provider = $this->makeUser();
        $receiver = $this->makeUser(10);
        $extra = $this->makeUser();
        $id = $this->createExchange($organizer, $provider, $receiver);
        $this->apiPost("/v2/group-exchanges/{$id}/participants", ['user_id' => $extra->id, 'role' => 'provider'])->assertStatus(200);
        $this->assertSame(3, DB::table('group_exchange_participants')->where('group_exchange_id', $id)->count());
        $this->apiDelete("/v2/group-exchanges/{$id}/participants/{$extra->id}")->assertStatus(200);
        $this->apiDelete("/v2/group-exchanges/{$id}/participants/{$extra->id}")->assertStatus(200);
        $this->assertSame(2, DB::table('group_exchange_participants')->where('group_exchange_id', $id)->count());
    }

    /**
     * Create an equal-split exchange as the organizer with one provider + one
     * receiver, returning its id.
     */
    private function createExchange(User $organizer, User $provider, User $receiver, float $totalHours = 5.0): int
    {
        Sanctum::actingAs($organizer, ['*']);

        $create = $this->apiPost('/v2/group-exchanges', [
            'title'        => 'Barn raising',
            'total_hours'  => $totalHours,
            'split_type'   => 'equal',
            'participants' => [
                ['user_id' => $provider->id, 'role' => 'provider'],
                ['user_id' => $receiver->id, 'role' => 'receiver'],
            ],
        ]);

        $create->assertStatus(201);

        return (int) $create->json('data.id');
    }
}
