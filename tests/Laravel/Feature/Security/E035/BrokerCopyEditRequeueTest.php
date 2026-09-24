<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-163 — broker review could be bypassed by editing. The broker copy
 * was taken once at send time; a later edit (allowed for 24 hours) left the
 * copy holding the original, already-reviewed text, so the broker queue never
 * saw what the recipient actually reads. An edit must refresh the copy with
 * the new text and put it back in the unreviewed queue.
 */
class BrokerCopyEditRequeueTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->app->instance('tenant.id', $this->testTenantId);
    }

    /** @return array{0: User, 1: User, 2: int, 3: int} sender, recipient, message id, copy id */
    private function reviewedCopy(string $body = 'E035 ORIGINAL harmless text'): array
    {
        TenantContext::setById($this->testTenantId);
        $t = $this->testTenantId;
        $a = User::factory()->forTenant($t)->create(['status' => 'active', 'is_approved' => true]);
        $b = User::factory()->forTenant($t)->create(['status' => 'active', 'is_approved' => true]);
        $reviewer = User::factory()->forTenant($t)->admin()->create(['status' => 'active', 'is_approved' => true]);

        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id'   => $t,
            'sender_id'   => $a->id,
            'receiver_id' => $b->id,
            'body'        => $body,
            'is_read'     => 0,
            'created_at'  => now()->subMinutes(5),
        ]);

        $ids = [(int) $a->id, (int) $b->id];
        sort($ids);
        $copyId = (int) DB::table('broker_message_copies')->insertGetId([
            'tenant_id'           => $t,
            'original_message_id' => $messageId,
            'conversation_key'    => md5(implode('-', $ids)),
            'sender_id'           => $a->id,
            'receiver_id'         => $b->id,
            'message_body'        => $body,
            'sent_at'             => now()->subMinutes(5),
            'copy_reason'         => 'flagged_user',
            'reviewed_by'         => $reviewer->id,
            'reviewed_at'         => now()->subMinute(),
            'review_notes'        => 'looks fine',
            'created_at'          => now()->subMinutes(5),
        ]);

        return [$a, $b, $messageId, $copyId];
    }

    public function test_edit_after_review_requeues_the_copy_with_the_new_text(): void
    {
        [$a, , $messageId, $copyId] = $this->reviewedCopy();

        $result = MessageService::editMessage($messageId, (int) $a->id, 'E035 EDITED text the broker never reviewed');
        $this->assertNotNull($result, json_encode(MessageService::getErrors()));

        $copy = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame('E035 EDITED text the broker never reviewed', $copy->message_body);
        $this->assertNull($copy->reviewed_at, 'An edited message must go back to the unreviewed queue.');
        $this->assertNull($copy->reviewed_by);

        $this->assertSame(1, DB::table('broker_message_copies')
            ->where('tenant_id', $this->testTenantId)
            ->where('original_message_id', $messageId)
            ->count());
    }

    public function test_edit_after_approval_clears_the_archive_link_so_it_can_be_decided_again(): void
    {
        [$a, $b, $messageId, $copyId] = $this->reviewedCopy();

        $archiveId = (int) DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $a->id,
            'sender_name'            => 'A',
            'receiver_id'            => $b->id,
            'receiver_name'          => 'B',
            'copy_reason'            => 'flagged_user',
            'target_message_body'    => 'E035 ORIGINAL harmless text',
            'target_message_sent_at' => now()->subMinutes(5),
            'conversation_snapshot'  => '[]',
            'decision'               => 'approved',
            'decided_by'             => $a->id,
            'decided_by_name'        => 'Reviewer',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);
        DB::table('broker_message_copies')->where('id', $copyId)
            ->update(['archived_at' => now(), 'archive_id' => $archiveId]);

        MessageService::editMessage($messageId, (int) $a->id, 'E035 edited after approval');

        $copy = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame('E035 edited after approval', $copy->message_body);
        $this->assertNull($copy->reviewed_at);
        $this->assertNull($copy->archived_at);
        $this->assertNull($copy->archive_id);
        // The archive of the original decision is history and stays.
        $this->assertSame(
            'E035 ORIGINAL harmless text',
            DB::table('broker_review_archives')->where('id', $archiveId)->value('target_message_body')
        );
    }

    public function test_broker_queue_lists_the_edited_text_as_unreviewed(): void
    {
        [$a, , $messageId] = $this->reviewedCopy();

        MessageService::editMessage($messageId, (int) $a->id, 'E035 EDITED queue text');

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($admin, ['*']);
        $list = $this->apiGet('/v2/admin/broker/messages?filter=unreviewed&per_page=100');
        $list->assertStatus(200);

        $item = collect($list->json('data') ?? [])->firstWhere('original_message_id', $messageId);
        $this->assertNotNull($item, 'Edited message must reappear in the unreviewed broker queue.');
        $this->assertSame('E035 EDITED queue text', $item['message_body']);

        // The broker detail view must mark the thread message as edited, so a
        // reviewer can tell it changed after it was first seen.
        $detail = $this->apiGet('/v2/admin/broker/messages/' . $item['id']);
        $detail->assertStatus(200);
        $threadMessage = collect($detail->json('data.thread') ?? [])->firstWhere('id', $messageId);
        $this->assertNotNull($threadMessage, 'Edited message must appear in the broker thread view.');
        $this->assertSame(1, (int) ($threadMessage['is_edited'] ?? 0), 'Broker thread must flag the message as edited.');
    }

    public function test_edit_of_a_message_without_a_copy_creates_nothing(): void
    {
        TenantContext::setById($this->testTenantId);
        $a = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $b = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $a->id, 'receiver_id' => $b->id,
            'body' => 'plain', 'is_read' => 0, 'created_at' => now()->subMinutes(2),
        ]);

        $this->assertNotNull(MessageService::editMessage($messageId, (int) $a->id, 'plain edited'));
        $this->assertSame(0, DB::table('broker_message_copies')->where('original_message_id', $messageId)->count());
    }
}
