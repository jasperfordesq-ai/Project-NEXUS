<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SeoService;
use Illuminate\Support\Facades\DB;

class SeoServiceTest extends TestCase
{
    private SeoService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SeoService();
    }

    // ── getMetadata ──

    public function test_getMetadata_returns_defaults_when_not_found(): void
    {
        // Build a mock query builder that returns null
        $builder = \Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $builder->shouldReceive('where')->andReturnSelf();
        $builder->shouldReceive('whereNull')->andReturnSelf();
        $builder->shouldReceive('first')->andReturnNull();
        DB::shouldReceive('table')->with('seo_metadata')->andReturn($builder);

        $result = $this->service->getMetadata($this->testTenantId, 'global');
        $this->assertNull($result['meta_title']);
        $this->assertNull($result['meta_description']);
        $this->assertNull($result['og_image_url']);
        $this->assertNull($result['canonical_url']);
    }

    public function test_getMetadata_returns_data_when_found(): void
    {
        $meta = (object) ['meta_title' => 'About Us', 'meta_description' => 'Our story', 'og_image_url' => null, 'canonical_url' => null];
        $builder = \Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $builder->shouldReceive('where')->andReturnSelf();
        $builder->shouldReceive('first')->andReturn($meta);
        DB::shouldReceive('table')->with('seo_metadata')->andReturn($builder);

        $result = $this->service->getMetadata($this->testTenantId, 'page', 1);
        $this->assertEquals('About Us', $result['meta_title']);
    }

    // ── updateMetadata ──

    public function test_updateMetadata_filters_allowed_fields(): void
    {
        DB::shouldReceive('table->updateOrInsert')->once()->andReturn(true);

        $result = $this->service->updateMetadata($this->testTenantId, 'page', 1, [
            'meta_title' => 'New Title',
            'malicious_field' => 'should be ignored',
        ]);
        $this->assertTrue($result);
    }

    // ── getRedirects ──

    public function test_getRedirects_returns_array(): void
    {
        DB::shouldReceive('table->where->orderBy->get->map->all')->andReturn([]);
        $result = $this->service->getRedirects($this->testTenantId);
        $this->assertIsArray($result);
    }

    // ── createRedirect ──

    /**
     * The database is mocked here, so the publisher (which checks the new
     * redirect against existing ones and writes markers) is stubbed: these
     * tests are about the status code only. Its own rules are pinned in
     * tests/Laravel/Feature/Seo/UrlRedirectsTest.php.
     */
    private function stubPublisher(?array $problem = null): void
    {
        $publisher = \Mockery::mock(\App\Services\SeoRedirectPublisher::class);
        $publisher->shouldReceive('validateNew')->andReturn($problem);
        $publisher->shouldReceive('publishTenant')->andReturnNull();
        $this->app->instance(\App\Services\SeoRedirectPublisher::class, $publisher);
    }

    public function test_createRedirect_defaults_invalid_status_to_301(): void
    {
        $this->stubPublisher();
        DB::shouldReceive('table->insertGetId')->once()->andReturn(1);

        $result = $this->service->createRedirect($this->testTenantId, '/old', '/new', 999);
        $this->assertEquals(1, $result);
    }

    public function test_createRedirect_accepts_301_and_302(): void
    {
        $this->stubPublisher();
        DB::shouldReceive('table->insertGetId')->twice()->andReturn(1, 2);

        $this->assertEquals(1, $this->service->createRedirect($this->testTenantId, '/a', '/b', 301));
        $this->assertEquals(2, $this->service->createRedirect($this->testTenantId, '/c', '/d', 302));
    }

    public function test_createRedirect_refuses_a_redirect_that_could_never_fire(): void
    {
        $this->stubPublisher(['field' => 'source_url', 'message' => 'x']);
        DB::shouldReceive('table->insertGetId')->never();

        $this->assertNull($this->service->createRedirect($this->testTenantId, '/a?b=1', '/c'));
    }
}
