<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * /llms.txt and /llms-full.txt are public, need no sign-in, and are routed to
 * AI crawlers by nginx.
 *
 * F-601 (security register, 23 Oct 2026): from 12 May 2026 the full file
 * listed each community's 30 newest active member listings — title, type,
 * link and the first 160 characters of the description — although listings
 * are member-only everywhere else. Nothing member-authored may appear here.
 */
class LlmsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private string $host;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->host = 'llms-' . uniqid() . '.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => $this->host,
            'is_active' => 1,
        ]);
    }

    public function test_the_full_file_lists_no_member_listing(): void
    {
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'title' => 'Secret member listing ' . uniqid(),
            'description' => 'My phone number is 087 000 0000, call me any time.',
            'status' => 'active',
            'expires_at' => null,
        ]);

        $response = $this->withHeaders(['X-Sitemap-Host' => $this->host])->get('/llms-full.txt');

        $response->assertOk();
        $body = $response->getContent();
        $this->assertStringNotContainsString($listing->title, $body);
        $this->assertStringNotContainsString('087 000 0000', $body);
        $this->assertStringNotContainsString('/listings/' . $listing->id, $body);
        $this->assertStringNotContainsString('Recent listings', $body);
    }

    public function test_the_full_file_still_serves_the_public_summary(): void
    {
        $response = $this->withHeaders(['X-Sitemap-Host' => $this->host])->get('/llms-full.txt');

        $response->assertOk();
        $response->assertHeader('X-Robots-Tag', 'noindex');
        $this->assertStringContainsString('## Recent blog posts', $response->getContent());
    }

    public function test_the_short_file_lists_no_member_listing(): void
    {
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'title' => 'Another member listing ' . uniqid(),
            'status' => 'active',
            'expires_at' => null,
        ]);

        $response = $this->withHeaders(['X-Sitemap-Host' => $this->host])->get('/llms.txt');

        $response->assertOk();
        $this->assertStringNotContainsString($listing->title, $response->getContent());
    }
}
