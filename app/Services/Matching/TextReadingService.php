<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use App\Core\TenantContext;
use App\Services\AI\AIServiceFactory;
use App\Services\CrossModuleMatchingService;
use App\Services\EventService;
use App\Services\SmartMatchingEngine;
use App\Services\VolunteerService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The AI reads short texts that are not listings, and says in plain English
 * what help each is about: a skill on a member's profile, the title of a
 * listing a member once helped with, a volunteering opportunity, an event.
 * ({@see ListingEnrichmentService} does the same for listings.)
 *
 * Without it these were matched on their own words only, so a skill written
 * "Heckenschnitt" never met a request for hedge trimming, and an opportunity
 * posted in German was never suggested to a member whose skills are in
 * English.
 *
 * A reading is keyed by a hash of the text, never by member: "Gardening" is
 * read once for the whole community, the provider is sent the skill name and
 * nothing else, and no row says whose skill it is.
 *
 * Resilience: matching never waits for it and never depends on it. Readings
 * are made in a queued job; a text never read is matched on its own words,
 * exactly as in a community without AI. Nothing is sent while the
 * community's AI switch is off, while matching is off, or when the community
 * turned this part off (smart_matching.ai.wider_reading).
 */
class TextReadingService
{
    public const SOURCES = ['skill', 'opportunity', 'event'];

    /** Which form of the question a stored reading answers ({@see ListingEnrichmentService}). */
    private const PROMPT_REVISION = 'r1:';

    /** Skill names and past-help titles looked at per catch-up run. */
    private const SKILL_NAMES_SCANNED = 3000;

    /**
     * The key a text is stored under: the same for "Gardening", " gardening "
     * and "GARDENING".
     */
    public static function key(string $text): string
    {
        $normalised = mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $text)));

        return self::PROMPT_REVISION . substr(hash('sha256', $normalised), 0, 64 - strlen(self::PROMPT_REVISION));
    }

    /** The text of a volunteering opportunity as it is read and looked up. */
    public static function opportunityText(?string $title, ?string $skillsNeeded, ?string $description): string
    {
        $skills = implode(', ', CrossModuleMatchingService::skillNames((string) $skillsNeeded));

        return trim(trim((string) $title) . "\n" . $skills . "\n" . trim(strip_tags((string) $description)));
    }

    /** The text of an event as it is read and looked up. */
    public static function eventText(?string $title, ?string $description): string
    {
        return trim(trim((string) $title) . "\n" . trim(strip_tags((string) $description)));
    }

    /**
     * Read one text, unless it has been read already.
     *
     * @return bool whether a new reading was stored
     */
    public function read(int $tenantId, string $text, string $source): bool
    {
        $text = trim($text);
        if ($text === '' || !in_array($source, self::SOURCES, true) || !$this->allowedFor($tenantId)) {
            return false;
        }

        $key = self::key($text);
        if (DB::table('match_text_readings')->where('tenant_id', $tenantId)->where('text_hash', $key)->exists()) {
            return false;
        }

        $reading = $this->ask($text, $source);
        if ($reading === null) {
            // The provider refused or failed: stop the catch-up run calling it for an hour.
            Cache::put(self::backoffKey($tenantId), 1, now()->addHour());
            return false;
        }

        // What comes back is never trusted as text: terms are reduced to
        // short runs of letters and kinds of help to the known ones.
        $cleaner = app(ListingEnrichmentService::class);

        // An empty answer is stored too, or the text would be sent again on every run.
        DB::table('match_text_readings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'text_hash' => $key],
            [
                'source' => $source,
                'terms' => json_encode($cleaner->cleanTerms($reading['terms'] ?? []), JSON_UNESCAPED_UNICODE),
                'concepts' => json_encode($cleaner->cleanConcepts($reading['concepts'] ?? [])),
                'provider' => $reading['provider'] ?? null,
                'model' => $reading['model'] ?? null,
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );

        return true;
    }

    /**
     * Extra matching tokens for these texts, in KeywordExtractor's token
     * space, keyed by the text exactly as it was passed in. A text never
     * read is left out. Empty on any failure.
     *
     * @param string[] $texts
     * @return array<string, string[]>
     */
    public function tokensFor(int $tenantId, array $texts): array
    {
        $byKey = [];
        foreach ($texts as $text) {
            if (is_string($text) && trim($text) !== '') {
                $byKey[self::key($text)][] = $text;
            }
        }
        if ($byKey === []) {
            return [];
        }

        try {
            $rows = DB::table('match_text_readings')
                ->where('tenant_id', $tenantId)
                ->whereIn('text_hash', array_keys($byKey))
                ->get(['text_hash', 'terms', 'concepts']);
        } catch (\Throwable $e) {
            Log::debug('[TextReadingService] readings unavailable: ' . $e->getMessage());
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $terms = array_filter((array) (json_decode((string) $row->terms, true) ?: []), 'is_string');
            $tokens = KeywordExtractor::extract(implode(' ', $terms));
            foreach ((array) (json_decode((string) $row->concepts, true) ?: []) as $concept) {
                if (is_string($concept) && isset(MatchConcepts::GROUPS[$concept])) {
                    $tokens[] = KeywordExtractor::CONCEPT_PREFIX . $concept;
                }
            }
            $tokens = array_values(array_unique($tokens));
            foreach ($byKey[(string) $row->text_hash] ?? [] as $text) {
                $out[$text] = $tokens;
            }
        }

        return $out;
    }

    /**
     * Texts in this community with no reading yet: open volunteering
     * opportunities, upcoming events anyone may see, then the skills on
     * active members' profiles and the titles of listings members helped
     * with. Used by the half-hourly matching run.
     *
     * @return array<int, array{text: string, source: string}>
     */
    public function textsNeedingReading(int $tenantId, int $limit): array
    {
        if (!$this->allowedFor($tenantId) || Cache::has(self::backoffKey($tenantId))) {
            return [];
        }

        $found = []; // key => [text, source]
        $add = function (string $text, string $source) use (&$found): void {
            $text = trim($text);
            if ($text !== '') {
                $found[self::key($text)] ??= ['text' => $text, 'source' => $source];
            }
        };

        try {
            foreach ($this->openOpportunities($tenantId) as $row) {
                $add(self::opportunityText($row->title, $row->skills_needed, $row->description), 'opportunity');
            }
            foreach ($this->publicUpcomingEvents($tenantId) as $event) {
                $add(self::eventText($event['title'] ?? '', $event['description'] ?? ''), 'event');
            }
            foreach ($this->skillTexts($tenantId) as $name) {
                $add($name, 'skill');
            }
        } catch (\Throwable $e) {
            Log::warning('[TextReadingService] could not list texts to read', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }
        if ($found === []) {
            return [];
        }

        $read = [];
        foreach (array_chunk(array_keys($found), 500) as $chunk) {
            foreach (DB::table('match_text_readings')->where('tenant_id', $tenantId)->whereIn('text_hash', $chunk)->pluck('text_hash') as $hash) {
                $read[(string) $hash] = true;
            }
        }

        return array_slice(array_values(array_diff_key($found, $read)), 0, max(1, $limit));
    }

    /** Whether this community lets these texts be read by its AI provider. */
    public function allowedFor(int $tenantId): bool
    {
        try {
            if (!AIServiceFactory::isEnabledForTenant($tenantId)) {
                return false;
            }
            $engine = app(SmartMatchingEngine::class);
            $engine->clearCache(); // the engine is a singleton; read THIS community's settings
            $config = $engine->getConfig();

            return (bool) ($config['enabled'] ?? true)
                && (bool) ($config['ai']['wider_reading'] ?? true);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * The provider request. Protected seam for tests.
     *
     * @return array{terms: string[], concepts: string[], provider: ?string, model: ?string}|null
     */
    protected function ask(string $text, string $source): ?array
    {
        return app(ListingEnrichmentService::class)->readText($text, $source);
    }

    private static function backoffKey(int $tenantId): string
    {
        return "match_text_reading_backoff:{$tenantId}";
    }

    /** Opportunities a member could be shown: the same rule the matcher uses. */
    private function openOpportunities(int $tenantId): iterable
    {
        $federated = VolunteerService::opportunitiesHaveFederatedColumn();

        return DB::table('vol_opportunities as opp')
            ->leftJoin('vol_organizations as org', function ($join) {
                $join->on('opp.organization_id', '=', 'org.id')->on('opp.tenant_id', '=', 'org.tenant_id');
            })
            ->where('opp.tenant_id', $tenantId)
            ->where('opp.is_active', 1)
            ->whereIn('opp.status', VolunteerService::PUBLIC_OPPORTUNITY_STATUSES)
            ->where(function ($outer) use ($federated) {
                $outer->whereIn('org.status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES);
                if ($federated) {
                    $outer->orWhere('opp.is_federated', 1);
                }
            })
            ->where(function ($open) {
                $open->whereNull('opp.end_date')->orWhere('opp.end_date', '>=', now()->toDateString());
            })
            ->orderByDesc('opp.id')
            ->limit(200)
            ->get(['opp.title', 'opp.description', 'opp.skills_needed']);
    }

    /**
     * Upcoming events as someone who is not signed in may see them, from the
     * one place that rule lives. A draft, private or members-only event is
     * therefore never sent to the provider.
     *
     * @return array<int, array<string, mixed>>
     */
    private function publicUpcomingEvents(int $tenantId): array
    {
        if ((int) TenantContext::getId() !== $tenantId) {
            return []; // EventService reads the current community
        }
        $listing = EventService::getAll(['when' => 'upcoming', 'limit' => 100]);

        return is_array($listing['items'] ?? null) ? $listing['items'] : [];
    }

    /** @return string[] skill names of active members, and titles of listings members helped with */
    private function skillTexts(int $tenantId): array
    {
        $names = DB::table('user_skills as us')
            ->join('users as u', function ($join) {
                $join->on('u.id', '=', 'us.user_id')->on('u.tenant_id', '=', 'us.tenant_id');
            })
            ->where('us.tenant_id', $tenantId)
            ->where('u.status', 'active')
            ->distinct()
            ->limit(self::SKILL_NAMES_SCANNED)
            ->pluck('us.skill_name')
            ->all();

        $helped = DB::table('exchange_requests as er')
            ->join('listings as l', function ($join) {
                $join->on('l.id', '=', 'er.listing_id')->on('l.tenant_id', '=', 'er.tenant_id');
            })
            ->where('er.tenant_id', $tenantId)
            ->where('er.status', 'completed')
            ->where('er.completed_at', '>=', now()->subMonths(24))
            ->distinct()
            ->limit(1000)
            ->pluck('l.title')
            ->all();

        return array_values(array_filter(array_map(fn ($name) => trim((string) $name), array_merge($names, $helped))));
    }
}
