<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * Suggests potential KISS-style "Tandem" pairings (supporter <-> recipient).
 *
 * Scores every viable pair across the tenant on five signals — distance,
 * shared language, complementary skills, availability overlap, and shared
 * interests — and returns the highest-scoring suggestions for a coordinator
 * to review.  Pairs that have already been actioned (relationship created
 * or explicitly dismissed) are suppressed for 90 days via the
 * caring_tandem_suggestion_log table.
 */
class CaringTandemMatchingService
{
    private const MIN_SCORE = 0.4;
    private const MAX_PER_USER = 3;
    private const SUPPRESSION_DAYS = 90;

    private const WEIGHT_DISTANCE = 0.30;
    private const WEIGHT_LANGUAGE = 0.25;
    private const WEIGHT_SKILL = 0.20;
    private const WEIGHT_AVAILABILITY = 0.15;
    private const WEIGHT_INTEREST = 0.10;

    /**
     * Additive boost for intergenerational pairs (age difference >= 25 years).
     * Applied AFTER the weighted base score, capped at 1.0.  KISS's hallmark
     * is connecting old and young — surfacing this in the score makes
     * intergenerational suggestions rise naturally without skewing the base
     * weight balance.
     */
    public const INTERGENERATIONAL_BOOST = 0.10;
    public const INTERGENERATIONAL_MIN_AGE_DIFF = 25;

    /**
     * @return list<array<string,mixed>>
     */
    public function suggestTandems(int $tenantId, ?int $limit = 20): array
    {
        if (!Schema::hasTable('users')) {
            return [];
        }

        $hasLat = Schema::hasColumn('users', 'latitude');
        $hasLng = Schema::hasColumn('users', 'longitude');
        $hasSkills = Schema::hasColumn('users', 'skills');
        $hasInterests = Schema::hasColumn('users', 'interests');
        $hasAvailability = Schema::hasColumn('users', 'availability');
        $hasLanguage = Schema::hasColumn('users', 'preferred_language');
        $hasDob = Schema::hasColumn('users', 'date_of_birth');

        $candidates = $this->loadCandidates($tenantId, $hasLat, $hasLng, $hasSkills, $hasInterests, $hasAvailability, $hasLanguage, $hasDob);
        if (count($candidates) < 2) {
            return [];
        }

        $busyUserIds = $this->loadBusyUserIds($tenantId);
        $suppressedPairs = $this->loadSuppressedPairs($tenantId);

        $available = array_values(array_filter(
            $candidates,
            static fn (array $u): bool => !isset($busyUserIds[(int) $u['id']]),
        ));
        if (count($available) < 2) {
            return [];
        }

        $scored = [];
        $count = count($available);
        for ($i = 0; $i < $count; $i++) {
            for ($j = $i + 1; $j < $count; $j++) {
                $a = $available[$i];
                $b = $available[$j];
                $pairKey = $this->pairKey((int) $a['id'], (int) $b['id']);
                if (isset($suppressedPairs[$pairKey])) {
                    continue;
                }

                [$signals, $score] = $this->scorePair($a, $b);
                if ($score < self::MIN_SCORE) {
                    continue;
                }

                $scored[] = [
                    'supporter' => $this->presentUser($a),
                    'recipient' => $this->presentUser($b),
                    'score' => round($score, 3),
                    'signals' => $signals,
                    'reasons' => $this->buildReasons($signals),
                ];
            }
        }

        usort($scored, static fn (array $x, array $y): int => $y['score'] <=> $x['score']);

        $perUserCount = [];
        $output = [];
        $cap = max(1, min(100, $limit ?? 20));
        foreach ($scored as $pair) {
            $supporterId = (int) $pair['supporter']['id'];
            $recipientId = (int) $pair['recipient']['id'];
            $supporterUsage = $perUserCount[$supporterId] ?? 0;
            $recipientUsage = $perUserCount[$recipientId] ?? 0;
            if ($supporterUsage >= self::MAX_PER_USER || $recipientUsage >= self::MAX_PER_USER) {
                continue;
            }
            $output[] = $pair;
            $perUserCount[$supporterId] = $supporterUsage + 1;
            $perUserCount[$recipientId] = $recipientUsage + 1;
            if (count($output) >= $cap) {
                break;
            }
        }

        return $output;
    }

    public function markSuggestionAsConsidered(
        int $tenantId,
        int $supporterId,
        int $recipientId,
        string $action,
        ?int $createdById = null,
    ): void {
        if (!Schema::hasTable('caring_tandem_suggestion_log')) {
            return;
        }
        if ($supporterId <= 0 || $recipientId <= 0 || $supporterId === $recipientId) {
            return;
        }
        if (!in_array($action, ['created_relationship', 'dismissed'], true)) {
            return;
        }

        // Normalise pair so (a,b) and (b,a) collapse to the same key.
        $low = min($supporterId, $recipientId);
        $high = max($supporterId, $recipientId);

        DB::table('caring_tandem_suggestion_log')->updateOrInsert(
            [
                'tenant_id' => $tenantId,
                'supporter_user_id' => $low,
                'recipient_user_id' => $high,
            ],
            [
                'action' => $action,
                'created_by_user_id' => $createdById,
                'created_at' => now(),
            ],
        );
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function loadCandidates(
        int $tenantId,
        bool $hasLat,
        bool $hasLng,
        bool $hasSkills,
        bool $hasInterests,
        bool $hasAvailability,
        bool $hasLanguage,
        bool $hasDob = false,
    ): array {
        $columns = ['id', 'first_name', 'last_name', 'name', 'avatar_url'];
        if ($hasLat) $columns[] = 'latitude';
        if ($hasLng) $columns[] = 'longitude';
        if ($hasSkills) $columns[] = 'skills';
        if ($hasInterests) $columns[] = 'interests';
        if ($hasAvailability) $columns[] = 'availability';
        if ($hasLanguage) $columns[] = 'preferred_language';
        if ($hasDob) $columns[] = 'date_of_birth';

        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at');

        if (Schema::hasColumn('users', 'is_approved')) {
            $query->where('is_approved', 1);
        }
        if (Schema::hasColumn('users', 'status')) {
            $query->whereIn('status', ['active', 'approved']);
        }

        $rows = $query->select($columns)->limit(2000)->get();

        $out = [];
        foreach ($rows as $row) {
            $name = UserDisplayName::resolve($row);
            if ($name === '') {
                $name = (string) ($row->name ?? '');
            }
            if ($name === '') {
                continue;
            }
            $out[] = [
                'id' => (int) $row->id,
                'name' => $name,
                'avatar_url' => (string) ($row->avatar_url ?? ''),
                'lat' => isset($row->latitude) && $row->latitude !== null ? (float) $row->latitude : null,
                'lng' => isset($row->longitude) && $row->longitude !== null ? (float) $row->longitude : null,
                'skills' => $this->splitTokens((string) ($row->skills ?? '')),
                'interests' => $this->splitTokens((string) ($row->interests ?? '')),
                'availability' => trim(strtolower((string) ($row->availability ?? ''))),
                'languages' => $this->normaliseLanguageList($row->preferred_language ?? null),
                'dob' => isset($row->date_of_birth) && $row->date_of_birth !== null && $row->date_of_birth !== '' ? (string) $row->date_of_birth : null,
            ];
        }

        return $out;
    }

    /**
     * @return array<int,bool>
     */
    private function loadBusyUserIds(int $tenantId): array
    {
        if (!Schema::hasTable('caring_support_relationships')) {
            return [];
        }

        $rows = DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->get(['supporter_id', 'recipient_id']);

        $busy = [];
        foreach ($rows as $row) {
            $busy[(int) $row->supporter_id] = true;
            $busy[(int) $row->recipient_id] = true;
        }
        return $busy;
    }

    /**
     * @return array<string,bool>
     */
    private function loadSuppressedPairs(int $tenantId): array
    {
        if (!Schema::hasTable('caring_tandem_suggestion_log')) {
            return [];
        }

        $cutoff = date('Y-m-d H:i:s', strtotime('-' . self::SUPPRESSION_DAYS . ' days'));
        $rows = DB::table('caring_tandem_suggestion_log')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $cutoff)
            ->get(['supporter_user_id', 'recipient_user_id']);

        $map = [];
        foreach ($rows as $row) {
            $map[$this->pairKey((int) $row->supporter_user_id, (int) $row->recipient_user_id)] = true;
        }
        return $map;
    }

    private function pairKey(int $a, int $b): string
    {
        $low = min($a, $b);
        $high = max($a, $b);
        return $low . ':' . $high;
    }

    /**
     * @param array<string,mixed> $a
     * @param array<string,mixed> $b
     * @return array{0: array<string,mixed>, 1: float}
     */
    private function scorePair(array $a, array $b): array
    {
        $signals = [];

        $distanceKm = null;
        if ($a['lat'] !== null && $a['lng'] !== null && $b['lat'] !== null && $b['lng'] !== null) {
            $distanceKm = $this->haversineKm((float) $a['lat'], (float) $a['lng'], (float) $b['lat'], (float) $b['lng']);
            $signals['distance_km'] = round($distanceKm, 2);
            $distanceScore = max(0.0, 1.0 - ($distanceKm / 10.0));
        } else {
            // Treat as neutral when one side has no coordinates — don't strongly penalise.
            $distanceScore = 0.5;
        }

        // Language overlap (Jaccard).
        $languageOverlap = $this->jaccard($a['languages'], $b['languages']);
        if ($languageOverlap === null) {
            $languageOverlap = 0.5;
        }
        $signals['language_overlap'] = round($languageOverlap, 3);

        // Skill complement: at least one supporter skill matches a recipient interest/skill.
        $skillComplement = $this->skillComplementScore($a['skills'], $b['skills'], $b['interests']);
        $signals['skill_complement'] = round($skillComplement, 3);

        // Availability overlap.
        $availabilityOverlap = $this->availabilityOverlapScore($a['availability'], $b['availability']);
        $signals['availability_overlap'] = round($availabilityOverlap, 3);

        // Interest overlap (Jaccard).
        $interestOverlap = $this->jaccard($a['interests'], $b['interests']);
        if ($interestOverlap === null) {
            $interestOverlap = 0.3;
        }
        $signals['interest_overlap'] = round($interestOverlap, 3);

        $score =
            (self::WEIGHT_DISTANCE * $distanceScore)
            + (self::WEIGHT_LANGUAGE * $languageOverlap)
            + (self::WEIGHT_SKILL * $skillComplement)
            + (self::WEIGHT_AVAILABILITY * $availabilityOverlap)
            + (self::WEIGHT_INTEREST * $interestOverlap);

        // Intergenerational boost — additive on top of weighted base, capped at 1.0.
        // KISS's hallmark is connecting old and young, so an explicit signal +
        // small boost surfaces these pairs without unbalancing the base weights.
        $intergenSignal = $this->computeIntergenerationalSignal($a, $b);
        $signals['intergenerational'] = $intergenSignal >= 1.0;
        $signals['intergenerational_signal'] = round($intergenSignal, 3);
        if ($intergenSignal >= 1.0) {
            $score += self::INTERGENERATIONAL_BOOST;
        }

        return [$signals, max(0.0, min(1.0, $score))];
    }

    /**
     * Returns 1.0 when both members have a DOB and are >= 25 years apart;
     * 0.0 when they share a generation; 0.5 when DOB is unknown for either side.
     *
     * @param array<string,mixed> $a
     * @param array<string,mixed> $b
     */
    public function computeIntergenerationalSignal(array $a, array $b): float
    {
        $dobA = $a['dob'] ?? null;
        $dobB = $b['dob'] ?? null;
        if (!is_string($dobA) || !is_string($dobB) || $dobA === '' || $dobB === '') {
            return 0.5;
        }

        try {
            $tA = (new \DateTimeImmutable($dobA))->getTimestamp();
            $tB = (new \DateTimeImmutable($dobB))->getTimestamp();
        } catch (\Throwable) {
            return 0.5;
        }

        // Convert second-difference to years (approximate, leap-year safe enough).
        $diffYears = abs($tA - $tB) / (365.25 * 24 * 3600);
        return $diffYears >= self::INTERGENERATIONAL_MIN_AGE_DIFF ? 1.0 : 0.0;
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earth = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * (sin($dLng / 2) ** 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earth * $c;
    }

    /**
     * @param list<string> $a
     * @param list<string> $b
     */
    private function jaccard(array $a, array $b): ?float
    {
        if ($a === [] && $b === []) {
            return null;
        }
        $setA = array_unique($a);
        $setB = array_unique($b);
        $intersection = array_intersect($setA, $setB);
        $union = array_unique(array_merge($setA, $setB));
        if (count($union) === 0) {
            return null;
        }
        return count($intersection) / count($union);
    }

    /**
     * @param list<string> $supporterSkills
     * @param list<string> $recipientSkills
     * @param list<string> $recipientInterests
     */
    private function skillComplementScore(array $supporterSkills, array $recipientSkills, array $recipientInterests): float
    {
        if ($supporterSkills === []) {
            return 0.5;
        }
        $needs = array_unique(array_merge($recipientSkills, $recipientInterests));
        if ($needs === []) {
            // Recipient told us nothing — assume neutral demand.
            return 0.5;
        }
        $matches = array_intersect($supporterSkills, $needs);
        if ($matches === []) {
            return 0.3;
        }
        // Encourage at least one direct match; cap at 1.
        return min(1.0, 0.5 + (count($matches) * 0.15));
    }

    private function availabilityOverlapScore(string $a, string $b): float
    {
        if ($a === '' || $b === '') {
            return 0.4;
        }
        if ($a === $b) {
            return 1.0;
        }
        // Tokenise on common separators and compute overlap.
        $tokensA = preg_split('/[\s,;\/]+/', $a) ?: [];
        $tokensB = preg_split('/[\s,;\/]+/', $b) ?: [];
        $setA = array_filter($tokensA, static fn (string $t): bool => $t !== '');
        $setB = array_filter($tokensB, static fn (string $t): bool => $t !== '');
        if ($setA === [] || $setB === []) {
            return 0.4;
        }
        $intersection = array_intersect($setA, $setB);
        if ($intersection === []) {
            // "flexible" should match anything.
            if (in_array('flexible', $setA, true) || in_array('flexible', $setB, true)) {
                return 0.6;
            }
            return 0.2;
        }
        $union = array_unique(array_merge($setA, $setB));
        return count($intersection) / max(1, count($union));
    }

    /**
     * @param array<string,mixed> $signals
     */
    private function buildReasons(array $signals): array
    {
        $parts = [];
        if (isset($signals['distance_km'])) {
            $parts[] = [
                'code' => 'distance',
                'params' => ['distance_km' => round((float) $signals['distance_km'], 1)],
            ];
        }
        if (isset($signals['language_overlap']) && (float) $signals['language_overlap'] >= 0.6) {
            $parts[] = ['code' => 'shared_language', 'params' => []];
        }
        if (isset($signals['skill_complement']) && (float) $signals['skill_complement'] >= 0.6) {
            $parts[] = ['code' => 'complementary_skills', 'params' => []];
        }
        if (isset($signals['availability_overlap']) && (float) $signals['availability_overlap'] >= 0.6) {
            $parts[] = ['code' => 'availability_overlap', 'params' => []];
        }
        if (isset($signals['interest_overlap']) && (float) $signals['interest_overlap'] >= 0.5) {
            $parts[] = ['code' => 'shared_interests', 'params' => []];
        }
        if (!empty($signals['intergenerational'])) {
            $parts[] = ['code' => 'intergenerational', 'params' => []];
        }

        return $parts === []
            ? [['code' => 'overall_fit', 'params' => []]]
            : $parts;
    }

    /**
     * @param array<string,mixed> $user
     * @return array<string,mixed>
     */
    private function presentUser(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'name' => (string) $user['name'],
            'avatar_url' => (string) ($user['avatar_url'] ?? ''),
            'languages' => $user['languages'],
            'skills' => $user['skills'],
        ];
    }

    /**
     * @return list<string>
     */
    private function splitTokens(string $raw): array
    {
        $raw = trim($raw);
        if ($raw === '') {
            return [];
        }
        if ($raw[0] === '[' || $raw[0] === '{') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $tokens = [];
                array_walk_recursive($decoded, static function ($v) use (&$tokens): void {
                    if (is_string($v) && $v !== '') {
                        $tokens[] = $v;
                    }
                });
                return $this->normaliseTokens($tokens);
            }
        }
        $parts = preg_split('/[,;\|]+/', $raw) ?: [];
        return $this->normaliseTokens($parts);
    }

    /**
     * @param array<int,string> $tokens
     * @return list<string>
     */
    private function normaliseTokens(array $tokens): array
    {
        $out = [];
        foreach ($tokens as $token) {
            $clean = strtolower(trim((string) $token));
            if ($clean === '') continue;
            $out[$clean] = true;
        }
        return array_keys($out);
    }

    /**
     * @return list<string>
     */
    private function normaliseLanguageList(mixed $raw): array
    {
        if ($raw === null) {
            return [];
        }
        if (is_string($raw)) {
            $clean = strtolower(trim($raw));
            return $clean === '' ? [] : [$clean];
        }
        if (is_array($raw)) {
            return $this->normaliseTokens($raw);
        }
        return [];
    }
}
