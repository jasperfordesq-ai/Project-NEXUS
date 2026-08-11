<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Listings;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * `hours_available` is the TOTAL a member is willing to give for a listing,
 * separate from `hours_estimate` (how long ONE exchange takes). NULL means no
 * cap, which is how every listing behaved before the field existed.
 *
 * Requested by Minehead and Coast Time Bank, 2026-08-09.
 */
class ListingHoursAvailableTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * The seeded category id=1 is pinned to tenant 1, so an insertOrIgnore is a
     * no-op and store()'s exists-rule then 422s. Force it onto the test tenant.
     * Rolled back per test by DatabaseTransactions.
     */
    private function ensureListingCategory(int $id = 1): void
    {
        DB::table('categories')->updateOrInsert(
            ['id' => $id],
            [
                'tenant_id' => $this->testTenantId,
                'name' => 'General',
                'slug' => 'general',
                'type' => 'listing',
                'updated_at' => now(),
            ]
        );
    }

    private function basePayload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Hours cap listing',
            'description' => 'A detailed description of the service being offered here.',
            'type' => 'offer',
            'category_id' => 1,
            'service_type' => 'physical_only',
            'hours_estimate' => 2,
        ], $overrides);
    }

    public function test_a_listing_can_be_created_with_a_total_hours_cap(): void
    {
        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();

        $response = $this->apiPost('/v2/listings', $this->basePayload([
            'hours_available' => 20,
        ]));

        $this->assertContains($response->getStatusCode(), [200, 201]);

        $stored = DB::table('listings')
            ->where('title', 'Hours cap listing')
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($stored, 'Listing was not created.');
        $this->assertSame('20.00', (string) $stored->hours_available);
        // The per-exchange duration must be untouched by the new field.
        $this->assertSame('2.00', (string) $stored->hours_estimate);
    }

    public function test_omitting_the_cap_leaves_it_null_meaning_no_limit(): void
    {
        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();

        $response = $this->apiPost('/v2/listings', $this->basePayload([
            'title' => 'No cap listing',
        ]));

        $this->assertContains($response->getStatusCode(), [200, 201]);

        $stored = DB::table('listings')
            ->where('title', 'No cap listing')
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($stored);
        $this->assertNull(
            $stored->hours_available,
            'An omitted cap must stay NULL — 0 would read as "no hours left".'
        );
    }

    public function test_an_empty_cap_is_stored_as_no_limit_not_zero(): void
    {
        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();

        // A cleared form field posts '' — the decimal cast would turn that into
        // 0.00 and silently make the listing look exhausted.
        $response = $this->apiPost('/v2/listings', $this->basePayload([
            'title' => 'Cleared cap listing',
            'hours_available' => '',
        ]));

        $this->assertContains($response->getStatusCode(), [200, 201]);

        $stored = DB::table('listings')
            ->where('title', 'Cleared cap listing')
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($stored);
        $this->assertNull($stored->hours_available);
    }

    public function test_a_cap_below_the_estimated_hours_is_rejected(): void
    {
        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();

        // 2-hour task, 1-hour total — unbookable from the moment it publishes.
        $response = $this->apiPost('/v2/listings', $this->basePayload([
            'title' => 'Impossible cap listing',
            'hours_estimate' => 2,
            'hours_available' => 1,
        ]));

        $this->assertContains($response->getStatusCode(), [400, 422]);
        $this->assertSame(
            0,
            DB::table('listings')->where('title', 'Impossible cap listing')->count()
        );
    }

    public function test_the_cap_can_be_cleared_on_update(): void
    {
        $user = $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();

        $listing = Listing::factory()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'hours_estimate' => 2,
            'hours_available' => 10,
        ]);

        $response = $this->apiPut('/v2/listings/' . $listing->id, [
            'hours_available' => '',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201, 204]);
        $this->assertNull(
            DB::table('listings')->where('id', $listing->id)->value('hours_available'),
            'Clearing the field must remove the cap, not set it to zero.'
        );
    }

    public function test_the_cap_is_returned_to_the_frontend(): void
    {
        $user = $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();

        $listing = Listing::factory()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'status' => 'active',
            'hours_estimate' => 2,
            'hours_available' => 15,
        ]);

        $response = $this->apiGet('/v2/listings/' . $listing->id);

        $response->assertStatus(200);
        $this->assertStringContainsString(
            'hours_available',
            json_encode($response->json(), JSON_THROW_ON_ERROR),
            'The frontend cannot show a cap the API does not return.'
        );
    }
}
