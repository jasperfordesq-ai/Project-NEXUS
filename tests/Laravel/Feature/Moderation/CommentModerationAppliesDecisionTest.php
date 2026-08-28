<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Moderation;

use App\Models\ContentModerationQueue;
use App\Models\User;
use App\Services\ContentModerationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Moderating a reported COMMENT must actually change the comment.
 *
 * 🔴 The defect this pins, found 2026-08-28. `applyDecision()` wrote
 * `comments.is_hidden`, a column that does not exist — `feed_posts` has both
 * `is_hidden` and `deleted_at`, `comments` has only `deleted_at`. Every comment
 * decision therefore threw, `catch (\Throwable)` swallowed it, and the queue row
 * was still marked reviewed. An admin rejecting a reported comment got a success
 * response while the comment stayed visible to every member.
 *
 * It survived because the existing unit tests mock the database wholesale, so
 * they assert the call was made rather than that anything changed. These tests
 * therefore read the row back.
 */
class CommentModerationAppliesDecisionTest extends TestCase
{
    use DatabaseTransactions;

    public function test_rejecting_a_comment_removes_it_from_every_read_path(): void
    {
        $admin = $this->admin();
        $commentId = $this->comment();

        self::assertNull(
            DB::table('comments')->where('id', $commentId)->value('deleted_at'),
            'precondition: the comment starts visible',
        );

        $queueId = $this->queued($commentId);

        $result = ContentModerationService::review(
            $queueId,
            $this->testTenantId,
            $admin->id,
            'rejected',
            'Abusive language',
        );

        self::assertTrue((bool) ($result['success'] ?? false), 'the decision must report success');
        self::assertNotNull(
            DB::table('comments')->where('id', $commentId)->value('deleted_at'),
            'a rejected comment must be withdrawn — deleted_at IS NULL is what every read path tests.',
        );
    }

    public function test_approving_a_withdrawn_comment_restores_it(): void
    {
        $admin = $this->admin();
        $commentId = $this->comment();

        DB::table('comments')->where('id', $commentId)->update(['deleted_at' => now()]);
        $queueId = $this->queued($commentId);

        ContentModerationService::review(
            $queueId,
            $this->testTenantId,
            $admin->id,
            'approved',
            null,
        );

        self::assertNull(
            DB::table('comments')->where('id', $commentId)->value('deleted_at'),
            'an approved comment must become visible again',
        );
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function comment(): int
    {
        $author = User::factory()->forTenant($this->testTenantId)->create();

        return (int) DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'target_type' => 'post',
            'target_id' => 1,
            'content' => 'Reported comment under moderation',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function queued(int $commentId): int
    {
        return (int) ContentModerationQueue::create([
            'tenant_id' => $this->testTenantId,
            'content_type' => 'comment',
            'content_id' => $commentId,
            'status' => ContentModerationService::STATUS_PENDING,
        ])->id;
    }
}
