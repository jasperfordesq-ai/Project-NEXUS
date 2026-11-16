<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Deployments: the last deployments and rollbacks this
 * server recorded, read from the tail of the deploy record file. An allowlist
 * of fields per line; a missing file is "this server keeps no record", never
 * "no deployments".
 */
class DeploymentsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/deployments';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['available', 'deployments', 'limit', 'skipped_lines'];

    private const ROW_KEYS = ['color', 'commit_distance', 'commit_short', 'duration_s', 'status', 'subcommand', 'subject', 'timestamp'];

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/pt-deploys-' . bin2hex(random_bytes(6));
        mkdir($this->dir);
        config(['platform_team.deploy_history_path' => $this->dir . '/deploys.jsonl']);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
        parent::tearDown();
    }

    /** @param array<string, mixed> $over */
    private function line(int $n, array $over = []): string
    {
        return json_encode(array_merge([
            'timestamp' => sprintf('2026-11-%02dT10:00:00+00:00', 1 + ($n % 28)),
            'host' => 'planted-host-name',
            'subcommand' => 'deploy',
            'status' => 'success',
            'commit' => 'feedfacefeedfacefeedfacefeedfacefeedface',
            'commit_short' => sprintf('%08x', $n),
            'subject' => "change number {$n}",
            'prev_commit' => 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
            'commit_distance' => 3,
            'color' => 'blue',
            'duration_s' => 125,
        ], $over), JSON_THROW_ON_ERROR);
    }

    /** @param list<string> $lines */
    private function writeFile(array $lines): void
    {
        file_put_contents($this->dir . '/deploys.jsonl', $lines === [] ? '' : implode("\n", $lines) . "\n");
    }

    /** @return array<string, mixed> */
    private function data(): array
    {
        $this->actAsPlatformTeam();

        return $this->apiGet(self::URI)->assertStatus(200)->json('data');
    }

    /**
     * @param array<string, mixed> $array
     * @return list<string>
     */
    private function sortedKeys(array $array): array
    {
        $keys = array_keys($array);
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->writeFile([$this->line(1)]);
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_a_missing_file_is_not_available_never_an_empty_list(): void
    {
        $data = $this->data();

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertFalse($data['available']);
        $this->assertNull($data['deployments']);
        $this->assertNull($data['skipped_lines']);
        $this->assertSame(30, $data['limit']);
    }

    public function test_an_empty_file_is_available_with_nothing_recorded(): void
    {
        $this->writeFile([]);

        $data = $this->data();

        $this->assertTrue($data['available']);
        $this->assertSame([], $data['deployments']);
        $this->assertSame(0, $data['skipped_lines']);
    }

    public function test_it_sends_only_the_allowed_fields_newest_first_and_counts_junk_lines(): void
    {
        $this->writeFile([
            $this->line(1),
            $this->line(2, ['subcommand' => 'rollback', 'commit_distance' => -2, 'color' => 'green']),
            'this is {not json',
            $this->line(3, ['status' => 'failed', 'duration_s' => 61]),
            $this->line(4, ['subcommand' => 'surprise', 'status' => 'odd', 'duration_s' => 'slow', 'commit_distance' => '5',
                'subject' => str_repeat('x', 500), 'extra_field' => 'planted-extra-value']),
        ]);

        $response = $this->apiGet(self::URI); // unauthenticated first: must not answer
        $this->assertContains($response->getStatusCode(), [401, 403]);

        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertTrue($data['available']);
        $this->assertSame(1, $data['skipped_lines']);
        $this->assertCount(4, $data['deployments']);
        foreach ($data['deployments'] as $row) {
            $this->assertSame(self::ROW_KEYS, $this->sortedKeys($row));
        }

        [$fourth, $third, $second, $first] = $data['deployments'];

        // Unknown values are passed through as other / unknown, not dropped; wrong types become null.
        $this->assertSame('other', $fourth['subcommand']);
        $this->assertSame('unknown', $fourth['status']);
        $this->assertNull($fourth['duration_s']);
        $this->assertNull($fourth['commit_distance']);
        $this->assertSame(200, mb_strlen($fourth['subject']));

        $this->assertSame('failed', $third['status']);
        $this->assertSame(61, $third['duration_s']);

        $this->assertSame('rollback', $second['subcommand']);
        $this->assertSame(-2, $second['commit_distance']);
        $this->assertSame('green', $second['color']);

        $this->assertSame([
            'color' => 'blue',
            'commit_distance' => 3,
            'commit_short' => '00000001',
            'duration_s' => 125,
            'status' => 'success',
            'subcommand' => 'deploy',
            'subject' => 'change number 1',
            'timestamp' => '2026-11-02T10:00:00+00:00',
        ], array_combine(self::ROW_KEYS, array_map(fn ($k) => $first[$k], self::ROW_KEYS)));

        // 🔴 Never the server name, the full commit, the previous commit, or a field outside the list.
        $body = (string) $response->getContent();
        foreach (['planted-host-name', 'feedfacefeedface', 'deadbeefdeadbeef', 'planted-extra-value', 'extra_field', 'prev_commit'] as $planted) {
            $this->assertStringNotContainsString($planted, $body);
        }
    }

    public function test_it_keeps_only_the_newest_thirty(): void
    {
        $lines = [];
        for ($n = 1; $n <= 45; $n++) {
            $lines[] = $this->line($n);
        }
        $this->writeFile($lines);

        $data = $this->data();

        $this->assertCount(30, $data['deployments']);
        $this->assertSame(sprintf('%08x', 45), $data['deployments'][0]['commit_short']);
        $this->assertSame(sprintf('%08x', 16), $data['deployments'][29]['commit_short']);
    }

    public function test_a_file_larger_than_the_tail_window_still_answers_with_the_newest_lines(): void
    {
        $lines = [];
        for ($n = 1; $n <= 300; $n++) {
            $lines[] = $this->line($n, ['subject' => "padding {$n} " . str_repeat('p', 2000)]);
        }
        for ($n = 301; $n <= 303; $n++) {
            $lines[] = $this->line($n);
        }
        $this->writeFile($lines);
        $this->assertGreaterThan(256 * 1024 * 2, filesize($this->dir . '/deploys.jsonl'));

        $data = $this->data();

        $this->assertTrue($data['available']);
        $this->assertCount(30, $data['deployments']);
        $this->assertSame(sprintf('%08x', 303), $data['deployments'][0]['commit_short']);
        $this->assertSame('change number 303', $data['deployments'][0]['subject']);
        $this->assertSame(sprintf('%08x', 274), $data['deployments'][29]['commit_short']);
        // The partial first line of the window is dropped, not counted as unreadable.
        $this->assertSame(0, $data['skipped_lines']);
    }

    public function test_a_path_that_is_not_a_file_is_not_available(): void
    {
        config(['platform_team.deploy_history_path' => $this->dir]);

        $data = $this->data();

        $this->assertFalse($data['available']);
        $this->assertNull($data['deployments']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, [])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
