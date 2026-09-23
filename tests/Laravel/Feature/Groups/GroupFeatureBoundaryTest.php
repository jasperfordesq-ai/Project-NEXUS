<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Http\Controllers\Api\AdminGroupsController;
use App\Http\Controllers\Api\CourseGroupController;
use App\Http\Controllers\Api\GroupConversationController;
use App\Http\Controllers\Api\GroupExchangeController;
use App\Http\Controllers\Api\GroupRecommendController;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupFeatureBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
    }

    public function test_every_end_user_groups_route_has_the_feature_boundary(): void
    {
        $routes = array_values(array_filter(
            iterator_to_array(Route::getRoutes()),
            fn (LaravelRoute $route): bool => $this->isEndUserGroupsSurface($route),
        ));

        // 143 since the legacy GET /api/groups directory was retired (F-145).
        self::assertCount(143, $routes, 'The end-user Groups API route inventory changed.');
        foreach ($routes as $route) {
            self::assertContains(
                'feature:groups',
                $route->middleware(),
                sprintf(
                    '%s %s is missing the Groups tenant feature boundary.',
                    implode('|', $route->methods()),
                    $route->uri(),
                ),
            );
        }
    }

    public function test_every_numeric_groups_identifier_is_route_constrained(): void
    {
        $numericParameters = [
            'id',
            'groupId',
            'courseId',
            'userId',
            'discussionId',
            'announcementId',
            'fileId',
            'inviteId',
            'questionId',
            'answerId',
            'pageId',
            'mediaId',
            'webhookId',
            'challengeId',
            'postId',
            'chatroomId',
            'messageId',
        ];

        foreach (Route::getRoutes() as $route) {
            if (! $this->isEndUserGroupsSurface($route)) {
                continue;
            }

            foreach ($route->parameterNames() as $parameter) {
                if (! in_array($parameter, $numericParameters, true)) {
                    continue;
                }

                self::assertSame(
                    '[0-9]+',
                    $route->wheres[$parameter] ?? null,
                    sprintf(
                        '%s %s must constrain {%s} to a positive numeric route segment.',
                        implode('|', $route->methods()),
                        $route->uri(),
                        $parameter,
                    ),
                );
            }
        }
    }

    public static function disabledRepresentatives(): iterable
    {
        yield 'directory' => ['/v2/groups'];
        yield 'detail' => ['/v2/groups/999999999'];
        yield 'challenge' => ['/v2/groups/999999999/challenges'];
        yield 'chatroom child route' => ['/v2/group-chatrooms/999999999/messages'];
        yield 'course linkage' => ['/v2/groups/999999999/courses'];
        yield 'group marketplace' => ['/v2/marketplace/groups/999999999/listings'];
    }

    public static function disabledOutlyingGroupRoutes(): iterable
    {
        yield 'conversation create' => ['POST', '/v2/conversations/groups'];
        yield 'conversation directory' => ['GET', '/v2/conversations/groups'];
        yield 'conversation participants' => ['GET', '/v2/conversations/999999999/participants'];
        yield 'conversation participant add' => ['POST', '/v2/conversations/999999999/participants'];
        yield 'conversation participant remove' => ['DELETE', '/v2/conversations/999999999/participants/999999998'];
        yield 'conversation update' => ['PATCH', '/v2/conversations/999999999/group'];
        yield 'conversation messages' => ['GET', '/v2/conversations/999999999/messages'];
        yield 'conversation message send' => ['POST', '/v2/conversations/999999999/messages'];

        yield 'legacy recommendation directory' => ['GET', '/recommendations/groups'];
        yield 'legacy recommendation track' => ['POST', '/recommendations/track'];
        yield 'legacy recommendation metrics' => ['GET', '/recommendations/metrics'];
        yield 'legacy similar groups' => ['GET', '/recommendations/similar/999999999'];

        yield 'exchange directory' => ['GET', '/v2/group-exchanges'];
        yield 'exchange create' => ['POST', '/v2/group-exchanges'];
        yield 'exchange detail' => ['GET', '/v2/group-exchanges/999999999'];
        yield 'exchange update' => ['PUT', '/v2/group-exchanges/999999999'];
        yield 'exchange delete' => ['DELETE', '/v2/group-exchanges/999999999'];
        yield 'exchange participant add' => ['POST', '/v2/group-exchanges/999999999/participants'];
        yield 'exchange participant remove' => ['DELETE', '/v2/group-exchanges/999999999/participants/999999998'];
        yield 'exchange start' => ['POST', '/v2/group-exchanges/999999999/start'];
        yield 'exchange confirm' => ['POST', '/v2/group-exchanges/999999999/confirm'];
        yield 'exchange complete' => ['POST', '/v2/group-exchanges/999999999/complete'];

        yield 'legacy groups analytics' => ['GET', '/groups/999999999/analytics'];
    }

    /** @dataProvider disabledRepresentatives */
    public function test_disabled_groups_feature_blocks_route_families_before_controller_work(string $uri): void
    {
        $this->setGroupsFeature(false);

        $this->apiGet($uri)
            ->assertStatus(403)
            ->assertHeader('API-Version', '2.0')
            ->assertJsonPath('success', false)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED')
            ->assertJsonPath('errors.0.message', __('api.service_unavailable'));
    }

    /** @dataProvider disabledOutlyingGroupRoutes */
    public function test_disabled_groups_feature_blocks_every_outlying_group_route(
        string $method,
        string $uri,
    ): void {
        $this->setGroupsFeature(false);

        $this->json($method, '/api' . $uri, [], $this->withTenantHeader())
            ->assertStatus(403)
            ->assertHeader('API-Version', '2.0')
            ->assertJsonPath('success', false)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED')
            ->assertJsonPath('errors.0.message', __('api.service_unavailable'));
    }

    public function test_per_type_policy_aliases_are_absent_and_return_not_found(): void
    {
        $matchingRoutes = array_values(array_filter(
            iterator_to_array(Route::getRoutes()),
            static fn (LaravelRoute $route): bool => $route->uri() === 'api/v2/admin/groups/types/{id}/policies',
        ));
        self::assertSame([], $matchingRoutes);

        $this->apiGet('/v2/admin/groups/types/999999999/policies')->assertNotFound();
        $this->apiPut('/v2/admin/groups/types/999999999/policies', [])->assertNotFound();
    }

    public function test_enabled_groups_feature_reaches_controller_lookup(): void
    {
        $this->setGroupsFeature(true);

        $this->apiGet('/v2/groups/999999999')
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_FOUND');
    }

    private function setGroupsFeature(bool $enabled): void
    {
        $features = array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['groups' => $enabled]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function isEndUserGroupsSurface(LaravelRoute $route): bool
    {
        $uri = $route->uri();
        $prefixes = [
            'api/v2/groups',
            'api/v2/group-tags',
            'api/v2/group-templates',
            'api/v2/group-collections',
            'api/v2/group-chatroom',
            'api/v2/team-tasks',
            'api/v2/team-documents',
            'api/v2/marketplace/groups',
        ];

        foreach ($prefixes as $prefix) {
            if (str_starts_with($uri, $prefix)) {
                return true;
            }
        }

        $action = $route->getActionName();

        return str_starts_with($action, CourseGroupController::class . '@')
            || str_starts_with($action, GroupConversationController::class . '@')
            || str_starts_with($action, GroupExchangeController::class . '@')
            || str_starts_with($action, GroupRecommendController::class . '@')
            || $action === AdminGroupsController::class . '@apiData';
    }
}
