<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Seo;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The super-admin "404 Tracking" page has something to show (2026-10-23 SEO
 * audit). Until then nothing wrote to error_404_log. Now the app's "Page not
 * found" screen reports the address to /v2/seo/not-found, anonymously.
 */
class NotFoundTrackingTest extends TestCase
{
    use DatabaseTransactions;

    private string $host;

    protected function setUp(): void
    {
        parent::setUp();
        $this->host = 'notfound-' . uniqid() . '.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => $this->host, 'is_active' => 1]);
    }

    private function report(string $host, array $body)
    {
        return $this->postJson('http://' . $host . '/api/v2/seo/not-found', $body, [
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);
    }

    private function row(string $url): ?object
    {
        return DB::table('error_404_log')->where('url', $url)->first();
    }

    public function test_a_missing_page_is_recorded_once_and_counted_after_that(): void
    {
        $url = 'https://' . $this->host . '/no-such-page';

        $this->report($this->host, ['path' => '/no-such-page?utm=x', 'referrer' => 'https://example.org/post?id=5'])
            ->assertOk()->assertJsonPath('data.recorded', true);
        $this->report($this->host, ['path' => '/no-such-page'])->assertOk();

        $row = $this->row($url);
        $this->assertNotNull($row);
        $this->assertSame(2, (int) $row->hit_count);
        $this->assertSame('https://example.org/post', $row->referer, 'the referrer is kept without its query string');
        $this->assertNull($row->ip_address, 'no IP address is stored');
        $this->assertNull($row->user_id, 'no account is stored');
    }

    public function test_an_unknown_host_or_unsafe_path_is_not_recorded(): void
    {
        // Refused before or by the endpoint; either way nothing is stored.
        $this->assertNotTrue($this->report('evil.example', ['path' => '/spam'])->json('data.recorded'));
        $this->assertNull($this->row('https://evil.example/spam'));

        foreach (['', 'no-slash', '/a/../b', "/a\nb", '/' . str_repeat('x', 600)] as $bad) {
            $this->report($this->host, ['path' => $bad])->assertJsonPath('data.recorded', false);
        }
        $this->assertSame(0, DB::table('error_404_log')->where('url', 'like', 'https://' . $this->host . '%')->count());
    }
}
