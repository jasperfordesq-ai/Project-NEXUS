<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use App\Models\UserSafeguardingPreference;
use App\Services\MatchApprovalWorkflowService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The single rule for "this match must be checked by a coordinator first".
 *
 * A pair of members needs a coordinator's approval before either is
 * introduced to the other when EITHER member:
 *  - chose a safeguarding option whose triggers include
 *    `requires_broker_approval` or `restricts_matching`, or
 *  - is under active administrative monitoring (`user_messaging_restrictions`
 *    with `under_monitoring = 1` and an expiry that has not passed).
 *
 * Every place that introduces members to each other through matching must
 * ask this class first: the smart matching engine (match lists, Explore,
 * the cache warm-up), the hourly hot-match alert and the legacy digest.
 * Matches for such a pair are withheld until a `match_approvals` row for
 * (searcher, listing) is approved; an unreviewed one is sent to the
 * coordinator queue (/broker/match-approvals) instead of being shown.
 *
 * Fails closed: if the safeguarding state cannot be read, nothing that
 * might need review is shown.
 *
 * Resolve it from the container (`app(MatchApprovalGate::class)`) so unit
 * tests that fake the database can bind a pass-through double.
 */
class MatchApprovalGate
{
    /**
     * Upper bound on new review requests raised by one match computation, so
     * a restricted member with many candidate matches does not flood the
     * coordinators with alerts in one go. The highest-scoring matches are
     * submitted first; the rest are raised on later runs.
     */
    public const MAX_SUBMISSIONS_PER_RUN = 5;

    private const REVIEW_TRIGGERS = ['requires_broker_approval', 'restricts_matching'];

    /**
     * @param int[] $userIds
     * @return array<int, true> user id => true for every member whose matches need review
     *
     * @throws \Throwable when the safeguarding state cannot be read — callers fail closed
     */
    public function membersNeedingApproval(array $userIds, int $tenantId): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $userIds), fn (int $id) => $id > 0)));
        if ($ids === []) {
            return [];
        }

        $flagged = [];

        $rows = DB::table('user_safeguarding_preferences as p')
            ->join('tenant_safeguarding_options as o', function ($join) use ($tenantId) {
                $join->on('o.id', '=', 'p.option_id')
                    ->where('o.tenant_id', '=', $tenantId)
                    ->where('o.is_active', '=', 1);
            })
            ->where('p.tenant_id', $tenantId)
            ->whereIn('p.user_id', $ids)
            ->whereNull('p.revoked_at')
            ->select('p.user_id', 'p.selected_value', 'o.option_type', 'o.triggers')
            ->get();

        foreach ($rows as $row) {
            if (! UserSafeguardingPreference::isEffectivelySelected($row->option_type ?? null, $row->selected_value ?? null)) {
                continue;
            }
            $triggers = is_string($row->triggers)
                ? (json_decode($row->triggers, true) ?: [])
                : (array) ($row->triggers ?? []);
            foreach (self::REVIEW_TRIGGERS as $key) {
                if (! empty($triggers[$key])) {
                    $flagged[(int) $row->user_id] = true;
                    break;
                }
            }
        }

        $monitored = DB::table('user_messaging_restrictions')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $ids)
            ->where('under_monitoring', 1)
            ->where(function ($q) {
                $q->whereNull('monitoring_expires_at')
                    ->orWhere('monitoring_expires_at', '>', now());
            })
            ->pluck('user_id');
        foreach ($monitored as $userId) {
            $flagged[(int) $userId] = true;
        }

        return $flagged;
    }

    /**
     * Whether an introduction between these two members needs a coordinator.
     * Fails closed (true) when the state cannot be read.
     */
    public function pairNeedsApproval(int $firstUserId, int $secondUserId, int $tenantId): bool
    {
        try {
            return $this->membersNeedingApproval([$firstUserId, $secondUserId], $tenantId) !== [];
        } catch (\Throwable $e) {
            Log::error('[MatchApprovalGate] safeguarding state unreadable; withholding introduction', [
                'tenant_id' => $tenantId,
                'exception' => $e::class,
            ]);

            return true;
        }
    }

    /**
     * Whether a coordinator has already approved introducing $searcherId to
     * the owner of $listingId.
     */
    public function isApproved(int $searcherId, int $listingId, int $tenantId): bool
    {
        return DB::table('match_approvals')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $searcherId)
            ->where('listing_id', $listingId)
            ->where('status', 'approved')
            ->exists();
    }

    /**
     * Remove every listing match that needs a coordinator's approval and has
     * not had it. Matches are listing-shaped arrays with `id` (listing id) and
     * `user_id` (listing owner). Order is preserved.
     *
     * @param array<int, array<string, mixed>> $matches
     * @param bool $submitForReview raise a pending review for unreviewed matches
     *                              (false for low-signal suggestions such as cold start)
     * @return array<int, array<string, mixed>>
     */
    public function filterListingMatches(array $matches, int $searcherId, int $tenantId, bool $submitForReview = true): array
    {
        if ($matches === []) {
            return [];
        }

        try {
            $ownerIds = array_map(fn ($m) => (int) ($m['user_id'] ?? 0), $matches);
            $flagged = $this->membersNeedingApproval(array_merge([$searcherId], $ownerIds), $tenantId);
        } catch (\Throwable $e) {
            Log::error('[MatchApprovalGate] safeguarding state unreadable; withholding all matches', [
                'tenant_id' => $tenantId,
                'user_id' => $searcherId,
                'exception' => $e::class,
            ]);

            return [];
        }

        if ($flagged === []) {
            return $matches;
        }

        $searcherFlagged = isset($flagged[$searcherId]);
        $heldListingIds = [];
        foreach ($matches as $match) {
            $owner = (int) ($match['user_id'] ?? 0);
            if ($searcherFlagged || isset($flagged[$owner])) {
                $heldListingIds[] = (int) ($match['id'] ?? 0);
            }
        }
        if ($heldListingIds === []) {
            return $matches;
        }

        try {
            $statuses = [];
            $reviewRows = DB::table('match_approvals')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $searcherId)
                ->whereIn('listing_id', array_values(array_unique($heldListingIds)))
                ->get(['listing_id', 'status']);
            foreach ($reviewRows as $row) {
                $statuses[(int) $row->listing_id][(string) $row->status] = true;
            }
        } catch (\Throwable $e) {
            Log::error('[MatchApprovalGate] match approvals unreadable; withholding held matches', [
                'tenant_id' => $tenantId,
                'user_id' => $searcherId,
                'exception' => $e::class,
            ]);
            $statuses = null;
        }

        $held = array_flip($heldListingIds);
        $kept = [];
        $submitted = 0;
        foreach ($matches as $match) {
            $listingId = (int) ($match['id'] ?? 0);
            if (! isset($held[$listingId])) {
                $kept[] = $match;
                continue;
            }
            if ($statuses === null) {
                continue;
            }
            $listingStatuses = $statuses[$listingId] ?? [];
            if (isset($listingStatuses['approved'])) {
                $kept[] = $match;
                continue;
            }
            if ($listingStatuses !== [] || ! $submitForReview || $submitted >= self::MAX_SUBMISSIONS_PER_RUN) {
                // Pending or rejected: a coordinator has it or has declined it.
                continue;
            }
            if (MatchApprovalWorkflowService::submitForApproval($searcherId, $listingId, $match) !== null) {
                $submitted++;
            }
        }

        return $kept;
    }
}
