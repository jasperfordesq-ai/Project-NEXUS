<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\CommunitiesAtAGlanceService;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Communities at a glance: every community against
 * every feature and core part, on or off, plus the features a platform-wide
 * switch is holding off. Read-only: switches are changed where they always
 * were, one community at a time.
 */
class CommunitiesAtAGlanceTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/communities';

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Glance Test ' . $suffix,
            'slug' => 'glance-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    /** @return array<string, mixed> */
    private function data(): array
    {
        return $this->apiGet(self::URI)->assertStatus(200)->json('data');
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function row(array $data, int $communityId): array
    {
        foreach ($data['communities'] as $row) {
            if ((int) $row['id'] === $communityId) {
                return $row;
            }
        }
        $this->fail("community {$communityId} is not in the grid");
    }

    private function attendanceCreditsPlatformSwitch(string $mode): void
    {
        DB::table('platform_capability_overrides')->where('capability', 'attendance_credits')->delete();
        Cache::forget('platform_capability_overrides');
        config(['events.attendance_credit_mode' => $mode]);
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_a_community_with_nothing_stored_shows_the_defaults(): void
    {
        $id = $this->community(['features' => null]);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        foreach (CommunitiesAtAGlanceService::features() as $feature) {
            $this->assertSame(TenantFeatureConfig::FEATURE_DEFAULTS[$feature], $row['features'][$feature], $feature);
        }
        foreach (array_keys(TenantFeatureConfig::MODULE_DEFAULTS) as $module) {
            $this->assertSame(TenantFeatureConfig::MODULE_DEFAULTS[$module], $row['modules'][$module], $module);
        }
    }

    public function test_it_shows_what_each_community_has_switched_on_and_off(): void
    {
        $id = $this->community([
            'features' => json_encode(['events' => false, 'marketplace' => true]),
            'configuration' => json_encode(['modules' => ['wallet' => false]]),
        ]);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertFalse($row['features']['events']);      // default on, switched off
        $this->assertTrue($row['features']['marketplace']);   // default off, switched on
        $this->assertTrue($row['features']['groups']);        // untouched default
        $this->assertFalse($row['modules']['wallet']);
        $this->assertTrue($row['modules']['listings']);
    }

    public function test_the_columns_are_the_known_features_and_core_parts_in_order(): void
    {
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame(CommunitiesAtAGlanceService::features(), $data['features']);
        $this->assertSame(array_keys(TenantFeatureConfig::MODULE_DEFAULTS), $data['modules']);
        $this->assertContains('events', $data['features']);
        foreach ($data['communities'] as $row) {
            $this->assertSame($data['features'], array_keys($row['features']));
            $this->assertSame($data['modules'], array_keys($row['modules']));
        }
    }

    /** The unfinished alpha feature is not a column, whatever a community has stored. */
    public function test_the_alpha_feature_is_never_in_the_grid(): void
    {
        $this->community(['features' => json_encode(['caring_community' => true])]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);

        $this->assertNotContains('caring_community', $response->json('data.features'));
        $this->assertStringNotContainsString('caring_community', $response->getContent());
    }

    /** A setting nobody defined (left behind by old code) is not a column either. */
    public function test_a_stored_switch_the_platform_does_not_know_is_left_out(): void
    {
        $id = $this->community(['features' => json_encode(['glance_test_unknown_switch' => true])]);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertArrayNotHasKey('glance_test_unknown_switch', $row['features']);
    }

    public function test_it_names_each_community_and_says_when_one_is_not_active(): void
    {
        $active = $this->community();
        $inactive = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertTrue($this->row($data, $active)['active']);
        $this->assertFalse($this->row($data, $inactive)['active']);
        $this->assertSame(
            ['active', 'features', 'id', 'modules', 'name', 'slug'],
            $this->sortedKeys($this->row($data, $active)),
        );
        $this->assertSame(
            (string) DB::table('tenants')->where('id', $active)->value('name'),
            $this->row($data, $active)['name'],
        );
    }

    public function test_a_feature_the_platform_switch_holds_off_is_marked(): void
    {
        $this->actAsPlatformTeam();

        $this->attendanceCreditsPlatformSwitch('off');
        $this->assertContains('event_attendance_credits', $this->data()['held_platform_wide']);

        $this->attendanceCreditsPlatformSwitch('treasury');
        $this->assertNotContains('event_attendance_credits', $this->data()['held_platform_wide']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $id = $this->community(['features' => json_encode(['events' => false])]);
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['id' => $id, 'features' => ['events' => true]])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
        $this->assertFalse($this->row($this->data(), $id)['features']['events']);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<int, string>
     */
    private function sortedKeys(array $row): array
    {
        $keys = array_keys($row);
        sort($keys);

        return $keys;
    }
}
