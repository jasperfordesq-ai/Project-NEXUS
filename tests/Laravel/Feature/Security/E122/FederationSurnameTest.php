<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E122;

use App\Core\TenantContext;
use App\Http\Controllers\Api\FederationV2Controller;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\Feature\Security\E065\Concerns\SeedsInternalFederation;
use Tests\Laravel\TestCase;

/**
 * E-122 stage 1 (audit L1, L4) — INTERNAL federation must not carry a
 * member's surname across the community boundary.
 *
 * Owner rule (10 Nov 2026): "No surnames should be anywhere on the site apart
 * from for admins." On federation screens the people shown belong to ANOTHER
 * community, so an administrator of the viewer's community is not their
 * administrator: both an ordinary member and a community admin get the first
 * name only. An organisation account keeps its trading name. The member's own
 * name, and members of the viewer's own community for that community's admin,
 * are unchanged.
 *
 * Every surname below is one invented token, so a substring search over the
 * response body has no false positives.
 */
final class FederationSurnameTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;
    use SeedsInternalFederation;

    private const MEMBER_SURNAME = 'Zyxsurname';
    private const CONTACT_SURNAME = 'Zyxcontact';
    private const VIEWER_SURNAME = 'Zyxviewer';
    private const ORG_NAME = 'Zyx Helping Hands';

    private int $home;
    private int $partner;
    private User $viewer;
    private User $homeAdmin;
    private User $member;
    private User $organisation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();

        $this->home = $this->testTenantId;
        $this->partner = $this->seedPartnerTenant('E122 Partner');
        $this->seedPartnership($this->partner);

        $this->viewer = $this->seedFederatedUser($this->home, [
            'first_name' => 'Vera',
            'last_name' => self::VIEWER_SURNAME,
            'name' => 'Vera ' . self::VIEWER_SURNAME,
            'balance' => 25,
        ]);
        $this->homeAdmin = $this->seedFederatedUser($this->home, [
            'first_name' => 'Adam',
            'last_name' => 'Zyxhomeadmin',
            'name' => 'Adam Zyxhomeadmin',
            'role' => 'admin',
        ]);
        $this->member = $this->seedFederatedUser($this->partner, [
            'first_name' => 'Bea',
            'last_name' => self::MEMBER_SURNAME,
            'name' => 'Bea ' . self::MEMBER_SURNAME,
        ]);
        $this->organisation = $this->seedFederatedUser($this->partner, [
            'first_name' => 'Olga',
            'last_name' => self::CONTACT_SURNAME,
            'name' => 'Olga ' . self::CONTACT_SURNAME,
            'profile_type' => 'organisation',
            'organization_name' => self::ORG_NAME,
        ]);
    }

    private function actAs(User $user, int $tenantId): void
    {
        $this->app['auth']->forgetGuards();
        $this->withTenant($tenantId);
        TenantContext::setById($tenantId);
        Sanctum::actingAs($user, ['*']);
    }

    /** The decoded body re-encoded without escapes, so a `\u` sequence cannot hide a surname. */
    private function body(TestResponse $response): string
    {
        return (string) json_encode($response->json(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function assertNoPartnerSurname(TestResponse $response, string $what): void
    {
        $body = $this->body($response);
        foreach ([self::MEMBER_SURNAME, self::CONTACT_SURNAME] as $surname) {
            $this->assertStringNotContainsStringIgnoringCase($surname, $body, "{$what}: the surname {$surname} of another community's member reached the viewer");
        }
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<string, mixed>
     */
    private function rowWithId(array $rows, int $id, string $key = 'id'): array
    {
        foreach ($rows as $row) {
            if ((int) ($row[$key] ?? 0) === $id) {
                return $row;
            }
        }
        $this->fail("row {$id} not in the response — the test would prove nothing");
    }

    /** @return array<string, array{0: string}> */
    public static function nonAdminOfThePartnerCommunity(): array
    {
        return [
            'an ordinary member of the other community' => ['viewer'],
            'an ADMIN of the other community' => ['homeAdmin'],
        ];
    }

    // ------------------------------------------------------------ L1 members

    /** @dataProvider nonAdminOfThePartnerCommunity */
    public function test_member_list_shows_first_name_only(string $who): void
    {
        $this->actAs($this->{$who}, $this->home);
        $response = $this->apiGet('/v2/federation/members?per_page=100')->assertOk();
        $rows = $response->json('data') ?? [];

        $row = $this->rowWithId($rows, (int) $this->member->id);
        $this->assertSame('Bea', $row['name']);
        $this->assertSame('Bea', $row['first_name']);
        $this->assertArrayNotHasKey('last_name', $row);

        $org = $this->rowWithId($rows, (int) $this->organisation->id);
        $this->assertSame(self::ORG_NAME, $org['name'], 'an organisation keeps its trading name');
        $this->assertArrayNotHasKey('last_name', $org);

        $this->assertNoPartnerSurname($response, 'GET /v2/federation/members');
    }

    public function test_member_list_cannot_be_searched_by_surname(): void
    {
        $this->actAs($this->viewer, $this->home);

        $bySurname = $this->apiGet('/v2/federation/members?q=' . self::MEMBER_SURNAME)->assertOk();
        $ids = array_map(static fn (array $r): int => (int) ($r['id'] ?? 0), $bySurname->json('data') ?? []);
        $this->assertNotContains((int) $this->member->id, $ids, 'a surname search must not confirm a surname');

        $this->actAs($this->viewer, $this->home);
        $byFirst = $this->apiGet('/v2/federation/members?q=Bea')->assertOk();
        $ids = array_map(static fn (array $r): int => (int) ($r['id'] ?? 0), $byFirst->json('data') ?? []);
        $this->assertContains((int) $this->member->id, $ids, 'CONTROL: a first-name search still works');
    }

    /** @dataProvider nonAdminOfThePartnerCommunity */
    public function test_member_page_shows_first_name_only(string $who): void
    {
        $this->actAs($this->{$who}, $this->home);
        $response = $this->apiGet('/v2/federation/members/' . $this->member->id . '?tenant_id=' . $this->partner)->assertOk();

        $response->assertJsonPath('data.id', (int) $this->member->id);
        $response->assertJsonPath('data.name', 'Bea');
        $response->assertJsonPath('data.first_name', 'Bea');
        $this->assertArrayNotHasKey('last_name', $response->json('data'));
        $this->assertNoPartnerSurname($response, 'GET /v2/federation/members/{id}');

        $this->actAs($this->{$who}, $this->home);
        $org = $this->apiGet('/v2/federation/members/' . $this->organisation->id . '?tenant_id=' . $this->partner)->assertOk();
        $org->assertJsonPath('data.name', self::ORG_NAME);
        $this->assertNoPartnerSurname($org, 'GET /v2/federation/members/{id} (organisation)');
    }

    public function test_a_platform_administrator_still_sees_the_surname(): void
    {
        $platformAdmin = $this->seedFederatedUser($this->home, [
            'first_name' => 'Pat',
            'last_name' => 'Zyxplatform',
            'role' => 'admin',
            'is_super_admin' => 1,
        ]);

        $this->actAs($platformAdmin, $this->home);
        $rows = $this->apiGet('/v2/federation/members?per_page=100')->assertOk()->json('data') ?? [];
        $row = $this->rowWithId($rows, (int) $this->member->id);
        $this->assertSame('Bea ' . self::MEMBER_SURNAME, $row['name'], 'what a platform administrator saw before is unchanged');
        $this->assertSame(self::MEMBER_SURNAME, $row['last_name']);

        $this->actAs($platformAdmin, $this->home);
        $this->apiGet('/v2/federation/members/' . $this->member->id . '?tenant_id=' . $this->partner)
            ->assertOk()
            ->assertJsonPath('data.name', 'Bea ' . self::MEMBER_SURNAME)
            ->assertJsonPath('data.last_name', self::MEMBER_SURNAME);
    }

    // ------------------------------------------------------------ L1 reviews

    public function test_review_list_names_reviewers_by_first_name(): void
    {
        $partnerReviewer = $this->seedFederatedUser($this->partner, [
            'first_name' => 'Rex',
            'last_name' => 'Zyxreviewer',
            'name' => 'Rex Zyxreviewer',
        ]);
        $homeReviewer = $this->seedFederatedUser($this->home, [
            'first_name' => 'Hal',
            'last_name' => 'Zyxhomereviewer',
            'name' => 'Hal Zyxhomereviewer',
        ]);

        DB::table('reviews')->insert([
            'tenant_id' => $this->partner,
            'reviewer_id' => $partnerReviewer->id,
            'receiver_id' => $this->member->id,
            'rating' => 5,
            'comment' => 'E122 local review',
            'status' => 'approved',
            'review_type' => 'local',
            'show_cross_tenant' => 1,
            'created_at' => now(),
        ]);
        DB::table('reviews')->insert([
            'tenant_id' => $this->home,
            'reviewer_id' => $homeReviewer->id,
            'reviewer_tenant_id' => $this->home,
            'receiver_id' => $this->member->id,
            'receiver_tenant_id' => $this->partner,
            'rating' => 4,
            'comment' => 'E122 federated review',
            'status' => 'approved',
            'review_type' => 'federated',
            'show_cross_tenant' => 1,
            'created_at' => now(),
        ]);
        $uri = '/v2/federation/members/' . $this->member->id . '/reviews?tenant_id=' . $this->partner;

        // An ordinary member: no reviewer surname from either community.
        $this->actAs($this->viewer, $this->home);
        $response = $this->apiGet($uri)->assertOk();
        $names = array_column(array_column($response->json('data') ?? [], 'reviewer'), 'name');
        // (The partner-community reviewer is not resolved at all today — the
        // reviewer relation is tenant-scoped to the viewer's community — so
        // only the absence of the surname is asserted for that row.)
        $this->assertCount(2, $names, 'both reviews are listed — otherwise the test proves nothing');
        $this->assertContains('Hal', $names);
        $body = $this->body($response);
        $this->assertStringNotContainsString('Zyxreviewer', $body);
        $this->assertStringNotContainsString('Zyxhomereviewer', $body);

        // An admin of the home community: still sees the full name of the
        // reviewer who belongs to THEIR community, and only the first name of
        // the reviewer who belongs to the other one.
        $this->actAs($this->homeAdmin, $this->home);
        $response = $this->apiGet($uri)->assertOk();
        $names = array_column(array_column($response->json('data') ?? [], 'reviewer'), 'name');
        $this->assertContains('Hal Zyxhomereviewer', $names);
        $this->assertStringNotContainsString('Zyxreviewer', $this->body($response));
    }

    // ----------------------------------------------------------- L1 messages

    public function test_message_list_names_the_other_party_by_first_name_and_keeps_my_own_name(): void
    {
        foreach ([
            ['inbound', $this->partner, $this->member->id, $this->home, $this->viewer->id],
            ['outbound', $this->home, $this->viewer->id, $this->partner, $this->member->id],
            ['inbound', $this->partner, $this->organisation->id, $this->home, $this->viewer->id],
        ] as [$direction, $senderTenant, $senderId, $receiverTenant, $receiverId]) {
            DB::table('federation_messages')->insert([
                'sender_tenant_id' => $senderTenant,
                'sender_user_id' => $senderId,
                'receiver_tenant_id' => $receiverTenant,
                'receiver_user_id' => $receiverId,
                'subject' => 'E122',
                'body' => 'E122 body',
                'direction' => $direction,
                'status' => $direction === 'inbound' ? 'unread' : 'delivered',
                'created_at' => now(),
            ]);
        }

        $this->actAs($this->viewer, $this->home);
        $response = $this->apiGet('/v2/federation/messages')->assertOk();
        $rows = $response->json('data') ?? [];
        $this->assertCount(3, $rows, 'all three seeded messages are listed — otherwise the test proves nothing');

        $this->assertNoPartnerSurname($response, 'GET /v2/federation/messages');

        $otherNames = [];
        foreach ($rows as $row) {
            $mine = $row['direction'] === 'outbound' ? $row['sender'] : $row['receiver'];
            $other = $row['direction'] === 'outbound' ? $row['receiver'] : $row['sender'];
            $this->assertSame('Vera ' . self::VIEWER_SURNAME, $mine['name'], 'a member still sees their own name in full');
            $otherNames[] = $other['name'];
        }
        sort($otherNames);
        $this->assertSame(['Bea', 'Bea', self::ORG_NAME], $otherNames);
    }

    public function test_sending_a_message_names_nobody_by_surname_across_the_boundary(): void
    {
        $this->actAs($this->viewer, $this->home);
        $response = $this->apiPost('/v2/federation/messages', [
            'receiver_id' => (int) $this->member->id,
            'receiver_tenant_id' => $this->partner,
            'subject' => 'E122 subject',
            'body' => 'E122 sent body',
        ]);
        $this->assertSame(201, $response->getStatusCode(), 'send failed: ' . $response->getContent());

        // L1 — the response: the receiver belongs to the other community.
        $response->assertJsonPath('data.receiver.name', 'Bea');
        $response->assertJsonPath('data.sender.name', 'Vera ' . self::VIEWER_SURNAME);
        $this->assertNoPartnerSurname($response, 'POST /v2/federation/messages');

        // L4 — the bell (and the push built from the same text) the receiver gets.
        $bell = DB::table('notifications')
            ->where('user_id', (int) $this->member->id)
            ->where('tenant_id', $this->partner)
            ->where('type', 'federation_message')
            ->value('message');
        $this->assertNotNull($bell, 'the receiver was notified — otherwise the test proves nothing');
        $this->assertStringContainsString('Vera', (string) $bell);
        $this->assertStringNotContainsString(self::VIEWER_SURNAME, (string) $bell, 'the bell told another community the sender\'s surname');
    }

    // ---------------------------------------------------- L1 events, listings

    /** @dataProvider nonAdminOfThePartnerCommunity */
    public function test_event_and_listing_lists_name_the_owner_by_first_name(string $who): void
    {
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->partner,
            'user_id' => $this->member->id,
            'title' => 'E122 federated event',
            'description' => 'E122',
            'start_time' => now()->addDays(3),
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $orgEventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->partner,
            'user_id' => $this->organisation->id,
            'title' => 'E122 organisation event',
            'description' => 'E122',
            'start_time' => now()->addDays(4),
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->partner,
            'user_id' => $this->member->id,
            'title' => 'E122 federated listing',
            'description' => 'E122',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actAs($this->{$who}, $this->home);
        $events = $this->apiGet('/v2/federation/events?per_page=100')->assertOk();
        $rows = $events->json('data') ?? [];
        $this->assertSame('Bea', $this->rowWithId($rows, $eventId)['organizer']['name']);
        $this->assertSame(self::ORG_NAME, $this->rowWithId($rows, $orgEventId)['organizer']['name']);
        $this->assertNoPartnerSurname($events, 'GET /v2/federation/events');

        $this->actAs($this->{$who}, $this->home);
        $listings = $this->apiGet('/v2/federation/listings?per_page=100')->assertOk();
        $this->assertSame('Bea', $this->rowWithId($listings->json('data') ?? [], $listingId)['author']['name']);
        $this->assertNoPartnerSurname($listings, 'GET /v2/federation/listings');
    }

    // -------------------------------------------------- L1 + L4 connections

    public function test_connection_list_names_the_other_party_by_first_name(): void
    {
        foreach ([$this->member, $this->organisation] as $other) {
            DB::table('federation_connections')->insert([
                'requester_user_id' => (int) $this->viewer->id,
                'requester_tenant_id' => $this->home,
                'receiver_user_id' => (int) $other->id,
                'receiver_tenant_id' => $this->partner,
                'status' => 'accepted',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->actAs($this->viewer, $this->home);
        $response = $this->apiGet('/v2/federation/connections?status=accepted')->assertOk();
        $rows = $response->json('data') ?? [];

        $this->assertSame('Bea', $this->rowWithId($rows, (int) $this->member->id, 'user_id')['name']);
        $this->assertSame(self::ORG_NAME, $this->rowWithId($rows, (int) $this->organisation->id, 'user_id')['name']);
        $this->assertNoPartnerSurname($response, 'GET /v2/federation/connections');
    }

    public function test_connection_request_and_acceptance_bells_use_first_names(): void
    {
        // Vera (home) asks Bea (partner) to connect.
        $this->actAs($this->viewer, $this->home);
        $this->apiPost('/v2/federation/connections', [
            'receiver_id' => (int) $this->member->id,
            'receiver_tenant_id' => $this->partner,
            'message' => 'E122',
        ])->assertStatus(201);

        $requestBell = DB::table('notifications')
            ->where('user_id', (int) $this->member->id)
            ->where('tenant_id', $this->partner)
            ->where('type', 'federation_connection')
            ->value('message');
        $this->assertNotNull($requestBell, 'the receiver was told about the request');
        $this->assertStringContainsString('Vera', (string) $requestBell);
        $this->assertStringNotContainsString(self::VIEWER_SURNAME, (string) $requestBell, 'the request bell carried the requester\'s surname to another community');

        // Bea accepts; Vera is told.
        $connectionId = (int) DB::table('federation_connections')
            ->where('requester_user_id', (int) $this->viewer->id)
            ->where('receiver_user_id', (int) $this->member->id)
            ->value('id');
        $this->actAs($this->member, $this->partner);
        $accepted = $this->apiPost('/v2/federation/connections/' . $connectionId . '/accept');
        $this->assertLessThan(300, $accepted->getStatusCode(), 'accept failed: ' . $accepted->getContent());

        $acceptBell = DB::table('notifications')
            ->where('user_id', (int) $this->viewer->id)
            ->where('tenant_id', $this->home)
            ->where('type', 'federation_connection')
            ->value('message');
        $this->assertNotNull($acceptBell, 'the requester was told about the acceptance');
        $this->assertStringContainsString('Bea', (string) $acceptBell);
        $this->assertStringNotContainsString(self::MEMBER_SURNAME, (string) $acceptBell, 'the acceptance bell carried the accepter\'s surname to another community');
    }

    // ---------------------------------------------------- L4 transfer bell

    public function test_transfer_bell_names_the_sender_by_first_name(): void
    {
        $this->actAs($this->viewer, $this->home);
        $this->app->instance('request', Request::create(
            '/api/v2/federation/transactions',
            'POST',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/json'],
            (string) json_encode([
                'receiver_id' => (int) $this->member->id,
                'receiver_tenant_id' => $this->partner,
                'amount' => 2,
                'description' => 'E122 transfer',
            ]),
        ));
        TenantContext::setById($this->home);

        $response = $this->app->make(FederationV2Controller::class)->sendTransaction();
        $this->assertSame(201, $response->getStatusCode(), (string) $response->getContent());

        $bell = DB::table('notifications')
            ->where('user_id', (int) $this->member->id)
            ->where('tenant_id', $this->partner)
            ->where('type', 'federation_transaction')
            ->value('message');
        $this->assertNotNull($bell, 'the receiver was told about the credits');
        $this->assertStringContainsString('Vera', (string) $bell);
        $this->assertStringNotContainsString(self::VIEWER_SURNAME, (string) $bell, 'the transfer bell carried the sender\'s surname to another community');
    }
}
