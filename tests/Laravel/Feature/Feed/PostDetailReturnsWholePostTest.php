<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Feed;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A post's own page must return the whole post.
 *
 * 🔴 Reported by a member on 2026-08-24: "It won't let me read more." She was right, and the
 * cause was on the server, not in the app. `SocialController::showPost()` is implemented as
 * `FeedService::getFeed(['post_id' => …])`, so the post's own page inherited the LIST's
 * 500-character preview. Measured before the fix: an 872-character post came back from
 * `/api/v2/feed/posts/{id}` as **503 characters** with `content_truncated: true`. There was
 * no request any client could make that returned the rest of it.
 *
 * The list still truncates, deliberately — it is twenty items a page and the payload
 * matters. Both halves are asserted here, because fixing one by breaking the other would
 * pass a test that only checked the fix.
 */
class PostDetailReturnsWholePostTest extends TestCase
{
    use DatabaseTransactions;

    /** Longer than the 500-character list preview, so truncation is visible. */
    private const LONG_BODY_SENTENCE = 'This paragraph exists to carry the post past the five hundred character preview. ';

    private function makeUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * Posted through the API, the way a member posts.
     *
     * 🔴 Two earlier attempts wrote rows directly and proved nothing. `posts` turned out to
     * be the BLOG table (author_id, slug, excerpt, html_render). And a row inserted straight
     * into `feed_posts` never appeared in the feed at all, because the feed is assembled from
     * an activity record the insert did not create — the detail endpoint answered 404. Going
     * through the endpoint sidesteps both traps and exercises the real path.
     */
    private function makeLongPost(): array
    {
        $body = str_repeat(self::LONG_BODY_SENTENCE, 10) . 'And this is the final sentence, which a reader must be able to reach.';

        $response = $this->apiPost('/v2/feed/posts', [
            'content' => $body,
            'visibility' => 'public',
        ]);
        $response->assertStatus(201);

        return [(int) $response->json('data.id'), $body];
    }

    public function test_the_posts_own_page_returns_every_character(): void
    {
        $this->makeUser();
        [$postId, $body] = $this->makeLongPost();
        $this->assertGreaterThan(500, mb_strlen($body), 'the fixture must exceed the preview length or it proves nothing');

        $response = $this->apiGet("/v2/feed/posts/{$postId}");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertSame($body, $data['content'], 'the detail endpoint must return the post as written');
        $this->assertFalse((bool) ($data['content_truncated'] ?? false));
        // The specific symptom: the last sentence was unreachable.
        $this->assertStringContainsString('which a reader must be able to reach', $data['content']);
    }

    public function test_the_feed_list_still_sends_a_preview(): void
    {
        $this->makeUser();
        [, $body] = $this->makeLongPost();

        $response = $this->apiGet('/v2/feed?page=1&per_page=20');

        $response->assertStatus(200);
        $items = $response->json('data');
        $this->assertIsArray($items);

        $post = null;
        foreach ($items as $item) {
            if (($item['type'] ?? null) === 'post' && str_starts_with((string) ($item['content'] ?? ''), self::LONG_BODY_SENTENCE)) {
                $post = $item;
                break;
            }
        }

        $this->assertNotNull($post, 'the seeded post should appear in the feed list');
        // 🔴 The other half of the rule. A list of twenty full posts is a payload problem;
        // the preview is deliberate, and a fix that removed it would be a regression of its
        // own that a one-sided test would wave through.
        $this->assertTrue((bool) $post['content_truncated']);
        $this->assertLessThan(mb_strlen($body), mb_strlen($post['content']));
    }
}
