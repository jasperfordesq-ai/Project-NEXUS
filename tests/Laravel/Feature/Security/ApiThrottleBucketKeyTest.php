<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

/**
 * The `api` middleware group carries `throttle:api`, which is the ONLY
 * request-rate ceiling on the large majority of API routes — the named
 * `nexus-route-*` policies cover a minority of them.
 *
 * Its bucket key is built partly from `X-Tenant-ID` / `X-Tenant-Slug`, which
 * the client sends and the platform does not require to be a real community
 * (an unrecognised slug is served rather than refused). A key that moves with
 * a client-supplied header is not a ceiling: the caller mints a fresh budget
 * per value.
 *
 * `RouteServiceProvider::routeRateLimits()` already defends against exactly
 * this for the named tiers, keying on the RESOLVED tenant and adding an IP-wide
 * ceiling documented as "intentionally IP-wide so tenant/domain hopping cannot
 * multiply that tier's allowance".
 *
 * 🔴 These tests require the FIRST half of that defence and deliberately NOT the
 * second. A flat per-IP ceiling across the whole `api` group would throttle the
 * accessible frontend rather than an attacker: `web-uk` calls this API
 * server-side and does not forward the visitor's address, so all eleven
 * communities reach Laravel from one address. See the comment beside the
 * limiter. Do not add such a test, or such a limit, without reading it.
 */
class ApiThrottleBucketKeyTest extends TestCase
{
    /**
     * @return array<int, Limit>
     */
    private function limitsFor(?string $slug, string $ip = '203.0.113.10'): array
    {
        $limiter = RateLimiter::limiter('api');
        self::assertIsCallable($limiter, 'The `api` rate limiter must be registered.');

        $server = ['REMOTE_ADDR' => $ip];
        if ($slug !== null) {
            $server['HTTP_X_TENANT_SLUG'] = $slug;
        }

        $request = Request::create('/api/v2/blog/categories', 'GET', [], [], [], $server);

        $limits = $limiter($request);

        return is_array($limits) ? $limits : [$limits];
    }

    /**
     * @param array<int, Limit> $limits
     * @return array<int, string>
     */
    private function keys(array $limits): array
    {
        return array_map(static fn (Limit $l): string => (string) $l->key, $limits);
    }

    public function test_an_unrecognised_tenant_header_cannot_mint_a_fresh_budget(): void
    {
        $a = $this->keys($this->limitsFor('zzz-not-a-community-a'));
        $b = $this->keys($this->limitsFor('zzz-not-a-community-b'));

        $shared = array_intersect($a, $b);

        self::assertNotEmpty(
            $shared,
            'Two requests from the SAME IP carrying different X-Tenant-Slug values share no '
            . 'rate-limit bucket at all, so varying that header multiplies the allowance without '
            . "limit.\n  slug A keys: " . implode(', ', $a)
            . "\n  slug B keys: " . implode(', ', $b)
        );
    }

    public function test_omitting_the_tenant_header_does_not_create_another_budget(): void
    {
        $withHeader = $this->keys($this->limitsFor('zzz-not-a-community-c'));
        $noHeader = $this->keys($this->limitsFor(null));

        self::assertNotEmpty(
            array_intersect($withHeader, $noHeader),
            'Omitting X-Tenant-Slug yields a disjoint set of buckets, which is another free budget.'
        );
    }

    public function test_the_bucket_follows_the_resolved_community_not_the_header(): void
    {
        // The two tests above would also pass if the key merely stopped varying,
        // because with no tenant middleware in front of them everything resolves
        // to "unresolved". This one pins the actual property: with a community
        // genuinely resolved, the bucket must be the same however the caller
        // spells the header — and must still differ between real communities, so
        // the fix has not simply collapsed every community into one bucket.
        try {
            TenantContext::setById(2);
            $viaSlug = $this->keys($this->limitsFor('hour-timebank'));
            $viaJunk = $this->keys($this->limitsFor('zzz-not-a-community'));
            $viaNone = $this->keys($this->limitsFor(null));

            TenantContext::setById(1);
            $otherCommunity = $this->keys($this->limitsFor('hour-timebank'));
        } finally {
            TenantContext::reset();
        }

        self::assertSame($viaSlug, $viaJunk, 'The header still moves the bucket for one community.');
        self::assertSame($viaSlug, $viaNone, 'Omitting the header still moves the bucket.');
        self::assertEmpty(
            array_intersect($viaSlug, $otherCommunity),
            'Two genuinely different communities now share a bucket, which would let traffic in one '
            . 'community exhaust the ceiling for another.'
        );
    }

    public function test_different_callers_are_still_kept_in_separate_buckets(): void
    {
        // Control: the fix must not collapse every caller into one global bucket,
        // which would let one abusive IP deny service to everyone else.
        $one = $this->keys($this->limitsFor('zzz-not-a-community-d', '203.0.113.10'));
        $two = $this->keys($this->limitsFor('zzz-not-a-community-d', '198.51.100.20'));

        self::assertEmpty(
            array_intersect($one, $two),
            'Two different IPs share a bucket; one caller can then exhaust the ceiling for everybody.'
        );
    }
}
