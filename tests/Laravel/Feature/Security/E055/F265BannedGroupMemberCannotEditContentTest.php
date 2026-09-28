<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-055 F-265 — a member banned from a group must not keep rewriting the feed
 * posts and comments they left in it; group Q&A already refuses them. An
 * active member keeps editing their own content.
 */
final class F265BannedGroupMemberCannotEditContentTest extends TestCase
{
    use DatabaseTransactions;

    private int $groupId;
    private User $author;
    private int $postId;
    private int $commentId;

    protected function setUp(): void
    {
        parent::setUp();

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['groups'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set('tab_feed', true);

        $owner = $this->u();
        $this->author = $this->u();
        TenantContext::setById($this->testTenantId);
        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId, 'owner_id' => (int) $owner->id, 'name' => 'F265 group ' . uniqid(),
            'description' => 'fixture', 'visibility' => 'private', 'status' => 'active', 'is_active' => true,
            'cached_member_count' => 2, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([[$owner, 'owner'], [$this->author, 'member']] as [$u, $r]) {
            DB::table('group_members')->insert(['tenant_id' => $this->testTenantId, 'group_id' => $this->groupId, 'user_id' => (int) $u->id,
                'status' => 'active', 'role' => $r, 'created_at' => now(), 'updated_at' => now()]);
        }

        Sanctum::actingAs($this->author, ['*']);
        $this->postId = (int) $this->apiPost('/v2/feed/posts', ['content' => 'F265 original group post', 'group_id' => $this->groupId])->assertCreated()->json('data.id');
        $this->commentId = (int) $this->apiPost('/v2/comments', ['target_type' => 'post', 'target_id' => $this->postId, 'content' => 'F265 original comment'])->assertCreated()->json('data.id');
    }

    private function u(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    public function test_banned_member_cannot_rewrite_group_post_or_comment(): void
    {
        DB::table('group_members')->where('group_id', $this->groupId)->where('user_id', $this->author->id)->update(['status' => 'banned']);
        Sanctum::actingAs($this->author, ['*']);

        $postEdit = $this->apiPut("/v2/feed/posts/{$this->postId}", ['content' => 'F265 REWRITTEN after ban']);
        $commentEdit = $this->apiPut("/v2/comments/{$this->commentId}", ['content' => 'F265 REWRITTEN comment after ban']);

        $this->assertGreaterThanOrEqual(400, $postEdit->status());
        $this->assertGreaterThanOrEqual(400, $commentEdit->status());
        $this->assertSame('F265 original group post', (string) DB::table('feed_posts')->where('id', $this->postId)->value('content'));
        $this->assertSame('F265 original comment', (string) DB::table('comments')->where('id', $this->commentId)->value('content'));
    }

    public function test_control_active_member_still_edits_own_group_post_and_comment(): void
    {
        Sanctum::actingAs($this->author, ['*']);

        $this->apiPut("/v2/feed/posts/{$this->postId}", ['content' => 'F265 edited by active member'])->assertOk();
        $this->apiPut("/v2/comments/{$this->commentId}", ['content' => 'F265 comment edited by active member'])->assertOk();

        $this->assertSame('F265 edited by active member', (string) DB::table('feed_posts')->where('id', $this->postId)->value('content'));
        $this->assertSame('F265 comment edited by active member', (string) DB::table('comments')->where('id', $this->commentId)->value('content'));
    }
}
