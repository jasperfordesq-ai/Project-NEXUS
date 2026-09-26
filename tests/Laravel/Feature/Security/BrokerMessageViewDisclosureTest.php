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
