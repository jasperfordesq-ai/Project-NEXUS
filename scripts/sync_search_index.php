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
use App\Services\SearchService;
use App\Support\UserDisplayName;

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
    echo "Meilisearch is online. Indexes configured with synonyms and ranking rules.\n\n";
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

foreach ($tenantIds as $tenantId) {
    $tenantId = (int)$tenantId;
    TenantContext::setById($tenantId);

    echo "=== Tenant {$tenantId} ===\n";

    if (!$typeFilter || $typeFilter === 'listing') {
        [$proc, $skip, $err] = syncListings($tenantId, $dryRun);
        $totalProcessed += $proc;
        $totalSkipped   += $skip;
        $totalErrors    += $err;
    }

    if (!$typeFilter || $typeFilter === 'user') {
        [$proc, $skip, $err] = syncUsers($tenantId, $dryRun);
        $totalProcessed += $proc;
        $totalSkipped   += $skip;
        $totalErrors    += $err;
    }

    if (!$typeFilter || $typeFilter === 'event') {
        [$proc, $skip, $err] = syncEvents($tenantId, $dryRun);
        $totalProcessed += $proc;
        $totalSkipped   += $skip;
        $totalErrors    += $err;
    }

    if (!$typeFilter || $typeFilter === 'group') {
        [$proc, $skip, $err] = syncGroups($tenantId, $dryRun);
        $totalProcessed += $proc;
        $totalSkipped   += $skip;
        $totalErrors    += $err;
    }

    if (!$typeFilter || $typeFilter === 'marketplace') {
        [$proc, $skip, $err] = syncMarketplaceListings($tenantId, $dryRun);
        $totalProcessed += $proc;
        $totalSkipped   += $skip;
        $totalErrors    += $err;
    }
}

echo "\n=== Summary ===\n";
echo "Processed : {$totalProcessed}\n";
echo "Skipped   : {$totalSkipped}\n";
echo "Errors    : {$totalErrors}\n";
exit($totalErrors > 0 ? 1 : 0);

// ============================================================
// Helpers
// ============================================================

/**
 * Load and index all active listings for a tenant in batches of 100.
 * Returns [processed, skipped, errors].
 *
 * @return array{int, int, int}
 */
function syncListings(int $tenantId, bool $dryRun): array
{
    $rows = array_map(fn($r) => (array) $r, DB::select(
        "SELECT l.id, l.tenant_id, l.user_id, l.category_id, l.type,
                l.title, l.description, l.location, l.status,
                UNIX_TIMESTAMP(l.created_at) as created_at,
                " . UserDisplayName::sql('u', 'author_name') . ",
                COALESCE(c.name, '') as category_name,
                GROUP_CONCAT(lst.tag ORDER BY lst.tag SEPARATOR ',') as skill_tags_csv
         FROM listings l
         LEFT JOIN users u ON l.user_id = u.id
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN listing_skill_tags lst ON lst.listing_id = l.id
         WHERE l.tenant_id = ? AND l.status = 'active'
         GROUP BY l.id, l.tenant_id, l.user_id, l.category_id, l.type,
                  l.title, l.description, l.location, l.status, l.created_at,
                  u.first_name, u.last_name, c.name
         ORDER BY l.id",
        [$tenantId]
    ));

    // Convert skill_tags_csv string to array for Meilisearch
    $rows = array_map(function (array $row): array {
        $row['skill_tags'] = array_values(array_filter(explode(',', $row['skill_tags_csv'] ?? '')));
        unset($row['skill_tags_csv']);
        return $row;
    }, $rows);

    return batchIndex($rows, 'listings', 'listing', $dryRun, fn($row) => SearchService::indexListing($row));
}

/**
 * Load and index all active users for a tenant in batches of 100.
 * Returns [processed, skipped, errors].
 *
 * @return array{int, int, int}
 */
function syncUsers(int $tenantId, bool $dryRun): array
{
    $rows = array_map(fn($r) => (array) $r, DB::select(
        "SELECT id, tenant_id, first_name, last_name, organization_name,
                profile_type, bio, skills, location, avatar_url, status,
                UNIX_TIMESTAMP(created_at) as created_at
         FROM users
         WHERE tenant_id = ? AND status = 'active'
         ORDER BY id",
        [$tenantId]
    ));

    return batchIndex($rows, 'users', 'user', $dryRun, fn($row) => SearchService::indexUser($row));
}

/**
 * Load and index all upcoming events for a tenant.
 * Returns [processed, skipped, errors].
 *
 * @return array{int, int, int}
 */
function syncEvents(int $tenantId, bool $dryRun): array
{
    $rows = array_map(fn($r) => (array) $r, DB::select(
        "SELECT e.id, e.tenant_id, e.title, e.description, e.location,
                COALESCE(e.status, 'active') as status,
                e.publication_status,
                e.operational_status,
                e.is_recurring_template,
                e.allow_remote_attendance as is_online,
                UNIX_TIMESTAMP(COALESCE(e.start_time, e.start_date)) as start_time,
                UNIX_TIMESTAMP(e.created_at) as created_at,
                " . UserDisplayName::sql('u', 'organizer_name') . "
         FROM events e
         LEFT JOIN users u ON e.user_id = u.id AND e.tenant_id = u.tenant_id
         WHERE e.tenant_id = ?
           AND COALESCE(e.start_time, e.start_date) >= NOW()
           AND COALESCE(e.is_recurring_template, 0) = 0
           AND (
               (
                   COALESCE(e.status, 'active') = 'active'
                   AND (e.publication_status IS NULL OR e.publication_status = 'published')
                   AND (e.operational_status IS NULL OR e.operational_status = 'scheduled')
               )
               OR (
                   e.status = 'cancelled'
                   AND (e.publication_status IS NULL OR e.publication_status = 'published')
                   AND e.operational_status = 'postponed'
               )
           )
         ORDER BY e.id",
        [$tenantId]
    ));

    return batchIndex($rows, 'events', 'event', $dryRun, fn($row) => SearchService::indexEvent($row));
}

/**
 * Load and index all active groups for a tenant.
 * Returns [processed, skipped, errors].
 *
 * @return array{int, int, int}
 */
function syncGroups(int $tenantId, bool $dryRun): array
{
    $rows = array_map(fn($r) => (array) $r, DB::select(
        "SELECT g.id, g.tenant_id, g.name, g.description,
                IF(g.is_active, 'active', 'inactive') as status,
                g.visibility as privacy,
                COALESCE(g.cached_member_count, 0) as members_count,
                UNIX_TIMESTAMP(g.created_at) as created_at
         FROM `groups` g
         WHERE g.tenant_id = ? AND g.is_active = 1
         ORDER BY g.id",
        [$tenantId]
    ));

    return batchIndex($rows, 'groups', 'group', $dryRun, fn($row) => SearchService::indexGroup($row));
}

/**
 * Load and index all active+approved marketplace listings for a tenant in batches of 100.
 * Returns [processed, skipped, errors].
 *
 * @return array{int, int, int}
 */
function syncMarketplaceListings(int $tenantId, bool $dryRun): array
{
    $rows = array_map(fn($r) => (array) $r, DB::select(
        "SELECT ml.id, ml.tenant_id, ml.category_id,
                ml.title, ml.description, ml.tagline, ml.location,
                ml.price, ml.price_type, ml.`condition`, ml.seller_type,
                ml.delivery_method, ml.status, ml.moderation_status,
                UNIX_TIMESTAMP(ml.created_at) as created_at
         FROM marketplace_listings ml
         WHERE ml.tenant_id = ?
           AND ml.status = 'active'
           AND ml.moderation_status = 'approved'
         ORDER BY ml.id",
        [$tenantId]
    ));

    // Ensure numeric types for Meilisearch filterable attributes
    $rows = array_map(function (array $row): array {
        $row['price'] = (float) ($row['price'] ?? 0);
        $row['category_id'] = $row['category_id'] ? (int) $row['category_id'] : null;
        return $row;
    }, $rows);

    return batchIndex($rows, 'marketplace_listings', 'marketplace_listing', $dryRun, fn($row) => SearchService::indexMarketplaceListing($row));
}

/**
 * Generic batch indexer. Processes rows in batches of 100 with progress output.
 *
 * @return array{int, int, int}  [processed, skipped, errors]
 */
function batchIndex(array $rows, string $label, string $type, bool $dryRun, callable $indexFn): array
{
    $total = count($rows);

    if ($total === 0) {
        echo "  {$label}: 0 rows — skipping\n";
        return [0, 0, 0];
    }

    echo "  {$label}: {$total} items\n";

    if ($dryRun) {
        return [0, $total, 0];
    }

    $processed = 0;
    $errors    = 0;
    $batches   = array_chunk($rows, 100);

    foreach ($batches as $batchIndex => $batch) {
        foreach ($batch as $row) {
            try {
                $indexFn($row);
                $processed++;
            } catch (\Throwable $e) {
                fwrite(STDERR, "    Error {$type}#{$row['id']}: " . $e->getMessage() . "\n");
                $errors++;
            }
        }

        $done = min(($batchIndex + 1) * 100, $total);
        echo "  {$label}: {$done}/{$total}\r";
    }

    echo "  {$label}: {$total}/{$total} processed\n";
    return [$processed, 0, $errors];
}
