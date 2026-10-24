<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Services\SearchVerificationDns;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * GET /api/v2/admin/config/seo-verification-dns (2026-10-24).
 *
 * The SEO page warned "Google Search Console Verification — not configured"
 * whenever its verification box was empty, although most communities verify
 * through a DNS TXT record (hour-timebank.ie did, via Cloudflare). The server
 * now looks for that record so the page can say so.
 */
class SeoVerificationDnsTest extends TestCase
{
    use DatabaseTransactions;

    /** @var array<string, list<string>> host => TXT strings the fake resolver returns */
    private array $records = [];

    /** @var list<string> every host the fake resolver was asked about */
    private array $asked = [];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->app->instance(SearchVerificationDns::class, new SearchVerificationDns(function (string $host): array {
            $this->asked[] = $host;
            return $this->records[$host] ?? [];
        }));
        \Laravel\Sanctum\Sanctum::actingAs(\App\Models\User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    private function useOwnDomain(string $host): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => $host, 'is_active' => 1]);
    }

    public function test_finds_a_google_record_on_the_communitys_own_domain(): void
    {
        $host = 'verify-' . uniqid() . '.test';
        $this->useOwnDomain($host);
        $this->records[$host] = ['v=spf1 include:_spf.example ~all', 'google-site-verification=abc123'];

        $res = $this->apiGet('/v2/admin/config/seo-verification-dns')->assertOk();
        $res->assertJsonPath('data.applicable', true);
        $res->assertJsonPath('data.google_found', true);
        $res->assertJsonPath('data.google_found_on', $host);
    }

    public function test_a_domain_property_record_on_the_parent_domain_counts_for_a_subdomain(): void
    {
        $parent = 'verify-' . uniqid() . '.test';
        $this->useOwnDomain('www.' . $parent);
        $this->records[$parent] = ['google-site-verification=abc123'];

        $res = $this->apiGet('/v2/admin/config/seo-verification-dns')->assertOk();
        $res->assertJsonPath('data.google_found', true);
        $res->assertJsonPath('data.google_found_on', $parent);
    }

    public function test_reports_nothing_found_without_a_record(): void
    {
        $host = 'verify-' . uniqid() . '.test';
        $this->useOwnDomain($host);
        $this->records[$host] = ['v=spf1 -all', 'MS=ms12345'];

        $res = $this->apiGet('/v2/admin/config/seo-verification-dns')->assertOk();
        $res->assertJsonPath('data.applicable', true);
        $res->assertJsonPath('data.google_found', false);
        $res->assertJsonPath('data.google_found_on', null);
    }

    public function test_a_community_on_a_shared_address_is_not_checked(): void
    {
        // No domain of its own: it lives at <app host>/<slug>, whose DNS belongs
        // to the platform, so a record there says nothing about this community.
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => null]);
        $appHost = (string) parse_url((string) config('prerender.frontend_url', 'https://app.project-nexus.ie'), PHP_URL_HOST);
        $this->records[$appHost] = ['google-site-verification=platform'];

        $res = $this->apiGet('/v2/admin/config/seo-verification-dns')->assertOk();
        $res->assertJsonPath('data.applicable', false);
        $res->assertJsonPath('data.google_found', false);
        $this->assertSame([], $this->asked);
    }

    public function test_a_failing_resolver_reads_as_not_found_not_an_error(): void
    {
        $host = 'verify-' . uniqid() . '.test';
        $this->useOwnDomain($host);
        $this->app->instance(SearchVerificationDns::class, new SearchVerificationDns(function (): array {
            throw new \RuntimeException('resolver down');
        }));

        $res = $this->apiGet('/v2/admin/config/seo-verification-dns')->assertOk();
        $res->assertJsonPath('data.google_found', false);
    }

    public function test_members_cannot_use_it(): void
    {
        \Laravel\Sanctum\Sanctum::actingAs(\App\Models\User::factory()->forTenant($this->testTenantId)->create());
        $this->apiGet('/v2/admin/config/seo-verification-dns')->assertForbidden();
    }

    public function test_candidate_hosts_walk_up_to_the_registrable_part_and_refuse_junk(): void
    {
        $this->assertSame(['www.example.ie', 'example.ie'], SearchVerificationDns::candidateHosts('WWW.Example.ie.'));
        $this->assertSame(['example.ie'], SearchVerificationDns::candidateHosts('example.ie'));
        $this->assertSame([], SearchVerificationDns::candidateHosts('localhost'));
        $this->assertSame([], SearchVerificationDns::candidateHosts('127.0.0.1'));
        $this->assertSame([], SearchVerificationDns::candidateHosts('bad host;rm -rf'));
        $this->assertSame([], SearchVerificationDns::candidateHosts(''));
    }
}
