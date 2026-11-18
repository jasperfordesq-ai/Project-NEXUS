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

        // Sort by score descending
        usort($allMatches, fn($a, $b) => ($b['match_score'] ?? 0) <=> ($a['match_score'] ?? 0));

        // Apply final limit
        $allMatches = array_values(array_slice($allMatches, 0, $limit));

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
            ],
        ];
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

            $opportunities = $query->orderByDesc('opp.id')->limit(200)->get();

            $matches = [];
            foreach ($opportunities as $opp) {
                $needed = KeywordExtractor::extract(implode(' ', self::skillNames((string) ($opp->skills_needed ?? ''))));
                $skillShare = $needed !== []
                    ? count(array_intersect($needed, $memberKeywords)) / count($needed)
                    : 0.0;
                $wording = KeywordExtractor::extract(($opp->title ?? '') . ' ' . ($opp->description ?? ''));
                $wordingOverlap = count(array_intersect($wording, $memberKeywords));

                if ($skillShare <= 0.0 && $wordingOverlap === 0) {
                    continue;
                }

                $score = $skillShare > 0.0
                    ? 55.0 + 40.0 * $skillShare
                    : min(60.0, 40.0 + 5.0 * $wordingOverlap);
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
     * that share a category with their listings or wording with their skills.
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

            $userCategoryIds = $this->getUserCategoryIds($userId, $tenantId);
            $userSkills = $this->getUserSkillKeywords($userId, $tenantId);

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
                $textScore = $this->scoreTextRelevance(
                    $userSkills,
                    ($event['title'] ?? '') . ' ' . ($event['description'] ?? '')
                );

                // A match needs a reason. Every upcoming event used to get a
                // base score and the words "matches your interests".
                if (!$categoryHit && $textScore <= 0) {
                    continue;
                }

                $score = ($categoryHit ? 60.0 : 40.0) + $textScore * 0.3;

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
     * Get the user's skill keywords extracted from their profile.
     */
    private function getUserSkillKeywords(int $userId, int $tenantId): array
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

            return $this->smartMatchingEngine->extractKeywords(
                ($user->skills ?? '') . ' ' . ($user->bio ?? '')
            );
        } catch (\Throwable $e) {
            Log::debug('[CrossModuleMatching] getUserSkillKeywords failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Stemmed keywords for what the member says they can DO: the skills they
     * offer (user_skills) plus the free-text skills on their profile. Their
     * bio is left out on purpose: it is prose about the person, and matching
     * its ordinary words against an opportunity produced accidental "fits".
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

        return KeywordExtractor::extract(implode(' ', $names) . ' ' . $profileSkills);
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
     * Score text relevance by keyword overlap between user skills and target text.
     *
     * @return float Score 0-100
     */
    private function scoreTextRelevance(array $userKeywords, string $targetText): float
    {
        if (empty($userKeywords) || empty(trim($targetText))) {
            return 0;
        }

        $targetKeywords = $this->smartMatchingEngine->extractKeywords($targetText);

        if (empty($targetKeywords)) {
            return 0;
        }

        $overlap = count(array_intersect($userKeywords, $targetKeywords));
        $union = count(array_unique(array_merge($userKeywords, $targetKeywords)));

        if ($union === 0) {
            return 0;
        }

        $jaccard = $overlap / $union;

        // Scale: 0.0 → 0, 0.1 → 40, 0.2 → 60, 0.4+ → 80+
        return min(100, round($jaccard * 400, 1));
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
