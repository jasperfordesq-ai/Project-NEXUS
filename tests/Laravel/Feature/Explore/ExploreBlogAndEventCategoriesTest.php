<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Explore;

use App\Models\Event;
use App\Models\Post;
use App\Models\User;
use App\Services\ExploreService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * The Explore page's "From the Blog" section read `blog_posts`, a table nothing
 * writes to: the admin editor and the blog itself use `posts`. The section was
 * therefore always empty (found 10 Nov 2026, warmth plan W2). It now shows the
 * blog's own latest posts, under the blog's own visibility rules.
 *
 * Its posts and its upcoming events also carry their category, so an event or
 * a post wears the same colour on Explore as on the events and blog pages,
 * where the colour follows the category (AWID: "clear categories").
 */
class ExploreBlogAndEventCategoriesTest extends TestCase
{
    use DatabaseTransactions;

    private function invoke(string $method, mixed ...$args): mixed
    {
        $service = app(ExploreService::class);
        $reflection = new ReflectionMethod($service, $method);
        $reflection->setAccessible(true);

        return $reflection->invoke($service, ...$args);
    }

    private function category(string $type): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Explore colour category ' . uniqid(),
            'slug' => 'explore-colour-' . uniqid(),
            'type' => $type,
            'color' => 'green',
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function blogPost(string $status, ?int $categoryId = null): Post
    {
        $author = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        return Post::factory()->create([
            'tenant_id' => $this->testTenantId,
            'author_id' => $author->id,
            'title' => 'Our garden morning was a great success',
            'slug' => 'garden-morning-' . uniqid(),
            'excerpt' => 'Twelve members came to plant the new beds.',
            'content' => 'Twelve members came to plant the new beds at the community garden.',
            'status' => $status,
            'category_id' => $categoryId,
            'created_at' => now()->addMinute(), // newest, so first in the list
        ]);
    }

    public function test_the_blog_section_shows_the_blogs_own_published_posts(): void
    {
        $post = $this->blogPost('published');

        $rows = collect($this->invoke('getTrendingBlogPosts', $this->testTenantId));
        $row = $rows->firstWhere('id', $post->id);

        $this->assertNotNull($row, 'a published blog post appears in the Explore blog section');
        $this->assertSame($post->slug, $row['slug']);
        $this->assertSame('Our garden morning was a great success', $row['title']);
    }

    public function test_the_blog_section_never_shows_a_draft(): void
    {
        $draft = $this->blogPost('draft');

        $rows = collect($this->invoke('getTrendingBlogPosts', $this->testTenantId));

        $this->assertNull($rows->firstWhere('id', $draft->id));
    }

    public function test_a_blog_post_carries_its_category(): void
    {
        $categoryId = $this->category('blog');
        $post = $this->blogPost('published', $categoryId);

        $row = collect($this->invoke('getTrendingBlogPosts', $this->testTenantId))->firstWhere('id', $post->id);

        $this->assertNotNull($row);
        $this->assertSame($categoryId, $row['category']['id'] ?? null);
    }

    public function test_an_upcoming_event_carries_its_category(): void
    {
        $categoryId = $this->category('event');
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $event = Event::factory()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiser->id,
            'category_id' => $categoryId,
            'status' => 'active',
            'group_id' => null,
            'start_time' => now()->addMinutes(5), // soonest, so within the first eight
            'end_time' => now()->addHours(2),
        ]);

        $row = collect($this->invoke('getUpcomingEvents', $this->testTenantId))->firstWhere('id', $event->id);

        $this->assertNotNull($row, 'the soonest event is among the upcoming ones');
        $this->assertSame($categoryId, $row['category_id']);
    }
}
