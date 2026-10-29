<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use App\Services\EventService;
use App\Services\GeocodingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * An event's typed place must be put on the map where that place is. The
 * accessible frontend (web-uk) has no map picker, so it sends the place as text
 * with no coordinates; until 29 Oct 2026 such events never got a map position,
 * and changing the venue kept the old pin. Same rule as ListingLocationGeocodeTest.
 */
final class EventLocationGeocodeTest extends TestCase
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

    private function organiser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @return array<string,mixed> */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Garden morning',
            'description' => 'Planting and tea.',
            'start_time' => '2027-07-15 09:00:00',
            'end_time' => '2027-07-15 10:30:00',
            'timezone' => 'Europe/Dublin',
            'all_day' => false,
            'is_online' => false,
        ], $overrides);
    }

    private function fresh(Event $event): Event
    {
        return Event::query()->withoutGlobalScopes()->findOrFail($event->id);
    }

    public function test_a_typed_place_without_coordinates_is_put_on_the_map(): void
    {
        $event = EventService::create($this->organiser()->id, $this->payload(['location' => 'Galway']));

        $stored = $this->fresh($event);
        $this->assertEqualsWithDelta(53.27, (float) $stored->latitude, 0.001);
        $this->assertEqualsWithDelta(-9.05, (float) $stored->longitude, 0.001);
    }

    public function test_coordinates_sent_by_a_map_picker_are_kept(): void
    {
        $event = EventService::create($this->organiser()->id, $this->payload([
            'location' => 'Galway',
            'latitude' => 53.3498,
            'longitude' => -6.2603,
        ]));

        $stored = $this->fresh($event);
        $this->assertEqualsWithDelta(53.3498, (float) $stored->latitude, 0.0001);
        Http::assertNothingSent();
    }

    public function test_an_unknown_place_saves_without_a_map_position(): void
    {
        $event = EventService::create($this->organiser()->id, $this->payload(['location' => 'Nowhere Particular']));

        $stored = $this->fresh($event);
        $this->assertNull($stored->latitude);
        $this->assertNull($stored->longitude);
    }

    public function test_changing_the_place_moves_the_pin(): void
    {
        $organiser = $this->organiser();
        $event = EventService::create($organiser->id, $this->payload(['location' => 'Galway']));

        $this->assertTrue(EventService::update($event->id, $organiser->id, ['location' => 'Cork']));

        $stored = $this->fresh($event);
        $this->assertEqualsWithDelta(51.90, (float) $stored->latitude, 0.001);
        $this->assertEqualsWithDelta(-8.47, (float) $stored->longitude, 0.001);
    }

    public function test_resending_the_same_place_keeps_the_pin(): void
    {
        $organiser = $this->organiser();
        $event = EventService::create($organiser->id, $this->payload([
            'location' => 'Galway',
            'latitude' => 53.3498,
            'longitude' => -6.2603,
        ]));

        $this->assertTrue(EventService::update($event->id, $organiser->id, ['location' => ' galway ', 'title' => 'Garden morning, renamed']));

        $stored = $this->fresh($event);
        $this->assertEqualsWithDelta(53.3498, (float) $stored->latitude, 0.0001);
    }

    public function test_clearing_the_place_clears_the_pin(): void
    {
        $organiser = $this->organiser();
        $event = EventService::create($organiser->id, $this->payload(['location' => 'Galway']));

        $this->assertTrue(EventService::update($event->id, $organiser->id, ['location' => '']));

        $stored = $this->fresh($event);
        $this->assertNull($stored->latitude);
        $this->assertNull($stored->longitude);
    }
}
