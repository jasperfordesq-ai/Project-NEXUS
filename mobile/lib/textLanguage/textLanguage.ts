// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
// GENERATED from react-frontend/src/lib/textLanguage by scripts/sync-text-language.mjs — edit the source there, then run that script.

/**
 * Is this text, beyond reasonable doubt, already in the reader's language?
 *
 * Used to leave out the Translate button where it would do nothing. Hiding it
 * by mistake is the only failure that matters (a reader who cannot read the
 * text would have no way to translate it), so every uncertain case answers
 * false and the button stays: short texts, mixed languages, close neighbours.
 *
 * The rule, measured on 40 languages with zero wrong answers (see
 * scripts/build-text-language-markers.mjs and the private plan,
 * .local-docs-archive/awid-feedback/TRANSLATE-BUTTON-HIDING-PLAN.md):
 *  - Every part shown (title, body…) is at least 70% everyday words of the
 *    reader's language.
 *  - Latin-script languages: at least 15 letters, 95% Latin; at least 2
 *    different "distinctive everyday words" of the reader's language (3 under
 *    12 words), and none at all of any other language.
 *  - Japanese: kana present, kana/kanji only.
 *  - Arabic: no letter of Persian, Urdu, Pashto, Kurdish, Uyghur or Sindhi; a
 *    sign of Arabic (ة or a word starting ال); then the same word rule.
 *
 * 🔴 This file is the source. scripts/sync-text-language.mjs copies it to the
 * phone app and the accessible site; edit it here and run that script.
 */

import markers from './markers.json';

const WORDS: Readonly<Record<string, string>> = (markers as { words: Record<string, string> }).words;

/** Reader language → the word-list code it is judged against. */
const LIST_CODE: Readonly<Record<string, string>> = {
  en: 'eng', ga: 'gle', de: 'deu', fr: 'fra', it: 'ita', pt: 'por', es: 'spa', nl: 'nld', pl: 'pol', ar: 'ara',
};

/**
 * At least one distinctive word of the reader's language per this many words.
 * A backstop for a few of the reader's words inside a long foreign text; 15
 * cost almost nothing on the held-out data (8 halved the Spanish hide rate).
 */
const WORDS_PER_DISTINCTIVE = 15;

/**
 * Share of each part's words that must be everyday words of the reader's
 * language (the 5,000 most common). Catches a foreign title on an English body
 * ("Ayuda con jardinería en mi huerto": its words are shared by Spanish,
 * Galician and Catalan, so none is distinctive, yet none is English).
 */
const OWN_WORD_SHARE = 0.7;

/** Longer texts are not judged at all: the button stays. */
const MAX_LENGTH = 50000;

const ARABIC_EXCLUDED_LETTERS = /[پچژگیکٹڈڑںےہھټډړږښګڼۍېڕڵۆێەڤۇۈۋٺٻڀٿڦڄڃڇڊڌڍڏڙڳڱڻ]/u;
const ARABIC_SIGN = /ة|(?:^|\s)ال/u;

function readable(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    // Quoted words are often a title or name in another language ("I'm Still Here").
    .replace(/"[^"]*"|“[^”]*”|„[^“”]*[“”]|«[^»]*»|‘[^’]*’(?!\p{L})/gu, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_.-]+/gu, ' ')
    .replace(/[\p{N}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ScriptCounts { latin: number; kana: number; han: number; arabic: number; total: number }

function countScripts(text: string): ScriptCounts {
  const counts: ScriptCounts = { latin: 0, kana: 0, han: 0, arabic: 0, total: 0 };
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    counts.total++;
    if (/\p{Script=Latin}/u.test(ch)) counts.latin++;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) counts.kana++;
    else if (/\p{Script=Han}/u.test(ch)) counts.han++;
    else if (/\p{Script=Arabic}/u.test(ch)) counts.arabic++;
  }
  return counts;
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/[’‘`]/g, "'").match(/[\p{L}]+(?:'[\p{L}]+)*/gu) ?? [];
}

/** Only the reader's own distinctive words, enough of them, and no one else's. */
function wordsPoint(text: string, code: string): boolean {
  const all = words(text);
  const needed = all.length < 12 ? 3 : 2;
  let own = 0;
  for (const word of new Set(all)) {
    const language = WORDS[word];
    if (language === undefined) continue;
    if (language !== code) return false;
    own++;
  }
  // A few of the reader's words inside a longer text in another language must
  // not be enough: they must be a fair share of everything written.
  return own >= needed && own * WORDS_PER_DISTINCTIVE >= all.length;
}

/**
 * The word-list code whose everyday vocabulary a reader needs (pass it to the
 * client's loader); null when none is needed (Japanese) or the language is not
 * one the platform judges.
 */
export function vocabularyCode(locale: string | null | undefined): string | null {
  const reader = (locale ?? '').slice(0, 2).toLowerCase();
  return LIST_CODE[reader] ?? null;
}

/** Turn a loaded vocabulary file ({ words: "a b c" }) into a lookup set. */
export function vocabularySet(file: { words: string }): ReadonlySet<string> {
  return new Set(file.words.split(' '));
}

/** Each part (body, title…) must be mostly the reader's everyday words. */
function mostlyOwnWords(part: string, vocabulary: ReadonlySet<string>): boolean {
  const all = words(readable(part));
  if (all.length === 0) return true;
  let known = 0;
  for (const word of all) if (vocabulary.has(word)) known++;
  return known >= OWN_WORD_SHARE * all.length;
}

/**
 * @param parts      what the reader sees: one text, or several (title and body)
 * @param locale     the reader's language
 * @param vocabulary the reader's everyday vocabulary (vocabularyCode → the
 *                   client's loader); while it is missing the answer is false
 */
export function isClearlyWrittenIn(
  parts: string | readonly (string | null | undefined)[] | null | undefined,
  locale: string | null | undefined,
  vocabulary: ReadonlySet<string> | null | undefined,
): boolean {
  const list = (Array.isArray(parts) ? parts : [parts]).filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  const text = list.join('\n');
  if (list.length === 0 || text.length > MAX_LENGTH) return false;
  const reader = (locale ?? '').slice(0, 2).toLowerCase();
  const clean = readable(text);
  const scripts = countScripts(clean);
  if (scripts.total === 0) return false;

  if (reader === 'ja') {
    return scripts.kana >= 2 && scripts.total >= 4 && (scripts.kana + scripts.han) / scripts.total >= 0.95;
  }
  const code = LIST_CODE[reader];
  if (code === undefined || !vocabulary) return false;
  if (!list.every((part) => mostlyOwnWords(part, vocabulary))) return false;
  if (reader === 'ar') {
    if (ARABIC_EXCLUDED_LETTERS.test(clean) || !ARABIC_SIGN.test(clean)) return false;
    if (scripts.arabic < 8 || scripts.arabic / scripts.total < 0.95) return false;
    return wordsPoint(clean, code);
  }
  if (scripts.latin < 15 || scripts.latin / scripts.total < 0.95) return false;
  return wordsPoint(clean, code);
}
