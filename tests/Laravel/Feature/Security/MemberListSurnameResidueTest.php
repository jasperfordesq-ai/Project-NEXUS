<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-084 (E-027) residue — surnames are private to administrators on the
 * profile, member search and directory. Commit 6201b0559 applied that to the
 * connections list, group member lists and the leaderboard. This pins the
 * rest of the member lists an ordinary member sees: event rosters (an
 * organiser is an ordinary member), direct-message and group-conversation
 * lists, and the reviews lists. The viewer's own row keeps their full name,
 * administrators still see surnames, and an organisation keeps its trading
 * name.
 */
class MemberListSurnameResidueTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------------------------
    //  Events
    // ------------------------------------------------------------------

    public function test_event_roster_shows_first_names_to_a_member_organiser(): void
    {
        $organiser = $this->member();
        $attendee = $this->member(['first_name' => 'Ada', 'last_name' => 'Rostersurname', 'name' => 'Ada Rostersurname']);
        $org = $this->member([
            'first_name' => 'Contact',
            'last_name' => 'Orgcontactsurname',
            'name' => 'Contact Orgcontactsurname',
            'profile_type' => 'organisation',
            'organization_name' => 'Helping Hands Ltd',
        ]);
        $eventId = $this->event($organiser);
        $this->rsvp($eventId, $attendee);
        $this->rsvp($eventId, $org);

        Sanctum::actingAs($organiser, ['*']);
        $response = $this->apiGet("/v2/events/{$eventId}/attendees?status=all&per_page=100")->assertStatus(200);

        $byId = $this->indexById($response->json('data') ?? []);
        $this->assertSame('Ada', $byId[$attendee->id]['name']);
        $this->assertSame('Helping Hands Ltd', $byId[$org->id]['name'], 'An organisation keeps its trading name.');
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Rostersurname', $body);
        $this->assertStringNotContainsString('Orgcontactsurname', $body);
    }

    public function test_event_roster_shows_full_names_to_an_admin(): void
    {
        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $attendee = $this->member(['first_name' => 'Abe', 'last_name' => 'Adminrostersee', 'name' => 'Abe Adminrostersee']);
        $eventId = $this->event($organiser);
        $this->rsvp($eventId, $attendee);

        Sanctum::actingAs($admin, ['*']);
        $byId = $this->indexById($this->apiGet("/v2/events/{$eventId}/attendees?status=all&per_page=100")
            ->assertStatus(200)->json('data') ?? []);

        $this->assertSame('Abe Adminrostersee', $byId[$attendee->id]['name']);
    }

    public function test_event_waitlist_shows_first_names_to_a_member_organiser(): void
    {
        $organiser = $this->member();
        $waiting = $this->member(['first_name' => 'Wendy', 'last_name' => 'Waitlistsurname', 'name' => 'Wendy Waitlistsurname']);
        $eventId = $this->event($organiser);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $waiting->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($organiser, ['*']);
        $response = $this->apiGet("/v2/events/{$eventId}/waitlist")->assertStatus(200);

        $byId = $this->indexById($response->json('data') ?? []);
        $this->assertSame('Wendy', $byId[$waiting->id]['name']);
        $this->assertStringNotContainsString('Waitlistsurname', (string) $response->getContent());
    }

    public function test_event_attendance_records_show_first_names_to_a_member_organiser(): void
    {
        $organiser = $this->member(['first_name' => 'Olive', 'last_name' => 'Organisersurname', 'name' => 'Olive Organisersurname']);
        $checker = $this->member(['first_name' => 'Carl', 'last_name' => 'Checkersurname', 'name' => 'Carl Checkersurname']);
        $attended = $this->member(['first_name' => 'Tess', 'last_name' => 'Attendedsurname', 'name' => 'Tess Attendedsurname']);
        $eventId = $this->event($organiser);
        $this->rsvp($eventId, $attended);
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attended->id,
            'checked_in_at' => now(),
            'checked_in_by' => $checker->id,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($organiser, ['*']);
        $response = $this->apiGet("/v2/events/{$eventId}/attendance")->assertStatus(200);

        $row = collect($response->json('data') ?? [])->firstWhere('user_id', $attended->id);
        $this->assertNotNull($row);
        $this->assertSame('Tess', $row['name']);
        $this->assertSame('Carl', $row['checked_in_by']);
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Attendedsurname', $body);
        $this->assertStringNotContainsString('Checkersurname', $body);
    }

    // ------------------------------------------------------------------
    //  Direct messages
    // ------------------------------------------------------------------

    public function test_conversation_list_shows_the_partner_by_first_name(): void
    {
        $viewer = $this->member(['first_name' => 'Vera', 'last_name' => 'Viewerownsurname', 'name' => 'Vera Viewerownsurname']);
        $partner = $this->member(['first_name' => 'Paul', 'last_name' => 'Partnersurname', 'name' => 'Paul Partnersurname']);
        $this->message($partner, $viewer, 'Hello from Paul');
        $this->message($viewer, $partner, 'Hello back');

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/messages')->assertStatus(200);

        $row = collect($response->json('data') ?? [])->firstWhere('partner_id', $partner->id);
        $this->assertNotNull($row, 'The conversation with the partner is listed.');
        $this->assertSame('Paul', $row['other_user']['name']);
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Partnersurname', $body);
        $this->assertStringContainsString('Viewerownsurname', $body, 'The viewer\'s own participant object is unchanged.');
    }

    public function test_message_thread_shows_the_partner_by_first_name(): void
    {
        $viewer = $this->member();
        $partner = $this->member(['first_name' => 'Tina', 'last_name' => 'Threadsurname', 'name' => 'Tina Threadsurname']);
        $this->message($partner, $viewer, 'First');
        $this->message($viewer, $partner, 'Second');

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet("/v2/messages/{$partner->id}")->assertStatus(200);

        $this->assertSame('Tina', $response->json('meta.conversation.other_user.name'));
        $this->assertStringNotContainsString('Threadsurname', (string) $response->getContent());
    }

    public function test_admin_sees_the_partner_surname_in_the_conversation_list(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $partner = $this->member(['first_name' => 'Ann', 'last_name' => 'Adminmessagesee', 'name' => 'Ann Adminmessagesee']);
        $this->message($partner, $admin, 'Hello admin');

        Sanctum::actingAs($admin, ['*']);
        $row = collect($this->apiGet('/v2/messages')->assertStatus(200)->json('data') ?? [])
            ->firstWhere('partner_id', $partner->id);

        $this->assertSame('Ann Adminmessagesee', $row['other_user']['name']);
    }

    public function test_send_response_shows_the_recipient_by_first_name(): void
    {
        $viewer = $this->member();
        $recipient = $this->member(['first_name' => 'Rita', 'last_name' => 'Recipientsurname', 'name' => 'Rita Recipientsurname']);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiPost('/v2/messages', ['recipient_id' => $recipient->id, 'body' => 'Hi Rita'])->assertStatus(201);

        $this->assertSame($recipient->id, $response->json('data.receiver.id'));
        $this->assertSame('Rita', $response->json('data.receiver.name'));
        $this->assertStringNotContainsString('Recipientsurname', (string) $response->getContent());
    }

    // ------------------------------------------------------------------
    //  Group conversations
    // ------------------------------------------------------------------

    public function test_group_conversation_lists_show_first_names(): void
    {
        $viewer = $this->member(['first_name' => 'Gwen', 'last_name' => 'Groupviewerown', 'name' => 'Gwen Groupviewerown']);
        $other = $this->member(['first_name' => 'Gus', 'last_name' => 'Groupchatsurname', 'name' => 'Gus Groupchatsurname']);
        $conversationId = $this->groupConversation($viewer, [$other]);
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'conversation_id' => $conversationId,
            'sender_id' => $other->id,
            'receiver_id' => 0,
            'body' => 'Hello group',
            'is_read' => 0,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($viewer, ['*']);

        $participants = $this->apiGet("/v2/conversations/{$conversationId}/participants")->assertStatus(200);
        $byId = $this->indexById($participants->json('data') ?? []);
        $this->assertSame('Gus', $byId[$other->id]['name']);
        $this->assertStringNotContainsString('Groupchatsurname', (string) $participants->getContent());
        $this->assertSame('Gwen Groupviewerown', $byId[$viewer->id]['name'], 'The viewer\'s own row is unchanged.');

        $messages = $this->apiGet("/v2/conversations/{$conversationId}/messages")->assertStatus(200);
        $this->assertStringNotContainsString('Groupchatsurname', (string) $messages->getContent());
        $sender = collect($messages->json('data') ?? [])->firstWhere('sender_id', $other->id);
        $this->assertSame('Gus', $sender['sender']['name']);

        $list = $this->apiGet('/v2/conversations/groups')->assertStatus(200);
        $this->assertStringNotContainsString('Groupchatsurname', (string) $list->getContent());
    }

    // ------------------------------------------------------------------
    //  Reviews lists
    // ------------------------------------------------------------------

    public function test_reviews_of_a_member_show_reviewers_by_first_name(): void
    {
        $receiver = $this->member();
        $reviewer = $this->member(['first_name' => 'Rex', 'last_name' => 'Reviewersurname', 'name' => 'Rex Reviewersurname']);
        $this->review($reviewer, $receiver);

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet("/v2/reviews/user/{$receiver->id}")->assertStatus(200);

        $row = collect($response->json('data') ?? [])->firstWhere('reviewer.id', $reviewer->id);
        $this->assertNotNull($row);
        $this->assertSame('Rex', $row['reviewer']['name']);
        $this->assertStringNotContainsString('Reviewersurname', (string) $response->getContent());
    }

    public function test_reviews_given_show_the_receiver_by_first_name(): void
    {
        $viewer = $this->member();
        $receiver = $this->member(['first_name' => 'Gil', 'last_name' => 'Givensurname', 'name' => 'Gil Givensurname']);
        $this->review($viewer, $receiver);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/reviews/given')->assertStatus(200);

        $row = collect($response->json('data') ?? [])->firstWhere('receiver.id', $receiver->id);
        $this->assertNotNull($row);
        $this->assertSame('Gil', $row['receiver']['name']);
        $this->assertStringNotContainsString('Givensurname', (string) $response->getContent());
    }

    // ------------------------------------------------------------------
    //  Other member lists (F-084 audit)
    // ------------------------------------------------------------------

    public function test_reaction_lists_show_reactors_by_first_name(): void
    {
        $author = $this->member();
        $reactor = $this->member(['first_name' => 'Rhea', 'last_name' => 'Reactorsurname', 'name' => 'Rhea Reactorsurname']);
        $postId = (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'content' => 'Surname residue post',
            'type' => 'post',
            'visibility' => 'public',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('reactions')->insert([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $reactor->id,
            'emoji' => 'love',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->member(), ['*']);

        $summary = $this->apiGet("/v2/posts/{$postId}/reactions")->assertStatus(200);
        $this->assertSame('Rhea', $summary->json('data.top_reactors.0.name'));
        $this->assertStringNotContainsString('Reactorsurname', (string) $summary->getContent());

        $reactors = $this->apiGet("/v2/posts/{$postId}/reactions/love/users")->assertStatus(200);
        $this->assertSame('Rhea', $reactors->json('data.0.name'));
        $this->assertStringNotContainsString('Reactorsurname', (string) $reactors->getContent());
    }

    public function test_group_detail_recent_members_show_first_names(): void
    {
        $owner = $this->member();
        $viewer = $this->member();
        $other = $this->member(['first_name' => 'Rory', 'last_name' => 'Recentsurname', 'name' => 'Rory Recentsurname']);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Recent members fixture ' . bin2hex(random_bytes(3)),
            'description' => 'F-084 fixture',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        foreach ([[$owner, 'owner'], [$viewer, 'member'], [$other, 'member']] as [$m, $role]) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $m->id,
                'role' => $role,
                'status' => 'active',
                'created_at' => now(),
            ]);
        }

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet("/v2/groups/{$groupId}")->assertStatus(200);

        $recent = $this->indexById($response->json('data.recent_members') ?? []);
        $this->assertSame('Rory', $recent[$other->id]['name']);
        $this->assertStringNotContainsString('Recentsurname', (string) $response->getContent());
    }

    public function test_exchanges_show_the_other_party_by_first_name(): void
    {
        $viewer = $this->member();
        $provider = $this->member(['first_name' => 'Pia', 'last_name' => 'Providersurname', 'name' => 'Pia Providersurname']);
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $provider->id,
            'title' => 'Garden help',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $exchangeId = (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $viewer->id,
            'provider_id' => $provider->id,
            'proposed_hours' => 1,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
        // Exchange workflow is off by default; switch it on for this community.
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $configuration['broker_controls']['exchange_workflow']['enabled'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($configuration)]);
        Cache::flush();

        Sanctum::actingAs($viewer, ['*']);

        $list = $this->apiGet('/v2/exchanges')->assertStatus(200);
        $row = collect($list->json('data') ?? [])->firstWhere('id', $exchangeId);
        $this->assertNotNull($row);
        $this->assertSame('Pia', $row['provider']['name']);
        $this->assertStringNotContainsString('Providersurname', (string) $list->getContent());

        $show = $this->apiGet("/v2/exchanges/{$exchangeId}")->assertStatus(200);
        $this->assertSame('Pia', $show->json('data.provider.name'));
        $this->assertStringNotContainsString('Providersurname', (string) $show->getContent());
    }

    public function test_endorsement_lists_show_endorsers_by_first_name(): void
    {
        $endorsed = $this->member(['first_name' => 'Ella', 'last_name' => 'Endorsedsurname', 'name' => 'Ella Endorsedsurname']);
        $endorser = $this->member(['first_name' => 'Eric', 'last_name' => 'Endorsersurname', 'name' => 'Eric Endorsersurname']);
        DB::table('skill_endorsements')->insert([
            'tenant_id' => $this->testTenantId,
            'endorser_id' => $endorser->id,
            'endorsed_id' => $endorsed->id,
            'skill_name' => 'Gardening',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->member(), ['*']);

        $grouped = $this->apiGet("/v2/members/{$endorsed->id}/endorsements")->assertStatus(200);
        $this->assertSame('Eric', $grouped->json('data.endorsements.0.endorsements.0.endorser_name'));
        $this->assertStringNotContainsString('Endorsersurname', (string) $grouped->getContent());

        $detail = $this->apiGet("/v2/members/{$endorsed->id}/endorsements?skill_name=Gardening")->assertStatus(200);
        $this->assertSame('Eric', $detail->json('data.endorsements.0.endorser_name'));
        $this->assertStringNotContainsString('Endorsersurname', (string) $detail->getContent());

        $top = $this->apiGet('/v2/members/top-endorsed?limit=50')->assertStatus(200);
        $this->assertStringNotContainsString('Endorsedsurname', (string) $top->getContent());
    }

    public function test_ideation_ideas_and_comments_show_authors_by_first_name(): void
    {
        $owner = $this->member();
        $author = $this->member(['first_name' => 'Ivy', 'last_name' => 'Ideasurname', 'name' => 'Ivy Ideasurname']);
        $commenter = $this->member(['first_name' => 'Cole', 'last_name' => 'Commentsurname', 'name' => 'Cole Commentsurname']);
        $challengeId = (int) DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Surname residue challenge',
            'description' => 'F-084 fixture',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $ideaId = (int) DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => $author->id,
            'title' => 'Plant more trees',
            'description' => 'Along the river.',
            'status' => 'submitted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('challenge_idea_comments')->insert([
            'idea_id' => $ideaId,
            'user_id' => $commenter->id,
            'body' => 'Good idea',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($this->member(), ['*']);

        $ideas = $this->apiGet("/v2/ideation-challenges/{$challengeId}/ideas")->assertStatus(200);
        $this->assertSame('Ivy', collect($ideas->json('data') ?? [])->firstWhere('id', $ideaId)['creator']['name']);
        $this->assertStringNotContainsString('Ideasurname', (string) $ideas->getContent());

        $idea = $this->apiGet("/v2/ideation-ideas/{$ideaId}")->assertStatus(200);
        $this->assertSame('Ivy', $idea->json('data.creator.name'));
        $this->assertStringNotContainsString('Ideasurname', (string) $idea->getContent());

        $comments = $this->apiGet("/v2/ideation-ideas/{$ideaId}/comments")->assertStatus(200);
        $this->assertSame('Cole', $comments->json('data.0.author.name'));
        $this->assertStringNotContainsString('Commentsurname', (string) $comments->getContent());
    }

    public function test_story_viewers_show_first_names_to_the_owner(): void
    {
        $owner = $this->member();
        $viewer = $this->member(['first_name' => 'Sam', 'last_name' => 'Storyviewersurname', 'name' => 'Sam Storyviewersurname']);
        $storyId = (int) DB::table('stories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'media_type' => 'text',
            'text_content' => 'Surname residue story',
            'audience' => 'everyone',
            'duration' => 5,
            'is_active' => 1,
            'view_count' => 1,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);
        DB::table('story_views')->insert([
            'tenant_id' => $this->testTenantId,
            'story_id' => $storyId,
            'viewer_id' => $viewer->id,
            'viewed_at' => now(),
        ]);

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiGet("/v2/stories/{$storyId}/viewers")->assertStatus(200);

        $this->assertSame('Sam', $response->json('data.0.name'));
        $this->assertStringNotContainsString('Storyviewersurname', (string) $response->getContent());
    }

    // ------------------------------------------------------------------

    private function event(User $organiser): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiser->id,
            'title' => 'Surname residue fixture',
            'description' => 'F-084 fixture',
            'location' => 'Community hall',
            'start_time' => now()->addDays(7)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(7)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function rsvp(int $eventId, User $member): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $member->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function message(User $from, User $to, string $body): void
    {
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $from->id,
            'receiver_id' => $to->id,
            'body' => $body,
            'is_read' => 0,
            'created_at' => now(),
        ]);
    }

    /** @param list<User> $members */
    private function groupConversation(User $creator, array $members): int
    {
        $conversationId = (int) DB::table('conversations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'is_group' => 1,
            'group_name' => 'Surname residue chat',
            'created_by' => $creator->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $rows = [['user' => $creator, 'role' => 'admin']];
        foreach ($members as $m) {
            $rows[] = ['user' => $m, 'role' => 'member'];
        }
        foreach ($rows as $row) {
            DB::table('conversation_participants')->insert([
                'tenant_id' => $this->testTenantId,
                'conversation_id' => $conversationId,
                'user_id' => $row['user']->id,
                'role' => $row['role'],
                'joined_at' => now(),
            ]);
        }

        return $conversationId;
    }

    private function review(User $reviewer, User $receiver): Review
    {
        $review = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $receiver->id,
            'rating' => 5,
            'status' => 'approved',
            'is_anonymous' => 0,
        ]);
        TenantContext::setById($this->testTenantId);

        return $review;
    }

    /**
     * @param  list<array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    private function indexById(array $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $out[(int) ($row['id'] ?? $row['user_id'] ?? 0)] = (array) $row;
        }

        return $out;
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'privacy_profile' => 'public',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
