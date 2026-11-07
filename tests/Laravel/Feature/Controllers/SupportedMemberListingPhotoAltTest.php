<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID accessibility report, Oct 2026, point 6: a supporter who adds the photo
 * to a listing they posted for the member they support could not describe it
 * (POST /v2/users/me/sub-accounts/{childId}/listings/{listingId}/image never
 * set listings.image_alt). The description now travels with the photo as
 * `image_alt`; leaving the field out keeps whatever was already saved.
 */
class SupportedMemberListingPhotoAltTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> Files the real uploader wrote, removed after each test. */
    private array $writtenFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->writtenFiles as $url) {
            $path = base_path('httpdocs' . $url);
            if (is_file($path)) {
                @unlink($path);
            }
        }
        parent::tearDown();
    }

    /** @return array{0: User, 1: User, 2: int} supporter, supported member, listing id */
    private function supportedListing(): array
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('account_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $member->id,
            'relationship_type' => 'family',
            'permissions' => json_encode(['can_view_activity' => true, 'can_manage_listings' => true]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create(['user_id' => $member->id]);
        Sanctum::actingAs($supporter, ['*']);

        return [$supporter, $member, (int) $listing->id];
    }

    private function upload(int $memberId, int $listingId, array $fields): \Illuminate\Testing\TestResponse
    {
        $response = $this->apiPost(
            "/v2/users/me/sub-accounts/{$memberId}/listings/{$listingId}/image",
            array_merge(['image' => UploadedFile::fake()->image('garden.jpg', 40, 30)], $fields),
        );
        $url = $response->json('data.image_url');
        if (is_string($url) && $url !== '') {
            $this->writtenFiles[] = $url;
        }

        return $response;
    }

    public function test_the_supporter_describes_the_photo_and_it_is_saved(): void
    {
        [, $member, $listingId] = $this->supportedListing();

        $this->upload($member->id, $listingId, [
            'image_alt' => 'Un huerto con tomates maduros',
        ])->assertStatus(200);

        $row = DB::table('listings')->where('id', $listingId)->first();
        $this->assertNotNull($row->image_url);
        $this->assertSame('Un huerto con tomates maduros', $row->image_alt);
    }

    public function test_a_supporter_description_longer_than_255_characters_is_refused(): void
    {
        [, $member, $listingId] = $this->supportedListing();

        $this->upload($member->id, $listingId, ['image_alt' => str_repeat('a', 256)])->assertStatus(422);

        $row = DB::table('listings')->where('id', $listingId)->first();
        $this->assertNull($row->image_url);
        $this->assertNull($row->image_alt);
    }

    public function test_leaving_the_field_out_keeps_the_description_saved_with_the_listing(): void
    {
        [, $member, $listingId] = $this->supportedListing();
        // The React form sends the description with the listing itself.
        DB::table('listings')->where('id', $listingId)->update(['image_alt' => 'Written on the listing form']);

        $this->upload($member->id, $listingId, [])->assertStatus(200);

        $this->assertSame('Written on the listing form', DB::table('listings')->where('id', $listingId)->value('image_alt'));
    }

    public function test_someone_without_the_relationship_cannot_describe_the_photo(): void
    {
        [, $member, $listingId] = $this->supportedListing();
        $stranger = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($stranger, ['*']);

        $this->upload($member->id, $listingId, ['image_alt' => 'Not theirs to write'])->assertStatus(403);

        $this->assertNull(DB::table('listings')->where('id', $listingId)->value('image_alt'));
    }
}
