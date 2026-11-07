<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID accessibility report, Oct 2026, point 6: every image a member uploads
 * should carry a short description. Listing photos and profile photos had
 * one; an event's cover and a group's picture and cover did not
 * (EventContractMapper even read `image_alt`, but the column never existed).
 *
 * PUT /v2/events/{id}/image-description and PUT /v2/groups/{id}/image-description
 * set or clear it, with the same permission as changing the photo itself.
 */
class ImageDescriptionTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    private function event(int $ownerId): int
    {
        return DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Repair cafe',
            'description' => 'Bring something broken.',
            'location' => 'Community hall',
            'start_time' => now()->addDays(7)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(7)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'cover_image' => '/uploads/tenants/test/events/cafe.jpg',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function group(int $ownerId): Group
    {
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $ownerId,
            'image_url' => '/uploads/tenants/test/groups/picture.jpg',
            'cover_image_url' => '/uploads/tenants/test/groups/cover.jpg',
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId, 'group_id' => $group->id, 'user_id' => $ownerId,
            'role' => 'owner', 'status' => 'active', 'joined_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $group;
    }

    public function test_an_event_organiser_describes_the_cover_and_members_see_it(): void
    {
        $owner = $this->member();
        $eventId = $this->event($owner->id);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/events/{$eventId}/image-description", [
            'image_alt' => '  Volunteers fixing a bicycle at a long table  ',
        ])->assertStatus(200);

        $this->assertSame('Volunteers fixing a bicycle at a long table', DB::table('events')->where('id', $eventId)->value('image_alt'));
        $detail = $this->apiGet("/v2/events/{$eventId}")->assertStatus(200);
        $this->assertStringContainsString('Volunteers fixing a bicycle at a long table', $detail->getContent());
    }

    public function test_an_empty_event_description_clears_it(): void
    {
        $owner = $this->member();
        $eventId = $this->event($owner->id);
        DB::table('events')->where('id', $eventId)->update(['image_alt' => 'Old words']);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/events/{$eventId}/image-description", ['image_alt' => ''])->assertStatus(200);

        $this->assertNull(DB::table('events')->where('id', $eventId)->value('image_alt'));
    }

    public function test_someone_who_may_not_change_the_event_photo_may_not_describe_it(): void
    {
        $owner = $this->member();
        $eventId = $this->event($owner->id);
        Sanctum::actingAs($this->member(), ['*']);

        $response = $this->apiPut("/v2/events/{$eventId}/image-description", ['image_alt' => 'Not mine']);

        $this->assertContains($response->getStatusCode(), [403, 404]);
        $this->assertNull(DB::table('events')->where('id', $eventId)->value('image_alt'));
    }

    public function test_a_description_longer_than_255_characters_is_refused(): void
    {
        $owner = $this->member();
        $eventId = $this->event($owner->id);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/events/{$eventId}/image-description", ['image_alt' => str_repeat('a', 256)])
            ->assertStatus(422);
    }

    public function test_a_group_owner_describes_the_picture_and_the_cover_separately(): void
    {
        $owner = $this->member();
        $group = $this->group($owner->id);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/groups/{$group->id}/image-description", ['type' => 'avatar', 'image_alt' => 'Our logo: a green hand holding a seedling'])
            ->assertStatus(200);
        $this->apiPut("/v2/groups/{$group->id}/image-description", ['type' => 'cover', 'image_alt' => 'Members planting trees by the river'])
            ->assertStatus(200);

        $row = DB::table('groups')->where('id', $group->id)->first();
        $this->assertSame('Our logo: a green hand holding a seedling', $row->image_alt);
        $this->assertSame('Members planting trees by the river', $row->cover_image_alt);
        $detail = $this->apiGet("/v2/groups/{$group->id}")->assertStatus(200);
        $this->assertStringContainsString('Members planting trees by the river', $detail->getContent());
    }

    public function test_a_member_who_may_not_edit_the_group_may_not_describe_its_images(): void
    {
        $owner = $this->member();
        $group = $this->group($owner->id);
        Sanctum::actingAs($this->member(), ['*']);

        $response = $this->apiPut("/v2/groups/{$group->id}/image-description", ['type' => 'cover', 'image_alt' => 'Not mine']);

        $this->assertContains($response->getStatusCode(), [403, 404]);
        $this->assertNull(DB::table('groups')->where('id', $group->id)->value('cover_image_alt'));
    }

    public function test_the_group_settings_form_saves_and_clears_descriptions(): void
    {
        $owner = $this->member();
        $group = $this->group($owner->id);
        DB::table('groups')->where('id', $group->id)->update(['image_alt' => 'Old picture words']);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/groups/{$group->id}/settings", [
            'name' => $group->name,
            'avatar_action' => 'remove',
            'cover_action' => 'keep',
            'cover_alt' => 'Members planting trees by the river',
        ])->assertStatus(200);

        $row = DB::table('groups')->where('id', $group->id)->first();
        $this->assertNull($row->image_alt, 'a removed picture takes its description with it');
        $this->assertSame('Members planting trees by the river', $row->cover_image_alt);
    }

    public function test_a_new_group_image_upload_replaces_the_old_description(): void
    {
        $owner = $this->member();
        $group = $this->group($owner->id);
        DB::table('groups')->where('id', $group->id)->update(['cover_image_alt' => 'The old cover']);

        $result = \App\Services\GroupService::replaceImage($group->id, $owner->id, '/uploads/tenants/test/groups/new-cover.jpg', 'cover', 'The new cover');

        $this->assertNotNull($result);
        $this->assertSame('The new cover', DB::table('groups')->where('id', $group->id)->value('cover_image_alt'));
    }
}
