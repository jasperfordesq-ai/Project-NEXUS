<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GeocodingService;
use App\Services\ListingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * A listing's typed place must be pinned where that place is, not at the
 * member's home. The accessible frontend (web-uk) has no map picker, so it
 * sends the place as text with no coordinates; until 29 Oct 2026 Laravel then
 * copied the member's home coordinates onto the listing, so "near me" put it
 * in the wrong town and the background lookup never corrected it.
 */
final class ListingLocationGeocodeTest extends TestCase
{
    use DatabaseTransactions;

    private const KNOWN = [
        'Galway' => ['53.27', '-9.05'],
        'Cork' => ['51.90', '-8.47'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
        (new \ReflectionProperty(GeocodingService::class, 'minRequestIntervalUs'))->setValue(null, 0);
        (new \ReflectionProperty(GeocodingService::class, 'lastRequestAt'))->setValue(null, null);

        DB::table('categories')->updateOrInsert(
            ['id' => 1],
            ['tenant_id' => $this->testTenantId, 'name' => 'General', 'slug' => 'general', 'type' => 'listing', 'updated_at' => now()]
        );

        Http::fake(function ($request) {
            parse_str((string) parse_url((string) $request->url(), PHP_URL_QUERY), $query);
            $place = (string) ($query['q'] ?? '');
            if (isset(self::KNOWN[$place])) {
                [$lat, $lon] = self::KNOWN[$place];
                return Http::response([['lat' => $lat, 'lon' => $lon]], 200);
            }
            return Http::response([], 200);
        });
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'location' => 'Dublin',
            'latitude' => 53.35,
            'longitude' => -6.26,
        ]);
    }

    private function create(User $user, array $extra): \App\Models\Listing
    {
        return ListingService::create($user->id, array_merge([
            'title' => 'Garden help',
            'description' => 'I can help with weeding and planting in your garden.',
            'type' => 'offer',
            'category_id' => 1,
        ], $extra));
    }

    public function test_typed_place_without_coordinates_is_looked_up(): void
    {
        $listing = $this->create($this->member(), ['location' => 'Galway']);

        $this->assertSame('Galway', $listing->location);
        $this->assertEqualsWithDelta(53.27, (float) $listing->latitude, 0.001);
        $this->assertEqualsWithDelta(-9.05, (float) $listing->longitude, 0.001);
    }

    public function test_unfindable_place_is_left_for_the_background_lookup_not_pinned_at_home(): void
    {
        $listing = $this->create($this->member(), ['location' => 'Nowhere Findable']);

        $this->assertSame('Nowhere Findable', $listing->location);
        $this->assertNull($listing->latitude);
        $this->assertNull($listing->longitude);
    }

    public function test_no_place_still_uses_the_members_own_location(): void
    {
        $listing = $this->create($this->member(), []);

        $this->assertSame('Dublin', $listing->location);
        $this->assertEqualsWithDelta(53.35, (float) $listing->latitude, 0.001);
        Http::assertNothingSent();
    }

    public function test_members_own_place_reuses_their_coordinates_without_a_lookup(): void
    {
        $listing = $this->create($this->member(), ['location' => ' dublin ']);

        $this->assertEqualsWithDelta(53.35, (float) $listing->latitude, 0.001);
        Http::assertNothingSent();
    }

    public function test_coordinates_sent_by_the_client_are_kept(): void
    {
        $listing = $this->create($this->member(), [
            'location' => 'Galway', 'latitude' => 53.1, 'longitude' => -9.1,
        ]);

        $this->assertEqualsWithDelta(53.1, (float) $listing->latitude, 0.001);
        Http::assertNothingSent();
    }

    public function test_changing_the_place_on_edit_moves_the_pin(): void
    {
        $listing = $this->create($this->member(), ['location' => 'Galway']);

        $updated = ListingService::update($listing->id, ['location' => 'Cork']);

        $this->assertEqualsWithDelta(51.90, (float) $updated->latitude, 0.001);
        $this->assertEqualsWithDelta(-8.47, (float) $updated->longitude, 0.001);
    }

    public function test_changing_to_an_unfindable_place_clears_the_old_pin(): void
    {
        $listing = $this->create($this->member(), ['location' => 'Galway']);

        $updated = ListingService::update($listing->id, ['location' => 'Nowhere Findable']);

        $this->assertNull($updated->latitude);
        $this->assertNull($updated->longitude);
    }

    public function test_edit_that_keeps_the_place_does_not_look_it_up_again(): void
    {
        $listing = $this->create($this->member(), ['location' => 'Galway']);
        Http::fake(fn () => throw new \RuntimeException('no lookup expected'));

        $updated = ListingService::update($listing->id, ['location' => 'Galway', 'title' => 'Garden help, weekends']);

        $this->assertEqualsWithDelta(53.27, (float) $updated->latitude, 0.001);
    }
}
