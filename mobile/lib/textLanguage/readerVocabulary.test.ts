// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: no Translate control where the text is already in the
 * reader's language. The app uses the website's own detector (a generated copy,
 * scripts/sync-text-language.mjs) and runs the same corpus, so the app and both
 * websites decide alike. Doubt keeps the control.
 */

import corpus from './__fixtures__/corpus.json';
import { alreadyInReaderLanguage, loadReaderVocabulary, readerVocabulary } from './readerVocabulary';

const READERS = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;
type Corpus = Record<(typeof READERS)[number], string[]> & { _other: Array<[string, string]> };
const samples = corpus as unknown as Corpus;
const ENGLISH = 'Please remember to log your hours after each exchange so the balance stays accurate.';
const SPANISH = 'Mi vecina mayor estaría encantada de recibir una llamada cada semana, ¿alguien tiene veinte minutos?';

describe('alreadyInReaderLanguage (app)', () => {
  // The lists are bundled files, read on first use (asynchronously).
  beforeAll(async () => {
    for (const reader of READERS) await loadReaderVocabulary(reader);
  });

  it('never hides the control wrongly on the shared corpus', () => {
    const wrong: string[] = [];
    for (const language of READERS) {
      for (const text of samples[language]) {
        for (const reader of READERS) if (reader !== language && alreadyInReaderLanguage([text], reader)) wrong.push(`${language}->${reader}: ${text}`);
      }
    }
    for (const [label, text] of samples._other) {
      for (const reader of READERS) if (alreadyInReaderLanguage([text], reader)) wrong.push(`${label}->${reader}: ${text}`);
    }
    expect(wrong).toEqual([]);
  });

  it('hides it for clear text in the reader\'s language and keeps it otherwise', () => {
    expect(alreadyInReaderLanguage([ENGLISH], 'en')).toBe(true);
    expect(alreadyInReaderLanguage([SPANISH], 'en')).toBe(false);
    expect(alreadyInReaderLanguage([SPANISH], 'es')).toBe(true);
    expect(alreadyInReaderLanguage([ENGLISH, 'Ayuda con jardinería en mi huerto'], 'en')).toBe(false);
    expect(alreadyInReaderLanguage(['Thanks so much!'], 'en')).toBe(false);
  });

  it('loads every reading language\'s word list', () => {
    for (const reader of ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ar']) {
      expect(readerVocabulary(reader)?.size ?? 0).toBeGreaterThan(1000);
    }
    expect(readerVocabulary('ja')).toBeNull();
    expect(readerVocabulary('sv')).toBeNull();
  });
});

describe('before the word lists are read', () => {
  it('keeps the control: no list, no decision', () => {
    jest.isolateModules(() => {
      // A fresh copy of the loader has read nothing yet.
      const fresh = require('./readerVocabulary') as typeof import('./readerVocabulary');
      expect(fresh.readerVocabulary('en')).toBeNull();
      expect(fresh.alreadyInReaderLanguage([ENGLISH], 'en')).toBe(false);
    });
  });
});
