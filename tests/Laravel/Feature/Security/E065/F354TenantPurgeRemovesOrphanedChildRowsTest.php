<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantProvisioning\TenantPurgeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-065 F-354 — a "permanent, irreversible" community purge must actually
 * remove the community's data.
 *
 * Before the fix, TenantPurgeService::purge() disabled referential integrity
 * for its delete pass (SET FOREIGN_KEY_CHECKS=0) and deleted only tables that
 * HAVE a tenant_id column. With FK checks off, ON DELETE CASCADE never fires,
 * so 24 tables were orphaned rather than removed — including private group chat
 * message bodies (group_chatroom_messages.body), AI chat content
 * (ai_messages.content) and user_legal_acceptances, which carries the member's
 * IP address, user agent and session id alongside the user_id of a member whose
 * users row had just been deleted.
 *
 * The owner's decision (30 September 2026) was to extend the purge so the
 * deletion matches the promise, "with tests proving it removes exactly the right
 * rows and nothing belonging to another community". Both halves are asserted
 * here: every test purges ONE community while a second, identically-seeded
 * community stands beside it and must come through untouched.
 */
class F354TenantPurgeRemovesOrphanedChildRowsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        Cache::flush();
        SuperPanelAccess::reset();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_purging_a_community_removes_its_private_messages_ai_chat_and_legal_acceptances(): void
    {
        $victimTenantId = $this->tenant();
        $victim = $this->memberIn($victimTenantId);
        $fixture = $this->seedChildContent($victimTenantId, (int) $victim->id);

        $this->assertDatabaseHas('group_chatroom_messages', ['id' => $fixture['message_id']]);
        $this->assertDatabaseHas('ai_messages', ['id' => $fixture['ai_message_id']]);
        $this->assertDatabaseHas('user_legal_acceptances', ['id' => $fixture['acceptance_id']]);

        $report = TenantPurgeService::purge($victimTenantId, ['dry_run' => false]);
        $this->assertTrue($report['success'] ?? false, 'The purge did not run: ' . ($report['error'] ?? 'unknown'));

        // The tenant-scoped parents go, as they always did.
        $this->assertDatabaseMissing('tenants', ['id' => $victimTenantId]);
        $this->assertDatabaseMissing('users', ['id' => $victim->id]);
        $this->assertDatabaseMissing('group_chatrooms', ['id' => $fixture['chatroom_id']]);
        $this->assertDatabaseMissing('ai_conversations', ['id' => $fixture['conversation_id']]);
        $this->assertDatabaseMissing('legal_documents', ['id' => $fixture['document_id']]);

        // F-354: and now so do the children that have no tenant_id column.
        $this->assertDatabaseMissing('group_chatroom_messages', ['id' => $fixture['message_id']]);
        $this->assertDatabaseMissing('ai_messages', ['id' => $fixture['ai_message_id']]);
        $this->assertDatabaseMissing('user_legal_acceptances', ['id' => $fixture['acceptance_id']]);
        $this->assertDatabaseMissing('legal_document_versions', ['id' => $fixture['version_id']]);
        $this->assertDatabaseMissing('review_responses', ['id' => $fixture['review_response_id']]);
        $this->assertDatabaseMissing('challenge_ideas', ['id' => $fixture['idea_id']]);
    }

    public function test_a_second_level_child_goes_too(): void
    {
        $victimTenantId = $this->tenant();
        $victim = $this->memberIn($victimTenantId);
        $fixture = $this->seedChildContent($victimTenantId, (int) $victim->id);

        $report = TenantPurgeService::purge($victimTenantId, ['dry_run' => false]);
        $this->assertTrue($report['success'] ?? false, 'The purge did not run: ' . ($report['error'] ?? 'unknown'));

        // challenge_idea_comments has no tenant_id and its only foreign key is to
        // challenge_ideas, which itself has no tenant_id. It is reachable only by
        // deleting the first-level child with referential integrity ON.
        $this->assertDatabaseMissing('challenge_idea_comments', ['id' => $fixture['idea_comment_id']]);
    }

    public function test_the_purge_touches_nothing_belonging_to_another_community(): void
    {
        $victimTenantId = $this->tenant();
        $victim = $this->memberIn($victimTenantId);
        $victimFixture = $this->seedChildContent($victimTenantId, (int) $victim->id);

        // An identically-seeded community standing beside the one being purged.
        $bystanderTenantId = $this->tenant();
        $bystander = $this->memberIn($bystanderTenantId);
        $bystanderFixture = $this->seedChildContent($bystanderTenantId, (int) $bystander->id);

        $report = TenantPurgeService::purge($victimTenantId, ['dry_run' => false]);
        $this->assertTrue($report['success'] ?? false, 'The purge did not run: ' . ($report['error'] ?? 'unknown'));

        // The victim's rows are gone…
        $this->assertDatabaseMissing('group_chatroom_messages', ['id' => $victimFixture['message_id']]);
        $this->assertDatabaseMissing('ai_messages', ['id' => $victimFixture['ai_message_id']]);
        $this->assertDatabaseMissing('user_legal_acceptances', ['id' => $victimFixture['acceptance_id']]);

        // …and every single one of the bystander's is still there, byte for byte.
        $this->assertDatabaseHas('tenants', ['id' => $bystanderTenantId]);
        $this->assertDatabaseHas('users', ['id' => $bystander->id]);
        $this->assertSame(
            $bystanderFixture['message_body'],
            DB::table('group_chatroom_messages')->where('id', $bystanderFixture['message_id'])->value('body'),
            "F-354: another community's private group chat message was destroyed by this purge"
        );
        $this->assertSame(
            $bystanderFixture['ai_content'],
            DB::table('ai_messages')->where('id', $bystanderFixture['ai_message_id'])->value('content'),
            "F-354: another community's AI chat content was destroyed by this purge"
        );
        foreach ([
            'user_legal_acceptances' => $bystanderFixture['acceptance_id'],
            'legal_document_versions' => $bystanderFixture['version_id'],
            'review_responses' => $bystanderFixture['review_response_id'],
            'review_votes' => $bystanderFixture['review_vote_id'],
            'challenge_ideas' => $bystanderFixture['idea_id'],
            'challenge_idea_comments' => $bystanderFixture['idea_comment_id'],
            'group_chatrooms' => $bystanderFixture['chatroom_id'],
            'ai_conversations' => $bystanderFixture['conversation_id'],
            'legal_documents' => $bystanderFixture['document_id'],
            'reviews' => $bystanderFixture['review_id'],
            'ideation_challenges' => $bystanderFixture['challenge_id'],
            'groups' => $bystanderFixture['group_id'],
        ] as $table => $id) {
            $this->assertDatabaseHas($table, ['id' => $id]);
        }

        // Tidy the bystander away the same way the purge would.
        TenantPurgeService::purge($bystanderTenantId, ['dry_run' => false]);
    }

    public function test_control_a_dry_run_still_deletes_nothing(): void
    {
        $tenantId = $this->tenant();
        $member = $this->memberIn($tenantId);
        $fixture = $this->seedChildContent($tenantId, (int) $member->id);

        $report = TenantPurgeService::purge($tenantId, ['dry_run' => true]);
        $this->assertTrue($report['success'] ?? false);
        $this->assertTrue($report['dry_run']);

        $this->assertDatabaseHas('tenants', ['id' => $tenantId]);
        $this->assertDatabaseHas('users', ['id' => $member->id]);
        $this->assertDatabaseHas('group_chatroom_messages', ['id' => $fixture['message_id']]);
        $this->assertDatabaseHas('ai_messages', ['id' => $fixture['ai_message_id']]);
        $this->assertDatabaseHas('user_legal_acceptances', ['id' => $fixture['acceptance_id']]);

        TenantPurgeService::purge($tenantId, ['dry_run' => false]);
    }

    // ---------------------------------------------------------------- helpers

    /** @return array<string,mixed> */
    private function seedChildContent(int $tenantId, int $userId): array
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $userId,
            'name' => 'E065 F-354 synthetic group',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $chatroomId = (int) DB::table('group_chatrooms')->insertGetId([
            'group_id' => $groupId,
            'tenant_id' => $tenantId,
            'name' => 'E065 F-354 room',
            'created_by' => $userId,
            'created_at' => now(),
        ]);

        $messageBody = 'E065 F-354 synthetic private message ' . bin2hex(random_bytes(4));
        $messageId = (int) DB::table('group_chatroom_messages')->insertGetId([
            'chatroom_id' => $chatroomId,
            'user_id' => $userId,
            'body' => $messageBody,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $conversationId = (int) DB::table('ai_conversations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $aiContent = 'E065 F-354 synthetic AI chat content ' . bin2hex(random_bytes(4));
        $aiMessageId = (int) DB::table('ai_messages')->insertGetId([
            'conversation_id' => $conversationId,
            'role' => 'user',
            'content' => $aiContent,
            'created_at' => now(),
        ]);

        $documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $tenantId,
            'document_type' => 'terms',
            'title' => 'E065 F-354 terms',
            'slug' => 'e066ef354-terms-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '1.0',
            'content' => 'E065 F-354 synthetic terms text.',
            'effective_date' => now()->toDateString(),
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $acceptanceId = (int) DB::table('user_legal_acceptances')->insertGetId([
            'user_id' => $userId,
            'document_id' => $documentId,
            'version_id' => $versionId,
            'version_number' => '1.0',
            'accepted_at' => now(),
            'ip_address' => '203.0.113.77',
            'user_agent' => 'E066E-F354-synthetic-agent',
        ]);

        $reviewId = (int) DB::table('reviews')->insertGetId([
            'tenant_id' => $tenantId,
            'receiver_id' => $userId,
            'rating' => 5,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $reviewResponseId = (int) DB::table('review_responses')->insertGetId([
            'review_id' => $reviewId,
            'responder_id' => $userId,
            'response' => 'E065 F-354 synthetic review response.',
            'created_at' => now(),
        ]);

        $reviewVoteId = (int) DB::table('review_votes')->insertGetId([
            'review_id' => $reviewId,
            'user_id' => $userId,
            'created_at' => now(),
        ]);

        $challengeId = (int) DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'title' => 'E065 F-354 challenge',
            'description' => 'E065 F-354 synthetic challenge description.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ideaId = (int) DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => $userId,
            'title' => 'E065 F-354 idea',
            'description' => 'E065 F-354 synthetic idea description.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ideaCommentId = (int) DB::table('challenge_idea_comments')->insertGetId([
            'idea_id' => $ideaId,
            'user_id' => $userId,
            'body' => 'E065 F-354 synthetic idea comment.',
            'created_at' => now(),
        ]);

        return [
            'group_id' => $groupId,
            'chatroom_id' => $chatroomId,
            'message_id' => $messageId,
            'message_body' => $messageBody,
            'conversation_id' => $conversationId,
            'ai_message_id' => $aiMessageId,
            'ai_content' => $aiContent,
            'document_id' => $documentId,
            'version_id' => $versionId,
            'acceptance_id' => $acceptanceId,
            'review_id' => $reviewId,
            'review_response_id' => $reviewResponseId,
            'review_vote_id' => $reviewVoteId,
            'challenge_id' => $challengeId,
            'idea_id' => $ideaId,
            'idea_comment_id' => $ideaCommentId,
        ];
    }

    /** @param array<string,mixed> $overrides */
    private function tenant(array $overrides = []): int
    {
        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'E065 F-354 synthetic community',
            'slug' => 'e066ef354' . bin2hex(random_bytes(5)),
            'parent_id' => null,
            'is_active' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function memberIn(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
