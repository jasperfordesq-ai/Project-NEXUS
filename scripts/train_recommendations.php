<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Offline KNN Recommendation Training Pipeline
 *
 * Trains listing and member recommendation models using KNN-based distance
 * computation (with optional Rubix ML acceleration) and pre-computes the
 * top recommendations per user into Redis. Real-time services check Redis
 * first before falling back to on-the-fly computation.
 *
 * Usage:
 *   php scripts/train_recommendations.php --tenant=2
 *   php scripts/train_recommendations.php --all-tenants
 *   php scripts/train_recommendations.php --tenant=2 --type=listings
 *   php scripts/train_recommendations.php --tenant=2 --type=members
 *   php scripts/train_recommendations.php --tenant=2 --dry-run
 *   php scripts/train_recommendations.php --help
 *
 * Runs nightly via cron. Redis keys expire after 24 hours; the next run
 * refreshes them before expiry.
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
use Illuminate\Support\Facades\Cache;

// ============================================================
// Parse arguments
// ============================================================
$opts = getopt('', ['tenant:', 'all-tenants', 'type:', 'dry-run', 'help']);

if (isset($opts['help'])) {
    echo <<<HELP
train_recommendations.php — Offline KNN recommendation training pipeline

Options:
  --tenant=<id>       Process one tenant by ID
  --all-tenants       Process all active tenants
  --type=listings     Only compute listing recommendations (member → listings)
  --type=members      Only compute member recommendations (user → users)
  --dry-run           Show counts without computing or writing to Redis
  --help              Show this message

Redis keys written:
  recs_listings_{tenantId}_{userId}   TTL 86400s — listing IDs ranked by KNN distance
  recs_members_{tenantId}_{userId}    TTL 86400s — user IDs ranked by KNN distance

HELP;
    exit(0);
}

$dryRun     = isset($opts['dry-run']);
$typeFilter = $opts['type'] ?? null; // null = both

// Collect tenant IDs
$tenantIds = [];

if (isset($opts['all-tenants'])) {
    $rows      = array_map(fn($r) => (array) $r, DB::select("SELECT id FROM tenants WHERE is_active = 1 ORDER BY id"));
    $tenantIds = array_column($rows, 'id');
} elseif (isset($opts['tenant'])) {
    $tenantIds = [(int)$opts['tenant']];
} else {
    fwrite(STDERR, "Error: specify --tenant=<id> or --all-tenants\n");
    exit(1);
}

if (empty($tenantIds)) {
    fwrite(STDERR, "No active tenants found.\n");
    exit(1);
}

// Detect Rubix ML availability (it may not be installed yet on older deploys)
$rubixAvailable = class_exists(\Rubix\ML\Kernels\Distance\Euclidean::class);

echo "KNN Recommendation Training Pipeline" . ($dryRun ? " [DRY RUN]" : "") . "\n";
echo "Rubix ML: " . ($rubixAvailable ? "available (accelerated distance kernel)" : "not available (pure-PHP fallback)") . "\n";
echo "Tenants : " . implode(', ', $tenantIds) . "\n";
echo "Type    : " . ($typeFilter ?? 'listings + members') . "\n\n";

$totalErrors = 0;

foreach ($tenantIds as $tenantId) {
    $tenantId = (int)$tenantId;
    TenantContext::setById($tenantId);

    $startTime = microtime(true);
    echo "=== Tenant {$tenantId} ===\n";

    $listingRecSets = 0;
    $memberRecSets  = 0;

    if (!$typeFilter || $typeFilter === 'listings') {
        [$sets, $errors] = processListingRecommendations($tenantId, $dryRun, $rubixAvailable);
        $listingRecSets += $sets;
        $totalErrors    += $errors;
    }

    if (!$typeFilter || $typeFilter === 'members') {
        [$sets, $errors] = processMemberRecommendations($tenantId, $dryRun, $rubixAvailable);
        $memberRecSets  += $sets;
        $totalErrors    += $errors;
    }

    $elapsed = round(microtime(true) - $startTime, 2);
    echo "Tenant {$tenantId}: {$listingRecSets} listing rec sets + {$memberRecSets} member rec sets computed in {$elapsed}s\n\n";
}

echo "Done." . ($totalErrors > 0 ? " ({$totalErrors} errors)" : "") . "\n";
exit($totalErrors > 0 ? 1 : 0);

// ============================================================
// LISTING RECOMMENDATIONS  (member → listings they'd like)
// ============================================================

/**
 * For each active member, compute their top-20 listings by KNN distance
 * and cache the result in Redis.
 *
 * Feature vector per listing (all normalised to [0,1]):
 *   [skill_overlap, has_location, desc_length_norm, view_count_norm, save_count_norm]
 *
 * @return array{int, int}  [rec sets written, errors]
 */
function processListingRecommendations(int $tenantId, bool $dryRun, bool $rubixAvailable): array
{
    // Load active listings
    try {
        $listings = array_map(fn($r) => (array) $r, DB::select(
            "SELECT l.id, l.description, l.location, l.view_count, l.save_count
             FROM listings l
             WHERE l.tenant_id = ? AND l.status = 'active'
             ORDER BY l.id",
            [$tenantId]
        ));
    } catch (\Throwable $e) {
        fwrite(STDERR, "  listings query failed for tenant {$tenantId}: " . $e->getMessage() . "\n");
        return [0, 1];
    }

    $listingCount = count($listings);
    echo "  Listings: {$listingCount}\n";

    if ($listingCount < 5) {
        echo "  Too few listings for KNN — skipping.\n";
        return [0, 0];
    }

    // Compute feature vectors and gather normalisation ranges
    $rawVectors  = [];
    $maxViews    = 1;
    $maxSaves    = 1;
    $maxDescLen  = 1;

    foreach ($listings as $listing) {
        $descLen    = strlen($listing['description'] ?? '');
        $views      = max(0, (int)$listing['view_count']);
        $saves      = max(0, (int)$listing['save_count']);

        if ($descLen > $maxDescLen) {
            $maxDescLen = $descLen;
        }
        if ($views > $maxViews) {
            $maxViews = $views;
        }
        if ($saves > $maxSaves) {
            $maxSaves = $saves;
        }

        $rawVectors[(int)$listing['id']] = [
            'skills'   => [],
            'has_loc'  => empty(trim($listing['location'] ?? '')) ? 0.0 : 1.0,
            'desc_len' => (float)$descLen,
            'views'    => (float)$views,
            'saves'    => (float)$saves,
        ];
    }

    // Normalise to [0,1] using min-max (min is always 0 for these features)
    $listingVectors = [];
    foreach ($rawVectors as $id => $raw) {
        $listingVectors[$id] = [
            0.0,                                         // skill_overlap placeholder — computed per user
            $raw['has_loc'],
            $maxDescLen > 0 ? $raw['desc_len'] / $maxDescLen : 0.0,
            $maxViews   > 0 ? $raw['views']   / $maxViews    : 0.0,
            $maxSaves   > 0 ? $raw['saves']   / $maxSaves    : 0.0,
        ];
    }

    // Collect all skill sets for overlap computation
    $listingSkills = [];
    foreach ($rawVectors as $id => $raw) {
        $listingSkills[$id] = $raw['skills'];
    }

    if ($dryRun) {
        // Load member count for reporting
        try {
            $memberCount = (int)DB::select(
                "SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            )[0]->c;
        } catch (\Throwable $e) {
            $memberCount = 0;
        }
        echo "  Members: {$memberCount} (dry-run — no Redis writes)\n";
        return [$memberCount, 0];
    }

    // Load active members
    try {
        $members = array_map(fn($r) => (array) $r, DB::select(
            "SELECT u.id, u.skills
             FROM users u
             WHERE u.tenant_id = ? AND u.status = 'active'
             ORDER BY u.id",
            [$tenantId]
        ));
    } catch (\Throwable $e) {
        fwrite(STDERR, "  members query failed for tenant {$tenantId}: " . $e->getMessage() . "\n");
        return [0, 1];
    }

    $memberCount = count($members);
    echo "  Members: {$memberCount}\n";

    $errors  = 0;
    $written = 0;

    foreach ($members as $member) {
        $userId      = (int)$member['id'];
        $memberSkills = normaliseSkillsToSet($member['skills'] ?? '');

        // Build per-member listing vectors with personalised skill overlap
        $personalised = [];
        foreach ($listingVectors as $listingId => $vec) {
            $overlap              = computeSkillOverlap($memberSkills, $listingSkills[$listingId] ?? []);
            $personalised[$listingId] = [$overlap, $vec[1], $vec[2], $vec[3], $vec[4]];
        }

        try {
            // User's own "query" vector: skill overlap = 1 by definition, rest neutral
            $userVec = [1.0, 0.5, 0.5, 0.5, 0.5];
            $topIds  = computeKnnRecommendations($userVec, $personalised, 20, $rubixAvailable);

            $cacheKey = "recs_listings_{$tenantId}_{$userId}";
            // Same store and key the readers use (ExploreService, SmartMatchingEngine,
            // CollaborativeFilteringService read Cache::get("recs_*_{tenant}_{id}")).
            // This called the RedisCache service statically - a fatal error for every
            // member - and that service also prefixes keys with "t{tenant}:", so no
            // reader would have found the result. The tenant id is already in the key.
            Cache::put($cacheKey, $topIds, 86400);
            $written++;
        } catch (\Throwable $e) {
            fwrite(STDERR, "  Error user#{$userId} listing recs: " . $e->getMessage() . "\n");
            $errors++;
        }
    }

    echo "  Listing recs: {$written} written, {$errors} errors\n";
    return [$written, $errors];
}

// ============================================================
// MEMBER RECOMMENDATIONS  (user → similar users)
// ============================================================

/**
 * For each active member, compute their top-20 most similar members by KNN
 * and cache the result in Redis.
 *
 * Feature vector per member (all normalised to [0,1]):
 *   [hours_given_norm, hours_received_norm, listing_count_norm, review_score_norm]
 * Plus up to 10 hashed skill dimensions for a total of 14 features.
 *
 * @return array{int, int}  [rec sets written, errors]
 */
function processMemberRecommendations(int $tenantId, bool $dryRun, bool $rubixAvailable): array
{
    try {
        $rows = array_map(fn($r) => (array) $r, DB::select(
            "SELECT u.id, u.skills, u.bio,
                    COALESCE((SELECT SUM(t.amount) FROM transactions t
                              WHERE t.giver_id = u.id AND t.tenant_id = ? AND t.status = 'completed'), 0) AS hours_given,
                    COALESCE((SELECT SUM(t.amount) FROM transactions t
                              WHERE t.receiver_id = u.id AND t.tenant_id = ? AND t.status = 'completed'), 0) AS hours_received,
                    COUNT(DISTINCT l.id)           AS listing_count,
                    COALESCE(AVG(r.rating), 0)     AS avg_rating
             FROM users u
             LEFT JOIN listings l ON l.user_id = u.id AND l.status = 'active' AND l.tenant_id = ?
             LEFT JOIN reviews r  ON r.receiver_id = u.id AND r.tenant_id = ?
             WHERE u.tenant_id = ? AND u.status = 'active'
             GROUP BY u.id",
            [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId]
        ));
    } catch (\Throwable $e) {
        fwrite(STDERR, "  member query failed for tenant {$tenantId}: " . $e->getMessage() . "\n");
        return [0, 1];
    }

    $memberCount = count($rows);
    echo "  Members: {$memberCount}\n";

    if ($memberCount < 5) {
        echo "  Too few members for KNN — skipping.\n";
        return [0, 0];
    }

    if ($dryRun) {
        echo "  Member recs: {$memberCount} (dry-run — no Redis writes)\n";
        return [$memberCount, 0];
    }

    // Gather ranges for min-max normalisation
    $maxHoursGiven    = 1;
    $maxHoursReceived = 1;
    $maxListings      = 1;
    $maxRating        = 5; // ratings are 1-5

    foreach ($rows as $row) {
        if ((float)$row['hours_given']    > $maxHoursGiven)    { $maxHoursGiven    = (float)$row['hours_given']; }
        if ((float)$row['hours_received'] > $maxHoursReceived) { $maxHoursReceived = (float)$row['hours_received']; }
        if ((int)$row['listing_count']    > $maxListings)      { $maxListings      = (int)$row['listing_count']; }
    }

    // Build all skill dimensions for one-hot hashing (cap at 10 dimensions)
    $allSkillDimensions = buildSkillDimensions($rows);

    // Compute normalised feature vectors
    $memberVectors = [];
    foreach ($rows as $row) {
        $userId = (int)$row['id'];
        $vec    = normaliseMemberVector($row, $maxHoursGiven, $maxHoursReceived, $maxListings, $maxRating, $allSkillDimensions);
        $memberVectors[$userId] = $vec;
    }

    $errors  = 0;
    $written = 0;

    foreach ($memberVectors as $userId => $userVec) {
        // Build candidate pool: all members except self
        $candidates = [];
        foreach ($memberVectors as $candidateId => $candidateVec) {
            if ($candidateId !== $userId) {
                $candidates[$candidateId] = $candidateVec;
            }
        }

        try {
            $topIds = computeKnnRecommendations($userVec, $candidates, 20, $rubixAvailable);

            $cacheKey = "recs_members_{$tenantId}_{$userId}";
            // Same store and key the readers use (ExploreService, SmartMatchingEngine,
            // CollaborativeFilteringService read Cache::get("recs_*_{tenant}_{id}")).
            // This called the RedisCache service statically - a fatal error for every
            // member - and that service also prefixes keys with "t{tenant}:", so no
            // reader would have found the result. The tenant id is already in the key.
            Cache::put($cacheKey, $topIds, 86400);
            $written++;
        } catch (\Throwable $e) {
            fwrite(STDERR, "  Error user#{$userId} member recs: " . $e->getMessage() . "\n");
            $errors++;
        }
    }

    echo "  Member recs: {$written} written, {$errors} errors\n";
    return [$written, $errors];
}

// ============================================================
// CORE KNN DISTANCE COMPUTATION
// ============================================================

/**
 * Find the K nearest items to a query vector using Euclidean distance.
 *
 * Uses Rubix ML's Euclidean kernel if available; otherwise falls back to
 * pure-PHP implementation which is functionally identical.
 *
 * @param float[]            $queryVec      The query feature vector
 * @param array<int, float[]> $candidateVecs [itemId => featureVector]
 * @param int                $k             Number of neighbours to return
 * @param bool               $rubixAvailable Whether Rubix ML is loaded
 * @return int[]                            Item IDs sorted by ascending distance (nearest first)
 */
function computeKnnRecommendations(
    array $queryVec,
    array $candidateVecs,
    int $k,
    bool $rubixAvailable
): array {
    if (empty($candidateVecs)) {
        return [];
    }

    $distances = [];

    if ($rubixAvailable) {
        // Use Rubix ML's Euclidean distance kernel for validation parity
        $kernel = new \Rubix\ML\Kernels\Distance\Euclidean();
        foreach ($candidateVecs as $itemId => $vec) {
            // Pad shorter vector to match length
            $a = $queryVec;
            $b = $vec;
            $len = max(count($a), count($b));
            while (count($a) < $len) { $a[] = 0.0; }
            while (count($b) < $len) { $b[] = 0.0; }

            $distances[$itemId] = $kernel->compute($a, $b);
        }
    } else {
        // Pure-PHP Euclidean distance (identical result, no dependency)
        foreach ($candidateVecs as $itemId => $vec) {
            $dist = 0.0;
            $len  = max(count($queryVec), count($vec));
            for ($i = 0; $i < $len; $i++) {
                $diff  = ($queryVec[$i] ?? 0.0) - ($vec[$i] ?? 0.0);
                $dist += $diff * $diff;
            }
            $distances[$itemId] = sqrt($dist);
        }
    }

    // Sort ascending (nearest first) and return top K item IDs
    asort($distances);
    return array_map('intval', array_keys(array_slice($distances, 0, $k, true)));
}

// ============================================================
// FEATURE HELPERS
// ============================================================

/**
 * Normalise a skills string into a unique set of lowercase tokens.
 *
 * @return string[]
 */
function normaliseSkillsToSet(string $raw): array
{
    if (empty(trim($raw))) {
        return [];
    }

    // Attempt JSON decode first (skills stored as JSON array on some tenants)
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        return array_unique(array_map('strtolower', array_filter($decoded, 'is_string')));
    }

    // Comma / semicolon separated fallback
    $tokens = preg_split('/[,;]+/', $raw);
    return array_unique(array_map('trim', array_map('strtolower', array_filter($tokens))));
}

/**
 * Compute Jaccard overlap between two skill sets, returning a value in [0,1].
 *
 * @param string[] $a
 * @param string[] $b
 */
function computeSkillOverlap(array $a, array $b): float
{
    if (empty($a) || empty($b)) {
        return 0.0;
    }

    $intersection = count(array_intersect($a, $b));
    $union        = count(array_unique(array_merge($a, $b)));

    return $union > 0 ? $intersection / $union : 0.0;
}

/**
 * Build a stable ordered list of the top-10 most common skill tokens
 * across all members, used as dimensions for the skill one-hot vector.
 *
 * @param array[] $rows  Raw member rows from the database
 * @return string[]      Up to 10 skill tokens
 */
function buildSkillDimensions(array $rows): array
{
    $freq = [];
    foreach ($rows as $row) {
        foreach (normaliseSkillsToSet($row['skills'] ?? '') as $skill) {
            $freq[$skill] = ($freq[$skill] ?? 0) + 1;
        }
    }

    arsort($freq);
    return array_keys(array_slice($freq, 0, 10, true));
}

/**
 * Normalise a member row into a float feature vector.
 *
 * Dimensions (14 total):
 *   [0] hours_given_norm
 *   [1] hours_received_norm
 *   [2] listing_count_norm
 *   [3] avg_rating_norm
 *   [4-13] one-hot skill dimensions (top-10 across tenant)
 *
 * @param array    $row
 * @param float    $maxHoursGiven
 * @param float    $maxHoursReceived
 * @param int      $maxListings
 * @param float    $maxRating
 * @param string[] $skillDimensions
 * @return float[]
 */
function normaliseMemberVector(
    array $row,
    float $maxHoursGiven,
    float $maxHoursReceived,
    int   $maxListings,
    float $maxRating,
    array $skillDimensions
): array {
    $vec = [
        $maxHoursGiven    > 0 ? min(1.0, (float)$row['hours_given']    / $maxHoursGiven)    : 0.0,
        $maxHoursReceived > 0 ? min(1.0, (float)$row['hours_received'] / $maxHoursReceived) : 0.0,
        $maxListings      > 0 ? min(1.0, (int)$row['listing_count']    / $maxListings)      : 0.0,
        $maxRating        > 0 ? min(1.0, (float)$row['avg_rating']     / $maxRating)        : 0.0,
    ];

    // Append one-hot skill dimensions
    $memberSkills = normaliseSkillsToSet($row['skills'] ?? '');
    foreach ($skillDimensions as $dim) {
        $vec[] = in_array($dim, $memberSkills, true) ? 1.0 : 0.0;
    }

    return $vec;
}
