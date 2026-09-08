<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class TenantModuleApiBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * @dataProvider disabledModuleRoutes
     */
    public function test_disabled_core_module_rejects_its_api_before_controller_execution(
        string $module,
        string $method,
        string $path,
    ): void {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        $this->disableModule($module);

        $response = match ($method) {
            'GET' => $this->apiGet($path),
            'POST' => $this->apiPost($path),
            default => throw new \LogicException("Unsupported test method: {$method}"),
        };

        $response->assertForbidden();
        $response->assertJsonPath('errors.0.code', 'MODULE_DISABLED');
    }

    /** @return array<string, array{string, string, string}> */
    public static function disabledModuleRoutes(): array
    {
        return [
            'messages read' => ['messages', 'GET', '/v2/messages'],
            'messages write' => ['messages', 'POST', '/v2/messages'],
            'wallet read' => ['wallet', 'GET', '/v2/wallet/balance'],
            'wallet write' => ['wallet', 'POST', '/v2/wallet/transfer'],
            'feed read' => ['feed', 'GET', '/v2/feed'],
            'feed write' => ['feed', 'POST', '/v2/feed/posts'],
            'notifications read' => ['notifications', 'GET', '/v2/notifications'],
            'notifications write' => ['notifications', 'POST', '/v2/notifications/read-all'],
        ];
    }

    /**
     * @dataProvider moduleRoutePatterns
     */
    public function test_all_module_owned_routes_keep_their_server_side_gate(
        string $module,
        string $pattern,
    ): void {
        $ownedRoutes = collect(Route::getRoutes()->getRoutes())
            ->filter(static fn ($route): bool => preg_match($pattern, $route->uri()) === 1)
            ->reject(static fn ($route): bool => $route->uri() === 'api/v2/notifications/unsubscribe');

        $this->assertNotEmpty($ownedRoutes, "No routes matched the {$module} ownership pattern.");

        foreach ($ownedRoutes as $route) {
            $this->assertContains(
                "module:{$module}",
                $route->gatherMiddleware(),
                "{$route->methods()[0]} {$route->uri()} is missing module:{$module}",
            );
        }
    }

    /** @return array<string, array{string, string}> */
    public static function moduleRoutePatterns(): array
    {
        return [
            'messages' => ['messages', '#^api/(?:(?:v2/)?messages(?:/|$)|v2/conversations(?:/|$))#'],
            'wallet' => ['wallet', '#^api/(?:v2/)?wallet(?:/|$)#'],
            'feed' => ['feed', '#^api/(?:v2/feed(?:/|$)|feed(?:/|$)|social(?:/|$)|v2/shares(?:/|$)|v2/community/stats$|v2/members/suggested$|v2/admin/feed(?:/|$))#'],
            'notifications' => ['notifications', '#^api/(?:v2/)?notifications(?:/|$)|^api/v2/users/me/notification-settings$#'],
        ];
    }

    /**
     * @dataProvider disabledFeatureRoutes
     */
    public function test_disabled_feature_rejects_its_read_and_write_apis(
        string $feature,
        string $method,
        string $path,
    ): void {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        $this->disableFeature($feature);

        $response = match ($method) {
            'GET' => $this->apiGet($path),
            'POST' => $this->apiPost($path),
            default => throw new \LogicException("Unsupported test method: {$method}"),
        };

        $response->assertForbidden();
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    /** @return array<string, array{string, string, string}> */
    public static function disabledFeatureRoutes(): array
    {
        return [
            'connections read' => ['connections', 'GET', '/v2/connections'],
            'connections write' => ['connections', 'POST', '/v2/connections/request'],
            'reviews read' => ['reviews', 'GET', '/v2/reviews/pending'],
            'reviews write' => ['reviews', 'POST', '/v2/reviews'],
            'search read' => ['search', 'GET', '/v2/search'],
            'search write' => ['search', 'POST', '/v2/search/saved'],
            'polls read' => ['polls', 'GET', '/v2/polls'],
            'polls write' => ['polls', 'POST', '/v2/polls'],
            'goals read' => ['goals', 'GET', '/v2/goals'],
            'goals write' => ['goals', 'POST', '/v2/goals'],
            'gamification read' => ['gamification', 'GET', '/v2/gamification/profile'],
            'gamification write' => ['gamification', 'POST', '/v2/gamification/daily-reward'],
            'AI chat read' => ['ai_chat', 'GET', '/ai/chat/starters'],
            'AI chat write' => ['ai_chat', 'POST', '/ai/chat'],
            'blog read' => ['blog', 'GET', '/v2/blog'],
            'resources read' => ['resources', 'GET', '/v2/resources'],
            'resources write' => ['resources', 'POST', '/v2/resources'],
        ];
    }

    /**
     * @dataProvider featureRoutePatterns
     */
    public function test_all_feature_owned_routes_keep_their_server_side_gate(
        string $feature,
        string $pattern,
    ): void {
        $ownedRoutes = collect(Route::getRoutes()->getRoutes())
            ->filter(static fn ($route): bool => preg_match($pattern, $route->uri()) === 1);

        $this->assertNotEmpty($ownedRoutes, "No routes matched the {$feature} ownership pattern.");

        foreach ($ownedRoutes as $route) {
            $this->assertContains(
                "feature:{$feature}",
                $route->gatherMiddleware(),
                "{$route->methods()[0]} {$route->uri()} is missing feature:{$feature}",
            );
        }
    }

    /** @return array<string, array{string, string}> */
    public static function featureRoutePatterns(): array
    {
        return [
            'connections' => ['connections', '#^api/v2/connections(?:/|$)#'],
            'reviews' => ['reviews', '#^api/v2/(?:reviews(?:/|$)|users/[^/]+/reviews$|admin/reviews(?:/|$))#'],
            'search' => ['search', '#^api/v2/search(?:/|$)#'],
            'polls' => ['polls', '#^api/(?:v2/polls(?:/|$)|v2/feed/polls(?:/|$)|v2/admin/polls(?:/|$)|polls(?:/|$))#'],
            'goals' => ['goals', '#^api/(?:v2/goals(?:/|$)|v2/admin/goals(?:/|$)|goals(?:/|$))#'],
            'gamification' => ['gamification', '#^api/(?:v2/gamification(?:/|$)|v2/admin/gamification(?:/|$)|v2/admin/users/badges/recheck-all$|leaderboard(?:/|$)|streaks$|achievements(?:/|$)|daily-reward(?:/|$)|gamification(?:/|$)|shop/purchase$|nexus-score(?:/|$))#'],
            'AI chat' => ['ai_chat', '#^api/ai(?:/|$)#'],
            'blog' => ['blog', '#^api/v2/(?:blog(?:/|$)|admin/blog(?:/|$))#'],
            'resources' => ['resources', '#^api/v2/(?:resources(?:/|$)|admin/resources(?:/|$))#'],
        ];
    }

    private function disableModule(string $module): void
    {
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update([
                'configuration' => json_encode(['modules' => [$module => false]]),
            ]);

        TenantContext::setById($this->testTenantId);
    }

    private function disableFeature(string $feature): void
    {
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update([
                'features' => json_encode([$feature => false]),
            ]);

        TenantContext::setById($this->testTenantId);
    }
}
