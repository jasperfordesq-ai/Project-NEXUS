<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Models\User;
use App\Services\CronJobRunner;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A user erased under GDPR keeps their row — the erasure routine rewrites
 * users.email to deleted_<id>_<hash>@anonymized.local and stamps deleted_at
 * and anonymized_at (see GdprService / UserService::deleteAccount).
 *
 * Those rows were still being returned by the notification digest's recipient
 * query, so every run treated an erased person as somebody to email, claimed
 * their queued items, and produced a hard bounce on a domain that can never
 * receive mail. The send guard in EmailDispatchService is the backstop; this
 * pins the real fix, which is that they are never selected in the first place.
 */
class CronDigestAnonymisedRecipientTest extends TestCase
{
    use DatabaseTransactions;

    private function insertPendingDigestItem(int $userId): int
    {
        return (int) DB::table('notification_queue')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'activity_type' => 'digest_test',
            'content_snippet' => 'Digest item',
            'link' => '/notifications',
            'status' => 'pending',
            'frequency' => 'daily',
            'created_at' => now(),
        ]);
    }

    private function runDailyDigest(): void
    {
        $runner = new CronJobRunner();
        $method = new \ReflectionMethod(CronJobRunner::class, 'processDigest');
        $method->setAccessible(true);

        ob_start();
        try {
            $method->invoke($runner, 'daily');
        } finally {
            ob_end_clean();
        }
    }

    public function test_anonymised_user_is_not_selected_as_a_digest_recipient(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'live-' . uniqid('', true) . '@example.com',
            'status' => 'active',
            'notification_preferences' => json_encode(['email_digest' => true]),
        ]);

        $queueId = $this->insertPendingDigestItem((int) $user->id);

        // Erase the account exactly as GdprService does.
        DB::table('users')->where('id', $user->id)->update([
            'email' => 'deleted_' . $user->id . '_' . bin2hex(random_bytes(8)) . '@anonymized.local',
            'first_name' => 'Deleted',
            'last_name' => 'User',
            'status' => 'inactive',
            'deleted_at' => now(),
            'anonymized_at' => now(),
        ]);

        $this->runDailyDigest();

        $row = DB::table('notification_queue')->where('id', $queueId)->first();

        $this->assertNotNull($row);
        $this->assertSame(
            'pending',
            $row->status,
            'An erased account must not be picked up as a recipient at all — not claimed, not attempted, not failed.'
        );
        $this->assertSame(0, (int) $row->attempts, 'No delivery attempt should have been spent on an erased account.');
        $this->assertNull($row->processing_batch_id);
    }

    public function test_deleted_at_alone_is_enough_to_exclude_a_recipient(): void
    {
        // UserService::deleteAccount stamps deleted_at + anonymized_at, but an
        // older soft-delete may carry deleted_at only. Either mark excludes.
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'softdeleted-' . uniqid('', true) . '@example.com',
            'status' => 'active',
            'notification_preferences' => json_encode(['email_digest' => true]),
        ]);

        $queueId = $this->insertPendingDigestItem((int) $user->id);

        DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]);

        $this->runDailyDigest();

        $row = DB::table('notification_queue')->where('id', $queueId)->first();

        $this->assertSame('pending', $row->status);
        $this->assertSame(0, (int) $row->attempts);
    }

    public function test_a_live_member_is_still_selected_as_a_digest_recipient(): void
    {
        // The control: without this, a query that excluded everybody would pass
        // both tests above.
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'active-' . uniqid('', true) . '@example.com',
            'status' => 'active',
            'notification_preferences' => json_encode(['email_digest' => true]),
        ]);

        $queueId = $this->insertPendingDigestItem((int) $user->id);

        $this->runDailyDigest();

        $row = DB::table('notification_queue')->where('id', $queueId)->first();

        // attempts, not status: no SMTP server is reachable in the test
        // environment, so the send fails and processDigest puts the row back to
        // 'pending'. The attempt counter is what proves the member was selected
        // and their batch claimed.
        $this->assertGreaterThan(
            0,
            (int) $row->attempts,
            'A live member must still be selected and have their digest batch claimed.'
        );
    }

    public function test_cleanup_clears_queue_rows_left_by_an_already_erased_account(): void
    {
        // Because the runners skip erased accounts, their rows never reach a
        // terminal status on their own. Erasure now deletes them at source;
        // this sweep covers accounts erased before that change.
        $erased = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'erased-' . uniqid('', true) . '@example.com',
            'status' => 'active',
        ]);
        $live = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'live-' . uniqid('', true) . '@example.com',
            'status' => 'active',
        ]);

        $erasedRow = $this->insertPendingDigestItem((int) $erased->id);
        $liveRow = $this->insertPendingDigestItem((int) $live->id);

        DB::table('users')->where('id', $erased->id)->update([
            'deleted_at' => now(),
            'anonymized_at' => now(),
        ]);

        $runner = new CronJobRunner();
        $method = new \ReflectionMethod(CronJobRunner::class, 'cleanupInternal');
        $method->setAccessible(true);

        ob_start();
        try {
            $method->invoke($runner);
        } finally {
            ob_end_clean();
        }

        $this->assertDatabaseMissing('notification_queue', ['id' => $erasedRow]);

        // The control: a live member's pending item must survive untouched.
        $this->assertDatabaseHas('notification_queue', ['id' => $liveRow, 'status' => 'pending']);
    }
}
