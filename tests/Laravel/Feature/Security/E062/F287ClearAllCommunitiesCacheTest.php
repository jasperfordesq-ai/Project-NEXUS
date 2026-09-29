<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Models\User;
use App\Services\RedisCache;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-287 (E-062) — "clear all communities' cache" looped the literal
 * [1, 2, 3, 4, 5], while community ids are neither contiguous nor capped at 5
 * (production runs eleven). Every other community kept its cached settings,
 * and the admin was told {"cleared": true}. It now clears every community
 * that exists.
 *
 * Control: clearing one community's cache still clears only that community.
 */
class F287ClearAllCommunitiesCacheTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_clearing_all_caches_clears_every_community_that_exists(): void
    {
        $newCommunity = (int) DB::table('tenants')->insertGetId([
            'name' => 'F287 Community',
            'slug' => 'f287-' . substr(bin2hex(random_bytes(4)), 0, 8),
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $cleared = [];
        $cache = Mockery::mock(RedisCache::class)->shouldIgnoreMissing();
        $cache->shouldReceive('clearTenant')->andReturnUsing(function (?int $id) use (&$cleared) {
            $cleared[] = (int) $id;
            return 0;
        });
        $this->app->instance(RedisCache::class, $cache);

        $platformSuper = $this->admin(['is_super_admin' => 1]);
        $this->apiPost('/v2/admin/cache/clear', ['type' => 'all'], $this->bearer($platformSuper))
            ->assertOk()
            ->assertJsonPath('data.cleared', true);

        $every = DB::table('tenants')->orderBy('id')->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        sort($cleared);
        $this->assertContains($newCommunity, $cleared, 'a community outside ids 1-5 is cleared too');
        $this->assertSame($every, $cleared, 'every community is cleared exactly once');
    }

    public function test_control_clearing_one_community_clears_only_that_community(): void
    {
        $cache = Mockery::mock(RedisCache::class)->shouldIgnoreMissing();
        $cache->shouldReceive('clearTenant')->once()->with($this->testTenantId)->andReturn(0);
        $this->app->instance(RedisCache::class, $cache);

        $admin = $this->admin(['is_tenant_super_admin' => 1]);
        $this->apiPost('/v2/admin/cache/clear', ['type' => 'tenant'], $this->bearer($admin))->assertOk();
    }

    private function admin(array $attributes): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ], $attributes));
    }

    /** @return array<string,string> */
    private function bearer(User $user): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            TwoFactorPolicy::claims('totp')
        )];
    }
}
