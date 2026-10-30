<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\UserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID accessibility report item 6 (30 Oct 2026): "There is no option to add
 * alt text to profile photos." A member can now describe their profile photo;
 * other members' profiles carry the description for screen readers.
 */
class ProfilePhotoDescriptionTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    public function test_a_member_describes_their_photo_and_others_see_the_description(): void
    {
        $owner = $this->member(['avatar_url' => '/uploads/avatars/a.jpg']);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut('/v2/users/me', ['avatar_alt' => '  Smiling woman in a garden  '])
            ->assertOk()
            ->assertJsonPath('data.avatar_alt', 'Smiling woman in a garden');
        $this->assertSame('Smiling woman in a garden', DB::table('users')->where('id', $owner->id)->value('avatar_alt'));

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/users/{$owner->id}")
            ->assertOk()
            ->assertJsonPath('data.avatar_alt', 'Smiling woman in a garden');
    }

    public function test_an_empty_description_is_stored_as_none(): void
    {
        $owner = $this->member(['avatar_alt' => 'Old description']);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut('/v2/users/me', ['avatar_alt' => '   '])->assertOk();

        $this->assertNull(DB::table('users')->where('id', $owner->id)->value('avatar_alt'));
    }

    public function test_a_description_longer_than_255_characters_is_refused(): void
    {
        $owner = $this->member();
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut('/v2/users/me', ['avatar_alt' => str_repeat('a', 256)])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'avatar_alt');
    }

    public function test_removing_the_photo_removes_its_description(): void
    {
        $owner = $this->member(['avatar_url' => '/uploads/avatars/a.jpg', 'avatar_alt' => 'A photo of me']);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut('/v2/users/me', ['avatar_url' => null, 'avatar_alt' => 'A photo of me'])->assertOk();

        $this->assertNull(DB::table('users')->where('id', $owner->id)->value('avatar_alt'));
    }

    public function test_deleting_the_account_removes_the_description(): void
    {
        $owner = $this->member(['avatar_url' => '/uploads/avatars/a.jpg', 'avatar_alt' => 'A photo of me']);

        UserService::deleteAccount($owner->id);

        $this->assertNull(DB::table('users')->where('id', $owner->id)->value('avatar_alt'));
    }
}
