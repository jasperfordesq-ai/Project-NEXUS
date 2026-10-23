<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Observers;

use App\Models\Post;
use App\Observers\PostPrerenderObserver;
use App\Services\PrerenderService;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class PostPrerenderObserverTest extends TestCase
{
    /** @var \Mockery\MockInterface */
    private $prerenderMock;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prerenderMock = Mockery::mock(PrerenderService::class);
        $this->app->instance(PrerenderService::class, $this->prerenderMock);
    }

    // -------------------------------------------------------------------------
    // saved() — with slug
    // -------------------------------------------------------------------------

    public function test_saved_invalidates_blog_index_and_post_route(): void
    {
        $model = new Post();
        $model->id        = 10;
        $model->tenant_id = 2;
        $model->slug      = 'hello-world';

        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(2, Mockery::on(function (array $routes): bool {
                return in_array('/blog', $routes, true)
                    && in_array('/blog/hello-world', $routes, true);
            }), true);

        (new PostPrerenderObserver())->saved($model);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // saved() — no slug → only /blog
    // -------------------------------------------------------------------------

    public function test_saved_invalidates_only_blog_index_when_slug_absent(): void
    {
        $model = new Post();
        $model->id        = 11;
        $model->tenant_id = 2;
        // slug not set

        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(2, Mockery::on(function (array $routes): bool {
                return $routes === ['/blog'];
            }), true);

        (new PostPrerenderObserver())->saved($model);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // saved() — empty-string slug treated as absent
    // -------------------------------------------------------------------------

    public function test_saved_omits_post_route_when_slug_is_empty_string(): void
    {
        $model = new Post();
        $model->id        = 12;
        $model->tenant_id = 2;
        $model->slug      = '';

        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(2, Mockery::on(function (array $routes): bool {
                return $routes === ['/blog'];
            }), true);

        (new PostPrerenderObserver())->saved($model);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // deleted() — with slug
    // -------------------------------------------------------------------------

    public function test_deleted_invalidates_blog_index_and_post_route(): void
    {
        $model = new Post();
        $model->id        = 13;
        $model->tenant_id = 2;
        $model->slug      = 'my-post';

        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(2, Mockery::on(function (array $routes): bool {
                return in_array('/blog', $routes, true)
                    && in_array('/blog/my-post', $routes, true);
            }), true);

        (new PostPrerenderObserver())->deleted($model);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Guard: null tenant_id → service not called
    // -------------------------------------------------------------------------

    public function test_saved_skips_service_when_tenant_id_is_null(): void
    {
        $model = new Post();
        $model->id   = 14;
        $model->slug = 'some-post';

        $this->prerenderMock->shouldNotReceive('invalidateRoutes');

        (new PostPrerenderObserver())->saved($model);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Exception swallowing
    // -------------------------------------------------------------------------

    public function test_saved_logs_warning_and_does_not_rethrow_when_service_throws(): void
    {
        $model = new Post();
        $model->id        = 15;
        $model->tenant_id = 2;
        $model->slug      = 'boom-post';

        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->andThrow(new \RuntimeException('connection lost'));

        Log::shouldReceive('warning')
            ->once()
            ->with('Prerender invalidation failed', Mockery::type('array'));

        (new PostPrerenderObserver())->saved($model);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Route format verification
    // -------------------------------------------------------------------------

    public function test_saved_produces_correct_blog_detail_route_string(): void
    {
        $model = new Post();
        $model->id        = 20;
        $model->tenant_id = 2;
        $model->slug      = 'timebanking-101';

        $captured = null;
        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->andReturnUsing(function (int $tid, array $routes) use (&$captured) {
                $captured = $routes;
                return 1;
            });

        (new PostPrerenderObserver())->saved($model);

        $this->assertContains('/blog', $captured);
        $this->assertContains('/blog/timebanking-101', $captured);
    }

    // -------------------------------------------------------------------------
    // saved() — renamed slug: the old address's copy is deleted, not re-rendered
    // -------------------------------------------------------------------------

    public function test_saved_after_a_rename_deletes_the_old_address_without_rerendering_it(): void
    {
        $model = new Post();
        $model->id        = 14;
        $model->tenant_id = 2;
        $model->slug      = 'old-title';
        $model->syncOriginal();
        // What Eloquent does during an update: record changes, then sync.
        $model->slug = 'new-title';
        $model->syncChanges();
        $model->syncOriginal();

        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(2, Mockery::on(fn (array $r): bool => in_array('/blog/new-title', $r, true)), true);
        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(2, ['/blog/old-title'], false);

        (new PostPrerenderObserver())->saved($model);

        $this->assertTrue(true);
    }
}
