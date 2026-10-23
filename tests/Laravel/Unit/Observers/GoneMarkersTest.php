<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Observers;

use App\Models\Page;
use App\Models\Post;
use App\Observers\PagePrerenderObserver;
use App\Observers\PostPrerenderObserver;
use App\Services\PrerenderService;
use App\Services\SeoGoneMarkers;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Removed content tells crawlers it is gone (410), 2026-10-23 SEO audit. The
 * observer leaves a marker that nginx reads (pinned on the nginx side by
 * scripts/test/test-prerender-nginx-runtime.sh); publishing again removes it.
 *
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class GoneMarkersTest extends TestCase
{
    private string $root;
    private SeoGoneMarkers $markers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir() . '/nexus-gone-' . uniqid();
        mkdir($this->root, 0775, true);
        $this->markers = new SeoGoneMarkers($this->root);
        $this->app->instance(SeoGoneMarkers::class, $this->markers);

        $prerender = Mockery::mock(PrerenderService::class);
        $prerender->shouldReceive('loadTenantTargets')->andReturn([
            ['tenant_id' => 2, 'slug' => 'hour-timebank', 'host' => 'hour-timebank.example', 'prefix' => ''],
            ['tenant_id' => 7, 'slug' => 'west', 'host' => 'hub.example', 'prefix' => '/west'],
        ]);
        $prerender->shouldReceive('invalidateRoutes')->andReturn(1);
        $this->app->instance(PrerenderService::class, $prerender);
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->root));
        parent::tearDown();
    }

    private function marker(string $hostPath): string
    {
        return $this->root . '/' . SeoGoneMarkers::DIR . '/' . $hostPath . '/' . SeoGoneMarkers::MARKER;
    }

    private function makePost(int $tenantId, string $slug, string $status): Post
    {
        $post = new Post();
        $post->id = 30;
        $post->tenant_id = $tenantId;
        $post->slug = $slug;
        $post->status = $status;
        $post->syncOriginal();
        return $post;
    }

    public function test_a_deleted_post_is_marked_gone_and_republishing_clears_it(): void
    {
        $post = $this->makePost(2, 'spring-fair', 'published');

        (new PostPrerenderObserver())->deleted($post);
        $this->assertFileExists($this->marker('hour-timebank.example/blog/spring-fair'));

        (new PostPrerenderObserver())->saved($post);
        $this->assertFileDoesNotExist($this->marker('hour-timebank.example/blog/spring-fair'));
    }

    public function test_unpublishing_marks_gone_and_a_rename_marks_the_old_address(): void
    {
        (new PostPrerenderObserver())->saved($this->makePost(2, 'draft-only', 'draft'));
        $this->assertFileExists($this->marker('hour-timebank.example/blog/draft-only'));

        $renamed = $this->makePost(2, 'old-name', 'published');
        $renamed->slug = 'new-name';
        $renamed->syncChanges();
        $renamed->syncOriginal();
        (new PostPrerenderObserver())->saved($renamed);
        $this->assertFileExists($this->marker('hour-timebank.example/blog/old-name'));
        $this->assertFileDoesNotExist($this->marker('hour-timebank.example/blog/new-name'));
    }

    public function test_a_folder_community_is_marked_inside_its_folder(): void
    {
        $page = new Page();
        $page->id = 5;
        $page->tenant_id = 7;
        $page->slug = 'opening-hours';
        $page->is_published = true;
        $page->syncOriginal();

        (new PagePrerenderObserver())->deleted($page);
        $this->assertFileExists($this->marker('hub.example/west/page/opening-hours'));
    }
}
