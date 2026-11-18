<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\MatchingService;
use App\Services\NotificationDispatcher;
use App\Services\SmartMatchingEngine;
use App\Support\Matching\MatchReasonText;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Tells members about their matches: the alert for a strong or two-way match
 * with a newly posted listing, and the "new matches" digest.
 *
 * Neither had ever worked from the schedule (audit, 17 Nov 2026):
 *
 *  - The hourly alert ended in MatchingService::notifyNewMatches(), a stub
 *    that returned 0. No alert was ever sent, whatever a member chose under
 *    "tell me about hot matches / mutual matches".
 *  - The digest took its "matches" from MatchingService::getSuggestionsForUser(),
 *    which returned RANDOM active members (ORDER BY RAND()), as objects. The
 *    dispatcher read them as arrays, which is a fatal Error in PHP 8, and the
 *    caller's bare catch swallowed it. So no digest was sent either. Had the
 *    crash not been there, members would have been emailed strangers'
 *    names described as matches.
 *
 * Both now take their matches from SmartMatchingEngine::findMatchesForUser(),
 * the same call the Matches page makes. That is deliberate: every rule that
 * decides what a member may be shown (distance, blocks, dismissals, pausing,
 * the safeguarding contact policy, the coordinator approval gate, the
 * community's own on/off switch) lives in that one call, so a notification
 * can never introduce two members the page would not.
 *
 * Nobody is told twice about the same listing: match_notification_sent holds
 * one row per (community, listing, member) and both paths write to it.
 */
class MatchNotificationService
{
    /** A listing is considered "new" for alerts for this long after posting. */
    private const NEW_LISTING_WINDOW_HOURS = 24;

    /** Members considered per new listing, most recently active first. */
    private const RECIPIENTS_PER_LISTING = 40;

    /** Match computations per community per run (each is one page-load of work). */
    private const COMPUTATIONS_PER_RUN = 150;

    /** Members sent a digest per community per run. */
    private const DIGESTS_PER_RUN = 200;

    /** How far back each digest looks for newly posted listings, in hours. */
    private const DIGEST_LOOKBACK_HOURS = [
        'daily' => 24,
        'fortnightly' => 336,
        'monthly' => 720,
    ];

    public function __construct(
        private readonly SmartMatchingEngine $engine,
    ) {}

    /**
     * Alert members to strong ("hot") or two-way ("mutual") matches with
     * listings posted in the last day. Runs hourly for the current community;
     * each listing is worked through once.
     *
     * @return int alerts sent
     */
    public function notifyForNewListings(): int
    {
        $tenantId = (int) TenantContext::getId();
        if ($tenantId <= 0 || !$this->matchingRuns()) {
            return 0;
        }

        $hotThreshold = (float) ($this->engine->getConfig()['hot_match_threshold'] ?? 80);

        $listings = DB::select(
            "SELECT l.id, l.user_id, l.type, l.category_id, l.title
             FROM listings l
             WHERE l.tenant_id = ? AND l.status = 'active'
               AND (l.moderation_status IS NULL OR l.moderation_status = 'approved')
               AND l.created_at >= DATE_SUB(NOW(), INTERVAL " . self::NEW_LISTING_WINDOW_HOURS . " HOUR)
             ORDER BY l.created_at ASC
             LIMIT 100",
            [$tenantId]
        );

        $sent = 0;
        $computations = 0;
        /** @var array<int, array<int, array<string, mixed>>> $matchesByMember listing id => match */
        $matchesByMember = [];

        foreach ($listings as $listing) {
            $listingId = (int) $listing->id;
            $doneKey = "match_alerts_done:{$tenantId}:{$listingId}";
            if (Cache::has($doneKey)) {
                continue;
            }

            $finished = true;
            foreach ($this->possibleRecipients($tenantId, $listing) as $memberId) {
                if (!isset($matchesByMember[$memberId])) {
                    if ($computations >= self::COMPUTATIONS_PER_RUN) {
                        // Out of budget: this listing is picked up again next hour.
                        $finished = false;
                        break;
                    }
                    $computations++;
                    $matchesByMember[$memberId] = $this->matchesFor($memberId);
                }

                $match = $matchesByMember[$memberId][$listingId] ?? null;
                if ($match === null) {
                    continue;
                }

                if ($this->alert($tenantId, $memberId, $match, $hotThreshold)) {
                    $sent++;
                }
            }

            if ($finished) {
                Cache::put($doneKey, 1, now()->addHours(self::NEW_LISTING_WINDOW_HOURS * 3));
            }
        }

        return $sent;
    }

    /**
     * Send the "new matches" digest to every member of the current community
     * who chose this frequency (members who never chose get the monthly one).
     *
     * @param string $frequency daily | fortnightly | monthly
     * @return int digests sent
     */
    public function sendDigests(string $frequency): int
    {
        $tenantId = (int) TenantContext::getId();
        $lookbackHours = self::DIGEST_LOOKBACK_HOURS[$frequency] ?? null;
        if ($tenantId <= 0 || $lookbackHours === null || !$this->matchingRuns()) {
            return 0;
        }

        // 'weekly' is a retired choice that now means monthly.
        $members = DB::select(
            "SELECT u.id
             FROM users u
             LEFT JOIN match_preferences mp ON mp.user_id = u.id AND mp.tenant_id = u.tenant_id
             WHERE u.tenant_id = ? AND u.status = 'active'
               AND COALESCE(mp.matching_paused, 0) = 0
               AND (
                   EXISTS (SELECT 1 FROM listings l
                           WHERE l.user_id = u.id AND l.tenant_id = u.tenant_id AND l.status = 'active')
                   -- No listing, but skills to match by (see SmartMatchingEngine::skillListings)
                   OR EXISTS (SELECT 1 FROM user_skills us WHERE us.tenant_id = u.tenant_id AND us.user_id = u.id)
                   OR TRIM(COALESCE(u.skills, '')) <> ''
               )
               AND (
                   mp.notification_frequency = ?
                   OR (? = 'monthly' AND (mp.notification_frequency IS NULL OR mp.notification_frequency = 'weekly'))
               )
             ORDER BY u.id
             LIMIT " . self::DIGESTS_PER_RUN,
            [$tenantId, $frequency, $frequency]
        );

        $since = now()->subHours($lookbackHours);
        $sent = 0;

        foreach ($members as $member) {
            $memberId = (int) $member->id;

            try {
                $matches = $this->matchesFor($memberId);
                if ($matches === []) {
                    continue;
                }

                $alreadyTold = $this->alreadyTold($tenantId, $memberId, array_keys($matches));
                $fresh = [];
                foreach ($matches as $listingId => $match) {
                    $postedAt = isset($match['created_at']) ? strtotime((string) $match['created_at']) : false;
                    if ($postedAt === false || $postedAt < $since->getTimestamp() || isset($alreadyTold[$listingId])) {
                        continue;
                    }
                    $fresh[$listingId] = $match;
                }
                if ($fresh === []) {
                    continue;
                }

                $names = $this->publicNames($tenantId, array_map(fn ($m) => (int) ($m['user_id'] ?? 0), $fresh));
                $digest = [];
                foreach ($fresh as $listingId => $match) {
                    $digest[] = $this->emailShape($match, $names);
                }

                NotificationDispatcher::dispatchMatchDigest($memberId, $digest, $frequency);
                foreach ($fresh as $listingId => $match) {
                    $this->remember($tenantId, (int) $listingId, $memberId, (float) ($match['match_score'] ?? 0));
                }
                $sent++;
            } catch (\Throwable $e) {
                // One member's digest failing must not stop the rest, but it
                // is reported: the silent catch here is how the digest stayed
                // dead without anyone knowing.
                Log::error('[MatchNotificationService] digest failed for a member', [
                    'tenant_id' => $tenantId,
                    'user_id' => $memberId,
                    'frequency' => $frequency,
                    'exception' => $e::class,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $sent;
    }

    // ---------------------------------------------------------------------

    /** Matching is on for this community and it uses listings at all. */
    private function matchingRuns(): bool
    {
        return TenantContext::hasModule('listings') && $this->engine->isEnabled();
    }

    /**
     * The member's current matches, keyed by listing id. Cold-start
     * suggestions are browsing ideas, not matches, and are never notified.
     *
     * @return array<int, array<string, mixed>>
     */
    private function matchesFor(int $memberId): array
    {
        $byListing = [];
        foreach ($this->engine->findMatchesForUser($memberId, ['limit' => 50]) as $match) {
            if (($match['match_type'] ?? '') === 'cold_start') {
                continue;
            }
            $listingId = (int) ($match['id'] ?? 0);
            if ($listingId > 0) {
                $byListing[$listingId] = $match;
            }
        }

        return $byListing;
    }

    /**
     * Members who could pair with this listing and have not been told about
     * it yet. Only a shortlist: the engine decides.
     *
     * Two kinds of member qualify, nearest first:
     *  - one with a live listing of the opposite kind, in the same category
     *    first and then in any category (the engine now matches across
     *    categories, so a category filter here would hide real matches);
     *  - one with no listing at all whose profile skills point the right way
     *    (a new request needs someone who can do it; a new offer someone who
     *    wants it). The engine matches such members by their skills.
     *
     * @return int[]
     */
    private function possibleRecipients(int $tenantId, object $listing): array
    {
        $oppositeType = ((string) $listing->type) === 'offer' ? 'request' : 'offer';
        $categoryId = (int) ($listing->category_id ?? 0);

        // Skills without a direction are something the member can do.
        $skillDirection = $oppositeType === 'offer'
            ? '(us.is_offering = 1 OR (COALESCE(us.is_offering, 0) = 0 AND COALESCE(us.is_requesting, 0) = 0))'
            : 'us.is_requesting = 1';
        // The free-text skills field also only describes what a member can do.
        $profileText = $oppositeType === 'offer' ? " OR TRIM(COALESCE(u.skills, '')) <> ''" : '';

        $rows = DB::select(
            "SELECT u.id,
                    CASE
                        WHEN EXISTS (SELECT 1 FROM listings l3
                                     WHERE l3.user_id = u.id AND l3.tenant_id = u.tenant_id AND l3.status = 'active'
                                       AND l3.type = ? AND l3.category_id = ?) THEN 2
                        WHEN EXISTS (SELECT 1 FROM listings l4
                                     WHERE l4.user_id = u.id AND l4.tenant_id = u.tenant_id AND l4.status = 'active'
                                       AND l4.type = ?) THEN 1
                        ELSE 0
                    END AS closeness
             FROM users u
             WHERE u.tenant_id = ? AND u.status = 'active' AND u.id != ?
               AND (
                   EXISTS (SELECT 1 FROM listings l2
                           WHERE l2.user_id = u.id AND l2.tenant_id = u.tenant_id
                             AND l2.status = 'active' AND l2.type = ?)
                   OR (
                       NOT EXISTS (SELECT 1 FROM listings l5
                                   WHERE l5.user_id = u.id AND l5.tenant_id = u.tenant_id AND l5.status = 'active')
                       AND (EXISTS (SELECT 1 FROM user_skills us
                                    WHERE us.tenant_id = u.tenant_id AND us.user_id = u.id AND {$skillDirection}){$profileText})
                   )
               )
               AND NOT EXISTS (
                   SELECT 1 FROM match_notification_sent s
                   WHERE s.tenant_id = ? AND s.listing_id = ? AND s.matched_user_id = u.id)
             ORDER BY closeness DESC, u.last_active_at DESC
             LIMIT " . self::RECIPIENTS_PER_LISTING,
            [
                $oppositeType, $categoryId, $oppositeType,
                $tenantId, (int) $listing->user_id, $oppositeType,
                $tenantId, (int) $listing->id,
            ]
        );

        return array_map(fn ($row) => (int) $row->id, $rows);
    }

    /**
     * Send the hot or mutual alert for one match, if the member asked for it.
     *
     * @param array<string, mixed> $match
     */
    private function alert(int $tenantId, int $memberId, array $match, float $hotThreshold): bool
    {
        $prefs = MatchingService::getPreferences($memberId);
        if (($prefs['notification_frequency'] ?? 'monthly') === 'never') {
            return false;
        }

        $score = (float) ($match['match_score'] ?? 0);
        $isHot = $score >= $hotThreshold && !empty($prefs['notify_hot_matches']);
        $isMutual = ($match['match_type'] ?? '') === 'mutual' && !empty($prefs['notify_mutual_matches']);
        if (!$isHot && !$isMutual) {
            return false;
        }

        $listingId = (int) $match['id'];
        $names = $this->publicNames($tenantId, [(int) ($match['user_id'] ?? 0)]);
        $recipient = DB::table('users')
            ->where('id', $memberId)
            ->where('tenant_id', $tenantId)
            ->select(['preferred_language'])
            ->first();

        try {
            // The reasons are translated here, in the member's language; the
            // dispatcher renders everything else in that language itself.
            $told = (bool) LocaleContext::withLocale($recipient, function () use ($memberId, $match, $names, $isHot, $tenantId): bool {
                $data = $this->emailShape($match, $names);
                $data['match_reasons'] = MatchReasonText::localize($match['match_reasons'] ?? []);

                if ($isHot) {
                    return NotificationDispatcher::dispatchHotMatch($memberId, $data);
                }

                NotificationDispatcher::dispatchMutualMatch($memberId, $data, $this->exchange($tenantId, $memberId, $match));

                return true;
            });
        } catch (\Throwable $e) {
            Log::error('[MatchNotificationService] match alert failed', [
                'tenant_id' => $tenantId,
                'user_id' => $memberId,
                'listing_id' => $listingId,
                'exception' => $e::class,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        if ($told) {
            $this->remember($tenantId, $listingId, $memberId, $score);
        }

        return $told;
    }

    /**
     * What each side brings to a two-way match, for the mutual-match message.
     *
     * @param array<string, mixed> $match
     * @return array{they_offer?: string, you_offer?: string}
     */
    private function exchange(int $tenantId, int $memberId, array $match): array
    {
        $ownerId = (int) ($match['user_id'] ?? 0);
        $rows = DB::select(
            "SELECT user_id, type, title, category_id FROM listings
             WHERE tenant_id = ? AND status = 'active' AND user_id IN (?, ?)
             ORDER BY created_at DESC",
            [$tenantId, $ownerId, $memberId]
        );

        $offers = [$ownerId => [], $memberId => []];
        $wantedCategories = [$ownerId => [], $memberId => []];
        foreach ($rows as $row) {
            $userId = (int) $row->user_id;
            if ((string) $row->type === 'offer') {
                $offers[$userId][] = $row;
            } elseif (!empty($row->category_id)) {
                $wantedCategories[$userId][(int) $row->category_id] = true;
            }
        }

        $pick = static function (array $offered, array $wanted): ?string {
            foreach ($offered as $offer) {
                if (!empty($offer->category_id) && isset($wanted[(int) $offer->category_id])) {
                    return (string) $offer->title;
                }
            }

            return isset($offered[0]) ? (string) $offered[0]->title : null;
        };

        $info = [];
        $theyOffer = ($match['type'] ?? '') === 'offer'
            ? (string) ($match['title'] ?? '')
            : $pick($offers[$ownerId], $wantedCategories[$memberId]);
        $youOffer = ($match['type'] ?? '') === 'request' && !empty($match['matched_listing'])
            ? (string) $match['matched_listing']
            : $pick($offers[$memberId], $wantedCategories[$ownerId]);
        if ($theyOffer !== null && $theyOffer !== '') {
            $info['they_offer'] = $theyOffer;
        }
        if ($youOffer !== null && $youOffer !== '') {
            $info['you_offer'] = $youOffer;
        }

        return $info;
    }

    /**
     * The fields the notification text and the three email templates read.
     * The name is always the PUBLIC one (first name, or an organisation's
     * trading name): a match email never carries a member's surname.
     *
     * @param array<string, mixed> $match
     * @param array<int, string> $names
     * @return array<string, mixed>
     */
    private function emailShape(array $match, array $names): array
    {
        $listingId = (int) ($match['id'] ?? 0);

        return [
            'id' => $listingId,
            'listing_id' => $listingId,
            'title' => (string) ($match['title'] ?? ''),
            'type' => (string) ($match['type'] ?? 'offer'),
            'category_name' => $match['category_name'] ?? '',
            'user_id' => (int) ($match['user_id'] ?? 0),
            'user_name' => $names[(int) ($match['user_id'] ?? 0)] ?? '',
            'match_score' => (float) ($match['match_score'] ?? 0),
            'match_type' => (string) ($match['match_type'] ?? 'one_way'),
            'match_reasons' => $match['match_reasons'] ?? [],
            'distance_km' => isset($match['distance_km']) && is_numeric($match['distance_km'])
                ? round((float) $match['distance_km'], 1) : null,
        ];
    }

    /**
     * @param int[] $userIds
     * @return array<int, string> user id => public display name
     */
    private function publicNames(int $tenantId, array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds))));
        if ($userIds === []) {
            return [];
        }

        $rows = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $userIds)
            ->select(['id', 'first_name', 'profile_type', 'organization_name'])
            ->get();

        $names = [];
        foreach ($rows as $row) {
            $names[(int) $row->id] = UserDisplayName::publicName($row, '');
        }

        return $names;
    }

    /**
     * @param int[] $listingIds
     * @return array<int, true>
     */
    private function alreadyTold(int $tenantId, int $memberId, array $listingIds): array
    {
        if ($listingIds === []) {
            return [];
        }

        $rows = DB::table('match_notification_sent')
            ->where('tenant_id', $tenantId)
            ->where('matched_user_id', $memberId)
            ->whereIn('listing_id', $listingIds)
            ->pluck('listing_id');

        $told = [];
        foreach ($rows as $listingId) {
            $told[(int) $listingId] = true;
        }

        return $told;
    }

    private function remember(int $tenantId, int $listingId, int $memberId, float $score): void
    {
        DB::insert(
            "INSERT IGNORE INTO match_notification_sent (tenant_id, listing_id, matched_user_id, match_score, sent_at)
             VALUES (?, ?, ?, ?, NOW())",
            [$tenantId, $listingId, $memberId, (int) round(max(0.0, min(100.0, $score)))]
        );
    }
}
