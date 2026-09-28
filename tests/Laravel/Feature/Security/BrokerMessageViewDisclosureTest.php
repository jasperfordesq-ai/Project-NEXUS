<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-212: opening a broker message copy shows only the context needed to review
 * it, and every opening is recorded.
 *
 * `showMessage()` used to return the first 200 messages the two members had
 * ever exchanged — including everything written AFTER the copied message, which
 * was never copied or flagged — and wrote nothing to the audit log (only
 * review/approve/flag decisions were logged).
 */
class BrokerMessageViewDisclosureTest extends TestCase
{
    use DatabaseTransactions;

    private function message(int $from, int $to, string $body, \DateTimeInterface $at): int
    {
        return DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $from,
            'receiver_id' => $to,
            'body' => $body,
            'is_read' => false,
            'created_at' => $at,
        ]);
    }

    /** @return array{0: User, 1: int} */
    private function scenario(): array
    {
        $broker = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();

        $this->message($a->id, $b->id, 'earlier context', now()->subHours(3));
        $copied = $this->message($a->id, $b->id, 'the copied message', now()->subHours(2));
        $this->message($b->id, $a->id, 'a later private reply', now()->subHour());

        $copyId = DB::table('broker_message_copies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'original_message_id' => $copied,
            'sender_id' => $a->id,
            'receiver_id' => $b->id,
            'message_body' => 'the copied message',
            'sent_at' => now()->subHours(2),
            'copy_reason' => 'first_contact',
            'flagged' => false,
            'archive_id' => null,
            'conversation_key' => 'f212-' . uniqid(),
            'created_at' => now()->subHours(2),
        ]);

        return [$broker, $copyId];
    }

    public function test_the_thread_stops_at_the_copied_message(): void
    {
        [$broker, $copyId] = $this->scenario();
        Sanctum::actingAs($broker);

        $bodies = collect($this->apiGet("/v2/admin/broker/messages/{$copyId}")->assertOk()->json('data.thread'))
            ->pluck('body')->all();

        $this->assertContains('earlier context', $bodies);
        $this->assertContains('the copied message', $bodies);
        $this->assertNotContains('a later private reply', $bodies);
    }

    public function test_archive_uses_the_review_boundary_and_filters_older_oversized_snapshots(): void
    {
        [$broker, $copyId] = $this->scenario();
        Sanctum::actingAs($broker);
        $copy = DB::table('broker_message_copies')->find($copyId);
        $sameSecond = $this->message($copy->sender_id, $copy->receiver_id, 'later same second', new \DateTimeImmutable($copy->sent_at));
        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve")->assertOk();
        $archiveId = $response->json('data.archive_id');
        $stored = json_decode(DB::table('broker_review_archives')->where('id', $archiveId)->value('conversation_snapshot'), true);
        $this->assertSame(['earlier context', 'the copied message'], array_column($stored, 'body'));
        $stored[] = ['id' => $sameSecond, 'body' => 'later same second'];
        DB::table('broker_review_archives')->where('id', $archiveId)->update(['conversation_snapshot' => json_encode($stored)]);
        $shown = $this->apiGet("/v2/admin/broker/archives/{$archiveId}")->assertOk()->json('data.conversation_snapshot');
        $this->assertSame(['earlier context', 'the copied message'], array_column($shown, 'body'));
        DB::table('messages')->where('id', $copy->original_message_id)->update(['is_deleted' => true]);
        $shown = $this->apiGet("/v2/admin/broker/archives/{$archiveId}")->assertOk()->json('data.conversation_snapshot');
        $this->assertSame(['earlier context', '[Message deleted]'], array_column($shown, 'body'));
    }

    public function test_group_review_and_archive_exclude_direct_history_and_cap_context(): void
    {
        [$broker, $copyId] = $this->scenario();
        Sanctum::actingAs($broker);
        $copy = DB::table('broker_message_copies')->find($copyId);
        $conversation = DB::table('conversations')->insertGetId(['tenant_id' => $this->testTenantId,
            'is_group' => true, 'group_name' => 'Synthetic group', 'created_by' => $copy->sender_id,
            'created_at' => now(), 'updated_at' => now()]);
        DB::table('messages')->where('id', $copy->original_message_id)->update(['conversation_id' => $conversation]);
        for ($i = 0; $i < 55; $i++) {
            $message = $this->message($copy->sender_id, $copy->receiver_id, 'group-' . $i, now()->subHours(3)->addSeconds($i));
            DB::table('messages')->where('id', $message)->update(['conversation_id' => $conversation, 'is_deleted' => $i === 54]);
        }
        $view = $this->apiGet("/v2/admin/broker/messages/{$copyId}")->assertOk()->json('data.thread');
        $this->assertCount(50, $view);
        $this->assertNotContains('earlier context', array_column($view, 'body'));
        $this->assertNotContains('group-54', array_column($view, 'body'));
        $archiveId = $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve")->assertOk()->json('data.archive_id');
        $stored = json_decode(DB::table('broker_review_archives')->where('id', $archiveId)->value('conversation_snapshot'), true);
        $this->assertSame($view, $stored);
    }

    public function test_opening_a_copy_is_written_to_the_audit_log(): void
    {
        [$broker, $copyId] = $this->scenario();
        Sanctum::actingAs($broker);

        $this->apiGet("/v2/admin/broker/messages/{$copyId}")->assertOk();

        $this->assertTrue(
            DB::table('org_audit_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $broker->id)
                ->where('action', 'broker_message_viewed')
                ->exists(),
        );
    }
}
