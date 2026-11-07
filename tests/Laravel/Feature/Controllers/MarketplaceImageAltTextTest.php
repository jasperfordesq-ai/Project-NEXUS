<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID accessibility report, Oct 2026, point 6: every photo a member uploads
 * should be describable for blind members. Marketplace photos could not be:
 * the upload always stored `alt_text = NULL` and no screen let a seller write
 * one. A description now travels with each uploaded photo (`alt_texts[i]` for
 * the i-th file) and the owner can change it later through the listing update
 * (`image_alt_texts`, keyed by photo id).
 */
class MarketplaceImageAltTextTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Mail::fake();
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['marketplace' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function listing(User $seller): int
    {
        $categoryId = DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Bicycles',
            'slug' => 'bicycles-alt-' . uniqid(),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'category_id' => $categoryId,
            'title' => 'Bicicleta de paseo',
            'description' => 'Una bicicleta de paseo en buen estado.',
            'price' => 40,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'condition' => 'good',
            'quantity' => 1,
            'delivery_method' => 'pickup',
            'local_pickup' => true,
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'expires_at' => '2030-07-10 00:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function photo(int $listingId, ?string $altText = null, int $sortOrder = 0): int
    {
        return DB::table('marketplace_images')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'marketplace_listing_id' => $listingId,
            'image_url' => "/uploads/marketplace/photo-{$sortOrder}.jpg",
            'thumbnail_url' => null,
            'alt_text' => $altText,
            'sort_order' => $sortOrder,
            'is_primary' => $sortOrder === 0,
            'created_at' => now(),
        ]);
    }

    private function fakeUploads(): void
    {
        $count = 0;
        $this->mock(\App\Services\ImageUploadService::class, function ($mock) use (&$count): void {
            $mock->shouldReceive('upload')->andReturnUsing(function () use (&$count): array {
                $count++;
                return ['url' => "/uploads/marketplace/described-{$count}.png", 'thumbnail_url' => null];
            });
        });
    }

    private function storedAlt(int $imageId): ?string
    {
        $value = DB::table('marketplace_images')->where('id', $imageId)->value('alt_text');

        return $value === null ? null : (string) $value;
    }

    public function test_each_uploaded_photo_keeps_its_own_description(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $this->fakeUploads();

        $response = $this->apiPost("/v2/marketplace/listings/{$listingId}/images", [
            'images' => [
                UploadedFile::fake()->image('front.png'),
                UploadedFile::fake()->image('back.png'),
            ],
            'alt_texts' => ['Una bicicleta azul vista de lado', ''],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.0.alt_text', 'Una bicicleta azul vista de lado')
            ->assertJsonPath('data.1.alt_text', null);

        $stored = DB::table('marketplace_images')
            ->where('marketplace_listing_id', $listingId)
            ->orderBy('sort_order')
            ->pluck('alt_text')
            ->all();
        $this->assertSame(['Una bicicleta azul vista de lado', null], $stored);
    }

    public function test_a_description_is_plain_words(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $this->fakeUploads();

        $this->apiPost("/v2/marketplace/listings/{$listingId}/images", [
            'images' => [UploadedFile::fake()->image('kettle.png')],
            'alt_texts' => ["<b>A blue</b>\n   kettle"],
        ])->assertStatus(201)->assertJsonPath('data.0.alt_text', 'A blue kettle');
    }

    public function test_an_upload_description_longer_than_255_characters_is_refused(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $this->fakeUploads();

        $this->apiPost("/v2/marketplace/listings/{$listingId}/images", [
            'images' => [UploadedFile::fake()->image('long.png')],
            'alt_texts' => [str_repeat('a', 256)],
        ])->assertStatus(422);

        $this->assertSame(0, DB::table('marketplace_images')->where('marketplace_listing_id', $listingId)->count());
    }

    public function test_the_owner_can_change_and_clear_a_photo_description(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $first = $this->photo($listingId, null, 0);
        $second = $this->photo($listingId, 'Old words', 1);

        $this->apiPut("/v2/marketplace/listings/{$listingId}", [
            'image_alt_texts' => [
                (string) $first => 'Two wheels and a wicker basket',
                (string) $second => '',
            ],
        ])->assertStatus(200);

        $this->assertSame('Two wheels and a wicker basket', $this->storedAlt($first));
        $this->assertNull($this->storedAlt($second));

        $detail = $this->apiGet("/v2/marketplace/listings/{$listingId}")->assertOk();
        $this->assertContains('Two wheels and a wicker basket', array_column($detail->json('data.images'), 'alt_text'));
    }

    public function test_an_edit_description_longer_than_255_characters_is_refused(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $photo = $this->photo($listingId, 'Kept', 0);

        $this->apiPut("/v2/marketplace/listings/{$listingId}", [
            'image_alt_texts' => [(string) $photo => str_repeat('a', 256)],
        ])->assertStatus(422);

        $this->assertSame('Kept', $this->storedAlt($photo));
    }

    public function test_another_member_cannot_describe_someone_elses_photo(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $photo = $this->photo($listingId, 'The seller wrote this', 0);

        $this->member();
        $this->apiPut("/v2/marketplace/listings/{$listingId}", [
            'image_alt_texts' => [(string) $photo => 'Vandalised'],
        ])->assertStatus(403);

        $this->assertSame('The seller wrote this', $this->storedAlt($photo));
    }

    public function test_a_photo_on_another_listing_cannot_be_described_through_your_own(): void
    {
        $other = $this->member();
        $theirListing = $this->listing($other);
        $theirPhoto = $this->photo($theirListing, 'Theirs', 0);

        $seller = $this->member();
        $myListing = $this->listing($seller);

        $this->apiPut("/v2/marketplace/listings/{$myListing}", [
            'image_alt_texts' => [(string) $theirPhoto => 'Hijacked'],
        ])->assertStatus(422);

        $this->assertSame('Theirs', $this->storedAlt($theirPhoto));
    }

    public function test_a_member_of_another_community_cannot_describe_the_photo(): void
    {
        $seller = $this->member();
        $listingId = $this->listing($seller);
        $photo = $this->photo($listingId, 'Home community', 0);

        $this->member(999);
        $this->withTenant(999);
        $response = $this->apiPut("/v2/marketplace/listings/{$listingId}", [
            'image_alt_texts' => [(string) $photo => 'From elsewhere'],
        ]);

        $this->assertContains($response->status(), [403, 404]);
        $this->assertSame('Home community', $this->storedAlt($photo));
    }
}
