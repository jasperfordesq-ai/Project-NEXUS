<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Http\Controllers\Api\GroupAnalyticsController;
use App\Http\Controllers\Api\GroupChallengeController;
use App\Http\Controllers\Api\GroupFilesController;
use App\Http\Controllers\Api\GroupMediaController;
use App\Http\Controllers\Api\GroupQAController;
use App\Http\Controllers\Api\GroupScheduledPostController;
use App\Http\Controllers\Api\GroupsController;
use App\Http\Controllers\Api\GroupWikiController;
use App\Http\Controllers\Api\IdeationChallengesController;
use App\Models\User;
use App\Services\GroupConfigurationService;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupTabFeatureBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $features = array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['groups' => true]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
    }

    public function test_every_configurable_tab_route_has_the_expected_server_boundary(): void
    {
        $protected = [];

        foreach (Route::getRoutes() as $route) {
            $expectedTab = $this->expectedTab($route);
            if ($expectedTab === null) {
                continue;
            }

            $protected[] = $route;
            self::assertContains(
                'group.tab:' . $expectedTab,
                $route->middleware(),
                sprintf(
                    '%s %s is missing the %s Groups tab boundary.',
                    implode('|', $route->methods()),
                    $route->uri(),
                    $expectedTab,
                ),
            );
        }

        self::assertCount(63, $protected, 'The configurable Groups tab route inventory changed.');
    }

    public function test_scheduled_routes_delegate_dynamic_content_tab_policy_to_the_service(): void
    {
        $routes = collect(Route::getRoutes())
            ->filter(static fn (LaravelRoute $route): bool => str_starts_with(
                $route->getActionName(),
                GroupScheduledPostController::class . '@',
            ));

        self::assertCount(3, $routes);
        foreach ($routes as $route) {
            self::assertNotContains('group.tab:announcements', $route->middleware());
            self::assertNotContains('group.tab:discussion', $route->middleware());
        }
    }

    public static function disabledTabRepresentatives(): iterable
    {
        yield 'members' => [GroupConfigurationService::CONFIG_TAB_MEMBERS, '/v2/groups/999999999/members'];
        yield 'discussion' => [GroupConfigurationService::CONFIG_TAB_DISCUSSION, '/v2/groups/999999999/discussions'];
        yield 'announcements' => [GroupConfigurationService::CONFIG_TAB_ANNOUNCEMENTS, '/v2/groups/999999999/announcements'];
        yield 'files' => [GroupConfigurationService::CONFIG_TAB_FILES, '/v2/groups/999999999/files'];
        yield 'analytics' => [GroupConfigurationService::CONFIG_TAB_ANALYTICS, '/v2/groups/999999999/analytics'];
        yield 'questions and answers' => [GroupConfigurationService::CONFIG_TAB_QA, '/v2/groups/999999999/questions'];
        yield 'wiki' => [GroupConfigurationService::CONFIG_TAB_WIKI, '/v2/groups/999999999/wiki'];
        yield 'media' => [GroupConfigurationService::CONFIG_TAB_MEDIA, '/v2/groups/999999999/media'];
        yield 'challenges' => [GroupConfigurationService::CONFIG_TAB_CHALLENGES, '/v2/groups/999999999/challenges'];
        yield 'chatrooms' => [GroupConfigurationService::CONFIG_TAB_CHATROOMS, '/v2/group-chatrooms/999999999/messages'];
        yield 'tasks' => [GroupConfigurationService::CONFIG_TAB_TASKS, '/v2/team-tasks/999999999'];
    }

    /** @dataProvider disabledTabRepresentatives */
    public function test_disabled_tab_policy_blocks_route_before_controller_work(string $configKey, string $uri): void
    {
        GroupConfigurationService::set($configKey, false);
        // HTTP-kernel tests may use a second DB connection that cannot see this
        // test transaction. Prime the same production cache boundary explicitly.
        Cache::put('group_config:' . $this->testTenantId, [$configKey => false], 3600);

        try {
            $this->apiGet($uri)
                ->assertStatus(403)
                ->assertHeader('API-Version', '2.0')
                ->assertJsonPath('success', false)
                ->assertJsonPath('errors.0.code', 'GROUP_TAB_DISABLED')
                ->assertJsonPath('errors.0.message', __('api.service_unavailable'));
        } finally {
            Cache::forget('group_config:' . $this->testTenantId);
        }
    }

    private function expectedTab(LaravelRoute $route): ?string
    {
        [$controller, $method] = array_pad(explode('@', $route->getActionName(), 2), 2, '');

        $controllerTabs = [
            GroupFilesController::class => 'files',
            GroupAnalyticsController::class => 'analytics',
            GroupQAController::class => 'qa',
            GroupWikiController::class => 'wiki',
            GroupMediaController::class => 'media',
            GroupChallengeController::class => 'challenges',
        ];
        if (isset($controllerTabs[$controller])) {
            return $controllerTabs[$controller];
        }

        if ($controller === GroupsController::class) {
            return [
                'members' => 'members',
                'discussions' => 'discussion',
                'createDiscussion' => 'discussion',
                'discussionMessages' => 'discussion',
                'postToDiscussion' => 'discussion',
                'announcements' => 'announcements',
                'createAnnouncement' => 'announcements',
                'updateAnnouncement' => 'announcements',
                'deleteAnnouncement' => 'announcements',
            ][$method] ?? null;
        }

        if ($controller === IdeationChallengesController::class) {
            return [
                'listChatrooms' => 'chatrooms',
                'createChatroom' => 'chatrooms',
                'deleteChatroom' => 'chatrooms',
                'chatroomMessages' => 'chatrooms',
                'postChatroomMessage' => 'chatrooms',
                'deleteChatroomMessage' => 'chatrooms',
                'pinChatroomMessage' => 'chatrooms',
                'unpinChatroomMessage' => 'chatrooms',
                'pinnedChatroomMessages' => 'chatrooms',
                'listTasks' => 'tasks',
                'createTask' => 'tasks',
                'showTask' => 'tasks',
                'updateTask' => 'tasks',
                'deleteTask' => 'tasks',
                'taskStats' => 'tasks',
                'listDocuments' => 'files',
                'uploadDocument' => 'files',
                'deleteDocument' => 'files',
            ][$method] ?? null;
        }

        return null;
    }
}
