<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\UnfinishedFeaturesService;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Unfinished features: every feature marked alpha or
 * beta on the admin Features page, plus every feature that is off unless a
 * community switches it on, and which communities have each one on.
 *
 * Read-only. The stage lives in react-frontend's moduleRegistry.ts; the
 * server keeps a copy (UnfinishedFeaturesService::STAGES) and one test below
 * fails when the two disagree in either direction.
 */
class UnfinishedFeaturesTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/unfinished-features';

    private const REGISTRY = 'react-frontend/src/admin/modules/config/moduleRegistry.ts';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['features'];

    private const ROW_KEYS = ['key', 'stage', 'default_on', 'note', 'communities_on', 'count'];

    private const COMMUNITY_KEYS = ['id', 'name'];

    /** @param array<string, mixed>|null $features */
    private function community(?array $features, array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Unfinished Test ' . $suffix,
            'slug' => 'unfinished-' . $suffix,
            'is_active' => 1,
            'features' => $features === null ? null : json_encode($features),
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
    private function feature(array $data, string $key): array
    {
        foreach ($data['features'] as $row) {
            if ($row['key'] === $key) {
                return $row;
            }
        }
        $this->fail("feature {$key} is not listed");
    }

    /**
     * @param array<string, mixed> $row
     * @return list<int>
     */
    private static function ids(array $row): array
    {
        return array_map(static fn (array $c): int => (int) $c['id'], $row['communities_on']);
    }

    /** @return list<string> */
    private static function sorted(array $keys): array
    {
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_carries_exactly_what_the_page_shows(): void
    {
        $id = $this->community(['courses' => true]);
        DB::table('users')->insert([
            'tenant_id' => $id,
            'name' => 'Unfinishedfirst Unfinishedsurname',
            'first_name' => 'Unfinishedfirst',
            'last_name' => 'Unfinishedsurname',
            'email' => 'unfinished-' . Str::lower(Str::random(12)) . '@example.test',
            'status' => 'active',
        ]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::sorted(self::TOP_KEYS), self::sorted(array_keys($data)));
        $this->assertNotEmpty($data['features']);
        foreach ($data['features'] as $row) {
            $this->assertSame(self::sorted(self::ROW_KEYS), self::sorted(array_keys($row)));
            foreach ($row['communities_on'] as $community) {
                $this->assertSame(self::sorted(self::COMMUNITY_KEYS), self::sorted(array_keys($community)));
            }
        }
        // Community names and switches only: no member data rides along.
        $body = (string) $response->getContent();
        foreach (['Unfinishedfirst', 'Unfinishedsurname', '@example.test'] as $needle) {
            $this->assertStringNotContainsString($needle, $body);
        }
    }

    public function test_it_lists_staged_features_and_features_that_are_off_unless_switched_on(): void
    {
        $this->actAsPlatformTeam();
        $data = $this->data();
        $listed = array_column($data['features'], 'key');

        $expected = array_keys(UnfinishedFeaturesService::STAGES);
        foreach (TenantFeatureConfig::FEATURE_DEFAULTS as $key => $on) {
            if ($on === false) {
                $expected[] = $key;
            }
        }
        $this->assertSame(self::sorted(array_values(array_unique($expected))), self::sorted($listed));
        $this->assertCount(count(array_unique($listed)), $listed, 'a feature is listed twice');

        // A finished feature that is on for everyone is not unfinished.
        $this->assertNotContains('events', $listed);
        $this->assertNotContains('groups', $listed);

        $courses = $this->feature($data, 'courses');
        $this->assertSame('beta', $courses['stage']);
        $this->assertFalse($courses['default_on']);
        $this->assertNull($courses['note']);

        $maps = $this->feature($data, 'maps');
        $this->assertNull($maps['stage']);
        $this->assertFalse($maps['default_on']);
    }

    public function test_caring_community_is_listed_as_not_for_use(): void
    {
        $this->actAsPlatformTeam();
        $row = $this->feature($this->data(), 'caring_community');

        $this->assertSame('alpha', $row['stage']);
        $this->assertSame('not_for_use', $row['note']);
        $this->assertFalse($row['default_on']);
    }

    public function test_only_caring_community_carries_a_note(): void
    {
        $this->actAsPlatformTeam();
        foreach ($this->data()['features'] as $row) {
            if ($row['key'] !== 'caring_community') {
                $this->assertNull($row['note'], "{$row['key']} carries a note");
            }
        }
    }

    public function test_on_means_what_the_platform_itself_works_out(): void
    {
        $switchedOn = $this->community(['podcasts' => true, 'courses' => '1']);
        $switchedOff = $this->community(['podcasts' => false, 'courses' => 0]);
        $neverTouched = $this->community(null);
        $this->actAsPlatformTeam();
        $data = $this->data();

        foreach (['podcasts', 'courses'] as $key) {
            $row = $this->feature($data, $key);
            $ids = self::ids($row);
            $this->assertContains($switchedOn, $ids, "{$key}: switched on");
            $this->assertNotContains($switchedOff, $ids, "{$key}: switched off");
            $this->assertNotContains($neverTouched, $ids, "{$key}: off by default");
            $this->assertSame(count($ids), $row['count']);
        }

        $name = DB::table('tenants')->where('id', $switchedOn)->value('name');
        $listed = array_values(array_filter($this->feature($data, 'podcasts')['communities_on'], static fn (array $c): bool => (int) $c['id'] === $switchedOn));
        $this->assertSame($name, $listed[0]['name']);
    }

    public function test_it_counts_every_community_the_way_merge_features_does(): void
    {
        $this->community(['partner_venues' => true]);
        $this->community(['partner_venues' => true], ['is_active' => 0]);
        $this->actAsPlatformTeam();

        $expected = 0;
        foreach (DB::table('tenants')->get(['features']) as $tenant) {
            $stored = is_string($tenant->features) ? json_decode($tenant->features, true) : null;
            $merged = TenantFeatureConfig::mergeFeatures(is_array($stored) ? $stored : null);
            if (!empty($merged['partner_venues'])) {
                $expected++;
            }
        }

        $this->assertSame($expected, $this->feature($this->data(), 'partner_venues')['count']);
    }

    public function test_staged_features_come_first_alpha_then_beta(): void
    {
        $this->actAsPlatformTeam();
        $order = ['alpha' => 0, 'beta' => 1];
        $last = -1;
        foreach ($this->data()['features'] as $row) {
            $rank = $order[$row['stage']] ?? 2;
            $this->assertGreaterThanOrEqual($last, $rank, "{$row['key']} is out of order");
            $last = $rank;
        }
    }

    /**
     * The stage of each feature is set in the admin Features page's registry.
     * The API image does not ship react-frontend/, hence the PHP copy; a stage
     * added, changed or removed there without the copy following would make
     * this page wrong, so the two must agree in both directions.
     */
    public function test_the_server_copy_of_the_stages_matches_the_react_registry(): void
    {
        $path = base_path(self::REGISTRY);
        if (!is_file($path)) {
            $this->markTestSkipped('a checkout without the frontend (the API image)');
        }
        $source = (string) file_get_contents($path);
        [$stages, $optionStages] = self::registryStages($source);

        // Every stage in the file must be one this test understood; a
        // reformatted registry fails here instead of passing with nothing read.
        $allStages = preg_match_all("/\bstage: '(alpha|beta)'/", $source);
        $this->assertSame($allStages, count($stages) + $optionStages, 'moduleRegistry.ts has a stage this test cannot place');
        $this->assertNotEmpty($stages);

        ksort($stages);
        $copy = UnfinishedFeaturesService::STAGES;
        ksort($copy);
        $this->assertSame($stages, $copy, 'UnfinishedFeaturesService::STAGES differs from moduleRegistry.ts');
    }

    /**
     * Review 16 Nov: the reader went line by line, so a `stage:` written
     * before its module's `id:` was credited to the module above. It now
     * reads each module's `{ ... }` block as a whole.
     */
    public function test_the_registry_reader_gives_each_stage_to_its_own_module_whatever_the_order(): void
    {
        $snippet = <<<'TS'
            export const MODULES = [
              {
                id: 'first_module',
                icon: Calendar,
                type: 'feature',
                configOptions: [],
              },
              {
                // A comment with a brace { that is not code.
                stage: 'alpha',
                id: 'second_module',
                configOptions: [
                  { key: 'second_module.option', type: 'boolean', stage: 'beta' },
                ],
                note: 'a string with a } brace',
              },
              {
                id: 'third_module',
                stage: 'beta',
              },
            ];
            TS;

        [$stages, $optionStages] = self::registryStages($snippet);

        $this->assertSame(['second_module' => 'alpha', 'third_module' => 'beta'], $stages);
        $this->assertSame(1, $optionStages);
    }

    /**
     * Each module of the registry array is a `{ ... }` block opened at two
     * spaces' indent; read it whole (braces balanced from its opening brace,
     * ignoring braces inside quotes and `//` comments). Its own `id:` and
     * `stage:` are the ones at four spaces' indent; a stage on an option line
     * (`{ key: ... stage: ... }`) is counted apart.
     *
     * @return array{0: array<string, string>, 1: int} stages by module id, option stages
     */
    private static function registryStages(string $source): array
    {
        $stages = [];
        $optionStages = 0;
        $offset = 0;

        while (preg_match('/^ {2}\{\s*$/m', $source, $m, PREG_OFFSET_CAPTURE, $offset) === 1) {
            $start = (int) $m[0][1] + 2;
            $end = self::closingBrace($source, $start);
            self::assertNotNull($end, 'a module block that never closes');
            $block = substr($source, $start, $end - $start + 1);
            $offset = $end + 1;

            $id = preg_match("/^ {4}id: '([a-z0-9_]+)',/m", $block, $idMatch) === 1 ? $idMatch[1] : null;
            if (preg_match("/^ {4}stage: '(alpha|beta)',/m", $block, $stageMatch) === 1) {
                self::assertNotNull($id, 'a module with a stage and no id');
                $stages[$id] = $stageMatch[1];
            }
            $optionStages += preg_match_all("/\{ key: '[^']+'.*stage: '(alpha|beta)'/", $block);
        }

        return [$stages, $optionStages];
    }

    /** Position of the brace that closes the one at $open, or null. */
    private static function closingBrace(string $source, int $open): ?int
    {
        $depth = 0;
        $length = strlen($source);
        for ($i = $open; $i < $length; $i++) {
            $char = $source[$i];
            if ($char === '/' && ($source[$i + 1] ?? '') === '/') {
                $newline = strpos($source, "\n", $i);
                $i = $newline === false ? $length : $newline;
                continue;
            }
            if ($char === "'" || $char === '"' || $char === '`') {
                for ($i++; $i < $length && $source[$i] !== $char; $i++) {
                    if ($source[$i] === '\\') {
                        $i++;
                    }
                }
                continue;
            }
            if ($char === '{') {
                $depth++;
            } elseif ($char === '}') {
                $depth--;
                if ($depth === 0) {
                    return $i;
                }
            }
        }

        return null;
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();
        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI)->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
