<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;
use App\Support\Matching\MatchReasonText;
use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\MatchConcepts;
use App\Services\Translation\TaxonomyNameLocalizer;

/**
 * CrossModuleMatchingService — Aggregates match results across listings, groups,
 * volunteering, and events for a given user.
 *
 * Uses SmartMatchingEngine for listing-based matching and supplements with
 * group/volunteering/event recommendations based on skills, categories, and proximity.
 */
class CrossModuleMatchingService
{
    public function __construct(
        private readonly SmartMatchingEngine $smartMatchingEngine,
        private readonly GroupMatchingService $groupMatchingService,
    ) {}

    /**
     * Get all matches for a user across multiple modules.
     *
     * Options:
     * - limit: int (default 20)
     * - min_score: int (default: the member's saved minimum, else the community's)
     * - modules: string[] (default all: listings, groups, volunteering, events)
     * - debug: bool (include breakdown data)
     *
     * @return array{matches: array, meta: array}
     */
    /**
     * Keep only the match sources this community has switched on (29 Oct 2026):
     * group, volunteering and event matches were offered even where those
     * features were off, so both websites could show a "join this group" card in
     * a community without groups.
     *
     * @param  list<string> $requested
     * @return list<string>
     */
    public static function enabledModules(array $requested): array
    {
        $switchedOn = [
            'listings' => TenantContext::hasModule('listings'),
            'groups' => (bool) TenantContext::hasFeature('groups'),
            'volunteering' => (bool) TenantContext::hasFeature('volunteering'),
            'events' => (bool) TenantContext::hasFeature('events'),
            'jobs' => (bool) TenantContext::hasFeature('job_vacancies'),
        ];

        return array_values(array_filter(
            $requested,
            static fn ($module): bool => is_string($module) && ($switchedOn[$module] ?? false)
        ));
    }

    public function getAllMatches(int $userId, array $options = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = $options['limit'] ?? 20;
        $minScore = isset($options['min_score'])
            ? (int) $options['min_score']
            : (int) round($this->smartMatchingEngine->effectiveMinScore($userId));
        $debug = $options['debug'] ?? false;
        $modules = self::enabledModules($options['modules'] ?? ['listings', 'groups', 'volunteering', 'events']);

        $allMatches = [];
        $engineMeta = null;

        // The community has switched Smart Matching off: nothing is matched,
        // from any source, and the page is told why it is empty.
        if (!$this->smartMatchingEngine->isEnabled()) {
            return [
                'matches' => [],
                'meta' => [
                    'total' => 0,
                    'modules' => $modules,
                    'min_score' => $minScore,
                    'needs_location' => false,
                    'degraded' => false,
                    'degraded_reason' => null,
                    'has_active_listings' => null,
                    'paused' => false,
                    'disabled' => true,
                ],
            ];
        }

        // "Pause matching" pauses matching: every kind, not only offers and
        // requests. Groups, volunteering and events used to go on being
        // suggested under the page's own "Matching is paused" notice.
        if (!empty(MatchingService::getPreferences($userId)['matching_paused'])) {
            return [
                'matches' => [],
                'meta' => [
                    'total' => 0,
                    'modules' => $modules,
                    'min_score' => $minScore,
                    'needs_location' => false,
                    'degraded' => false,
                    'degraded_reason' => null,
                    'has_active_listings' => null,
                    'paused' => true,
                    'disabled' => false,
                ],
            ];
        }

        try {
            if (in_array('listings', $modules, true)) {
                $listingMatches = $this->getListingMatches($userId, $tenantId, $minScore, $limit, $debug, $engineMeta);
                $allMatches = array_merge($allMatches, $listingMatches);
            }

            if (in_array('groups', $modules, true)) {
                $groupMatches = $this->getGroupMatches($userId, $tenantId, $minScore, $limit);
                $allMatches = array_merge($allMatches, $groupMatches);
            }

            if (in_array('volunteering', $modules, true)) {
                $volMatches = $this->getVolunteeringMatches($userId, $tenantId, $minScore, $limit);
                $allMatches = array_merge($allMatches, $volMatches);
            }

            if (in_array('events', $modules, true)) {
                $eventMatches = $this->getEventMatches($userId, $tenantId, $minScore, $limit);
                $allMatches = array_merge($allMatches, $eventMatches);
            }
        } catch (\Throwable $e) {
            Log::warning('[CrossModuleMatchingService] Error aggregating matches', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        // Learning boosts and dismissal filtering for listing matches now live
        // INSIDE SmartMatchingEngine (batched, and included in the warmed
        // cache) — applying them again here would double-count.

        // Best first, with a place kept for every kind (see sharedOut()).
        $allMatches = array_values(self::sharedOut($allMatches, (int) $limit));

        // Strip debug data if not requested
        if (!$debug) {
            $allMatches = array_map(function ($m) {
                unset($m['match_breakdown']);
                return $m;
            }, $allMatches);
        }

        return [
            'matches' => $allMatches,
            'meta' => [
                'total' => count($allMatches),
                'modules' => $modules,
                'min_score' => $minScore,
                // Degraded-mode signals from the matching engine — the frontend
                // uses these to prompt users without a location / without listings.
                'needs_location' => (bool) ($engineMeta['needs_location'] ?? false),
                'degraded' => (bool) ($engineMeta['degraded'] ?? false),
                'degraded_reason' => $engineMeta['degraded_reason'] ?? null,
                'has_active_listings' => $engineMeta['has_active_listings'] ?? null,
                'paused' => (bool) ($engineMeta['paused'] ?? false),
                'disabled' => false,
                // The engine knew both and they were dropped here, so no
                // client could say "matched from the skills on your profile"
                // or "distances are from the community's centre".
                'matched_from_skills' => (bool) ($engineMeta['matched_from_skills'] ?? false),
                'location_approximate' => (bool) ($engineMeta['location_approximate'] ?? false),
                // The community's own "strong match" score, which decides the
                // alert. Every client hard-coded 80.
                'hot_threshold' => (int) ($this->smartMatchingEngine->getConfig()['hot_match_threshold'] ?? 80),
            ],
        ];
    }

    /** Places kept for each kind of match on a full page. */
    private const PLACES_PER_KIND = 3;

    /**
     * The page of matches: every kind keeps up to PLACES_PER_KIND of its best,
     * and the rest of the page goes to the highest scores.
     *
     * The four kinds are scored four different ways (a volunteering match
     * can reach 95, a strong offer or request rarely passes 85), and were
     * sorted as one list and cut to the limit: a member with enough offers
     * and requests never saw a group or an event, and that tab disappeared.
     *
     * @param array<int, array<string, mixed>> $matches
     * @return array<int, array<string, mixed>>
     */
    private static function sharedOut(array $matches, int $limit): array
    {
        $byScore = fn ($a, $b) => ($b['match_score'] ?? 0) <=> ($a['match_score'] ?? 0);
        usort($matches, $byScore);
        if (count($matches) <= $limit) {
            return $matches;
        }

        $kept = [];
        $rest = [];
        $perKind = [];
        foreach ($matches as $match) {
            $kind = (string) ($match['module'] ?? '');
            if (($perKind[$kind] ?? 0) < self::PLACES_PER_KIND && count($kept) < $limit) {
                $perKind[$kind] = ($perKind[$kind] ?? 0) + 1;
                $kept[] = $match;
            } else {
                $rest[] = $match;
            }
        }
        $kept = array_merge($kept, array_slice($rest, 0, max(0, $limit - count($kept))));
        usort($kept, $byScore);

        return $kept;
    }

    /**
     * Get listing-based matches from SmartMatchingEngine.
     */
    private function getListingMatches(int $userId, int $tenantId, int $minScore, int $limit, bool $debug, ?array &$engineMeta = null): array
    {
        try {
            $raw = $this->smartMatchingEngine->findMatchesForUser($userId, [
                'min_score' => $minScore,
                'limit' => $limit,
            ], $engineMeta);

            // Cached LLM explanations (AI tenants): matches are computed live,
            // but explanations are generated asynchronously into match_cache —
            // join them in by listing id (one query, silently absent when the
            // column/rows don't exist).
            $explanations = [];
            try {
                $listingIds = array_values(array_filter(array_map(
                    fn ($m) => (int) ($m['id'] ?? 0),
                    $raw
                )));
                if (!empty($listingIds)) {
                    $placeholders = implode(',', array_fill(0, count($listingIds), '?'));
                    $rows = DB::select(
                        "SELECT listing_id, explanation FROM match_cache
                         WHERE tenant_id = ? AND user_id = ? AND explanation IS NOT NULL
                           AND listing_id IN ($placeholders)",
                        array_merge([$tenantId, $userId], $listingIds)
                    );
                    foreach ($rows as $row) {
                        $explanations[(int) $row->listing_id] = (string) $row->explanation;
                    }
                }
            } catch (\Throwable $e) {
                // Pre-migration schema or cold cache — algorithmic reasons remain.
            }

            return array_map(function ($match) use ($debug, $explanations) {
                $result = [
                    'module' => 'listing',
                    'listing_id' => (int) ($match['id'] ?? 0),
                    'title' => $match['title'] ?? '',
                    'description' => mb_substr($match['description'] ?? '', 0, 200),
                    'type' => $match['type'] ?? 'offer',
                    'category_name' => $match['category_name'] ?? null,
                    'user_id' => (int) ($match['user_id'] ?? 0),
                    'user_name' => UserDisplayName::resolve($match),
                    'avatar_url' => $match['avatar_url'] ?? null,
                    'match_score' => (float) ($match['match_score'] ?? 0),
                    'match_type' => $match['match_type'] ?? 'one_way',
                    // In the reader's language, category name included (AWID, Oct 2026).
                    'match_reasons' => MatchReasonText::localize(
                        $match['match_reasons'] ?? [],
                        self::categoryNameMap($match)
                    ),
                    'distance_km' => isset($match['distance_km']) && is_numeric($match['distance_km'])
                        ? (float) $match['distance_km'] : null,
                    'is_remote' => ($match['service_type'] ?? 'physical_only') === 'remote_only',
                    'is_mutual' => ($match['match_type'] ?? '') === 'mutual',
                    'explanation' => $explanations[(int) ($match['id'] ?? 0)] ?? null,
                    'explanation_source' => isset($explanations[(int) ($match['id'] ?? 0)]) ? 'ai' : 'algorithmic',
                    // Pillar/signal breakdown feeds the member "why this score"
                    // panel (v2 engine only; null on the v1 rollback path).
                    'score_breakdown' => $match['score_breakdown'] ?? null,
                    'matched_listing' => $match['matched_listing'] ?? null,
                    'created_at' => $match['created_at'] ?? null,
                ];

                if ($debug && isset($match['match_breakdown'])) {
                    $result['match_breakdown'] = $match['match_breakdown'];
                }

                return $result;
            }, $raw);
        } catch (\Throwable $e) {
            Log::warning('[CrossModuleMatchingService] Listing matches failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Get group matches — delegates to GroupMatchingService, which serves the
     * cron-warmed group_match_cache backed by GroupRecommendationEngine
     * (CF + content + location + activity fusion). The old implementation here
     * was keyword-Jaccard against the newest groups.
     */
    private function getGroupMatches(int $userId, int $tenantId, int $minScore, int $limit): array
    {
        try {
            return $this->groupMatchingService->getMatchesForUser($userId, $minScore, $limit);
        } catch (\Throwable $e) {
            Log::warning('[CrossModuleMatchingService] Group matches failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Volunteering matches: open opportunities whose needed skills, or
     * wording, overlap what the member says they can do.
     *
     * Until 17 Nov 2026 this listed the newest ORGANISATIONS, gave each a
     * floor score of 35 and the reason "matches your profile" whether or not
     * anything matched, and sent an organisation id that two of the three
     * clients opened as an opportunity id (so the card led to an unrelated
     * opportunity). It now matches opportunities, under the same public
     * visibility rule as the volunteering pages
     * (VolunteerMatchingService::suggestOpportunities), and offers one only
     * when there is real overlap.
     *
     * "Real" means a skill the opportunity asks for, the same kind of help
     * (MatchConcepts), or two words in common. One shared word of any sort
     * used to be enough ("local", "people", "group"). And what the member
     * can do is read from the offers
     * they have posted as well as their profile: a member with a listing
     * "Guitar lessons" and an empty skills list was matched with nothing.
     */
    private function getVolunteeringMatches(int $userId, int $tenantId, int $minScore, int $limit): array
    {
        try {
            $memberKeywords = $this->getMemberOfferKeywords($userId, $tenantId);
            if ($memberKeywords === []) {
                // Nothing to match on. The volunteering pages list everything.
                return [];
            }

            $appliedIds = DB::table('vol_applications')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->pluck('opportunity_id')
                ->all();

            $federationColumnExists = VolunteerService::opportunitiesHaveFederatedColumn();
            $query = DB::table('vol_opportunities as opp')
                ->leftJoin('vol_organizations as org', function ($join) {
                    $join->on('opp.organization_id', '=', 'org.id')
                        ->on('opp.tenant_id', '=', 'org.tenant_id');
                })
                ->where('opp.tenant_id', $tenantId)
                ->where('opp.is_active', 1)
                ->whereIn('opp.status', VolunteerService::PUBLIC_OPPORTUNITY_STATUSES)
                ->where(function ($outer) use ($federationColumnExists) {
                    $outer->whereIn('org.status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES);
                    if ($federationColumnExists) {
                        $outer->orWhere('opp.is_federated', 1);
                    }
                })
                ->where(function ($open) {
                    $open->whereNull('opp.end_date')->orWhere('opp.end_date', '>=', now()->toDateString());
                })
                ->select(
                    'opp.id', 'opp.title', 'opp.description', 'opp.location', 'opp.skills_needed',
                    'opp.organization_id', 'opp.created_at', 'org.name as organization_name'
                );

            if (!empty($appliedIds)) {
                $query->whereNotIn('opp.id', $appliedIds);
            }
            $hidden = self::hiddenSourceIds($userId, $tenantId, 'volunteering');
            if ($hidden !== []) {
                $query->whereNotIn('opp.id', $hidden);
            }

            $opportunities = $query->orderByDesc('opp.id')->limit(200)->get();

            $matches = [];
            foreach ($opportunities as $opp) {
                $needed = KeywordExtractor::extract(implode(' ', self::skillNames((string) ($opp->skills_needed ?? ''))));
                $skillShare = $needed !== []
                    ? count(array_intersect($needed, $memberKeywords)) / count($needed)
                    : 0.0;
                $wording = KeywordExtractor::extract(($opp->title ?? '') . ' ' . ($opp->description ?? ''));
                [$kindsShared, $wordsShared] = self::overlap($wording, $memberKeywords);

                if ($skillShare <= 0.0 && $kindsShared === 0 && $wordsShared < 2) {
                    continue;
                }

                if ($skillShare > 0.0) {
                    $score = 55.0 + 40.0 * $skillShare;
                } elseif ($kindsShared > 0) {
                    $score = min(70.0, 50.0 + 5.0 * $wordsShared);
                } else {
                    $score = min(55.0, 40.0 + 5.0 * $wordsShared);
                }
                $score = round(min(95.0, $score), 1);

                if ($score < $minScore) {
                    continue;
                }

                $matches[] = [
                    'module' => 'volunteering',
                    'opportunity_id' => (int) $opp->id,
                    'organization_id' => $opp->organization_id !== null ? (int) $opp->organization_id : null,
                    'organization_name' => $opp->organization_name ?? null,
                    'title' => (string) $opp->title,
                    'description' => mb_substr((string) ($opp->description ?? ''), 0, 200),
                    'location' => $opp->location ?? null,
                    'match_score' => $score,
                    'match_type' => 'volunteering_recommendation',
                    'match_reasons' => MatchReasonText::localize([
                        $skillShare > 0.0 ? 'Matches your skills' : 'Volunteering opportunity that matches your profile',
                    ]),
                    'distance_km' => null,
                    'is_remote' => false,
                    'is_mutual' => false,
                    'created_at' => $opp->created_at ?? null,
                ];
            }

            usort($matches, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

            return array_slice($matches, 0, $limit);
        } catch (\Throwable $e) {
            // One source failing must not blank the page, but it must be SEEN:
            // the silent `return []` that used to sit here is how event
            // matching stayed broken for months.
            Log::error('[CrossModuleMatchingService] Volunteering matches failed', [
                'user_id' => $userId,
                'exception' => $e::class,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Event matches: upcoming events the member may see and has not answered,
     * that are about something the member does or wants: the same category
     * as one of their listings, the same kind of help (MatchConcepts) as a
     * skill or listing of theirs, or two words in common with them.
     *
     * Until 19 Nov 2026 one word shared between the event and the member's
     * skills or profile text was enough ("community", "people", "local"),
     * and the member's own listings were not read at all. The category test
     * rarely helps: events have their own categories, separate from the
     * listing ones.
     *
     * The previous query selected `events.event_date` and joined
     * `event_attendees`. Neither exists (the column is `start_time`, the
     * table `event_rsvps`), so it threw on every call and a bare catch turned
     * that into an empty list: no member was ever shown an event match. The
     * list of events now comes from EventService::getAll(), the one place the
     * "may this member see this event" rule lives, so drafts and private
     * events cannot leak in through matching.
     */
    private function getEventMatches(int $userId, int $tenantId, int $minScore, int $limit): array
    {
        try {
            $listing = EventService::getAll([
                'when' => 'upcoming',
                'viewer_id' => $userId,
                'limit' => min(100, max(20, $limit * 3)),
            ]);
            $events = is_array($listing['items'] ?? null) ? $listing['items'] : [];
            if ($events === []) {
                return [];
            }

            $eventIds = array_values(array_filter(array_map(fn ($e) => (int) ($e['id'] ?? 0), $events)));
            $answered = [];
            if ($eventIds !== []) {
                $rows = DB::table('event_rsvps')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->whereIn('event_id', $eventIds)
                    ->pluck('event_id');
                foreach ($rows as $eventId) {
                    $answered[(int) $eventId] = true;
                }
            }

            foreach (self::hiddenSourceIds($userId, $tenantId, 'event') as $hiddenId) {
                $answered[$hiddenId] = true; // hidden by the member: treated as answered
            }

            $userCategoryIds = $this->getUserCategoryIds($userId, $tenantId);
            $interests = $this->getMemberInterestKeywords($userId, $tenantId);

            $matches = [];
            foreach ($events as $event) {
                $eventId = (int) ($event['id'] ?? 0);
                if ($eventId <= 0
                    || (int) ($event['user_id'] ?? 0) === $userId
                    || isset($answered[$eventId])
                    || in_array((string) ($event['operational_status'] ?? ''), ['cancelled', 'postponed', 'completed'], true)
                    || in_array((string) ($event['status'] ?? ''), ['cancelled', 'completed', 'draft'], true)
                ) {
                    continue;
                }

                $categoryHit = !empty($event['category_id'])
                    && in_array((int) $event['category_id'], $userCategoryIds, true);
                [$kindsShared, $wordsShared] = self::overlap(
                    KeywordExtractor::extract(($event['title'] ?? '') . ' ' . ($event['description'] ?? '')),
                    $interests
                );

                // A match needs a reason. Every upcoming event used to get a
                // base score and the words "matches your interests".
                if (!$categoryHit && $kindsShared === 0 && $wordsShared < 2) {
                    continue;
                }

                $score = ($categoryHit ? 60.0 : ($kindsShared > 0 ? 55.0 : 42.0))
                    + min(15.0, 5.0 * $kindsShared + 3.0 * $wordsShared);

                $startsAt = $event['start_time'] ?? null;
                $startsAtTs = $startsAt ? strtotime((string) $startsAt) : false;
                if ($startsAtTs !== false && ($startsAtTs - time()) <= 7 * 86400) {
                    $score += 5.0;
                }

                $score = round(min(95.0, $score), 1);
                if ($score < $minScore) {
                    continue;
                }

                $matches[] = [
                    'module' => 'event',
                    'event_id' => $eventId,
                    'title' => (string) ($event['title'] ?? ''),
                    'description' => mb_substr((string) ($event['description'] ?? ''), 0, 200),
                    'event_date' => $startsAt,
                    // The event's own time zone and whether it is all-day, so a
                    // client can show the date the organiser meant.
                    'timezone' => $event['timezone'] ?? null,
                    'all_day' => !empty($event['all_day']),
                    'location' => $event['location'] ?? null,
                    'image_url' => $event['cover_image'] ?? $event['image_url'] ?? null,
                    'attendee_count' => (int) ($event['attendee_count'] ?? 0),
                    'match_score' => $score,
                    'match_type' => 'event_recommendation',
                    'match_reasons' => MatchReasonText::localize(['Upcoming event that matches your interests']),
                    'distance_km' => null,
                    'is_remote' => false,
                    'is_mutual' => false,
                    'created_at' => $event['created_at'] ?? null,
                ];
            }

            usort($matches, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

            return array_slice($matches, 0, $limit);
        } catch (\Throwable $e) {
            Log::error('[CrossModuleMatchingService] Event matches failed', [
                'user_id' => $userId,
                'exception' => $e::class,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Volunteering opportunities or events this member has hidden from
     * their matches (MatchingController::dismissTyped).
     *
     * @return int[]
     */
    private static function hiddenSourceIds(int $userId, int $tenantId, string $sourceType): array
    {
        try {
            return array_map('intval', DB::table('match_source_dismissals')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('source_type', $sourceType)
                ->pluck('source_id')
                ->all());
        } catch (\Throwable $e) {
            // Reported, not hidden: without this list a hidden match comes back.
            Log::error('[CrossModuleMatching] hidden matches unavailable', [
                'user_id' => $userId, 'source_type' => $sourceType, 'exception' => $e::class, 'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * What the member does and wants, as keywords: their profile skills in
     * both directions, and every listing they have live. From their profile
     * text only the KINDS of help it mentions are kept ("retired nurse, keen
     * gardener" gives health and gardening): its ordinary words are prose
     * about a person, and matched as keywords they met almost any event.
     *
     * @return string[]
     */
    private function getMemberInterestKeywords(int $userId, int $tenantId): array
    {
        try {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select('skills', 'bio')
                ->first();
            if (!$user) {
                return [];
            }

            $skillNames = DB::table('user_skills')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->pluck('skill_name')
                ->all();

            $keywords = KeywordExtractor::extract(
                implode(' ', $skillNames) . ' ' . ($user->skills ?? '') . ' ' . $this->liveListingText($userId, $tenantId, null)
            );
            foreach (KeywordExtractor::extract((string) ($user->bio ?? '')) as $keyword) {
                if (KeywordExtractor::isConcept($keyword)) {
                    $keywords[] = $keyword;
                }
            }

            return array_values(array_unique($keywords));
        } catch (\Throwable $e) {
            Log::error('[CrossModuleMatching] member interests unavailable', [
                'user_id' => $userId,
                'exception' => $e::class,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Titles and descriptions of the member's live listings (approved, not
     * past their expiry date), optionally of one type.
     */
    private function liveListingText(int $userId, int $tenantId, ?string $type): string
    {
        $query = DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('moderation_status')->orWhere('moderation_status', 'approved');
            })
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            });
        if ($type !== null) {
            $query->where('type', $type);
        }

        $text = '';
        foreach ($query->orderByDesc('created_at')->limit(10)->get(['title', 'description']) as $row) {
            $text .= ' ' . ($row->title ?? '') . ' ' . ($row->description ?? '');
        }

        return $text;
    }

    /**
     * What two sets of keywords have in common: how many specific kinds of
     * help, and how many plain words. A kind that only says HOW or WHO FOR
     * ("teaching", "children") is not counted: on its own it is no reason to
     * suggest anything.
     *
     * @param string[] $a
     * @param string[] $b
     * @return array{0: int, 1: int} [kinds shared, words shared]
     */
    private static function overlap(array $a, array $b): array
    {
        $kinds = 0;
        $words = 0;
        foreach (array_intersect(array_unique($a), $b) as $keyword) {
            if (!is_string($keyword) || $keyword === '') {
                continue;
            }
            if (!KeywordExtractor::isConcept($keyword)) {
                $words++;
            } elseif (!MatchConcepts::isGeneric($keyword)) {
                $kinds++;
            }
        }

        return [$kinds, $words];
    }

    /**
     * Stemmed keywords for what the member says they can DO: the skills they
     * offer (user_skills), the free-text skills on their profile, and the
     * offers they have posted. Their bio is left out on purpose: it is prose
     * about the person, and matching its ordinary words against an
     * opportunity produced accidental "fits".
     *
     * @return string[]
     */
    private function getMemberOfferKeywords(int $userId, int $tenantId): array
    {
        $names = DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('is_offering', 1)
            ->pluck('skill_name')
            ->all();

        $profileSkills = (string) (DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('skills') ?? '');

        return KeywordExtractor::extract(
            implode(' ', $names) . ' ' . $profileSkills . ' ' . $this->liveListingText($userId, $tenantId, 'offer')
        );
    }

    /**
     * `vol_opportunities.skills_needed` holds either a JSON array or a
     * comma-separated list.
     *
     * @return string[]
     */
    public static function skillNames(string $raw): array
    {
        $raw = trim($raw);
        if ($raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return array_values(array_filter(array_map(
                static fn ($skill) => is_scalar($skill) ? trim((string) $skill) : '',
                $decoded
            )));
        }

        return array_values(array_filter(array_map('trim', explode(',', $raw))));
    }

    /**
     * Get category IDs from the user's active listings.
     */
    private function getUserCategoryIds(int $userId, int $tenantId): array
    {
        try {
            return DB::table('listings')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNotNull('category_id')
                ->distinct()
                ->pluck('category_id')
                ->map(fn($id) => (int) $id)
                ->all();
        } catch (\Throwable $e) {
            Log::debug('[CrossModuleMatching] getUserCategoryIds failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Stored category name => the name to show, so a "Same category: X" reason
     * names the category in the reader's language. Display only (stored
     * translations, no provider call); the match's own category_name is left
     * as stored, because clients compare and group by it.
     *
     * @param array<string, mixed> $match
     * @return array<string, string>
     */
    private static function categoryNameMap(array $match): array
    {
        $stored = isset($match['category_name']) && is_string($match['category_name']) ? $match['category_name'] : '';
        if ($stored === '' || empty($match['category_id'])) {
            return [];
        }
        try {
            $shown = TaxonomyNameLocalizer::nameFor('categories', $match['category_id'], $stored);
        } catch (\Throwable $e) {
            Log::warning('[CrossModuleMatching] category name for match reason unavailable', ['error' => $e->getMessage()]);
            return [];
        }

        return is_string($shown) && $shown !== '' ? [$stored => $shown] : [];
    }
}
