<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Branding;

use App\Models\User;
use App\Services\PoweredByBadgeService;
use App\Services\PrerenderContentInvalidator;
use App\Services\RedisCache;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The footer "Powered by" badge: a community's own badge, else the NETWORK badge
 * of the nearest hub above it, else the built-in Project NEXUS default (which the
 * frontends supply, so the API publishes nothing).
 *
 * Owner requirement (2026-10-06): every community under the Timebanking UK hub
 * shows the Timebanking UK badge, including communities created later, without
 * anyone having to set it on each one. The hub itself keeps the default.
 */
class PoweredByBadgeInheritanceTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB = 990601;
    private const CHILD = 990602;
    private const GRANDCHILD = 990603;
    private const OWN_BADGE_CHILD = 990604;
    private const UNRELATED = 990605;

    private const BADGE_KEYS = [
        'powered_by_label',
        'powered_by_url',
        'powered_by_image_light',
        'powered_by_image_dark',
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant(self::HUB, 'badge-hub-test', null, '/' . self::HUB . '/');
        $this->tenant(self::CHILD, 'badge-child-test', self::HUB, '/' . self::HUB . '/' . self::CHILD . '/');
        $this->tenant(self::GRANDCHILD, 'badge-grandchild-test', self::CHILD, '/' . self::HUB . '/' . self::CHILD . '/' . self::GRANDCHILD . '/');
        $this->tenant(self::OWN_BADGE_CHILD, 'badge-own-child-test', self::HUB, '/' . self::HUB . '/' . self::OWN_BADGE_CHILD . '/');
        $this->tenant(self::UNRELATED, 'badge-unrelated-test', null, '/' . self::UNRELATED . '/');

        $this->setting(self::HUB, 'network_powered_by_label', 'Provided by');
        $this->setting(self::HUB, 'network_powered_by_url', 'https://www.timebanking.org/');
        $this->setting(self::HUB, 'network_powered_by_image_light', '/uploads/powered-by-images/tbuk.png');

        $this->setting(self::OWN_BADGE_CHILD, 'powered_by_image_light', '/uploads/powered-by-images/own.png');

        $this->forgetBootstrap();
    }

    protected function tearDown(): void
    {
        $this->forgetBootstrap();
        parent::tearDown();
    }

    public function test_a_community_under_a_hub_shows_the_hub_network_badge(): void
    {
        $config = $this->bootstrapConfig('badge-child-test');

        $this->assertSame('Provided by', $config['powered_by_label'] ?? null);
        $this->assertSame('https://www.timebanking.org/', $config['powered_by_url'] ?? null);
        $this->assertSame('/uploads/powered-by-images/tbuk.png', $config['powered_by_image_light'] ?? null);
        $this->assertArrayNotHasKey('powered_by_image_dark', $config);
    }

    public function test_the_badge_reaches_communities_more_than_one_level_down(): void
    {
        $config = $this->bootstrapConfig('badge-grandchild-test');

        $this->assertSame('/uploads/powered-by-images/tbuk.png', $config['powered_by_image_light'] ?? null);
        $this->assertSame('https://www.timebanking.org/', $config['powered_by_url'] ?? null);
    }

    public function test_a_community_created_after_the_badge_was_set_inherits_it(): void
    {
        $this->tenant(990606, 'badge-late-child-test', self::HUB, '/' . self::HUB . '/990606/');

        $config = $this->bootstrapConfig('badge-late-child-test');

        $this->assertSame('/uploads/powered-by-images/tbuk.png', $config['powered_by_image_light'] ?? null);
    }

    public function test_the_hub_itself_keeps_the_default_badge(): void
    {
        $config = $this->bootstrapConfig('badge-hub-test');

        foreach (self::BADGE_KEYS as $key) {
            $this->assertArrayNotHasKey($key, $config, "Hub must not show its own network badge ({$key})");
        }
        foreach (PoweredByBadgeService::networkSettingKeys() as $key) {
            $this->assertArrayNotHasKey($key, $config, "Network keys are not part of the public payload ({$key})");
        }
    }

    public function test_a_community_with_its_own_badge_uses_only_its_own(): void
    {
        $config = $this->bootstrapConfig('badge-own-child-test');

        $this->assertSame('/uploads/powered-by-images/own.png', $config['powered_by_image_light'] ?? null);
        // Never mixes sources: no hub label or link next to someone else's logo.
        $this->assertArrayNotHasKey('powered_by_url', $config);
        $this->assertArrayNotHasKey('powered_by_label', $config);
    }

    public function test_a_cleared_own_badge_falls_back_to_the_network_badge(): void
    {
        $this->setting(self::OWN_BADGE_CHILD, 'powered_by_image_light', '');

        $config = $this->bootstrapConfig('badge-own-child-test');

        $this->assertSame('/uploads/powered-by-images/tbuk.png', $config['powered_by_image_light'] ?? null);
    }

    public function test_the_nearest_hub_wins_when_two_levels_both_set_one(): void
    {
        $this->setting(self::CHILD, 'network_powered_by_image_light', '/uploads/powered-by-images/regional.png');

        $grandchild = $this->bootstrapConfig('badge-grandchild-test');
        $this->assertSame('/uploads/powered-by-images/regional.png', $grandchild['powered_by_image_light'] ?? null);
        // Group resolution: the nearer hub set no link, so the farther hub's
        // link must not be borrowed.
        $this->assertArrayNotHasKey('powered_by_url', $grandchild);

        // The intermediate community still shows ITS parent's network badge.
        $child = $this->bootstrapConfig('badge-child-test');
        $this->assertSame('/uploads/powered-by-images/tbuk.png', $child['powered_by_image_light'] ?? null);
    }

    public function test_a_community_outside_the_hub_gets_the_default(): void
    {
        $config = $this->bootstrapConfig('badge-unrelated-test');

        foreach (self::BADGE_KEYS as $key) {
            $this->assertArrayNotHasKey($key, $config);
        }
    }

    public function test_ancestor_lookup_falls_back_to_parent_id_when_path_is_missing(): void
    {
        DB::table('tenants')->where('id', self::GRANDCHILD)->update(['path' => null]);

        $config = $this->bootstrapConfig('badge-grandchild-test');

        $this->assertSame('/uploads/powered-by-images/tbuk.png', $config['powered_by_image_light'] ?? null);
    }

    // ----------------------------------------------------------------
    // Admin settings: who may change the badge, and what saving it clears.
    // ----------------------------------------------------------------

    public function test_a_community_admin_cannot_change_any_badge_setting(): void
    {
        $this->actAs($this->admin(false));

        foreach (PoweredByBadgeService::allSettingKeys() as $key) {
            $value = str_contains($key, 'image') ? '' : (str_ends_with($key, '_url') ? 'https://example.org/' : 'Powered by someone else');
            $this->apiPut('/v2/admin/settings', [$key => $value])->assertStatus(403);
        }

        $this->assertSame(
            0,
            DB::table('tenant_settings')
                ->where('tenant_id', $this->testTenantId)
                ->whereIn('setting_key', array_map(fn ($k) => 'general.' . $k, PoweredByBadgeService::allSettingKeys()))
                ->count()
        );
    }

    public function test_a_community_admin_cannot_upload_a_network_badge_image(): void
    {
        $this->actAs($this->admin(false));

        $this->post('/api/v2/admin/settings/network-powered-by-image-light', [], ['X-Tenant-ID' => (string) $this->testTenantId])
            ->assertStatus(403);
    }

    public function test_the_platform_owner_can_set_a_network_badge_and_descendant_caches_are_cleared(): void
    {
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(1);
        });
        $hubPath = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('path');
        $hubPath = $hubPath !== '' ? rtrim($hubPath, '/') . '/' : '/' . $this->testTenantId . '/';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['path' => $hubPath]);
        $this->tenant(990607, 'badge-test-tenant-child', $this->testTenantId, $hubPath . '990607/');

        $cache = app(RedisCache::class);
        $cache->set('tenant_bootstrap', ['stale' => true], 600, 990607);
        $this->assertNotNull($cache->get('tenant_bootstrap', 990607), 'precondition: cache holds a value');

        $this->actAs($this->admin(true));
        $this->apiPut('/v2/admin/settings', [
            'network_powered_by_label' => 'Provided by',
            'network_powered_by_url' => 'https://www.timebanking.org/',
        ])->assertStatus(200);

        $this->assertNull($cache->get('tenant_bootstrap', 990607), 'descendant bootstrap must be refreshed');
        $this->apiGet('/v2/admin/settings')
            ->assertStatus(200)
            ->assertJsonPath('data.settings.network_powered_by_label', 'Provided by')
            ->assertJsonPath('data.settings.network_powered_by_url', 'https://www.timebanking.org/');
    }

    public function test_badge_links_must_be_web_addresses_and_images_can_only_be_cleared(): void
    {
        $this->actAs($this->admin(true));

        foreach (['powered_by_url', 'network_powered_by_url'] as $key) {
            foreach (['javascript:alert(1)', 'timebanking.org', 'ftp://example.org/'] as $bad) {
                $this->apiPut('/v2/admin/settings', [$key => $bad])
                    ->assertStatus(422)
                    ->assertJsonPath('errors.0.field', $key);
            }
        }

        foreach (['powered_by_image_light', 'network_powered_by_image_dark'] as $key) {
            $this->apiPut('/v2/admin/settings', [$key => 'https://evil.example/logo.png'])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', $key);
        }
    }

    // ----------------------------------------------------------------

    /** @return array<string, mixed> */
    private function bootstrapConfig(string $slug): array
    {
        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $slug);
        $response->assertStatus(200);

        return (array) ($response->json('data.config') ?? []);
    }

    private function tenant(int $id, string $slug, ?int $parentId, ?string $path): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => $id],
            [
                'name' => ucwords(str_replace('-', ' ', $slug)),
                'slug' => $slug,
                'domain' => null,
                'parent_id' => $parentId,
                'path' => $path,
                'depth' => $path === null ? 0 : substr_count(trim($path, '/'), '/'),
                'allows_subtenants' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function setting(int $tenantId, string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => 'general.' . $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
        app(RedisCache::class)->delete('tenant_bootstrap', $tenantId);
    }

    private function admin(bool $god): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        // is_god is a flag, never a role string — written straight to the column.
        DB::table('users')->where('id', $admin->id)->update(['is_god' => $god ? 1 : 0]);

        return $admin;
    }

    private function actAs(User $user): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            TwoFactorPolicy::claims('totp')
        )]);
    }

    private function forgetBootstrap(): void
    {
        foreach ([self::HUB, self::CHILD, self::GRANDCHILD, self::OWN_BADGE_CHILD, self::UNRELATED, 990606, 990607] as $id) {
            app(RedisCache::class)->delete('tenant_bootstrap', $id);
        }
    }
}
