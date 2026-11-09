<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use App\Models\User;
use App\Support\Categories\ThemeIcons;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A picture for each offer theme (AWID feedback, Nov 2026: "clear categories,
 * attractive visuals"). An administrator chooses one of a fixed set of pictures
 * for a theme (categories.icon); the website shows it on the theme's filter
 * tile and on covers of offers and requests in that theme. No choice (NULL)
 * means "choose automatically" — the website guesses from the theme's name.
 */
class CategoryThemeIconTest extends TestCase
{
    use DatabaseTransactions;

    private function admin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        return $admin;
    }

    private function theme(?string $icon = null, string $slug = 'gardening-icon-test'): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Gardening ' . $slug,
            'slug' => $slug,
            'type' => 'listing',
            'color' => 'green',
            'icon' => $icon,
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    public function test_the_set_of_pictures_is_fixed_and_known(): void
    {
        $this->assertContains('garden', ThemeIcons::ALLOWED);
        $this->assertContains('transport', ThemeIcons::ALLOWED);
        $this->assertTrue(ThemeIcons::isAllowed('garden'));
        $this->assertFalse(ThemeIcons::isAllowed('javascript:alert(1)'));
        $this->assertFalse(ThemeIcons::isAllowed(''));
    }

    public function test_an_admin_chooses_a_picture_when_creating_a_theme(): void
    {
        $this->admin();

        $response = $this->apiPost('/v2/admin/categories', [
            'name' => 'Lifts to town',
            'color' => 'blue',
            'type' => 'listing',
            'icon' => 'transport',
        ]);

        $response->assertStatus(201)->assertJsonPath('data.icon', 'transport');
        $id = (int) $response->json('data.id');
        $this->assertSame('transport', DB::table('categories')->where('id', $id)->value('icon'));
    }

    public function test_an_admin_changes_the_picture_and_can_go_back_to_automatic(): void
    {
        $this->admin();
        $id = $this->theme('garden');

        $this->apiPut("/v2/admin/categories/{$id}", ['icon' => 'outdoors'])
            ->assertStatus(200)
            ->assertJsonPath('data.icon', 'outdoors');
        $this->assertSame('outdoors', DB::table('categories')->where('id', $id)->value('icon'));

        $this->apiPut("/v2/admin/categories/{$id}", ['icon' => ''])
            ->assertStatus(200)
            ->assertJsonPath('data.icon', null);
        $this->assertNull(DB::table('categories')->where('id', $id)->value('icon'));
    }

    public function test_saving_without_mentioning_the_picture_keeps_it(): void
    {
        $this->admin();
        $id = $this->theme('garden');

        $this->apiPut("/v2/admin/categories/{$id}", ['color' => 'teal'])->assertStatus(200);

        $this->assertSame('garden', DB::table('categories')->where('id', $id)->value('icon'));
    }

    public function test_a_picture_outside_the_set_is_refused(): void
    {
        $this->admin();
        $id = $this->theme('garden');

        $this->apiPut("/v2/admin/categories/{$id}", ['icon' => '<svg onload=alert(1)>'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'icon');
        $this->apiPost('/v2/admin/categories', ['name' => 'Odd one', 'type' => 'listing', 'icon' => 'rocket'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'icon');

        $this->assertSame('garden', DB::table('categories')->where('id', $id)->value('icon'));
    }

    public function test_the_admin_list_says_which_picture_each_theme_has(): void
    {
        $this->admin();
        $id = $this->theme('garden');

        $rows = collect($this->apiGet('/v2/admin/categories?type=listing')->assertOk()->json('data'));
        $this->assertSame('garden', $rows->firstWhere('id', $id)['icon'] ?? 'missing');
    }

    public function test_the_public_theme_list_carries_the_picture(): void
    {
        $id = $this->theme('garden');

        $rows = collect($this->apiGet('/v2/categories?type=listing')->assertOk()->json('data'));
        $this->assertSame('garden', $rows->firstWhere('id', $id)['icon'] ?? 'missing');
    }

    public function test_an_offer_carries_its_theme_picture(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($member, ['*']);
        $id = $this->theme('garden');
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $member->id,
            'category_id' => $id,
        ]);

        $this->apiGet("/v2/listings/{$listing->id}")
            ->assertOk()
            ->assertJsonPath('data.category_icon', 'garden');
    }
}
