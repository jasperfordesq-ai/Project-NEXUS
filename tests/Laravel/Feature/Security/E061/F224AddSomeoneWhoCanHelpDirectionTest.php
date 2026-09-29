<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E061;

use App\Models\User;
use App\Services\SubAccountService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-224 — Settings → Linked accounts: "Add someone who can help" must make the
 * member pressing it the person BEING helped, and the person they name must
 * accept before any support takes effect.
 *
 * Until E-061 the React screen posted to the one request endpoint, which always
 * recorded the caller as the supporter (`parent_user_id`) and the named member
 * as the supported person (`child_user_id`) — the reverse of what the button and
 * the dialog said. The named member was then asked to hand over control of THEIR
 * account to the person who had just asked for help.
 *
 * The endpoint's original meaning is kept as the default (the accessible
 * frontend and the mobile app describe it correctly: "link an account you will
 * manage"). The React button now sends `requester_role: member`.
 */
class F224AddSomeoneWhoCanHelpDirectionTest extends TestCase
{
    use DatabaseTransactions;

    private const URI = '/v2/users/me/sub-accounts';

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function row(int $id): ?object
    {
        return DB::table('account_relationships')->where('id', $id)->first();
    }

    private function onlyRowBetween(User $a, User $b): object
    {
        $rows = DB::table('account_relationships')
            ->where('tenant_id', $this->testTenantId)
            ->where(function ($q) use ($a, $b) {
                $q->where(fn ($w) => $w->where('parent_user_id', $a->id)->where('child_user_id', $b->id))
                    ->orWhere(fn ($w) => $w->where('parent_user_id', $b->id)->where('child_user_id', $a->id));
            })
            ->get();
        $this->assertCount(1, $rows, 'exactly one relationship row should exist between the two members');

        return $rows->first();
    }

    public function test_add_someone_who_can_help_makes_the_presser_the_person_helped(): void
    {
        $asker = $this->member();
        $helper = $this->member();

        Sanctum::actingAs($asker, ['*']);
        $response = $this->apiPost(self::URI, [
            'email' => $helper->email,
            'relationship_type' => 'family',
            'requester_role' => 'member',
        ]);

        $response->assertStatus(201);
        $row = $this->onlyRowBetween($asker, $helper);
        $this->assertSame((int) $helper->id, (int) $row->parent_user_id, 'the named member is the helper');
        $this->assertSame((int) $asker->id, (int) $row->child_user_id, 'the member who pressed the button is the one helped');
        $this->assertSame('pending', $row->status, 'nothing takes effect until the named member accepts');
        $this->assertSame((int) $asker->id, (int) $row->requested_by_user_id);

        // The asker's own "People who can help you" list shows the request as
        // waiting on the other person, not on them.
        $parents = $this->apiGet('/v2/users/me/parent-accounts')->assertOk()->json('data');
        $mine = collect($parents)->firstWhere('relationship_id', (int) $row->id);
        $this->assertNotNull($mine);
        $this->assertFalse($mine['awaiting_your_response']);
    }

    public function test_the_named_helper_gets_nothing_until_they_accept_and_the_asker_cannot_accept_for_them(): void
    {
        $asker = $this->member();
        $helper = $this->member();

        Sanctum::actingAs($asker, ['*']);
        $this->apiPost(self::URI, [
            'email' => $helper->email,
            'requester_role' => 'member',
        ])->assertStatus(201);
        $row = $this->onlyRowBetween($asker, $helper);

        // The asker cannot approve their own request on the helper's behalf.
        $this->apiPut(self::URI . '/' . $row->id . '/approve')->assertStatus(422);
        $this->assertSame('pending', $this->row((int) $row->id)->status);

        // Before accepting, the named helper holds no power at all.
        $service = app(SubAccountService::class);
        $this->assertFalse($service->hasPermission((int) $helper->id, (int) $asker->id, 'can_view_activity'));
        Sanctum::actingAs($helper, ['*']);
        $this->apiGet(self::URI . '/' . $asker->id . '/activity')->assertStatus(403);

        // The helper sees the request as waiting on THEM, and is told about it.
        $children = $this->apiGet(self::URI)->assertOk()->json('data');
        $theirs = collect($children)->firstWhere('relationship_id', (int) $row->id);
        $this->assertNotNull($theirs);
        $this->assertTrue($theirs['awaiting_your_response']);
        $bell = DB::table('notifications')
            ->where('user_id', $helper->id)
            ->where('type', 'sub_account_request')
            ->value('message');
        $this->assertNotNull($bell, 'the named helper must be notified of the request');
        $this->assertStringContainsString('asked you to help with their account', (string) $bell);
        $this->assertStringNotContainsString('manage your account', (string) $bell);

        // Legitimate path: the named helper accepts, and only then can help.
        $this->apiPut(self::URI . '/' . $row->id . '/approve')->assertOk();
        $this->assertSame('active', $this->row((int) $row->id)->status);
        $this->assertTrue($service->hasPermission((int) $helper->id, (int) $asker->id, 'can_view_activity'));
        $this->assertStringContainsString(
            'can now help with your account',
            (string) DB::table('notifications')->where('user_id', $asker->id)->where('type', 'sub_account_approved')->value('message'),
        );
        $this->assertFalse(
            $service->hasPermission((int) $asker->id, (int) $helper->id, 'can_view_activity'),
            'the asker gains no power over the helper',
        );
    }

    public function test_the_existing_offer_to_help_flow_is_unchanged(): void
    {
        // web-uk and the mobile app post without requester_role and describe
        // this correctly as "link an account you will manage".
        $supporter = $this->member();
        $supported = $this->member();

        Sanctum::actingAs($supporter, ['*']);
        $this->apiPost(self::URI, ['email' => $supported->email])->assertStatus(201);
        $row = $this->onlyRowBetween($supporter, $supported);
        $this->assertSame((int) $supporter->id, (int) $row->parent_user_id);
        $this->assertSame((int) $supported->id, (int) $row->child_user_id);

        // The supporter cannot approve their own offer; the supported member must.
        $this->apiPut(self::URI . '/' . $row->id . '/approve')->assertStatus(422);
        $this->assertSame('pending', $this->row((int) $row->id)->status);

        Sanctum::actingAs($supported, ['*']);
        $parents = $this->apiGet('/v2/users/me/parent-accounts')->assertOk()->json('data');
        $this->assertTrue(collect($parents)->firstWhere('relationship_id', (int) $row->id)['awaiting_your_response']);
        $this->apiPut(self::URI . '/' . $row->id . '/approve')->assertOk();
        $this->assertSame('active', $this->row((int) $row->id)->status);
    }

    public function test_an_unknown_requester_role_is_refused(): void
    {
        $asker = $this->member();
        $other = $this->member();

        Sanctum::actingAs($asker, ['*']);
        $this->apiPost(self::URI, [
            'email' => $other->email,
            'requester_role' => 'admin',
        ])->assertStatus(400);

        $this->assertFalse(DB::table('account_relationships')
            ->whereIn('parent_user_id', [$asker->id, $other->id])
            ->whereIn('child_user_id', [$asker->id, $other->id])
            ->exists());
    }
}
