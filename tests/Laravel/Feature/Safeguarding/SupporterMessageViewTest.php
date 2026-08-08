<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Safeguarding;

use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * The read-only supporter message viewer (C2). The boundaries that matter:
 * reading leaves NO trace on the member's unread state; the member's own
 * deletions hold; every request writes one immutable audit row with a
 * purpose, and no purpose means no data; the grant is the tier object only;
 * a safeguarding restriction beats an active grant.
 */
class SupporterMessageViewTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function seedGrantedRelationship(User $supporter, User $supported): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode([
                'can_view_activity' => true,
                'can_view_messages' => false, // the boolean stays dead even while the TIER grants
                'tiers' => ['activity' => 'assist', 'listings' => 'none', 'credits' => 'none', 'messages' => 'assist'],
            ]),
            'status' => 'active',
            'approved_at' => now(),
            'message_access_granted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedMessage(int $senderId, int $receiverId, string $body, array $extra = []): int
    {
        // messages has no updated_at column (created_at only).
        return (int) DB::table('messages')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'body' => $body,
            'is_read' => 0,
            'created_at' => now(),
        ], $extra));
    }

    public function test_supporter_with_consented_grant_reads_the_thread_with_a_purpose(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);
        $this->seedMessage($partner->id, $supported->id, 'Hello from the partner');

        Sanctum::actingAs($supporter, ['*']);
        $response = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}?purpose=" . urlencode('Weekly wellbeing check'));

        $response->assertOk();
        $this->assertStringContainsString('Hello from the partner', $response->getContent());
    }

    /** 🔴 The unread leak: a supporter's visit must leave the member's read state untouched. */
    public function test_viewing_never_marks_the_members_messages_read(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);
        $messageId = $this->seedMessage($partner->id, $supported->id, 'Unread and must stay unread');

        Sanctum::actingAs($supporter, ['*']);
        $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}?purpose=check")->assertOk();

        $this->assertSame(0, (int) DB::table('messages')->where('id', $messageId)->value('is_read'),
            'The supporter view marked the member\'s message read — the exact observable leak this forbids.');
    }

    /** The member's own deletions hold: deleted-for-me stays invisible to the supporter. */
    public function test_member_deleted_messages_are_invisible_to_the_supporter(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);
        $this->seedMessage($partner->id, $supported->id, 'Visible message');
        $this->seedMessage($partner->id, $supported->id, 'Deleted by the member', ['is_deleted_receiver' => 1]);

        Sanctum::actingAs($supporter, ['*']);
        $response = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}?purpose=check");

        $response->assertOk();
        $this->assertStringContainsString('Visible message', $response->getContent());
        $this->assertStringNotContainsString('Deleted by the member', $response->getContent());
    }

    public function test_federated_messages_never_surface(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);
        $this->seedMessage($partner->id, $supported->id, 'Local message');
        $this->seedMessage($partner->id, $supported->id, 'Federated message', ['is_federated' => 1]);

        Sanctum::actingAs($supporter, ['*']);
        $response = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}?purpose=check");

        $response->assertOk();
        $this->assertStringNotContainsString('Federated message', $response->getContent());
    }

    public function test_no_purpose_means_422_and_no_data_and_no_audit_row(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);
        $this->seedMessage($partner->id, $supported->id, 'Secret without purpose');

        Sanctum::actingAs($supporter, ['*']);
        $response = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}");

        $response->assertStatus(422);
        $this->assertStringNotContainsString('Secret without purpose', $response->getContent());
        $this->assertSame(0, DB::table('supporter_message_view_audits')->where('supporter_user_id', $supporter->id)->count());
    }

    public function test_every_read_writes_one_immutable_audit_row(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $relationshipId = $this->seedGrantedRelationship($supporter, $supported);
        $this->seedMessage($partner->id, $supported->id, 'Audited');

        Sanctum::actingAs($supporter, ['*']);
        $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages?purpose=" . urlencode('list check'))->assertOk();
        $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}?purpose=" . urlencode('thread check'))->assertOk();

        $rows = DB::table('supporter_message_view_audits')
            ->where('relationship_id', $relationshipId)
            ->orderBy('id')
            ->get();
        $this->assertCount(2, $rows);
        $this->assertSame(['list', 'read'], $rows->pluck('action')->all());
        $this->assertSame('list check', $rows[0]->purpose);
        $this->assertSame($partner->id, (int) $rows[1]->partner_user_id);

        // Immutable: UPDATE and DELETE both refuse at the database layer.
        try {
            DB::table('supporter_message_view_audits')->where('id', $rows[0]->id)->update(['purpose' => 'rewritten']);
            $this->fail('The audit row accepted an UPDATE.');
        } catch (\Illuminate\Database\QueryException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }
        try {
            DB::table('supporter_message_view_audits')->where('id', $rows[0]->id)->delete();
            $this->fail('The audit row accepted a DELETE.');
        } catch (\Illuminate\Database\QueryException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }
    }

    /** The dead boolean alone grants NOTHING — the tier object is the only key. */
    public function test_historical_boolean_true_without_tier_is_refused(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        DB::table('account_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['can_view_activity' => true, 'can_view_messages' => true]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($supporter, ['*']);
        $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages?purpose=trap-check")->assertStatus(403);
    }

    public function test_unread_count_is_stripped_from_the_list(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);
        $this->seedMessage($partner->id, $supported->id, 'Creates a conversation');

        Sanctum::actingAs($supporter, ['*']);
        $response = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages?purpose=check");

        $response->assertOk();
        $conversations = $response->json('data.conversations');
        $this->assertNotEmpty($conversations);
        foreach ($conversations as $conversation) {
            // 🔴 Shape pin: each entry must be a flat conversation row, not the
            // paging envelope's items list. Without this, assertArrayNotHasKey
            // passes vacuously on a nested list (integer keys only) — which is
            // exactly how the envelope bug shipped past this test the first time.
            $this->assertArrayHasKey('partner_id', $conversation,
                'Each conversation must be a flat row with partner metadata.');
            $this->assertArrayHasKey('last_message', $conversation);
            $this->assertArrayNotHasKey('unread_count', $conversation,
                'Read-state is the member\'s private metadata.');
        }
    }

    public function test_conversation_cursor_paginates_beyond_twenty_rows(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);

        for ($i = 0; $i < 21; $i++) {
            $partner = $this->member();
            $this->seedMessage($partner->id, $supported->id, "Conversation {$i}");
        }

        Sanctum::actingAs($supporter, ['*']);
        $first = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages?purpose=check&limit=20");
        $first->assertOk()->assertJsonCount(20, 'data.conversations')->assertJsonPath('data.has_more', true);

        $cursor = $first->json('data.cursor');
        $this->assertNotEmpty($cursor);
        $second = $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages?purpose=check&limit=20&cursor=" . urlencode((string) $cursor));
        $second->assertOk()->assertJsonCount(1, 'data.conversations')->assertJsonPath('data.has_more', false);
    }

    public function test_a_safeguarding_restriction_beats_an_active_grant(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->with($supporter->id, $supported->id, $this->testTenantId, 'supporter_message_view')
            ->andThrow(new SafeguardingPolicyException('SAFEGUARDING_CONTACT_RESTRICTED', 'Contact restricted'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        Sanctum::actingAs($supporter, ['*']);
        $this->apiGet("/v2/users/me/sub-accounts/{$supported->id}/messages?purpose=check")->assertStatus(403);
    }

    public function test_there_is_no_write_route_under_the_viewer_prefix(): void
    {
        $supporter = $this->member();
        $supported = $this->member();
        $partner = $this->member();
        $this->seedGrantedRelationship($supporter, $supported);

        Sanctum::actingAs($supporter, ['*']);
        // POSTing a message through the viewer prefix must not exist (405/404),
        // and must certainly not create a message.
        $response = $this->apiPost("/v2/users/me/sub-accounts/{$supported->id}/messages/{$partner->id}", [
            'body' => 'A supporter must never speak as the member',
        ]);

        $this->assertContains($response->getStatusCode(), [404, 405]);
        $this->assertSame(0, DB::table('messages')->where('sender_id', $supported->id)->count());
    }
}
