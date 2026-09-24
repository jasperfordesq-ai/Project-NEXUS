<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FeedService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-184 — the legacy POST /api/social/create-post wrote straight to feed_posts,
 * skipping the HTML sanitiser, the length limit, the spam check, the legal
 * acceptance gate and the group write rule that POST /api/v2/feed/posts applies.
 *
 * O-065 — a client-supplied image_url (with no uploaded file) was stored and
 * rendered to every reader, so any remote address could be embedded in a post.
 */
class LegacyCreatePostParityTest extends TestCase
{
    use DatabaseTransactions;

    private const OVERLAY = '<div class="fixed inset-0 z-[9999]" style="position:fixed">'
        . '<p class="text-2xl">Your session expired.</p></div>';

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        $this->enableFeatures(['feed']);
    }

    public function test_legacy_create_post_sanitises_member_html(): void
    {
        $this->actAs($this->member());

        $response = $this->apiPost('/social/create-post', ['content' => self::OVERLAY]);

        $response->assertStatus(200);
        $postId = (int) $response->json('data.post_id');
        $this->assertGreaterThan(0, $postId);
        $stored = (string) DB::table('feed_posts')->where('id', $postId)->value('content');
        $this->assertStringContainsString('Your session expired.', $stored);
        $this->assertStringNotContainsString('class=', $stored);
        $this->assertStringNotContainsString('style=', $stored);
    }

    public function test_legacy_create_post_enforces_the_length_limit(): void
    {
        $user = $this->member();
        $this->actAs($user);
        $before = DB::table('feed_posts')->where('user_id', $user->id)->count();

        $response = $this->apiPost('/social/create-post', [
            'content' => str_repeat('a', FeedService::MAX_POST_LENGTH + 1),
        ]);

        $this->assertSame(422, $response->status());
        $this->assertSame($before, DB::table('feed_posts')->where('user_id', $user->id)->count());
    }

    public function test_legacy_create_post_refuses_a_group_the_member_cannot_write_to(): void
    {
        $user = $this->member();
        $groupOwner = $this->member();
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $groupOwner->id,
            'name' => 'F-184 group ' . uniqid(),
            'description' => 'E035',
            'visibility' => 'public',
            'status' => 'archived',
            'created_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $this->actAs($user);

        $response = $this->apiPost('/social/create-post', ['content' => 'Into an archived group', 'group_id' => $groupId]);

        $this->assertContains($response->status(), [403, 422]);
        $this->assertSame(0, DB::table('feed_posts')->where('user_id', $user->id)->where('group_id', $groupId)->count());
    }

    public function test_client_image_url_is_not_stored_as_a_remote_address(): void
    {
        $user = $this->member();
        $this->actAs($user);

        $legacy = $this->apiPost('/social/create-post', [
            'content' => 'Legacy post with remote image',
            'image_url' => 'https://tracker.example.test/pixel.png',
        ]);
        $legacy->assertStatus(200);
        $v2 = $this->apiPost('/v2/feed/posts', [
            'content' => 'V2 post with remote image',
            'image_url' => 'https://tracker.example.test/pixel2.png',
        ]);
        $v2->assertStatus(201);

        $this->assertSame(0, DB::table('feed_posts')
            ->where('user_id', $user->id)
            ->where('image_url', 'like', '%tracker.example.test%')
            ->count());
        $this->assertSame(0, DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('image_url', 'like', '%tracker.example.test%')
            ->count());
    }

    public function test_platform_upload_path_is_still_accepted(): void
    {
        $user = $this->member();
        TenantContext::setById($this->testTenantId);

        $post = app(FeedService::class)->createPost($user->id, [
            'content' => 'Post with an uploaded image',
            'image_url' => '/uploads/posts/post_0123456789abcdef.png',
        ]);

        $this->assertInstanceOf(\App\Models\FeedPost::class, $post);
        $this->assertSame('/uploads/posts/post_0123456789abcdef.png', DB::table('feed_posts')->where('id', $post->id)->value('image_url'));
    }

    // ------------------------------------------------------------------

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user, ['*']);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /** @param list<string> $features */
    private function enableFeatures(array $features): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        foreach ($features as $feature) {
            $current[$feature] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::setById($this->testTenantId);
    }
}
