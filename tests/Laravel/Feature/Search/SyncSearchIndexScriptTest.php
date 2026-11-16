<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Search;

use Symfony\Component\Process\Process;
use Tests\Laravel\TestCase;

/**
 * `scripts/sync_search_index.php` as other scripts and people use it.
 *
 * 🔴 It runs on every deployment (`scripts/post-deploy-algorithms.sh`) and is
 * the documented way to rebuild search. Its options, the lines it prints and
 * its exit code must not change when its insides move into
 * SearchReindexService. These tests run the real script in a child process
 * with `--dry-run` (which never contacts the search server) against a
 * community id that has no rows, so the output is fully predictable. What
 * each row does is pinned by SearchReindexServiceTest.
 */
class SyncSearchIndexScriptTest extends TestCase
{
    private const NO_SUCH_COMMUNITY = 987654321;

    /** @return array{0: int, 1: string, 2: string} exit code, stdout, stderr */
    private function runScript(string ...$args): array
    {
        $process = new Process(['php', base_path('scripts/sync_search_index.php'), ...$args], base_path());
        $process->setTimeout(120);
        $process->run();

        return [(int) $process->getExitCode(), $process->getOutput(), $process->getErrorOutput()];
    }

    public function test_a_dry_run_prints_the_same_lines_and_exits_zero(): void
    {
        [$code, $out] = $this->runScript('--dry-run', '--tenant=' . self::NO_SUCH_COMMUNITY);

        $id = self::NO_SUCH_COMMUNITY;
        $this->assertSame(
            "Sync search index [DRY RUN]\n"
            . "Tenants  : {$id}\n"
            . "Types    : listing + user + event + group + marketplace\n\n"
            . "=== Tenant {$id} ===\n"
            . "  listings: 0 rows — skipping\n"
            . "  users: 0 rows — skipping\n"
            . "  events: 0 rows — skipping\n"
            . "  groups: 0 rows — skipping\n"
            . "  marketplace_listings: 0 rows — skipping\n"
            . "\n=== Summary ===\n"
            . "Processed : 0\n"
            . "Skipped   : 0\n"
            . "Errors    : 0\n",
            $out
        );
        $this->assertSame(0, $code);
    }

    public function test_type_limits_the_run_to_one_kind_of_entry(): void
    {
        [$code, $out] = $this->runScript('--dry-run', '--tenant=' . self::NO_SUCH_COMMUNITY, '--type=group');

        $this->assertStringContainsString("Types    : group\n", $out);
        $this->assertStringContainsString("  groups: 0 rows — skipping\n", $out);
        $this->assertStringNotContainsString('listings:', $out);
        $this->assertStringNotContainsString('marketplace_listings:', $out);
        $this->assertSame(0, $code);
    }

    public function test_an_unknown_type_is_refused_with_exit_code_one(): void
    {
        [$code, $out, $err] = $this->runScript('--dry-run', '--tenant=1', '--type=bogus');

        $this->assertSame(1, $code);
        $this->assertSame('', $out);
        $this->assertSame("Error: --type must be one of: listing, user, event, group, marketplace\n", $err);
    }

    public function test_no_community_chosen_is_refused_with_exit_code_one(): void
    {
        [$code, , $err] = $this->runScript('--dry-run');

        $this->assertSame(1, $code);
        $this->assertStringContainsString('Error: specify --tenant=<id> or --all-tenants', $err);
    }

    public function test_help_prints_the_options_and_exits_zero(): void
    {
        [$code, $out] = $this->runScript('--help');

        $this->assertSame(0, $code);
        foreach (['--tenant=<id>', '--all-tenants', '--type=listing|user|event|group|marketplace', '--dry-run'] as $option) {
            $this->assertStringContainsString($option, $out);
        }
    }
}
