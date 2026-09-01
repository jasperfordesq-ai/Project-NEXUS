<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

/**
 * GeocodingService — geocodes addresses to lat/lng using OpenStreetMap Nominatim.
 *
 * Native Laravel implementation (replaces legacy wrapper).
 */
class GeocodingService
{
    private const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
    private const USER_AGENT = 'ProjectNEXUS/1.0 (https://project-nexus.ie)';
    private const CACHE_TTL = 86400; // 24 hours

    /**
     * A lookup the provider answered with "no such place" is cached for as long
     * as a successful one. Without this, an address Nominatim cannot resolve is
     * retried on every call for ever: the batch jobs below select rows that have
     * no coordinates, an unresolvable address never gains any, so the same rows
     * are picked again every 30 minutes and each one pays a fresh network round
     * trip (up to a full timeout).
     */
    private const FAILURE_CACHE_TTL = 86400; // 24 hours

    /**
     * A timeout or a 5xx is the provider having a bad moment, not a verdict on
     * the address, so it is remembered only long enough to stop us hammering a
     * service that is already struggling.
     */
    private const TRANSIENT_FAILURE_CACHE_TTL = 900; // 15 minutes

    /**
     * Nominatim's usage policy permits an absolute maximum of one request per
     * second from one source. Enforced here, at the only place that actually
     * calls out, rather than in each caller's loop — a cached address makes no
     * request and so must not be slowed down, and every caller is covered.
     */
    private const MIN_REQUEST_INTERVAL_US = 1_000_000;

    /** Wall-clock time of the last outbound Nominatim request in this process. */
    private static ?float $lastRequestAt = null;

    /** Cached marker meaning "we asked, and there is no answer for this address". */
    private const NO_RESULT = [];

    public function __construct()
    {
    }

    /**
     * Geocode an address string to latitude/longitude.
     *
     * @return array{latitude: float, longitude: float}|null
     */
    public static function geocode(string $address): ?array
    {
        $address = trim($address);
        if (empty($address)) {
            return null;
        }

        // Check cache first. An empty array is the remembered-failure marker, so
        // a known-bad address is answered from cache instead of over the network.
        $cacheKey = 'geocode:' . md5(strtolower($address));
        $cached = Cache::get($cacheKey);
        if (is_array($cached)) {
            return $cached === self::NO_RESULT ? null : $cached;
        }

        try {
            self::throttle();

            $response = Http::withHeaders([
                'User-Agent' => self::USER_AGENT,
            ])->timeout(10)->get(self::NOMINATIM_URL, [
                'q' => $address,
                'format' => 'json',
                'limit' => 1,
                'addressdetails' => 0,
            ]);

            if (!$response->successful()) {
                Log::warning('Geocoding API error', [
                    'address' => $address,
                    'status' => $response->status(),
                ]);
                Cache::put($cacheKey, self::NO_RESULT, self::TRANSIENT_FAILURE_CACHE_TTL);
                return null;
            }

            $results = $response->json();

            if (empty($results) || !isset($results[0]['lat'], $results[0]['lon'])) {
                Log::info('Geocoding returned no results', ['address' => $address]);
                Cache::put($cacheKey, self::NO_RESULT, self::FAILURE_CACHE_TTL);
                return null;
            }

            $coords = [
                'latitude' => (float) $results[0]['lat'],
                'longitude' => (float) $results[0]['lon'],
            ];

            Cache::put($cacheKey, $coords, self::CACHE_TTL);

            return $coords;
        } catch (\Throwable $e) {
            Log::error('Geocoding exception', [
                'address' => $address,
                'error' => $e->getMessage(),
            ]);
            Cache::put($cacheKey, self::NO_RESULT, self::TRANSIENT_FAILURE_CACHE_TTL);
            return null;
        }
    }

    /**
     * Hold the caller until at least one second has passed since this process
     * last called Nominatim.
     *
     * In a web request the static resets with the process, so a single user save
     * is never delayed; in the CLI batch jobs it persists across the loop, which
     * is exactly where the rate limit has to bite.
     */
    private static function throttle(): void
    {
        if (self::$lastRequestAt !== null) {
            $elapsedUs = (microtime(true) - self::$lastRequestAt) * 1_000_000;
            if ($elapsedUs < self::MIN_REQUEST_INTERVAL_US) {
                usleep((int) (self::MIN_REQUEST_INTERVAL_US - $elapsedUs));
            }
        }

        self::$lastRequestAt = microtime(true);
    }

    /**
     * Update coordinates for a user based on their location field.
     */
    public static function updateUserCoordinates(int $userId, ?string $location): bool
    {
        if (empty($location)) {
            return false;
        }

        $coords = static::geocode($location);
        if (!$coords) {
            return false;
        }

        $tenantId = TenantContext::getId();

        $affected = DB::update(
            "UPDATE users SET latitude = ?, longitude = ? WHERE id = ? AND tenant_id = ?",
            [$coords['latitude'], $coords['longitude'], $userId, $tenantId]
        );

        return $affected > 0;
    }

    /**
     * Update coordinates for a listing based on its location field.
     */
    public static function updateListingCoordinates(int $listingId, ?string $location): bool
    {
        if (empty($location)) {
            return false;
        }

        $coords = static::geocode($location);
        if (!$coords) {
            return false;
        }

        $tenantId = TenantContext::getId();

        $affected = DB::update(
            "UPDATE listings SET latitude = ?, longitude = ? WHERE id = ? AND tenant_id = ?",
            [$coords['latitude'], $coords['longitude'], $listingId, $tenantId]
        );

        return $affected > 0;
    }

    /**
     * Batch geocode users that have a location but no coordinates.
     *
     * @return array{processed: int, success: int, failed: int}
     */
    public static function batchGeocodeUsers(int $limit = 100): array
    {
        $tenantId = TenantContext::getId();

        $users = DB::select(
            "SELECT id, location FROM users
             WHERE tenant_id = ? AND location IS NOT NULL AND location != ''
             AND (latitude IS NULL OR longitude IS NULL)
             LIMIT ?",
            [$tenantId, $limit]
        );

        $success = 0;
        $failed = 0;

        foreach ($users as $user) {
            $coords = static::geocode($user->location);
            if ($coords) {
                DB::update(
                    "UPDATE users SET latitude = ?, longitude = ? WHERE id = ? AND tenant_id = ?",
                    [$coords['latitude'], $coords['longitude'], $user->id, $tenantId]
                );
                $success++;
            } else {
                $failed++;
            }
            // Rate limiting lives in geocode() so that cached addresses cost
            // nothing; this loop deliberately does not sleep.
        }

        return [
            'processed' => count($users),
            'success' => $success,
            'failed' => $failed,
        ];
    }

    /**
     * Batch geocode listings that have a location but no coordinates.
     *
     * @return array{processed: int, success: int, failed: int}
     */
    public static function batchGeocodeListings(int $limit = 100): array
    {
        $tenantId = TenantContext::getId();

        $listings = DB::select(
            "SELECT id, location FROM listings
             WHERE tenant_id = ? AND location IS NOT NULL AND location != ''
             AND (latitude IS NULL OR longitude IS NULL)
             LIMIT ?",
            [$tenantId, $limit]
        );

        $success = 0;
        $failed = 0;

        foreach ($listings as $listing) {
            $coords = static::geocode($listing->location);
            if ($coords) {
                DB::update(
                    "UPDATE listings SET latitude = ?, longitude = ? WHERE id = ? AND tenant_id = ?",
                    [$coords['latitude'], $coords['longitude'], $listing->id, $tenantId]
                );
                $success++;
            } else {
                $failed++;
            }
            // Rate limiting lives in geocode() so that cached addresses cost
            // nothing; this loop deliberately does not sleep.
        }

        return [
            'processed' => count($listings),
            'success' => $success,
            'failed' => $failed,
        ];
    }

    /**
     * Get geocoding statistics for the current tenant.
     *
     * @return array{users_with_coords: int, users_without_coords: int, listings_with_coords: int, listings_without_coords: int}
     */
    public static function getStats(): array
    {
        $tenantId = TenantContext::getId();

        $usersWithCoords = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL",
            [$tenantId]
        )->cnt;

        $usersWithoutCoords = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND location IS NOT NULL AND location != '' AND (latitude IS NULL OR longitude IS NULL)",
            [$tenantId]
        )->cnt;

        $listingsWithCoords = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL",
            [$tenantId]
        )->cnt;

        $listingsWithoutCoords = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND location IS NOT NULL AND location != '' AND (latitude IS NULL OR longitude IS NULL)",
            [$tenantId]
        )->cnt;

        return [
            'users_with_coords' => $usersWithCoords,
            'users_without_coords' => $usersWithoutCoords,
            'listings_with_coords' => $listingsWithCoords,
            'listings_without_coords' => $listingsWithoutCoords,
        ];
    }
}
