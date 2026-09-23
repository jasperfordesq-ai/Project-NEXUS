<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-083 (E-027) — sending someone a connection request put them in the
 * sender's "sent requests" list with their surname, bio, location and
 * last-active time, whatever the recipient's privacy setting. The request is
 * one-sided, so it must reveal no more than the recipient's profile would.
 *
 * F-084 (E-027) — the connections list is one of the member lists that showed
 * full surnames, which the profile and directory hide from non-admins.
 */
class ConnectionListPrivacyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_sent_request_to_connections_only_member_reveals_no_profile_detail(): void
    {
        $sender = $this->member();
        $receiver = $this->member([
            'first_name' => 'Priya',
            'last_name' => 'Privatesurname',
            'name' => 'Priya Privatesurname',
            'bio' => 'Private biography text',
            'location' => 'Privatetown',
            'privacy_profile' => 'connections',
        ]);
        $this->connection($sender, $receiver, 'pending');

        Sanctum::actingAs($sender, ['*']);
        $response = $this->apiGet('/v2/connections?status=pending_sent')->assertStatus(200);

        $row = $this->rowFor($response->json('data') ?? [], $receiver->id);
        $this->assertSame('Priya', $row['user']['name']);
        $this->assertArrayNotHasKey('last_active_at', $row['user']);
        $this->assertTrue(empty($row['user']['bio']));
        $this->assertTrue(empty($row['user']['location']));
        $body = (string) $response->getContent();
        foreach (['Privatesurname', 'Private biography text', 'Privatetown'] as $secret) {
            $this->assertStringNotContainsString($secret, $body);
        }
    }

    public function test_sent_request_to_public_member_shows_bio_but_not_surname_or_last_active(): void
    {
        $sender = $this->member();
        $receiver = $this->member([
            'first_name' => 'Paul',
            'last_name' => 'Publicsurname',
            'name' => 'Paul Publicsurname',
            'bio' => 'Public biography',
            'location' => 'Opentown',
        ]);
        $this->connection($sender, $receiver, 'pending');

        Sanctum::actingAs($sender, ['*']);
        $response = $this->apiGet('/v2/connections?status=pending_sent')->assertStatus(200);

        $row = $this->rowFor($response->json('data') ?? [], $receiver->id);
        $this->assertSame('Public biography', $row['user']['bio']);
        $this->assertSame('Opentown', $row['user']['location']);
        $this->assertArrayNotHasKey('last_active_at', $row['user']);
        $this->assertStringNotContainsString('Publicsurname', (string) $response->getContent());
    }

    public function test_accepted_connections_list_hides_surnames_from_non_admins(): void
    {
        $viewer = $this->member();
        $friend = $this->member([
            'first_name' => 'Fiona',
            'last_name' => 'Friendsurname',
            'name' => 'Fiona Friendsurname',
            'bio' => 'Friend bio',
            'privacy_profile' => 'connections',
        ]);
        $this->connection($friend, $viewer, 'accepted');

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/connections')->assertStatus(200);

        $row = $this->rowFor($response->json('data') ?? [], $friend->id);
        $this->assertSame('Fiona', $row['user']['name']);
        $this->assertSame('Friend bio', $row['user']['bio'], 'A connection may see a connections-only bio.');
        $this->assertStringNotContainsString('Friendsurname', (string) $response->getContent());
    }

    public function test_admin_still_sees_surnames_in_their_connections_list(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $friend = $this->member(['first_name' => 'Ann', 'last_name' => 'Adminseen', 'name' => 'Ann Adminseen']);
        $this->connection($admin, $friend, 'accepted');

        Sanctum::actingAs($admin, ['*']);
        $row = $this->rowFor($this->apiGet('/v2/connections')->assertStatus(200)->json('data') ?? [], $friend->id);

        $this->assertSame('Adminseen', $row['user']['last_name']);
    }

    // ------------------------------------------------------------------

    /**
     * @param  list<array<string, mixed>> $rows
     * @return array<string, mixed>
     */
    private function rowFor(array $rows, int $partnerId): array
    {
        foreach ($rows as $row) {
            if ((int) ($row['user']['id'] ?? 0) === $partnerId) {
                return $row;
            }
        }
        $this->fail('Connection with member ' . $partnerId . ' not listed.');
    }

    private function connection(User $requester, User $receiver, string $status): void
    {
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $requester->id,
            'receiver_id' => $receiver->id,
            'status' => $status,
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'privacy_profile' => 'public',
            'last_active_at' => now(),
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
