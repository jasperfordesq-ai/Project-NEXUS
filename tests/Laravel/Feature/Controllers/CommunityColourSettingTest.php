<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The community colour (AWID feedback, Nov 2026): a community admin picks one
 * colour on Admin → Settings and the member website uses it for buttons,
 * links and highlights. It is stored as tenants.configuration.primary_color —
 * the key the round-up email and volunteer certificate already read — and
 * published in the tenant bootstrap as branding.primary_color.
 *
 * Until this change nothing could set it: `primary_color` was listed as a
 * direct `tenants` column, but that column does not exist, so a save through
 * the general settings endpoint failed in the database.
 */
class CommunityColourSettingTest extends TestCase
{
    use DatabaseTransactions;

    private function actAsAdmin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    /** @return array<string, mixed> */
    private function storedConfig(): array
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');

        return json_decode((string) $raw, true) ?: [];
    }

    /** @param array<string, mixed> $config */
    private function storeConfig(array $config): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
    }

    /** @return array<string, mixed> */
    private function bootstrapBranding(): array
    {
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        return $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
            ->assertOk()
            ->json('data.branding') ?? [];
    }

    protected function tearDown(): void
    {
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        parent::tearDown();
    }

    public function test_an_admin_saves_a_community_colour_and_every_reader_sees_it(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings/header-colors', ['community_color' => '#A3195B'])
            ->assertOk()
            ->assertJsonPath('data.community_color', '#a3195b');

        $this->assertSame('#a3195b', $this->storedConfig()['primary_color'] ?? null);

        $this->apiGet('/v2/admin/settings')
            ->assertOk()
            ->assertJsonPath('data.settings.community_color', '#a3195b');

        $this->assertSame('#a3195b', $this->bootstrapBranding()['primary_color'] ?? null);
    }

    public function test_an_empty_value_goes_back_to_the_standard_colour(): void
    {
        $this->storeConfig(array_merge($this->storedConfig(), ['primary_color' => '#0f766e']));
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings/header-colors', ['community_color' => ''])
            ->assertOk()
            ->assertJsonPath('data.community_color', null);

        $this->assertArrayNotHasKey('primary_color', $this->storedConfig());
        $this->assertArrayNotHasKey('primary_color', $this->bootstrapBranding());
    }

    public function test_saving_only_the_accessible_header_colours_leaves_the_community_colour_alone(): void
    {
        $this->storeConfig(array_merge($this->storedConfig(), ['primary_color' => '#0f766e']));
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings/header-colors', ['bg_color' => '#5b2a86', 'accent_color' => ''])
            ->assertOk();

        $this->assertSame('#0f766e', $this->storedConfig()['primary_color'] ?? null);
    }

    public function test_a_value_that_is_not_a_colour_is_refused(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings/header-colors', ['community_color' => 'red;background:url(x)'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'community_color');

        $this->assertArrayNotHasKey('primary_color', $this->storedConfig());
    }

    /**
     * The colour is used for link text on a white page and behind button text,
     * so a colour too pale to read against white is refused rather than
     * shipped as an unreadable site (WCAG 2.2 AA, 4.5:1).
     */
    public function test_a_colour_too_pale_to_read_on_white_is_refused(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings/header-colors', ['community_color' => '#facc15'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'community_color');

        $this->assertArrayNotHasKey('primary_color', $this->storedConfig());
    }

    public function test_a_member_cannot_change_the_community_colour(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiPut('/v2/admin/settings/header-colors', ['community_color' => '#a3195b'])
            ->assertStatus(403);

        $this->assertArrayNotHasKey('primary_color', $this->storedConfig());
    }

    public function test_the_bootstrap_never_publishes_a_stored_colour_that_is_not_a_hex_value(): void
    {
        $this->storeConfig(array_merge($this->storedConfig(), ['primary_color' => 'red;background:url(x)']));

        $this->assertArrayNotHasKey('primary_color', $this->bootstrapBranding());
    }

    /**
     * Regression: `primary_color` sat in the list of direct `tenants` columns,
     * which has no such column, so the general settings save tried to write it
     * and failed in the database. It is now not a general setting at all.
     */
    public function test_the_general_settings_save_no_longer_tries_to_write_a_missing_column(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings', ['primary_color' => '#a3195b'])
            ->assertStatus(422);
    }
}
