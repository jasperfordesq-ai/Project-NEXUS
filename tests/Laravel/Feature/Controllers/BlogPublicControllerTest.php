<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use App\Models\Post;
use App\Models\User;

/**
 * Feature tests for BlogPublicController — public blog list and detail.
 */
class BlogPublicControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function createPublishedPostWithDistinctiveMemberAuthor(string $slug): array
    {
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'PrivateAuthorGivenQxz',
            'last_name' => 'PrivateAuthorFamilyVjk',
            'email' => 'private-author-qxz@example.invalid',
            'avatar_url' => '/uploads/private-author-avatar-qxz.png',
            'status' => 'active',
            'is_approved' => true,
        ]);

        $post = Post::factory()->forTenant($this->testTenantId)->published()->create([
            'author_id' => $author->id,
            'title' => 'Public projection regression article',
            'slug' => $slug,
            'excerpt' => 'An editorial summary safe for anonymous readers.',
            'content' => 'Editorial content that contains no member account details.',
            'html_render' => '<p>Editorial content that contains no member account details.</p>',
            'featured_image' => '/uploads/blog/public-editorial-hero.png',
        ]);

        return [$author, $post];
    }

    private function assertMemberAuthorIsAbsent(array $projection, string $rawResponse): void
    {
        foreach (['author', 'author_id', 'user', 'user_id', 'member', 'member_id', 'profile_url', 'email', 'avatar', 'avatar_url'] as $key) {
            $this->assertArrayNotHasKey($key, $projection);
        }

        foreach (['PrivateAuthorGivenQxz', 'PrivateAuthorFamilyVjk', 'private-author-qxz@example.invalid', 'private-author-avatar-qxz.png'] as $privateValue) {
            $this->assertStringNotContainsString($privateValue, $rawResponse);
        }
    }

    // ------------------------------------------------------------------
    //  GET /v2/blog
    // ------------------------------------------------------------------

    public function test_anonymous_blog_index_returns_editorial_content_without_member_author_identity(): void
    {
        [, $post] = $this->createPublishedPostWithDistinctiveMemberAuthor('public-projection-index-regression');

        $response = $this->apiGet('/v2/blog?search=Public%20projection%20regression');

        $response->assertStatus(200);
        $response->assertJsonPath('data.0.slug', $post->slug);

        $projection = $response->json('data.0');
        $this->assertIsArray($projection);
        $this->assertMemberAuthorIsAbsent($projection, (string) $response->getContent());
    }

    // ------------------------------------------------------------------
    //  GET /v2/blog/categories
    // ------------------------------------------------------------------

    public function test_anonymous_blog_categories_returns_data(): void
    {
        $response = $this->apiGet('/v2/blog/categories');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/blog/{slug}
    // ------------------------------------------------------------------

    public function test_anonymous_blog_detail_returns_editorial_content_without_member_author_identity(): void
    {
        [, $post] = $this->createPublishedPostWithDistinctiveMemberAuthor('public-projection-detail-regression');

        $response = $this->apiGet('/v2/blog/' . $post->slug);

        $response->assertStatus(200);
        $response->assertJsonPath('data.slug', $post->slug);
        $response->assertJsonPath('data.content', '<p>Editorial content that contains no member account details.</p>');

        $projection = $response->json('data');
        $this->assertIsArray($projection);
        $this->assertMemberAuthorIsAbsent($projection, (string) $response->getContent());
    }

    public function test_blog_dates_are_iso_8601_with_a_timezone(): void
    {
        // "2026-10-23 14:00:00" is not a valid schema.org / Open Graph date
        // (2026-10-23 SEO audit), and React Native may not parse it.
        [, $post] = $this->createPublishedPostWithDistinctiveMemberAuthor('public-projection-iso-dates');
        $iso = '#^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$#';

        $detail = $this->apiGet('/v2/blog/' . $post->slug)->assertStatus(200)->json('data');
        $this->assertMatchesRegularExpression($iso, (string) $detail['published_at']);
        $this->assertMatchesRegularExpression($iso, (string) $detail['created_at']);

        $index = $this->apiGet('/v2/blog?search=Public%20projection%20regression')->assertStatus(200)->json('data.0');
        $this->assertMatchesRegularExpression($iso, (string) $index['published_at']);
    }

    public function test_anonymous_blog_show_nonexistent_returns_404(): void
    {
        $response = $this->apiGet('/v2/blog/nonexistent-slug-xyz');

        $response->assertStatus(404);
    }
}
