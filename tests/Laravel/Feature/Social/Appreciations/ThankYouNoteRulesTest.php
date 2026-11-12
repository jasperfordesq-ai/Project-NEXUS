<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Core\TenantContext;
use App\Models\Listing;
use App\Models\Social\Appreciation;
use App\Models\Social\AppreciationReaction;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * SOC14 — the rules of a thank-you note (owner decisions, 12 Nov 2026).
 *
 *  - A community can switch thank-you notes off (`appreciations`, default ON).
 *  - Every new note is private. What the sender asks for is ignored.
 *  - Only the RECEIVER can show a note on their profile, hide it again or
 *    remove it. The sender can delete a note they sent. Nobody else can do
 *    anything to it, and a note of another community does not exist.
 *  - A member never sees another member's surname in any of it (E-122).
 */
class ThankYouNoteRulesTest extends TestCase
{
    use DatabaseTransactions;

    private const SENDER = ['Zqxfirstsender', 'Zqxsurnamesender'];
    private const RECEIVER = ['Zqxfirstreceiver', 'Zqxsurnamereceiver'];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->setFeature(true);
    }

    // ------------------------------------------------------------------
    // The community's switch
    // ------------------------------------------------------------------

    public function test_the_feature_is_on_unless_a_community_switches_it_off(): void
    {
        $this->assertTrue(TenantFeatureConfig::FEATURE_DEFAULTS['appreciations']);

        // A community that has never saved its features still has it.
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => null]);
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(TenantContext::hasFeature('appreciations'));
    }

    /** @return array<string, array{string, string}> */
    public static function everyRoute(): array
    {
        return [
            'send' => ['POST', '/v2/appreciations'],
            'my notes' => ['GET', '/v2/me/appreciations'],
            'a profile wall' => ['GET', '/v2/users/{receiver}/appreciations'],
            'show or hide' => ['PUT', '/v2/appreciations/{note}/visibility'],
            'delete' => ['DELETE', '/v2/appreciations/{note}'],
            'react' => ['POST', '/v2/appreciations/{note}/react'],
            'remove a reaction' => ['DELETE', '/v2/appreciations/{note}/react'],
        ];
    }

    #[DataProvider('everyRoute')]
    public function test_every_route_is_refused_when_the_community_has_switched_thank_you_notes_off(string $method, string $uri): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, true);
        $this->setFeature(false);
        $this->signInAs($receiver);

        $uri = str_replace(['{receiver}', '{note}'], [(string) $receiver->id, (string) $note->id], $uri);
        $body = ['receiver_id' => $sender->id, 'message' => 'Thanks', 'is_public' => true, 'reaction_type' => 'heart'];
        $response = match ($method) {
            'GET' => $this->apiGet($uri),
            'POST' => $this->apiPost($uri, $body),
            'PUT' => $this->apiPut($uri, $body),
            'DELETE' => $this->apiDelete($uri),
        };

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertDatabaseHas('appreciations', ['id' => $note->id, 'is_public' => 1]);
        $this->assertSame(1, DB::table('appreciations')->where('tenant_id', $this->testTenantId)
            ->whereIn('sender_id', [$sender->id, $receiver->id])->count());
    }

    // ------------------------------------------------------------------
    // Sending
    // ------------------------------------------------------------------

    public function test_a_new_note_is_private_whatever_the_sender_asks_for(): void
    {
        [$sender, $receiver] = $this->pair();
        $this->signInAs($sender);

        $response = $this->apiPost('/v2/appreciations', [
            'receiver_id' => $receiver->id,
            'message' => 'Thank you for the lift',
            'is_public' => true,
        ]);

        $response->assertStatus(201)->assertJsonPath('data.is_public', false);
        $this->assertDatabaseHas('appreciations', [
            'id' => $response->json('data.id'),
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'is_public' => 0,
        ]);
    }

    /** @return array<string, array{array<string, mixed>}> */
    public static function accountsThatAreNotActiveMembers(): array
    {
        return [
            'suspended' => [['status' => 'suspended']],
            'inactive' => [['status' => 'inactive']],
            'banned' => [['status' => 'banned']],
            'still pending' => [['status' => 'pending']],
            'not yet approved' => [['status' => 'active', 'is_approved' => false]],
        ];
    }

    /** @param array<string, mixed> $state */
    #[DataProvider('accountsThatAreNotActiveMembers')]
    public function test_a_receiver_who_is_not_an_active_member_is_refused(array $state): void
    {
        $sender = $this->person();
        $receiver = $this->person($state);
        $this->signInAs($sender);

        $this->apiPost('/v2/appreciations', ['receiver_id' => $receiver->id, 'message' => 'Thanks'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'RECEIVER_NOT_FOUND');
        $this->assertDatabaseMissing('appreciations', ['sender_id' => $sender->id]);
    }

    public function test_a_managers_delegate_account_is_never_a_receiver(): void
    {
        $sender = $this->person();
        // Inserted the way ManagerDelegate does it: database triggers refuse
        // turning an ordinary account into a delegate.
        $delegateId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'first_name' => 'Zqxfirstmanager',
            'last_name' => 'Zqxsurnamemanager',
            'name' => 'Zqxfirstmanager Zqxsurnamemanager',
            'email' => 'manager-' . bin2hex(random_bytes(4)) . '@delegate.invalid',
            'password_hash' => null,
            'role' => 'admin',
            'status' => 'delegate',
            'is_approved' => 1,
            'onboarding_completed' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->signInAs($sender);

        $this->apiPost('/v2/appreciations', ['receiver_id' => $delegateId, 'message' => 'Thanks'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'RECEIVER_NOT_FOUND');
        $this->assertDatabaseMissing('appreciations', ['receiver_id' => $delegateId]);
    }

    public function test_a_sender_who_is_not_an_active_member_is_refused(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $service = new \App\Services\Social\AppreciationService();

        foreach ([['status' => 'suspended'], ['status' => 'active', 'is_approved' => 0]] as $state) {
            DB::table('users')->where('id', $sender->id)->update($state);
            try {
                $service->send((int) $sender->id, (int) $receiver->id, 'Thanks');
                $this->fail('A sender who is not an active member was allowed to send.');
            } catch (\DomainException $e) {
                $this->assertSame('sender_not_found', $e->getMessage());
            }
        }
        $this->assertDatabaseMissing('appreciations', ['sender_id' => $sender->id]);
    }

    public function test_a_receiver_in_another_community_is_refused(): void
    {
        $sender = $this->person();
        $receiver = $this->person([], 999);
        $this->signInAs($sender);

        $this->apiPost('/v2/appreciations', ['receiver_id' => $receiver->id, 'message' => 'Thanks'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'RECEIVER_NOT_FOUND');
        $this->assertDatabaseMissing('appreciations', ['receiver_id' => $receiver->id]);
    }

    // ------------------------------------------------------------------
    // What a note is attached to
    // ------------------------------------------------------------------

    public function test_a_completed_exchange_between_the_two_people_is_kept_as_the_context(): void
    {
        [$sender, $receiver] = $this->pair();
        $exchangeId = $this->exchange($sender, $receiver, 'completed');
        $this->signInAs($sender);

        $this->apiPost('/v2/appreciations', [
            'receiver_id' => $receiver->id, 'message' => 'Thanks for the gardening',
            'context_type' => 'listing_completion', 'context_id' => $exchangeId,
        ])->assertStatus(201)
            ->assertJsonPath('data.context_type', 'listing_completion')
            ->assertJsonPath('data.context_id', $exchangeId);

        // Either party may thank the other.
        $this->signInAs($receiver);
        $this->apiPost('/v2/appreciations', [
            'receiver_id' => $sender->id, 'message' => 'And thank you',
            'context_type' => 'listing_completion', 'context_id' => $exchangeId,
        ])->assertStatus(201)->assertJsonPath('data.context_id', $exchangeId);
    }

    /** @return array<string, array{string}> */
    public static function exchangesThatAreNotTheirs(): array
    {
        return [
            'not completed yet' => ['unfinished'],
            'between two other people' => ['strangers'],
            'only one of them took part' => ['one_party'],
            'in another community' => ['other_tenant'],
            'does not exist' => ['missing'],
        ];
    }

    #[DataProvider('exchangesThatAreNotTheirs')]
    public function test_an_exchange_that_is_not_a_completed_one_between_the_two_is_refused(string $case): void
    {
        [$sender, $receiver] = $this->pair();
        $third = $this->person();
        $exchangeId = match ($case) {
            'unfinished' => $this->exchange($sender, $receiver, 'accepted'),
            'strangers' => $this->exchange($third, $this->person(), 'completed'),
            'one_party' => $this->exchange($sender, $third, 'completed'),
            'other_tenant' => $this->exchange($this->person([], 999), $this->person([], 999), 'completed', 999),
            'missing' => 2147480000,
        };
        $this->signInAs($sender);

        $this->apiPost('/v2/appreciations', [
            'receiver_id' => $receiver->id, 'message' => 'Thanks',
            'context_type' => 'listing_completion', 'context_id' => $exchangeId,
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'INVALID_CONTEXT');
        $this->assertDatabaseMissing('appreciations', ['sender_id' => $sender->id, 'receiver_id' => $receiver->id]);
    }

    public function test_any_other_context_never_keeps_an_id(): void
    {
        [$sender, $receiver] = $this->pair();
        $this->signInAs($sender);

        foreach (['general', 'event_help', 'vol_log', null] as $type) {
            $response = $this->apiPost('/v2/appreciations', array_filter([
                'receiver_id' => $receiver->id, 'message' => 'Thanks',
                'context_type' => $type, 'context_id' => 4242,
            ], static fn ($value): bool => $value !== null));

            $response->assertStatus(201)->assertJsonPath('data.context_id', null);
            $this->assertNull(DB::table('appreciations')->where('id', $response->json('data.id'))->value('context_id'));
        }
    }

    // ------------------------------------------------------------------
    // Showing, hiding
    // ------------------------------------------------------------------

    public function test_the_receiver_shows_a_note_on_their_profile_and_hides_it_again(): void
    {
        [$sender, $receiver] = $this->pair();
        $viewer = $this->person();
        $note = $this->note($sender, $receiver, false);

        $this->signInAs($viewer);
        $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk()->assertJsonCount(0, 'data');

        $this->signInAs($receiver);
        $this->apiPut("/v2/appreciations/{$note->id}/visibility", ['is_public' => true])
            ->assertOk()
            ->assertJsonPath('data.id', $note->id)
            ->assertJsonPath('data.is_public', true)
            ->assertJsonPath('data.sender.id', $sender->id)
            ->assertJsonPath('data.receiver.id', $receiver->id);

        $this->signInAs($viewer);
        $this->apiGet("/v2/users/{$receiver->id}/appreciations")
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $note->id);

        $this->signInAs($receiver);
        $this->apiPut("/v2/appreciations/{$note->id}/visibility", ['is_public' => false])
            ->assertOk()->assertJsonPath('data.is_public', false);

        $this->signInAs($viewer);
        $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_showing_a_note_needs_a_yes_or_a_no(): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, false);
        $this->signInAs($receiver);

        $this->apiPut("/v2/appreciations/{$note->id}/visibility", [])
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->apiPut("/v2/appreciations/{$note->id}/visibility", ['is_public' => 'maybe'])
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->assertDatabaseHas('appreciations', ['id' => $note->id, 'is_public' => 0]);
    }

    public function test_neither_the_sender_nor_anyone_else_can_show_or_hide_a_note(): void
    {
        [$sender, $receiver] = $this->pair();
        $third = $this->person();
        $admin = $this->person(['role' => 'admin']);
        $private = $this->note($sender, $receiver, false);
        $shown = $this->note($sender, $receiver, true);

        foreach ([$sender, $third, $admin] as $actor) {
            $this->signInAs($actor);
            $this->apiPut("/v2/appreciations/{$private->id}/visibility", ['is_public' => true])
                ->assertStatus(404)->assertJsonPath('errors.0.code', 'NOT_FOUND');
            $this->apiPut("/v2/appreciations/{$shown->id}/visibility", ['is_public' => false])
                ->assertStatus(404);
        }

        $this->assertDatabaseHas('appreciations', ['id' => $private->id, 'is_public' => 0]);
        $this->assertDatabaseHas('appreciations', ['id' => $shown->id, 'is_public' => 1]);
    }

    // ------------------------------------------------------------------
    // Removing
    // ------------------------------------------------------------------

    public function test_the_receiver_removes_a_note_and_its_reactions(): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, true);
        $this->reaction($note, $this->person());
        $this->signInAs($receiver);

        $this->apiDelete("/v2/appreciations/{$note->id}")->assertStatus(204);

        $this->assertDatabaseMissing('appreciations', ['id' => $note->id]);
        $this->assertDatabaseMissing('appreciation_reactions', ['appreciation_id' => $note->id]);
    }

    public function test_the_sender_deletes_a_note_they_sent(): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, false);
        $this->signInAs($sender);

        $this->apiDelete("/v2/appreciations/{$note->id}")->assertStatus(204);

        $this->assertDatabaseMissing('appreciations', ['id' => $note->id]);
    }

    public function test_nobody_else_can_remove_a_note(): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, true);
        $this->reaction($note, $sender);

        foreach ([$this->person(), $this->person(['role' => 'admin'])] as $actor) {
            $this->signInAs($actor);
            $this->apiDelete("/v2/appreciations/{$note->id}")
                ->assertStatus(404)->assertJsonPath('errors.0.code', 'NOT_FOUND');
        }

        $this->assertDatabaseHas('appreciations', ['id' => $note->id]);
        $this->assertDatabaseHas('appreciation_reactions', ['appreciation_id' => $note->id]);
    }

    public function test_a_note_of_another_community_does_not_exist_here(): void
    {
        $theirSender = $this->person([], 999);
        $theirReceiver = $this->person([], 999);
        $theirs = $this->note($theirSender, $theirReceiver, true, 999);
        $this->signInAs($this->person());

        $this->apiPut("/v2/appreciations/{$theirs->id}/visibility", ['is_public' => false])->assertStatus(404);
        $this->apiDelete("/v2/appreciations/{$theirs->id}")->assertStatus(404);
        $this->apiPost("/v2/appreciations/{$theirs->id}/react", ['reaction_type' => 'heart'])->assertStatus(404);

        $this->assertDatabaseHas('appreciations', ['id' => $theirs->id, 'is_public' => 1, 'reactions_count' => 0]);
        $this->assertDatabaseMissing('appreciation_reactions', ['appreciation_id' => $theirs->id]);
    }

    // ------------------------------------------------------------------
    // Reactions
    // ------------------------------------------------------------------

    public function test_a_private_note_cannot_be_reacted_to_by_anyone(): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, false);

        foreach ([$this->person(), $sender, $receiver] as $actor) {
            $this->signInAs($actor);
            $this->apiPost("/v2/appreciations/{$note->id}/react", ['reaction_type' => 'heart'])
                ->assertStatus(404)->assertJsonPath('errors.0.code', 'NOT_FOUND');
        }

        $this->assertDatabaseMissing('appreciation_reactions', ['appreciation_id' => $note->id]);
        $this->assertDatabaseHas('appreciations', ['id' => $note->id, 'reactions_count' => 0]);
    }

    public function test_a_note_shown_on_a_profile_can_be_reacted_to(): void
    {
        [$sender, $receiver] = $this->pair();
        $note = $this->note($sender, $receiver, true);
        $reactor = $this->person();
        $this->signInAs($reactor);

        $this->apiPost("/v2/appreciations/{$note->id}/react", ['reaction_type' => 'clap'])
            ->assertOk()->assertJsonPath('data.reacted', true)->assertJsonPath('data.reaction_type', 'clap');
        $this->assertDatabaseHas('appreciations', ['id' => $note->id, 'reactions_count' => 1]);

        $this->apiDelete("/v2/appreciations/{$note->id}/react")->assertStatus(204);
        $this->assertDatabaseHas('appreciations', ['id' => $note->id, 'reactions_count' => 0]);
    }

    // ------------------------------------------------------------------
    // Lists
    // ------------------------------------------------------------------

    public function test_a_profile_wall_lists_only_the_notes_the_receiver_has_shown(): void
    {
        [$sender, $receiver] = $this->pair();
        $shown = $this->note($sender, $receiver, true, null, 'Shown on the profile');
        $this->note($sender, $receiver, false, null, 'Kept private');

        foreach ([$this->person(), $sender, $this->person(['role' => 'admin'])] as $viewer) {
            $this->signInAs($viewer);
            $response = $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk();
            $response->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.id', $shown->id)
                ->assertJsonPath('data.0.sender.id', $sender->id);
            $this->assertStringNotContainsString('Kept private', (string) $response->getContent());
            $this->assertSame(['id', 'name', 'avatar_url'], array_keys($response->json('data.0.sender')));
        }
    }

    public function test_my_notes_are_listed_as_received_sent_or_both(): void
    {
        [$sender, $receiver] = $this->pair();
        $other = $this->person();
        $received = $this->note($sender, $receiver, false, null, 'To the receiver, private');
        $sent = $this->note($receiver, $other, false, null, 'From the receiver, private');
        $this->note($sender, $other, true, null, 'Nothing to do with the receiver');
        $this->signInAs($receiver);

        // Received is the default, and includes notes not yet shown.
        foreach (['/v2/me/appreciations', '/v2/me/appreciations?tab=received'] as $uri) {
            $this->apiGet($uri)->assertOk()->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.id', $received->id)
                ->assertJsonPath('data.0.is_public', false)
                ->assertJsonPath('data.0.sender.id', $sender->id)
                ->assertJsonPath('data.0.receiver.id', $receiver->id);
        }

        $response = $this->apiGet('/v2/me/appreciations?tab=sent')->assertOk();
        $response->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $sent->id)
            ->assertJsonPath('data.0.sender.id', $receiver->id)
            ->assertJsonPath('data.0.receiver.id', $other->id);
        $this->assertSame(['id', 'name', 'avatar_url'], array_keys($response->json('data.0.receiver')));

        $all = $this->apiGet('/v2/me/appreciations?tab=all')->assertOk()->assertJsonCount(2, 'data');
        $this->assertEqualsCanonicalizing([$received->id, $sent->id], array_column($all->json('data'), 'id'));
    }

    // ------------------------------------------------------------------
    // No ranking (owner, 12 Nov 2026: no "most thanked" list)
    // ------------------------------------------------------------------

    /**
     * The server used to answer GET /v2/appreciations/most-appreciated with
     * the community's members ranked by how many thank-you notes they had.
     * No client showed it, but with the switch on by default any signed-in
     * member could read it. There is no such list, for anyone.
     */
    public function test_there_is_no_most_thanked_ranking(): void
    {
        [$sender, $receiver] = $this->pair();
        $this->note($sender, $receiver, true);
        $this->note($this->person(), $receiver, true);

        foreach ([$this->person(), $this->person(['role' => 'admin'])] as $viewer) {
            $this->signInAs($viewer);
            $response = $this->apiGet('/v2/appreciations/most-appreciated?period=all_time&limit=10');

            $response->assertNotFound();
            $this->assertStringNotContainsString(self::RECEIVER[0], $this->body($response));
        }
    }

    // ------------------------------------------------------------------
    // Surnames (E-122)
    // ------------------------------------------------------------------

    public function test_a_member_never_gets_another_members_surname(): void
    {
        [$sender, $receiver] = $this->pair();
        $third = $this->person();
        $shown = $this->note($sender, $receiver, true);
        $this->note($sender, $receiver, false);

        // Someone else looking at the receiver's profile.
        $this->signInAs($third);
        $wall = $this->body($this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk());
        $this->assertStringContainsString(self::SENDER[0], $wall);
        $this->assertStringContainsString(self::RECEIVER[0], $wall);
        $this->assertStringNotContainsString(self::SENDER[1], $wall);
        $this->assertStringNotContainsString(self::RECEIVER[1], $wall);

        // The receiver: their notes, and the answer to showing one.
        $this->signInAs($receiver);
        foreach (['received', 'all'] as $tab) {
            $mine = $this->body($this->apiGet("/v2/me/appreciations?tab={$tab}")->assertOk());
            $this->assertStringContainsString(self::SENDER[0], $mine);
            $this->assertStringNotContainsString(self::SENDER[1], $mine, "tab={$tab}");
        }
        $changed = $this->body($this->apiPut("/v2/appreciations/{$shown->id}/visibility", ['is_public' => true])->assertOk());
        $this->assertStringContainsString(self::SENDER[0], $changed);
        $this->assertStringNotContainsString(self::SENDER[1], $changed);

        // The sender: what they sent, and the answer to sending one.
        $this->signInAs($sender);
        foreach (['sent', 'all'] as $tab) {
            $mine = $this->body($this->apiGet("/v2/me/appreciations?tab={$tab}")->assertOk());
            $this->assertStringContainsString(self::RECEIVER[0], $mine);
            $this->assertStringNotContainsString(self::RECEIVER[1], $mine, "tab={$tab}");
        }
        $created = $this->body($this->apiPost('/v2/appreciations', [
            'receiver_id' => $receiver->id, 'message' => 'Thanks again',
        ])->assertStatus(201));
        $this->assertStringContainsString(self::RECEIVER[0], $created);
        $this->assertStringNotContainsString(self::RECEIVER[1], $created);
    }

    /** @return array<string, array{string}> */
    public static function staffRoles(): array
    {
        return ['admin' => ['admin'], 'broker' => ['broker'], 'coordinator' => ['coordinator']];
    }

    #[DataProvider('staffRoles')]
    public function test_staff_of_the_community_still_get_surnames(string $role): void
    {
        [$sender, $receiver] = $this->pair();
        $this->note($sender, $receiver, true);
        $this->signInAs($this->person(['role' => $role]));

        $wall = $this->body($this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk());

        $this->assertStringContainsString(self::SENDER[0] . ' ' . self::SENDER[1], $wall);
        $this->assertStringContainsString(self::RECEIVER[0] . ' ' . self::RECEIVER[1], $wall);
    }

    public function test_an_organisation_is_named_by_its_trading_name_never_its_contact_person(): void
    {
        $organisation = $this->person([
            'first_name' => 'Zqxfirstcontact', 'last_name' => 'Zqxsurnamecontact',
            'name' => 'Zqx Helping Hands',
            'profile_type' => 'organisation', 'organization_name' => 'Zqx Helping Hands',
        ]);
        $receiver = $this->person();
        $this->note($organisation, $receiver, true);
        $this->signInAs($this->person());

        $response = $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk();

        $response->assertJsonPath('data.0.sender.name', 'Zqx Helping Hands');
        $this->assertStringNotContainsString('Zqxsurnamecontact', $this->body($response));
        $this->assertStringNotContainsString('Zqxfirstcontact', $this->body($response));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private function body(\Illuminate\Testing\TestResponse $response): string
    {
        return (string) $response->getContent();
    }

    private function setFeature(bool $on): void
    {
        $features = array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['appreciations' => $on]);
        DB::table('tenants')->whereIn('id', [$this->testTenantId, 999])->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @return array{User, User} the sender and the receiver, each with an invented surname */
    private function pair(): array
    {
        return [
            $this->person(['first_name' => self::SENDER[0], 'last_name' => self::SENDER[1], 'name' => implode(' ', self::SENDER)]),
            $this->person(['first_name' => self::RECEIVER[0], 'last_name' => self::RECEIVER[1], 'name' => implode(' ', self::RECEIVER)]),
        ];
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'onboarding_completed' => true,
            'privacy_profile' => 'public',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function note(User $sender, User $receiver, bool $shown, ?int $tenantId = null, string $message = 'Thank you'): Appreciation
    {
        return Appreciation::create([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'message' => $message,
            'is_public' => $shown,
            'reactions_count' => 0,
        ]);
    }

    private function reaction(Appreciation $note, User $by): void
    {
        AppreciationReaction::create([
            'appreciation_id' => $note->id,
            'user_id' => $by->id,
            'tenant_id' => $note->tenant_id,
            'reaction_type' => 'heart',
            'created_at' => now(),
        ]);
    }

    private function exchange(User $requester, User $provider, string $status, ?int $tenantId = null): int
    {
        $tenantId ??= $this->testTenantId;
        $listing = Listing::factory()->forTenant($tenantId)->create(['user_id' => $provider->id, 'status' => 'active']);
        TenantContext::setById($this->testTenantId);

        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $tenantId,
            'listing_id' => $listing->id,
            'requester_id' => $requester->id,
            'provider_id' => $provider->id,
            'proposed_hours' => 1,
            'status' => $status,
            'completed_at' => $status === 'completed' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
