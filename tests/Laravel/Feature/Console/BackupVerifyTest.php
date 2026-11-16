<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Console;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * Regression guard for `backup:verify` — the backup dead-man's switch.
 *
 * Asserts it stays green for a fresh, non-empty dump and ALARMS (non-zero exit)
 * for every failure mode that means "the nightly backup is not protecting us":
 * the directory missing, no dump present, a zero-byte dump, and a stale dump.
 * Uses a throwaway temp directory via --dir so it never touches real backups.
 */
class BackupVerifyTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nexus_backup_verify_' . uniqid('', true);
        @mkdir($this->dir, 0777, true);
        // Backup alarms must never make a real outbound request from the test.
        Http::fake();
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($this->dir);
        parent::tearDown();
    }

    public function test_healthy_when_recent_non_empty_backup_exists(): void
    {
        $this->writeBackup('nexus_db_2026-06-21.sql.gz', 'gzipped-bytes', ageHours: 2);

        $exit = Artisan::call('backup:verify', ['--dir' => $this->dir]);
        $output = Artisan::output();

        $this->assertSame(0, $exit, $output);
        $this->assertStringContainsString('Backup healthy', $output);
    }

    public function test_alarms_when_directory_missing(): void
    {
        $missing = $this->dir . DIRECTORY_SEPARATOR . 'does-not-exist';

        $exit = Artisan::call('backup:verify', ['--dir' => $missing]);
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('does not exist', $output);
    }

    public function test_alarms_when_no_backup_present(): void
    {
        // Empty (but existing) directory — backups never ran.
        $exit = Artisan::call('backup:verify', ['--dir' => $this->dir]);
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('no database backup', $output);
    }

    public function test_alarms_when_newest_backup_is_zero_bytes(): void
    {
        $this->writeBackup('nexus_db_2026-06-21.sql.gz', '', ageHours: 1);

        $exit = Artisan::call('backup:verify', ['--dir' => $this->dir]);
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('zero bytes', $output);
    }

    public function test_alarms_when_newest_backup_is_stale(): void
    {
        // 40h old, beyond the default 26h threshold.
        $this->writeBackup('nexus_db_2026-06-19.sql.gz', 'gzipped-bytes', ageHours: 40);

        $exit = Artisan::call('backup:verify', ['--dir' => $this->dir]);
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('old', $output);
    }

    public function test_picks_newest_by_mtime_so_a_fresh_dump_clears_an_old_one(): void
    {
        // An old dump plus a fresh one: freshness is decided by the newest file,
        // not the count — the alarm must NOT fire while a recent dump exists.
        $this->writeBackup('nexus_db_2026-06-18.sql.gz', 'old-bytes', ageHours: 72);
        $this->writeBackup('nexus_db_2026-06-21.sql.gz', 'fresh-bytes', ageHours: 3);

        $exit = Artisan::call('backup:verify', ['--dir' => $this->dir]);
        $output = Artisan::output();

        $this->assertSame(0, $exit, $output);
        $this->assertStringContainsString('Backup healthy', $output);
    }

    /**
     * Every run, healthy or not, leaves its verdict in the cache for the
     * Platform team's home page (`backup:verify:status`, kept three days).
     */
    public function test_a_healthy_run_records_its_verdict(): void
    {
        Cache::forget('backup:verify:status');
        $this->writeBackup('nexus_db_2026-06-21.sql.gz', 'gzipped-bytes', ageHours: 2);

        $this->assertSame(0, Artisan::call('backup:verify', ['--dir' => $this->dir]));

        $verdict = Cache::get('backup:verify:status');
        $this->assertIsArray($verdict);
        $this->assertSame(['age_hours', 'checked_at', 'newest_at', 'size_bytes', 'state'], $this->sortedKeys($verdict));
        $this->assertSame('healthy', $verdict['state']);
        $this->assertSame(strlen('gzipped-bytes'), $verdict['size_bytes']);
        $this->assertEqualsWithDelta(2.0, $verdict['age_hours'], 0.2);
        $this->assertNotFalse(strtotime((string) $verdict['newest_at']));
        $this->assertNotFalse(strtotime((string) $verdict['checked_at']));
        // Never the server's folder or the file name.
        $this->assertStringNotContainsString($this->dir, json_encode($verdict, JSON_THROW_ON_ERROR));
    }

    public function test_every_alarm_records_its_verdict_too(): void
    {
        $cases = [
            'missing' => fn () => Artisan::call('backup:verify', ['--dir' => $this->dir . DIRECTORY_SEPARATOR . 'nope']),
            'missing ' => fn () => Artisan::call('backup:verify', ['--dir' => $this->dir]),
            'empty' => function () {
                $this->writeBackup('nexus_db_2026-06-21.sql.gz', '', ageHours: 1);

                return Artisan::call('backup:verify', ['--dir' => $this->dir]);
            },
            'stale' => function () {
                $this->writeBackup('nexus_db_2026-06-21.sql.gz', 'bytes', ageHours: 40);

                return Artisan::call('backup:verify', ['--dir' => $this->dir]);
            },
        ];

        foreach ($cases as $expected => $run) {
            Cache::forget('backup:verify:status');
            foreach (glob($this->dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
                @unlink($f);
            }

            $this->assertSame(1, $run(), "{$expected}: the alarm still fires");
            $verdict = Cache::get('backup:verify:status');
            $this->assertIsArray($verdict, $expected);
            $this->assertSame(trim($expected), $verdict['state']);
            $this->assertNotFalse(strtotime((string) $verdict['checked_at']));
        }

        $this->assertSame(40.0, round((float) Cache::get('backup:verify:status')['age_hours']));
    }

    public function test_a_broken_cache_does_not_change_the_check_or_its_exit_code(): void
    {
        Cache::extend('pt-broken', fn () => Cache::repository(new class extends \Illuminate\Cache\ArrayStore {
            public function put($key, $value, $seconds)
            {
                throw new \RuntimeException('cache is down');
            }
        }));
        config(['cache.stores.pt-broken' => ['driver' => 'pt-broken']]);
        $previous = Cache::getDefaultDriver();
        Cache::setDefaultDriver('pt-broken');

        try {
            $this->writeBackup('nexus_db_2026-06-21.sql.gz', 'gzipped-bytes', ageHours: 2);
            $this->assertSame(0, Artisan::call('backup:verify', ['--dir' => $this->dir]));

            $this->writeBackup('nexus_db_2026-06-21.sql.gz', 'gzipped-bytes', ageHours: 40);
            $this->assertSame(1, Artisan::call('backup:verify', ['--dir' => $this->dir]));
        } finally {
            Cache::setDefaultDriver($previous);
        }
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

    private function writeBackup(string $name, string $contents, int $ageHours): void
    {
        $path = $this->dir . DIRECTORY_SEPARATOR . $name;
        file_put_contents($path, $contents);
        $mtime = time() - ($ageHours * 3600);
        touch($path, $mtime);
    }
}
