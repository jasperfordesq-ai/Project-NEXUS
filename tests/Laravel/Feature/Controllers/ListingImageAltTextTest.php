<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression (AWID pilot, Oct 2026): a listing photo could not be described
 * for screen-reader users — there was nowhere to type alt text.
 */
class ListingImageAltTextTest extends TestCase
{
    use DatabaseTransactions;

    private function owner(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    public function test_owner_can_save_image_description_and_it_is_returned(): void
    {
        $user = $this->owner();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'image_url' => '/uploads/listings/photo.jpg',
        ]);

        $this->apiPut("/v2/listings/{$listing->id}", [
            'image_alt' => 'Dos mujeres conversando en una cocina comunitaria',
        ])->assertStatus(200)
            ->assertJsonPath('data.image_alt', 'Dos mujeres conversando en una cocina comunitaria');

        $this->apiGet("/v2/listings/{$listing->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.image_alt', 'Dos mujeres conversando en una cocina comunitaria');
    }

    public function test_image_description_is_saved_on_create(): void
    {
        $this->owner();
        $categoryId = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Idiomas',
            'slug' => 'idiomas-alt-test',
            'type' => 'listing',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/listings', [
            'category_id' => $categoryId,
            'title' => 'Clases de español',
            'description' => 'Ofrezco clases de conversación en español para principiantes.',
            'type' => 'offer',
            'image_alt' => 'Una pizarra con palabras en español',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.image_alt', 'Una pizarra con palabras en español');
    }

    public function test_image_description_longer_than_255_characters_is_refused(): void
    {
        $user = $this->owner();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create(['user_id' => $user->id]);

        $this->apiPut("/v2/listings/{$listing->id}", [
            'image_alt' => str_repeat('a', 256),
        ])->assertStatus(422);
    }

    public function test_removing_the_photo_clears_its_description(): void
    {
        $user = $this->owner();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'image_url' => '/uploads/listings/photo.jpg',
        ]);
        DB::table('listings')->where('id', $listing->id)->update(['image_alt' => 'Old description']);

        $this->apiDelete("/v2/listings/{$listing->id}/image")->assertStatus(200);

        $this->assertNull(DB::table('listings')->where('id', $listing->id)->value('image_alt'));
    }
}
