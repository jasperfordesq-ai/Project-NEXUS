<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-055 F-256 — an attribute may only be attached to a category of the admin's
 * own community, and the attribute list must never show another community's
 * category name.
 */
final class F256AttributeCategoryTenantScopeTest extends TestCase
{
    use DatabaseTransactions;

    private function category(int $tenantId, string $name): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId, 'name' => $name, 'slug' => 'f256-' . uniqid('', false), 'type' => 'listing',
        ]);
    }

    private function foreignCategory(string $name): int
    {
        $otherTenant = (int) DB::table('tenants')->insertGetId([
            'name' => 'F256 Other', 'slug' => 'f256-other-' . uniqid('', false), 'is_active' => 1,
        ]);

        return $this->category($otherTenant, $name);
    }

    private function actingAdmin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    public function test_attribute_cannot_be_created_on_another_communitys_category(): void
    {
        $foreign = $this->foreignCategory('F256 Secret Cat');
        $this->actingAdmin();

        $this->apiPost('/v2/admin/attributes', ['name' => 'F256 probe', 'category_id' => $foreign])
            ->assertStatus(404);
        $this->assertSame(0, DB::table('attributes')->where('tenant_id', $this->testTenantId)->where('category_id', $foreign)->count());
    }

    public function test_attribute_cannot_be_moved_onto_another_communitys_category(): void
    {
        $own = $this->category($this->testTenantId, 'F256 Own Cat');
        $foreign = $this->foreignCategory('F256 Secret Cat');
        $this->actingAdmin();

        $id = (int) $this->apiPost('/v2/admin/attributes', ['name' => 'F256 movable', 'category_id' => $own])
            ->assertStatus(201)->json('data.id');
        $this->apiPut("/v2/admin/attributes/{$id}", ['category_id' => $foreign])->assertStatus(404);

        $this->assertSame($own, (int) DB::table('attributes')->where('id', $id)->value('category_id'));
    }

    public function test_attribute_list_never_shows_another_communitys_category_name(): void
    {
        $foreign = $this->foreignCategory('F256 Secret Cat Listed');
        // A row that already points at a foreign category (stored before this fix).
        DB::table('attributes')->insert([
            'tenant_id' => $this->testTenantId, 'name' => 'F256 legacy row', 'category_id' => $foreign,
            'input_type' => 'checkbox', 'is_active' => 1,
        ]);
        $this->actingAdmin();

        $names = array_column($this->apiGet('/v2/admin/attributes')->assertStatus(200)->json('data'), 'category_name');
        $this->assertNotContains('F256 Secret Cat Listed', $names);
    }

    public function test_control_own_category_attribute_is_created_and_listed_with_its_name(): void
    {
        $own = $this->category($this->testTenantId, 'F256 Own Listed Cat');
        $this->actingAdmin();

        $this->apiPost('/v2/admin/attributes', ['name' => 'F256 own attr', 'category_id' => $own])->assertStatus(201);
        $this->apiPost('/v2/admin/attributes', ['name' => 'F256 uncategorised'])->assertStatus(201);

        $names = array_column($this->apiGet('/v2/admin/attributes')->assertStatus(200)->json('data'), 'category_name');
        $this->assertContains('F256 Own Listed Cat', $names);
    }
}
