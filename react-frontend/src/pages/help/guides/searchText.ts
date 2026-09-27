// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Help Centre's word matching, shared by the guide search and the search
 * over the community's own questions, so both behave the same way: accents and
 * case are ignored, every word typed must be found, and a word must start a
 * word in the text ("pot" finds "pots" but not "spot").
 */

/** Lower-case and strip accents so "pagamento" matches "Pagamento" and "é" matches "e". */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** Scripts written without spaces between words, where any substring can be a word. */
export const NO_WORD_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Whether `word` starts a word somewhere in `text` (both already folded).
 * Japanese has no spaces, so any match counts there.
 */
export function hasWord(text: string, word: string): boolean {
  if (NO_WORD_SPACES.test(word)) return text.includes(word);
  let from = text.indexOf(word);
  while (from !== -1) {
    if (from === 0 || !LETTER_OR_DIGIT.test(text.charAt(from - 1))) return true;
    from = text.indexOf(word, from + 1);
  }
  return false;
}

/** The folded words of a search, ignoring punctuation and one-letter words. */
export function queryWords(query: string): string[] {
  return foldText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 || NO_WORD_SPACES.test(word));
}

/** Whether every word of the search is in `foldedText`. No words means no match. */
export function matchesEveryWord(foldedText: string, words: string[]): boolean {
  return words.length > 0 && words.every((word) => hasWord(foldedText, word));
}
