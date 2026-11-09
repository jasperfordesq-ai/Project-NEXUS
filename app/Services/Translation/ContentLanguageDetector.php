<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Translation;

use App\Core\TenantContext;
use App\Services\TranslationConfigurationService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Which language a piece of member content is written in — so the Translate
 * button appears only when it differs from the reader's language.
 *
 * Owner, 9 Nov 2026: "if my language is set to English and the text is
 * English, there's no need for a translate button. If … text anywhere on the
 * site is in a different language, then there should be a translate button."
 * Nothing records the language a post, group or listing is written in, and the
 * words alone cannot tell for short texts ("Media Test Group"), so the
 * community's Google translation engine is asked.
 *
 * Kept small on purpose:
 *  - Google sees a short sample of each text (SAMPLE_LENGTH characters,
 *    without HTML, links or e-mail addresses), never the whole post.
 *  - Each sample is asked about once; the answer is remembered for CACHE_TTL.
 *    A failure is not remembered.
 *  - Only Google is asked. A community that translates with AI, has switched
 *    translation off, or has no engine gets "not known" for every text, and
 *    the websites fall back to reading the words themselves.
 *  - Each member has an hourly allowance of new characters, so the endpoint
 *    cannot be used to run up the community's Google bill.
 */
final class ContentLanguageDetector
{
    public const SAMPLE_LENGTH = 300;

    public const MAX_TEXTS = 50;

    /** New (not yet remembered) characters a member may have checked per hour. */
    public const HOURLY_CHARACTERS_PER_MEMBER = 60000;

    public const CACHE_PREFIX = 'ugc_lang:';

    public const CACHE_TTL = 60 * 60 * 24 * 90;

    private const ALLOWANCE_PREFIX = 'ugc_lang_allowance:';

    public function __construct(
        private readonly GoogleTranslateClient $google,
    ) {}

    /**
     * One answer per text, in order: the language and Google's confidence, or
     * null when it is not known (no letters, Google could not tell, not asked).
     *
     * @param array<int, mixed> $texts
     * @return list<array{language: string, confidence: float}|null>
     */
    public function detect(array $texts, int $userId): array
    {
        $texts = array_values($texts);
        $results = array_fill(0, count($texts), null);

        /** @var array<int, string> $samples index => sample */
        $samples = [];
        foreach ($texts as $index => $text) {
            $sample = is_string($text) ? self::sample($text) : '';
            if ($sample !== '') {
                $samples[$index] = $sample;
            }
        }
        if ($samples === [] || !TranslationConfigurationService::isEnabled()) {
            return $results;
        }

        $engine = TranslationEngine::resolve();
        if ($engine === null || $engine['engine'] !== TranslationEngine::ENGINE_GOOGLE) {
            return $results;
        }

        /** @var array<string, list<int>> $missing sample => indexes waiting for it */
        $missing = [];
        foreach ($samples as $index => $sample) {
            $remembered = Cache::get(self::cacheKey($sample));
            if (is_array($remembered)) {
                $results[$index] = self::answer($remembered);
                continue;
            }
            $missing['s' . $sample][] = $index;
        }
        if ($missing === []) {
            return $results;
        }

        $toAsk = array_map(static fn (string $key): string => substr($key, 1), array_keys($missing));
        $characters = array_sum(array_map('mb_strlen', $toAsk));
        $allowanceKey = self::ALLOWANCE_PREFIX . (int) TenantContext::getId() . ':' . $userId;
        if (RateLimiter::attempts($allowanceKey) + $characters > self::HOURLY_CHARACTERS_PER_MEMBER) {
            return $results;
        }
        RateLimiter::increment($allowanceKey, 3600, $characters);

        $answers = $this->google->detect($toAsk, $engine['key']);
        if ($answers === null) {
            return $results;
        }

        foreach ($toAsk as $position => $sample) {
            $answer = $answers[$position] ?? null;
            Cache::put(self::cacheKey($sample), $answer ?? ['language' => null], self::CACHE_TTL);
            foreach ($missing['s' . $sample] as $index) {
                $results[$index] = $answer;
            }
        }

        return $results;
    }

    /**
     * The part of a text Google is shown: the words only (no HTML, links or
     * e-mail addresses), at most SAMPLE_LENGTH characters. Empty when it has
     * fewer than three letters — there is nothing to tell a language by.
     */
    public static function sample(string $text): string
    {
        $plain = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $plain = preg_replace('~https?://\S+|www\.\S+~iu', ' ', $plain) ?? '';
        $plain = preg_replace('~\S+@\S+\.\S+~u', ' ', $plain) ?? '';
        $plain = trim(preg_replace('~\s+~u', ' ', $plain) ?? '');
        if (preg_match_all('~\p{L}~u', $plain) < 3) {
            return '';
        }

        return trim(mb_substr($plain, 0, self::SAMPLE_LENGTH));
    }

    public static function cacheKey(string $sample): string
    {
        return self::CACHE_PREFIX . hash('sha256', $sample);
    }

    /**
     * @param array<mixed> $remembered
     * @return array{language: string, confidence: float}|null
     */
    private static function answer(array $remembered): ?array
    {
        $language = $remembered['language'] ?? null;
        if (!is_string($language) || $language === '') {
            return null;
        }

        return ['language' => $language, 'confidence' => (float) ($remembered['confidence'] ?? 0)];
    }
}
