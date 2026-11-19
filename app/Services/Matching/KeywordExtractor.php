<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

/**
 * KeywordExtractor — the words a piece of text is about, normalised so that
 * two members describing the same thing in different words still overlap.
 * Shared by the engine, the batch context loader and the pure scorer, so all
 * three normalise text identically (the engine's public extractKeywords()
 * delegates here).
 *
 * Steps, in order:
 *  1. Lower-case and fold accents ("Jardín" → "jardin", "Rasenmähen" →
 *     "rasenmahen"). The old a–z-only pattern cut every accented word in two
 *     ("jard" + nothing, "rasenm" + "hen"), so non-English listings barely
 *     matched at all.
 *  2. Split on anything that is not a letter, in any script.
 *  3. Drop filler words in the platform's European languages, and words
 *     shorter than three letters except a short list of real terms ("cv").
 *  4. Trim common word endings ("mowing"/"mower" → "mow", "shelves" →
 *     "shelf", "clases" → "clas"). Deliberately light: the same rules run on
 *     every language, so they only remove endings that are safe to remove.
 *  5. Add a concept token ("~gardening") for each word that belongs to a
 *     group in MatchConcepts. Concept tokens start with "~", which no word
 *     can contain, so they never collide with a real word.
 */
final class KeywordExtractor
{
    /** Prefix that marks a concept token rather than a word. */
    public const CONCEPT_PREFIX = '~';

    /** Filler words, as written; folded and stemmed once on first use. */
    private const STOP_WORDS = [
        // English
        'the', 'and', 'but', 'for', 'with', 'from', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
        'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'you', 'she',
        'they', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'help', 'helping',
        'looking', 'need', 'needed', 'want', 'wanted', 'offer', 'offering', 'request', 'someone', 'anyone',
        'somebody', 'anybody', 'please', 'thanks', 'thank', 'get', 'got', 'also', 'just', 'like', 'really',
        'very', 'much', 'many', 'some', 'any', 'all', 'more', 'most', 'other', 'others', 'after', 'under', 'over',
        'about', 'into', 'out', 'then', 'than', 'there', 'here', 'when', 'where', 'what', 'which', 'who', 'how',
        'why', 'not', 'yes', 'him', 'them', 'one', 'two', 'available', 'happy', 'willing', 'able', 'time',
        'hour', 'hours', 'credit', 'credits', 'bit', 'little', 'few', 'every', 'week', 'weeks', 'day', 'days',
        // Spanish
        'los', 'las', 'una', 'unos', 'unas', 'del', 'con', 'por', 'para', 'que', 'mis', 'tus', 'sus', 'son',
        'muy', 'más', 'pero', 'como', 'ayuda', 'ayudar', 'necesito', 'necesita', 'busco', 'buscando', 'ofrezco',
        'ofrece', 'doy', 'puedo', 'quiero', 'alguien', 'hola', 'gracias', 'sobre', 'este', 'esta', 'esto',
        // French
        'les', 'une', 'des', 'avec', 'pour', 'par', 'qui', 'mon', 'mes', 'ton', 'tes', 'ses', 'est', 'sont',
        'aux', 'cette', 'nous', 'vous', 'ils', 'elle', 'très', 'plus', 'mais', 'comme', 'aide', 'aider',
        'cherche', 'besoin', 'propose', 'peux', 'peut', 'veux', 'bonjour', 'merci', 'sur', 'dans', 'votre',
        'vos', 'notre',
        // German
        'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'mit',
        'für', 'von', 'zum', 'zur', 'ist', 'sind', 'bei', 'beim', 'auf', 'aus', 'ich', 'wir', 'ihr', 'mein',
        'meine', 'sehr', 'mehr', 'aber', 'wie', 'hilfe', 'helfen', 'suche', 'gesucht', 'biete', 'brauche', 'kann',
        'möchte', 'jemand', 'hallo', 'danke', 'über', 'nicht', 'auch',
        // Italian
        'gli', 'uno', 'del', 'della', 'per', 'che', 'mio', 'mia', 'miei', 'sono', 'alla', 'molto', 'più', 'come',
        'aiuto', 'aiutare', 'cerco', 'offro', 'posso', 'voglio', 'qualcuno', 'ciao', 'grazie', 'nel', 'nella',
        // Portuguese
        'uma', 'dos', 'das', 'com', 'meu', 'minha', 'são', 'muito', 'mais', 'mas', 'ajuda', 'ajudar', 'preciso',
        'procuro', 'ofereço', 'quero', 'alguém', 'olá', 'obrigado',
        // Dutch
        'het', 'een', 'met', 'voor', 'van', 'aan', 'bij', 'zijn', 'jij', 'hij', 'zij', 'wij', 'mijn', 'zeer',
        'heel', 'meer', 'maar', 'als', 'hulp', 'helpen', 'zoek', 'zoekt', 'bied', 'wil', 'iemand', 'bedankt',
        'niet', 'ook', 'nodig',
        // Polish
        'ale', 'jak', 'jest', 'się', 'mnie', 'mój', 'moja', 'bardzo', 'więcej', 'pomoc', 'pomocy', 'szukam',
        'oferuję', 'mogę', 'chcę', 'ktoś', 'dla', 'przy', 'przez', 'nie', 'tak',
        // Irish
        'agus', 'leis', 'tá', 'cabhair', 'cuidiú', 'lorg', 'teastaíonn', 'tairgim', 'féidir', 'liom', 'dom',
    ];

    /** Words shorter than three letters that still carry meaning. */
    private const SHORT_TERMS = [
        // "us" and "go" are not here: as ordinary English words ("join us",
        // "we go walking") they gave unrelated texts two words in common.
        'ai', 'ml', 'ux', 'ui', 'vr', 'ar', 'hr', 'pr', 'qa', 'db', 'uk', 'eu', 'r',
        'cv', 'pc', 'tv', 'dj', 'gp',
    ];

    /**
     * Words whose trimmed form is a different word, with the form to use
     * instead. Trimmed by the general rules, "tape" became "tap" (plumbing),
     * "care" became "car", "site" became "sit" (pet sitting), "lifting"
     * became "lift" (a lift in a car) and "note" became the filler "not".
     */
    private const FIXED_STEMS = [
        'tape' => 'tape', 'tapes' => 'tape',
        'care' => 'care', 'cares' => 'care', 'caring' => 'care', 'carer' => 'care', 'carers' => 'care',
        'site' => 'site', 'sites' => 'site',
        'note' => 'note', 'notes' => 'note',
        'lifting' => 'lifting',
    ];

    /** @var array<string, true>|null folded + stemmed stop words */
    private static ?array $stopSet = null;

    /** @var array<string, string[]>|null stem => concept names */
    private static ?array $conceptIndex = null;

    /** @return string[] unique stemmed keywords, followed by concept tokens */
    public static function extract(string $text): array
    {
        $tokens = self::tokens($text);
        if ($tokens === []) {
            return [];
        }

        $stops = self::stopSet();
        $keywords = [];
        $stems = [];
        foreach ($tokens as $token) {
            $length = mb_strlen($token, 'UTF-8');
            if ($length < 3 && !in_array($token, self::SHORT_TERMS, true)) {
                $stems[] = null;
                continue;
            }
            if (isset($stops[$token])) {
                $stems[] = null;
                continue;
            }
            $stem = self::stem($token);
            if (isset($stops[$stem])) {
                $stems[] = null;
                continue;
            }
            $keywords[$stem] = true;
            $stems[] = $stem;
        }

        // Concepts: each kept word, plus each pair of neighbouring words
        // joined ("flat pack" → "flatpack", "baby sitting" → "babysit").
        $index = self::conceptIndex();
        $concepts = [];
        foreach ($stems as $i => $stem) {
            if ($stem !== null) {
                foreach ($index[$stem] ?? [] as $concept) {
                    $concepts[$concept] = true;
                }
            }
            if (isset($tokens[$i + 1])) {
                $joined = self::stem($tokens[$i] . $tokens[$i + 1]);
                foreach ($index[$joined] ?? [] as $concept) {
                    $concepts[$concept] = true;
                }
            }
        }

        $out = array_keys($keywords);
        foreach (array_keys($concepts) as $concept) {
            $out[] = self::CONCEPT_PREFIX . $concept;
        }

        return array_values(array_unique(array_map('strval', $out)));
    }

    /** Whether a keyword is a concept token rather than a word. */
    public static function isConcept(string $keyword): bool
    {
        return str_starts_with($keyword, self::CONCEPT_PREFIX);
    }

    /**
     * Trim common endings. The same rules run on every language, so they are
     * limited to endings that are safe everywhere; consistency matters more
     * than linguistic accuracy, because both sides of a match pass through
     * the same function.
     */
    public static function stem(string $word): string
    {
        if (isset(self::FIXED_STEMS[$word])) {
            return self::FIXED_STEMS[$word];
        }

        $len = mb_strlen($word, 'UTF-8');
        if ($len <= 3) {
            return $word;
        }

        // Plurals.
        if (self::endsWith($word, 'sses')) {
            $word = self::cut($word, 2);
        } elseif ($len > 4 && self::endsWith($word, 'ies')) {
            $word = self::cut($word, 3) . 'y';
        } elseif ($len > 5 && self::endsWith($word, 'lves')) {
            $word = self::cut($word, 3) . 'f';
        } elseif ($len > 4 && preg_match('/(x|z|ch|sh)es$/u', $word) === 1) {
            $word = self::cut($word, 2);
        } elseif (self::endsWith($word, 's') && preg_match('/(ss|us|is)$/u', $word) !== 1) {
            $word = self::cut($word, 1);
        }

        // One verb / noun ending.
        $len = mb_strlen($word, 'UTF-8');
        if ($len >= 6 && self::endsWith($word, 'ing') && self::hasVowel(self::cut($word, 3))) {
            $word = self::undouble(self::cut($word, 3));
        } elseif ($len >= 5 && self::endsWith($word, 'ed') && self::usableBase(self::cut($word, 2))) {
            $word = self::undouble(self::cut($word, 2));
        } elseif ($len >= 5 && self::endsWith($word, 'er') && self::usableBase(self::cut($word, 2))) {
            $word = self::undouble(self::cut($word, 2));
        } elseif ($len >= 7 && self::endsWith($word, 'ly')) {
            $word = self::cut($word, 2);
        }

        // A final silent "e" ("drive"/"driving", "service"/"services").
        $len = mb_strlen($word, 'UTF-8');
        if ($len >= 4 && self::endsWith($word, 'e') && !self::endsWith($word, 'ee')) {
            $word = self::cut($word, 1);
        }

        return $word;
    }

    /** @return string[] folded word tokens in their original order */
    private static function tokens(string $text): array
    {
        $text = self::fold($text);
        if (preg_match_all('/\p{L}+/u', $text, $matches) === false) {
            return [];
        }

        return $matches[0];
    }

    /** Lower-case and strip accents from Latin letters; other scripts keep their marks. */
    private static function fold(string $text): string
    {
        $text = mb_strtolower($text, 'UTF-8');
        $text = strtr($text, ['ß' => 'ss', 'æ' => 'ae', 'œ' => 'oe', 'ø' => 'o', 'ł' => 'l', 'đ' => 'd', 'ð' => 'd', 'þ' => 'th']);

        if (class_exists(\Normalizer::class)) {
            $decomposed = \Normalizer::normalize($text, \Normalizer::FORM_D);
            if (is_string($decomposed)) {
                $stripped = preg_replace('/(?<=\p{Latin})\p{Mn}+/u', '', $decomposed);
                $recomposed = is_string($stripped) ? \Normalizer::normalize($stripped, \Normalizer::FORM_C) : false;
                if (is_string($recomposed)) {
                    $text = $recomposed;
                }
            }
        }

        return $text;
    }

    /** @return array<string, true> */
    private static function stopSet(): array
    {
        if (self::$stopSet === null) {
            $set = [];
            foreach (self::STOP_WORDS as $word) {
                foreach (self::tokens($word) as $token) {
                    $set[$token] = true;
                    $set[self::stem($token)] = true;
                }
            }
            self::$stopSet = $set;
        }

        return self::$stopSet;
    }

    /** @return array<string, string[]> */
    private static function conceptIndex(): array
    {
        if (self::$conceptIndex === null) {
            $index = [];
            foreach (MatchConcepts::GROUPS as $concept => $words) {
                foreach ($words as $word) {
                    $stem = self::stem(implode('', self::tokens($word)));
                    if ($stem === '') {
                        continue;
                    }
                    $index[$stem] ??= [];
                    if (!in_array($concept, $index[$stem], true)) {
                        $index[$stem][] = $concept;
                    }
                }
            }
            self::$conceptIndex = $index;
        }

        return self::$conceptIndex;
    }

    private static function endsWith(string $word, string $suffix): bool
    {
        return str_ends_with($word, $suffix);
    }

    private static function cut(string $word, int $chars): string
    {
        return mb_substr($word, 0, mb_strlen($word, 'UTF-8') - $chars, 'UTF-8');
    }

    private static function hasVowel(string $word): bool
    {
        return preg_match('/[aeiouy]/u', $word) === 1;
    }

    /** A base worth keeping: three letters or more, a vowel, not ending in "e" ("speed" stays whole). */
    private static function usableBase(string $base): bool
    {
        return mb_strlen($base, 'UTF-8') >= 3 && self::hasVowel($base) && !self::endsWith($base, 'e');
    }

    /** "putt" → "put", "trimm" → "trim"; double l, s and z stay. */
    private static function undouble(string $word): string
    {
        if (preg_match('/([b-df-hj-km-np-rtv-x])\1$/u', $word) === 1) {
            return self::cut($word, 1);
        }

        return $word;
    }
}
