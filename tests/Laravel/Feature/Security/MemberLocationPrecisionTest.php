<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ListingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-082 (E-027) — a member's precise latitude/longitude (often their home,
 * picked from an address search) was returned to every other member: on the
 * profile, in the directory, by nearby search (with an exact distance from any
 * point the caller chose, so it could be trilaterated) and on every listing,
 * because a listing without its own location copies the profile's.
 *
 * Other members now see coordinates rounded to 2 decimal places (~1 km); the
 * owner and administrators still see the exact values, and nothing stored
 * changes.
 */
class MemberLocationPrecisionTest extends TestCase
{
    use DatabaseTransactions;

    private float $lat;
    private float $lon;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // Open ocean, nudged per run. The random part moves only in whole
        // hundredths, so the digits past the second decimal are always the
        // fixed offset: rounding to 2 decimals always moves the point by
        // ~0.0035°. A random part at five decimals could cancel the offset
        // (-110 + 0.09633 + 0.00368 = -109.89999), leaving the exact and
        // rounded values 0.00001 apart and the test failing at random.
        $this->lat = round(-46.0 + (mt_rand(10, 900) / 100) + 0.00347, 5);
        $this->lon = round(-110.0 + (mt_rand(10, 900) / 100) + 0.00368, 5);
    }

    // ------------------------------------------------------------------
    //  Profile
    // ------------------------------------------------------------------

    public function test_profile_coordinates_are_rounded_for_other_members(): void
    {
        $owner = $this->memberAtHome();
        Sanctum::actingAs($this->member(), ['*']);

        $data = $this->apiGet("/v2/users/{$owner->id}")->assertStatus(200)->json('data');

        $this->assertRounded($data['latitude'], $this->lat);
        $this->assertRounded($data['longitude'], $this->lon);
    }

    public function test_owner_and_admin_still_see_exact_profile_coordinates(): void
    {
        $owner = $this->memberAtHome();

        Sanctum::actingAs($owner, ['*']);
        $own = $this->apiGet("/v2/users/{$owner->id}")->assertStatus(200)->json('data');
        $this->assertEqualsWithDelta($this->lat, (float) $own['latitude'], 0.000001);

        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);
        $admin = $this->apiGet("/v2/users/{$owner->id}")->assertStatus(200)->json('data');
        $this->assertEqualsWithDelta($this->lon, (float) $admin['longitude'], 0.000001);
    }

    // ------------------------------------------------------------------
    //  Directory
    // ------------------------------------------------------------------

    public function test_directory_coordinates_are_rounded_for_members_and_exact_for_admins(): void
    {
        $owner = $this->memberAtHome();

        Sanctum::actingAs($this->member(), ['*']);
        $row = $this->directoryRow($owner->id);
        $this->assertRounded($row['latitude'], $this->lat);
        $this->assertRounded($row['longitude'], $this->lon);

        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);
        $adminRow = $this->directoryRow($owner->id);
        $this->assertEqualsWithDelta($this->lat, (float) $adminRow['latitude'], 0.000001);
    }

    // ------------------------------------------------------------------
    //  Nearby
    // ------------------------------------------------------------------

    public function test_nearby_returns_rounded_coordinates_and_distance_to_the_rounded_point(): void
    {
        $owner = $this->memberAtHome();
        Sanctum::actingAs($this->member(), ['*']);

        // Probe from the member's exact home: the distance must be the
        // distance to the ROUNDED point, not 0 — otherwise three probes would
        // locate them exactly.
        $rows = $this->apiGet("/v2/members/nearby?lat={$this->lat}&lon={$this->lon}&radius_km=5&limit=100")
            ->assertStatus(200)->json('data');
        $row = collect($rows)->firstWhere('id', $owner->id);

        $this->assertNotNull($row, 'The member is still found nearby.');
        $this->assertRounded($row['latitude'], $this->lat);
        $this->assertRounded($row['longitude'], $this->lon);
        $expected = $this->haversine($this->lat, $this->lon, round($this->lat, 2), round($this->lon, 2));
        $this->assertGreaterThan(0.0, (float) $row['distance']);
        $this->assertEqualsWithDelta($expected, (float) $row['distance'], 0.11);
    }

    // ------------------------------------------------------------------
    //  Listings
    // ------------------------------------------------------------------

    public function test_listing_that_copied_the_profile_location_is_rounded_for_others_and_exact_for_owner(): void
    {
        $owner = $this->memberAtHome();
        TenantContext::setById($this->testTenantId);
        // The listing-created listeners (matching, notifications, indexing)
        // are irrelevant here and slow in a test container.
        \Illuminate\Support\Facades\Event::fake([\App\Events\ListingCreated::class]);
        $listing = ListingService::create($owner->id, [
            'title' => 'Location precision fixture listing',
            'description' => 'A listing created without its own location.',
            'type' => 'offer',
            'category_id' => $this->categoryId(),
        ]);

        // Nothing stored changes: the listing holds the exact profile values.
        $stored = DB::table('listings')->where('id', $listing->id)->first(['latitude', 'longitude']);
        $this->assertEqualsWithDelta($this->lat, (float) $stored->latitude, 0.000001);

        Sanctum::actingAs($this->member(), ['*']);
        $shown = $this->apiGet("/v2/listings/{$listing->id}")->assertStatus(200)->json('data');
        $this->assertRounded($shown['latitude'], $this->lat);

        $byMember = collect($this->apiGet("/v2/users/{$owner->id}/listings")->assertStatus(200)->json('data'))
            ->firstWhere('id', $listing->id);
        $this->assertNotNull($byMember);
        $this->assertRounded($byMember['longitude'], $this->lon);

        $nearby = collect($this->apiGet("/v2/listings/nearby?lat={$this->lat}&lon={$this->lon}&radius_km=5&per_page=100")
            ->assertStatus(200)->json('data'))->firstWhere('id', $listing->id);
        $this->assertNotNull($nearby);
        $this->assertRounded($nearby['latitude'], $this->lat);

        $public = $this->apiGet("/v2/listings/{$listing->id}?include=public_contract")->assertStatus(200)
            ->json('data.public_contract.location');
        if ($public !== null) {
            $this->assertRounded($public['latitude'], $this->lat);
        }

        Sanctum::actingAs($owner, ['*']);
        $own = $this->apiGet("/v2/listings/{$listing->id}")->assertStatus(200)->json('data');
        $this->assertEqualsWithDelta($this->lat, (float) $own['latitude'], 0.000001, 'The owner edit form keeps exact values.');
        $mine = collect($this->apiGet('/v2/users/me/listings')->assertStatus(200)->json('data'))->firstWhere('id', $listing->id);
        $this->assertEqualsWithDelta($this->lon, (float) $mine['longitude'], 0.000001);
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    private function assertRounded(mixed $shown, float $exact): void
    {
        $this->assertNotNull($shown);
        $this->assertEqualsWithDelta(round($exact, 2), (float) $shown, 0.0000001, 'Coordinates must be rounded to 2 decimals.');
        $this->assertNotEqualsWithDelta($exact, (float) $shown, 0.0001, 'The exact coordinate must not be returned.');
    }

    /** @return array<string, mixed> */
    private function directoryRow(int $userId): array
    {
        $rows = $this->apiGet('/v2/users?sort=joined&order=DESC&limit=100')->assertStatus(200)->json('data');
        $row = collect($rows)->firstWhere('id', $userId);
        $this->assertNotNull($row, 'The member is listed in the directory.');

        return $row;
    }

    private function haversine(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return 6371 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function categoryId(): int
    {
        $id = DB::table('categories')->where('tenant_id', $this->testTenantId)->where('type', 'listing')
            ->where('is_active', 1)->value('id');
        if ($id !== null) {
            return (int) $id;
        }

        // A fresh CI database has no listing categories for the test tenant,
        // and listing creation requires one.
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Location fixture ' . uniqid(),
            'slug' => 'location-fixture-' . uniqid(),
            'type' => 'listing',
            'is_active' => 1,
        ]);
    }

    private function memberAtHome(): User
    {
        return $this->member([
            'location' => '1 Fixture Street, Nowhere',
            'latitude' => $this->lat,
            'longitude' => $this->lon,
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_active' => 1,
            'is_approved' => true,
            'privacy_search' => 1,
            'privacy_profile' => 'public',
            'onboarding_completed' => 1,
            'avatar_url' => '/uploads/test/location-avatar.png',
            'bio' => 'Location precision fixture.',
            'created_at' => now(),
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
