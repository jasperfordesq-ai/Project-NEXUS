<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Core\TenantContext;
use App\Models\Social\Appreciation;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Warmth phase 6, D3b — the community thank-you page,
 * GET /v2/community/thank-yous.
 *
 * It shows something new about members, so every privacy rule is pinned
 * here: only notes their RECEIVER chose to show, never a private or removed
 * one, never one involving a member the viewer has blocked or is blocked by,
 * never one from or to a member who is not active in this community, never
 * another community's, never a surname for a member who is looking, and
 * nothing at all while the community switch (default OFF) is off.
 */
class CommunityThankYouPageTest extends TestCase
{
    use DatabaseTransactions;

    private const URL = '/v2/community/thank-yous';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->setFeatures(['appreciations' => true, 'community_thank_you_page' => true]);
    }

    public function test_the_switch_is_off_by_default_for_every_community(): void
    {
        $this->assertArrayHasKey('community_thank_you_page', TenantFeatureConfig::FEATURE_DEFAULTS);
        $this->assertFalse(TenantFeatureConfig::FEATURE_DEFAULTS['community_thank_you_page']);
    }

    public function test_switch_off_refuses_the_page(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $this->note($sender, $receiver, true, 'Shown but the page is off');
        $this->setFeatures(['appreciations' => true, 'community_thank_you_page' => false]);
        $this->signInAs($this->person());

        $response = $this->apiGet(self::URL);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->assertStringNotContainsString('Shown but the page is off', (string) $response->getContent());
    }

    public function test_thank_you_notes_switched_off_refuses_the_page_even_with_the_page_switch_on(): void
    {
        $this->setFeatures(['appreciations' => false, 'community_thank_you_page' => true]);
        $this->signInAs($this->person());

        $this->apiGet(self::URL)->assertStatus(403)->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_a_visitor_who_is_not_signed_in_is_refused(): void
    {
        $this->note($this->person(), $this->person(), true, 'Members only');

        $response = $this->apiGet(self::URL);

        $this->assertContains($response->getStatusCode(), [401, 403]);
        $this->assertStringNotContainsString('Members only', (string) $response->getContent());
    }

    public function test_only_notes_the_receiver_chose_to_show_appear_newest_first(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $older = $this->note($sender, $receiver, true, 'Older shown note');
        $this->note($sender, $receiver, false, 'A private note nobody else may read');
        $newer = $this->note($receiver, $sender, true, 'Newer shown note');
        $this->signInAs($this->person());

        $response = $this->apiGet(self::URL)->assertOk();

        $ids = array_column($response->json('data'), 'id');
        $this->assertSame([$newer->id, $older->id], $ids);
        $this->assertStringNotContainsString('A private note nobody else may read', (string) $response->getContent());
    }

    public function test_a_private_note_never_appears_even_to_its_sender_or_receiver_or_staff(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $this->note($sender, $receiver, false, 'Private between two people');

        foreach ([$sender, $receiver, $this->person(['role' => 'admin'])] as $viewer) {
            $this->signInAs($viewer);
            $response = $this->apiGet(self::URL)->assertOk();
            $response->assertJsonCount(0, 'data');
            $this->assertStringNotContainsString('Private between two people', (string) $response->getContent());
        }
    }

    public function test_a_note_the_receiver_hides_again_disappears(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $note = $this->note($sender, $receiver, true, 'Shown, then hidden again');
        $viewer = $this->person();

        $this->signInAs($viewer);
        $this->apiGet(self::URL)->assertOk()->assertJsonCount(1, 'data');

        $this->signInAs($receiver);
        $this->apiPut("/v2/appreciations/{$note->id}/visibility", ['is_public' => false])->assertOk();

        $this->signInAs($viewer);
        $response = $this->apiGet(self::URL)->assertOk();
        $response->assertJsonCount(0, 'data');
        $this->assertStringNotContainsString('Shown, then hidden again', (string) $response->getContent());
    }

    public function test_a_removed_note_disappears(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $note = $this->note($sender, $receiver, true, 'Shown, then removed');

        $this->signInAs($receiver);
        $this->apiDelete("/v2/appreciations/{$note->id}")->assertNoContent();

        $this->signInAs($this->person());
        $this->apiGet(self::URL)->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_a_note_involving_a_member_the_viewer_blocked_or_is_blocked_by_never_appears(): void
    {
        $viewer = $this->person();
        $blockedByViewer = $this->person();
        $blocksViewer = $this->person();
        $friend = $this->person();
        $this->note($blockedByViewer, $friend, true, 'From someone the viewer blocked');
        $this->note($friend, $blockedByViewer, true, 'To someone the viewer blocked');
        $this->note($blocksViewer, $friend, true, 'From someone who blocked the viewer');
        $this->note($friend, $blocksViewer, true, 'To someone who blocked the viewer');
        $visible = $this->note($friend, $this->person(), true, 'Nothing to do with a block');
        $this->block($viewer, $blockedByViewer);
        $this->block($blocksViewer, $viewer);

        $this->signInAs($viewer);
        $response = $this->apiGet(self::URL)->assertOk();

        $this->assertSame([$visible->id], array_column($response->json('data'), 'id'));
        $body = (string) $response->getContent();
        foreach (['viewer blocked', 'blocked the viewer'] as $fragment) {
            $this->assertStringNotContainsString($fragment, $body);
        }

        // The blocked members do not see the viewer's notes either.
        $this->note($viewer, $friend, true, 'The viewer thanked a friend');
        foreach ([$blockedByViewer, $blocksViewer] as $other) {
            $this->signInAs($other);
            $this->assertStringNotContainsString(
                'The viewer thanked a friend',
                (string) $this->apiGet(self::URL)->assertOk()->getContent(),
            );
        }
    }

    public function test_a_note_from_or_to_a_member_who_is_not_active_never_appears(): void
    {
        $friend = $this->person();
        $suspended = $this->person(['status' => 'suspended']);
        $pending = $this->person(['is_approved' => false]);
        $this->note($suspended, $friend, true, 'From a suspended member');
        $this->note($friend, $suspended, true, 'To a suspended member');
        $this->note($pending, $friend, true, 'From an unapproved member');
        $this->note($friend, $pending, true, 'To an unapproved member');
        $visible = $this->note($friend, $this->person(), true, 'Between two active members');

        $this->signInAs($this->person());
        $response = $this->apiGet(self::URL)->assertOk();

        $this->assertSame([$visible->id], array_column($response->json('data'), 'id'));
    }

    public function test_a_note_from_or_to_a_member_whose_profile_the_viewer_may_not_see_never_appears(): void
    {
        $friend = $this->person();
        $connectionsOnly = $this->person(['privacy_profile' => 'connections']);
        $this->note($connectionsOnly, $friend, true, 'From a connections-only member');
        $this->note($friend, $connectionsOnly, true, 'To a connections-only member');

        $this->signInAs($this->person());
        $response = $this->apiGet(self::URL)->assertOk();

        $response->assertJsonCount(0, 'data');
        $this->assertStringNotContainsString('connections-only', (string) $response->getContent());
    }

    public function test_another_communitys_notes_never_appear(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        DB::table('appreciations')->insert([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'tenant_id' => 999,
            'message' => 'Written in another community',
            'is_public' => 1,
            'reactions_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->signInAs($this->person());
        $response = $this->apiGet(self::URL)->assertOk();

        $response->assertJsonCount(0, 'data');
        $this->assertStringNotContainsString('Written in another community', (string) $response->getContent());
    }

    public function test_a_member_of_another_community_is_refused(): void
    {
        $this->note($this->person(), $this->person(), true, 'For this community only');
        $outsider = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
        Sanctum::actingAs($outsider, ['*']);
        TenantContext::setById($this->testTenantId);

        $response = $this->apiGet(self::URL);

        $this->assertNotSame(200, $response->getStatusCode());
        $this->assertStringNotContainsString('For this community only', (string) $response->getContent());
    }

    public function test_surnames_never_appear_in_the_payload_for_a_member(): void
    {
        $sender = $this->person(['first_name' => 'Aoife', 'last_name' => 'Zzsendersurname', 'name' => 'Aoife Zzsendersurname']);
        $receiver = $this->person(['first_name' => 'Brian', 'last_name' => 'Zzreceiversurname', 'name' => 'Brian Zzreceiversurname']);
        $this->note($sender, $receiver, true, 'Thanks for the lift');

        $this->signInAs($this->person());
        $response = $this->apiGet(self::URL)->assertOk();

        $response->assertJsonPath('data.0.sender.name', 'Aoife');
        $response->assertJsonPath('data.0.receiver.name', 'Brian');
        $response->assertJsonPath('data.0.message', 'Thanks for the lift');
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Zzsendersurname', $body);
        $this->assertStringNotContainsString('Zzreceiversurname', $body);
    }

    public function test_the_payload_carries_no_ranking_count_or_context(): void
    {
        $this->note($this->person(), $this->person(), true, 'A plain thank-you');
        $this->signInAs($this->person());

        $note = $this->apiGet(self::URL)->assertOk()->json('data.0');

        $this->assertSame(['created_at', 'id', 'message', 'receiver', 'sender'], $this->sortedKeys($note));
        $this->assertSame(['avatar_url', 'id', 'name'], $this->sortedKeys($note['sender']));
    }

    public function test_pages_follow_the_cursor_without_repeating_or_skipping(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $ids = [];
        for ($i = 0; $i < 5; $i++) {
            $ids[] = $this->note($sender, $receiver, true, "Note {$i}")->id;
        }
        $this->signInAs($this->person());

        $first = $this->apiGet(self::URL . '?per_page=3')->assertOk();
        $first->assertJsonPath('meta.has_more', true);
        $cursor = $first->json('meta.cursor');
        $this->assertIsString($cursor);
        $second = $this->apiGet(self::URL . '?per_page=3&cursor=' . urlencode($cursor))->assertOk();
        $second->assertJsonPath('meta.has_more', false);

        $seen = array_merge(array_column($first->json('data'), 'id'), array_column($second->json('data'), 'id'));
        $this->assertSame(array_reverse($ids), $seen);
    }

    /** @param array<string, bool> $overrides */
    private function setFeatures(array $overrides): void
    {
        $features = array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, $overrides);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
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

    private function note(User $sender, User $receiver, bool $shown, string $message): Appreciation
    {
        return Appreciation::create([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'tenant_id' => $this->testTenantId,
            'message' => $message,
            'is_public' => $shown,
            'reactions_count' => 0,
        ]);
    }

    private function block(User $blocker, User $blocked): void
    {
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $blocker->id,
            'blocked_user_id' => $blocked->id,
            'created_at' => now(),
        ]);
    }

    /**
     * @param array<string, mixed> $row
     * @return list<string>
     */
    private function sortedKeys(array $row): array
    {
        $keys = array_keys($row);
        sort($keys);

        return $keys;
    }
}
