// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The reader's everyday vocabulary for isClearlyWrittenIn() (textLanguage.ts,
 * a copy of the website's detector). Metro needs a literal require per file;
 * each list is read once, on first use. A list that cannot be read answers
 * null, and the Translate button stays — the safe default.
 */

import { isClearlyWrittenIn, vocabularyCode, vocabularySet } from './textLanguage';

type VocabularyFile = { words: string };

const FILES: Readonly<Record<string, () => VocabularyFile>> = {
  ara: () => require('./vocabulary/ara.json') as VocabularyFile,
  deu: () => require('./vocabulary/deu.json') as VocabularyFile,
  eng: () => require('./vocabulary/eng.json') as VocabularyFile,
  fra: () => require('./vocabulary/fra.json') as VocabularyFile,
  gle: () => require('./vocabulary/gle.json') as VocabularyFile,
  ita: () => require('./vocabulary/ita.json') as VocabularyFile,
  nld: () => require('./vocabulary/nld.json') as VocabularyFile,
  pol: () => require('./vocabulary/pol.json') as VocabularyFile,
  por: () => require('./vocabulary/por.json') as VocabularyFile,
  spa: () => require('./vocabulary/spa.json') as VocabularyFile,
};

const loaded = new Map<string, ReadonlySet<string> | null>();

export function readerVocabulary(locale: string | null | undefined): ReadonlySet<string> | null {
  const code = vocabularyCode(locale);
  if (!code) return null;
  if (!loaded.has(code)) {
    let set: ReadonlySet<string> | null = null;
    try {
      const file = FILES[code];
      set = file ? vocabularySet(file()) : null;
    } catch {
      set = null;
    }
    loaded.set(code, set);
  }
  return loaded.get(code) ?? null;
}

/** Everything shown is, beyond doubt, already in the reader's language. */
export function alreadyInReaderLanguage(parts: readonly (string | null | undefined)[], locale: string | null | undefined): boolean {
  return isClearlyWrittenIn(parts, locale, readerVocabulary(locale));
}
