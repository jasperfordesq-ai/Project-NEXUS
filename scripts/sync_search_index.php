<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Meilisearch Sync Script
 *
 * Backfills all active listings, users, events, groups, and marketplace listings into Meilisearch indexes.
 * Safe to re-run at any time — Meilisearch upserts are idempotent.
 *
 * Usage:
 *   php scripts/sync_search_index.php --tenant=2
 *   php scripts/sync_search_index.php --all-tenants
 *   php scripts/sync_search_index.php --all-tenants --type=listing
 *   php scripts/sync_search_index.php --tenant=2 --dry-run
 *   php scripts/sync_search_index.php --help
 *
 * Options:
 *   --tenant=<id>                    Process a single tenant by ID
 *   --all-tenants                    Process all active tenants
 *   --type=listing|user|event|group|marketplace  Process only one content type (default: all)
 *   --dry-run                                   Count rows without sending to Meilisearch
 *   --help                           Show this message
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Services\SearchReindexService;
use App\Services\SearchService;

// ============================================================
// Parse arguments
// ============================================================
$opts = getopt('', ['tenant:', 'all-tenants', 'type:', 'dry-run', 'help']);

if (isset($opts['help'])) {
    echo <<<HELP
sync_search_index.php — Backfill Meilisearch indexes from the database

Options:
  --tenant=<id>                    Process a single tenant by ID
  --all-tenants                    Process all active tenants
  --type=listing|user|event|group|marketplace  Process only one content type (default: all five)
  --dry-run                                    Count items without indexing
  --help                                       Show this message

Examples:
  php scripts/sync_search_index.php --tenant=2
  php scripts/sync_search_index.php --all-tenants
  php scripts/sync_search_index.php --all-tenants --type=listing
  php scripts/sync_search_index.php --all-tenants --type=marketplace
  php scripts/sync_search_index.php --all-tenants --type=event
  php scripts/sync_search_index.php --tenant=2 --dry-run

HELP;
    exit(0);
}

$dryRun     = isset($opts['dry-run']);
$typeFilter = $opts['type'] ?? null; // null = all four types

$validTypes = ['listing', 'user', 'event', 'group', 'marketplace'];
if ($typeFilter !== null && !in_array($typeFilter, $validTypes, true)) {
    fwrite(STDERR, "Error: --type must be one of: " . implode(', ', $validTypes) . "\n");
    exit(1);
}

// Collect tenant IDs to process
$tenantIds = [];

if (isset($opts['all-tenants'])) {
    $rows = array_map(fn($r) => (array) $r, DB::select(
        "SELECT id FROM tenants WHERE is_active = 1 ORDER BY id"
    ));
    $tenantIds = array_column($rows, 'id');
} elseif (isset($opts['tenant'])) {
    $tenantIds = [(int)$opts['tenant']];
} else {
    fwrite(STDERR, "Error: specify --tenant=<id> or --all-tenants\n");
    fwrite(STDERR, "Run with --help for usage information.\n");
    exit(1);
}

if (empty($tenantIds)) {
    fwrite(STDERR, "No active tenants found.\n");
    exit(1);
}

// ============================================================
// Ensure indexes exist (creates them if missing, sets attributes)
// ============================================================
if (!$dryRun) {
    echo "Configuring Meilisearch indexes (listings, users, events, groups, marketplace_listings)...\n";
    SearchService::ensureIndexes();

    if (!SearchService::isAvailable()) {
        fwrite(STDERR, "Error: Meilisearch is not available. Check MEILISEARCH_HOST env var and ensure the service is running.\n");
        exit(1);
    }
    echo "Meilisearch is online. Index configuration submitted; document task outcomes will be checked.\n\n";
}

// ============================================================
// Process tenants
// ============================================================
$typesLabel = $typeFilter ?? 'listing + user + event + group + marketplace';
echo "Sync search index" . ($dryRun ? " [DRY RUN]" : "") . "\n";
echo "Tenants  : " . implode(', ', $tenantIds) . "\n";
echo "Types    : {$typesLabel}\n\n";

$totalProcessed = 0;
$totalSkipped   = 0;
$totalErrors    = 0;

// The "select and index" loops live in SearchReindexService (16 Nov 2026), so
// the platform team's "Rebuild search" page runs exactly the same work. This
// script prints the same lines it always did, from the service's progress.
$reindexer = app(SearchReindexService::class);
$printProgress = static function (string $event, ...$args): void {
    switch ($event) {
        case 'empty':
            echo "  {$args[0]}: 0 rows — skipping\n";
            break;
        case 'start':
            echo "  {$args[0]}: {$args[1]} items\n";
            break;
        case 'batch':
            echo "  {$args[0]}: {$args[1]}/{$args[2]}\r";
            break;
        case 'error':
            fwrite(STDERR, "    Error {$args[0]}#{$args[1]}: {$args[2]}\n");
            break;
        case 'done':
            echo "  {$args[0]}: {$args[1]} indexed, {$args[2]} failed\n";
            break;
    }
};

foreach ($tenantIds as $tenantId) {
    $tenantId = (int)$tenantId;
    TenantContext::setById($tenantId);

    echo "=== Tenant {$tenantId} ===\n";

    foreach ($reindexer->reindexTenant($tenantId, $typeFilter, $dryRun, $printProgress) as $counts) {
        $totalProcessed += $counts['indexed'];
        $totalSkipped   += $dryRun ? $counts['rows'] : 0;
        $totalErrors    += $counts['errors'];
    }
}

echo "\n=== Summary ===\n";
echo "Processed : {$totalProcessed}\n";
echo "Skipped   : {$totalSkipped}\n";
echo "Errors    : {$totalErrors}\n";
exit($totalErrors > 0 ? 1 : 0);
