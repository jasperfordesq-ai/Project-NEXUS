<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GeocodingService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GeocodingServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->resetThrottle();
    }

    /**
     * The one-request-per-second throttle keeps its clock in a static, which
     * would otherwise leak between tests and add a real second to each one.
     */
    private function resetThrottle(): void
    {
        // Tolerate the property being absent so that a regression which removes
        // the throttle fails on the behavioural assertions below, rather than
        // erroring out here and hiding what actually broke.
        if (!property_exists(GeocodingService::class, 'lastRequestAt')) {
            return;
        }

        $property = new \ReflectionProperty(GeocodingService::class, 'lastRequestAt');
        $property->setAccessible(true);
        $property->setValue(null, null);
    }

    private function okResponse(array $body): \Illuminate\Http\Client\Response
    {
        return new \Illuminate\Http\Client\Response(
            new \GuzzleHttp\Psr7\Response(200, [], json_encode($body))
        );
    }

    // =========================================================================
    // geocode()
    // =========================================================================

    public function test_geocode_returns_null_for_empty_address(): void
    {
        $this->assertNull(GeocodingService::geocode(''));
        $this->assertNull(GeocodingService::geocode('   '));
    }

    public function test_geocode_returns_cached_result(): void
    {
        $cached = ['latitude' => 53.35, 'longitude' => -6.26];
        Cache::shouldReceive('get')->andReturn($cached);

        $result = GeocodingService::geocode('Dublin, Ireland');
        $this->assertEquals(53.35, $result['latitude']);
        $this->assertEquals(-6.26, $result['longitude']);
    }

    public function test_geocode_calls_nominatim_on_cache_miss(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')->once();

        Http::shouldReceive('withHeaders->timeout->get')->andReturn(
            $this->okResponse([['lat' => '53.35', 'lon' => '-6.26']])
        );

        $result = GeocodingService::geocode('Dublin, Ireland');
        $this->assertNotNull($result);
        $this->assertEqualsWithDelta(53.35, $result['latitude'], 0.01);
    }

    public function test_geocode_returns_null_on_empty_results(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put');

        Http::shouldReceive('withHeaders->timeout->get')->andReturn($this->okResponse([]));
        Log::shouldReceive('info')->once();

        $this->assertNull(GeocodingService::geocode('NonexistentPlace12345'));
    }

    public function test_geocode_returns_null_on_api_error(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put');

        Http::shouldReceive('withHeaders->timeout->get')->andReturn(
            new \Illuminate\Http\Client\Response(new \GuzzleHttp\Psr7\Response(500, [], ''))
        );
        Log::shouldReceive('warning')->once();

        $this->assertNull(GeocodingService::geocode('Dublin'));
    }

    public function test_geocode_returns_null_on_exception(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put');

        Http::shouldReceive('withHeaders->timeout->get')->andThrow(new \Exception('Network error'));
        Log::shouldReceive('error')->once();

        $this->assertNull(GeocodingService::geocode('Dublin'));
    }

    // =========================================================================
    // Remembering failures.
    //
    // The batch jobs select rows that have no coordinates, so an address the
    // provider cannot resolve is picked again on every run. Before these tests,
    // nothing cached a failed lookup, so those rows paid a fresh network round
    // trip — up to a full 10-second timeout each — every 30 minutes, for ever.
    // =========================================================================

    public function test_geocode_caches_an_unresolvable_address_for_a_full_day(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')
            ->once()
            ->with(\Mockery::type('string'), [], 86400);

        Http::shouldReceive('withHeaders->timeout->get')->andReturn($this->okResponse([]));
        Log::shouldReceive('info')->once();

        $this->assertNull(GeocodingService::geocode('Partner Demo'));
    }

    public function test_geocode_caches_a_timeout_only_briefly(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')
            ->once()
            ->with(\Mockery::type('string'), [], 900);

        Http::shouldReceive('withHeaders->timeout->get')
            ->andThrow(new \Exception('cURL error 28: Operation timed out'));
        Log::shouldReceive('error')->once();

        $this->assertNull(GeocodingService::geocode('Partner Demo'));
    }

    public function test_geocode_caches_a_server_error_only_briefly(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')
            ->once()
            ->with(\Mockery::type('string'), [], 900);

        Http::shouldReceive('withHeaders->timeout->get')->andReturn(
            new \Illuminate\Http\Client\Response(new \GuzzleHttp\Psr7\Response(503, [], ''))
        );
        Log::shouldReceive('warning')->once();

        $this->assertNull(GeocodingService::geocode('Dublin'));
    }

    public function test_geocode_answers_a_remembered_failure_without_calling_nominatim(): void
    {
        Cache::shouldReceive('get')->andReturn([]);
        Http::shouldReceive('withHeaders')->never();

        $this->assertNull(GeocodingService::geocode('Partner Demo'));
    }

    // =========================================================================
    // Rate limiting.
    //
    // Nominatim's usage policy allows one request per second from one source.
    // The batch loops used to sleep 100 ms between items — ten times the
    // permitted rate — which risks the platform's address being blocked.
    // =========================================================================

    public function test_consecutive_lookups_are_spaced_at_least_one_second_apart(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put');

        Http::shouldReceive('withHeaders->timeout->get')->andReturn(
            $this->okResponse([['lat' => '53.35', 'lon' => '-6.26']])
        );

        $start = microtime(true);
        GeocodingService::geocode('Dublin, Ireland');
        GeocodingService::geocode('Cork, Ireland');
        $elapsed = microtime(true) - $start;

        $this->assertGreaterThanOrEqual(
            0.95,
            $elapsed,
            'Two lookups must be at least a second apart to respect the Nominatim usage policy.'
        );
    }

    public function test_a_cached_address_is_not_slowed_by_the_rate_limit(): void
    {
        Cache::shouldReceive('get')->andReturn(['latitude' => 53.35, 'longitude' => -6.26]);
        Http::shouldReceive('withHeaders')->never();

        $start = microtime(true);
        for ($i = 0; $i < 5; $i++) {
            GeocodingService::geocode("Cached Place {$i}");
        }
        $elapsed = microtime(true) - $start;

        $this->assertLessThan(
            0.5,
            $elapsed,
            'Cached addresses make no request, so they must not pay the rate-limit delay.'
        );
    }

    // =========================================================================
    // updateUserCoordinates()
    // =========================================================================

    public function test_updateUserCoordinates_returns_false_for_empty_location(): void
    {
        $this->assertFalse(GeocodingService::updateUserCoordinates(1, null));
        $this->assertFalse(GeocodingService::updateUserCoordinates(1, ''));
    }

    public function test_updateUserCoordinates_returns_false_when_geocode_fails(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put');

        Http::shouldReceive('withHeaders->timeout->get')->andReturn($this->okResponse([]));
        Log::shouldReceive('info')->once();

        $this->assertFalse(GeocodingService::updateUserCoordinates(1, 'NonexistentPlace'));
    }

    // =========================================================================
    // updateListingCoordinates()
    // =========================================================================

    public function test_updateListingCoordinates_returns_false_for_empty_location(): void
    {
        $this->assertFalse(GeocodingService::updateListingCoordinates(1, null));
    }

    // =========================================================================
    // getStats()
    // =========================================================================

    public function test_getStats_returns_expected_structure(): void
    {
        DB::shouldReceive('selectOne')->andReturn(
            (object) ['cnt' => 50],
            (object) ['cnt' => 10],
            (object) ['cnt' => 30],
            (object) ['cnt' => 5],
        );

        $result = GeocodingService::getStats();
        $this->assertArrayHasKey('users_with_coords', $result);
        $this->assertArrayHasKey('users_without_coords', $result);
        $this->assertArrayHasKey('listings_with_coords', $result);
        $this->assertArrayHasKey('listings_without_coords', $result);
        $this->assertEquals(50, $result['users_with_coords']);
    }
}
