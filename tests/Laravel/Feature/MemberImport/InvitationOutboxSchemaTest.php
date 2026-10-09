<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * The durable queue of welcome invitations (sent at a steady pace by a
 * scheduled command) and the marker for background map lookups.
 */
final class InvitationOutboxSchemaTest extends TestCase
{
    use DatabaseTransactions;

    private const REQUEST_KEY = '22222222-2222-4222-8222-222222222222';

    public function test_the_outbox_table_has_every_column_the_sender_relies_on(): void
    {
        $this->assertTrue(Schema::hasTable('member_invitation_outbox'));

        foreach ([
            'id', 'tenant_id', 'user_id', 'request_key', 'source', 'requested_by', 'status',
            'skip_reason', 'attempts', 'available_at', 'claim_token', 'claimed_at',
            'last_error', 'sent_at', 'created_at', 'updated_at',
        ] as $column) {
            $this->assertTrue(
                Schema::hasColumn('member_invitation_outbox', $column),
                "member_invitation_outbox.{$column} is missing"
            );
        }
    }

    public function test_a_new_row_defaults_to_pending_with_no_attempts(): void
    {
        $userId = $this->member();
        $this->queue($userId);

        $row = DB::table('member_invitation_outbox')->where('user_id', $userId)->first();
        $this->assertSame('pending', $row->status);
        $this->assertSame(0, (int) $row->attempts);
        $this->assertNull($row->sent_at);
        $this->assertNull($row->claim_token);
    }

    public function test_the_same_member_cannot_be_queued_twice_for_one_request(): void
    {
        $userId = $this->member();
        $this->queue($userId);

        try {
            $this->queue($userId);
            $this->fail('A duplicate (tenant, user, request) row was accepted');
        } catch (QueryException $e) {
            $this->assertSame(1062, (int) ($e->errorInfo[1] ?? 0));
        }
    }

    public function test_the_same_member_can_be_queued_for_a_different_request(): void
    {
        $userId = $this->member();
        $this->queue($userId);
        $this->queue($userId, '33333333-3333-4333-8333-333333333333');

        $this->assertSame(2, DB::table('member_invitation_outbox')->where('user_id', $userId)->count());
    }

    public function test_deleting_a_member_removes_their_pending_invitation(): void
    {
        $userId = $this->member();
        $this->queue($userId);

        DB::table('users')->where('id', $userId)->delete();

        $this->assertSame(0, DB::table('member_invitation_outbox')->where('user_id', $userId)->count());
    }

    public function test_users_carry_a_nullable_geocode_attempt_marker(): void
    {
        $this->assertTrue(Schema::hasColumn('users', 'geocode_attempted_at'));

        $userId = $this->member();
        $this->assertNull(DB::table('users')->where('id', $userId)->value('geocode_attempted_at'));

        DB::table('users')->where('id', $userId)->update(['geocode_attempted_at' => now()]);
        $this->assertNotNull(DB::table('users')->where('id', $userId)->value('geocode_attempted_at'));
    }

    private function member(): int
    {
        return User::factory()->forTenant($this->testTenantId)->create()->id;
    }

    private function queue(int $userId, string $requestKey = self::REQUEST_KEY): void
    {
        DB::table('member_invitation_outbox')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'request_key' => $requestKey,
            'source' => 'import',
            'available_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
