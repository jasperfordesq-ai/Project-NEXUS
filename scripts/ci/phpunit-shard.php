<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * phpunit-shard.php — Deterministically partition the PHPUnit test files
 * across CI matrix shards so the ~12.5k-test Laravel suite runs in parallel.
 *
 * The Laravel + LaravelMigrated suites together cover every *Test.php under
 * tests/Laravel (the Laravel suite excludes tests/Laravel/Migrated, which the
 * LaravelMigrated suite then runs — their union is the whole directory). This
 * script lists those files and assigns each WHOLE file to a shard, then prints
 * the files for one shard.
 *
 * Partitioning is keyed on a stable hash of the file's repo-relative PATH
 * (crc32(path) % total), NOT on file size and NOT on the file's position in a
 * sorted list.
 *
 *   Why not file size? The original LPT bin-pack keyed buckets on filesize as a
 *   runtime proxy. But filesize changes whenever a test file is edited (e.g.
 *   adding a markTestSkipped() line to quarantine a flaky test), which reshuffled
 *   the bin-pack and silently moved UNRELATED files between shards. On a suite
 *   with cross-class data-isolation debt, that exposed a new set of order-
 *   dependent failures on every commit, so quarantine-to-green never converged.
 *
 *   Why not round-robin over the sorted path list? That is stable against
 *   content edits, but NOT against ADDING or REMOVING test files: inserting one
 *   file shifts the sorted index of every file after it, moving them between
 *   shards. `main` lands automated "coverage batch" commits that add dozens of
 *   test files at a time, so an index-based split reshuffles on every such
 *   commit (CI tests the PR merge ref, so the branch inherits them).
 *
 *   A per-path hash fixes both: each file's shard depends ONLY on its own path,
 *   so editing a file never moves it AND adding/removing other files never moves
 *   it. Only the newly-added files themselves get assigned; everything else
 *   stays pinned. The failing set is therefore stable, quarantines stick, and
 *   the partition survives main's churn.
 *
 * Files are assigned by WHOLE file, so any intra-class @depends stays inside a
 * single shard (the suite currently declares none). Output is newline-separated
 * repo-relative paths, suitable for:
 *   vendor/bin/phpunit $(php scripts/ci/phpunit-shard.php <shard> <total>)
 *
 * Trade-off: a hash balances by file COUNT in expectation, not runtime, and the
 * counts vary by +/- a few percent per shard rather than being exactly equal.
 * Because path is uncorrelated with size, file sizes still spread roughly evenly
 * across shards. We accept slightly looser balance in exchange for a partition
 * that is stable under BOTH content edits and file add/remove — the property
 * that makes CI converge while main keeps adding tests.
 *
 * Usage:  php scripts/ci/phpunit-shard.php <shardIndex 1..total> <total>
 * Exit 0 with the file list on success; exit 2 on bad arguments / missing dir.
 */

$shard = (int) ($argv[1] ?? 0);
$total = (int) ($argv[2] ?? 0);

if ($total < 1 || $shard < 1 || $shard > $total) {
    fwrite(STDERR, "usage: php scripts/ci/phpunit-shard.php <shardIndex 1..total> <total>\n");
    exit(2);
}

$root = dirname(__DIR__, 2);
$testDir = $root . '/tests/Laravel';

if (!is_dir($testDir)) {
    fwrite(STDERR, "test directory not found: {$testDir}\n");
    exit(2);
}

$files = [];
$iter = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($testDir, FilesystemIterator::SKIP_DOTS)
);
foreach ($iter as $file) {
    if ($file->isFile() && str_ends_with($file->getFilename(), 'Test.php')) {
        // Store the repo-relative path; the partition key must not depend on the
        // absolute checkout location, only on the path within the repo.
        //
        // Normalise to forward slashes: getPathname() yields backslashes on
        // Windows, which hash differently from the POSIX paths CI keys on. Without
        // this, running the script locally on Windows prints a DIFFERENT partition
        // than the one CI executes — a file can look unassigned to its real shard,
        // which is easy to misread as "CI never runs this test".
        $files[] = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
    }
}

// Assign each file to a shard by a stable hash of its repo-relative path:
// bucket = crc32(path) % total. This depends only on the file's OWN path, so a
// file never moves when other files are edited, added, or removed. (The double
// modulo guards against any platform where crc32() is negative; on 64-bit PHP
// it is already in 0..2^32-1.)
$out = [];
foreach ($files as $relPath) {
    $bucket = ((crc32($relPath) % $total) + $total) % $total; // 0-indexed
    if ($bucket === $shard - 1) {
        $out[] = $relPath;
    }
}

sort($out, SORT_STRING);
echo implode("\n", $out), "\n";
