<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * GroupAssignmentService — Automatically assigns users to geographic hub groups
 * based on fuzzy location matching.
 *
 * Uses the Laravel DB facade for raw queries (not Eloquent).
 */
class GroupAssignmentService
{
    /**
     * Minimum confidence score required to auto-assign a user to a hub group.
     */
    const CONFIDENCE_THRESHOLD = 0.5;

    /**
     * Assign a user to the best-matching leaf hub group based on their location.
     *
     * @param array $user Array with 'id' and 'location' keys
     * @return string Status string describing the outcome
     */
    public function assignUser(array $user): string
    {
        $location = trim($user['location'] ?? '');

        if ($location === '') {
            return 'SKIPPED: No location';
        }

        $leafGroups = $this->getLeafGroups();

        if (empty($leafGroups)) {
            return 'SKIPPED: No hub groups';
        }

        $bestScore = 0.0;
        $bestGroup = null;

        foreach ($leafGroups as $group) {
            $score = $this->computeConfidence(
                $location,
                $group['name'],
                $group['location'] ?? null
            );

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestGroup = $group;
            }
        }

        if ($bestScore < self::CONFIDENCE_THRESHOLD || $bestGroup === null) {
            return 'SKIPPED: No match above threshold';
        }

        $groupId = (int) $bestGroup['id'];
        $userId = (int) $user['id'];
        $alreadyAssigned = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('user_id', $userId)
            ->exists();
        if ($alreadyAssigned) {
            return 'ASSIGNED: ' . $bestGroup['name'];
        }

        GroupService::assertSafeguardingCohortAllowed(
            $groupId,
            $userId,
            (int) TenantContext::getId(),
            'group_automatic_assignment',
        );

        // Insert the user into the group (INSERT IGNORE to avoid duplicates).
        // tenant_id is explicit: the column used to default to 1 and filed
        // every assignment under the master community (O-087).
        DB::insert(
            "INSERT IGNORE INTO group_members (tenant_id, group_id, user_id, status, created_at)
             VALUES (?, ?, ?, 'active', NOW())",
            [(int) TenantContext::getId(), $groupId, $userId]
        );

        return 'ASSIGNED: ' . $bestGroup['name'];
    }

    /**
     * Sanitize a text string for comparison.
     *
     * Lowercases, trims, and strips special characters except spaces, commas,
     * and hyphens.
     *
     * @param string $text The text to sanitize
     * @return string The sanitized text
     */
    public function sanitize(string $text): string
    {
        $text = mb_strtolower(trim($text));

        // Keep only alphanumeric, spaces, commas, and hyphens
        $text = preg_replace('/[^a-z0-9\s,\-]/u', '', $text);

        // Collapse multiple spaces into one
        $text = preg_replace('/\s+/', ' ', $text);

        return trim($text);
    }

    /**
     * Get leaf hub groups (groups with no children) for the current tenant.
     *
     * Retrieves groups that are either:
     * - Associated with a hub group type (group_types.is_hub = 1), OR
     * - Leaf-level groups (has_children = 0 and have a parent)
     *
     * @return array Array of associative arrays with 'id', 'name', 'location' keys
     */
    private function getLeafGroups(): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::select(
            "SELECT g.id, g.name, g.location
             FROM `groups` g
             LEFT JOIN group_types gt ON g.type_id = gt.id
             WHERE g.tenant_id = ?
               AND (
                   (gt.is_hub = 1)
                   OR (g.has_children = 0 AND g.parent_id IS NOT NULL)
               )
             ORDER BY g.name ASC",
            [$tenantId]
        );

        return array_map(fn($r) => (array) $r, $rows);
    }

    /**
     * Compute a confidence score for how well a user's location matches a group.
     *
     * Uses word overlap between the sanitized user location segments (split on
     * commas) and the sanitized group name and location. Returns the highest
     * match ratio found across all combinations.
     *
     * @param string      $userLocation  The user's location string
     * @param string      $groupName     The group's name
     * @param string|null $groupLocation The group's location (may be null)
     * @return float Confidence score between 0.0 and 1.0
     */
    private function computeConfidence(string $userLocation, string $groupName, ?string $groupLocation): float
    {
        $sanitizedLocation = $this->sanitize($userLocation);
        $sanitizedGroupName = $this->sanitize($groupName);
        $sanitizedGroupLocation = $groupLocation !== null ? $this->sanitize($groupLocation) : '';

        // Split user location on commas into segments
        $userSegments = array_map('trim', explode(',', $sanitizedLocation));
        $userSegments = array_filter($userSegments, fn(string $s) => $s !== '');

        if (empty($userSegments)) {
            return 0.0;
        }

        // Build the set of group identifiers to match against
        $groupIdentifiers = [$sanitizedGroupName];
        if ($sanitizedGroupLocation !== '') {
            $groupIdentifiers[] = $sanitizedGroupLocation;
        }

        $bestScore = 0.0;

        foreach ($userSegments as $segment) {
            $segmentWords = array_filter(explode(' ', $segment), fn(string $w) => $w !== '');

            foreach ($groupIdentifiers as $identifier) {
                $identifierWords = array_filter(explode(' ', $identifier), fn(string $w) => $w !== '');

                if (empty($segmentWords) || empty($identifierWords)) {
                    continue;
                }

                // Word overlap: count how many segment words appear in the identifier
                $matchCount = 0;
                foreach ($segmentWords as $word) {
                    foreach ($identifierWords as $idWord) {
                        // Use similar_text for fuzzy matching of individual words
                        similar_text($word, $idWord, $percent);
                        if ($percent >= 80.0) {
                            $matchCount++;
                            break;
                        }
                    }
                }

                // Ratio: matched words / max(segment words, identifier words)
                $totalWords = max(count($segmentWords), count($identifierWords));
                $score = $matchCount / $totalWords;

                if ($score > $bestScore) {
                    $bestScore = $score;
                }

                // Also try similar_text on the full strings as a fallback
                similar_text($segment, $identifier, $fullPercent);
                $fullScore = $fullPercent / 100.0;

                if ($fullScore > $bestScore) {
                    $bestScore = $fullScore;
                }
            }
        }

        return min(1.0, $bestScore);
    }
}
