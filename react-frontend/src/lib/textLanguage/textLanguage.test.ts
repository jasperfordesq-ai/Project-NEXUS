// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Translate button is left out only when the text is, beyond reasonable
 * doubt, in the reader's language. The failure that matters is hiding it
 * wrongly, so most of these tests are about NOT hiding. The same corpus runs in
 * the phone app and the accessible site (scripts/sync-text-language.mjs).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import corpus from './__fixtures__/corpus.json';
import { isClearlyWrittenIn as judge, vocabularySet } from './textLanguage';
import ara from './vocabulary/ara.json';
import deu from './vocabulary/deu.json';
import eng from './vocabulary/eng.json';
import fra from './vocabulary/fra.json';
import gle from './vocabulary/gle.json';
import ita from './vocabulary/ita.json';
import nld from './vocabulary/nld.json';
import pol from './vocabulary/pol.json';
import por from './vocabulary/por.json';
import spa from './vocabulary/spa.json';

const VOCABULARY: Record<string, ReadonlySet<string>> = {
  en: vocabularySet(eng), ga: vocabularySet(gle), de: vocabularySet(deu), fr: vocabularySet(fra), it: vocabularySet(ita),
  pt: vocabularySet(por), es: vocabularySet(spa), nl: vocabularySet(nld), pl: vocabularySet(pol), ar: vocabularySet(ara),
};
const isClearlyWrittenIn = (text: Parameters<typeof judge>[0], locale: string | null | undefined) =>
  judge(text, locale, VOCABULARY[(locale ?? '').slice(0, 2).toLowerCase()] ?? null);

const READERS = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;
type Corpus = Record<(typeof READERS)[number], string[]> & { _other: Array<[string, string]> };
const samples = corpus as unknown as Corpus;

describe('isClearlyWrittenIn', () => {
  it('never hides the button for a reader of another platform language', () => {
    const wrong: string[] = [];
    for (const language of READERS) {
      for (const text of samples[language]) {
        for (const reader of READERS) {
          if (reader !== language && isClearlyWrittenIn(text, reader)) wrong.push(`${language} text hidden for ${reader}: ${text}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never hides it for neighbouring languages, mixed text, names or links', () => {
    const wrong: string[] = [];
    for (const [label, text] of samples._other) {
      for (const reader of READERS) if (isClearlyWrittenIn(text, reader)) wrong.push(`${label} hidden for ${reader}: ${text}`);
    }
    expect(wrong).toEqual([]);
  });

  it('hides it for clear multi-word text in every reader language', () => {
    // At least a third of the longer samples in each language, and half
    // overall (community words such as "volunteers" are not everyday words, so
    // they keep the button); a broken word list (or a rule that always says no) fails here.
    // Spanish is the lowest by design: it shares most everyday words with
    // Galician, Catalan and Asturian, and doubt keeps the button.
    let hiddenAll = 0;
    let longerAll = 0;
    for (const reader of READERS) {
      const longer = samples[reader].filter((text) => text.length >= 50);
      const hidden = longer.filter((text) => isClearlyWrittenIn(text, reader)).length;
      hiddenAll += hidden;
      longerAll += longer.length;
      expect(hidden * 3, `${reader}: ${hidden}/${longer.length}`).toBeGreaterThanOrEqual(longer.length);
    }
    expect(hiddenAll * 2).toBeGreaterThanOrEqual(longerAll);
  });

  it('keeps it for short texts in Latin-script languages', () => {
    for (const text of ['Thanks!', 'See you Saturday.', 'Danke!', 'Bis Samstag.', '¡Gracias!', 'Nos vemos el sábado.']) {
      for (const reader of READERS) expect(isClearlyWrittenIn(text, reader), `${text} / ${reader}`).toBe(false);
    }
  });

  it('keeps it when a few of the reader\'s words sit inside another language', () => {
    expect(isClearlyWrittenIn('L\'Oscar per "I\'m Still Here" dóna al Brasil una alegria que la política nega.', 'en')).toBe(false);
    expect(isClearlyWrittenIn('Hola everyone! Necesito help con mi jardín este Saturday morning, gracias.', 'en')).toBe(false);
    expect(isClearlyWrittenIn('Hola everyone! Necesito help con mi jardín este Saturday morning, gracias.', 'es')).toBe(false);
  });

  it('keeps it when any part shown is not mostly the reader\'s words', () => {
    const english = 'Please remember to log your hours after each exchange so the balance stays accurate.';
    expect(isClearlyWrittenIn([english, 'Garden help this weekend'], 'en')).toBe(true);
    expect(isClearlyWrittenIn([english, 'Ayuda con jardinería en mi huerto'], 'en')).toBe(false);
    expect(isClearlyWrittenIn([english, 'Ayuda'], 'en')).toBe(false);
    expect(isClearlyWrittenIn([english, '', null, undefined], 'en')).toBe(true);
  });

  it('keeps it until the reader\'s vocabulary is available', () => {
    const english = 'Please remember to log your hours after each exchange so the balance stays accurate.';
    expect(judge(english, 'en', null)).toBe(false);
    expect(judge(english, 'en', undefined)).toBe(false);
    expect(judge(english, 'en', VOCABULARY.en)).toBe(true);
    // Japanese is judged by its script and needs no vocabulary.
    expect(judge('土曜日の朝、ソファを運ぶのを手伝ってくれる人はいますか？', 'ja', null)).toBe(true);
  });

  it('tells Arabic from Persian and Urdu, and Japanese from Chinese', () => {
    expect(isClearlyWrittenIn('آیا کسی می‌تواند صبح شنبه به من کمک کند یک مبل را جابه‌جا کنم؟', 'ar')).toBe(false);
    expect(isClearlyWrittenIn('کیا کوئی ہفتے کی صبح صوفہ منتقل کرنے میں میری مدد کر سکتا ہے؟', 'ar')).toBe(false);
    expect(isClearlyWrittenIn('星期六早上有人能帮我搬沙发吗？', 'ja')).toBe(false);
    expect(isClearlyWrittenIn('土曜日の朝、ソファを運ぶのを手伝ってくれる人はいますか？', 'ja')).toBe(true);
  });

  it('ignores links, mentions, markup and numbers when judging', () => {
    const english = 'Please remember to log your hours after each exchange so the balance stays accurate.';
    expect(isClearlyWrittenIn(`<p>${english}</p> https://example.org/es/ayuda @maría #jardín 2026`, 'en')).toBe(true);
    expect(isClearlyWrittenIn('https://example.com/garden-tools-for-the-community-shed', 'en')).toBe(false);
  });

  it('keeps the button for anything it cannot judge', () => {
    for (const value of [null, undefined, '', '   ', '🙂🙂🙂', '12345 67890', 'x'.repeat(50001)]) {
      expect(isClearlyWrittenIn(value as string | null | undefined, 'en')).toBe(false);
    }
    const english = 'Please remember to log your hours after each exchange so the balance stays accurate.';
    for (const locale of [null, undefined, '', 'sv', 'xx', 'zh']) expect(isClearlyWrittenIn(english, locale)).toBe(false);
    expect(isClearlyWrittenIn(english, 'en-GB')).toBe(true);
    expect(isClearlyWrittenIn(english, 'EN')).toBe(true);
  });

  it('the phone app and accessible site carry exactly this detector', () => {
    // CI runs this suite on every change, so a copy that was not re-synced fails here.
    const script = path.resolve(__dirname, '../../../../scripts/sync-text-language.mjs');
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('judges a very long text quickly', () => {
    const long = 'Please remember to log your hours after each exchange so the balance stays accurate. '.repeat(550);
    const started = performance.now();
    isClearlyWrittenIn(long, 'en');
    expect(performance.now() - started).toBeLessThan(200);
  });
});
